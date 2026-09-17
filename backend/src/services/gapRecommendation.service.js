/**
 * Descriptive gap recommendations -- Phase 5 (Gap-to-Purchase Funnel,
 * PRD §3.14 / §3.5).
 *
 * Does NOT do gap detection itself -- packaging.service.js's
 * generatePackingList() already produces a `gaps` array (category, date,
 * occasion, weather, a human-readable message) every time a packing list
 * is generated. This service is the layer on top of that: turn each raw
 * gap into a funnel-tracked recommendation (RecommendationLog row,
 * recommendationType: 'gap_purchase'), tagged with urgency (can a normal
 * affiliate purchase arrive in time?) and the user's resolved region --
 * still with NO retailer link at this stage (that's the next piece,
 * affiliateLink.service.js).
 *
 * Dedup, not re-suggest: a trip regenerating its packing list (weather
 * update, activity edit, luggage change) can easily re-surface the exact
 * same gap on every regenerate. Re-creating a 'suggested' row each time
 * would spam the funnel and, worse, blow away any progress a user had
 * already made on that gap (clicked/purchased) by resetting it back to
 * 'suggested'. So: only create a new row for a gap signature
 * (category + date + occasion) not already logged for this trip; existing
 * rows are left untouched regardless of their current funnel stage.
 */

const { User, RecommendationLog } = require('../database/models');
const { resolveUserRegion } = require('./region.service');
const { classifyGapUrgency } = require('./gapUrgency.service');
const logger = require('../utils/logger');

// "wardrobe" is packaging.service.js's degenerate gap ("no active
// wardrobe items found at all") -- not a specific missing category, and
// has no date to classify urgency against. Not a purchase-funnel case.
const NON_PURCHASABLE_GAP_CATEGORIES = new Set(['wardrobe']);

function gapSignature(gap) {
  return `${gap.category}|${gap.date}|${gap.occasion || ''}`;
}

function buildGapDetails(gap) {
  return {
    category: gap.category,
    date: gap.date,
    time: gap.time || null,
    occasion: gap.occasion || null,
    message: gap.message,
    weather: gap.weather
      ? {
          temp: gap.weather.temp,
          condition: gap.weather.condition,
          precipitation: gap.weather.precipitation,
          forecastType: gap.weather.forecastType,
        }
      : null,
  };
}

/**
 * @param {string} userId
 * @param {string|null} tripId - null for a non-trip-context gap (not
 *   currently produced anywhere, but the funnel logging doesn't assume
 *   a trip is required).
 * @param {Array<object>} gaps - packaging.service.js's `gaps` array.
 * @returns {Promise<{created: number, skipped: number, tooUrgent: number}>}
 */
async function recordGapRecommendations(userId, tripId, gaps) {
  if (!gaps || gaps.length === 0) return { created: 0, skipped: 0, tooUrgent: 0 };

  const purchasable = gaps.filter((g) => !NON_PURCHASABLE_GAP_CATEGORIES.has(g.category));
  if (purchasable.length === 0) return { created: 0, skipped: 0, tooUrgent: 0 };

  const user = await User.findByPk(userId);
  if (!user) {
    logger.warn('recordGapRecommendations: user not found, skipping', { userId });
    return { created: 0, skipped: 0, tooUrgent: 0 };
  }

  const { region } = await resolveUserRegion(user);

  const existing = tripId
    ? await RecommendationLog.findAll({
        where: { userId, tripId, recommendationType: 'gap_purchase' },
        attributes: ['gapDetails'],
      })
    : [];
  const existingSignatures = new Set(
    existing
      .map((row) => row.gapDetails)
      .filter(Boolean)
      .map((details) => `${details.category}|${details.date}|${details.occasion || ''}`)
  );

  let created = 0;
  let skipped = 0;
  let tooUrgent = 0;

  for (const gap of purchasable) {
    const signature = gapSignature(gap);
    if (existingSignatures.has(signature)) {
      skipped++;
      continue;
    }

    const { urgency, daysUntilNeeded } = classifyGapUrgency({ neededByDate: gap.date });
    if (urgency === 'too_urgent') tooUrgent++;

    try {
      await RecommendationLog.create({
        userId,
        tripId: tripId || null,
        recommendationType: 'gap_purchase',
        funnelStage: 'suggested',
        gapDetails: buildGapDetails(gap),
        urgency,
        region,
      });
      created++;
      existingSignatures.add(signature); // guard against duplicate gaps within the same batch
    } catch (error) {
      // Never let a logging failure break packing-list generation, which
      // is what actually matters to the caller -- same "degrade, don't
      // fail the caller" pattern used throughout this codebase.
      logger.warn('Failed to record gap_purchase recommendation', {
        userId, tripId, gap: signature, error: error.message,
      });
    }
  }

  return { created, skipped, tooUrgent };
}

module.exports = { recordGapRecommendations, NON_PURCHASABLE_GAP_CATEGORIES };
