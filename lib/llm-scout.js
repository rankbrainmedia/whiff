// lib/llm-scout.js
// LLM Scout: Gemini Flash pre-model qualitative analysis.
// Reads structured matchup data, outputs JSON adjustments.
// If anything fails, returns null — the deterministic model runs regardless.

import { GoogleGenerativeAI } from '@google/generative-ai';
import MODEL_CONFIG from './model-config.js';

const SYSTEM_PROMPT = `You are a baseball analytics scout. Analyze this matchup data and identify qualitative factors that a statistical model might miss.

OUTPUT FORMAT (JSON only, no other text):
{
  "bf_modifier": 0,
  "k_pct_modifier": 0.0,
  "flags": [],
  "confidence_note": ""
}

RULES:
- bf_modifier: integer, -5 to +5, adjust expected batters faced
- k_pct_modifier: float, -0.05 to +0.05, adjust K rate
- flags: string array — valid values: "short_rest", "il_return", "pitch_limit", "rookie_heavy_lineup", "cold_weather", "blowout_risk", "hot_streak", "cold_streak", "ace_back"
- confidence_note: 1 sentence max, only if something truly notable
- If nothing notable, return all zeros and empty arrays
- Do NOT invent stats. Only use data provided.
- Modifiers should be conservative. Most games have no notable factors.
- A bf_modifier of -3 means "expect 3 fewer batters faced than model predicts"`;

/**
 * Run the LLM scout on a matchup.
 * @param {object} matchupData - structured data about the upcoming game
 * @returns {object|null} { bf_modifier, k_pct_modifier, flags, confidence_note } or null on failure
 */
export async function runScout(matchupData) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn('llm-scout: GEMINI_API_KEY not set, skipping scout');
    return null;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_CONFIG.scout_model });

    const prompt = `${SYSTEM_PROMPT}

MATCHUP DATA:
${JSON.stringify(matchupData, null, 2)}`;

    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Scout LLM timeout')), 15000)
      ),
    ]);

    const text = result?.response?.text?.() ?? '';
    if (!text) throw new Error('Empty response from scout LLM');

    // Extract JSON — model should return JSON only, but strip any markdown fences
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    // Validate and clamp outputs
    const bfMod = typeof parsed.bf_modifier === 'number'
      ? Math.max(-MODEL_CONFIG.scout_bf_modifier_max, Math.min(MODEL_CONFIG.scout_bf_modifier_max, Math.round(parsed.bf_modifier)))
      : 0;

    const kPctMod = typeof parsed.k_pct_modifier === 'number'
      ? Math.max(-MODEL_CONFIG.scout_kpct_modifier_max, Math.min(MODEL_CONFIG.scout_kpct_modifier_max, parsed.k_pct_modifier))
      : 0;

    const flags = Array.isArray(parsed.flags) ? parsed.flags.filter(f => typeof f === 'string') : [];
    const note = typeof parsed.confidence_note === 'string' ? parsed.confidence_note.slice(0, 200) : '';

    return {
      bf_modifier: bfMod,
      k_pct_modifier: kPctMod,
      flags,
      confidence_note: note,
    };

  } catch (err) {
    console.error('llm-scout error:', err.message);
    return null;
  }
}

/**
 * Build the structured matchup data object to send to the scout.
 * All fields optional — missing data is omitted rather than faked.
 */
export function buildScoutInput({
  pitcherName,
  pitcherTeam,
  opponentTeam,
  pitcherAge,
  restDays,
  starts2026,
  kPctShrunk,
  kPctRaw,
  shrinkageBF,
  avgKLast5,
  avgKLast10,
  recentTrend,       // e.g. "improving" / "declining" / "stable"
  swstrPct,
  pitchLimitKnown,   // boolean
  venue,
  weatherTemp,       // degrees F, null if unknown
  weatherWind,       // mph, null if unknown
  isEarlySeason,
  lineupAvailable,   // boolean
  lineupFlags,       // e.g. ["rookie_heavy", "missing_cleanup"]
  fdLine,
  fdOverOdds,
  fdUnderOdds,
}) {
  const data = {};
  if (pitcherName)    data.pitcher = pitcherName;
  if (pitcherTeam)    data.pitcherTeam = pitcherTeam;
  if (opponentTeam)   data.opponentTeam = opponentTeam;
  if (pitcherAge)     data.pitcherAge = pitcherAge;
  if (restDays != null) data.restDays = restDays;
  if (starts2026 != null) data.starts2026 = starts2026;
  if (kPctShrunk != null) data.kPctShrunk = Math.round(kPctShrunk * 1000) / 10 + '%';
  if (kPctRaw != null)    data.kPctRaw = Math.round(kPctRaw * 1000) / 10 + '%';
  if (shrinkageBF != null) data.shrinkageBF = shrinkageBF;
  if (avgKLast5 != null)  data.avgKLast5 = Math.round(avgKLast5 * 10) / 10;
  if (avgKLast10 != null) data.avgKLast10 = Math.round(avgKLast10 * 10) / 10;
  if (recentTrend)    data.recentTrend = recentTrend;
  if (swstrPct != null)   data.swstrPct = swstrPct + '%';
  if (pitchLimitKnown != null) data.pitchLimitKnown = pitchLimitKnown;
  if (venue)          data.venue = venue;
  if (weatherTemp != null) data.weatherTemp = weatherTemp + '°F';
  if (weatherWind != null) data.weatherWind = weatherWind + 'mph';
  if (isEarlySeason != null) data.isEarlySeason = isEarlySeason;
  if (lineupAvailable != null) data.lineupAvailable = lineupAvailable;
  if (lineupFlags?.length) data.lineupFlags = lineupFlags;
  if (fdLine != null) data.fdLine = fdLine;
  if (fdOverOdds != null)  data.fdOverOdds = fdOverOdds;
  if (fdUnderOdds != null) data.fdUnderOdds = fdUnderOdds;
  return data;
}
