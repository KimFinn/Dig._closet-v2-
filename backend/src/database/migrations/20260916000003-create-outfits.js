'use strict';

/** Mirrors the `Outfit` model in src/database/models/index.js. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('outfits', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      occasion: { type: Sequelize.STRING(100), allowNull: true },
      items: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      is_suggested: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_favorite: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      wear_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      last_worn_at: { type: Sequelize.DATE, allowNull: true },
      notes: { type: Sequelize.TEXT, allowNull: true },
      season: { type: Sequelize.STRING(50), allowNull: true },
      weather_condition: { type: Sequelize.STRING(50), allowNull: true },
      image_url: { type: Sequelize.STRING(500), allowNull: true },
      tags: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
      },
      color_palette: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
      },
      rating: { type: Sequelize.DECIMAL(2, 1), allowNull: true },
      ai_confidence_score: { type: Sequelize.DECIMAL(3, 2), allowNull: true },
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

    await queryInterface.addIndex('outfits', ['user_id'], { name: 'idx_outfits_user_id' });
    await queryInterface.addIndex('outfits', ['created_at'], { name: 'idx_outfits_created_at' });
    await queryInterface.addIndex('outfits', ['occasion'], { name: 'idx_outfits_occasion' });
    await queryInterface.addIndex('outfits', ['is_favorite'], { name: 'idx_outfits_is_favorite' });
    await queryInterface.addIndex('outfits', ['is_active'], { name: 'idx_outfits_is_active' });
    await queryInterface.addIndex('outfits', ['user_id', 'is_active'], {
      name: 'idx_outfits_user_active',
    });
    await queryInterface.addIndex('outfits', ['wear_count'], { name: 'idx_outfits_wear_count' });
    await queryInterface.addIndex('outfits', ['season'], { name: 'idx_outfits_season' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('outfits');
  },
};
