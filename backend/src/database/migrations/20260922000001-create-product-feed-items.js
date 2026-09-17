'use strict';

/**
 * Phase 5 (Gap-to-Purchase Funnel, PRD §3.14) -- local mirror of affiliate
 * network product feeds, for Task #39's style-aware product matching.
 *
 * Why a table exists for this at all: research done during the Phase 5
 * brainstorm confirmed that Awin/CJ/Rakuten/Impact-style direct networks
 * distribute PRODUCT FEEDS (bulk downloadable files: title, image, price,
 * brand, category, GTIN, a tracking-embedded deep link), not a live
 * per-request search API. That means matching "the user needs a warm top"
 * against a real catalog has to be a scheduled ingest-then-query pipeline
 * against a local table, never a live third-party call per recommendation.
 *
 * This is built now, credential-gated exactly like weather/affiliate
 * links elsewhere in Phase 5: with no real direct-network credentials
 * configured (hybrid strategy's direct-network leg is explicitly
 * deferred until funnel data justifies picking one -- PRD §8 open
 * decision #14), productFeed.service.js ingests a small local MOCK feed
 * fixture instead of a real one. The table shape, indexes, and the
 * ingestion/matching code built against them are unaffected by which
 * network eventually supplies the real rows -- only the fetch step
 * changes.
 *
 * category is the NORMALIZED value (top/bottom/footwear/outerwear/
 * dress/accessory -- see productFeed.service.js's normalizeCategory),
 * kept separate from rawCategory (whatever string the feed itself used)
 * because every network's taxonomy differs and gap matching needs to
 * join against our own wardrobe categories, not the feed's.
 *
 * color is nullable and explicitly a SOFT signal, never a hard filter --
 * research confirmed attribute richness (especially color) is
 * merchant-dependent in real feeds, so plenty of real rows won't have it.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('product_feed_items', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      network: {
        type: Sequelize.STRING(50),
        allowNull: false,
        comment: '"mock" until a real direct network is added; then e.g. "awin", "cj"',
      },
      external_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'The network/merchant\'s own product id (SKU/GTIN/feed row id) -- dedup key together with network',
      },
      merchant_name: { type: Sequelize.STRING(150), allowNull: true },
      title: { type: Sequelize.STRING(255), allowNull: false },
      description: { type: Sequelize.TEXT, allowNull: true },
      raw_category: {
        type: Sequelize.STRING(150),
        allowNull: true,
        comment: 'Category string exactly as the feed gave it, pre-normalization',
      },
      category: {
        type: Sequelize.STRING(20),
        allowNull: true,
        comment: 'Normalized to our own wardrobe categories (top/bottom/footwear/outerwear/dress/accessory); null if unrecognized',
      },
      brand: { type: Sequelize.STRING(100), allowNull: true },
      color: {
        type: Sequelize.STRING(50),
        allowNull: true,
        comment: 'Merchant-dependent in real feeds -- a soft ranking signal, never a hard filter',
      },
      style_tags: {
        type: Sequelize.JSONB,
        allowNull: true,
        comment: 'Descriptive tags derived from title/category (e.g. warmth, formality) for soft style matching',
      },
      price: { type: Sequelize.DECIMAL(10, 2), allowNull: true },
      currency: { type: Sequelize.STRING(3), allowNull: true },
      image_url: { type: Sequelize.TEXT, allowNull: true },
      product_url: {
        type: Sequelize.TEXT,
        allowNull: false,
        comment: 'Destination page the deep link ultimately resolves to',
      },
      deep_link: {
        type: Sequelize.TEXT,
        allowNull: true,
        comment: 'Affiliate-tracked link for this specific product; null until link generation runs',
      },
      region: {
        type: Sequelize.STRING(100),
        allowNull: true,
        comment: 'Same free-text region convention as recommendation_logs.region (see migration 20260922000002 -- country names like "United Kingdom" don\'t fit VARCHAR(10))',
      },
      feed_fetched_at: { type: Sequelize.DATE, allowNull: false },
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

    // Dedup/upsert key -- re-ingesting the same feed row (price refresh,
    // daily re-pull) updates in place instead of duplicating.
    await queryInterface.addIndex(
      'product_feed_items',
      ['network', 'external_id'],
      { name: 'idx_product_feed_items_network_external_id', unique: true }
    );
    // Matching query shape: "eligible products for category X in region Y".
    await queryInterface.addIndex(
      'product_feed_items',
      ['category', 'region'],
      { name: 'idx_product_feed_items_category_region' }
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('product_feed_items');
  },
};
