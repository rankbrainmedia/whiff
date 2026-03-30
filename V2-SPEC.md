# THE WHIFF v2 — PITCHER STRIKEOUT PROJECTION ALGORITHM

Version 2.0 Spec | March 2026

## ARCHITECTURAL CHANGE FROM v1

v1 core: `K̂ = K̄₅ + δ_opp + δ_swstr + δ_ump` (patched average)
v2 core: `K̂ = E[BF_sp] × E[K%]` (structural decomposition)

The fundamental shift: separate **how many batters the starter will face** from
**how likely each batter is to strike out**. This eliminates the double-counting
problem in v1 where K̄₅ already baked in workload, opponent quality, and
context — then modifiers adjusted for those same factors again.

---

## STAGE 1: EXPECTED BATTERS FACED — E[BF_sp]

The starter's expected batters faced governs the scale of the entire projection.
A 30% K-rate pitcher facing 21 batters projects to 6.3 K. The same pitcher
facing 28 batters projects to 8.4 K. Workload is not a modifier — it's half
the model.

### Primary estimate

```
BF̂ = w₁ × BF̄_recent + w₂ × BF̄_season + w₃ × BF_prior
```

Where:
- `BF̄_recent` = mean batters faced across last 3 starts (2026, backfilled with late 2025)
- `BF̄_season` = mean batters faced across all 2026 starts (when available)
- `BF_prior` = preseason projection or 2025 full-season BF/start average
- Weights: `w₁ = 0.50, w₂ = 0.30, w₃ = 0.20` (shift toward w₁/w₂ as 2026 sample grows)

### Modifiers to BF̂

```
BF̂_adj = BF̂ × leash_factor × opp_obp_factor
```

**Leash factor** (pitch count / manager tendency):
- If pitcher is on a known pitch limit (returning from IL, early ramp-up): cap BF̂ at
  `pitch_limit / pitches_per_BF_career`. Example: 75-pitch limit, 4.1 pitches/BF → max ~18 BF.
- If no known limit, leash_factor = 1.0.

**Opponent OBP factor:**
- High-OBP lineups extend innings and increase BF even in shorter outings.
- `opp_obp_factor = 1.0 + 0.5 × (opp_OBP - 0.315)` where 0.315 ≈ league avg OBP.
- Example: .340 OBP team → factor = 1.0125 (small but real over 24+ BF).

**Walk rate drag:**
- Pitchers with high BB% face more batters per inning but also get pulled earlier.
- Net effect is roughly neutral on BF for moderate BB%, but extreme BB% (>4.5/9)
  should apply a `× 0.97` drag to BF̂ (shorter leash outweighs extra baserunners).

### Early-season mode (first 3 weeks)

When fewer than 3 starts exist in 2026:
- `BF̂ = BF_prior` (2025 full season or projection system)
- Apply leash_factor only if explicitly known
- Flag confidence as reduced

---

## STAGE 2: EXPECTED K RATE — E[K%]

This is the per-batter strikeout probability, computed differently depending on
whether a confirmed lineup is available.

### Mode A: Lineup Available (preferred)

For each batter i in positions 1-9:

#### Step 1: Base rate via log5

```
p_base,i = log5(K%_batter,i, K%_pitcher, K%_league)
```

Where log5 is:
```
p_base = (Kb × Kp / Kl) / (Kb × Kp / Kl + (1 - Kb) × (1 - Kp) / (1 - Kl))
```

- `Kb` = batter's K% vs pitcher handedness (2026, falling back to 2025 if <50 PA in 2026)
- `Kp` = pitcher's K% vs batter handedness (2026, falling back to 2025 if <50 PA in 2026)
- `Kl` = league average K% ≈ 0.222

This produces a matchup-neutral expected K probability from the two individual
rates, adjusted for the league baseline. No raw BvP at this stage.

#### Step 2: BvP residual adjustment (shrunk)

```
p̂_i = p_base,i + λ_i × (K%_BvP,i - p_base,i)
```

Where:
```
λ_i = PA_BvP / (PA_BvP + 50)
```

