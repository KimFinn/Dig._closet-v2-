'use strict';

/** Mirrors the `Trip` model in src/database/models/index.js. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('trips', {
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
      destination: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      city: { type: Sequelize.STRING(100), allowNull: true },
      country: { type: Sequelize.STRING(100), allowNull: true },
      start_date: { type: Sequelize.DATE, allowNull: false },
      end_date: { type: Sequelize.DATE, allowNull: false },
      duration_days: { type: Sequelize.INTEGER, allowNull: true },
      purpose: {
        type: Sequelize.STRING(100),
        allowNull: true,
        defaultValue: 'leisure',
      },
      trip_type: { type: Sequelize.STRING(100), allowNull: true },
      status: {
        type: Sequelize.ENUM('upcoming', 'active', 'completed', 'cancelled'),
        allowNull: false,
        defaultValue: 'upcoming',
      },
      budget: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      accommodation: { type: Sequelize.STRING(255), allowNull: true },
      transportation: { type: Sequelize.STRING(255), allowNull: true },
      companions: {
        type: Sequelize.INTEGER,
        allowNull: true,
        defaultValue: 1,
      },
      weather_summary: { type: Sequelize.TEXT, allowNull: true },
      weather_data: { type: Sequelize.JSONB, allowNull: true },
      packing_list: { type: Sequelize.JSONB, allowNull: true },
      recommended_outfits: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
      },
      notes: { type: Sequelize.TEXT, allowNull: true },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      checklist: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
      },
      completed_at: { type: Sequelize.DATE, allowNull: true },
      rating: { type: Sequelize.DECIMAL(2, 1), allowNull: true },
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

    await queryInterface.addIndex('trips', ['user_id'], { name: 'idx_trips_user_id' });
    await queryInterface.addIndex('trips', ['created_at'], { name: 'idx_trips_created_at' });
    await queryInterface.addIndex('trips', ['start_date'], { name: 'idx_trips_start_date' });
    await queryInterface.addIndex('trips', ['end_date'], { name: 'idx_trips_end_date' });
    await queryInterface.addIndex('trips', ['status'], { name: 'idx_trips_status' });
    await queryInterface.addIndex('trips', ['is_active'], { name: 'idx_trips_is_active' });
    await queryInterface.addIndex('trips', ['user_id', 'is_active'], {
      name: 'idx_trips_user_active',
    });
    await queryInterface.addIndex('trips', ['user_id', 'start_date', 'end_date'], {
      name: 'idx_trips_user_dates',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('trips');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_trips_status";');
  },
};
