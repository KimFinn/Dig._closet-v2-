/**
 * "On this day" memory resurfacing -- Phase 10 (PRD §3.11, scoped 2026-09-18).
 *
 * Looks back roughly a year for a real wear event on (near) the same
 * calendar date, and returns what was worn -- "this is what you wore to
 * [event] last year." Relies on `UserInteraction` rows with
 * `action: 'wear'`, which interactionRetention.service.js now exempts
 * from its 90-day purge specifically so this has something to query.
 *
 * Confidence-gate discipline, matching Phase 9's chatbot pattern: when a
 * user's own history doesn't reach back that far yet, this honestly
 * returns `hasMemory: false` rather than guessing or reaching for a
 * lesser substitute silently.
 */

const { Op } = require('sequelize');
const { UserInteraction, Clothes, Outfit } = require('../database/models');

const WINDOW_DAYS = parseInt(process.env.ON_THIS_DAY_WINDOW_DAYS || '1', 10);
const LOOKBACK_YEARS = parseInt(process.env.ON_THIS_DAY_LOOKBACK_YEARS || '1', 10);

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Finds the single most relevant wear event from ~LOOKBACK_YEARS ago,
 * within ±WINDOW_DAYS of today's date. Picks the closest-to-exact-date
 * match when more than one wear event falls in the window.
 */
async function getOnThisDayMemory(userId, { now = new Date() } = {}) {
  const anniversary = new Date(now);
  anniversary.setFullYear(anniversary.getFullYear() - LOOKBACK_YEARS);
  const rangeStart = addDays(anniversary, -WINDOW_DAYS);
  const rangeEnd = addDays(anniversary, WINDOW_DAYS + 1); // +1 to make the end date inclusive

  const candidates = await UserInteraction.findAll({
    where: {
      userId,
      action: 'wear',
      createdAt: { [Op.gte]: rangeStart, [Op.lt]: rangeEnd },
    },
    order: [['createdAt', 'ASC']],
  });

  if (candidates.length === 0) {
    return { hasMemory: false, reason: 'no_history_that_far_back' };
  }

  // Closest to the exact anniversary date wins if several fall in the window.
  const best = candidates.reduce((closest, row) => {
    const diff = Math.abs(new Date(row.createdAt) - anniversary);
    const closestDiff = Math.abs(new Date(closest.createdAt) - anniversary);
    return diff < closestDiff ? row : closest;
  }, candidates[0]);

  let item = null;
  let outfit = null;
  if (best.itemId) {
    item = await Clothes.findByPk(best.itemId, { attributes: ['id', 'type', 'color', 'brand', 'imageUrl'] });
  }
  if (best.outfitId) {
    outfit = await Outfit.findByPk(best.outfitId, { attributes: ['id', 'name', 'occasion', 'items'] });
  }

  if (!item && !outfit) {
    // The item/outfit itself was deleted since -- honest fallback rather
    // than surfacing a memory of nothing.
    return { hasMemory: false, reason: 'referenced_item_no_longer_exists' };
  }

  return {
    hasMemory: true,
    wornOn: best.createdAt,
    yearsAgo: LOOKBACK_YEARS,
    item: item ? { id: item.id, type: item.type, color: item.color, brand: item.brand, imageUrl: item.imageUrl } : null,
    outfit: outfit ? { id: outfit.id, name: outfit.name, occasion: outfit.occasion } : null,
  };
}

module.exports = { getOnThisDayMemory };
