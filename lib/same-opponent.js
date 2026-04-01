// lib/same-opponent.js
// Same-opponent K anchor: if this pitcher has faced this exact team
// already this season, weight observed K totals heavily.

/**
 * Compute same-opponent K anchor.
 * @param {Array} vsTeamGames - pitcher's starts vs this team (current season first priority)
 *   Each: { strikeOuts, isHome, date }
 * @param {boolean} upcomingIsHome - is the upcoming game at home for the pitcher?
 * @param {Array} [vsTeamPriorSeason] - prior season starts vs this team (fallback)
 * @returns {object|null} { anchor: number, weight: number, games: number, source: string } or null
 */
export function computeSameOpponentAnchor(vsTeamGames, upcomingIsHome, vsTeamPriorSeason) {
  // Use current season if available, otherwise fall back to prior season at reduced weight
  const hasCurrent = vsTeamGames?.length > 0;
  const hasPrior = vsTeamPriorSeason?.length > 0;
  if (!hasCurrent && !hasPrior) return null;

  const games = hasCurrent ? vsTeamGames : vsTeamPriorSeason;
  const source = hasCurrent ? 'current' : 'prior';

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
  let anchorWeight = Math.min(0.35, 0.20 + (sorted.length - 1) * 0.10);

  // Prior-season data gets 60% of normal weight (still useful, but less reliable)
  if (source === 'prior') {
    anchorWeight *= 0.60;
  }

  return { anchor, weight: anchorWeight, games: sorted.length, source };
}
