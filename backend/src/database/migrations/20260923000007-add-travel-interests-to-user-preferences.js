'use strict';

/**
 * Phase 7 (PRD §3.8) -- travel-specific interest profile, distinct from
 * style preferences: cuisine, activity categories, and pace, feeding
 * Mode A/B trip-activity planning. Related but separate signal from
 * stylePersona/preferredColors etc., which are about outfits, not
 * itinerary shape.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('user_preferences', 'cuisine_preferences', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: [],
    });
    await queryInterface.addColumn('user_preferences', 'activity_categories', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: [],
      comment: 'e.g. hiking, museums, nightlife, shopping, relaxation',
    });
    await queryInterface.addColumn('user_preferences', 'pace_preference', {
      type: Sequelize.STRING(20),
      allowNull: true,
      comment: 'packed | relaxed | balanced',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('user_preferences', 'pace_preference');
    await queryInterface.removeColumn('user_preferences', 'activity_categories');
    await queryInterface.removeColumn('user_preferences', 'cuisine_preferences');
  },
};
