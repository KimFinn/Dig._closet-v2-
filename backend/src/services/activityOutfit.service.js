/**
 * Shared occasion-aware outfit-recommendation mechanism -- Phase 7 (PRD
 * §3.8). The single piece of logic both `TripActivity` (trip-anchored)
 * and `Outing` (non-trip, local) attach an outfit through, so "what to
 * wear hiking" and "what to wear to a client dinner" stay one mechanism
 * regardless of whether the activity belongs to a multi-day trip or a
 * weekend hangout at home.
 *
 * Reuses `recommendOutfits(userId, occasion, options)` as-is -- it
 * already auto-detects trip mode from the user's own `isOnTrip()`/
 * `packedItems` state (Phase 4), so nothing here needs to special-case
 * "is this a Trip activity or an Outing": a TripActivity on an active
 * trip naturally gets the packed-items-only candidate pool, and an
 * Outing naturally gets the full wardrobe, because the user genuinely
 * isn't on a trip when they're planning a local hangout. No new
 * trip-mode logic needed -- this is a deliberate reuse, not a
 * coincidence.
 */

const { Outfit } = require('../database/models');
const { recommendOutfits } = require('./AIOutfit recommendation.js');
const logger = require('../utils/logger');

// Mirrors Outfit.occasion's validate.isIn list in models/index.js.
const ALLOWED_OUTFIT_OCCASIONS = new Set([
  'casual', 'formal', 'business', 'athletic', 'party', 'date', 'outdoor', 'beach', 'wedding', 'travel',
]);

function normalizeOccasionForOutfit(occasion) {
  if (occasion && ALLOWED_OUTFIT_OCCASIONS.has(occasion)) return occasion;
  return 'casual';
}

/**
 * Generates a recommendation for one time-slotted activity and persists
 * the top choice as a real `Outfit` row (so it has a stable id to link
 * from `TripActivity.linkedOutfitId` / `Outing.linkedOutfitId`) --
 * `recommendOutfits()` itself returns ephemeral item-combinations, not
 * persisted outfits, so that translation step happens here, once, for
 * both callers.
 *
 * @param {string} userId
 * @param {{title?: string, occasion?: string}} activityLike - works for
 *   both a TripActivity and an Outing instance/plain object.
 * @returns {Promise<{outfit: object|null, tripMode: boolean, tripGap: object|null, message: string|null}>}
 */
async function recommendAndPersistOutfitForActivity(userId, activityLike) {
  const requestedOccasion = activityLike.occasion || 'casual';
  const result = await recommendOutfits(userId, requestedOccasion, {});

  if (!result.outfits || result.outfits.length === 0) {
    return { outfit: null, tripMode: !!result.tripMode, tripGap: result.tripGap || null, message: result.message || null };
  }

  const top = result.outfits[0];
  const itemIds = (top.items || []).map((i) => i.id).filter(Boolean);
  if (itemIds.length === 0) {
    return { outfit: null, tripMode: !!result.tripMode, tripGap: result.tripGap || null, message: 'No usable items in the top recommendation' };
  }

  let outfit;
  try {
    outfit = await Outfit.create({
      userId,
      name: `${activityLike.title || requestedOccasion} outfit`,
      occasion: normalizeOccasionForOutfit(requestedOccasion),
      items: itemIds,
      isSuggested: true,
    });
  } catch (error) {
    logger.warn('Failed to persist activity outfit recommendation', { userId, error: error.message });
    return { outfit: null, tripMode: !!result.tripMode, tripGap: result.tripGap || null, message: 'Could not save outfit recommendation' };
  }

  return { outfit, tripMode: !!result.tripMode, tripGap: result.tripGap || null, message: null };
}

module.exports = { recommendAndPersistOutfitForActivity, normalizeOccasionForOutfit, ALLOWED_OUTFIT_OCCASIONS };
