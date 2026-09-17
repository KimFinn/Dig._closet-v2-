'use strict';

/**
 * Bug fix, found live while building Task #38 (product feed ingestion):
 * recommendation_logs.region was VARCHAR(10) (see migration
 * 20260921000001), but region.service.js's resolveUserRegion() returns
 * free-text country names (Trip.country / UserPreferences.homeRegion),
 * matching the existing convention elsewhere in the app -- NOT a 2-3
 * letter ISO code. Any region longer than 10 characters ("United
 * Kingdom", "United States", "South Africa", "New Zealand", "Czech
 * Republic", ...) -- which is most of them -- overflows the column.
 *
 * Confirmed live: RecommendationLog.create({..., region: 'United
 * Kingdom'}) throws "value too long for type character varying(10)".
 * gapRecommendation.service.js catches this per-gap and logs a warning
 * rather than crashing trip creation (the established "never break the
 * caller" pattern), so the app never crashed from this -- but it means
 * recordGapRecommendations() has been silently failing to log ANY
 * gap-purchase recommendation for a user whose resolved region name is
 * longer than 10 characters, for every region since Phase 5 shipped.
 *
 * Widened to VARCHAR(100), matching user_preferences.home_region's size
 * (see migration 20260921000002) and product_feed_items.region (see
 * migration 20260922000001) -- one consistent "free-text region name"
 * column size across the three places Phase 5 stores one.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('recommendation_logs', 'region', {
      type: Sequelize.STRING(100),
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('recommendation_logs', 'region', {
      type: Sequelize.STRING(10),
      allowNull: true,
    });
  },
};
