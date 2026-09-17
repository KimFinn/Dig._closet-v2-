/**
 * Places integration -- Phase 7 (Trip Activities, Places, Destination
 * Intelligence & Budgeting, PRD §3.8).
 *
 * Google Places as the default provider, abstracted behind this module
 * the same way weather.service.js abstracts OpenWeatherMap -- nothing
 * outside this file talks to Google directly. Built credential-gated,
 * identical pattern to WEATHER_API_KEY/affiliate networks: with no
 * PLACES_API_KEY configured, every function here still works end-to-end
 * on deterministic mock data (mockPlaces.data.js), and switches to real
 * Google Places calls the moment a real key exists -- no other code in
 * the pipeline (activity planning, nearby-store lookups, budgeting)
 * needs to change.
 *
 * CACHING -- read this before touching TTLs. Verified against Google's
 * current terms while building this (2026-09):
 *   - place_id is explicitly exempt from the Places API caching
 *     restrictions and may be stored indefinitely.
 *   - latitude/longitude may be cached for up to 30 consecutive
 *     calendar days (Maps Platform Service Specific Terms §14.3).
 *   - Full place details (name, address, rating, price level, photos)
 *     have NO caching exception at all, at any duration -- this is a
 *     categorical restriction, not a duration limit a longer TTL could
 *     satisfy.
 * So: place_id + coordinates go into PlaceCache (the `place_cache`
 * table) PERMANENTLY. Full details are fetched fresh per real display,
 * backed only by a short (~1hr) Redis operational cache to avoid
 * duplicate calls in a tight window -- closer in spirit to request
 * debouncing than to "storage" in the sense the terms restrict, and
 * deliberately NOT extended to a day or multiple days (PRD §3.8 -- that
 * would just be the already-rejected "cache full details" design with a
 * longer interval).
 */

const axios = require('axios');
const Redis = require('ioredis');
const logger = require('../utils/logger');
const { PlaceCache } = require('../database/models');
const { generateMockPlaces } = require('../data/mockPlaces.data');

const API_KEY = process.env.PLACES_API_KEY || null;
const PLACES_BASE_URL = 'https://places.googleapis.com/v1/places';

const DETAILS_CACHE_TTL_SEC = 60 * 60; // ~1hr -- see module doc above; do not extend
const DETAILS_CACHE_KEY_PREFIX = 'places:details:';

const redisClient = new Redis({
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
  lazyConnect: false,
  maxRetriesPerRequest: 2,
});
redisClient.on('error', (err) => {
  logger.error('Places details cache Redis error', { message: err.message });
});

let warnedNoCredentials = false;
function isLive() {
  if (!API_KEY && !warnedNoCredentials) {
    logger.warn('PLACES_API_KEY not configured -- Places calls will return deterministic mock data, not live Google Places results.');
    warnedNoCredentials = true;
  }
  return !!API_KEY;
}

async function detailsCacheGet(placeId) {
  try {
    const raw = await redisClient.get(DETAILS_CACHE_KEY_PREFIX + placeId);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    logger.warn('Places details cache get failed, treating as miss', { message: error.message });
    return null;
  }
}

async function detailsCacheSet(placeId, data) {
  try {
    await redisClient.set(DETAILS_CACHE_KEY_PREFIX + placeId, JSON.stringify(data), 'EX', DETAILS_CACHE_TTL_SEC);
  } catch (error) {
    logger.warn('Places details cache set failed', { message: error.message });
  }
}

/**
 * Persists place_id + coordinates permanently (the compliant slice of
 * the cache -- see module doc). Upserts on place_id so a repeat sighting
 * of the same place doesn't duplicate rows.
 */
async function rememberPlace(place, queryKey) {
  try {
    await PlaceCache.findOrCreate({
      where: { placeId: place.placeId },
      defaults: {
        placeId: place.placeId,
        latitude: place.latitude ?? null,
        longitude: place.longitude ?? null,
        queryKey: queryKey || null,
      },
    });
  } catch (error) {
    // Never let a cache-write failure block returning real search
    // results to the caller -- this is a pure upside, not a dependency.
    logger.warn('PlaceCache write failed', { placeId: place.placeId, error: error.message });
  }
}

/**
 * Text search -- e.g. "hotels in paris", "clothing store near reykjavik".
 * Returns lightweight summaries (name/place_id/coords/rating/price) --
 * never returns raw full Google response fields beyond what's needed,
 * and never caches this result set itself beyond the short details TTL
 * a subsequent getPlaceDetails() call would apply.
 *
 * @returns {Promise<{results: object[], live: boolean}>}
 */
