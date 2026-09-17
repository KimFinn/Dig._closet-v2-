'use strict';

/**
 * Phase 2: snapshot table for NeuralPreferenceLearner's output.
 *
 * Before this, learnUserPreferences() recomputed everything live on every
 * single recommendation request (up to 5000 interactions re-queried, plus
 * an individual Clothes.findByPk per interaction) and then only persisted
 * 4 of the ~15 fields it computed, into the unrelated `user_preferences`
 * (onboarding survey) table. This table is the real output: one row per
 * user, written by the nightly learning job
 * (src/queues/preferenceLearningQueue.js), read at recommendation time
 * instead of recomputed.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('learned_preferences', {
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
      preferences: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: 'Full computed preference object (colors, fabrics, styles, fits, patterns, occasions, explorationRate, diversityPreference, trendSensitivity, formalityBias, weekday/time-of-day/seasonal prefs, avoided-*)',
      },
      embedding: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'User embedding vector (array of floats) generated alongside the preferences',
      },
      interaction_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Number of UserInteraction rows this snapshot was learned from',
      },
      is_cold_start: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'True if this row was seeded from onboarding defaults rather than learned from real interactions',
      },
      model_version: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      last_learned_at: {
        type: Sequelize.DATE,
        allowNull: true,
        comment: 'When this snapshot was computed — same-day adjustments at recommendation time only look at interactions after this timestamp',
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

    await queryInterface.addIndex('learned_preferences', ['user_id'], {
      name: 'idx_learned_preferences_user_id',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('learned_preferences');
  },
};
