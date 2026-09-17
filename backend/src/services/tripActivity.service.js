/**
 * TripActivity full logic -- Phase 7 (PRD §3.8). Activates the model
 * from "schema only, not used yet" (Phase 3) into a real, queryable
 * entity: time-slotted, per-day, occasion feeds outfit recommendation
 * the same way a full day currently does.
 *
 * trips.activities (JSONB on the Trip row) remains the input spec the
 * packing algorithm and auto-replan job read -- this module doesn't
 * touch that. TripActivity rows are the richer, queryable object that
 * Places/budget/outfit-linking attach to (Mode A/B planning,
 * feature-roadmap-tracker Phase 7).
 */

const { Trip, TripActivity } = require('../database/models');
const { recommendAndPersistOutfitForActivity } = require('./activityOutfit.service');
const { searchPlaces } = require('./places.service');
const { replanTripForDates } = require('./tripReplan.service');
const logger = require('../utils/logger');

async function assertOwnedTrip(userId, tripId) {
  const trip = await Trip.findOne({ where: { id: tripId, userId } });
  if (!trip) {
    const err = new Error('Trip not found');
    err.statusCode = 404;
    throw err;
  }
  return trip;
}

/**
 * @param {object} data - { date, timeSlot, occasion, title, notes,
 *   category, locationText, estimatedCost, categoryBudgetTag }
 */
async function createActivity(userId, tripId, data) {
  await assertOwnedTrip(userId, tripId);

  let placeId = null;
  if (data.locationText) {
    // Best-effort attach -- a Places lookup failure shouldn't block
    // creating the activity itself (same "never break the caller"
    // pattern as the rest of this app's external-API integrations).
    try {
      const { results } = await searchPlaces(`${data.locationText}`);
      placeId = results[0]?.placeId || null;
    } catch (error) {
      logger.warn('Places lookup failed while creating trip activity, continuing without a place_id', { tripId, error: error.message });
    }
  }

  return TripActivity.create({
    tripId,
    date: data.date,
    timeSlot: data.timeSlot || null,
    occasion: data.occasion || null,
    title: data.title || null,
    notes: data.notes || null,
    category: data.category || null,
    locationText: data.locationText || null,
    placeId,
    estimatedCost: data.estimatedCost ?? null,
    categoryBudgetTag: data.categoryBudgetTag || null,
  });
}

async function listActivitiesForTrip(userId, tripId) {
  await assertOwnedTrip(userId, tripId);
  return TripActivity.findAll({ where: { tripId }, order: [['date', 'ASC'], ['timeSlot', 'ASC']] });
}

async function getActivity(userId, activityId) {
  const activity = await TripActivity.findByPk(activityId, { include: [{ model: Trip, where: { userId } }] });
  if (!activity) {
    const err = new Error('Trip activity not found');
    err.statusCode = 404;
    throw err;
  }
  return activity;
}

async function updateActivity(userId, activityId, data) {
  const activity = await getActivity(userId, activityId);
  const oldDate = activity.date;
  const oldStatus = activity.status;

  const allowed = ['date', 'timeSlot', 'occasion', 'title', 'notes', 'category', 'locationText', 'placeId', 'estimatedCost', 'categoryBudgetTag', 'status'];
  const updates = {};
  for (const key of allowed) {
    if (data[key] !== undefined) updates[key] = data[key];
  }
  await activity.update(updates);

  // Phase 7 (PRD §6.1 step 7) -- shared replan: a rescheduled date or a
  // status flip (planned <-> skipped, etc.) can make the previously
  // generated outfit plan for the OLD date, the NEW date, or both wrong
  // or moot. Re-flow through the one shared capability rather than
  // hand-rolling outfit/budget logic here. Best-effort: a replan hiccup
  // should never fail the update itself (same "never break the caller"
  // standard as the rest of this app's external-dependent side effects).
  let replan = null;
  const dateChanged = updates.date !== undefined && updates.date !== oldDate;
  const statusChanged = updates.status !== undefined && updates.status !== oldStatus;
  if (dateChanged || statusChanged) {
    const affectedDates = [...new Set([oldDate, activity.date].filter(Boolean))];
    try {
      replan = await replanTripForDates(userId, activity.tripId, { dates: affectedDates, trigger: 'activity_changed' });
    } catch (error) {
      logger.warn('Shared replan after activity update failed, continuing without it', {
        activityId, tripId: activity.tripId, error: error.message,
      });
    }
  }

  return { activity, replan };
}

async function deleteActivity(userId, activityId) {
  const activity = await getActivity(userId, activityId);
  const { tripId } = activity;
  await activity.destroy();

  // Nothing left to plan an outfit for on this activity, but the trip's
  // live budget total just changed -- surface a fresh read via the same
  // shared capability rather than a one-off recompute here.
  let replan = null;
  try {
    replan = await replanTripForDates(userId, tripId, { dates: [], trigger: 'activity_changed' });
  } catch (error) {
    logger.warn('Shared replan after activity delete failed, continuing without it', { activityId, tripId, error: error.message });
  }

  return { id: activityId, replan };
}

/**
 * Generates and links an outfit recommendation for this activity's
 * occasion -- shared mechanism, see activityOutfit.service.js.
 */
async function generateOutfitForActivity(userId, activityId) {
  const activity = await getActivity(userId, activityId);
  const result = await recommendAndPersistOutfitForActivity(userId, activity);
  if (result.outfit) {
    await activity.update({ linkedOutfitId: result.outfit.id });
  }
  return { activity, ...result };
}

module.exports = {
  createActivity,
  listActivitiesForTrip,
  getActivity,
  updateActivity,
  deleteActivity,
  generateOutfitForActivity,
};
