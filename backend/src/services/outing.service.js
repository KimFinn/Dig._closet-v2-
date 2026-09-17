/**
 * Outing CRUD -- Phase 7 (PRD §3.8). The non-trip counterpart to
 * TripActivity: a lightweight local activity plan (e.g. a weekend
 * hangout in the user's home city) that deliberately doesn't go through
 * the Trip model -- no packing list, no luggage constraints, no
 * trip-mode wardrobe restriction, since the user has full wardrobe
 * access at home. Reuses the same shared outfit mechanism as
 * TripActivity (activityOutfit.service.js).
 */

const { Outing } = require('../database/models');
const { recommendAndPersistOutfitForActivity } = require('./activityOutfit.service');
const { searchPlaces } = require('./places.service');
const logger = require('../utils/logger');

/**
 * @param {object} data - { title, date, timeSlot, occasion, category,
 *   locationText, budgetAmount, budgetCurrency }
 */
async function createOuting(userId, data) {
  if (!data.title || !data.date) {
    const err = new Error('An outing needs at least a title and a date');
    err.statusCode = 400;
    throw err;
  }

  let placeId = null;
  if (data.locationText) {
    try {
      const { results } = await searchPlaces(`${data.locationText}`);
      placeId = results[0]?.placeId || null;
    } catch (error) {
      logger.warn('Places lookup failed while creating outing, continuing without a place_id', { userId, error: error.message });
    }
  }

  return Outing.create({
    userId,
    title: data.title,
    date: data.date,
    timeSlot: data.timeSlot || null,
    occasion: data.occasion || null,
    category: data.category || null,
    locationText: data.locationText || null,
    placeId,
    budgetAmount: data.budgetAmount ?? null,
    budgetCurrency: data.budgetCurrency || null,
  });
}

async function listOutings(userId) {
  return Outing.findAll({ where: { userId }, order: [['date', 'ASC'], ['timeSlot', 'ASC']] });
}

async function getOuting(userId, outingId) {
  const outing = await Outing.findOne({ where: { id: outingId, userId } });
  if (!outing) {
    const err = new Error('Outing not found');
    err.statusCode = 404;
    throw err;
  }
  return outing;
}

async function updateOuting(userId, outingId, data) {
  const outing = await getOuting(userId, outingId);
  const allowed = ['title', 'date', 'timeSlot', 'occasion', 'category', 'locationText', 'placeId', 'budgetAmount', 'budgetCurrency', 'status'];
  const updates = {};
  for (const key of allowed) {
    if (data[key] !== undefined) updates[key] = data[key];
  }
  await outing.update(updates);
  return outing;
}

async function deleteOuting(userId, outingId) {
  const outing = await getOuting(userId, outingId);
  await outing.destroy();
  return { id: outingId };
}

/**
 * Generates and links an outfit recommendation for this outing's
 * occasion. The user is, by definition, not on a Trip while planning a
 * local outing, so recommendOutfits() naturally uses the full wardrobe
 * -- no special-casing needed here, see activityOutfit.service.js.
 */
async function generateOutfitForOuting(userId, outingId) {
  const outing = await getOuting(userId, outingId);
  const result = await recommendAndPersistOutfitForActivity(userId, outing);
  if (result.outfit) {
    await outing.update({ linkedOutfitId: result.outfit.id });
  }
  return { outing, ...result };
}

module.exports = {
  createOuting,
  listOutings,
  getOuting,
  updateOuting,
  deleteOuting,
  generateOutfitForOuting,
};
