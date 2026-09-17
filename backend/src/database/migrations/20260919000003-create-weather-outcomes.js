'use strict';

/**
 * Phase 3: forecast-accuracy tracking. One row per trip-day once that
 * day has passed: the forecast that was shown when the trip was
 * created/last replanned, next to what actually happened (from
 * Open-Meteo's free historical weather API -- see
 * services/historicalWeather.service.js -- a separate provider from
 * OpenWeather, which only does forecasts). Written by the nightly job
 * in queues/tripMaintenanceQueue.js.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('weather_outcomes', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      trip_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'trips', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      city: { type: Sequelize.STRING(100), allowNull: true },
      country: { type: Sequelize.STRING(100), allowNull: true },
      forecast_temp: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      forecast_condition: { type: Sequelize.STRING(50), allowNull: true },
      forecast_precipitation: { type: Sequelize.DECIMAL(4, 3), allowNull: true },
      forecast_type: { type: Sequelize.STRING(50), allowNull: true, comment: 'specific | climate-average, from weather.service.js' },
      actual_temp: { type: Sequelize.DECIMAL(5, 2), allowNull: true },
      actual_condition: { type: Sequelize.STRING(50), allowNull: true },
      actual_precipitation: { type: Sequelize.DECIMAL(4, 3), allowNull: true },
      temp_delta: { type: Sequelize.DECIMAL(5, 2), allowNull: true, comment: 'actual_temp - forecast_temp' },
      condition_matched: { type: Sequelize.BOOLEAN, allowNull: true },
      source: { type: Sequelize.STRING(50), allowNull: false, defaultValue: 'open-meteo' },
      checked_at: { type: Sequelize.DATE, allowNull: true },
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
    await queryInterface.addIndex('weather_outcomes', ['trip_id'], { name: 'idx_weather_outcomes_trip_id' });
    await queryInterface.addIndex('weather_outcomes', ['trip_id', 'date'], { name: 'idx_weather_outcomes_trip_date', unique: true });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('weather_outcomes');
  },
};
