// pages/api/teams.js
import { fetchTeamHittingStats } from '../../lib/mlb';

export default async function handler(req, res) {
  try {
    const { season } = req.query;
    const teams = await fetchTeamHittingStats(season);

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).json({ teams });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
