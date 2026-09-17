'use strict';

/**
 * Phase 3 roadmap item: "TripActivity and TripParticipant tables
 * scaffolded (schema only — not used yet)". Deliberately schema-only,
 * matching that wording exactly -- no controllers/routes/services read
 * or write these yet. They exist so a later phase (multi-person trips,
 * a real per-activity itinerary UI) has the tables to build on without
 * a migration blocking it. `trips.activities` (see the previous
 * migration) remains the actual source of per-day occasions the Phase 3
 * packing algorithm reads; these tables are not wired to it.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('trip_activities', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      trip_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'trips', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      date: { type: Sequelize.DATEONLY, allowNull: false },
      time_slot: { type: Sequelize.STRING(50), allowNull: true },
      occasion: { type: Sequelize.STRING(100), allowNull: true },
      title: { type: Sequelize.STRING(255), allowNull: true },
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
    await queryInterface.addIndex('trip_activities', ['trip_id'], { name: 'idx_trip_activities_trip_id' });

    await queryInterface.createTable('trip_participants', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      trip_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'trips', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: true, // nullable: a participant may not have an account yet (invited by name/email only)
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
      },
      name: { type: Sequelize.STRING(255), allowNull: true },
      email: { type: Sequelize.STRING(255), allowNull: true },
      role: { type: Sequelize.STRING(50), allowNull: true, defaultValue: 'companion' },
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
    await queryInterface.addIndex('trip_participants', ['trip_id'], { name: 'idx_trip_participants_trip_id' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('trip_participants');
    await queryInterface.dropTable('trip_activities');
  },
};
