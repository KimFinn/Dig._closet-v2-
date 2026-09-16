'use strict';

/** Mirrors the `FashionTrends` model in src/database/models/index.js. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('fashion_trends', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      trend_type: {
        type: Sequelize.ENUM('color', 'style', 'pattern', 'fabric'),
        allowNull: false,
      },
      trend_value: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      popularity_score: { type: Sequelize.DECIMAL(3, 2), allowNull: true },
      season: { type: Sequelize.STRING(20), allowNull: true },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('fashion_trends', ['trend_type'], {
      name: 'idx_fashion_trends_trend_type',
    });
    await queryInterface.addIndex('fashion_trends', ['is_active'], {
      name: 'idx_fashion_trends_is_active',
    });
    await queryInterface.addIndex('fashion_trends', ['season'], {
      name: 'idx_fashion_trends_season',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('fashion_trends');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_fashion_trends_trend_type";');
  },
};
