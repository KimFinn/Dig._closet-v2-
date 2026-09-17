/**
 * Swap detection + outfit-regret detection — Phase 2.
 *
 * Both are pure reads over already-indexed, same-day-bounded rows
 * (RecommendationLog, UserInteraction) — no weather/vision/LLM API
 * calls, so calling this on every wear event has no paid-API cost, only
 * a couple of cheap indexed DB queries.
 *
 * Called from clothes.controller.js's recordWear and
 * outfit.controller.js's wearOutfit BEFORE they create their own 'wear'
 * UserInteraction row, so the result can be folded into that row's
 * `context` JSONB rather than needing a second write.
 */

const { RecommendationLog, UserInteraction } = require('../database/models');
const { Op } = require('sequelize');

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * "Item changed before confirming a suggestion" (PRD): the user was
 * shown a specific combination today (RecommendationLog) but what they
 * actually wore overlaps with one of those suggestions without being an
 * exact match — i.e. they swapped one or more pieces out.
 */
async function detectSwap(userId, wornItemIds = []) {
  if (!wornItemIds || wornItemIds.length === 0) return null;

  const recentLog = await RecommendationLog.findOne({
    where: { userId, createdAt: { [Op.gte]: startOfToday() } },
    order: [['createdAt', 'DESC']],
  });
  if (!recentLog || !Array.isArray(recentLog.recommendedOutfits)) return null;

  const wornSet = new Set(wornItemIds);
  let bestMatch = null;
  let bestOverlap = 0;

  for (const suggested of recentLog.recommendedOutfits) {
    const suggestedIds = suggested.itemIds || [];
    if (suggestedIds.length === 0) continue;
    const overlapCount = suggestedIds.filter((id) => wornSet.has(id)).length;
    const overlapRatio = overlapCount / suggestedIds.length;
    if (overlapRatio > bestOverlap) {
      bestOverlap = overlapRatio;
      bestMatch = suggested;
    }
  }

  if (!bestMatch) return null;

  const isExactMatch = bestOverlap === 1 && bestMatch.itemIds.length === wornItemIds.length;
  if (isExactMatch) return null; // wore exactly what was suggested -- not a swap

  // Require meaningful overlap (not just "shares one sock with a
  // suggestion") before calling it a swap rather than an unrelated outfit.
  if (bestOverlap >= 0.4) {
    return {
      isSwap: true,
      swappedFromItemIds: bestMatch.itemIds,
      overlapRatio: Math.round(bestOverlap * 100) / 100,
    };
  }
  return null;
}

/**
 * "Two wear events, same day, different outfits" (PRD): a proxy for
 * regretting the first choice and changing mid-day. Compares by
 * outfitId when the wear was outfit-level, else by itemId.
 */
async function detectRegret(userId, wearKey) {
  if (!wearKey) return null;

  const todaysWears = await UserInteraction.findAll({
    where: { userId, action: 'wear', createdAt: { [Op.gte]: startOfToday() } },
    order: [['createdAt', 'ASC']],
  });
  if (todaysWears.length === 0) return null;

  const priorKeys = new Set(todaysWears.map((w) => w.outfitId || w.itemId));
  if (priorKeys.has(wearKey)) return null; // wearing the same thing again isn't a regret signal

  return {
    isPossibleRegret: true,
    priorWearCountToday: todaysWears.length,
  };
}

/**
 * @param {string} userId
 * @param {Object} params
 * @param {string[]} [params.itemIds] - all clothing item ids in this wear event
 * @param {string} [params.outfitId] - set for an outfit-level wear
 * @returns {Promise<Object>} fields to merge into the new UserInteraction's `context`
 */
async function analyzeWearEvent(userId, { itemIds = [], outfitId = null } = {}) {
  const wearKey = outfitId || itemIds[0] || null;

  const [swap, regret] = await Promise.all([
    detectSwap(userId, itemIds),
    detectRegret(userId, wearKey),
  ]);

  return { ...(swap || {}), ...(regret || {}) };
}

module.exports = { detectSwap, detectRegret, analyzeWearEvent };
