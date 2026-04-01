// pages/api/cached-projections.js
// Serves pre-computed projections from the cron pipeline (via Vercel Blob).
// Frontend reads this instead of making 15+ API calls per page load.

import { readCache } from '../../lib/store.js';

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export default async function handler(req, res) {
  const date = req.query.date || todayStr();

  try {
    const data = await readCache(`projections/${date}`);
    if (!data || Object.keys(data).length === 0) {
      return res.status(200).json({ date, games: {}, note: 'No projections cached yet. Cron may not have run.' });
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ date, games: data });
  } catch (err) {
    console.error('cached-projections error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
