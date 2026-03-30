// lib/projection.js
// Core v2 projection math for The Whiff.
// Pure functions — no side effects, no API calls, no React.
// Can be imported from both API routes (server) and pages (client).

import MODEL_CONFIG from './model-config.js';

// ── Poisson helpers ───────────────────────────────────────────────────────────

// P(X <= k) where X ~ Poisson(lambda)
function poissonCDF(lambda, k) {
  if (lambda <= 0) return k >= 0 ? 1 : 0;
  let sum = 0;
  let term = Math.exp(-lambda);
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += term;
    term *= lambda / (i + 1);
  }
  return Math.min(1, sum);
}

// P(K > line) — handles half-lines and whole lines
export function probOver(kHat, line) {
  if (!kHat || line == null) return null;
  // For 5.5: P(K >= 6) = 1 - P(K <= 5)
  // For 6.0: P(K > 6) = 1 - P(K <= 6)
  const threshold = Math.floor(line);
  return 1 - poissonCDF(kHat, threshold);
}

// ── Odds conversion ───────────────────────────────────────────────────────────

// American odds → implied probability (no vig removed)
export function impliedProb(odds) {
  if (odds == null) return null;
  if (odds < 0) return Math.abs(odds) / (Math.abs(odds) + 100);
  return 100 / (odds + 100);
}

// ── log5 formula ──────────────────────────────────────────────────────────────
// Matchup K probability from batter K%, pitcher K%, league K%
// Source: Bill James log5. Adjusts for league baseline.
export function log5(kb, kp, kl) {
  if (kb == null || kp == null || !kl || kl >= 1 || kl <= 0) return kp ?? 0.222;
  const num = (kb * kp) / kl;
  const den = num + ((1 - kb) * (1 - kp)) / (1 - kl);
  if (den === 0) return kp;
  return Math.max(0, Math.min(1, num / den));
}

// ── BvP shrinkage ─────────────────────────────────────────────────────────────
// λ = PA_BvP / (PA_BvP + shrinkage_constant)
export function bvpLambda(pa) {
  if (!pa || pa <= 0) return 0;
  return pa / (pa + MODEL_CONFIG.bvp_shrinkage_constant);
}

// Shrunk BvP-adjusted K rate: p_base + λ × (bvpKPct − p_base)
export function bvpAdjusted(pBase, bvpKPct, bvpPA) {
  if (bvpKPct == null || !bvpPA) return pBase;
  const lambda = bvpLambda(bvpPA);
  return pBase + lambda * (bvpKPct - pBase);
}

// ── Stage 1: Expected batters faced ──────────────────────────────────────────
export function computeBF({
  recentBF,       // mean BF last 3 starts (current season)
  seasonBF,       // season avg BF (current season)
  priorBF,        // prior season avg BF
  starts,         // number of current-season starts
  pitchLimitBF,   // max BF from pitch limit (null = no limit)
  oppOBP,         // opposing team OBP (null = skip adjustment)
  pitcherBBPer9,  // pitcher BB/9 (null = skip drag)
}) {
  const cfg = MODEL_CONFIG;

  // Weights — shift toward prior in early season
  let w1, w2, w3;
  if (!starts || starts < 3) {
    if (starts >= 1 && recentBF != null) {
      w1 = 0.25; w2 = 0.15; w3 = 0.60;
    } else {
      w1 = 0; w2 = 0; w3 = 1.0;
    }
  } else {
    w1 = cfg.bf_w_recent;
    w2 = cfg.bf_w_season;
    w3 = cfg.bf_w_prior;
  }

  // Fallback chain for each component
  const r = recentBF ?? seasonBF ?? priorBF ?? 24;
  const s = seasonBF ?? priorBF ?? r;
  const p = priorBF ?? s;

  let bf = w1 * r + w2 * s + w3 * p;

  // Pitch limit cap
  if (pitchLimitBF != null && pitchLimitBF > 0) {
    bf = Math.min(bf, pitchLimitBF);
  }

  // Opponent OBP factor: high-OBP lineups extend innings slightly
  if (oppOBP != null) {
    const obpFactor = 1.0 + cfg.opp_obp_scale * (oppOBP - cfg.league_avg_obp);
    bf *= obpFactor;
  }

  // Walk rate drag: extreme BB% pitchers get shorter leash
  if (pitcherBBPer9 != null && pitcherBBPer9 > cfg.bb_drag_threshold) {
    bf *= cfg.bb_drag_factor;
  }

  return Math.max(9, bf); // floor at 9 BF (3 IP)
}

