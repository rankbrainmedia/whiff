// pages/api/pitcher/[id].js
import {
  fetchPitcherSeasonStats,
  fetchPitcherGameLog,
  fetchPitcherInfo,
  fetchPitcherHandednessSplits,
} from '../../../lib/mlb';
import MODEL_CONFIG from '../../../lib/model-config.js';

// Parse "6.2" innings pitched format to decimal innings
function ipToDecimal(ip) {
  if (!ip) return 0;
  const [whole, thirds] = String(ip).split('.').map(Number);
  return (whole || 0) + ((thirds || 0) / 3);
}

// Estimate BF from a game log entry
// MLB API returns battersFaced directly in pitching game logs
function extractBF(stat) {
  if (stat?.battersFaced != null && stat.battersFaced > 0) return stat.battersFaced;
  // Fallback: approximate from IP, H, BB (BF ≈ outs + H + BB + HBP)
  const outs = ipToDecimal(stat?.inningsPitched ?? 0) * 3;
  const hits  = stat?.hits ?? 0;
  const bb    = stat?.baseOnBalls ?? 0;
  const hbp   = stat?.hitByPitch ?? 0;
  const est   = Math.round(outs + hits + bb + hbp);
  return est > 0 ? est : null;
}

// Compute mean BF for a slice of game log entries
function meanBF(games) {
  const bfValues = games.map(g => extractBF(g.stat)).filter(v => v != null && v > 0);
  if (!bfValues.length) return null;
  return bfValues.reduce((a, b) => a + b, 0) / bfValues.length;
}

