// pages/api/cron/refresh-projections.js
// Scheduled projection pipeline. Replaces on-page-load fetching.
//
// Called hourly by Vercel cron (or external scheduler).
// For each game today, determines which refresh window we're in:
//   T-24h → Mode B (team-level, no lineup)
//   T-6h  → Lines-only check; full refresh if line moved >0.5 or ump assigned
//   T-3h  → Lineup check; if available → Mode A refresh
//   T-2h  → Lineup check (if T-3h missed)
//   T-1h  → Lineup check (if T-3h and T-2h missed)
//
// Cached results: /data/projections/{date}.json
// Refresh state: /data/refresh-state.json

import { fetchSchedule, fetchGameUmp, fetchTeamHittingStats, fetchPitcherSeasonStats, fetchPitcherGameLog, fetchPitcherInfo, fetchPitcherHandednessSplits } from '../../../lib/mlb.js';
import { computeProjectionV2, computeConfidence, isEarlySeasonDate, bvpLambda } from '../../../lib/projection.js';
import MODEL_CONFIG from '../../../lib/model-config.js';
import { computeSameOpponentAnchor } from '../../../lib/same-opponent.js';
import { computeTeamKHotCold } from '../../../lib/team-hot-cold.js';
import { runScout, buildScoutInput } from '../../../lib/llm-scout.js';
import { generateNarrative } from '../../../lib/llm-narrator.js';
import { writeCache, readCache } from '../../../lib/store.js';

const BASE = 'https://statsapi.mlb.com/api/v1';
const ODDS_BASE = 'https://api.the-odds-api.com/v4';

// ── Helpers ─────────────────────────────────────────────────────────────────

function ipToDecimal(ip) {
  if (!ip) return 0;
  const [whole, thirds] = String(ip).split('.').map(Number);
  return (whole || 0) + ((thirds || 0) / 3);
}

function extractBF(stat) {
  if (stat?.battersFaced != null && stat.battersFaced > 0) return stat.battersFaced;
  const outs = ipToDecimal(stat?.inningsPitched ?? 0) * 3;
  return Math.round(outs + (stat?.hits ?? 0) + (stat?.baseOnBalls ?? 0) + (stat?.hitByPitch ?? 0)) || null;
}

