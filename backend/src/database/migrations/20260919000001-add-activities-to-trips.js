'use strict';

/**
 * Phase 3: tripService.createTrip() has always parsed a day-by-day
 * `activities` array (date -> [{time, occasion}]) and passed it into
 * packaging.service.js, but the Trip model never had a column for it --
 * Sequelize silently drops unknown attributes on .create(), so this data
 * was computed and used once, then discarded. Regenerating a packing
 * list, or the new auto-replan job re-checking a trip's forecast later,
 * both need the original per-day occasions to still be around after
 * trip creation, so this persists it for real.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('trips', 'activities', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: [],
      comment: 'Parsed day-by-day activities: [{date, slots: [{time, occasion}]}]',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('trips', 'activities');
  },
};
