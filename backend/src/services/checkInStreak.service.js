/**
 * Daily check-in streak -- Phase 10 (PRD §3.11, scoped 2026-09-18).
 *
 * "Checking in" is simply logging a wear -- no separate tap to build,
 * since the streak should ride on data the app already captures for the
 * learning loop, not add a new interaction type.
 *
 * Non-punitive by mechanics, not just by copy (2026-09-18 decision): a
 * missed day FREEZES the streak at its current count instead of
 * resetting it to 0. Concretely, `currentStreak` counts distinct
 * calendar days (in the user's own local timezone) on which the user
 * checked in at least once, and it only ever increases -- there is no
 * code path that decrements or zeroes it. A gap of any length simply
 * doesn't add to it; the very next check-in, whenever it happens,
 * continues from wherever the streak already was rather than
 * restarting at 1. `longestStreak` tracks the high-water mark for
 * display ("your best streak").
 *
 * Deliberately called from the wear-logging call sites themselves
 * (clothes.controller.js#recordWear, outfit.controller.js#wearOutfit)
 * rather than a nightly job -- the streak should reflect the moment the
 * user actually checked in, not a batch recomputation hours later.
 */

const { User } = require('../database/models');
const logger = require('../utils/logger');

/**
 * The user's own local calendar date ("YYYY-MM-DD"), given their stored
 * IANA timezone. Falls back to UTC when no timezone has been captured
 * yet (see auth.controller.js#updateProfile) -- matches how every other
 * timezone-aware piece of Phase 10 degrades when this is unset, so an
 * account created before this field existed behaves exactly as it did
 * under Phase 2's UTC-only daily check-in.
 */
function getLocalDateString(timezone, now = new Date()) {
  const tz = timezone || 'UTC';
  try {
    // en-CA formats as YYYY-MM-DD directly -- avoids a second parse step.
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch (error) {
    logger.warn('Invalid/unknown timezone, falling back to UTC for local-date calculation', { timezone, error: error.message });
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

/**
 * The user's own current local hour (0-23), given their stored IANA
 * timezone. Falls back to UTC when unset. Used by
 * queues/checkInQueue.js to decide whether "now" is this user's chosen
 * evening-digest send time.
 */
function getLocalHour(timezone, now = new Date()) {
  const tz = timezone || 'UTC';
  try {
    const hourStr = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now);
    // Some locales render midnight as "24" with hour12:false -- normalize.
    return parseInt(hourStr, 10) % 24;
  } catch (error) {
    logger.warn('Invalid/unknown timezone, falling back to UTC for local-hour calculation', { timezone, error: error.message });
    return now.getUTCHours();
  }
}

function daysBetween(dateStringA, dateStringB) {
  const a = new Date(`${dateStringA}T00:00:00Z`);
  const b = new Date(`${dateStringB}T00:00:00Z`);
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * Called on every wear event. Idempotent within a single local day --
 * calling this more than once on the same day (e.g. wearing two items)
 * only counts as one check-in.
 */
async function recordCheckIn(userId, { now = new Date() } = {}) {
  const user = await User.findByPk(userId, {
    attributes: ['id', 'timezone', 'currentStreak', 'longestStreak', 'lastCheckInDate'],
  });
  if (!user) return null;

  const today = getLocalDateString(user.timezone, now);

  if (user.lastCheckInDate === today) {
    // Already checked in today -- no-op, not a fresh day.
    return { currentStreak: user.currentStreak, longestStreak: user.longestStreak, lastCheckInDate: user.lastCheckInDate, alreadyCheckedInToday: true };
  }

  // Any prior date (yesterday, or a gap of any length, or never) counts
  // as a fresh day -- the streak increments either way. The gap length
  // itself is deliberately not inspected: "freeze, don't reset" means a
  // 1-day gap and a 30-day gap are treated identically, both just
  // resuming the count rather than either being penalized.
  const newStreak = (user.currentStreak || 0) + 1;
  const newLongest = Math.max(newStreak, user.longestStreak || 0);

  await user.update({ currentStreak: newStreak, longestStreak: newLongest, lastCheckInDate: today });

  return { currentStreak: newStreak, longestStreak: newLongest, lastCheckInDate: today, alreadyCheckedInToday: false };
}

module.exports = { recordCheckIn, getLocalDateString, getLocalHour, daysBetween };
