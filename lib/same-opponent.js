// lib/same-opponent.js
// Same-opponent K anchor: if this pitcher has faced this exact team
// already this season, weight observed K totals heavily.

/**
 * Compute same-opponent K anchor.
 * @param {Array} vsTeamGames - pitcher's starts vs this team (current season only)
 *   Each: { strikeOuts, isHome, date }
 * @param {boolean} upcomingIsHome - is the upcoming game at home for the pitcher?
 * @returns {object|null} { anchor: number, weight: number, games: number } or null
 */
export function computeSameOpponentAnchor(vsTeamGames, upcomingIsHome) {
  if (!vsTeamGames?.length) return null;

  // Weight by venue match: same venue = 1.0, different venue = 0.6
  // Weight by recency: most recent = 1.0, decay by 0.85 per game back
  let weightedSum = 0;
  let weightTotal = 0;

  // Sort by date descending (most recent first)
  const sorted = [...vsTeamGames].sort((a, b) => new Date(b.date) - new Date(a.date));

  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i];
    const venueMatch = (g.isHome === upcomingIsHome) ? 1.0 : 0.6;
    const recency = Math.pow(0.85, i); // 1.0, 0.85, 0.72, 0.61...
    const w = venueMatch * recency;
    weightedSum += (g.strikeOuts ?? 0) * w;
    weightTotal += w;
  }

  if (weightTotal === 0) return null;
  const anchor = weightedSum / weightTotal;

  // Weight of this anchor in the final projection depends on game count
  // 1 game = moderate weight (0.20), 2+ = stronger (up to 0.35)
  const anchorWeight = Math.min(0.35, 0.20 + (sorted.length - 1) * 0.10);

  return { anchor, weight: anchorWeight, games: sorted.length };
}
