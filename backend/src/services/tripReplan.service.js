/**
 * Shared trip replan capability -- Phase 7 (PRD §3.8 / §6.1 step 7).
 *
 * Before this file, "something changed, re-flow whatever depends on
 * it" only existed for one thing: tripMaintenanceQueue's forecast-drift
 * pass regenerates the packing list (and only the packing list) on a
 * real weather change. The PRD calls for that to be "one shared
 * capability, not several parallel implementations" once activities
 * and a budget tracker exist alongside the packing list -- so this
 * module is that one shared entry point, called from every place a
 * trip-affecting change happens:
 *
 *   1. tripMaintenanceQueue's nightly forecast-drift pass, right after
 *      it regenerates the packing list for a trip whose forecast
 *      shifted -- the same drifted dates almost certainly have
 *      TripActivity rows whose previously-generated outfit no longer
 *      matches the new forecast (e.g. planned outfit assumed dry, the
 *      new forecast says rain).
 *   2. tripActivity.service's updateActivity/deleteActivity, whenever
 *      an activity's date or status changes (rescheduled, skipped,
 *      restored, deleted) -- the old and/or new date's outfit plan for
 *      that trip may now be wrong or simply moot.
 *
 * What "re-flow" means here, concretely:
 *   - Outfits: regenerate + relink the outfit for every still-active
 *     TripActivity on the affected dates (skips 'skipped' activities --
 *     no point planning an outfit for something that isn't happening).
 *     One bad activity never aborts the rest -- same
 *     "don't let one failure block the batch" standard as
 *     tripMaintenanceQueue's own passes.
 *   - Budget: budgetTracker.service already computes the trip's
 *     summary fresh from the DB on every call (nothing is cached or
 *     persisted), so there's nothing to "regenerate" there -- this
 *     just re-reads it once, after the outfit pass, so callers (e.g.
 *     an email, or the HTTP response) can surface the latest numbers
 *     in the same reply instead of the caller having to know to ask
 *     twice.
 *
 * Deliberately NOT covered: Outing (not trip-scoped -- no forecast and
 * no budget tracker attached to it, so there's nothing shared to
 * re-flow) and the destination-advisory/culture data (static reference
 * data refreshed on its own schedule, not something a trip change
 * should trigger).
 */

const logger = require('../utils/logger');
const { TripActivity } = require('../database/models');
// Deliberately reuses the low-level activityOutfit.service directly
// rather than tripActivity.service's generateOutfitForActivity wrapper:
// tripActivity.service calls INTO this module (on reschedule/skip), so
// depending on it back would be a require cycle. The 3 lines that
// wrapper adds on top (persist + relink) are duplicated below instead.
const { recommendAndPersistOutfitForActivity } = require('./activityOutfit.service');
const { getTripBudgetSummary } = require('./budgetTracker.service');

// 'skipped' is the only status that means "not happening" -- nothing to
// plan an outfit for. 'replaced' still refers to a real activity slot
// (the thing that replaced whatever was there before), so it's treated
// as active, same as 'planned'/'confirmed'.
const SKIP_OUTFIT_REPLAN_STATUSES = new Set(['skipped']);

/**
 * Re-flows outfits (and surfaces a fresh budget summary) for one trip.
 *
 * @param {string} userId
 * @param {string} tripId
 * @param {object} options
 * @param {string[]|null} options.dates - dates to re-flow, e.g. the
 *   drifted dates from a forecast recheck, or the old+new date of a
 *   rescheduled activity. `null` means "every activity on this trip"
 *   (used for a full/manual replan); `[]` is a no-op on the activity
 *   side but still returns a fresh budget summary.
 * @param {string} options.trigger - 'weather_drift' | 'activity_changed' | 'manual'
 */
async function replanTripForDates(userId, tripId, { dates = null, trigger = 'manual' } = {}) {
  const activitiesReplanned = [];
  const activitiesFailed = [];

  if (!Array.isArray(dates) || dates.length > 0) {
    const where = { tripId };
    if (Array.isArray(dates)) where.date = dates;

    const activities = await TripActivity.findAll({ where });

    for (const activity of activities) {
      if (SKIP_OUTFIT_REPLAN_STATUSES.has(activity.status)) continue;
      try {
        const result = await recommendAndPersistOutfitForActivity(userId, activity);
        if (result.outfit) {
          await activity.update({ linkedOutfitId: result.outfit.id });
        }
        activitiesReplanned.push({
          activityId: activity.id,
          date: activity.date,
          outfitId: result.outfit ? result.outfit.id : null,
        });
      } catch (error) {
        activitiesFailed.push({ activityId: activity.id, date: activity.date, error: error.message });
        logger.warn('Shared trip replan: activity outfit regen failed, skipping', {
          tripId, activityId: activity.id, error: error.message,
        });
      }
    }
  }

  const budgetSummary = await safeBudgetSummary(userId, tripId);

  logger.info('Shared trip replan complete', {
    tripId, trigger, replanned: activitiesReplanned.length, failed: activitiesFailed.length,
  });

  return { trigger, activitiesReplanned, activitiesFailed, budgetSummary };
}

/**
 * The budget summary is a nice-to-have on the result (e.g. so an email
 * can mention it) -- never let a budget read failure block the outfit
 * replanning that's the actual point of this call.
 */
async function safeBudgetSummary(userId, tripId) {
  try {
    return await getTripBudgetSummary(userId, tripId);
  } catch (error) {
    logger.warn('Shared trip replan: budget summary read failed, omitting', { tripId, error: error.message });
    return null;
  }
}

module.exports = { replanTripForDates };
