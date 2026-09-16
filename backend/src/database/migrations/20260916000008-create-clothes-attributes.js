'use strict';

/** Mirrors the `ClothesAttributes` model in src/database/models/index.js. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('clothes_attributes', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      clothes_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: { model: 'clothes', key: 'id' },
      },
      neckline: { type: Sequelize.STRING(50), allowNull: true },
      sleeve_length: { type: Sequelize.STRING(50), allowNull: true },
      detected_brand: { type: Sequelize.STRING(100), allowNull: true },
      clip_embedding: { type: Sequelize.JSONB, allowNull: true },
      style_embedding: { type: Sequelize.JSONB, allowNull: true },
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
  },

  async down(queryInterface) {
    await queryInterface.dropTable('clothes_attributes');
  },
};
