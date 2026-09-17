'use strict';

/**
 * Phase 7 (PRD §3.15) -- "remind me to buy X while there" feature.
 * Reuses the existing Bull/Redis notification pipeline (same infra as
 * weather-triggered push notifications) -- this table just tracks what
 * to remind about and when, the delivery mechanism itself is not new.
 *
 * Either trip_id or outing_id may be set (not both) -- a reminder can
 * attach to a multi-day trip or a single local outing, matching the
 * dual Trip/Outing model from earlier in Phase 7.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('budget_reminders', {
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
      trip_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'trips', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      outing_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'outings', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      item_description: { type: Sequelize.STRING(255), allowNull: false },
      trigger_type: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'trip_active',
        comment: 'trip_active (fires once the trip/outing is underway) | specific_date',
      },
      trigger_date: { type: Sequelize.DATEONLY, allowNull: true },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
        comment: 'pending | sent | dismissed',
      },
      sent_at: { type: Sequelize.DATE, allowNull: true },
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

    await queryInterface.addIndex('budget_reminders', ['user_id', 'status'], {
      name: 'idx_budget_reminders_user_status',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('budget_reminders');
  },
};