- At 3 PA: λ = 0.057 → BvP shifts the base rate by ~6%. Basically noise. Good.
- At 15 PA: λ = 0.231 → starting to have some pull.
- At 50 PA: λ = 0.500 → equal weight. Rare but meaningful when it exists.
- At 100+ PA: λ → 0.67+ → BvP dominates. These are real rivalries.

The shrinkage constant of 50 is tunable. Start there, validate after 6+ weeks.

If no BvP data exists: `p̂_i = p_base,i` (no adjustment, log5 stands alone).

#### Step 3: Allocate BF across lineup

Instead of fixed EPAs that sum to 34.3 (full-game total), allocate the
**starter's** expected BF across the 9 lineup spots proportionally:

```
PA_i_vs_SP = BF̂_adj × w_i / Σw
```

Lineup position weights (relative, not absolute):
```
Position 1: w = 1.12
Position 2: w = 1.07
Position 3: w = 1.04
Position 4: w = 1.02
Position 5: w = 0.99
Position 6: w = 0.97
Position 7: w = 0.94
Position 8: w = 0.92
Position 9: w = 0.90
```

These sum to ~8.97. For BF̂ = 25:
- Position 1 gets 25 × 1.12/8.97 = 3.12 PA vs starter
- Position 9 gets 25 × 0.90/8.97 = 2.51 PA vs starter

This fixes the v1 scaling bug where K_lineup was calibrated to full-game PAs.

#### Step 4: Lineup K projection

```
K_lineup = Σ(i=1 to 9) p̂_i × PA_i_vs_SP
```

### Mode B: No Lineup (team-level fallback)

When no confirmed lineup is available:

```
E[K%] = K%_pitcher_vs_hand_blend × team_K%_factor
```

Where:
- `K%_pitcher_vs_hand_blend` = pitcher's overall K%, weighted toward the split
  matching the opposing team's typical lineup handedness balance
- `team_K%_factor = team_K% / league_K%` (ratio, not rank — preserves magnitude)

Then:
```
K̂ = BF̂_adj × E[K%]
```

**Important:** Use K% (rate), not K totals or team K rank. Rank throws away the
gap between positions and is confounded by PA volume.

---

## STAGE 3: ADJUSTMENTS (small, continuous, shrunk)

These are secondary modifiers applied to the final K̂. Each is continuous (no
buckets) and shrunk by sample size where applicable.

### SwStr% / CSW% adjustment

```
δ_stuff = β × (metric - league_avg) × r
```

Where:
- `metric` = pitcher's SwStr% (preferred) or CSW% (alternative — more stable in small samples)
- `league_avg` ≈ 0.105 for SwStr%, ≈ 0.29 for CSW%
- `β` = scaling coefficient. Start with β = 3.0 for SwStr% (i.e., each 1% above avg ≈ +0.03 K).
  Tune empirically.
- `r = pitches_2026 / (pitches_2026 + 400)` — shrinkage toward zero based on 2026 pitch sample.
  At 400 pitches (~3-4 starts), r = 0.50. At 100 pitches (1 start), r = 0.20.
  Early season, this adjustment is appropriately small.

If no Statcast data available: δ_stuff = 0.

### Umpire zone adjustment

```
δ_ump = γ × (STR% - 0.64) × dampen
```

Where:
- `γ` = scaling coefficient. Start with γ = 8.0 (i.e., each 1% above league avg ≈ +0.08 K).
- `dampen` = 0.6 for 2026 season (reduced from what would be ~1.0 pre-ABS).
  The ABS Challenge System compresses umpire zone variance. Revisit after
  backtesting 2026 data — if umpire signal is still strong, increase dampen.
- Cap: δ_ump ∈ [-0.4, +0.6]

If umpire unknown: δ_ump = 0.

### Park factor

```
δ_park = K̂ × (park_K_factor - 1.0)
```

Where `park_K_factor` is the park's K-rate multiplier from historical data:
- Coors Field: ~0.92 (suppresses Ks)
- Petco Park: ~1.05 (boosts Ks)
- Most parks: 0.97-1.03

Source: FanGraphs park factors or Baseball Reference. Update annually.

If park factor unavailable: δ_park = 0.

### Weather (optional, small)

