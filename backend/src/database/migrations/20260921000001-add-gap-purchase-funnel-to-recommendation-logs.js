'use strict';

/**
 * Phase 5 — Gap-to-Purchase Funnel.
 *
 * Extends `recommendation_logs` (rather than adding a new table) so a
 * gap-purchase suggestion is just another kind of recommendation event,
 * queryable alongside outfit recommendations with the same
 * user_id/created_at indexes already in place.
 *
 * IMPORTANT: `recommendation_type` defaults to 'outfit' so every existing
 * row (and every existing write in AIOutfit recommendation.js) keeps its
 * current meaning unchanged. outfitAnalytics.service.js's swap/regret
 * detection reads "the most recent RecommendationLog row for today" --
 * without this default (and the corresponding filter added to that
 * query), a gap-purchase row created later in the day would silently
 * become "today's recommendation" for swap detection, which is wrong.
 * See src/services/outfitAnalytics.service.js for the matching fix.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('recommendation_logs', 'recommendation_type', {
      type: Sequelize.ENUM('outfit', 'gap_purchase'),
      allowNull: false,
      defaultValue: 'outfit',
    });

    await queryInterface.addColumn('recommendation_logs', 'funnel_stage', {
      type: Sequelize.ENUM('suggested', 'clicked', 'purchased', 'worn'),
      allowNull: true,
      comment: 'Only meaningful for recommendation_type = gap_purchase',
    });

    await queryInterface.addColumn('recommendation_logs', 'gap_details', {
      type: Sequelize.JSONB,
      allowNull: true,
      comment: 'Descriptive gap spec: category, attributes (color/warmth/etc), reason',
    });

    await queryInterface.addColumn('recommendation_logs', 'trip_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'trips', key: 'id' },
      comment: 'Set when the gap was detected in the context of a specific trip',
    });

    await queryInterface.addColumn('recommendation_logs', 'urgency', {
      type: Sequelize.ENUM('purchase_eligible', 'too_urgent'),
      allowNull: true,
      comment: 'Result of the days-until-needed vs shipping-lead-time check',
    });

    await queryInterface.addColumn('recommendation_logs', 'region', {
      type: Sequelize.STRING(10),
      allowNull: true,
      comment: 'Resolved region (ISO-ish country code) used to pick the affiliate link',
    });

    await queryInterface.addColumn('recommendation_logs', 'affiliate_network', {
      type: Sequelize.STRING(50),
      allowNull: true,
      comment: 'e.g. "skimlinks", "awin", or "mock" when built credential-gated with no live key',
    });

    await queryInterface.addColumn('recommendation_logs', 'affiliate_link', {
      type: Sequelize.TEXT,
      allowNull: true,
    });

    await queryInterface.addColumn('recommendation_logs', 'matched_product', {
      type: Sequelize.JSONB,
      allowNull: true,
      comment: 'Set once product-feed style matching (later in Phase 5) finds a specific SKU; null for a v1 search-results-page link',
    });

    await queryInterface.addColumn('recommendation_logs', 'clicked_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('recommendation_logs', 'purchased_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('recommendation_logs', 'purchase_self_reported', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      comment: 'true if filled by the "did you buy it?" check-in rather than network conversion reconciliation',
    });
    await queryInterface.addColumn('recommendation_logs', 'worn_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addIndex('recommendation_logs', ['recommendation_type', 'funnel_stage'], {
      name: 'idx_recommendation_logs_type_stage',
    });
    await queryInterface.addIndex('recommendation_logs', ['trip_id'], {
      name: 'idx_recommendation_logs_trip_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('recommendation_logs', 'idx_recommendation_logs_trip_id');
    await queryInterface.removeIndex('recommendation_logs', 'idx_recommendation_logs_type_stage');

    await queryInterface.removeColumn('recommendation_logs', 'worn_at');
    await queryInterface.removeColumn('recommendation_logs', 'purchase_self_reported');
    await queryInterface.removeColumn('recommendation_logs', 'purchased_at');
    await queryInterface.removeColumn('recommendation_logs', 'clicked_at');
    await queryInterface.removeColumn('recommendation_logs', 'matched_product');
    await queryInterface.removeColumn('recommendation_logs', 'affiliate_link');
    await queryInterface.removeColumn('recommendation_logs', 'affiliate_network');
    await queryInterface.removeColumn('recommendation_logs', 'region');
    await queryInterface.removeColumn('recommendation_logs', 'urgency');
    await queryInterface.removeColumn('recommendation_logs', 'trip_id');
    await queryInterface.removeColumn('recommendation_logs', 'gap_details');
    await queryInterface.removeColumn('recommendation_logs', 'funnel_stage');
    await queryInterface.removeColumn('recommendation_logs', 'recommendation_type');

    // Drop the ENUM types Postgres created for these columns -- Sequelize
    // doesn't do this automatically on removeColumn.
    const { sequelize } = require('../models');
    await sequelize.query('DROP TYPE IF EXISTS "enum_recommendation_logs_recommendation_type";');
    await sequelize.query('DROP TYPE IF EXISTS "enum_recommendation_logs_funnel_stage";');
    await sequelize.query('DROP TYPE IF EXISTS "enum_recommendation_logs_urgency";');
  },
};
