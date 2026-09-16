'use strict';

/**
 * Mirrors the `User` model in src/database/models/index.js.
 *
 * googleId/appleId and a nullable password are included from the start
 * here (rather than as a later ALTER) since this is the first migration
 * this project has ever had — there's no previously-deployed schema to
 * evolve, so the initial migration can just match the model as it
 * stands today (password/OAuth work, requested together).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('users', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true,
      },
      password_hash: {
        type: Sequelize.STRING(255),
        allowNull: true, // OAuth-only users have no password
      },
      full_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      google_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
        unique: true,
      },
      apple_id: {
        type: Sequelize.STRING(255),
        allowNull: true,
        unique: true,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      last_login: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      active_trip_id: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      trip_start_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      trip_end_date: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      packed_items: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: null,
      },
      trip_destination: {
        type: Sequelize.STRING(255),
        allowNull: true,
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

    await queryInterface.addIndex('users', ['email'], { name: 'idx_users_email' });
    await queryInterface.addIndex('users', ['created_at'], { name: 'idx_users_created_at' });
    await queryInterface.addIndex('users', ['active_trip_id'], { name: 'idx_users_active_trip_id' });
    await queryInterface.addIndex('users', ['trip_start_date', 'trip_end_date'], {
      name: 'idx_users_trip_dates',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('users');
  },
};
