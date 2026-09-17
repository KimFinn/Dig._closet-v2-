'use strict';

/**
 * Phase 7 (PRD §3.8) -- lightweight NON-TRIP local activity planning
 * (e.g. a weekend hangout in the user's own home city/town).
 *
 * Deliberately NOT modeled as a Trip with a same-city destination: a
 * Trip carries packing lists, luggage constraints, and trip-mode's
 * full-wardrobe restriction, none of which apply when the user is at
 * home with their whole closet available. Outing reuses the exact same
 * occasion-aware outfit-recommendation mechanism as TripActivity (see
 * tripActivity.service.js / activityOutfit.service.js) -- same core
 * "time-slotted activity + occasion feeds outfit rec" logic, just not
 * nested under a multi-day trip record.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('outings', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      title: { type: Sequelize.STRING(255), allowNull: false },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      time_slot: { type: Sequelize.STRING(50), allowNull: true },
      occasion: { type: Sequelize.STRING(100), allowNull: true },
      category: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'dining|hiking|sightseeing|shopping|nightlife|relaxation|other -- same taxonomy as TripActivity',
      },
      place_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Google Places place_id, if the outing has a specific place attached',
      },
      location_text: { type: Sequelize.STRING(255), allowNull: true },
      budget_amount: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: true,
        comment: 'Single figure -- simpler than Trip\'s per-category budgeting, since an outing is one activity, not a multi-day plan',
      },
      budget_currency: { type: Sequelize.STRING(3), allowNull: true },
      linked_outfit_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'outfits', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'planned',
        comment: 'planned | completed | skipped',
      },
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

    await queryInterface.addIndex('outings', ['user_id', 'date'], {
      name: 'idx_outings_user_date',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('outings');
  },
};
