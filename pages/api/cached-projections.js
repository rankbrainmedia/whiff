// pages/api/cached-projections.js
// Serves pre-computed projections from the cron pipeline.
// Frontend reads this instead of making 15+ API calls per page load.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

function todayStr() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export default async function handler(req, res) {
  const date = req.query.date || todayStr();
  const path = `/tmp/whiff-projections/${date}.json`;

  if (!existsSync(path)) {
    return res.status(200).json({ date, games: {}, note: 'No projections cached yet. Cron may not have run.' });
  }

  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ date, games: data });
  } catch (err) {
    console.error('cached-projections read error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
