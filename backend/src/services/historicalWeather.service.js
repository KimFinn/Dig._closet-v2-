/**
 * Historical (actual, not forecast) weather. Originally Phase 3, for
 * WeatherOutcome forecast-accuracy tracking; Phase 4 adds a second
 * caller (weather.service.js's far-future packing estimate, which looks
 * up a prior year's actual weather for a trip date too far out for a
 * real forecast) and, more importantly, a permanent dedup store shared
 * by both.
 *
 * Deliberately a separate provider from weather.service.js (OpenWeather,
 * forecasts only). OpenWeather's historical/actuals data is a paid
 * add-on; Open-Meteo (https://open-meteo.com) has a genuinely free
 * Historical Weather API -- real recorded observations (ERA5
 * reanalysis), no signup or API key, free for non-commercial use up to
 * 10,000 calls/day. Checked live in September 2026, not assumed from
 * training data. If this app goes commercial at a scale that matters,
 * Open-Meteo has a paid tier for that -- but at "one lookup per active
 * trip per day" volume, that's a long way off.
 *
 * Geocoding (city/country -> lat/lon, which the archive API needs
 * instead of a place name) is also Open-Meteo's own free endpoint, and
 * is Redis-cached with a long TTL -- a city's coordinates don't change,
 * so there's no reason to re-resolve them on every call.
 *
 * Phase 4: getHistoricalWeatherForDate() now checks
 * HistoricalWeatherRecord (a permanent Postgres table, not a
 * time-limited cache -- see migration
 * 20260920000001-create-historical-weather-records for the full
 * rationale) before ever calling Open-Meteo, and writes the result
 * there after a successful fetch. Unlike the Redis caches in this file
 * and weather.service.js, this store has no TTL/expiry at all --
 * historical weather is an immutable fact once observed, so "cached
 * forever" is simply correct here, not a shortcut. This is what makes a
 * second user planning a trip to the same city around the same dates
 * skip the Open-Meteo call entirely, and what stops this same trip's
 * own far-future estimate from re-fetching on every regenerate.
 */

// Uses the global `fetch` (Node 18+) rather than axios, deliberately --
// no other reason than that it needs no extra dependency for two simple
// GET calls.
const redis = require('redis');
const logger = require('../utils/logger');
// Lazy require to avoid a circular require at module-load time --
// database/models/index.js doesn't touch this file, so a top-level
// require would be safe too, but this matches how other services in
// this codebase avoid circularity issues (see AIOutfit recommendation.js's
// preferenceLearningQueue require).
let HistoricalWeatherRecord = null;
function getModel() {
  if (!HistoricalWeatherRecord) {
    HistoricalWeatherRecord = require('../database/models').HistoricalWeatherRecord;
  }
  return HistoricalWeatherRecord;
}

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const GEOCODE_CACHE_TTL_SEC = 30 * 24 * 60 * 60; // 30 days -- coordinates don't change

async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

let cacheClient = null;
async function getCacheClient() {
  if (!cacheClient) {
    cacheClient = redis.createClient({
      socket: {
        host: process.env.REDIS_CLOUD_HOST || 'localhost',
        port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
        tls: process.env.REDIS_TLS === 'true',
        rejectUnauthorized: false,
      },
      password: process.env.REDIS_CLOUD_PASSWORD,
    });
    cacheClient.on('error', (err) => logger.warn('Historical-weather cache error', { message: err.message }));
    await cacheClient.connect();
  }
  return cacheClient;
}

// WMO weather codes (what Open-Meteo returns) collapsed down to the
// same small condition vocabulary weather.service.js already uses
// (clear/clouds/rain/snow/thunderstorm/fog), so a WeatherOutcome row's
// forecast_condition and actual_condition are directly comparable.
function wmoCodeToCondition(code) {
  if (code === 0) return 'clear';
  if ([1, 2, 3].includes(code)) return 'clouds';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'thunderstorm';
  return 'unknown';
}

