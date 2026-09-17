'use strict';

/**
 * Phase 7 (PRD §3.15) -- curated cost-of-living table backing the budget
 * feasibility check. Own data, in-house, NOT a paid API: Numbeo's API
 * was priced out during the Phase 7 brainstorm at ~$1250/month, judged
 * not worth it pre-traction given how infrequently any one user
 * travels. Sourced once from public data (manually sampled public
 * cost-of-living pages, government stats, etc.) and refreshed
 * occasionally, not monthly.
 *
 * budgetFeasibility.service.js is the only thing that reads this table
 * for the actual cost figures -- the LLM layer on top only does
 * arithmetic/narration from these trusted numbers, never supplies a
 * cost figure itself (PRD §3.15's governing principle).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('destination_cost_tiers', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      country_or_region: { type: Sequelize.STRING(100), allowNull: false },
      tier: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'budget | mid | comfortable',
      },
      daily_accommodation: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      daily_food: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      daily_local_transport: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      daily_activities: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      currency: { type: Sequelize.STRING(3), allowNull: false, defaultValue: 'USD' },
      source_note: { type: Sequelize.STRING(255), allowNull: true },
      last_updated: { type: Sequelize.DATE, allowNull: true },
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

    await queryInterface.addIndex('destination_cost_tiers', ['country_or_region', 'tier'], {
      name: 'idx_destination_cost_tiers_country_tier',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('destination_cost_tiers');
  },
};
