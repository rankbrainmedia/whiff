// pages/api/battervspitcher.js
// v2: Returns batter season K% (Kb for log5) separately from BvP residual data.
// The log5 base rate and BvP shrinkage are computed in lib/projection.js (client-side).
//
// For each batter:
//   kPct     — batter's season K% vs pitcher handedness (or overall fallback)
//   pa       — sample size for kPct
//   bvpKPct  — career K% vs this specific pitcher (null if < 3 PA)
//   bvpPA    — career PA vs this pitcher
//   batSide  — batter handedness (L/R/S), passed through from lineup if available
//   source   — data source for kPct

const BASE = 'https://statsapi.mlb.com/api/v1';

// Career BvP stats for this batter vs this pitcher
async function getBatterVsPitcherKRate(batterId, pitcherId) {
  try {
    const url = `${BASE}/people/${batterId}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pitcherId}&season=2025&season=2024`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    const splits = data.stats?.[0]?.splits ?? [];
    if (!splits.length) return null;

    let totalPA = 0, totalK = 0;
    for (const split of splits) {
      totalPA += split.stat?.plateAppearances ?? 0;
      totalK  += split.stat?.strikeOuts ?? 0;
    }

    if (totalPA < 3) return null;
    return { kPct: totalK / totalPA, pa: totalPA };
  } catch {
    return null;
  }
}

// Batter's season K% — tries platoon split first (vs pitcher handedness), then overall
async function getBatterSeasonKRate(batterId, pitcherThrows, season) {
  const yr = season || new Date().getFullYear();

  for (const y of [yr, yr - 1]) {
    try {
      // Try platoon split (vs LHP or vs RHP) if pitcher handedness is known
      if (pitcherThrows === 'L' || pitcherThrows === 'R') {
        const sitCode = pitcherThrows === 'L' ? 'vl' : 'vr';
        const splitUrl = `${BASE}/people/${batterId}/stats?stats=statSplits&group=hitting&season=${y}&sitCodes=${sitCode}`;
        const splitRes = await fetch(splitUrl);
        if (splitRes.ok) {
          const splitData = await splitRes.json();
          const splitStat = splitData.stats?.[0]?.splits?.[0]?.stat;
          if (splitStat?.plateAppearances >= 30) {
            return {
              kPct: splitStat.strikeOuts / splitStat.plateAppearances,
              pa: splitStat.plateAppearances,
              source: `${y}_vs${pitcherThrows}HP`,
            };
          }
        }
      }

      // Fall back to overall season K%
      const url = `${BASE}/people/${batterId}/stats?stats=season&group=hitting&season=${y}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const stat = data.stats?.[0]?.splits?.[0]?.stat;
      if (stat?.plateAppearances >= 20) {
        return {
          kPct: stat.strikeOuts / stat.plateAppearances,
          pa: stat.plateAppearances,
          source: `${y}_season`,
        };
      }
    } catch {
      continue;
    }
  }

  return null;
}

export default async function handler(req, res) {
  try {
    const { pitcherId, batterIds, pitcherThrows } = req.query;
    if (!pitcherId || !batterIds) {
      return res.status(400).json({ error: 'pitcherId and batterIds required' });
    }

    const ids = batterIds.split(',').map(Number).filter(Boolean);
    const season = new Date().getFullYear();
    const throws = pitcherThrows ?? null; // 'L', 'R', or null

    // Fetch all batters in parallel — batter season K% and BvP career data
    const results = await Promise.all(ids.map(async (batterId) => {
      const [bvpData, seasonData] = await Promise.all([
        getBatterVsPitcherKRate(batterId, parseInt(pitcherId)),
        getBatterSeasonKRate(batterId, throws, season),
      ]);

      // kPct = batter season K% (Kb for log5)
      const kPct = seasonData?.kPct ?? 0.222; // league avg fallback
      const pa   = seasonData?.pa ?? 0;
      const source = seasonData?.source ?? 'league_avg';

      // bvpKPct / bvpPA = career residual for BvP shrinkage (separate from Kb)
      const bvpKPct = bvpData?.kPct ?? null;
      const bvpPA   = bvpData?.pa   ?? null;

      return { batterId, kPct, pa, bvpKPct, bvpPA, source };
    }));

    // Build lookup map
    const kRateMap = {};
    for (const r of results) {
      kRateMap[r.batterId] = r;
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).json({ kRateMap });
  } catch (err) {
    console.error('BvP error:', err);
    return res.status(500).json({ error: err.message });
  }
}