// ── Stage 2 Mode A: Lineup-based K projection ─────────────────────────────────
// Uses log5 per batter + BvP shrinkage, scaled by starter BF allocation
export function computeLineupExpectedK({
  lineup,          // [{id, battingOrder, batSide?}, ...]
  kRateMap,        // {batterId: {kPct, bvpKPct, bvpPA, batSide, ...}}
  pitcherKPct,     // pitcher overall K%
  pitcherKPctVsL,  // pitcher K% vs LHB (null if unavailable)
  pitcherKPctVsR,  // pitcher K% vs RHB (null if unavailable)
  bfHat,           // expected batters faced (from Stage 1)
}) {
  if (!lineup?.length || !kRateMap || !bfHat) return null;

  const cfg = MODEL_CONFIG;
  const kl = cfg.league_k_pct;
  const posWeights = cfg.bf_position_weights;
  const weightSum = posWeights.reduce((a, b) => a + b, 0);

  let totalExpectedK = 0;

  for (const batter of lineup) {
    const idx = (batter.battingOrder ?? 1) - 1;
    const w = posWeights[Math.min(idx, posWeights.length - 1)] ?? posWeights[8];
    const paVsSP = bfHat * (w / weightSum);

    const bvp = kRateMap[batter.id];
    const kb = bvp?.kPct ?? kl;

    // Pick pitcher split matching batter's handedness
    const batterHand = bvp?.batSide ?? batter.batSide ?? null;
    let kp = pitcherKPct ?? cfg.league_k_pct;
    if (batterHand === 'L' && pitcherKPctVsL != null) kp = pitcherKPctVsL;
    else if (batterHand === 'R' && pitcherKPctVsR != null) kp = pitcherKPctVsR;

    // Step 1: log5 base rate
    const pBase = log5(kb, kp, kl);

    // Step 2: BvP residual (shrunk)
    const pHat = bvpAdjusted(pBase, bvp?.bvpKPct, bvp?.bvpPA);

    totalExpectedK += pHat * paVsSP;
  }

  return totalExpectedK;
}

// ── Stage 2 Mode B: Team-level fallback ───────────────────────────────────────
export function computeTeamLevelK(pitcherKPct, teamKFactor, bfHat) {
  const kPct = pitcherKPct ?? MODEL_CONFIG.league_k_pct;
  const factor = teamKFactor ?? 1.0;
  return bfHat * kPct * factor;
}

// ── Stage 3a: SwStr% adjustment (continuous, shrunk) ─────────────────────────
export function computeStuffAdj(swstrPct, pitches) {
  if (swstrPct == null) return 0;
  const cfg = MODEL_CONFIG;
  const metric = swstrPct / 100; // percent → decimal
  const r = pitches != null
    ? pitches / (pitches + cfg.stuff_shrinkage_pitches)
    : 0;
  return cfg.stuff_beta * (metric - cfg.league_swstr) * r;
}

// ── Stage 3b: Umpire zone adjustment (continuous, dampened, capped) ──────────
export function computeUmpAdj(strPct) {
  if (strPct == null) return 0;
  const cfg = MODEL_CONFIG;
  const raw = cfg.ump_gamma * (strPct / 100 - cfg.league_str_pct) * cfg.ump_dampen;
  return Math.max(cfg.ump_cap_lo, Math.min(cfg.ump_cap_hi, raw));
}

// ── Stage 3c: Park factor adjustment ─────────────────────────────────────────
export function computeParkAdj(kHatRaw, venueName) {
  const factor = MODEL_CONFIG.park_k_factors[venueName] ?? 1.0;
  return kHatRaw * (factor - 1.0);
}

// ── Confidence scoring ────────────────────────────────────────────────────────
export function computeConfidence({
  has3PlusStarts,  // boolean
  hasLineup,       // boolean
  hasBvP,          // boolean: avg λ across batters > 0.15
  hasStuff,        // boolean: SwStr% with 400+ pitches
  hasUmpire,       // boolean
  hasPark,         // boolean
  hasOdds,         // boolean
}) {
  const w = MODEL_CONFIG.confidence_weights;
  let score = 0;

  if (has3PlusStarts) score += w.starts_current;
  if (hasLineup)      score += w.lineup;
  if (hasBvP)         score += w.bvp;
  if (hasStuff)       score += w.stuff;
  if (hasUmpire)      score += w.umpire;
  if (hasPark)        score += w.park;
  if (hasOdds)        score += w.odds;

  let grade;
  if (score >= 80)      grade = 'A';
  else if (score >= 55) grade = 'B';
  else if (score >= 30) grade = 'C';
  else                  grade = 'D';

  return { score, grade };
}

