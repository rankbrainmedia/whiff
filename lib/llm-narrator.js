// lib/llm-narrator.js
// LLM Narrator: Claude Sonnet human-readable 2-3 sentence betting insight.
// Called after the deterministic model runs. Falls back to a template string on failure.

import Anthropic from '@anthropic-ai/sdk';
import MODEL_CONFIG from './model-config.js';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env automatically

const NARRATOR_SYSTEM = `You write concise baseball strikeout betting insights. Talk like a sharp sports bettor explaining to a friend. Be specific — reference actual numbers and matchup details. No hedging language, no "our model suggests." Just say what's happening and why. 2-3 sentences max.`;

const NEUTRAL_SYSTEM = `You write concise baseball strikeout summaries. One sentence only. State that the projection aligns with the market and there's no actionable edge. Be brief and direct.`;

/**
 * Generate a human-readable narrative for a projection.
 * @param {object} projectionContext - all relevant data for the narrative
 * @returns {string} narrative string (fallback template if LLM fails)
 */
export async function generateNarrative(projectionContext) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('llm-narrator: ANTHROPIC_API_KEY not set, using fallback');
    return buildFallbackNarrative(projectionContext);
  }

  const { signal } = projectionContext;
  const isNeutral = signal === 'NEUTRAL' || signal === 'NOLINE';

  try {
    const prompt = isNeutral
      ? buildNeutralPrompt(projectionContext)
      : buildFullPrompt(projectionContext);

    const message = await Promise.race([
      client.messages.create({
        model: MODEL_CONFIG.narrator_model,
        max_tokens: isNeutral ? 100 : 250,
        system: isNeutral ? NEUTRAL_SYSTEM : NARRATOR_SYSTEM,
        messages: [{ role: 'user', content: prompt }],
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Narrator LLM timeout')), 20000)
      ),
    ]);

    const text = message?.content?.[0]?.text?.trim();
    if (!text) throw new Error('Empty response from narrator LLM');
    return text;

  } catch (err) {
    console.error('llm-narrator error:', err.message);
    return buildFallbackNarrative(projectionContext);
  }
}

function buildFullPrompt({
  pitcherName,
  pitcherTeam,
  opponentTeam,
  kHat,
  fdLine,
  overOdds,
  underOdds,
  signal,
  edgePct,
  kPctShrunk,
  kPctRaw,
  shrinkageBF,
  sameOpponent,
  teamHotCold,
  scoutFlags,
  swstrPct,
  confidenceGrade,
  confidenceScore,
}) {
  const parts = [`PROJECTION DATA:
- Pitcher: ${pitcherName ?? 'Unknown'} (${pitcherTeam ?? '?'}) vs ${opponentTeam ?? '?'}
- Projected K: ${kHat} | FanDuel line: ${fdLine ?? 'N/A'} (${overOdds ?? '?'}/${underOdds ?? '?'})
- Signal: ${signal} | Edge: ${edgePct != null ? Math.round(edgePct * 100) + '%' : 'N/A'}
- Key factors:`];

  if (kPctShrunk != null) {
    const pctStr = Math.round(kPctShrunk * 1000) / 10 + '%';
    const rawStr = kPctRaw != null ? ` (raw: ${Math.round(kPctRaw * 1000) / 10}%, based on ${shrinkageBF ?? '?'} BF in 2026)` : '';
    parts.push(`  - K% (shrunk): ${pctStr}${rawStr}`);
  }

  if (sameOpponent) {
    parts.push(`  - Same-opponent: ${sameOpponent.games} prior matchup(s) this season, avg ${Math.round(sameOpponent.anchor * 10) / 10}K (weight: ${Math.round(sameOpponent.weight * 100)}%)`);
  } else {
    parts.push(`  - Same-opponent: no prior matchup this season`);
  }

  if (teamHotCold) {
    const dir = teamHotCold.ratio < 1 ? 'running cold (below expected)' : 'running hot (above expected)';
    parts.push(`  - Team hot/cold: opponent ${dir} — ratio ${teamHotCold.ratio} over last ${teamHotCold.gamesUsed} games, modifier ${teamHotCold.modifier > 0 ? '+' : ''}${teamHotCold.modifier}K`);
  } else {
    parts.push(`  - Team hot/cold: insufficient data`);
  }

  if (scoutFlags?.length) {
    parts.push(`  - Scout flags: ${scoutFlags.join(', ')}`);
  } else {
    parts.push(`  - Scout flags: none`);
  }

  if (swstrPct != null) parts.push(`  - SwStr%: ${swstrPct}%`);
  if (confidenceGrade) parts.push(`  - Confidence: ${confidenceGrade} (${confidenceScore}/100)`);

  return parts.join('\n');
}

function buildNeutralPrompt({ pitcherName, opponentTeam, kHat, fdLine }) {
  return `Pitcher: ${pitcherName ?? 'Unknown'} vs ${opponentTeam ?? '?'}. Projected K: ${kHat}. FanDuel line: ${fdLine ?? 'N/A'}. Signal: NEUTRAL.`;
}

function buildFallbackNarrative({ pitcherName, kHat, signal, edgePct }) {
  if (!signal || signal === 'NOLINE') {
    return `Projected ${kHat ?? '?'}K. No line posted yet.`;
  }
  const edgeStr = edgePct != null ? ` with ${Math.round(Math.abs(edgePct) * 100)}% edge` : '';
  return `${pitcherName ?? 'Pitcher'} projected ${kHat ?? '?'}K. ${signal} signal${edgeStr}.`;
}