export default async function handler(req, res) {
  try {
    const { id, opposingTeamId, season } = req.query;
    const pitcherId = parseInt(id);
    const yr = season ? parseInt(season) : new Date().getFullYear();

    // Fetch current season + prior season in parallel (+ handedness splits)
    const [info, seasonStats, gameLog, priorGameLog, priorSeasonStats, splits, priorSplits] = await Promise.all([
      fetchPitcherInfo(pitcherId),
      fetchPitcherSeasonStats(pitcherId, yr),
      fetchPitcherGameLog(pitcherId, yr),
      fetchPitcherGameLog(pitcherId, yr - 1),
      fetchPitcherSeasonStats(pitcherId, yr - 1),
      fetchPitcherHandednessSplits(pitcherId, yr),
      fetchPitcherHandednessSplits(pitcherId, yr - 1),
    ]);

    // Fall back to prior season stats if current season is empty
    const activeStats = seasonStats?.era != null ? seasonStats : priorSeasonStats;

    // Current season starts
    const starts2026 = gameLog.length; // all current-year starts in log

    // Last 10 starts from current season only (for display)
    const last10 = gameLog.slice(0, 10).map(g => ({
      date: g.date,
      opponent: g.opponent?.abbreviation,
      opponentId: g.opponent?.id,
      strikeOuts: g.stat?.strikeOuts ?? 0,
      inningsPitched: g.stat?.inningsPitched,
      hits: g.stat?.hits,
      earnedRuns: g.stat?.earnedRuns,
      walks: g.stat?.baseOnBalls,
      pitchCount: g.stat?.numberOfPitches,
      battersFaced: extractBF(g.stat),
    }));

    // Vs specific opposing team — search both seasons; include isHome for anchor
    let vsTeam = [];
    if (opposingTeamId) {
      const tid = parseInt(opposingTeamId);
      const allMatchups = [...gameLog, ...priorGameLog].filter(
        g => g.opponent?.id === tid
      );
      vsTeam = allMatchups.map(g => ({
        date: g.date,
        opponent: g.opponent?.abbreviation,
        strikeOuts: g.stat?.strikeOuts ?? 0,
        inningsPitched: g.stat?.inningsPitched,
        hits: g.stat?.hits,
        earnedRuns: g.stat?.earnedRuns,
        pitchCount: g.stat?.numberOfPitches,
        season: g.season,
        isHome: g.isHome ?? null, // used by same-opponent anchor
      }));
    }

    // Combined log for averages — current season first, fill from prior
    const combinedLog = [...gameLog, ...priorGameLog];
    const recentKs    = last10.map(g => g.strikeOuts);
    const combinedKs  = combinedLog.slice(0, 10).map(g => g.stat?.strikeOuts ?? 0);

    const avgKLast5 = combinedKs.slice(0, 5).length
      ? combinedKs.slice(0, 5).reduce((a, b) => a + b, 0) / combinedKs.slice(0, 5).length
      : null;

    const avgKLast10 = combinedKs.length
      ? combinedKs.reduce((a, b) => a + b, 0) / combinedKs.length
      : null;

    const avgKvsTeam = vsTeam.length
      ? vsTeam.reduce((a, g) => a + g.strikeOuts, 0) / vsTeam.length
      : null;

    const avgIPLast10 = combinedLog.slice(0, 10).reduce((a, g) => {
      return a + ipToDecimal(g.stat?.inningsPitched ?? 0);
    }, 0) / Math.min(combinedLog.slice(0, 10).length, 10) || null;

    const avgPitchesLast10 = combinedLog.slice(0, 10).reduce((a, g) => {
      return a + (g.stat?.numberOfPitches ?? 0);
    }, 0) / Math.min(combinedLog.slice(0, 10).length, 10) || null;

    // ── v2: Batters Faced calculations ────────────────────────────────────────
    const recentBF = meanBF(gameLog.slice(0, 3));    // last 3 starts (current season)
    const seasonBF = meanBF(gameLog);                 // full current season avg
    const priorBF  = meanBF(priorGameLog);            // prior season avg

    // ── v3: Pitcher K% with Bayesian shrinkage ────────────────────────────────
    // Use current-season stats specifically (not activeStats fallback) for K%
    const seasonBF_total = seasonStats?.battersFaced ?? null;
    const seasonK_total  = seasonStats?.strikeOuts ?? null;
    const pitcherKPctRaw = (seasonBF_total && seasonBF_total > 0 && seasonK_total != null)
      ? seasonK_total / seasonBF_total
      : null;

    // Prior season K% — used as the shrinkage prior
    const priorKPct = (priorSeasonStats?.strikeOuts != null && (priorSeasonStats?.battersFaced ?? 0) > 0)
      ? priorSeasonStats.strikeOuts / priorSeasonStats.battersFaced
      : MODEL_CONFIG.league_k_pct; // fallback to league avg if no prior data

    // Shrinkage blend: λ = currentBF / (currentBF + 150)
    // λ=0 (no current data) → use prior straight; λ→1 (large sample) → trust current
    const shrinkageBF = seasonBF_total || 0;
    const lambda = shrinkageBF / (shrinkageBF + MODEL_CONFIG.k_rate_shrinkage_pa);
    const pitcherKPct = pitcherKPctRaw != null
      ? lambda * pitcherKPctRaw + (1 - lambda) * priorKPct
      : priorKPct;

    // Handedness splits — apply same shrinkage pattern with split-specific BF counts
    const priorKPctVsL = priorSplits.vsL ?? priorKPct;
    const priorKPctVsR = priorSplits.vsR ?? priorKPct;

    const lambdaVsL = (splits.vsLBF ?? 0) / ((splits.vsLBF ?? 0) + MODEL_CONFIG.k_rate_shrinkage_pa);
    const pitcherKPctVsL = splits.vsL != null
      ? lambdaVsL * splits.vsL + (1 - lambdaVsL) * priorKPctVsL
      : priorKPctVsL;

    const lambdaVsR = (splits.vsRBF ?? 0) / ((splits.vsRBF ?? 0) + MODEL_CONFIG.k_rate_shrinkage_pa);
    const pitcherKPctVsR = splits.vsR != null
      ? lambdaVsR * splits.vsR + (1 - lambdaVsR) * priorKPctVsR
      : priorKPctVsR;

    // Walk rate (BB/9) for BF drag calculation
    const pitcherBBPer9 = activeStats?.walksPer9Inn
      ? parseFloat(activeStats.walksPer9Inn)
      : null;

    // 'full' = all prior season, 'partial' = mix, false = all current
    const usingFallback = gameLog.length === 0 && priorGameLog.length > 0
      ? 'full'
      : gameLog.length > 0 && gameLog.length < 5 && priorGameLog.length > 0
      ? 'partial'
      : false;

    res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate');
    return res.status(200).json({
      season: yr,
      usingFallback,
      pitcher: {
        id: pitcherId,
        fullName: info.fullName,
        throws: info.pitchHand?.code,
        age: info.currentAge,
        team: info.currentTeam?.name,
      },
      seasonStats: {
        era: activeStats.era,
        kPer9: activeStats.strikeoutsPer9Inn,
        whip: activeStats.whip,
        strikeOuts: activeStats.strikeOuts,
        wins: activeStats.wins,
        losses: activeStats.losses,
        gamesStarted: activeStats.gamesStarted,
        inningsPitched: activeStats.inningsPitched,
        strikeoutWalkRatio: activeStats.strikeoutWalkRatio,
        battersFaced: activeStats.battersFaced ?? null,
      },
      last10,
      recentKs,
      avgKLast5,
      avgKLast10,
      vsTeam,
      avgKvsTeam,
      avgIPLast10,
      avgPitchesLast10,
      // v2 additions
      starts2026,
      recentBF,
      seasonBF,
      priorBF,
      pitcherKPct,        // shrunk value (use this for projections)
      pitcherKPctRaw,     // unshrunk current-season value (display only)
      pitcherKPctVsL,     // shrunk split
      pitcherKPctVsR,     // shrunk split
      pitcherBBPer9,
      // shrinkage metadata for display ("26.8% shrunk from 31.8%")
      kShrinkageLambda: Math.round(lambda * 1000) / 1000,
      kShrinkageBF: shrinkageBF,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
