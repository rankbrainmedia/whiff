// lib/mlb.js
// All calls go through here — clean wrapper around MLB Stats API

const BASE = 'https://statsapi.mlb.com/api/v1';

export async function fetchSchedule(date) {
  // date: 'YYYY-MM-DD' or defaults to today
  const d = date || new Date().toISOString().slice(0, 10);
  const url = `${BASE}/schedule?sportId=1&date=${d}&hydrate=probablePitcher,team,venue,linescore,officials&language=en`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`MLB schedule fetch failed: ${res.status}`);
  const data = await res.json();
  return data.dates?.[0]?.games ?? [];
}

export async function fetchPitcherGameLog(pitcherId, season) {
  const yr = season || new Date().getFullYear();
  const url = `${BASE}/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${yr}&limit=30`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pitcher game log fetch failed: ${res.status}`);
  const data = await res.json();
  return data.stats?.[0]?.splits ?? [];
}

export async function fetchPitcherSeasonStats(pitcherId, season) {
  const yr = season || new Date().getFullYear();
  const url = `${BASE}/people/${pitcherId}/stats?stats=season&group=pitching&season=${yr}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pitcher season stats fetch failed: ${res.status}`);
  const data = await res.json();
  return data.stats?.[0]?.splits?.[0]?.stat ?? {};
}

export async function fetchPitcherVsTeam(pitcherId, opposingTeamId, season) {
  // Pull game log and filter by opponent team
  const log = await fetchPitcherGameLog(pitcherId, season);
  return log.filter(g => g.opponent?.id === opposingTeamId);
}

export async function fetchTeamHittingStats(season) {
  const yr = season || new Date().getFullYear();
  const url = `${BASE}/teams/stats?stats=season&group=hitting&season=${yr}&sportId=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Team stats fetch failed: ${res.status}`);
  const data = await res.json();
  const splits = data.stats?.[0]?.splits ?? [];

  // Sort by strikeouts descending (rank 1 = most Ks = easiest for pitcher)
  const sorted = [...splits]
    .filter(s => s.team?.id)
    .sort((a, b) => (b.stat?.strikeOuts ?? 0) - (a.stat?.strikeOuts ?? 0));

  return sorted.map((s, i) => ({
    teamId: s.team.id,
    teamName: s.team.name,
    abbreviation: s.team.abbreviation,
    rank: i + 1,
    strikeOuts: s.stat?.strikeOuts ?? 0,
    gamesPlayed: s.stat?.gamesPlayed ?? 1,
    kPerGame: (s.stat?.strikeOuts ?? 0) / (s.stat?.gamesPlayed ?? 1),
    kPct: s.stat?.strikeoutsPer9Inn ?? null,
  }));
}

export async function fetchGameUmp(gamePk) {
  try {
    const url = `${BASE}.1/game/${gamePk}/feed/live`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const officials = data?.liveData?.boxscore?.officials ?? [];
    const hp = officials.find(o => o.officialType === 'Home Plate');
    if (!hp) return null;
    return {
      name: hp.official?.fullName,
      id: hp.official?.id,
    };
  } catch {
    return null;
  }
}

export async function fetchPitcherInfo(pitcherId) {
  const url = `${BASE}/people/${pitcherId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pitcher info fetch failed: ${res.status}`);
  const data = await res.json();
  return data.people?.[0] ?? {};
}