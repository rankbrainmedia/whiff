// pages/api/weather.js
// Uses Open-Meteo (free, no key) + hardcoded MLB stadium coordinates

const STADIUMS = {
  // Name fragments (lowercase) → { lat, lng, name }
  'busch':          { lat: 38.6226, lng: -90.1928, name: 'Busch Stadium' },
  'wrigley':        { lat: 41.9484, lng: -87.6553, name: 'Wrigley Field' },
  'rogers':         { lat: 43.6414, lng: -79.3894, name: 'Rogers Centre' },
  'camden':         { lat: 39.2838, lng: -76.6218, name: 'Camden Yards' },
  'citizens bank':  { lat: 39.9061, lng: -75.1665, name: 'Citizens Bank Park' },
  'great american': { lat: 39.0979, lng: -84.5074, name: 'Great American Ball Park' },
  'citi field':     { lat: 40.7571, lng: -73.8458, name: 'Citi Field' },
  'loandepot':      { lat: 25.7781, lng: -80.2197, name: 'loanDepot park' },
  'daikin':         { lat: 29.7573, lng: -95.3555, name: 'Daikin Park' },
  'american family':{ lat: 43.0280, lng: -87.9712, name: 'American Family Field' },
  'truist':         { lat: 33.8908, lng: -84.4678, name: 'Truist Park' },
  'oracle park':    { lat: 37.7786, lng: -122.3893, name: 'Oracle Park' },
  'petco':          { lat: 32.7073, lng: -117.1566, name: 'Petco Park' },
  'dodger':         { lat: 34.0739, lng: -118.2400, name: 'Dodger Stadium' },
  'uniqlo':         { lat: 34.0739, lng: -118.2400, name: 'Dodger Stadium' },
  't-mobile park':  { lat: 47.5914, lng: -122.3325, name: 'T-Mobile Park' },
  'yankee':         { lat: 40.8296, lng: -73.9262, name: 'Yankee Stadium' },
  'fenway':         { lat: 42.3467, lng: -71.0972, name: 'Fenway Park' },
  'globe life':     { lat: 32.7473, lng: -97.0845, name: 'Globe Life Field' },
  'target field':   { lat: 44.9817, lng: -93.2781, name: 'Target Field' },
  'progressive':    { lat: 41.4962, lng: -81.6852, name: 'Progressive Field' },
  'comerica':       { lat: 42.3390, lng: -83.0485, name: 'Comerica Park' },
  'kauffman':       { lat: 39.0517, lng: -94.4803, name: 'Kauffman Stadium' },
  'pnc park':       { lat: 40.4469, lng: -80.0057, name: 'PNC Park' },
  'chase field':    { lat: 33.4453, lng: -112.0667, name: 'Chase Field' },
  'coors':          { lat: 39.7559, lng: -104.9942, name: 'Coors Field' },
  'guaranteed rate':{ lat: 41.8300, lng: -87.6339, name: 'Guaranteed Rate Field' },
  'angel':          { lat: 33.8003, lng: -117.8827, name: 'Angel Stadium' },
  'sutter health':  { lat: 38.5802, lng: -121.4997, name: 'Sutter Health Park' },
  'sahlen':         { lat: 42.8897, lng: -78.8694, name: 'Sahlen Field' },
  'tropicana':      { lat: 27.7683, lng: -82.6534, name: 'Tropicana Field' },
  'minute maid':    { lat: 29.7573, lng: -95.3555, name: 'Minute Maid Park' },
  'nationals':      { lat: 38.8730, lng: -77.0074, name: 'Nationals Park' },
  'levi':           { lat: 37.4032, lng: -121.9694, name: "Levi's Stadium" },
};

function findStadium(venueName) {
  if (!venueName) return null;
  const lower = venueName.toLowerCase();
  for (const [key, val] of Object.entries(STADIUMS)) {
    if (lower.includes(key)) return val;
  }
  return null;
}

// Open-Meteo weather codes → human readable
function describeCode(code) {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 49) return 'Foggy';
  if (code <= 59) return 'Drizzle';
  if (code <= 69) return 'Rain';
  if (code <= 79) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return 'Unknown';
}

