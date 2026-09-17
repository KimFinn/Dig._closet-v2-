'use strict';

/**
 * Phase 7 (PRD §3.8) -- activates trip_activities from "schema only, not
 * used yet" (Phase 3 comment in models/index.js) into a real, queryable
 * entity: adds the Places/budget/outfit-link fields the Phase 7 build
 * needs (Mode A/B planning, nearby-store lookups, per-category budget
 * tracking). trips.activities (JSONB) remains the input spec the
 * packing algorithm and auto-replan job read -- unchanged, still the
 * source of truth for packing -- while trip_activities rows are now
 * materialized alongside it as the richer, queryable object that
 * Places/budget/outfit-linking attach to. See tripActivity.service.js.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('trip_activities', 'category', {
      type: Sequelize.STRING(50),
      allowNull: true,
      comment: 'dining|hiking|sightseeing|shopping|nightlife|relaxation|other',
    });
    await queryInterface.addColumn('trip_activities', 'place_id', {
      type: Sequelize.STRING(255),
      allowNull: true,
      comment: 'Google Places place_id, if a specific place is attached',
    });
    await queryInterface.addColumn('trip_activities', 'location_text', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
    await queryInterface.addColumn('trip_activities', 'estimated_cost', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('trip_activities', 'category_budget_tag', {
      type: Sequelize.STRING(50),
      allowNull: true,
      comment: 'accommodation | food | activities -- which Trip budget category this counts against (PRD §3.8)',
    });
    await queryInterface.addColumn('trip_activities', 'linked_outfit_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'outfits', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('trip_activities', 'status', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'planned',
      comment: 'planned | confirmed | skipped | replaced',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('trip_activities', 'status');
    await queryInterface.removeColumn('trip_activities', 'linked_outfit_id');
    await queryInterface.removeColumn('trip_activities', 'category_budget_tag');
    await queryInterface.removeColumn('trip_activities', 'estimated_cost');
    await queryInterface.removeColumn('trip_activities', 'location_text');
    await queryInterface.removeColumn('trip_activities', 'place_id');
    await queryInterface.removeColumn('trip_activities', 'category');
  },
};
