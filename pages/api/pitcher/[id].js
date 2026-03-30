// pages/api/pitcher/[id].js
import {
  fetchPitcherSeasonStats,
  fetchPitcherGameLog,
  fetchPitcherInfo,
  fetchPitcherHandednessSplits,
} from '../../../lib/mlb';

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

    // Vs specific opposing team — search both seasons
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

    // ── v2: Pitcher K% (overall + handedness splits) ─────────────────────────
    // Overall K% from season stats: K / BF
    const seasonBF_total = activeStats?.battersFaced ?? null;
    const seasonK_total  = activeStats?.strikeOuts ?? null;
    const pitcherKPct = (seasonBF_total && seasonBF_total > 0 && seasonK_total != null)
      ? seasonK_total / seasonBF_total
      : null;

    // Current-season handedness splits (fall back to prior if current sample < 20 BF each)
    let pitcherKPctVsL = splits.vsL;
    let pitcherKPctVsR = splits.vsR;

    if ((splits.vsLBF ?? 0) < 20 && priorSplits.vsL != null) {
      pitcherKPctVsL = pitcherKPctVsL != null
        ? 0.6 * pitcherKPctVsL + 0.4 * priorSplits.vsL  // blend if some current data
        : priorSplits.vsL;
    }
    if ((splits.vsRBF ?? 0) < 20 && priorSplits.vsR != null) {
      pitcherKPctVsR = pitcherKPctVsR != null
        ? 0.6 * pitcherKPctVsR + 0.4 * priorSplits.vsR
        : priorSplits.vsR;
    }

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
      pitcherKPct,
      pitcherKPctVsL,
      pitcherKPctVsR,
      pitcherBBPer9,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