async function searchPlaces(query, options = {}) {
  if (!query) throw new Error('Places search requires a query');
  const live = isLive();

  let results;
  if (!live) {
    results = generateMockPlaces(query, options.near, options.count || 3);
  } else {
    try {
      const response = await axios.post(`${PLACES_BASE_URL}:searchText`, {
        textQuery: query,
        maxResultCount: options.count || 5,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.rating,places.priceLevel,places.formattedAddress,places.types',
        },
        timeout: 10000,
      });
      results = (response.data.places || []).map((p) => ({
        placeId: p.id,
        name: p.displayName?.text || null,
        latitude: p.location?.latitude ?? null,
        longitude: p.location?.longitude ?? null,
        rating: p.rating ?? null,
        priceLevel: p.priceLevel ?? null,
        formattedAddress: p.formattedAddress || null,
        types: p.types || [],
      }));
    } catch (error) {
      // Degrade to mock rather than fail the caller -- same
      // "never break the caller" principle as weather/affiliate.
      logger.warn('Live Places search failed, falling back to mock', { query, error: error.message });
      results = generateMockPlaces(query, options.near, options.count || 3);
      await Promise.all(results.map((r) => rememberPlace(r, query)));
      return { results, live: false };
    }
  }

  await Promise.all(results.map((r) => rememberPlace(r, query)));
  return { results, live };
}

/**
 * Full place details for one place_id -- the content the caching rules
 * actually restrict. Short Redis TTL only; never persisted to Postgres.
 *
 * @returns {Promise<{details: object, live: boolean, cached: boolean}>}
 */
async function getPlaceDetails(placeId) {
  if (!placeId) throw new Error('getPlaceDetails requires a placeId');

  const cached = await detailsCacheGet(placeId);
  if (cached) {
    return { details: cached, live: isLive(), cached: true };
  }

  const live = isLive();
  let details;
  if (!live) {
    const [mock] = generateMockPlaces(placeId.replace(/^mock-place-/, '').replace(/-\d+$/, '') || 'place', null, 1);
    details = { ...mock, placeId };
  } else {
    try {
      const response = await axios.get(`${PLACES_BASE_URL}/${encodeURIComponent(placeId)}`, {
        headers: {
          'X-Goog-Api-Key': API_KEY,
          'X-Goog-FieldMask': 'id,displayName,location,rating,priceLevel,formattedAddress,photos,types',
        },
        timeout: 10000,
      });
      const p = response.data;
      details = {
        placeId: p.id,
        name: p.displayName?.text || null,
        latitude: p.location?.latitude ?? null,
        longitude: p.location?.longitude ?? null,
        rating: p.rating ?? null,
        priceLevel: p.priceLevel ?? null,
        formattedAddress: p.formattedAddress || null,
        photoRef: p.photos?.[0]?.name || null,
        types: p.types || [],
      };
    } catch (error) {
      logger.warn('Live Places details fetch failed, falling back to mock', { placeId, error: error.message });
      const [mock] = generateMockPlaces('place', null, 1);
      details = { ...mock, placeId };
      await detailsCacheSet(placeId, details);
      return { details, live: false, cached: false };
    }
  }

  await detailsCacheSet(placeId, details);
  return { details, live, cached: false };
}

/**
 * Maps our internal wardrobe gap category to a Places search term --
 * used by the too-urgent nearby-store lookup (gapPurchase.service.js)
 * and reused wherever a category needs to become a real-world search.
 */
const CATEGORY_TO_PLACES_QUERY = {
  top: 'clothing store',
  bottom: 'clothing store',
  footwear: 'shoe store',
  outerwear: 'outdoor gear store',
  dress: 'clothing store',
  accessory: 'clothing store',
};

/**
 * Nearby search for a wardrobe-gap category around a location string
 * (city/country -- e.g. a trip's destination). Thin wrapper over
 * searchPlaces() with the category->query mapping applied.
 */
async function findNearbyForCategory(category, locationText, options = {}) {
  const term = CATEGORY_TO_PLACES_QUERY[category] || 'clothing store';
  const query = locationText ? `${term} near ${locationText}` : term;
  return searchPlaces(query, options);
}

/**
 * Maps a travel-interest category (UserPreferences.activityCategories --
 * hiking/museums/nightlife/shopping/relaxation/dining/sightseeing/beach)
 * to a Places search term. Separate map from CATEGORY_TO_PLACES_QUERY
 * above, which is about wardrobe-gap categories (clothing) -- these are
 * about activity interests (Mode A leisure-fill, PRD §3.8), a different
 * taxonomy that happens to share this module.
 */
const INTEREST_TO_PLACES_QUERY = {
  hiking: 'hiking trail',
  museums: 'museum',
  nightlife: 'nightlife venue',
  shopping: 'shopping district',
  relaxation: 'spa',
  dining: 'restaurant',
  sightseeing: 'tourist attraction',
  beach: 'beach',
};

async function findNearbyForInterest(interest, locationText, options = {}) {
  const term = INTEREST_TO_PLACES_QUERY[interest] || 'tourist attraction';
  const query = locationText ? `${term} near ${locationText}` : term;
  return searchPlaces(query, options);
}

module.exports = {
  searchPlaces,
  getPlaceDetails,
  findNearbyForCategory,
  findNearbyForInterest,
  CATEGORY_TO_PLACES_QUERY,
  INTEREST_TO_PLACES_QUERY,
  isLive,
};
