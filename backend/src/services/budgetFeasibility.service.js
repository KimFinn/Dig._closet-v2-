/**
 * Budget feasibility check -- Phase 7 (PRD §3.15).
 *
 * Decided in the Phase 7 brainstorm: curated cost table + a thin LLM
 * layer, never LLM memory for the cost figures themselves. An LLM
 * asked "is $2000 enough for a week in France" from its own training
 * knowledge produces a confident, specific-sounding number with zero
 * grounding -- cost of living drifts with inflation/season, and this
 * is financial-adjacent guidance, so a wrong "yes, you're fine" is a
 * worse failure than the feature not existing.
 *
 * Refinement made while building this (stricter than, but faithful to,
 * what was agreed): the arithmetic itself is done in plain code below
 * (computeFeasibility), not by the LLM -- LLMs are worse at reliable
 * arithmetic than a few lines of JS, so doing it in code is strictly
 * safer than asking the model to "do the math" and just happens to
 * also be simpler. The LLM's only remaining job is turning already-
 * correct numbers into natural, personalized phrasing -- exactly the
 * "arithmetic and narration over trusted numbers, never supplying the
 * figures itself" principle, just with the arithmetic hardened.
 *
 * Credential-gated like every other external-API integration in this
 * app: with no ANTHROPIC_API_KEY, getFeasibilityVerdict() still
 * returns a complete, correct answer -- a plain templated sentence
 * built from the same computed numbers -- just without the LLM's more
 * natural phrasing on top. Nothing about the underlying numbers or
 * verdict changes when a key is added; only the wording improves.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { DestinationCostTier } = require('../database/models');
const { formatPrice } = require('../utils/currency');
const logger = require('../utils/logger');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const LLM_MODEL = process.env.BUDGET_FEASIBILITY_MODEL || 'claude-3-5-haiku-20241022';

let warnedNoKey = false;
function isLive() {
  if (!ANTHROPIC_API_KEY && !warnedNoKey) {
    logger.warn('ANTHROPIC_API_KEY not configured -- budget feasibility verdicts will use a plain templated sentence, not LLM-narrated phrasing.');
    warnedNoKey = true;
  }
  return !!ANTHROPIC_API_KEY;
}

async function loadCostTiers(countryOrRegion) {
  let rows = await DestinationCostTier.findAll({ where: { countryOrRegion } });
  if (rows.length === 0) {
    rows = await DestinationCostTier.findAll({ where: { countryOrRegion: 'Global' } });
  }
  return rows;
}

function tierDailyTotal(row) {
  return (
    Number(row.dailyAccommodation || 0) +
    Number(row.dailyFood || 0) +
    Number(row.dailyLocalTransport || 0) +
    Number(row.dailyActivities || 0)
  );
}

/**
 * Pure arithmetic -- deterministic, no LLM. Given the stated budget and
 * trip length, computes the per-day rate the user is working with and
 * compares it against each tier's real daily total (from the curated
 * table) to say which tier(s) the budget actually covers.
 */
async function computeFeasibility({ countryOrRegion, days, statedBudget, currency = 'USD' }) {
  if (!days || days <= 0) throw new Error('computeFeasibility requires a positive number of days');
  if (statedBudget == null || statedBudget < 0) throw new Error('computeFeasibility requires a non-negative statedBudget');

  const tiers = await loadCostTiers(countryOrRegion);
  if (tiers.length === 0) {
    return { available: false, message: 'No cost data available for this destination yet.' };
  }

  const perDay = statedBudget / days;
  const tierBreakdown = tiers
    .map((row) => ({
      tier: row.tier,
      dailyTotal: tierDailyTotal(row),
      totalForTrip: tierDailyTotal(row) * days,
      currency: row.currency,
    }))
    .sort((a, b) => a.dailyTotal - b.dailyTotal);

  const budgetTier = tierBreakdown.find((t) => t.tier === 'budget') || tierBreakdown[0];
  const feasible = perDay >= budgetTier.dailyTotal;

  // The highest tier the stated budget comfortably covers (or null if
  // it doesn't even clear the budget tier).
  let bestAffordableTier = null;
  for (const t of tierBreakdown) {
    if (perDay >= t.dailyTotal) bestAffordableTier = t.tier;
  }

  const shortfallPerDay = feasible ? 0 : Math.max(0, budgetTier.dailyTotal - perDay);
  const suggestedBudget = feasible ? null : Math.ceil(budgetTier.dailyTotal * days);

  return {
    available: true,
    days,
    statedBudget,
    currency,
    perDay: Math.round(perDay * 100) / 100,
    feasible,
    bestAffordableTier,
    shortfallPerDay: Math.round(shortfallPerDay * 100) / 100,
    suggestedBudget,
    tierBreakdown,
  };
}

