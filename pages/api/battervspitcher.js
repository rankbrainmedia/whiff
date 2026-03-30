// pages/api/battervspitcher.js
// For each batter in the lineup, get their K rate vs this specific pitcher
// Falls back to season K% when no career matchup history exists

const BASE = 'https://statsapi.mlb.com/api/v1';

async function getBatterVsPitcherKRate(batterId, pitcherId) {
  try {
    // MLB Stats API has a vs-pitcher split endpoint
    const url = `${BASE}/people/${batterId}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pitcherId}&season=2025&season=2024`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    const splits = data.stats?.[0]?.splits ?? [];
    if (!splits.length) return null;

    // Aggregate across seasons
    let totalPA = 0, totalK = 0;
    for (const split of splits) {
      totalPA += split.stat?.plateAppearances ?? 0;
      totalK  += split.stat?.strikeOuts ?? 0;
    }

    if (totalPA < 3) return null; // Too small a sample — fall back
    return { kPct: totalK / totalPA, pa: totalPA, k: totalK, source: 'career' };
  } catch {
    return null;
  }
}

async function getBatterSeasonKRate(batterId, season) {
  try {
    const yr = season || new Date().getFullYear();
    // Try current season first, fall back to 2025
    for (const y of [yr, yr - 1]) {
      const url = `${BASE}/people/${batterId}/stats?stats=season&group=hitting&season=${y}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const stat = data.stats?.[0]?.splits?.[0]?.stat;
      if (stat?.plateAppearances >= 20) {
        return {
          kPct: stat.strikeOuts / stat.plateAppearances,
          pa: stat.plateAppearances,
          k: stat.strikeOuts,
          source: `${y}_season`,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    const { pitcherId, batterIds } = req.query;
    if (!pitcherId || !batterIds) {
      return res.status(400).json({ error: 'pitcherId and batterIds required' });
    }

    const ids = batterIds.split(',').map(Number).filter(Boolean);
    const season = new Date().getFullYear();

    // Fetch all batters in parallel
    const results = await Promise.all(ids.map(async (batterId) => {
      // Try career vs this pitcher first
      const vsData = await getBatterVsPitcherKRate(batterId, parseInt(pitcherId));
      if (vsData) {
        return { batterId, ...vsData };
      }
      // Fall back to season K%
      const seasonData = await getBatterSeasonKRate(batterId, season);
      return {
        batterId,
        kPct: seasonData?.kPct ?? 0.22, // league avg fallback
        pa: seasonData?.pa ?? 0,
        k: seasonData?.k ?? 0,
        source: seasonData?.source ?? 'league_avg',
      };
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