// ── Early-season detection ────────────────────────────────────────────────────
// Returns true if we are within the first N weeks of the MLB season.
// Uses March 20 as a conservative season-start anchor.
export function isEarlySeasonDate(dateStr) {
  const cfg = MODEL_CONFIG;
  const date = dateStr ? new Date(dateStr) : new Date();
  const year = date.getFullYear();
  // MLB season typically opens late March — use March 20 as anchor
  const seasonOpen = new Date(`${year}-03-20`);
  const earlyEnd = new Date(seasonOpen);
  earlyEnd.setDate(earlyEnd.getDate() + cfg.early_season_weeks * 7);
  return date >= seasonOpen && date <= earlyEnd;
}

// ── Full v2 projection ────────────────────────────────────────────────────────
export function computeProjectionV2({
  // Stage 1
  recentBF, seasonBF, priorBF, starts,
  pitchLimitBF, oppOBP, pitcherBBPer9,

  // Stage 2
  lineup, kRateMap,
  pitcherKPct, pitcherKPctVsL, pitcherKPctVsR,
  teamKFactor,

  // Stage 3
  swstrPct, pitches2026,
  strPct,       // umpire STR%
  venueName,

  // Signal
  fdLines,
  isEarlySeason,
}) {
  const cfg = MODEL_CONFIG;

  // Stage 1: BF̂
  const bfHat = computeBF({
    recentBF, seasonBF, priorBF, starts,
    pitchLimitBF, oppOBP, pitcherBBPer9,
  });

  // Stage 2: K̂_raw
  let kHatRaw;
  let mode;

  if (lineup?.length && kRateMap && Object.keys(kRateMap).length > 0) {
    mode = 'A';
    const lineupK = computeLineupExpectedK({
      lineup, kRateMap,
      pitcherKPct, pitcherKPctVsL, pitcherKPctVsR,
      bfHat,
    });
    kHatRaw = lineupK ?? computeTeamLevelK(pitcherKPct, teamKFactor, bfHat);
  } else {
    mode = 'B';
    kHatRaw = computeTeamLevelK(pitcherKPct, teamKFactor, bfHat);
  }

  // Stage 3: Adjustments
  const dStuff = computeStuffAdj(swstrPct, pitches2026);
  const dUmp   = computeUmpAdj(strPct);
  const dPark  = computeParkAdj(kHatRaw, venueName);

  const kHat = kHatRaw + dStuff + dUmp + dPark;
  const kHatDisplay = Math.round(kHat * 10) / 10;

  // Signal generation (price-aware)
  const line      = fdLines?.over?.line ?? fdLines?.under?.line ?? null;
  const overOdds  = fdLines?.over?.price ?? null;
  const underOdds = fdLines?.under?.price ?? null;

  let signal = 'NOLINE';
  let edge = null;
  let pOver = null;
  let impliedOver = null;

  if (line != null) {
    pOver = probOver(kHat, line);
    impliedOver = overOdds != null ? impliedProb(overOdds) : 0.5;
    edge = pOver - impliedOver;

    const minEdge = isEarlySeason ? cfg.min_edge_early : cfg.min_edge;
    if (edge > minEdge)       signal = 'OVER';
    else if (edge < -minEdge) signal = 'UNDER';
    else                      signal = 'NEUTRAL';
  }

  return {
    kHat: kHatDisplay,
    kHatRaw: Math.round(kHatRaw * 10) / 10,
    bfHat: Math.round(bfHat * 10) / 10,
    mode,
    dStuff: Math.round(dStuff * 100) / 100,
    dUmp:   Math.round(dUmp   * 100) / 100,
    dPark:  Math.round(dPark  * 100) / 100,
    signal,
    edge:        edge        != null ? Math.round(edge * 1000) / 1000 : null,
    pOver:       pOver       != null ? Math.round(pOver * 1000) / 1000 : null,
    impliedOver: impliedOver != null ? Math.round(impliedOver * 1000) / 1000 : null,
    line,
    overOdds,
    underOdds,
  };
}
