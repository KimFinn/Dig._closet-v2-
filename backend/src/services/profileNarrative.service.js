/**
 * Digital life-twin narrative -- Phase 9 (PRD §3.10, §6.6).
 *
 * Same "arithmetic first, LLM narrates already-correct numbers" pattern
 * as budgetFeasibility.service.js: the traits themselves are always
 * computed deterministically by profileSynthesis.service.js; this file's
 * only job is turning the current, visible traits into a short, natural
 * paragraph, or falling back to a plain templated one built from the
 * exact same data when no key is configured or the call fails.
 *
 * Lazy + cached per §6.6 ("make expensive LLM calls lazy, not scheduled"):
 * the nightly job updates the cheap structured traits for every user,
 * but this narrative is only (re)generated the first time it's actually
 * requested after something meaningfully changed (summary.computedAt
 * moved past the last time this ran) -- never on a schedule nobody asked
 * for.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { UserProfileSummary } = require('../database/models');
const { getVisibleProfile } = require('./profileDashboard.service');
const logger = require('../utils/logger');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const NARRATIVE_MODEL = process.env.PROFILE_NARRATIVE_MODEL || 'claude-3-5-haiku-20241022';

let warnedNoKey = false;
function isLive() {
  if (!ANTHROPIC_API_KEY && !warnedNoKey) {
    logger.warn('ANTHROPIC_API_KEY not configured -- profile narratives will use a plain templated paragraph, not LLM-narrated phrasing.');
    warnedNoKey = true;
  }
  return !!ANTHROPIC_API_KEY;
}

function describeTraitPlainly(trait) {
  switch (trait.pillar) {
    case 'style_evolution':
      if (trait.traitType === 'observed_fact' && trait.value?.topColors?.length) {
        const top = trait.value.topColors[0];
        return `Your wardrobe leans toward ${top.color} (${top.pct}% of your active items).`;
      }
      if (trait.traitType === 'inferred_preference' && trait.value?.alignment && trait.value.alignment !== 'unknown') {
        return trait.value.alignment === 'aligned'
          ? `You mostly wear pieces that match your declared style.`
          : `Your most-worn outfits (mostly ${trait.value.mostWornOccasion}) skew a bit different from your declared style persona.`;
      }
      return null;
    case 'travel_interests':
      if (trait.traitType === 'observed_fact' && trait.value?.totalTrips != null) {
        return trait.value.totalTrips > 0
          ? `You've planned ${trait.value.totalTrips} trip(s) with ${trait.value.totalActivities || 0} activities logged in the last year.`
          : null;
      }
      if (trait.traitType === 'inferred_preference' && trait.value?.alignment && trait.value.alignment !== 'unknown') {
        return `Your actual trip pace looks ${trait.value.observedPace}, ${trait.value.alignment === 'aligned' ? 'matching' : 'a little different from'} what you told us you prefer.`;
      }
      return null;
    case 'spending_patterns':
      if (trait.traitType === 'observed_fact' && trait.value?.totalSpend) {
        return `You've logged about $${trait.value.totalSpend} in purchase prices across your wardrobe.`;
      }
      if (trait.traitType === 'inferred_preference' && trait.value?.aboveAverageCategories?.length) {
        return `You tend to spend more on ${trait.value.aboveAverageCategories.join(', ')} than your other categories.`;
      }
      return null;
    case 'occasion_habits':
      if (trait.traitType === 'observed_fact' && trait.value?.topOccasion) {
        return `Most of your outfits are tagged for ${trait.value.topOccasion} occasions.`;
      }
      if (trait.traitType === 'inferred_preference' && trait.value?.lean && trait.value.lean !== 'unknown') {
        return `Your actual wear patterns lean ${trait.value.lean}.`;
      }
      return null;
    default:
      return null;
  }
}

function buildTemplatedNarrative(traits) {
  const sentences = Object.values(traits).map(describeTraitPlainly).filter(Boolean);
  if (sentences.length === 0) {
    return "I don't have enough data about you yet -- keep using the app (uploading your wardrobe, planning trips, wearing outfits) and check back soon.";
  }
  return sentences.join(' ');
}

/**
 * The only LLM call in this file -- handed ONLY the currently-visible
 * traits (already filtered by profileDashboard's suppression/override
 * rules), explicitly instructed never to introduce a fact not present in
 * them and never to mention a `doNotUseInRecommendations`-flagged trait
 * as if it shaped a suggestion.
 */
async function narrateFromTraits(traits) {
  if (!isLive()) return { narrative: buildTemplatedNarrative(traits), live: false };

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: NARRATIVE_MODEL,
      max_tokens: 200,
      system:
        'You write a short (2-4 sentence), warm, specific "what I know about you" summary for a wardrobe/travel app. ' +
        'Use ONLY the trait data given below -- never invent a fact, habit, or number that is not in it. ' +
        'If a trait has low confidence, hedge appropriately rather than stating it flatly. ' +
        'Never state a trait marked doNotUseInRecommendations as something the app uses for suggestions.',
      messages: [{ role: 'user', content: `Traits:\n${JSON.stringify(traits, null, 2)}\n\nWrite the summary now.` }],
    });
    const text = message.content?.[0]?.text?.trim();
    if (!text) throw new Error('Empty LLM response');
    return { narrative: text, live: true };
  } catch (error) {
    logger.warn('Profile narrative LLM generation failed, falling back to templated narrative', { error: error.message });
    return { narrative: buildTemplatedNarrative(traits), live: false };
  }
}

async function getNarrative(userId, { force = false } = {}) {
  const summary = await UserProfileSummary.findOne({ where: { userId } });
  if (!summary || !summary.computedAt) {
    return {
      narrative: "I don't have enough data about you yet -- keep using the app and check back soon.",
      live: false,
      hasProfile: false,
      cached: false,
    };
  }

  const stale = force || !summary.narrativeGeneratedAt || new Date(summary.narrativeGeneratedAt) < new Date(summary.computedAt);
  if (!stale) {
    return { narrative: summary.narrativeSummary, live: null, hasProfile: true, cached: true };
  }

  const { traits } = await getVisibleProfile(userId);
  const { narrative, live } = await narrateFromTraits(traits);
  await summary.update({ narrativeSummary: narrative, narrativeGeneratedAt: new Date() });

  return { narrative, live, hasProfile: true, cached: false };
}

module.exports = { getNarrative, narrateFromTraits, buildTemplatedNarrative };
