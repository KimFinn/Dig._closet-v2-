'use strict';

/**
 * Phase 9 (PRD §3.10) -- the digital life-twin's persisted output. One row
 * per user, written by the nightly profile-synthesis job
 * (src/queues/profileSynthesisQueue.js -> profileSynthesis.service.js),
 * read by the dashboard (profileDashboard.service.js), the lazy narrative
 * generator (profileNarrative.service.js), and the grounded chatbot
 * (chatbot.service.js).
 *
 * `structured_traits` is always the model's current, real computation --
 * never edited by a user correction directly (see the 2026-09-18 scoping
 * discussion: an `observed_fact` trait is arithmetic over the user's own
 * rows and can't be "wrong"; only `inferred_preference` traits are
 * opinions a user can legitimately override). `user_corrections` is a
 * separate overlay applied at read time by each consumer -- keeping the
 * two columns apart is what makes it possible for the nightly job to keep
 * computing the honest live value every night while a correction is in
 * effect, and to detect a sustained reversal against that live value
 * without ever having overwritten it.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_profile_summaries', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Bumped on every nightly synthesis run for this user',
      },
      computed_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'When structured_traits was last (re)computed by the nightly job',
      },
      structured_traits: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Map of traitKey -> {pillar, traitType (observed_fact|inferred_preference), value, signal (inferred_preference only), confidence, computedAt}. Always the live, real computation -- never mutated by a correction.',
      },
      narrative_summary: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Lazily-generated narrative paragraph, cached until structured_traits changes again (see narrative_generated_at)',
      },
      narrative_generated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      user_corrections: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Map of traitKey -> {correctionType: suppress|override|delete|scope_only, overrideValue?, baselineSignal?, reversalStreak?, correctedAt}. Applied at read time, never baked into structured_traits.',
      },
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

    await queryInterface.addIndex('user_profile_summaries', ['user_id'], {
      name: 'idx_user_profile_summaries_user_id',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_profile_summaries');
  },
};
