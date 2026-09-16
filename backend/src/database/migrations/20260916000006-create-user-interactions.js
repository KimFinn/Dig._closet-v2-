'use strict';

/** Mirrors the `UserInteraction` model in src/database/models/index.js. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('user_interactions', {
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
      item_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'clothes', key: 'id' },
      },
      outfit_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'outfits', key: 'id' },
      },
      action: {
        type: Sequelize.ENUM('view', 'like', 'dislike', 'save', 'share', 'wear', 'skip'),
        allowNull: false,
      },
      duration_seconds: { type: Sequelize.INTEGER, allowNull: true },
      context: { type: Sequelize.JSONB, allowNull: true },
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

    await queryInterface.addIndex('user_interactions', ['user_id'], {
      name: 'idx_user_interactions_user_id',
    });
    await queryInterface.addIndex('user_interactions', ['created_at'], {
      name: 'idx_user_interactions_created_at',
    });
    await queryInterface.addIndex('user_interactions', ['action'], {
      name: 'idx_user_interactions_action',
    });
    await queryInterface.addIndex('user_interactions', ['user_id', 'action'], {
      name: 'idx_user_interactions_user_action',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('user_interactions');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_user_interactions_action";');
  },
};
