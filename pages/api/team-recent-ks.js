// pages/api/team-recent-ks.js
// Returns a team's last N completed games with:
//   - actualKs: strikeouts the team's batters took
//   - opposingPitcherKPer9: starter's K rate in that game (as quality-of-opponent proxy)
//   - opposingPitcherIP: innings the opposing starter pitched
//
// Used by lib/team-hot-cold.js to compute the K hot/cold modifier.

const BASE = 'https://statsapi.mlb.com/api/v1';

// Convert "6.2" IP format to decimal innings
function ipToDecimal(ip) {
  if (!ip && ip !== 0) return 0;
  const [whole, thirds] = String(ip).split('.').map(Number);
  return (whole || 0) + ((thirds || 0) / 3);
}

export default async function handler(req, res) {
  const { teamId, limit } = req.query;
  if (!teamId) return res.status(400).json({ error: 'teamId required' });

  const maxGames = Math.min(parseInt(limit) || 5, 10);

  try {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(today.getDate() - 21); // look back 21 days to find enough games

    const fmt = d => d.toISOString().slice(0, 10);

    // Step 1: Fetch recent schedule for this team (no boxscore hydrate — keep payload small)
    const schedUrl = `${BASE}/schedule?sportId=1&teamId=${teamId}&startDate=${fmt(startDate)}&endDate=${fmt(today)}&gameType=R`;
    const schedRes = await fetch(schedUrl);
    if (!schedRes.ok) throw new Error(`Schedule fetch failed: ${schedRes.status}`);
    const schedData = await schedRes.json();

    const allGames = (schedData.dates ?? []).flatMap(d => d.games ?? []);

    // Filter to completed games, sort most recent first, take up to maxGames
    const completedGames = allGames
      .filter(g => g.status?.abstractGameState === 'Final')
      .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate))
      .slice(0, maxGames);

    if (!completedGames.length) {
      return res.status(200).json({ teamId: parseInt(teamId), recentGames: [] });
    }

    // Step 2: Fetch boxscore for each completed game (in parallel)
    const boxscoreResults = await Promise.allSettled(
      completedGames.map(game =>
        fetch(`${BASE}/game/${game.gamePk}/boxscore`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    );

    const recentGames = [];
    const tid = parseInt(teamId);

    for (let i = 0; i < completedGames.length; i++) {
      const game = completedGames[i];
      const boxscoreData = boxscoreResults[i].status === 'fulfilled'
        ? boxscoreResults[i].value
        : null;

      if (!boxscoreData) continue;

      const homeTeamId = game.teams?.home?.team?.id;
      const isHome = homeTeamId === tid;

      // Actual Ks taken by our team (batting stats)
      const ourBattingStats = isHome
        ? boxscoreData.teams?.home?.teamStats?.batting
        : boxscoreData.teams?.away?.teamStats?.batting;

      const actualKs = ourBattingStats?.strikeOuts ?? null;
      if (actualKs == null) continue;

      // Opposing starting pitcher (first pitcher in their pitcher list)
      const opponentKey = isHome ? 'away' : 'home';
      const opponentPitcherIds = boxscoreData.teams?.[opponentKey]?.pitchers ?? [];
      const starterId = opponentPitcherIds[0];

      let opposingPitcherKPer9 = 8.0; // league avg fallback
      let opposingPitcherIP = 5.5;    // league avg fallback

      if (starterId) {
        const starterEntry = boxscoreData.teams?.[opponentKey]?.players?.[`ID${starterId}`];
        const pitchingStats = starterEntry?.stats?.pitching;
        if (pitchingStats) {
          const ipDecimal = ipToDecimal(pitchingStats.inningsPitched);
          const gameKs = pitchingStats.strikeOuts ?? null;

          if (ipDecimal > 0) {
            opposingPitcherIP = ipDecimal;
            // K/9 for this game start — volatile but best available without extra season-stats fetch
            if (gameKs != null) {
              opposingPitcherKPer9 = (gameKs / ipDecimal) * 9;
            }
          }
        }
      }

      recentGames.push({
        gameDate: game.gameDate?.slice(0, 10),
        gamePk: game.gamePk,
        actualKs,
        opposingPitcherKPer9: Math.round(opposingPitcherKPer9 * 10) / 10,
        opposingPitcherIP: Math.round(opposingPitcherIP * 10) / 10,
      });
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');
    return res.status(200).json({ teamId: tid, recentGames });

  } catch (err) {
    console.error('team-recent-ks error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