async function geocode(city, country) {
  const cacheKey = `geocode:${city.toLowerCase()}:${(country || '').toLowerCase()}`;
  try {
    const cache = await getCacheClient();
    const cached = await cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  } catch (error) {
    logger.warn('Geocode cache read failed, continuing without cache', { message: error.message });
  }

  const url = `${GEOCODING_URL}?${new URLSearchParams({ name: city, count: 5, language: 'en', format: 'json' })}`;
  const response = await fetchWithTimeout(url);
  const data = await response.json();

  const results = data?.results || [];
  // Prefer a result whose country matches, when we have one to match
  // against -- "Paris" alone is ambiguous (France vs Texas).
  const match = (country && results.find((r) => r.country?.toLowerCase() === country.toLowerCase())) || results[0];

  if (!match) {
    throw new Error(`Could not geocode "${city}${country ? ', ' + country : ''}"`);
  }

  const coords = { latitude: match.latitude, longitude: match.longitude };

  try {
    const cache = await getCacheClient();
    await cache.set(cacheKey, JSON.stringify(coords), { EX: GEOCODE_CACHE_TTL_SEC });
  } catch (error) {
    logger.warn('Geocode cache write failed', { message: error.message });
  }

  return coords;
}

/**
 * @param {string} city
 * @param {string} country
 * @param {string} date - YYYY-MM-DD, must be in the past (this is
 *   historical/actual data, not a forecast)
 * @returns {Promise<{temp:number, condition:string, precipitation:number}|null>}
 *   null if the date has no data yet (e.g. called for a date that
 *   hasn't happened) or geocoding/the archive call failed -- callers
 *   treat this as "skip this outcome check", never as a reason to fail
 *   the job that called it.
 */
async function getHistoricalWeatherForDate(city, country, date) {
  if (!city) return null;

  const normalizedCountry = country || null;

  // Phase 4: check the permanent dedup store first -- a hit here means
  // zero network calls at all (no geocode, no archive fetch), which is
  // the whole point of persisting an immutable fact instead of
  // re-deriving it. A DB read failure is treated the same as a miss
  // (fall through to the real lookup) rather than failing the caller.
  try {
    const existing = await getModel().findOne({ where: { city: city.toLowerCase(), country: normalizedCountry ? normalizedCountry.toLowerCase() : null, date } });
    if (existing) {
      return {
        temp: existing.temp === null ? null : Number(existing.temp),
        condition: existing.condition,
        precipitation: existing.precipitation === null ? 0 : Number(existing.precipitation),
      };
    }
  } catch (error) {
    logger.warn('Historical weather DB lookup failed, falling back to live fetch', { city, country, date, error: error.message });
  }

  try {
    const { latitude, longitude } = await geocode(city, country);

    const url = `${ARCHIVE_URL}?${new URLSearchParams({
      latitude,
      longitude,
      start_date: date,
      end_date: date,
      daily: 'temperature_2m_mean,weathercode,precipitation_sum',
      timezone: 'auto',
    })}`;
    const response = await fetchWithTimeout(url);
    const data = await response.json();

    const daily = data?.daily;
    if (!daily || !daily.time || daily.time.length === 0) {
      return null;
    }

    const temp = daily.temperature_2m_mean?.[0];
    const code = daily.weathercode?.[0];
    const precipitation = daily.precipitation_sum?.[0];

    if (temp === null || temp === undefined) return null;

    const result = {
      temp,
      condition: wmoCodeToCondition(code),
      precipitation: precipitation || 0,
    };

    // Persist the fact for next time -- any other trip, any other user,
    // looking up this exact (city, country, date) again never needs to
    // hit Open-Meteo. findOrCreate (not a blind create) guards against a
    // race between two concurrent lookups for the same never-before-seen
    // date; whichever writes first wins, the fact is identical either way.
    try {
      await getModel().findOrCreate({
        where: { city: city.toLowerCase(), country: normalizedCountry ? normalizedCountry.toLowerCase() : null, date },
        defaults: {
          city: city.toLowerCase(),
          country: normalizedCountry ? normalizedCountry.toLowerCase() : null,
          date,
          latitude,
          longitude,
          temp: result.temp,
          condition: result.condition,
          precipitation: result.precipitation,
          source: 'open-meteo',
          fetchedAt: new Date(),
        },
      });
    } catch (writeError) {
      // Never let a persistence failure take down the caller -- the
      // lookup itself already succeeded, and worst case this date just
      // gets fetched again next time instead of served from the store.
      logger.warn('Historical weather DB write failed, continuing without caching it', { city, country, date, error: writeError.message });
    }

    return result;
  } catch (error) {
    logger.warn('Historical weather lookup failed, skipping this outcome check', {
      city, country, date, error: error.message,
    });
    return null;
  }
}

module.exports = { getHistoricalWeatherForDate, wmoCodeToCondition };
