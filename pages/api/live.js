// pages/api/live.js — Live boxscore K tracking from MLB Stats API
let cache = {};
let cacheTime = 0;
const CACHE_TTL = 30000; // 30 seconds

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const gamePks = (req.query.gamePks || '').split(',').filter(Boolean);
  if (!gamePks.length) return res.status(200).json({ games: {} });

  // Return cache if fresh
  const cacheKey = gamePks.sort().join(',');
  if (cache[cacheKey] && (Date.now() - cacheTime) < CACHE_TTL) {
    return res.status(200).json(cache[cacheKey]);
  }

  const games = {};

  const results = await Promise.allSettled(
    gamePks.map(async (gPk) => {
      const boxRes = await fetch(`https://statsapi.mlb.com/api/v1/game/${gPk}/boxscore`);
      if (!boxRes.ok) return { gPk, data: null };
      const box = await boxRes.json();

      const gameData = { away: {}, home: {} };

      for (const side of ['away', 'home']) {
        const players = box?.teams?.[side]?.players ?? {};
        for (const [, pv] of Object.entries(players)) {
          const ps = pv?.stats?.pitching ?? {};
          const ip = ps.inningsPitched;
          if (!ip || parseFloat(ip) <= 0) continue;

          const pid = pv?.person?.id;
          if (!pid) continue;

          gameData[side][pid] = {
            ks: ps.strikeOuts ?? 0,
            ip: ip,
            isCurrent: pv?.gameStatus?.isCurrentPitcher === true,
            name: pv?.person?.fullName ?? '',
            pitchCount: ps.numberOfPitches ?? null,
            isOnBench: false, // will be set below
          };
        }
      }

      // Detect pulled pitchers: if someone else on the same team isCurrent,
      // all non-current pitchers on that team are truly done (pulled)
      for (const side of ['away', 'home']) {
        const hasCurrent = Object.values(gameData[side]).some(p => p.isCurrent);
        if (hasCurrent) {
          for (const [pid, p] of Object.entries(gameData[side])) {
            if (!p.isCurrent) p.isOnBench = true; // pulled — another pitcher is active
          }
        }
        // If nobody isCurrent, team is batting — nobody is "done"
      }

      return { gPk, data: gameData };
    })
  );

  for (const r of results) {
    if (r.status === 'fulfilled' && r.value?.data) {
      games[r.value.gPk] = r.value.data;
    }
  }

  const response = { games };
  cache[cacheKey] = response;
  cacheTime = Date.now();

  return res.status(200).json(response);
}