Extreme cold (<45°F) or extreme heat (>95°F) may slightly affect K rates
(cold = less bat speed = slightly more Ks, heat = fatigue = mixed). This is
a micro-signal. Include only if you have evidence it moves the needle after
backtesting. Start with δ_weather = 0 and revisit.

---

## FINAL PROJECTION

```
K̂_raw = K_lineup (Mode A) or BF̂_adj × E[K%] (Mode B)
K̂ = K̂_raw + δ_stuff + δ_ump + δ_park + δ_weather
```

Round to one decimal for display. Keep full precision internally for signal
generation.

---

## SIGNAL GENERATION: PRICE-AWARE

v1 compared K̂ to the line with a fixed ±0.4 neutral zone.
v2 accounts for the price (odds) to find actual expected value.

### Step 1: Estimate P(Over L)

Approximate the probability that actual Ks exceed the line L.

Simple approach (Poisson approximation):
```
P(Over L) = 1 - P(K ≤ L) where K ~ Poisson(K̂)
```

Strikeouts are reasonably Poisson-distributed for a single game. This gives you
a probability, not just a point estimate.

For half-lines (e.g., 5.5): `P(Over 5.5) = P(K ≥ 6) = 1 - CDF(5, K̂)`
For whole-lines (e.g., 6.0): handle push rules per sportsbook.

### Step 2: Convert odds to implied probability

```
implied_over = |odds| / (|odds| + 100)     if odds negative (favorite)
implied_over = 100 / (odds + 100)           if odds positive (underdog)
```

Example: Over 5.5 at -130 → implied = 130/230 = 56.5%

### Step 3: Edge calculation

```
edge = P(Over L) - implied_over
```

### Step 4: Signal

```
edge > +0.05 → OVER signal (5%+ edge)
edge < -0.05 → UNDER signal (5%+ edge on under side)
|edge| ≤ 0.05 → NEUTRAL
```

The 5% threshold is your minimum edge to bet. This replaces the fixed ±0.4 K
neutral zone from v1. It's better because it accounts for odds — a small K
edge at plus-money is worth more than a large K edge at -200.

### Kelly criterion (optional, advanced)

For bankroll sizing:
```
kelly_fraction = edge / (decimal_odds - 1)
```

Use fractional Kelly (25-50% of full Kelly) for safety. This is optional but
powerful for bankroll management.

---

## CONFIDENCE SCORING

Each projection gets a confidence grade based on data completeness:

### Signal inventory

| Signal | Available? | Weight |
|--------|-----------|--------|
| 3+ starts in 2026 | ✓/✗ | 20 |
| Confirmed lineup | ✓/✗ | 25 |
| BvP data (avg λ > 0.15) | ✓/✗ | 15 |
| SwStr%/CSW% (400+ pitches) | ✓/✗ | 15 |
| Umpire assignment | ✓/✗ | 10 |
| Park factor | ✓/✗ | 5 |
| Odds available | ✓/✗ | 10 |

### Grades

```
Score 80-100 → Grade A (high confidence — bet normal size)
Score 55-79  → Grade B (moderate — bet half size or proceed with caution)
Score 30-54  → Grade C (low — informational only, or very small bet)
Score <30    → Grade D (insufficient data — display but do not generate signal)
```

Display the grade alongside every projection. This tells the user (or you)
when to trust the number and when to pass.

---

## EARLY-SEASON MODE (WEEKS 1-3)

The model's weakest period. Specific adaptations:

1. **BF̂**: Rely heavily on 2025 full-season or preseason projections (Steamer,
   ZiPS, ATC). Weight `w₃` (prior) up to 0.60 until 3+ starts exist.

2. **K% inputs**: Use 2025 season-long K% splits as the base. 2026 data
   receives shrinkage: `K%_effective = r × K%_2026 + (1-r) × K%_2025` where
   `r = PA_2026 / (PA_2026 + 150)`.

3. **Team K%**: Use 2025 full-season team K% until the current season has 15+
   team games. Then begin blending.

4. **Minimum edge for signal**: Increase from 5% to 8% during weeks 1-3.
   Be pickier when your inputs are mostly priors.

5. **Confidence**: Most projections will be Grade B or C. That's correct and
   honest. Don't pretend you have Grade A data when you don't.

---

## FALLBACK HIERARCHY

