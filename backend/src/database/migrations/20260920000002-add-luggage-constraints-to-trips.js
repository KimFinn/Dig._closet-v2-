'use strict';

/**
 * Phase 4: luggage/bag preference promoted to a persisted trip input.
 * Previously (Phase 3) luggageConstraints only ever existed as a
 * per-request override -- if the caller didn't resend it on a
 * regenerate, tripService silently fell back to a hardcoded tripType
 * preset (_getDefaultLuggageConstraints), discarding whatever the user
 * had actually chosen before. This column remembers what was used.
 *
 * Also supports an optional `bags` array (e.g.
 * {bags: [{name, type, maxItems}]}) for basic multi-bag modeling --
 * packaging.service.js sums maxItems across bags for the over-limit
 * check. Per-bag item assignment (which item goes in which specific
 * bag) is out of scope for this pass, same simplification tradeoff the
 * existing single-limit over-limit flag already makes.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('trips', 'luggage_constraints', {
      type: Sequelize.JSONB,
      allowNull: true,
      defaultValue: null,
      comment: 'e.g. {type, maxItems} or {bags: [{name, type, maxItems}]}',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('trips', 'luggage_constraints');
  },
};
