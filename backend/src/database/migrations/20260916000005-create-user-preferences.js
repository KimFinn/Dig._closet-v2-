'use strict';

/** Mirrors the `UserPreferences` model in src/database/models/index.js. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_preferences', {
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
      style_persona: { type: Sequelize.STRING(100), allowNull: true },
      preferred_colors: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
      avoid_colors: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
      preferred_fabrics: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
      avoid_fabrics: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
      preferred_brands: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
      occasion_frequency: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
      employment_status: {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: 'not_specified',
      },
      work_schedule: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
      work_dresscode: { type: Sequelize.STRING(100), allowNull: true },
      workdays: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
      body_type: { type: Sequelize.STRING(50), allowNull: true },
      fit_preference: {
        type: Sequelize.STRING(50),
        allowNull: true,
        defaultValue: 'regular',
      },
      sizes: { type: Sequelize.JSONB, allowNull: true, defaultValue: {} },
      climate: { type: Sequelize.STRING(50), allowNull: true },
      activities: { type: Sequelize.JSONB, allowNull: true, defaultValue: [] },
      lifestyle: { type: Sequelize.STRING(100), allowNull: true },
      budget: { type: Sequelize.STRING(50), allowNull: true },
      shopping_frequency: { type: Sequelize.STRING(50), allowNull: true },
      sustainability_preference: { type: Sequelize.STRING(50), allowNull: true },
      age_range: { type: Sequelize.STRING(20), allowNull: true },
      gender: { type: Sequelize.STRING(50), allowNull: true },
      notification_preferences: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: {
          outfitSuggestions: true,
          weatherAlerts: true,
          tripReminders: true,
        },
      },
      notes: { type: Sequelize.TEXT, allowNull: true },
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

    await queryInterface.addIndex('user_preferences', ['user_id'], {
      name: 'idx_user_preferences_user_id',
      unique: true,
    });
    await queryInterface.addIndex('user_preferences', ['style_persona'], {
      name: 'idx_user_preferences_style',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_preferences');
  },
};
