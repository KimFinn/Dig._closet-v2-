/**
 * Mode A / Mode B trip-activity planning -- Phase 7 (PRD §3.8), built
 * together per the brainstorm decision (not sequenced).
 *
 * Mode A -- destination-anchored: the user already knows where/why and
 * wants the system to fill in leisure time around fixed commitments.
 * fillLeisureTime() finds open time slots on an existing trip and
 * proposes real, Places-backed activities for them, using the user's
 * travel interest profile (UserPreferences.activityCategories/
 * cuisinePreferences).
 *
 * Mode B -- open-ended leisure: the user hasn't decided a destination
 * ("somewhere warm in December"). suggestDestinations() has no live
 * "recommend me a destination" API to lean on -- there isn't a clean
 * one -- so, like the cost/culture tables elsewhere in Phase 7, this is
 * a small curated shortlist (destinationCandidates.data.js) ranked
 * against the user's stated criteria and interests.
 */

const { Trip, TripActivity, UserPreferences } = require('../database/models');
const { findNearbyForInterest } = require('./places.service');
const { DESTINATION_CANDIDATES } = require('../data/destinationCandidates.data');
const logger = require('../utils/logger');

const SLOT_ORDER = ['morning', 'afternoon', 'evening'];

function toDateKey(d) {
  const date = new Date(d);
  return date.toISOString().split('T')[0];
}

function tripDateRange(trip) {
  const dates = [];
  const cur = new Date(trip.startDate);
  const end = new Date(trip.endDate);
  while (cur <= end) {
    dates.push(toDateKey(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

/**
 * Mode A -- fills open leisure slots on an existing trip with real
 * Places-backed suggestions, persisted as TripActivity rows
 * (status: 'planned', notes flagging them as system-suggested so the
 * user can tell a suggestion apart from something they entered
 * themselves and can freely edit/skip/confirm it like any other
 * activity).
 *
 * @param {number} [options.maxSuggestions=2] - capped deliberately: this
 *   fills GAPS, it doesn't try to fully schedule someone's trip.
 */
async function fillLeisureTime(userId, tripId, options = {}) {
  const maxSuggestions = options.maxSuggestions ?? 2;

  const trip = await Trip.findOne({ where: { id: tripId, userId } });
  if (!trip) {
    const err = new Error('Trip not found');
    err.statusCode = 404;
    throw err;
  }

  const prefs = await UserPreferences.findOne({ where: { userId } });
  const interests = (prefs && prefs.activityCategories && prefs.activityCategories.length > 0)
    ? prefs.activityCategories
    : null;

  if (!interests) {
    return {
      created: [],
      message: 'Set your travel interests (activity categories) in preferences to get leisure-time suggestions filled in automatically.',
    };
  }

  const existing = await TripActivity.findAll({ where: { tripId }, attributes: ['date', 'timeSlot'] });
  const occupied = new Set(existing.map((a) => `${toDateKey(a.date)}|${a.timeSlot || ''}`));

  const openSlots = [];
  for (const dateKey of tripDateRange(trip)) {
    for (const slot of SLOT_ORDER) {
      if (!occupied.has(`${dateKey}|${slot}`)) {
        openSlots.push({ date: dateKey, timeSlot: slot });
      }
    }
    if (openSlots.length >= maxSuggestions) break;
  }

  const created = [];
  const locationText = trip.city && trip.country ? `${trip.city}, ${trip.country}` : trip.destination;

  for (let i = 0; i < Math.min(maxSuggestions, openSlots.length); i++) {
    const slot = openSlots[i];
    const interest = interests[i % interests.length];
    let place = null;
    try {
      const { results } = await findNearbyForInterest(interest, locationText, { count: 1 });
      place = results[0] || null;
    } catch (error) {
      logger.warn('Mode A leisure-fill Places lookup failed for one slot, skipping it', { tripId, interest, error: error.message });
      continue;
    }
    if (!place) continue;

    const activity = await TripActivity.create({
      tripId,
      date: slot.date,
      timeSlot: slot.timeSlot,
      occasion: 'casual',
      title: place.name,
      notes: 'Suggested by Mode A leisure-fill -- edit, confirm, or skip like any other activity.',
      category: interest,
      placeId: place.placeId,
      locationText,
      status: 'planned',
    });
    created.push(activity);
  }

  return { created, message: created.length === 0 ? 'No open slots found (or all trip days already fully planned).' : null };
}

/**
 * Mode B -- ranks the curated destination shortlist against the user's
 * criteria: an optional `vibe` (warm/cold/mild), an optional `month`
 * (1-12), and interests (explicit, or falls back to the user's own
 * activityCategories preference).
 */
async function suggestDestinations(userId, criteria = {}) {
  let interests = criteria.interests;
  if (!interests || interests.length === 0) {
    const prefs = await UserPreferences.findOne({ where: { userId } });
    interests = (prefs && prefs.activityCategories) || [];
  }

  const scored = DESTINATION_CANDIDATES
    .filter((d) => !criteria.vibe || d.climate === criteria.vibe)
    .filter((d) => !criteria.month || d.warmMonths.includes(Number(criteria.month)) || criteria.vibe !== 'warm')
    .map((d) => {
      const matchedInterests = interests.filter((i) => d.interestTags.includes(i));
      return { ...d, matchedInterests, score: matchedInterests.length };
    })
    .sort((a, b) => b.score - a.score);

  return { suggestions: scored.slice(0, 5) };
}

module.exports = { fillLeisureTime, suggestDestinations };
