/**
 * Product feed ingestion -- Phase 5 (Gap-to-Purchase Funnel, PRD §3.14),
 * Task #38.
 *
 * Research done during the Phase 5 brainstorm confirmed that direct
 * affiliate networks (Awin, CJ, Rakuten, Impact) distribute PRODUCT
 * FEEDS -- bulk downloadable files -- not a live per-request search API.
 * So style-aware product matching (Task #39) can never call out to a
 * network per recommendation; it has to query a local table that this
 * ingestion keeps in sync on a schedule. That local table is
 * ProductFeedItem (see migration 20260922000001-create-product-feed-items.js).
 *
 * Credential-gated, same pattern as weather.service.js's WEATHER_API_KEY
 * and affiliateLink.service.js's SKIMLINKS_PUBLISHER_ID: the hybrid
 * network strategy's direct-network leg is explicitly deferred (PRD §8
 * open decision #14) until funnel data justifies picking one, so there
 * is no real feed to pull yet. With no real network credentials
 * configured, ingestion runs against a small local mock feed fixture
 * (src/data/mockProductFeed.data.js) instead -- same table, same
 * normalization, same matching code downstream. Adding a real direct
 * network later means adding one new branch to fetchFeedForNetwork() and
 * one entry to INGESTION_NETWORKS; nothing else changes.
 *
 * Category normalization: every network uses its own taxonomy (English,
 * German, whatever the merchant's own catalog uses), so raw_category is
 * stored as-is for reference but matching always goes through the
 * normalized `category` column (one of our own wardrobe categories:
 * top/bottom/footwear/outerwear/dress/accessory). normalizeCategory()
 * checks both the feed's raw category AND the product title, because a
 * real feed's raw category is often untranslated/unmapped while the
 * title is usually still descriptive enough to classify on its own --
 * see the German-taxonomy rows in the mock fixture for exactly this case.
 * Unrecognized categories are stored as category: null (excluded from
 * matching, not guessed at) rather than forced into the nearest bucket.
 *
 * color is intentionally NOT part of category normalization or a hard
 * matching filter -- research confirmed it's merchant-dependent in real
 * feeds (plenty of rows simply won't have it), so it can only ever be a
 * soft ranking signal downstream.
 */

const { ProductFeedItem } = require('../database/models');
const logger = require('../utils/logger');
const mockFeedFixture = require('../data/mockProductFeed.data');

// Which networks to ingest from on each run. 'mock' always runs so the
// matching pipeline always has data to work against locally. Add a real
// network's string id here once it has real credentials AND a fetch
// branch below -- see PRD §8 open decision #14 for why none is added yet.
const INGESTION_NETWORKS = ['mock'];

const CATEGORY_KEYWORDS = {
  top: ['shirt', 'blouse', 'tee', 't-shirt', 'tank', 'sweater', 'jumper', 'hoodie', 'polo', 'pullover'],
  bottom: ['pant', 'trouser', 'jean', 'short', 'skirt', 'legging', 'chino'],
  footwear: ['shoe', 'boot', 'sneaker', 'sandal', 'heel', 'loafer'],
  outerwear: ['jacket', 'coat', 'parka', 'blazer', 'windbreaker', 'shell', 'windshirt'],
  dress: ['dress', 'gown', 'jumpsuit', 'romper'],
  accessory: ['belt', 'scarf', 'hat', 'beanie', 'bag', 'glove', 'umbrella', 'sunglass'],
};
// Check order matters only for ambiguous overlaps (none identified in
// practice) -- kept as an ordered list rather than an object for
// determinism.
const CATEGORY_CHECK_ORDER = ['top', 'bottom', 'footwear', 'outerwear', 'dress', 'accessory'];

/**
 * @param {string|null} rawCategory
 * @param {string} title
 * @returns {string|null} one of our own wardrobe categories, or null if
 *   nothing recognizable matched (excluded from matching downstream,
 *   never guessed at).
 */
function normalizeCategory(rawCategory, title) {
  const haystack = `${rawCategory || ''} ${title || ''}`.toLowerCase();
  for (const category of CATEGORY_CHECK_ORDER) {
    if (CATEGORY_KEYWORDS[category].some((keyword) => haystack.includes(keyword))) {
      return category;
    }
  }
  return null;
}

// Deliberately the same vocabulary affiliateLink.service.js's
// buildSearchQuery() appends based on gap weather ('rain', 'warm') --
// Task #39's matching can score a product higher when its style tags
// overlap the gap's weather-derived query terms.
const STYLE_TAG_RULES = [
  { tag: 'rain', keywords: ['waterproof', 'water-resistant', 'rain-resistant', 'rain'] },
  { tag: 'warm', keywords: ['insulated', 'thermal', 'wool', 'merino', 'fleece', 'lined', 'parka'] },
  { tag: 'lightweight', keywords: ['lightweight', 'breathable', 'mesh', 'packable'] },
];

