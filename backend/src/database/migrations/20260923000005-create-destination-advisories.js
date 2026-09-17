'use strict';

/**
 * Phase 7 (PRD §3.15) -- safety/security advisory, ingested from the
 * fallback chain decided during the Phase 7 brainstorm: UK FCDO's API
 * (primary) -> Canada's official open-data travel-advisory feed
 * (secondary) -> Australia's Smartraveller RSS feed (tertiary). All
 * three are free, official government sources.
 *
 * Deliberately NO LLM anywhere in this ingestion pipeline -- political
 * instability and natural-disaster risk change day to day, and an LLM's
 * frozen training knowledge would be actively dangerous to trust here,
 * worse than the budget-feasibility case (PRD §3.15). Each source is
 * parsed deterministically into this one internal schema by
 * destinationAdvisory.service.js -- never LLM-extracted.
 *
 * One row per country -- the source column records which one actually
 * supplied the current data (an upsert on re-ingestion, not an
 * append-only log), so a country's advisory can visibly come from FCDO
 * today and Canada tomorrow if FCDO's API is down, without the app
 * caring which source is live at read time.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('destination_advisories', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      country: { type: Sequelize.STRING(100), allowNull: false },
      source: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'fcdo | canada | smartraveller',
      },
      risk_level: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'normalized: normal | heightened_caution | avoid_nonessential | avoid_all -- mapping is source-specific, see destinationAdvisory.service.js',
      },
      summary: { type: Sequelize.TEXT, allowNull: true },
      categories: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'e.g. { political: "...", naturalDisaster: "...", crime: "..." } -- whichever the source provides',
      },
      source_url: { type: Sequelize.TEXT, allowNull: true },
      fetched_at: { type: Sequelize.DATE, allowNull: false },
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

    await queryInterface.addIndex('destination_advisories', ['country'], {
      name: 'idx_destination_advisories_country',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('destination_advisories');
  },
};
