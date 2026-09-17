'use strict';

/**
 * Phase 4: permanent dedup store for real (not forecast) observed
 * weather, keyed by (city, country, date) -- not tied to any one trip
 * or user, unlike weather_outcomes (Phase 3, per-trip forecast-vs-actual
 * comparison rows).
 *
 * Why this table exists: historical weather never changes once observed
 * -- Dec 12 2025's actual weather in Tokyo is a fixed fact forever. Two
 * different use sites both need "what actually happened in <city> on
 * <date>":
 *   1. weather.service.js's far-future packing estimate (a trip next
 *      December looks up last December's actual weather for the same
 *      dates as its estimate, instead of a generic hardcoded seasonal
 *      curve).
 *   2. tripMaintenanceQueue.js's forecast-accuracy backfill (Phase 3,
 *      unchanged) -- what actually happened on a trip-day that's passed.
 *
 * Without this table, two different users planning trips to the same
 * city around the same time of year -- or the same trip's estimate step
 * being re-run on a regenerate -- would call Open-Meteo's archive API
 * for a fact that was already fetched and will never change. This store
 * makes that lookup free after the first time: findOrCreate on
 * (city, country, date) before ever calling the API, matching the
 * "record it once, reuse forever" decision made when this was discussed
 * with the user -- genuinely economical, no tradeoff, since the data
 * itself never goes stale and never needs a TTL/expiry (contrast with
 * weather.service.js's 30-minute Redis forecast cache, which DOES need
 * to expire, since a forecast prediction keeps changing as the date
 * approaches).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('historical_weather_records', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      city: { type: Sequelize.STRING(100), allowNull: false },
      country: { type: Sequelize.STRING(100), allowNull: true },
      date: { type: Sequelize.DATEONLY, allowNull: false, comment: 'The historical date this observation is for (YYYY-MM-DD)' },
      latitude: { type: Sequelize.DECIMAL(8, 5), allowNull: true },
      longitude: { type: Sequelize.DECIMAL(8, 5), allowNull: true },
      temp: { type: Sequelize.DECIMAL(5, 2), allowNull: true, comment: 'Mean temperature, Celsius' },
      condition: { type: Sequelize.STRING(50), allowNull: true },
      precipitation: { type: Sequelize.DECIMAL(6, 2), allowNull: true, comment: 'mm, from Open-Meteo precipitation_sum' },
      source: { type: Sequelize.STRING(50), allowNull: false, defaultValue: 'open-meteo' },
      fetchedAt: { type: Sequelize.DATE, allowNull: false, field: 'fetched_at', defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });
    // The dedup key: normalized city+country+date. Lookups always go
    // through this exact triple (see historicalWeather.service.js), so
    // one unique composite index both enforces "never store the same
    // fact twice" and serves every read.
    await queryInterface.addIndex(
      'historical_weather_records',
      ['city', 'country', 'date'],
      { name: 'idx_historical_weather_city_country_date', unique: true }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('historical_weather_records');
  },
};
