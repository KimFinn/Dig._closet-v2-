/**
 * Trip maintenance queue (Bull + Redis) — Phase 3.
 *
 * One nightly repeatable job with two responsibilities, both bounded to
 * avoid unnecessary paid-API / DB traffic (same standing constraint as
 * Phase 2's queues):
 *
 *  1. Auto-replan on forecast drift: for trips that are upcoming (within
 *     REPLAN_LOOKAHEAD_DAYS) or already active, re-fetch the forecast
 *     (weather.service.js, OpenWeather-backed -- 30-minute Redis cache
 *     already built into that service, so this doesn't multiply real
 *     provider calls beyond one per unique city/date-range per cache
 *     window) and compare it against the forecast stored on the trip
 *     when the packing list was last generated. Only trips starting
 *     "soon" are checked at all -- a trip three months out has nothing
 *     but a climate-average estimate on both sides, which is not a
 *     meaningful drift signal, so checking it would just burn API calls
 *     for no benefit. Only on a real drift does this call
 *     tripService.regeneratePackingList() (which itself re-fetches
 *     weather -- a cache hit, given the fetch above) and send one email.
 *     No drift -> no regenerate, no email, matching the
 *     don't-do-unnecessary-work standard the rest of Phase 2/3 follows.
 *
 *  2. Forecast-accuracy tracking: for trip-days that have already
 *     happened (within OUTCOME_LOOKBACK_DAYS) and don't have a
 *     WeatherOutcome row yet, call
 *     historicalWeather.service.getHistoricalWeatherForDate() (Open-Meteo,
 *     genuinely free -- see that file's docblock) and write one row
 *     comparing what was forecast against what actually happened. Each
 *     (trip, date) pair is checked at most once ever, both because a
 *     unique index exists on (trip_id, date) and because this job
 *     pre-checks for an existing row before calling the API at all --
 *     so a trip's history doesn't get re-scanned night after night once
 *     it's fully accounted for. "specific" forecasts and (Phase 4)
 *     "historical-estimate" days are compared -- both are real data
 *     points, not guesses. Pure placeholder types (climate-average,
 *     seasonal-average -- see NON_COMPARABLE_FORECAST_TYPES) are
 *     skipped, since comparing an actual against a number that was
 *     never meant to be precise isn't a useful accuracy signal.
 *
 * Per-run caps on both passes exist for the same reason
 * checkInQueue.js's MAX_EMAILS_PER_RUN does: a bug that somehow widens
 * the candidate set (e.g. a bad query) shouldn't be able to blow through
 * a day's worth of API/email quota in one run.
 */

const Queue = require('bull');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { Trip, User, WeatherOutcome } = require('../database/models');
const { tripService } = require('../services/tripService');
const WeatherService = require('../services/weather.service');
const { getHistoricalWeatherForDate } = require('../services/historicalWeather.service');
const { sendNotification, tripReplanEmail } = require('../services/notification.service');
// Phase 7 (PRD §6.1 step 7) -- shared replan capability. A forecast
// drift doesn't just mean the packing list is stale: any TripActivity
// on one of the drifted dates may now have the wrong outfit linked
// (e.g. planned for dry weather, forecast now says rain), so the same
// drifted-dates list that triggers the packing-list regen below also
// re-flows those activities' outfits + a fresh budget read, through the
// one shared capability rather than a second parallel implementation.
const { replanTripForDates } = require('../services/tripReplan.service');

const redisConnection = {
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
};

const tripMaintenanceQueue = new Queue('trip-maintenance', { redis: redisConnection });

tripMaintenanceQueue.on('error', (err) => {
  logger.error('Trip maintenance queue error', { message: err.message });
});
tripMaintenanceQueue.on('failed', (job, err) => {
  logger.error('Trip maintenance job failed', { jobId: job.id, message: err.message });
});

// How many days out a trip has to be starting before it's even worth
// re-checking the forecast -- OpenWeather's forecast is only "specific"
// (not a climate-average guess) a handful of days out anyway, so
// checking further-out trips would just spend API calls comparing two
// estimates against each other.
const REPLAN_LOOKAHEAD_DAYS = parseInt(process.env.TRIP_REPLAN_LOOKAHEAD_DAYS || '7', 10);
// How big a temperature swing (°C) between the stored forecast and the
// freshly re-fetched one counts as "worth re-planning for", vs. normal
// day-to-day forecast wobble that isn't worth bothering the user about.
const DRIFT_TEMP_THRESHOLD_C = parseFloat(process.env.TRIP_REPLAN_DRIFT_TEMP_C || '5');
// Safety cap: at most this many trips get a forecast re-check in one run.
const MAX_REPLAN_CHECKS_PER_RUN = parseInt(process.env.TRIP_REPLAN_MAX_PER_RUN || '200', 10);

