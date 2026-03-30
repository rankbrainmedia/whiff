// pages/api/schedule.js
import { fetchSchedule, fetchGameUmp } from '../../lib/mlb';

export default async function handler(req, res) {
  try {
    const { date } = req.query;
    const games = await fetchSchedule(date);

    const cleaned = games.map(g => ({
      gamePk: g.gamePk,
      gameDate: g.gameDate,
      status: g.status?.detailedState,
      venue: g.venue?.name,
      away: {
        teamId: g.teams?.away?.team?.id,
        teamName: g.teams?.away?.team?.name,
        abbreviation: g.teams?.away?.team?.abbreviation,
        probablePitcher: g.teams?.away?.probablePitcher
          ? { id: g.teams.away.probablePitcher.id, fullName: g.teams.away.probablePitcher.fullName }
          : null,
      },
      home: {
        teamId: g.teams?.home?.team?.id,
        teamName: g.teams?.home?.team?.name,
        abbreviation: g.teams?.home?.team?.abbreviation,
        probablePitcher: g.teams?.home?.probablePitcher
          ? { id: g.teams.home.probablePitcher.id, fullName: g.teams.home.probablePitcher.fullName }
          : null,
      },
      ump: null,
    }));

    // Fetch ump from live feed for ALL games in parallel
    const umpFetches = cleaned.map(g =>
      fetchGameUmp(g.gamePk)
        .then(u => ({ gamePk: g.gamePk, ump: u }))
        .catch(() => ({ gamePk: g.gamePk, ump: null }))
    );
    const umpResults = await Promise.all(umpFetches);
    for (const { gamePk, ump } of umpResults) {
      if (!ump) continue;
      const game = cleaned.find(g => g.gamePk === gamePk);
      if (game) game.ump = ump;
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    return res.status(200).json({ games: cleaned });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}