function buildAlerts(precip, windSpeed, temp, weatherCode) {
  const alerts = [];

  if (weatherCode >= 95) {
    alerts.push({ level: 'high', icon: '⛈️', text: 'Thunderstorm expected — game may be delayed' });
  } else if (weatherCode >= 80) {
    alerts.push({ level: 'high', icon: '🌧️', text: 'Heavy rain expected — possible delay' });
  } else if (weatherCode >= 61 || precip >= 60) {
    alerts.push({ level: 'medium', icon: '🌧️', text: `Rain likely (${precip}% chance) — could affect play` });
  } else if (precip >= 35) {
    alerts.push({ level: 'low', icon: '🌦️', text: `Chance of rain (${precip}%)` });
  }

  if (windSpeed >= 25) {
    alerts.push({ level: 'high', icon: '💨', text: `High winds: ${Math.round(windSpeed)} mph — expect erratic movement` });
  } else if (windSpeed >= 15) {
    alerts.push({ level: 'medium', icon: '💨', text: `Breezy: ${Math.round(windSpeed)} mph — may affect pitch movement` });
  }

  if (temp <= 40) {
    alerts.push({ level: 'medium', icon: '🥶', text: `Very cold: ${Math.round(temp)}°F — grip and spin rate affected` });
  } else if (temp <= 50) {
    alerts.push({ level: 'low', icon: '🌡️', text: `Cold: ${Math.round(temp)}°F — may affect grip` });
  }

  return alerts;
}

export default async function handler(req, res) {
  try {
    const { venue, gameTime } = req.query;
    if (!venue || !gameTime) {
      return res.status(400).json({ error: 'venue and gameTime required' });
    }

    const stadium = findStadium(venue);
    if (!stadium) {
      return res.status(200).json({ found: false, venue });
    }

    // Game time as Date
    const gameDate = new Date(gameTime);
    const dateStr = gameDate.toISOString().slice(0, 10);

    // Open-Meteo — hourly forecast
    const nextDate = new Date(gameDate);
nextDate.setUTCDate(nextDate.getUTCDate() + 1);
const nextDateStr = nextDate.toISOString().slice(0, 10);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${stadium.lat}&longitude=${stadium.lng}&hourly=temperature_2m,precipitation_probability,weathercode,windspeed_10m&temperature_unit=fahrenheit&windspeed_unit=mph&timezone=UTC&start_date=${dateStr}&end_date=${nextDateStr}`;

    const meteoRes = await fetch(url);
    const meteoData = await meteoRes.json();

    if (!meteoData.hourly) {
      return res.status(200).json({ found: true, stadium, error: 'No forecast data' });
    }

    // Find the hour closest to game time
    const hours = meteoData.hourly.time;
const gameTimestamp = gameDate.getTime();
let bestIdx = 0;
let bestDiff = Infinity;
hours.forEach((t, i) => {
  // Compare full timestamps instead of just hours
  const diff = Math.abs(new Date(t).getTime() - gameTimestamp);
  if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
});

    const temp       = meteoData.hourly.temperature_2m[bestIdx];
    const precip     = meteoData.hourly.precipitation_probability[bestIdx];
    const windSpeed  = meteoData.hourly.windspeed_10m[bestIdx];
    const weatherCode= meteoData.hourly.weathercode[bestIdx];

    const alerts = buildAlerts(precip, windSpeed, temp, weatherCode);
    const description = describeCode(weatherCode);

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate');
    return res.status(200).json({
      found: true,
      stadium: stadium.name,
      gameTime: gameDate.toISOString(),
      temp: Math.round(temp),
      precip,
      windSpeed: Math.round(windSpeed),
      weatherCode,
      description,
      alerts,
      hasAlert: alerts.length > 0,
      maxLevel: alerts.some(a => a.level === 'high') ? 'high'
              : alerts.some(a => a.level === 'medium') ? 'medium'
              : alerts.length > 0 ? 'low' : null,
    });
  } catch (err) {
    console.error('Weather error:', err);
    return res.status(200).json({ found: false, error: err.message });
  }
}