function meanBF(games) {
  const vals = games.map(g => extractBF(g.stat)).filter(v => v != null && v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function hoursUntilGame(gameDate) {
  return (new Date(gameDate).getTime() - Date.now()) / (1000 * 60 * 60);
}

function todayStr() {
  // Use ET for date boundary
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

// ── Blob storage keys ───────────────────────────────────────────────────────

function projKey(date) { return `projections/${date}`; }
function stateKey() { return 'refresh-state'; }

// ── Fetch FanDuel K props ──────────────────────────────────────────────────

async function fetchAllProps() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return [];

  try {
    const eventsRes = await fetch(`${ODDS_BASE}/sports/baseball_mlb/events?apiKey=${apiKey}&dateFormat=iso`);
    const events = await eventsRes.json();
    if (!Array.isArray(events)) return [];

    const props = [];
    for (const event of events) {
      try {
        const url = `${ODDS_BASE}/sports/baseball_mlb/events/${event.id}/odds?apiKey=${apiKey}&regions=us&markets=pitcher_strikeouts&oddsFormat=american&dateFormat=iso&bookmakers=fanduel`;
        const oddsRes = await fetch(url);
        const oddsData = await oddsRes.json();
        const fd = oddsData?.bookmakers?.find(b => b.key === 'fanduel');
        const market = fd?.markets?.find(m => m.key === 'pitcher_strikeouts');
        if (!market?.outcomes?.length) continue;

        // Group outcomes by pitcher
        const byPitcher = {};
        for (const o of market.outcomes) {
          const name = o.description;
          if (!byPitcher[name]) byPitcher[name] = {};
          byPitcher[name][o.name.toLowerCase()] = { line: o.point, price: o.price };
        }

        for (const [pitcherName, lines] of Object.entries(byPitcher)) {
          props.push({ pitcherName, lines: { fanduel: lines }, eventId: event.id });
        }
      } catch { /* skip event */ }
    }
    return props;
  } catch (err) {
    console.error('Props fetch error:', err.message);
    return [];
  }
}

// ── Fetch lineup from live feed ────────────────────────────────────────────

async function fetchLineup(gamePk) {
  try {
    const res = await fetch(`${BASE}.1/game/${gamePk}/feed/live`);
    if (!res.ok) return null;
    const data = await res.json();
    const lineups = {};

    for (const side of ['away', 'home']) {
      const teamData = data.liveData?.boxscore?.teams?.[side];
      const battingOrder = teamData?.battingOrder ?? [];
      if (!battingOrder.length) continue;

      lineups[side] = battingOrder.map((id, idx) => {
        const player = teamData.players?.[`ID${id}`];
        return {
          id,
          fullName: player?.person?.fullName ?? `Player ${id}`,
          battingOrder: idx + 1,
          batSide: player?.person?.batSide?.code ?? null,
          position: player?.position?.abbreviation ?? null,
        };
      });
    }

    return Object.keys(lineups).length > 0 ? lineups : null;
  } catch { return null; }
}

// ── Fetch BvP data for lineup vs pitcher ────────────────────────────────────

async function fetchBvP(batterIds, pitcherId, pitcherThrows) {
  const kRateMap = {};
  const yr = new Date().getFullYear();

  await Promise.allSettled(
    batterIds.map(async (batterId) => {
      try {
        // Career BvP
        const bvpUrl = `${BASE}/people/${batterId}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pitcherId}&season=${yr}&season=${yr-1}&season=${yr-2}&season=${yr-3}&season=${yr-4}`;
        const bvpRes = await fetch(bvpUrl);
        const bvpData = await bvpRes.json();
        const bvpSplits = bvpData?.stats?.[0]?.splits ?? [];

        let totalPA = 0, totalK = 0;
        for (const s of bvpSplits) {
          totalPA += s.stat?.plateAppearances ?? 0;
          totalK += s.stat?.strikeOuts ?? 0;
        }

        // Batter season K%
        const seasonUrl = `${BASE}/people/${batterId}/stats?stats=season&group=hitting&season=${yr}`;
        const seasonRes = await fetch(seasonUrl);
        const seasonData = await seasonRes.json();
        const seasonSplits = seasonData?.stats?.[0]?.splits ?? [];
        const seasonStat = seasonSplits[0]?.stat;

        let kPct = MODEL_CONFIG.league_k_pct;
        if (seasonStat?.plateAppearances > 0 && seasonStat?.strikeOuts != null) {
          kPct = seasonStat.strikeOuts / seasonStat.plateAppearances;
        }

        kRateMap[batterId] = {
          kPct,
          bvpKPct: totalPA >= 3 ? totalK / totalPA : null,
          bvpPA: totalPA,
          batSide: null, // filled by lineup data
        };
      } catch {
        kRateMap[batterId] = { kPct: MODEL_CONFIG.league_k_pct, bvpKPct: null, bvpPA: 0 };
      }
    })
  );

  return kRateMap;
}

// ── Fetch team recent Ks (for hot/cold) ────────────────────────────────────

async function fetchTeamRecentKs(teamId, maxGames = 5) {
  try {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 21);
    const fmt = d => d.toISOString().slice(0, 10);

    const schedUrl = `${BASE}/schedule?sportId=1&teamId=${teamId}&startDate=${fmt(start)}&endDate=${fmt(today)}&gameType=R`;
    const schedRes = await fetch(schedUrl);
    const schedData = await schedRes.json();

    const allGames = (schedData.dates ?? []).flatMap(d => d.games ?? []);
    const completed = allGames
      .filter(g => g.status?.abstractGameState === 'Final')
      .sort((a, b) => new Date(b.gameDate) - new Date(a.gameDate))
      .slice(0, maxGames);

    const results = [];
    for (const game of completed) {
      try {
        const boxRes = await fetch(`${BASE}/game/${game.gamePk}/boxscore`);
        if (!boxRes.ok) continue;
        const box = await boxRes.json();

        const isHome = game.teams?.home?.team?.id === teamId;
        const batting = isHome ? box.teams?.home?.teamStats?.batting : box.teams?.away?.teamStats?.batting;
        const actualKs = batting?.strikeOuts;
        if (actualKs == null) continue;

        const oppKey = isHome ? 'away' : 'home';
        const oppPitcherIds = box.teams?.[oppKey]?.pitchers ?? [];
        const starterId = oppPitcherIds[0];
        let kPer9 = 8.0, ip = 5.5;
        if (starterId) {
          const entry = box.teams?.[oppKey]?.players?.[`ID${starterId}`];
          const ps = entry?.stats?.pitching;
          if (ps) {
            const ipDec = ipToDecimal(ps.inningsPitched);
            if (ipDec > 0) {
              ip = ipDec;
              if (ps.strikeOuts != null) kPer9 = (ps.strikeOuts / ipDec) * 9;
            }
          }
        }

        results.push({ actualKs, opposingPitcherKPer9: kPer9, opposingPitcherIP: ip });
      } catch { /* skip game */ }
    }

    return results;
  } catch { return []; }
}

// ── Fetch Savant SwStr% ────────────────────────────────────────────────────

async function fetchSwStr(pitcherId) {
  try {
    // pybaseball endpoint on our Vercel instance
    const res = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/savant?type=pitcher_profile&mlbam_id=${pitcherId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.swstr_pct ?? null;
  } catch { return null; }
}

// ── Full projection pipeline for one game side (one pitcher) ──────────────

async function buildProjection({
  pitcherId, pitcherTeam, opponentTeamId, opponentTeam, venue, gameDate, gamePk,
  isHome, lineup, propsData, umpStrPct, teamsMap, earlySeasonMode,
}) {
  const yr = new Date().getFullYear();

  // Parallel fetch: pitcher data + prior season + splits + savant
  const [info, seasonStats, gameLog, priorGameLog, priorSeasonStats, splits, priorSplits, swstrPct] =
    await Promise.all([
      fetchPitcherInfo(pitcherId),
      fetchPitcherSeasonStats(pitcherId, yr),
      fetchPitcherGameLog(pitcherId, yr),
      fetchPitcherGameLog(pitcherId, yr - 1),
      fetchPitcherSeasonStats(pitcherId, yr - 1),
      fetchPitcherHandednessSplits(pitcherId, yr),
      fetchPitcherHandednessSplits(pitcherId, yr - 1),
      fetchSwStr(pitcherId),
    ]);

  const activeStats = seasonStats?.era != null ? seasonStats : priorSeasonStats;
  const starts2026 = gameLog.length;

  // BF estimates
  const recentBF = meanBF(gameLog.slice(0, 3));
  const seasonBF = meanBF(gameLog);
  const priorBF = meanBF(priorGameLog);

  // K% with shrinkage
  const seasonBF_total = seasonStats?.battersFaced ?? 0;
  const seasonK_total = seasonStats?.strikeOuts ?? 0;
  const pitcherKPctRaw = (seasonBF_total > 0 && seasonK_total != null)
    ? seasonK_total / seasonBF_total : null;

  const priorKPct = (priorSeasonStats?.strikeOuts != null && (priorSeasonStats?.battersFaced ?? 0) > 0)
    ? priorSeasonStats.strikeOuts / priorSeasonStats.battersFaced
    : MODEL_CONFIG.league_k_pct;

  const lambda = seasonBF_total / (seasonBF_total + MODEL_CONFIG.k_rate_shrinkage_pa);
  const pitcherKPct = pitcherKPctRaw != null
    ? lambda * pitcherKPctRaw + (1 - lambda) * priorKPct
    : priorKPct;

  // Handedness splits with shrinkage
  const priorKPctVsL = priorSplits.vsL ?? priorKPct;
  const priorKPctVsR = priorSplits.vsR ?? priorKPct;
  const lambdaVsL = (splits.vsLBF ?? 0) / ((splits.vsLBF ?? 0) + MODEL_CONFIG.k_rate_shrinkage_pa);
  const pitcherKPctVsL = splits.vsL != null ? lambdaVsL * splits.vsL + (1 - lambdaVsL) * priorKPctVsL : priorKPctVsL;
  const lambdaVsR = (splits.vsRBF ?? 0) / ((splits.vsRBF ?? 0) + MODEL_CONFIG.k_rate_shrinkage_pa);
  const pitcherKPctVsR = splits.vsR != null ? lambdaVsR * splits.vsR + (1 - lambdaVsR) * priorKPctVsR : priorKPctVsR;

  const pitcherBBPer9 = activeStats?.walksPer9Inn ? parseFloat(activeStats.walksPer9Inn) : null;

  // Opponent team stats
  const oppTeamStats = teamsMap?.[opponentTeamId] ?? null;
  const teamKFactor = oppTeamStats?.teamKPct != null
    ? oppTeamStats.teamKPct / MODEL_CONFIG.league_k_pct : 1.0;

  // Same-opponent anchor (current season preferred, prior season fallback)
  const vsTeamThisSeason = gameLog.filter(g => g.opponent?.id === opponentTeamId);
  const vsTeamPriorSeason = priorGameLog.filter(g => g.opponent?.id === opponentTeamId);
  const mapVsTeam = (games) => games.map(g => ({
    strikeOuts: g.stat?.strikeOuts ?? 0,
    isHome: g.isHome ?? null,
    date: g.date,
  }));
  const sameOpponent = computeSameOpponentAnchor(
    mapVsTeam(vsTeamThisSeason),
    isHome,
    mapVsTeam(vsTeamPriorSeason)
  );

  // Team hot/cold
  const recentKsData = await fetchTeamRecentKs(opponentTeamId);
  const teamHotCold = computeTeamKHotCold(recentKsData);

  // BvP data if lineup available
  let kRateMap = null;
  const batterSide = lineup?.map(b => b.batSide) ?? [];
  if (lineup?.length) {
    kRateMap = await fetchBvP(lineup.map(b => b.id), pitcherId, info?.pitchHand?.code);
    // Inject batSide from lineup
    for (const b of lineup) {
      if (kRateMap[b.id]) kRateMap[b.id].batSide = b.batSide;
    }
  }

  // FD props
  const normalize = s => s?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const pitcherLastName = normalize(info?.fullName?.split(' ').pop());
  const prop = propsData?.find(p => normalize(p.pitcherName)?.includes(pitcherLastName));
  const fdLines = prop?.lines?.fanduel ?? null;

  // Recent K history
  const combinedLog = [...gameLog, ...priorGameLog];
  const avgKLast5 = combinedLog.slice(0, 5).length
    ? combinedLog.slice(0, 5).reduce((a, g) => a + (g.stat?.strikeOuts ?? 0), 0) / combinedLog.slice(0, 5).length
    : null;

  const avgPitchesLast10 = combinedLog.slice(0, 10).length
    ? combinedLog.slice(0, 10).reduce((a, g) => a + (g.stat?.numberOfPitches ?? 0), 0) / Math.min(combinedLog.slice(0, 10).length, 10)
    : null;

  const approxPitches2026 = (avgPitchesLast10 ?? 90) * (starts2026 ?? 0);

  // LLM Scout
  const scoutInput = buildScoutInput({
    pitcherName: info?.fullName,
    pitcherTeam,
    opponentTeam,
    pitcherAge: info?.currentAge,
    starts2026,
    kPctShrunk: pitcherKPct,
    kPctRaw: pitcherKPctRaw,
    shrinkageBF: seasonBF_total,
    avgKLast5,
    swstrPct,
    venue,
    isEarlySeason: earlySeasonMode,
    lineupAvailable: (lineup?.length ?? 0) > 0,
    fdLine: fdLines?.over?.line ?? fdLines?.under?.line ?? null,
    fdOverOdds: fdLines?.over?.price ?? null,
    fdUnderOdds: fdLines?.under?.price ?? null,
  });
  const scoutResult = await runScout(scoutInput);

  // Run projection
  const v2 = computeProjectionV2({
    recentBF, seasonBF, priorBF,
    starts: starts2026,
    pitchLimitBF: null,
    oppOBP: oppTeamStats?.obp ?? null,
    pitcherBBPer9,
    lineup: lineup?.length > 0 ? lineup : null,
    kRateMap,
    pitcherKPct,
    pitcherKPctVsL,
    pitcherKPctVsR,
    teamKFactor,
    swstrPct,
    pitches2026: approxPitches2026 > 0 ? approxPitches2026 : null,
    strPct: umpStrPct,
    venueName: venue,
    sameOpponentAnchor: sameOpponent,
    teamKHotCold: teamHotCold,
    scoutBFModifier: scoutResult?.bf_modifier ?? null,
    scoutKPctModifier: scoutResult?.k_pct_modifier ?? null,
    fdLines,
    isEarlySeason: earlySeasonMode,
  });

  // Confidence
  const avgBvPLambda = (lineup?.length && kRateMap)
    ? lineup.reduce((sum, b) => sum + bvpLambda(kRateMap[b.id]?.bvpPA ?? 0), 0) / lineup.length
    : 0;

  const confidence = computeConfidence({
    has3PlusStarts: starts2026 >= 3,
    hasLineup: (lineup?.length ?? 0) > 0,
    hasBvP: avgBvPLambda > 0.02,
    hasStuff: swstrPct != null && approxPitches2026 >= 400,
    hasUmpire: umpStrPct != null,
    hasPark: MODEL_CONFIG.park_k_factors[venue] != null,
    hasOdds: fdLines?.over?.line != null || fdLines?.under?.line != null,
  });

  // LLM Narrator
  const fdLine = fdLines?.over?.line ?? fdLines?.under?.line ?? null;
  const narrative = await generateNarrative({
    pitcherName: info?.fullName,
    pitcherTeam,
    opponentTeam,
    kHat: v2.kHat,
    fdLine,
    overOdds: fdLines?.over?.price ?? null,
    underOdds: fdLines?.under?.price ?? null,
    signal: v2.signal,
    edgePct: v2.edge,
    kPctShrunk: pitcherKPct,
    kPctRaw: pitcherKPctRaw,
    shrinkageBF: seasonBF_total,
    sameOpponent,
    teamHotCold,
    scoutFlags: scoutResult?.flags ?? [],
    swstrPct,
    confidenceGrade: confidence.grade,
    confidenceScore: confidence.score,
    avgKLast5,
  });

  // Build recent Ks for sparkline
  const recentKs = combinedLog.slice(0, 10).map(g => g.stat?.strikeOuts ?? 0);

  return {
    pitcherId,
    pitcher: {
      id: pitcherId,
      fullName: info?.fullName,
      throws: info?.pitchHand?.code,
      team: pitcherTeam,
    },
    seasonStats: {
      era: activeStats?.era,
      kPer9: activeStats?.strikeoutsPer9Inn,
      strikeOuts: activeStats?.strikeOuts,
    },
    recentKs,
    avgKLast5,
    projection: v2,
    confidence,
    sameOpponent,
    teamHotCold: teamHotCold ? {
      modifier: teamHotCold.modifier,
      gamesUsed: teamHotCold.gamesUsed,
      ratio: teamHotCold.ratio,
    } : null,
    scout: scoutResult,
    narrative,
    fdLines,
    kShrinkage: {
      lambda: Math.round(lambda * 1000) / 1000,
      raw: pitcherKPctRaw != null ? Math.round(pitcherKPctRaw * 1000) / 1000 : null,
      shrunk: Math.round(pitcherKPct * 1000) / 1000,
      bf: seasonBF_total,
    },
    lineup: lineup ?? null,
  };
}

// ── Main handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Verify cron secret (prevent public access)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const date = todayStr();
  const earlySeasonMode = isEarlySeasonDate(date);
  const forceRefresh = req.query.force === 'true' || req.query.force === '1';

  try {
    // Load state from blob (reset if force refresh)
    const state = forceRefresh ? {} : ((await readCache(stateKey())) || {});
    if (!state[date]) state[date] = {};

    const projections = (await readCache(projKey(date))) || {};

    // Fetch schedule
    const games = await fetchSchedule(date);
    if (!games?.length) {
      return res.status(200).json({ date, message: 'No games today', gamesProcessed: 0 });
    }

    // Fetch shared data (teams + props) once for all games
    const [teamsData, propsData] = await Promise.all([
      fetchTeamHittingStats().catch(() => []),
      fetchAllProps(),
    ]);

    const teamsMap = {};
    for (const t of teamsData) {
      teamsMap[t.teamId] = t;
    }

    let processed = 0;
    let skipped = 0;

    for (const game of games) {
      const gk = `game_${game.gamePk}`;
      if (!state[date][gk]) {
        state[date][gk] = {
          gameTime: game.gameDate,
          t24h: { done: false },
          t6h: { done: false, skipped: false },
          lineup: { done: false, source: null },
          mode: 'pending',
        };
      }

      const gs = state[date][gk];
      const h = hoursUntilGame(game.gameDate);

      // Skip games that already started or are final
      const status = game.status?.detailedState ?? game.status?.abstractGameState;
      if (['In Progress', 'Final', 'Game Over', 'Postponed', 'Cancelled'].includes(status)) {
        skipped++;
        continue;
      }

      // Determine which refresh to run
      let shouldRefresh = false;
      let refreshMode = null;

      if (h <= 24 && !gs.t24h.done) {
        shouldRefresh = true;
        refreshMode = 't24h';
      } else if (h <= 6 && !gs.t6h.done && gs.t24h.done) {
        // Check if lines moved significantly
        const prevLine = projections[gk]?.away?.fdLines?.over?.line ?? projections[gk]?.home?.fdLines?.over?.line;
        // We'll do a lightweight lines check — if no prev data, refresh
        if (!prevLine) {
          shouldRefresh = true;
          refreshMode = 't6h';
        } else {
          // Just mark as done with skip for now — will check line delta after props fetch
          // Actually, we already fetched propsData above. Check delta.
          const normalize = s => s?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
          let newLine = null;
          for (const side of ['away', 'home']) {
            const pitcher = game.teams?.[side]?.probablePitcher;
            if (!pitcher) continue;
            const lastName = normalize(pitcher.fullName?.split(' ').pop());
            const prop = propsData.find(p => normalize(p.pitcherName)?.includes(lastName));
            if (prop?.lines?.fanduel?.over?.line != null) {
              newLine = prop.lines.fanduel.over.line;
              break;
            }
          }
          if (newLine != null && Math.abs(newLine - prevLine) > 0.5) {
            shouldRefresh = true;
            refreshMode = 't6h';
          } else {
            // Check if umpire is newly assigned
            const ump = await fetchGameUmp(game.gamePk).catch(() => null);
            const hadUmp = projections[gk]?.away?.umpStrPct != null || projections[gk]?.home?.umpStrPct != null;
            if (ump && !hadUmp) {
              shouldRefresh = true;
              refreshMode = 't6h';
            } else {
              gs.t6h = { done: true, skipped: true, at: new Date().toISOString() };
              skipped++;
              continue;
            }
          }
        }
      } else if (h <= 3 && !gs.lineup.done) {
        shouldRefresh = true;
        refreshMode = 'lineup';
      } else if (h <= 2 && !gs.lineup.done) {
        shouldRefresh = true;
        refreshMode = 'lineup';
      } else if (h <= 1 && !gs.lineup.done) {
        shouldRefresh = true;
        refreshMode = 'lineup';
      }

      if (!shouldRefresh) {
        skipped++;
        continue;
      }

      // Check lineup availability for lineup-window refreshes
      let lineups = null;
      if (refreshMode === 'lineup' || refreshMode === 't6h' || refreshMode === 't24h') {
        lineups = await fetchLineup(game.gamePk);
      }

      // For lineup-window refreshes, skip if no lineup yet
      if (refreshMode === 'lineup' && !lineups) {
        skipped++;
        continue;
      }

      // Fetch ump
      const ump = await fetchGameUmp(game.gamePk).catch(() => null);

      // Process each side (away pitcher, home pitcher)
      const gameProjection = {};

      for (const side of ['away', 'home']) {
        const team = game.teams?.[side];
        const pitcher = team?.probablePitcher;
        if (!pitcher?.id) continue;

        const oppSide = side === 'away' ? 'home' : 'away';
        const oppTeam = game.teams?.[oppSide];
        const lineup = lineups?.[oppSide] ?? null; // opposing batters

        // Look up ump STR%
        let umpStrPct = null;
        if (ump?.strPct != null) umpStrPct = ump.strPct;

        try {
          const result = await buildProjection({
            pitcherId: pitcher.id,
            pitcherTeam: team.team?.name ?? team.team?.abbreviation,
            opponentTeamId: oppTeam?.team?.id,
            opponentTeam: oppTeam?.team?.name ?? oppTeam?.team?.abbreviation,
            venue: game.venue?.name,
            gameDate: game.gameDate,
            gamePk: game.gamePk,
            isHome: side === 'home',
            lineup,
            propsData,
            umpStrPct,
            teamsMap,
            earlySeasonMode,
          });

          gameProjection[side] = result;
        } catch (err) {
          console.error(`Error processing ${pitcher.fullName} (${game.gamePk} ${side}):`, err.message);
          gameProjection[side] = { error: err.message, pitcherId: pitcher.id };
        }
      }

      // Store
      projections[gk] = {
        gamePk: game.gamePk,
        gameDate: game.gameDate,
        venue: game.venue?.name,
        status: status,
        lastRefresh: new Date().toISOString(),
        refreshMode,
        mode: lineups ? 'A' : 'B',
        ump: ump ?? null,
        away: gameProjection.away ?? null,
        home: gameProjection.home ?? null,
        awayTeam: { id: game.teams?.away?.team?.id, name: game.teams?.away?.team?.name, abbr: game.teams?.away?.team?.abbreviation },
        homeTeam: { id: game.teams?.home?.team?.id, name: game.teams?.home?.team?.name, abbr: game.teams?.home?.team?.abbreviation },
      };

      // Update state
      if (refreshMode === 't24h') {
        gs.t24h = { done: true, at: new Date().toISOString() };
      } else if (refreshMode === 't6h') {
        gs.t6h = { done: true, at: new Date().toISOString() };
      } else if (refreshMode === 'lineup') {
        gs.lineup = { done: true, at: new Date().toISOString(), source: `t${Math.ceil(h)}h` };
      }

      if (lineups) gs.mode = 'A';
      else if (gs.mode === 'pending') gs.mode = 'B';

      processed++;
    }

    // Save to blob
    await writeCache(stateKey(), state);
    await writeCache(projKey(date), projections);

    return res.status(200).json({
      date,
      totalGames: games.length,
      processed,
      skipped,
      earlySeasonMode,
    });

  } catch (err) {
    console.error('Cron refresh error:', err);
    return res.status(500).json({ error: err.message });
  }
}

export const config = {
  maxDuration: 300, // 5 min max for Vercel Pro
};
