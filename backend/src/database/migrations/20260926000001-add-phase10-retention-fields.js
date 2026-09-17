'use strict';

/**
 * Phase 10 (PRD §3.11) -- Retention Mechanics, scoped 2026-09-18.
 *
 * `users` gains:
 *   - `timezone`: a real per-user IANA timezone (e.g. "America/New_York"),
 *     captured once client-side (see auth.controller.js#updateProfile).
 *     Nothing tracked this before -- without it, a user-chosen digest
 *     send hour would silently mean UTC for everyone. Nullable; a user
 *     who hasn't set one yet falls back to UTC everywhere this is read.
 *   - `current_streak` / `longest_streak` / `last_check_in_date`: the
 *     daily check-in streak. "Checking in" is just logging a wear --
 *     no new action needed -- and a missed day FREEZES the streak at
 *     its current count rather than resetting it to 0 (genuinely
 *     non-punitive mechanics, not just softer copy). See
 *     checkInStreak.service.js.
 *
 * `clothes` gains:
 *   - `last_nudged_at`: last time this item was surfaced in a
 *     "haven't worn this in N months" evening-digest nudge. Distinct
 *     from `last_worn_at` -- this is purely a cooldown so the same
 *     neglected item isn't renominated every single night. See
 *     closetResurfacing.service.js.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'timezone', {
      type: Sequelize.STRING(64),
      allowNull: true,
      comment: 'IANA timezone (e.g. "America/New_York"), captured client-side once. Null falls back to UTC.',
    });
    await queryInterface.addColumn('users', 'current_streak', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Consecutive days checked in (logged a wear). Never decreases on a missed day -- freezes instead.',
    });
    await queryInterface.addColumn('users', 'longest_streak', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });
    await queryInterface.addColumn('users', 'last_check_in_date', {
      type: Sequelize.DATEONLY,
      allowNull: true,
      comment: "The user's own local calendar date of their last counted check-in.",
    });

    await queryInterface.addColumn('clothes', 'last_nudged_at', {
      type: Sequelize.DATE,
      allowNull: true,
      comment: 'Last time this item was included in a "haven\'t worn this in a while" evening-digest nudge (cooldown, not a wear event).',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'timezone');
    await queryInterface.removeColumn('users', 'current_streak');
    await queryInterface.removeColumn('users', 'longest_streak');
    await queryInterface.removeColumn('users', 'last_check_in_date');
    await queryInterface.removeColumn('clothes', 'last_nudged_at');
  },
};
