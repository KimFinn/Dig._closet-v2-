/**
 * Region resolution -- Phase 5 (Gap-to-Purchase Funnel, PRD §3.14).
 *
 * Decides which region's affiliate deals/currency to show a user:
 * active trip's destination country when a trip is running, else the
 * user's home-region preference, else unresolved. Mirrors the existing
 * trip-mode-aware pattern used elsewhere in this app (packaging.service,
 * AIOutfit recommendation.js's trip-aware scoring) rather than inventing
 * a new mechanism -- "prefer trip context while traveling, fall back to
 * the user's normal preferences otherwise" is already how this app
 * behaves for wardrobe/outfit logic.
 *
 * Region values here are free text (a country name, e.g. "Iceland"),
 * matching the existing convention on Trip.country and
 * HistoricalWeatherRecord.country -- NOT a strict ISO code. Normalizing
 * to whatever code an actual affiliate network's API wants is the
 * affiliate-link layer's job, not this resolver's.
 */

const { Trip, UserPreferences } = require('../database/models');
const logger = require('../utils/logger');

/**
 * @param {import('../database/models').User} user - a loaded User
 *   instance (must have isOnTrip(), activeTripId available -- i.e. a
 *   real Sequelize instance, not a plain object).
 * @returns {Promise<{region: string|null, source: 'trip'|'home'|'unresolved'}>}
 */
async function resolveUserRegion(user) {
  if (!user) return { region: null, source: 'unresolved' };

  if (typeof user.isOnTrip === 'function' && user.isOnTrip() && user.activeTripId) {
    try {
      const trip = await Trip.findByPk(user.activeTripId, { attributes: ['id', 'country', 'city'] });
      if (trip && trip.country) {
        return { region: trip.country, source: 'trip' };
      }
    } catch (error) {
      // Never let a region lookup failure break whatever called this --
      // same "degrade, don't fail the caller" pattern as
      // historicalWeather.service.js's DB lookup.
      logger.warn('Region resolution: active-trip lookup failed, falling back to home region', {
        userId: user.id, error: error.message,
      });
    }
  }

  try {
    const prefs = await UserPreferences.findOne({ where: { userId: user.id }, attributes: ['homeRegion'] });
    if (prefs && prefs.homeRegion) {
      return { region: prefs.homeRegion, source: 'home' };
    }
  } catch (error) {
    logger.warn('Region resolution: home-region lookup failed', { userId: user.id, error: error.message });
  }

  return { region: null, source: 'unresolved' };
}

module.exports = { resolveUserRegion };
