// lib/model-config.js
// All tunable parameters for The Whiff v2 model.
// Edit here — never hardcode magic numbers in calculation functions.

const MODEL_CONFIG = {
  // ── BF estimate weights ──────────────────────────────────────────────────────
  bf_w_recent: 0.50,        // last 3 starts
  bf_w_season: 0.30,        // full season avg (current year)
  bf_w_prior:  0.20,        // prior season avg

  // Early-season (<3 starts): shift weight heavily to prior
  bf_w_prior_early: 0.60,

  // Relative batting order PA weights (positions 1–9, sum ≈ 8.97)
  bf_position_weights: [1.12, 1.07, 1.04, 1.02, 0.99, 0.97, 0.94, 0.92, 0.90],

  // ── League constants ─────────────────────────────────────────────────────────
  league_k_pct:   0.222,    // MLB-wide K rate
  league_avg_obp: 0.315,    // MLB-wide OBP
  league_swstr:   0.105,    // MLB-wide swinging strike rate
  league_str_pct: 0.64,     // MLB-wide called strike % (umpire baseline)

  // ── Opponent OBP modifier ────────────────────────────────────────────────────
  opp_obp_scale: 0.5,       // 1.0 + 0.5 × (opp_OBP − 0.315)

  // ── Walk rate drag ───────────────────────────────────────────────────────────
  bb_drag_threshold: 4.5,   // BB/9 above this triggers drag
  bb_drag_factor:    0.97,

  // ── BvP shrinkage ────────────────────────────────────────────────────────────
  bvp_shrinkage_constant: 50,  // λ = PA_BvP / (PA_BvP + 50)

  // ── SwStr% adjustment ────────────────────────────────────────────────────────
  stuff_beta:              3.0,  // each 1% above avg ≈ +0.03 K
  stuff_shrinkage_pitches: 400,  // r = pitches / (pitches + 400)

  // ── Umpire zone adjustment ───────────────────────────────────────────────────
  ump_gamma:   8.0,   // each 1% above 64% ≈ +0.08 K
  ump_dampen:  0.6,   // ABS era reduction factor
  ump_cap_lo: -0.4,
  ump_cap_hi:  0.6,

  // ── Signal / edge thresholds ─────────────────────────────────────────────────
  min_edge:        0.05,    // normal season: 5% edge required
  min_edge_early:  0.08,    // early season: 8% edge required
  early_season_weeks: 3,

  // ── Early-season K% shrinkage ────────────────────────────────────────────────
  k_rate_shrinkage_pa: 150, // r = PA_2026 / (PA_2026 + 150) for K% blending

  // ── Same-opponent anchor ──────────────────────────────────────────────────────
  same_opponent_base_weight:    0.20, // weight with 1 prior matchup
  same_opponent_max_weight:     0.35, // weight cap (2+ prior matchups)
  same_opponent_weight_step:    0.10, // added per additional matchup beyond 1
  same_opponent_recency_decay:  0.85, // per-game recency multiplier
  same_opponent_venue_match:    1.0,  // multiplier when venue matches upcoming game
  same_opponent_venue_mismatch: 0.6,  // multiplier when venue differs

  // ── Team K hot/cold modifier ─────────────────────────────────────────────────
  hot_cold_scale_factor: 3.5, // (ratio − 1.0) × scale → raw modifier
  hot_cold_cap:          0.8, // absolute cap on modifier (±)
  hot_cold_min_games:    3,   // minimum games required to apply modifier

  // ── LLM scout constraints ────────────────────────────────────────────────────
  scout_bf_modifier_max:   5,    // max absolute bf_modifier from scout
  scout_kpct_modifier_max: 0.05, // max absolute k_pct_modifier from scout

  // ── LLM narrator config ───────────────────────────────────────────────────────
  narrator_model: 'claude-sonnet-4-6', // Anthropic model for narrator
  scout_model:    'gemini-2.0-flash',  // Google AI model for scout

  // ── Confidence scoring weights ────────────────────────────────────────────────
  confidence_weights: {
    starts_current: 20,   // 3+ starts in current season
    lineup:         25,   // confirmed lineup available
    bvp:            15,   // BvP data with avg λ > 0.15
    stuff:          15,   // SwStr%/CSW% (400+ pitches in sample)
    umpire:         10,   // umpire assignment known
    park:            5,   // park factor available
    odds:           10,   // FanDuel line posted
  },

  // ── Park K factors ────────────────────────────────────────────────────────────
  // Historical K-rate multipliers. Source: FanGraphs. Update annually.
  park_k_factors: {
    'Coors Field':              0.92,
    'Petco Park':               1.05,
    'T-Mobile Park':            1.04,
    'Tropicana Field':          1.04,
    'Globe Life Field':         1.03,
    'Nationals Park':           1.03,
    'LoanDepot Park':           1.02,
    'Truist Park':              1.02,
    'American Family Field':    1.02,
    'Wrigley Field':            1.01,
    'Fenway Park':              1.01,
    'Great American Ball Park': 1.01,
    'Oracle Park':              1.00,
    'PNC Park':                 1.00,
    'Yankee Stadium':           1.00,
    'Camden Yards':             0.99,
    'Dodger Stadium':           0.99,
    'Kauffman Stadium':         0.99,
    'Busch Stadium':            0.99,
    'Guaranteed Rate Field':    0.98,
    'Chase Field':              0.98,
    'Progressive Field':        0.98,
    'Citizens Bank Park':       0.97,
    'Minute Maid Park':         0.97,
    'Daikin Park':              0.97,
    'Angel Stadium':            0.97,
    'Comerica Park':            0.96,
    'Target Field':             0.96,
    'RingCentral Coliseum':     0.96,
    'Sahlen Field':             0.96,
    'Citi Field':               1.01,
    'Rogers Centre':            0.99,
    'Sutter Health Park':       0.97, // A's temp Sacramento
    'George M. Steinbrenner Field': 0.98, // Spring training fallback
    'loanDepot park':           1.02, // alternate casing
  },
};

export default MODEL_CONFIG;