/** @returns {string[]} descriptive style tags derived from title+description text. */
function deriveStyleTags(item) {
  const haystack = `${item.title || ''} ${item.description || ''}`.toLowerCase();
  return STYLE_TAG_RULES.filter((rule) => rule.keywords.some((k) => haystack.includes(k))).map((rule) => rule.tag);
}

let warnedRealNetworkStub = new Set();

/**
 * @param {string} network
 * @returns {Promise<Array<object>>} raw feed rows in the mock fixture's
 *   shape -- for a real network this is where the actual feed
 *   download/parse would happen.
 */
async function fetchFeedForNetwork(network) {
  if (network === 'mock') {
    return mockFeedFixture;
  }

  // Clearly marked stub, not a guessed implementation -- mirrors
  // affiliateConversion.service.js's fetchNetworkConversions() for the
  // same reason: no real network is configured yet (PRD §8 open decision
  // #14), so there is nothing real to call, and pretending otherwise
  // would be worse than an obvious no-op.
  if (!warnedRealNetworkStub.has(network)) {
    logger.warn(`Product feed ingestion: no fetch implementation for network "${network}" yet (no real direct-network credentials configured) -- returning zero rows.`);
    warnedRealNetworkStub.add(network);
  }
  return [];
}

/**
 * Ingests one network's feed: normalizes each row and upserts it into
 * product_feed_items, keyed on (network, external_id). A single bad row
 * is logged and skipped rather than aborting the whole feed -- same
 * "never break the caller" pattern used throughout Phase 5.
 *
 * @param {string} network
 * @returns {Promise<{network: string, fetched: number, upserted: number, skipped: number}>}
 */
async function ingestFeed(network) {
  const rows = await fetchFeedForNetwork(network);
  const feedFetchedAt = new Date();
  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const category = normalizeCategory(row.rawCategory, row.title);
      const styleTags = deriveStyleTags(row);
      const attrs = {
        merchantName: row.merchantName || null,
        title: row.title,
        description: row.description || null,
        rawCategory: row.rawCategory || null,
        category,
        brand: row.brand || null,
        color: row.color || null,
        styleTags,
        price: row.price != null ? row.price : null,
        currency: row.currency || null,
        imageUrl: row.imageUrl || null,
        productUrl: row.productUrl,
        region: row.region || null,
        feedFetchedAt,
      };

      // Upsert keyed on (network, external_id) -- deliberately NOT
      // Model.upsert(), since Sequelize's Postgres upsert targets the
      // primary key (id) for its ON CONFLICT clause by default, not this
      // table's real dedup key, which would insert a fresh-id duplicate
      // row every re-ingestion and then fail the unique index instead of
      // updating in place.
      const existing = await ProductFeedItem.findOne({ where: { network, externalId: row.externalId } });
      if (existing) {
        await existing.update(attrs);
      } else {
        await ProductFeedItem.create({ network, externalId: row.externalId, ...attrs });
      }
      upserted += 1;
    } catch (error) {
      skipped += 1;
      logger.warn('Product feed ingestion: skipped one row', { network, externalId: row.externalId, error: error.message });
    }
  }

  return { network, fetched: rows.length, upserted, skipped };
}

/**
 * Runs ingestion for every configured network and returns a summary.
 * Registered as a scheduled job (see productFeedIngestionQueue.js);
 * also safe to call directly/manually.
 */
async function runProductFeedIngestion() {
  const results = [];
  for (const network of INGESTION_NETWORKS) {
    try {
      results.push(await ingestFeed(network));
    } catch (error) {
      // A whole network's ingestion failing (e.g. a real feed download
      // erroring) shouldn't stop the others.
      logger.warn('Product feed ingestion: network run failed', { network, error: error.message });
      results.push({ network, fetched: 0, upserted: 0, skipped: 0, error: error.message });
    }
  }

  const summary = {
    networks: results,
    totalFetched: results.reduce((sum, r) => sum + r.fetched, 0),
    totalUpserted: results.reduce((sum, r) => sum + r.upserted, 0),
    totalSkipped: results.reduce((sum, r) => sum + r.skipped, 0),
  };
  logger.info('Product feed ingestion run complete', summary);
  return summary;
}

module.exports = {
  runProductFeedIngestion,
  ingestFeed,
  fetchFeedForNetwork,
  normalizeCategory,
  deriveStyleTags,
  INGESTION_NETWORKS,
};
