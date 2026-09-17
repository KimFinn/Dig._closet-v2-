/**
 * Digital life-twin profile synthesis -- Phase 9 (PRD §3.10).
 *
 * Computes the nightly `structured_traits` snapshot for one user, across
 * all four pillars agreed for v1 together (style evolution, travel
 * interests, spending patterns, occasion habits) -- no staggering, per
 * the 2026-09-18 scoping decision.
 *
 * Every pillar contributes exactly two traits, deliberately one of each
 * kind, so the fact/preference split from that same discussion is real
 * in the data model, not just documented:
 *   - an `observed_fact` trait -- a direct computation over the user's
 *     own rows (counts, sums, percentages). Never disputable; if it looks
 *     wrong, the real bug is a mistagged item, fixed through the existing
 *     tag-correction flow, not through overriding this trait.
 *   - an `inferred_preference` trait -- the model's interpretation of a
 *     behavioral pattern (declared vs. observed comparisons). Genuinely
 *     an opinion, and the user is the higher authority on their own
 *     taste -- see profileDashboard.service.js for the override/delete
 *     path this feeds.
 *
 * Every `inferred_preference` trait also carries a `signal` -- a short,
 * stable string summarizing "the model's current takeaway" (e.g. an
 * alignment status). This is the one field reversal detection compares
 * night over night; see applyCorrectionsAndDetectReversal below.
 *
 * IMPORTANT: this file only ever computes the live, true value.
 * `structuredTraits` is not merged with corrections here -- that overlay
 * is applied at read time by profileDashboard.service.js / chatbot.
 * service.js / profileNarrative.service.js, each per its own honesty
 * rule. Baking corrections into the computed value would make it
 * impossible to detect a real behavior reversal against the pre-
 * correction baseline.
 */

const { Op, fn, col } = require('sequelize');
const {
  UserProfileSummary,
  Clothes,
  Outfit,
  Trip,
  TripActivity,
  UserPreferences,
} = require('../database/models');
const logger = require('../utils/logger');

const TRAIT_PILLARS = ['style_evolution', 'travel_interests', 'spending_patterns', 'occasion_habits'];

// How many consecutive nightly runs a freshly-computed inferred_preference
// trait has to keep diverging from a user's override/delete before the
// correction is cleared and the trait is re-proposed fresh. ~2 weeks by
// default -- long enough that this is a real, sustained reversal, not
// noisy short-term signal. 2026-09-18 scoping decision.
const REVERSAL_STREAK_NIGHTS = parseInt(process.env.PROFILE_REVERSAL_STREAK_NIGHTS || '14', 10);

function pct(n, total) {
  if (!total) return 0;
  return Math.round((n / total) * 1000) / 10;
}

function confidenceFromCount(count, fullConfidenceAt) {
  if (!count) return 0;
  return Math.min(1, Math.round((count / fullConfidenceAt) * 100) / 100);
}