function buildTemplatedVerdict(result, countryOrRegion) {
  const perDayDisplay = formatPrice(result.perDay, result.currency) || `${result.perDay} ${result.currency}`;
  if (result.feasible) {
    return `Your budget of ${formatPrice(result.statedBudget, result.currency) || result.statedBudget} over ${result.days} days for ${countryOrRegion} works out to ${perDayDisplay}/day, which covers ${result.bestAffordableTier === 'comfortable' ? 'a comfortable' : result.bestAffordableTier === 'mid' ? 'a mid-range' : 'a budget-conscious'} trip based on typical costs there.`;
  }
  return `Your budget of ${formatPrice(result.statedBudget, result.currency) || result.statedBudget} over ${result.days} days for ${countryOrRegion} works out to ${perDayDisplay}/day, which is tight for typical costs there -- around ${formatPrice(result.suggestedBudget, result.currency) || result.suggestedBudget} total would comfortably cover a budget-tier trip.`;
}

/**
 * The only LLM call in this file -- and it is handed ALREADY-COMPUTED,
 * trusted numbers to narrate, explicitly instructed not to introduce
 * any figure that wasn't given to it. Deliberately low-token: a short
 * system instruction, a compact JSON payload of the numbers, and a
 * small max_tokens cap.
 */
async function narrateFeasibility(result, countryOrRegion) {
  if (!isLive()) {
    return { verdict: buildTemplatedVerdict(result, countryOrRegion), live: false };
  }

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: LLM_MODEL,
      max_tokens: 150,
      system: 'You write a short (2-3 sentence), friendly budget-feasibility verdict for a trip. Use ONLY the numbers given to you below -- never invent, adjust, or estimate any cost figure yourself. Do not add a disclaimer about being an AI.',
      messages: [{
        role: 'user',
        content: `Destination: ${countryOrRegion}\nTrip length: ${result.days} days\nStated budget: ${result.statedBudget} ${result.currency} (${result.perDay}/day)\nFeasible against typical budget-tier costs there: ${result.feasible}\nBest tier this budget covers: ${result.bestAffordableTier || 'none'}\nIf not feasible, a budget that would work: ${result.suggestedBudget || 'n/a'} ${result.currency}\n\nWrite the verdict now.`,
      }],
    });
    const text = message.content?.[0]?.text?.trim();
    if (!text) throw new Error('Empty LLM response');
    return { verdict: text, live: true };
  } catch (error) {
    logger.warn('Budget feasibility LLM narration failed, falling back to templated verdict', { error: error.message });
    return { verdict: buildTemplatedVerdict(result, countryOrRegion), live: false };
  }
}

/**
 * Full flow: compute (deterministic) -> narrate (LLM or template).
 */
async function getFeasibilityVerdict({ countryOrRegion, days, statedBudget, currency = 'USD' }) {
  const result = await computeFeasibility({ countryOrRegion, days, statedBudget, currency });
  if (!result.available) return result;

  const { verdict, live } = await narrateFeasibility(result, countryOrRegion);
  return { ...result, verdict, live };
}

module.exports = { computeFeasibility, getFeasibilityVerdict, narrateFeasibility, buildTemplatedVerdict };
