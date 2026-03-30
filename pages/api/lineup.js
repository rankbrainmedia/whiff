// pages/api/lineup.js
// Fetches confirmed batting order from MLB Stats API live feed
// Only available ~60-90 min before first pitch

const BASE = 'https://statsapi.mlb.com/api/v1';

export default async function handler(req, res) {
  try {
    const { gamePk } = req.query;
    if (!gamePk) return res.status(400).json({ error: 'gamePk required' });

    // Fetch live feed
    const liveRes = await fetch(`${BASE}.1/game/${gamePk}/feed/live`);
    if (!liveRes.ok) return res.status(200).json({ available: false });
    const liveData = await liveRes.json();

    const boxscore = liveData?.liveData?.boxscore;
    if (!boxscore) return res.status(200).json({ available: false });

    const parseTeam = (teamData) => {
      const order = teamData?.battingOrder ?? [];
      if (!order.length) return null;

      const players = teamData?.players ?? {};

      return order.map((playerId, idx) => {
        const key = `ID${playerId}`;
        const player = players[key];
        const stats = player?.stats?.batting ?? {};
        const seasonStats = player?.seasonStats?.batting ?? {};

        return {
          battingOrder: idx + 1,
          id: playerId,
          fullName: player?.person?.fullName,
          position: player?.position?.abbreviation,
          // Career season K stats for fallback
          strikeOuts: seasonStats.strikeOuts ?? null,
          plateAppearances: seasonStats.plateAppearances ?? null,
          kPct: seasonStats.plateAppearances
            ? (seasonStats.strikeOuts / seasonStats.plateAppearances)
            : null,
        };
      });
    };

    const awayLineup = parseTeam(boxscore.teams?.away);
    const homeLineup = parseTeam(boxscore.teams?.home);

    // Expected PAs by batting order position (based on historical averages)
    // Leadoff gets most PAs, 9-hole gets fewest
    const expectedPAs = [4.3, 4.1, 4.0, 3.9, 3.8, 3.7, 3.6, 3.5, 3.4];

    const enrichWithPAs = (lineup) => {
      if (!lineup) return null;
      return lineup.map((batter, i) => ({
        ...batter,
        expectedPA: expectedPAs[i] ?? 3.5,
      }));
    };

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate');
    return res.status(200).json({
      available: !!(awayLineup && homeLineup),
      away: enrichWithPAs(awayLineup),
      home: enrichWithPAs(homeLineup),
    });
  } catch (err) {
    console.error('Lineup fetch error:', err);
    return res.status(200).json({ available: false, error: err.message });
  }
}
