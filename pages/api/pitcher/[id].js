// pages/api/pitcher/[id].js
import {
  fetchPitcherSeasonStats,
  fetchPitcherGameLog,
  fetchPitcherInfo,
} from '../../../lib/mlb';

export default async function handler(req, res) {
  try {
    const { id, opposingTeamId, season } = req.query;
    const pitcherId = parseInt(id);
    const yr = season ? parseInt(season) : new Date().getFullYear();

    // Fetch current season + prior season in parallel
    const [info, seasonStats, gameLog, priorGameLog, priorSeasonStats] = await Promise.all([
      fetchPitcherInfo(pitcherId),
      fetchPitcherSeasonStats(pitcherId, yr),
      fetchPitcherGameLog(pitcherId, yr),
      fetchPitcherGameLog(pitcherId, yr - 1),
      fetchPitcherSeasonStats(pitcherId, yr - 1),
    ]);

    // Fall back to prior season stats if current season is empty
    const activeStats = seasonStats?.era != null ? seasonStats : priorSeasonStats;

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
    const recentKs = last10.map(g => g.strikeOuts);
    const combinedKs = combinedLog.slice(0, 10).map(g => g.stat?.strikeOuts ?? 0);

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
      const ip = parseFloat(g.stat?.inningsPitched ?? 0);
      return a + ip;
    }, 0) / Math.min(combinedLog.slice(0, 10).length, 10) || null;

    const avgPitchesLast10 = combinedLog.slice(0, 10).reduce((a, g) => {
      return a + (g.stat?.numberOfPitches ?? 0);
    }, 0) / Math.min(combinedLog.slice(0, 10).length, 10) || null;

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
      },
      last10,
      recentKs,
      avgKLast5,
      avgKLast10,
      vsTeam,
      avgKvsTeam,
      avgIPLast10,
      avgPitchesLast10,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}