'use strict';

/** Mirrors the `RecommendationLog` model in src/database/models/index.js. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('recommendation_logs', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
      },
      occasion: { type: Sequelize.STRING(100), allowNull: true },
      recommended_outfits: { type: Sequelize.JSONB, allowNull: true },
      context: { type: Sequelize.JSONB, allowNull: true },
      user_preferences_snapshot: { type: Sequelize.JSONB, allowNull: true },
      model_version: { type: Sequelize.STRING(50), allowNull: true },
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

    await queryInterface.addIndex('recommendation_logs', ['user_id'], {
      name: 'idx_recommendation_logs_user_id',
    });
    await queryInterface.addIndex('recommendation_logs', ['created_at'], {
      name: 'idx_recommendation_logs_created_at',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('recommendation_logs');
  },
};
