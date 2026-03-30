// pages/api/props.js
const ODDS_BASE = 'https://api.the-odds-api.com/v4';
const API_KEY = process.env.ODDS_API_KEY;

// Fetch with a delay between calls to avoid rate limiting
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  if (!API_KEY) {
    return res.status(200).json({ props: [], note: 'ODDS_API_KEY not configured' });
  }

  try {
    // Step 1: Get all MLB events (1 call)
    const eventsRes = await fetch(
      `${ODDS_BASE}/sports/baseball_mlb/events?apiKey=${API_KEY}&dateFormat=iso`
    );
    const events = await eventsRes.json();

    if (!Array.isArray(events)) {
      console.error('Events response:', events);
      return res.status(200).json({ props: [], error: 'Could not fetch event list' });
    }

    // Filter to upcoming games only
    const now = new Date();
    const upcoming = events.filter(e => new Date(e.commence_time) > now);

    console.log(`Fetching props for ${upcoming.length} upcoming games`);

    // Step 2: Per-event prop fetch — throttled, 300ms between each call
    const props = [];
    for (const event of upcoming) {
      try {
        const url = `${ODDS_BASE}/sports/baseball_mlb/events/${event.id}/odds?apiKey=${API_KEY}&regions=us&markets=pitcher_strikeouts&oddsFormat=american&bookmakers=fanduel`;
        const propRes = await fetch(url);
        const propData = await propRes.json();

        for (const book of propData.bookmakers ?? []) {
          if (book.key !== 'fanduel') continue;
          for (const market of book.markets ?? []) {
            if (!market.key.includes('strikeout')) continue;

            const byPitcher = {};
            for (const outcome of market.outcomes ?? []) {
              const name = outcome.description || outcome.name;
              if (!byPitcher[name]) {
                byPitcher[name] = {
                  pitcherName: name,
                  homeTeam: event.home_team,
                  awayTeam: event.away_team,
                  commenceTime: event.commence_time,
                  lines: { fanduel: {} },
                };
              }
              const side = outcome.name === 'Over' ? 'over' : 'under';
              byPitcher[name].lines.fanduel[side] = {
                line: outcome.point,
                price: outcome.price,
              };
            }
            props.push(...Object.values(byPitcher));
          }
        }
      } catch (e) {
        console.error(`Failed for event ${event.id}:`, e.message);
      }

      // 300ms pause between calls — stays well under rate limits
      await sleep(300);
    }

    console.log(`Got props for ${props.length} pitchers`);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({ props });
  } catch (err) {
    console.error('Props fetch error:', err);
    return res.status(200).json({ props: [], error: err.message });
  }
}