// pages/api/lineup.js
// Fetches confirmed batting order from MLB Stats API live feed
// Only available ~60-90 min before first pitch

const BASE = 'https://statsapi.mlb.com/api/v1';

// v2: Relative position weights (sum ≈ 8.97).
// Scaled to starter's expected BF in the projection layer, not fixed PAs.
const POSITION_WEIGHTS = [1.12, 1.07, 1.04, 1.02, 0.99, 0.97, 0.94, 0.92, 0.90];

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
        const seasonStats = player?.seasonStats?.batting ?? {};

        return {
          battingOrder: idx + 1,
          id: playerId,
          fullName: player?.person?.fullName,
          position: player?.position?.abbreviation,
          // Batter handedness — used by v2 log5 to pick pitcher split
          batSide: player?.person?.batSide?.code ?? null,
          // Season K stats for fallback K% when no career BvP data
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

    // v2: Return relative weights instead of fixed expected PAs.
    // The caller scales these to the starter's expected BF (BF̂ × w_i / Σw).
    const enrichWithWeights = (lineup) => {
      if (!lineup) return null;
      return lineup.map((batter, i) => ({
        ...batter,
        positionWeight: POSITION_WEIGHTS[i] ?? POSITION_WEIGHTS[POSITION_WEIGHTS.length - 1],
      }));
    };

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate');
    return res.status(200).json({
      available: !!(awayLineup && homeLineup),
      away: enrichWithWeights(awayLineup),
      home: enrichWithWeights(homeLineup),
    });
  } catch (err) {
    console.error('Lineup fetch error:', err);
    return res.status(200).json({ available: false, error: err.message });
  }
}