// How many days in the past a trip-day can be and still get a
// forecast-accuracy check. Bounds both the query (recently-relevant
// trips only) and the Open-Meteo call volume.
const OUTCOME_LOOKBACK_DAYS = parseInt(process.env.WEATHER_OUTCOME_LOOKBACK_DAYS || '7', 10);
// Safety cap: at most this many (trip, date) outcome checks in one run.
const MAX_OUTCOME_CHECKS_PER_RUN = parseInt(process.env.WEATHER_OUTCOME_MAX_PER_RUN || '500', 10);

function todayDateOnly() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateKey(d) {
  return new Date(d).toISOString().split('T')[0];
}

// forecastType values that are pure placeholder guesses -- not tied to
// any real observation for this city -- and therefore never a
// meaningful drift signal against anything. 'historical-estimate'
// (Phase 4) is deliberately NOT in this set: it's real prior-year
// observed data for this city/date, so a live forecast later disagreeing
// with it is exactly the kind of drift worth replanning for.
const NON_COMPARABLE_FORECAST_TYPES = new Set(['climate-average', 'seasonal-average']);

/**
 * True if the two forecasts for the same date differ enough to be worth
 * regenerating the packing list over. A pure-guess forecastType on
 * either side is treated as "not comparable" -- an estimate drifting
 * from another estimate isn't a real signal. A historical-estimate
 * (Phase 4: real prior-year data, not a guess) IS comparable.
 */
function isMeaningfulDrift(oldDay, newDay) {
  if (!oldDay || !newDay) return false;
  if (NON_COMPARABLE_FORECAST_TYPES.has(oldDay.forecastType) || NON_COMPARABLE_FORECAST_TYPES.has(newDay.forecastType)) return false;

  const oldTemp = typeof oldDay.temp === 'number' ? oldDay.temp : null;
  const newTemp = typeof newDay.temp === 'number' ? newDay.temp : null;
  if (oldTemp !== null && newTemp !== null && Math.abs(newTemp - oldTemp) >= DRIFT_TEMP_THRESHOLD_C) {
    return true;
  }

  // A swing across the "do I need a rain/warm layer" line matters even
  // if the temp delta itself is small -- e.g. 6°C dry vs 6°C pouring
  // rain changes what actually needs packing.
  const oldWet = (oldDay.precipitation || 0) > 0.4;
  const newWet = (newDay.precipitation || 0) > 0.4;
  if (oldWet !== newWet) return true;

  return false;
}

/**
 * Pass 1: re-check forecasts for near-term trips and regenerate +
 * notify on real drift.
 */
async function runAutoReplanPass() {
  const now = todayDateOnly();
  const horizon = addDays(now, REPLAN_LOOKAHEAD_DAYS);

  const trips = await Trip.findAll({
    where: {
      status: { [Op.in]: ['upcoming', 'active'] },
      isActive: true,
      startDate: { [Op.lte]: horizon },
      endDate: { [Op.gte]: now },
      city: { [Op.ne]: null },
      country: { [Op.ne]: null },
    },
    limit: MAX_REPLAN_CHECKS_PER_RUN,
  });

  let checked = 0;
  let replanned = 0;
  let failed = 0;

  for (const trip of trips) {
    checked += 1;
    try {
      const freshWeather = await WeatherService.getMultiDayWeatherForTrip(trip.city, trip.country, trip.startDate, trip.endDate);
      const oldWeatherByDate = new Map((trip.weatherData || []).map((w) => [w.date, w]));

      const changes = [];
      for (const newDay of freshWeather || []) {
        const oldDay = oldWeatherByDate.get(newDay.date);
        if (isMeaningfulDrift(oldDay, newDay)) {
          changes.push({
            date: newDay.date,
            oldTemp: oldDay.temp,
            newTemp: newDay.temp,
            oldCondition: oldDay.condition,
            newCondition: newDay.condition,
          });
        }
      }

      if (changes.length === 0) continue;

      logger.info('Forecast drift detected, regenerating packing list', {
        tripId: trip.id, userId: trip.userId, driftedDays: changes.length,
      });

      const result = await tripService.regeneratePackingList(trip.userId, trip.id, {});
      replanned += 1;

      // Shared replan (PRD §6.1 step 7): re-flow this trip's activities
      // and budget for exactly the dates that drifted, alongside the
      // packing list. Best-effort -- a replan hiccup here shouldn't
      // undo the packing-list regen that already succeeded above.
      let sharedReplan = null;
      try {
        sharedReplan = await replanTripForDates(trip.userId, trip.id, {
          dates: changes.map((c) => c.date),
          trigger: 'weather_drift',
        });
      } catch (error) {
        logger.warn('Shared replan (activities/budget) failed after packing-list regen, continuing', {
          tripId: trip.id, error: error.message,
        });
      }

      const user = await User.findByPk(trip.userId, { attributes: ['id', 'email', 'fullName'] });
      if (user) {
        const { subject, html } = tripReplanEmail(user, trip, changes, sharedReplan?.budgetSummary || null);
        const sendResult = await sendNotification(user, { subject, html });
        if (!sendResult.sent && sendResult.reason !== 'no_api_key') {
          logger.warn('Trip replan email failed', { tripId: trip.id, userId: trip.userId, reason: sendResult.reason });
        }
      }

      logger.info('Trip auto-replanned', {
        tripId: trip.id,
        userId: trip.userId,
        totalItems: result.packingList?.tripWardrobe?.totalItems ?? 0,
        activitiesReplanned: sharedReplan?.activitiesReplanned?.length ?? 0,
        activitiesFailed: sharedReplan?.activitiesFailed?.length ?? 0,
      });
    } catch (error) {
      failed += 1;
      // One bad trip shouldn't stop the rest of the run -- log and move on.
      logger.warn('Auto-replan check failed for trip, skipping', { tripId: trip.id, error: error.message });
    }
  }

  logger.info('Auto-replan pass complete', { checked, replanned, failed });
  return { checked, replanned, failed };
}