| Component | Full Data | Partial | Missing |
|-----------|-----------|---------|---------|
| BF̂ | Last 3 starts (2026) + season avg | Blend 2026 + 2025 | 2025 full-season avg |
| K% (batter) | log5 with platoon splits | Season K% (no platoon) | League avg 0.222 |
| BvP | Shrunk residual (λ-weighted) | — | Omit (p̂ = p_base) |
| SwStr%/CSW% | 2026 shrunk by sample | 2025 full season | Zero adjustment |
| Umpire | 2025 STR% (dampened) | — | Zero adjustment |
| Park | Historical park K factor | — | Zero adjustment (factor = 1.0) |
| Odds | Live from Odds API | — | Show projection only, no signal |

---

## IMPLEMENTATION NOTES

### Data sources (no changes from v1)
- MLB Stats API — schedule, game logs, pitcher stats, lineup, BvP
- Baseball Savant / pybaseball — SwStr%, CSW%, Statcast metrics
- The Odds API — FanDuel lines + prices
- Open-Meteo — weather (if you decide to include it)
- Umpire lookup — static table, update annually from UmpScorecards.com or Covers

### New data needs for v2
- **Preseason projections** (Steamer, ZiPS, ATC) for early-season priors.
  Available free from FanGraphs. Scrape once preseason or hardcode key pitchers.
- **Park K factors** — available from FanGraphs, update once per season.
- **Team OBP** — already in MLB Stats API, just need to query it.

### Vercel architecture (suggested changes)
- `pages/api/projection/[pitcherId].js` — new unified endpoint that runs the
  full v2 model. Calls other endpoints internally or refactors into shared
  utility functions.
- Add a simple KV store (Vercel KV or a JSON file in the repo) to log
  predictions and results for backtesting. Schema:
  ```json
  {
    "date": "2026-04-15",
    "pitcher_id": 669373,
    "pitcher_name": "Corbin Burnes",
    "K_hat": 6.8,
    "BF_hat": 25.2,
    "K_rate_hat": 0.270,
    "confidence": "A",
    "edge": 0.072,
    "signal": "OVER",
    "line": 5.5,
    "odds": -120,
    "actual_K": 7,
    "result": "WIN"
  }
  ```
  This is how you validate and tune the model over time.

### Tunable parameters (all in one config)

```javascript
const MODEL_CONFIG = {
  // BF weights
  bf_w_recent: 0.50,
  bf_w_season: 0.30,
  bf_w_prior: 0.20,

  // BvP shrinkage
  bvp_shrinkage_constant: 50,

  // SwStr/CSW
  stuff_beta: 3.0,
  stuff_shrinkage_pitches: 400,

  // Umpire
  ump_gamma: 8.0,
  ump_dampen: 0.6,         // ABS era reduction
  ump_cap: [-0.4, 0.6],

  // Signal generation
  min_edge: 0.05,
  min_edge_early_season: 0.08,
  early_season_weeks: 3,

  // Early-season shrinkage
  k_rate_shrinkage_pa: 150,

  // Confidence weights
  confidence_weights: {
    starts_2026: 20,
    lineup: 25,
    bvp: 15,
    stuff: 15,
    umpire: 10,
    park: 5,
    odds: 10
  }
};
```

Put this in a single file. Every magic number in the model lives here. Nothing
hardcoded in the calculation functions.

---

## v1 → v2 MIGRATION PATH

You don't have to rebuild everything at once. Suggested order:

1. **Phase 1: BF × K% core** — Replace K̄₅ + modifiers with the structural
   decomposition. This is the biggest accuracy gain. Keep everything else the same.

2. **Phase 2: log5 + BvP shrinkage** — Replace the 3-tier BvP fallback with
   log5 base rates and λ-shrunk BvP residuals.

3. **Phase 3: Continuous adjustments** — Replace SwStr% buckets and umpire
   buckets with continuous functions. Add park factor.

4. **Phase 4: Price-aware signals** — Replace fixed ±0.4 threshold with
   Poisson P(Over) vs implied probability edge calculation.

5. **Phase 5: Confidence scoring + prediction logging** — Add grades and
   start recording every projection for backtesting.

Each phase can ship independently and improve the model incrementally.
