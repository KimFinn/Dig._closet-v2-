'use strict';

/**
 * Phase 1: manual tag correction needs its own UserInteraction `action`
 * value so it's distinguishable from every other interaction type once
 * the learning system (Phase 2) reads this log — the PRD calls out tag
 * corrections as "the user's own taxonomy, not just fixing data," a
 * different signal than a like/save/wear. This is the same kind of
 * additive enum extension the PRD already calls for with 'swap' in
 * Phase 2; adding 'correct' now for the Phase 1 correction flow.
 *
 * Postgres has no direct way to remove a single enum value (it would
 * require recreating the type and everything that depends on it), so
 * `down` intentionally does not attempt to reverse this -- consistent
 * with how additive enum values are normally handled.
 */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query(
      `ALTER TYPE "enum_user_interactions_action" ADD VALUE IF NOT EXISTS 'correct';`
    );
  },

  async down() {
    // Not reversible without recreating the enum type and every column/
    // index that depends on it -- intentionally a no-op, same as the
    // standard practice for additive Postgres enum values.
  },
};
