'use strict';

/** Mirrors the `Clothes` model in src/database/models/index.js. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('clothes', {
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
      type: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      color: { type: Sequelize.STRING(100), allowNull: true },
      pattern: { type: Sequelize.STRING(100), allowNull: true },
      fabric: { type: Sequelize.STRING(100), allowNull: true },
      season: { type: Sequelize.STRING(100), allowNull: true },
      occasion: { type: Sequelize.STRING(100), allowNull: true },
      brand: { type: Sequelize.STRING(100), allowNull: true },
      size: { type: Sequelize.STRING(20), allowNull: true },
      purchase_price: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      purchase_date: { type: Sequelize.DATEONLY, allowNull: true },
      image_url: {
        type: Sequelize.STRING(500),
        allowNull: false,
      },
      cloudinary_public_id: { type: Sequelize.STRING(255), allowNull: true },
      tags: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
      },
      notes: { type: Sequelize.TEXT, allowNull: true },
      wear_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      last_worn_at: { type: Sequelize.DATE, allowNull: true },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      is_favorite: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      condition: {
        type: Sequelize.ENUM('new', 'excellent', 'good', 'fair', 'poor'),
        allowNull: true,
        defaultValue: 'good',
      },
      care_instructions: { type: Sequelize.TEXT, allowNull: true },
      ai_metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: null,
      },
      ai_generated_tags: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      ai_confidence_score: { type: Sequelize.DECIMAL(3, 2), allowNull: true },
      needs_manual_review: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
        defaultValue: false,
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

    await queryInterface.addIndex('clothes', ['user_id'], { name: 'idx_clothes_user_id' });
    await queryInterface.addIndex('clothes', ['created_at'], { name: 'idx_clothes_created_at' });
    await queryInterface.addIndex('clothes', ['type'], { name: 'idx_clothes_type' });
    await queryInterface.addIndex('clothes', ['season'], { name: 'idx_clothes_season' });
    await queryInterface.addIndex('clothes', ['is_active'], { name: 'idx_clothes_is_active' });
    await queryInterface.addIndex('clothes', ['user_id', 'is_active'], {
      name: 'idx_clothes_user_active',
    });
    await queryInterface.addIndex('clothes', ['wear_count'], { name: 'idx_clothes_wear_count' });
    await queryInterface.addIndex('clothes', ['last_worn_at'], { name: 'idx_clothes_last_worn' });
    await queryInterface.addIndex('clothes', ['ai_confidence_score'], {
      name: 'idx_clothes_ai_confidence',
    });
    await queryInterface.addIndex('clothes', ['needs_manual_review'], {
      name: 'idx_clothes_needs_review',
    });
    await queryInterface.addIndex('clothes', ['ai_generated_tags'], {
      name: 'idx_clothes_ai_generated',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('clothes');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_clothes_condition";');
  },
};
