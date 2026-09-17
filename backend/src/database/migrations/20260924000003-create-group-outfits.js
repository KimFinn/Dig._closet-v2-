'use strict';

/**
 * Phase 8 (PRD §3.9) -- a coordinated or cross-closet-borrowed outfit
 * for one shared trip activity. Trip- and activity-scoped for this
 * phase only (the data-model sketch's alternate bare `event_ref`, for
 * coordinating with no Trip at all, is deferred -- 2026-09-17 scoping
 * decision).
 *
 * Two modes share one table rather than two, since both are "a shared
 * styling record for one activity, involving more than one person's
 * wardrobe decisions" -- they differ in what's stored (theme +
 * per-person outfit links vs. an ownership-tagged item list), not in
 * their identity/lifecycle:
 *  - coordinated: `theme` (palette/formality/notes) + `participant_outfits`
 *    ([{userId, outfitId}], each person's own outfit, never another
 *    person's items).
 *  - cross_closet: `items` ([{itemId, ownerUserId}]), always tagging
 *    true ownership, built from explicit ClosetShare-granted picks --
 *    never an algorithmically blended pool.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('group_outfits', {
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
      activity_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'trip_activities', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
      },
      mode: {
        type: Sequelize.STRING(20),
        allowNull: false,
        comment: 'coordinated | cross_closet',
      },
      theme: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'coordinated mode only: { palette, formality, notes }',
      },
      participant_outfits: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'coordinated mode only: [{ userId, outfitId }]',
      },
      items: {
        type: Sequelize.JSONB,
        allowNull: true,
        defaultValue: [],
        comment: 'cross_closet mode only: [{ itemId, ownerUserId }] -- always true ownership, never blended',
      },
      created_by: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL',
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
    await queryInterface.addIndex('group_outfits', ['trip_id'], { name: 'idx_group_outfits_trip' });
    await queryInterface.addIndex('group_outfits', ['activity_id'], { name: 'idx_group_outfits_activity' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('group_outfits');
  },
};
