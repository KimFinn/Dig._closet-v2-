'use strict';

/**
 * Phase 7 (PRD §3.8) -- Mode A (destination-anchored) vs Mode B
 * (open-ended leisure) trip-activity planning, plus the overall stated
 * budget the feasibility check (§3.15) and live tracker are checked
 * against.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('trips', 'planning_mode', {
      type: Sequelize.STRING(20),
      allowNull: true,
      comment: 'mode_a (destination-anchored) | mode_b (open-ended leisure) -- null for trips created before Phase 7 or that don\'t use activity planning',
    });
    await queryInterface.addColumn('trips', 'total_budget', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('trips', 'budget_currency', {
      type: Sequelize.STRING(3),
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('trips', 'budget_currency');
    await queryInterface.removeColumn('trips', 'total_budget');
    await queryInterface.removeColumn('trips', 'planning_mode');
  },
};
