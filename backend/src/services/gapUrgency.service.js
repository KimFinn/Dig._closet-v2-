/**
 * Gap urgency classification -- Phase 5 (Gap-to-Purchase Funnel, PRD
 * §3.14). Answers one question: is there enough time left for a normal
 * affiliate purchase to actually arrive before the item is needed?
 *
 * The mismatch this exists to catch: gap detection can fire mid-trip,
 * when someone needs an item today or tomorrow, but affiliate purchases
 * inherit ordinary e-commerce shipping timelines (often 3-7+ days). A
 * purchase link that can't arrive in time isn't a real answer -- it
 * should route to the existing Phase 4 best-available-packed-outfit
 * fallback instead (see PRD §3.12 / AIOutfit recommendation.js's
 * _buildBestAvailableFallbackOutfit).
 *
 * SHIPPING_LEAD_TIME_DAYS is PRD §8 open decision #13 -- a reasonable
 * starting default, meant to be revisited once real order/delivery data
 * exists, not a value with any real research behind it yet.
 */

const SHIPPING_LEAD_TIME_DAYS = parseInt(process.env.GAP_SHIPPING_LEAD_TIME_DAYS || '7', 10);

function daysBetween(fromDate, toDate) {
  const MS_PER_DAY = 1000 * 60 * 60 * 24;
  // Normalize both to UTC midnight of their own calendar date -- NOT
  // Date.setHours(), which uses the server's LOCAL timezone. This
  // container runs in UTC+3; a UTC instant like "00:01Z" is already past
  // local midnight, so local setHours(0,0,0,0) can silently round it up
  // to the *next* calendar day and throw the day count off by one right
  // at day boundaries (caught live by this file's own verification, not
  // theoretical). Every other date-keying convention in this codebase
  // (tripService._toDateKey) is UTC-based for the same reason -- this
  // matches it rather than introducing a second convention.
  const toUtcMidnight = (d) => {
    const date = new Date(d);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  };
  const from = toUtcMidnight(fromDate);
  const to = toUtcMidnight(toDate);
  return Math.round((to - from) / MS_PER_DAY);
}

/**
 * @param {object} opts
 * @param {Date|string|null} [opts.neededByDate] - the date the item is
 *   actually needed (e.g. the trip day/activity the gap was detected
 *   for, or the trip's start date as a conservative default). null/
 *   undefined means there's no known deadline (a gap surfaced outside
 *   trip context, just browsing normal recommendations) -- treated as
 *   purchase-eligible, since there's no shipping constraint to violate.
 * @param {Date|string} [opts.today] - defaults to now; parameterized for
 *   testability.
 * @param {number} [opts.leadTimeDays] - defaults to
 *   SHIPPING_LEAD_TIME_DAYS.
 * @returns {{urgency: 'purchase_eligible'|'too_urgent', daysUntilNeeded: number|null, leadTimeDays: number}}
 */
function classifyGapUrgency({ neededByDate = null, today = new Date(), leadTimeDays = SHIPPING_LEAD_TIME_DAYS } = {}) {
  if (!neededByDate) {
    return { urgency: 'purchase_eligible', daysUntilNeeded: null, leadTimeDays };
  }

  const daysUntilNeeded = daysBetween(today, neededByDate);

  // A date already in the past (e.g. the trip day already happened) is
  // treated the same as "no time left" -- too urgent, not a negative
  // lead time that somehow still passes the >= check.
  const urgency = daysUntilNeeded >= leadTimeDays ? 'purchase_eligible' : 'too_urgent';

  return { urgency, daysUntilNeeded, leadTimeDays };
}

module.exports = { classifyGapUrgency, SHIPPING_LEAD_TIME_DAYS };
