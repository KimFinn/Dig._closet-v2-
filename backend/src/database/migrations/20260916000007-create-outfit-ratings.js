'use strict';

/** Mirrors the `OutfitRating` model in src/database/models/index.js. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('outfit_ratings', {
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
      outfit_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'outfits', key: 'id' },
      },
      overall_rating: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      style_rating: { type: Sequelize.INTEGER, allowNull: true },
      comfort_rating: { type: Sequelize.INTEGER, allowNull: true },
      review: { type: Sequelize.TEXT, allowNull: true },
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

    await queryInterface.addIndex('outfit_ratings', ['user_id'], {
      name: 'idx_outfit_ratings_user_id',
    });
    await queryInterface.addIndex('outfit_ratings', ['outfit_id'], {
      name: 'idx_outfit_ratings_outfit_id',
    });
    await queryInterface.addIndex('outfit_ratings', ['overall_rating'], {
      name: 'idx_outfit_ratings_overall_rating',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('outfit_ratings');
  },
};
