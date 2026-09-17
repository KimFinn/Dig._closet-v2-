'use strict';

/**
 * Phase 5 — Gap-to-Purchase Funnel, region resolution (PRD §3.14).
 *
 * A lightweight home-region preference, captured once (e.g. at
 * onboarding). Free-text country name, matching the existing convention
 * elsewhere in this schema (Trip.country, HistoricalWeatherRecord.country
 * are both free-text, not strict ISO codes) rather than introducing a new
 * convention just for this column.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('user_preferences', 'home_region', {
      type: Sequelize.STRING(100),
      allowNull: true,
      comment: 'Free-text home country/region, used as the affiliate-region fallback when no trip is active',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('user_preferences', 'home_region');
  },
};