/**
 * Pass 2: back-fill WeatherOutcome rows for recently-passed trip-days
 * that don't have one yet.
 */
async function runForecastAccuracyPass() {
  const now = todayDateOnly();
  const lookbackStart = addDays(now, -OUTCOME_LOOKBACK_DAYS);

  const trips = await Trip.findAll({
    where: {
      status: { [Op.in]: ['active', 'completed'] },
      startDate: { [Op.lte]: now },
      endDate: { [Op.gte]: lookbackStart },
      city: { [Op.ne]: null },
      country: { [Op.ne]: null },
    },
  });

  let checked = 0;
  let written = 0;
  let skippedNoData = 0;
  let failed = 0;

  outer:
  for (const trip of trips) {
    for (const day of trip.weatherData || []) {
      const dayDate = new Date(day.date);
      if (dayDate >= now || dayDate < lookbackStart) continue; // only already-passed days within the lookback window
      // Phase 4: historical-estimate is real prior-year data, not a
      // guess -- comparing it against what actually happened this year
      // is a genuine accuracy signal for the estimate method, so it
      // stays in (only the pure placeholder types are skipped).
      if (NON_COMPARABLE_FORECAST_TYPES.has(day.forecastType)) continue;

      if (checked >= MAX_OUTCOME_CHECKS_PER_RUN) {
        logger.warn('Forecast-accuracy pass hit its per-run cap, stopping early', { cap: MAX_OUTCOME_CHECKS_PER_RUN });
        break outer;
      }

      const dateKey = toDateKey(day.date);

      const existing = await WeatherOutcome.findOne({ where: { tripId: trip.id, date: dateKey } });
      if (existing) continue; // already checked this trip-day, ever

      checked += 1;

      try {
        const actual = await getHistoricalWeatherForDate(trip.city, trip.country, dateKey);
        if (!actual) {
          skippedNoData += 1;
          continue; // graceful, per historicalWeather.service.js's contract -- try again next run
        }

        const forecastTemp = typeof day.temp === 'number' ? day.temp : null;
        const tempDelta = forecastTemp !== null ? Number((actual.temp - forecastTemp).toFixed(2)) : null;

        await WeatherOutcome.findOrCreate({
          where: { tripId: trip.id, date: dateKey },
          defaults: {
            tripId: trip.id,
            date: dateKey,
            city: trip.city,
            country: trip.country,
            forecastTemp,
            forecastCondition: day.condition || null,
            forecastPrecipitation: typeof day.precipitation === 'number' ? day.precipitation : null,
            forecastType: day.forecastType || null,
            actualTemp: actual.temp,
            actualCondition: actual.condition,
            actualPrecipitation: actual.precipitation,
            tempDelta,
            conditionMatched: day.condition ? day.condition === actual.condition : null,
            source: 'open-meteo',
            checkedAt: new Date(),
          },
        });

        written += 1;
      } catch (error) {
        failed += 1;
        logger.warn('Forecast-accuracy check failed for trip-day, skipping', {
          tripId: trip.id, date: dateKey, error: error.message,
        });
      }
    }
  }

  logger.info('Forecast-accuracy pass complete', { checked, written, skippedNoData, failed });
  return { checked, written, skippedNoData, failed };
}

async function processTripMaintenance() {
  const replanResult = await runAutoReplanPass();
  const outcomeResult = await runForecastAccuracyPass();
  return { replan: replanResult, outcomes: outcomeResult };
}

/**
 * Registers the nightly repeatable job. Bull dedups repeatable jobs by
 * cron pattern + jobId, so calling this on every server boot is
 * safe/idempotent, matching preferenceLearningQueue.js / checkInQueue.js.
 */
async function scheduleTripMaintenance() {
  const cron = process.env.TRIP_MAINTENANCE_CRON || '0 3 * * *'; // 03:00 UTC by default
  await tripMaintenanceQueue.add(
    'trip-maintenance-run',
    {},
    {
      repeat: { cron },
      jobId: 'trip-maintenance-run',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
  logger.info(`Trip maintenance job scheduled (cron: "${cron}")`);
}

module.exports = {
  tripMaintenanceQueue,
  processTripMaintenance,
  runAutoReplanPass,
  runForecastAccuracyPass,
  scheduleTripMaintenance,
  isMeaningfulDrift,
};