// ---------------------------------------------------------------------------
// Pillar 1: style evolution
// ---------------------------------------------------------------------------
async function computeStyleEvolution(userId) {
  const items = await Clothes.findAll({
    where: { userId, isActive: true },
    attributes: ['color'],
    raw: true,
  });
  const totalItems = items.length;
  const colorCounts = {};
  for (const item of items) {
    const color = (item.color || '').trim().toLowerCase();
    if (!color) continue;
    colorCounts[color] = (colorCounts[color] || 0) + 1;
  }
  const topColors = Object.entries(colorCounts)
    .map(([color, count]) => ({ color, count, pct: pct(count, totalItems) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const colorComposition = {
    pillar: 'style_evolution',
    traitType: 'observed_fact',
    value: { totalItems, topColors },
    confidence: confidenceFromCount(totalItems, 20),
    computedAt: new Date().toISOString(),
  };

  const [prefs, wornOutfits] = await Promise.all([
    UserPreferences.findOne({ where: { userId }, attributes: ['stylePersona'], raw: true }),
    Outfit.findAll({
      where: { userId, isActive: true, wearCount: { [Op.gt]: 0 } },
      attributes: ['occasion', 'wearCount'],
      raw: true,
    }),
  ]);

  const occasionWearCounts = {};
  for (const o of wornOutfits) {
    if (!o.occasion) continue;
    occasionWearCounts[o.occasion] = (occasionWearCounts[o.occasion] || 0) + (o.wearCount || 0);
  }
  const totalWearEvents = Object.values(occasionWearCounts).reduce((a, b) => a + b, 0);
  const mostWornOccasion = Object.entries(occasionWearCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const declaredStyle = prefs?.stylePersona || null;
  // Deliberately simple v1 alignment heuristic -- a real "style drift"
  // model is out of scope here; this only needs to be honest and
  // reversal-detectable, not sophisticated.
  const alignment = !declaredStyle || !mostWornOccasion ? 'unknown'
    : (declaredStyle === 'minimalist' || declaredStyle === 'classic') && mostWornOccasion === 'casual' ? 'diverges'
    : 'aligned';

  const declaredVsWorn = {
    pillar: 'style_evolution',
    traitType: 'inferred_preference',
    value: { declaredStyle, mostWornOccasion, totalWearEvents, alignment },
    signal: alignment,
    confidence: confidenceFromCount(wornOutfits.length, 10),
    computedAt: new Date().toISOString(),
  };

  return { 'style_evolution.color_composition': colorComposition, 'style_evolution.declared_vs_worn': declaredVsWorn };
}

// ---------------------------------------------------------------------------
// Pillar 2: travel interests
// ---------------------------------------------------------------------------
async function computeTravelInterests(userId) {
  const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const trips = await Trip.findAll({
    where: { userId, isActive: true, createdAt: { [Op.gte]: oneYearAgo } },
    attributes: ['id', 'durationDays'],
    raw: true,
  });
  const tripIds = trips.map((t) => t.id);
  const activities = tripIds.length
    ? await TripActivity.findAll({ where: { tripId: { [Op.in]: tripIds } }, attributes: ['category'], raw: true })
    : [];

  const categoryCounts = {};
  for (const a of activities) {
    if (!a.category) continue;
    categoryCounts[a.category] = (categoryCounts[a.category] || 0) + 1;
  }

  const tripActivityCounts = {
    pillar: 'travel_interests',
    traitType: 'observed_fact',
    value: { totalTrips: trips.length, totalActivities: activities.length, categoryCounts },
    confidence: confidenceFromCount(activities.length, 10),
    computedAt: new Date().toISOString(),
  };

  const totalDays = trips.reduce((sum, t) => sum + (t.durationDays || 0), 0);
  const activitiesPerDay = totalDays > 0 ? activities.length / totalDays : null;
  const observedPace = activitiesPerDay == null ? null
    : activitiesPerDay >= 2.5 ? 'packed'
    : activitiesPerDay <= 1 ? 'relaxed'
    : 'balanced';

  const prefs = await UserPreferences.findOne({ where: { userId }, attributes: ['pacePreference'], raw: true });
  const declaredPace = prefs?.pacePreference || null;
  const alignment = !declaredPace || !observedPace ? 'unknown' : (declaredPace === observedPace ? 'aligned' : 'diverges');

  const paceAlignment = {
    pillar: 'travel_interests',
    traitType: 'inferred_preference',
    value: { declaredPace, observedPace, activitiesPerDay, alignment },
    signal: alignment,
    confidence: confidenceFromCount(activities.length, 5),
    computedAt: new Date().toISOString(),
  };

  return { 'travel_interests.trip_activity_counts': tripActivityCounts, 'travel_interests.pace_alignment': paceAlignment };
}

// ---------------------------------------------------------------------------
// Pillar 3: spending patterns
// ---------------------------------------------------------------------------
async function computeSpendingPatterns(userId) {
  const items = await Clothes.findAll({
    where: { userId, isActive: true, purchasePrice: { [Op.ne]: null } },
    attributes: ['type', 'purchasePrice'],
    raw: true,
  });

  const itemsWithPrice = items.length;
  const totalSpend = items.reduce((sum, i) => sum + Number(i.purchasePrice || 0), 0);
  const byCategory = {};
  for (const i of items) {
    const type = (i.type || 'unknown').trim().toLowerCase();
    if (!byCategory[type]) byCategory[type] = { count: 0, total: 0 };
    byCategory[type].count += 1;
    byCategory[type].total += Number(i.purchasePrice || 0);
  }
  const categorySpend = Object.fromEntries(
    Object.entries(byCategory).map(([type, { count, total }]) => [
      type,
      { count, total: Math.round(total * 100) / 100, avg: Math.round((total / count) * 100) / 100 },
    ])
  );

  const categorySpendTrait = {
    pillar: 'spending_patterns',
    traitType: 'observed_fact',
    value: { itemsWithPrice, totalSpend: Math.round(totalSpend * 100) / 100, categorySpend },
    confidence: confidenceFromCount(itemsWithPrice, 10),
    computedAt: new Date().toISOString(),
  };

  const overallAvg = itemsWithPrice ? totalSpend / itemsWithPrice : 0;
  const aboveAverageCategories = Object.entries(categorySpend)
    .filter(([, v]) => overallAvg > 0 && v.avg > overallAvg * 1.2)
    .map(([type]) => type)
    .sort();

  const spendTendency = {
    pillar: 'spending_patterns',
    traitType: 'inferred_preference',
    value: { overallAvg: Math.round(overallAvg * 100) / 100, aboveAverageCategories },
    signal: aboveAverageCategories.join(','),
    confidence: confidenceFromCount(itemsWithPrice, 15),
    computedAt: new Date().toISOString(),
  };

  return { 'spending_patterns.category_spend': categorySpendTrait, 'spending_patterns.spend_tendency': spendTendency };
}

// ---------------------------------------------------------------------------
// Pillar 4: occasion habits
// ---------------------------------------------------------------------------
const CASUAL_OCCASIONS = new Set(['casual', 'athletic', 'beach', 'outdoor']);
const FORMAL_OCCASIONS = new Set(['formal', 'business', 'wedding']);

async function computeOccasionHabits(userId) {
  const outfits = await Outfit.findAll({
    where: { userId, isActive: true },
    attributes: ['occasion', 'wearCount'],
    raw: true,
  });
  const totalOutfits = outfits.length;
  const occasionCounts = {};
  const occasionWearCounts = {};
  for (const o of outfits) {
    const occasion = o.occasion || 'unspecified';
    occasionCounts[occasion] = (occasionCounts[occasion] || 0) + 1;
    occasionWearCounts[occasion] = (occasionWearCounts[occasion] || 0) + (o.wearCount || 0);
  }
  const topOccasion = Object.entries(occasionCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const occasionDistribution = {
    pillar: 'occasion_habits',
    traitType: 'observed_fact',
    value: { totalOutfits, occasionCounts, topOccasion },
    confidence: confidenceFromCount(totalOutfits, 10),
    computedAt: new Date().toISOString(),
  };

  const totalWearEvents = Object.values(occasionWearCounts).reduce((a, b) => a + b, 0);
  let casualShare = 0;
  let formalShare = 0;
  if (totalWearEvents > 0) {
    for (const [occasion, count] of Object.entries(occasionWearCounts)) {
      if (CASUAL_OCCASIONS.has(occasion)) casualShare += count;
      else if (FORMAL_OCCASIONS.has(occasion)) formalShare += count;
    }
    casualShare = pct(casualShare, totalWearEvents);
    formalShare = pct(formalShare, totalWearEvents);
  }
  const lean = totalWearEvents === 0 ? 'unknown' : casualShare >= formalShare + 15 ? 'casual-leaning'
    : formalShare >= casualShare + 15 ? 'formal-leaning' : 'balanced';

  const formalityLean = {
    pillar: 'occasion_habits',
    traitType: 'inferred_preference',
    value: { casualShare, formalShare, totalWearEvents, lean },
    signal: lean,
    confidence: confidenceFromCount(totalWearEvents, 10),
    computedAt: new Date().toISOString(),
  };

  return { 'occasion_habits.occasion_distribution': occasionDistribution, 'occasion_habits.formality_lean': formalityLean };
}

// ---------------------------------------------------------------------------
// Closet health score -- Phase 10 (PRD §3.11, scoped 2026-09-18).
//
// Deliberately NOT one of the four Phase 9 pillars above (it isn't in
// TRAIT_PILLARS, and it has no inferred_preference companion -- the
// 2026-09-18 decision was a single, simple, explainable number, not a
// blended score). Computed alongside the same nightly synthesis pass so
// it shows up in the existing "what I know about you" dashboard
// (profileDashboard.service.js) as one more card, rather than a new
// screen or its own nightly job.
// ---------------------------------------------------------------------------
const CLOSET_HEALTH_WINDOW_DAYS = parseInt(process.env.CLOSET_HEALTH_WINDOW_DAYS || '60', 10);

async function computeClosetHealthScore(userId) {
  const cutoff = new Date(Date.now() - CLOSET_HEALTH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const items = await Clothes.findAll({
    where: { userId, isActive: true },
    attributes: ['lastWornAt'],
    raw: true,
  });
  const totalItems = items.length;
  const wornRecently = items.filter((i) => i.lastWornAt && new Date(i.lastWornAt) >= cutoff).length;

  return {
    'closet_health.wear_recency': {
      pillar: 'closet_health',
      traitType: 'observed_fact', // arithmetic over the user's own rows, same as any other observed_fact -- suppress-only, never "wrong"
      value: { totalItems, wornRecently, windowDays: CLOSET_HEALTH_WINDOW_DAYS, percentWornRecently: pct(wornRecently, totalItems) },
      confidence: confidenceFromCount(totalItems, 10),
      computedAt: new Date().toISOString(),
    },
  };
}

async function computeStructuredTraits(userId) {
  const [style, travel, spending, occasion, closetHealth] = await Promise.all([
    computeStyleEvolution(userId),
    computeTravelInterests(userId),
    computeSpendingPatterns(userId),
    computeOccasionHabits(userId),
    computeClosetHealthScore(userId),
  ]);
  return { ...style, ...travel, ...spending, ...occasion, ...closetHealth };
}

/**
 * Merges the previous userCorrections against freshly-computed traits.
 * - `suppress` (observed_fact) and `scope_only` (either type) never
 *   auto-clear -- those aren't disputes with evidence, so there's nothing
 *   for the nightly job to "resolve".
 * - `override`/`delete` (inferred_preference only) auto-clear once the
 *   freshly-computed trait's `signal` has diverged from the value at the
 *   time of correction for REVERSAL_STREAK_NIGHTS consecutive nights --
 *   a real, sustained reversal, not noisy short-term signal. Resets the
 *   streak back to 0 the moment a night doesn't diverge, so a one-off
 *   blip never accumulates toward a reversal.
 */
function applyCorrectionsAndDetectReversal(existingCorrections, freshTraits) {
  const updated = {};
  const reproposedTraitKeys = [];

  for (const [traitKey, correction] of Object.entries(existingCorrections || {})) {
    const fresh = freshTraits[traitKey];

    if (!fresh || correction.correctionType === 'suppress' || correction.correctionType === 'scope_only') {
      updated[traitKey] = correction;
      continue;
    }

    if (correction.correctionType === 'override' || correction.correctionType === 'delete') {
      if (fresh.traitType !== 'inferred_preference' || correction.baselineSignal == null) {
        updated[traitKey] = correction;
        continue;
      }
      const diverges = fresh.signal !== correction.baselineSignal;
      if (diverges) {
        const reversalStreak = (correction.reversalStreak || 0) + 1;
        if (reversalStreak >= REVERSAL_STREAK_NIGHTS) {
          reproposedTraitKeys.push(traitKey); // dropped from `updated` -- correction cleared, trait re-proposed fresh
          continue;
        }
        updated[traitKey] = { ...correction, reversalStreak };
      } else {
        updated[traitKey] = { ...correction, reversalStreak: 0 };
      }
      continue;
    }

    updated[traitKey] = correction;
  }

  return { updatedCorrections: updated, reproposedTraitKeys };
}

async function synthesizeProfileForUser(userId) {
  const freshTraits = await computeStructuredTraits(userId);

  let summary = await UserProfileSummary.findOne({ where: { userId } });
  if (!summary) {
    summary = await UserProfileSummary.create({ userId, version: 0, structuredTraits: {}, userCorrections: {} });
  }

  const { updatedCorrections, reproposedTraitKeys } = applyCorrectionsAndDetectReversal(
    summary.userCorrections,
    freshTraits
  );

  await summary.update({
    structuredTraits: freshTraits,
    userCorrections: updatedCorrections,
    version: (summary.version || 0) + 1,
    computedAt: new Date(),
  });

  if (reproposedTraitKeys.length > 0) {
    logger.info('Profile trait(s) re-proposed after a sustained behavior reversal', { userId, traitKeys: reproposedTraitKeys });
  }

  return summary;
}

/**
 * "Active" for the nightly synthesis pass = has at least one wardrobe
 * item -- the minimum real data every pillar's observed_fact traits need
 * to be non-trivial. Mirrors preferenceLearningQueue's own
 * activity-scoping pattern (bound the nightly job's DB cost to real
 * usage), just scoped to a different activity signal since this job's
 * traits lean more on wardrobe/trip/preference data than raw interaction
 * volume specifically.
 */
async function getActiveUserIdsForSynthesis() {
  const rows = await Clothes.findAll({
    where: { isActive: true },
    attributes: [[fn('DISTINCT', col('user_id')), 'userId']],
    raw: true,
  });
  return rows.map((r) => r.userId).filter(Boolean);
}

module.exports = {
  TRAIT_PILLARS,
  REVERSAL_STREAK_NIGHTS,
  computeStructuredTraits,
  computeClosetHealthScore,
  applyCorrectionsAndDetectReversal,
  synthesizeProfileForUser,
  getActiveUserIdsForSynthesis,
};
