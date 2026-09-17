'use strict';

/**
 * Phase 8 (PRD §3.9) -- cross-closet borrowing consent. Explicit,
 * mutual, revocable, and scoped by the owner's choice. Kept as three
 * genuinely distinct scopes (not collapsed to two) per the 2026-09-17
 * scoping decision -- event_only points at one specific TripActivity
 * (scoped_activity_id), trip_only at a whole Trip (scoped_trip_id),
 * full_wardrobe at neither. Scope validity (which columns must/must not
 * be set for a given scope) is enforced at the service layer, matching
 * this codebase's existing convention of app-level `validate: isIn`
 * checks rather than DB CHECK constraints/enums.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('closet_shares', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      owner_user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      recipient_user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      scope: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'event_only | trip_only | full_wardrobe',
      },
      scoped_trip_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'trips', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      scoped_activity_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'trip_activities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      status: {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: 'pending',
        comment: 'pending | active | revoked',
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
    await queryInterface.addIndex('closet_shares', ['owner_user_id'], { name: 'idx_closet_shares_owner' });
    await queryInterface.addIndex('closet_shares', ['recipient_user_id'], { name: 'idx_closet_shares_recipient' });
    await queryInterface.addIndex('closet_shares', ['scoped_trip_id'], { name: 'idx_closet_shares_trip' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('closet_shares');
  },
};
