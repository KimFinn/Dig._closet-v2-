'use strict';

/**
 * Phase 7 (PRD §3.15) -- curated, stable cultural-context table. Kept
 * separate from destination_advisories (dynamic safety/security data,
 * next migration) since culture doesn't need re-fetching the way a
 * safety advisory does -- one table per data-freshness profile, not one
 * "destination info" table mixing both.
 *
 * native_to_foreigner_notes captures the specific framing the user
 * asked for during the Phase 7 brainstorm: how locals tend to relate to
 * visitors, made clear to the user rather than left implicit.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('destination_culture', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      country: { type: Sequelize.STRING(100), allowNull: false },
      summary: { type: Sequelize.TEXT, allowNull: true },
      native_to_foreigner_notes: { type: Sequelize.TEXT, allowNull: true },
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

    await queryInterface.addIndex('destination_culture', ['country'], {
      name: 'idx_destination_culture_country',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('destination_culture');
  },
};
