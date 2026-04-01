// lib/team-hot-cold.js
// Team K hot/cold modifier: compare actual Ks the opponent gave up recently
// vs what was expected given the pitchers they faced.

/**
 * Compute team K hot/cold modifier.
 * @param {Array} recentGames - team's last 5 games (current season only)
 *   Each: { actualKs, opposingPitcherKPer9, opposingPitcherIP }
 * @returns {object|null} { modifier: number, gamesUsed: number, ratio: number } or null
 */
export function computeTeamKHotCold(recentGames) {
  if (!recentGames?.length || recentGames.length < 3) return null;

  let totalActualK = 0;
  let totalExpectedK = 0;

  for (const g of recentGames) {
    const actualKs = g.actualKs ?? 0;
    totalActualK += actualKs;

    // Expected Ks from the starter: their K/9 × innings pitched / 9
    // Isolates "how did THIS team perform vs what they SHOULD have faced"
    const expectedFromStarter = (g.opposingPitcherKPer9 ?? 8.0) * (g.opposingPitcherIP ?? 5.5) / 9;
    // Add ~2.5 Ks from relievers as baseline (league avg)
    totalExpectedK += expectedFromStarter + 2.5;
  }

  if (totalExpectedK === 0) return null;

  // Ratio < 1.0 → team striking out LESS than expected (hot, seeing ball well)
  // Ratio > 1.0 → team striking out MORE than expected (cold, whiffing)
  const ratio = totalActualK / totalExpectedK;

  // Convert to modifier: caps at ±0.8 Ks, scaled by sample size
  // ratio 0.85 (15% below expected) → -0.525 → capped at -0.8 per scale factor
  const raw = (ratio - 1.0) * 3.5; // scale factor matches MODEL_CONFIG.hot_cold_scale_factor
  const capped = Math.max(-0.8, Math.min(0.8, raw));

  // Dampen by sample size: 4 games = 0.4x, 7 games = 0.7x, 10+ = full weight
  const sampleWeight = Math.min(recentGames.length, 10) / 10;
  const modifier = Math.round(capped * sampleWeight * 100) / 100;

  return { modifier, gamesUsed: recentGames.length, ratio: Math.round(ratio * 100) / 100 };
}
