'use strict';

/**
 * Phase 8 (PRD §3.9) -- the trip_participants table (Phase 3 scaffolding,
 * wired for real in Phase 8) had no way to distinguish "invited, waiting
 * on them" from "declined" from "on the trip" -- every row just existed
 * or didn't. Adds an explicit status, mirroring ClosetShare's own
 * pending/active/revoked vocabulary so both group-trip primitives read
 * consistently.
 *
 * Every participant is required to have a real account as of Phase 8
 * (see feature-roadmap-tracker.md/PRD §3.9 "Decided 2026-09-17") -- the
 * existing nullable user_id is kept only as a defensive column (never
 * written by the Phase 8 invite flow, which requires the invitee to
 * already have an account by email lookup), not as a standing
 * guest-by-name-only state.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('trip_participants', 'status', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'invited',
      comment: 'invited | accepted | declined',
    });
    await queryInterface.addIndex('trip_participants', ['user_id'], { name: 'idx_trip_participants_user_id' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('trip_participants', 'idx_trip_participants_user_id');
    await queryInterface.removeColumn('trip_participants', 'status');
  },
};
