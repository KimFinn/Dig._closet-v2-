/**
 * Style-aware product matching -- Phase 5 (Gap-to-Purchase Funnel, PRD
 * §3.14), Task #39.
 *
 * This is the "if the gap is a shirt, recommend shirts based on their
 * style" upgrade the user asked for directly, built as an upgrade LAYER
 * over v1's search-results-page link rather than a replacement for it --
 * exactly as scoped when Phase 5 was planned: it queries the locally
 * ingested product_feed_items (see productFeed.service.js -- there is no
 * live per-request search API to call), tries to find a specific product
 * in the right category and region, and ranks candidates by how well
 * they fit the user's known style preferences.
 *
 * Three-tier outcome (added after the user asked directly what happens
 * when there's no match for their region -- see the matchType field):
 *   1. 'exact'               -- a candidate in the user's own resolved
 *      region (or a region-less/globally-sold row).
 *   2. 'closest_other_region' -- no regional candidate, but the category
 *      exists in the catalog under a DIFFERENT region. Surfaced as a
 *      secondary suggestion, explicitly labeled as NOT confirmed
 *      available/shippable in the user's region -- we don't have real
 *      per-product shipping-destination data (no real network account
 *      exists yet, and even a real feed's "region" typically means "the
 *      retailer's storefront locale," not an exhaustive ships-to list),
 *      so the honest thing is to say "unconfirmed," not "ships here."
 *      The user explicitly chose this over hiding it or claiming it can
 *      ship -- they can just not use it if it doesn't pan out.
 *   3. 'none'                -- nothing in the catalog for this category
 *      at all. The caller (gapPurchase.service.js) still falls back to
 *      the v1 generic search-results link (a missing catalog row should
 *      never mean "no purchase option"), but now says so explicitly
 *      instead of silently handing over an unlabeled link.
 *
 * Scoring is soft everywhere, on purpose:
 *  - category + region are the only hard filters (there's no point
 *    recommending a product that literally isn't sold where the user is).
 *  - color is NEVER a hard filter -- research done during the Phase 5
 *    brainstorm confirmed real feeds are inconsistent about supplying it,
 *    so a hard filter would silently exclude a lot of otherwise-good
 *    matches. It's a ranking bonus only.
 *  - style-tag overlap (rain/warm/lightweight, matching the gap's
 *    weather -- see gapUrgency/affiliateLink's own vocabulary) and brand
 *    preference are the same: bonuses, not gates.
 *  - avoidColors is a penalty, not an exclusion, for the same reason --
 *    it should lose to a candidate that fits better, but a user's single
 *    disliked color shouldn't leave them with zero purchase option when
 *    it's the only item in stock for their category+region.
 */

const { ProductFeedItem, UserPreferences } = require('../database/models');
const { formatPrice } = require('../utils/currency');
const logger = require('../utils/logger');

const SCORE = {
  STYLE_TAG_MATCH: 2,
  PREFERRED_COLOR_MATCH: 1,
  PREFERRED_BRAND_MATCH: 1,
  AVOID_COLOR_PENALTY: -3,
};

/** Same vocabulary as productFeed.service.js's STYLE_TAG_RULES, derived from the gap's weather instead of a product's text. */
function deriveGapStyleTags(gapDetails) {
  const tags = [];
  const weather = gapDetails && gapDetails.weather;
  if (weather) {
    if (weather.condition === 'rain') tags.push('rain');
    if (typeof weather.temp === 'number' && weather.temp < 10) tags.push('warm');
    if (typeof weather.temp === 'number' && weather.temp > 25) tags.push('lightweight');
  }
  return tags;
}

function normalizedIncludes(list, value) {
  if (!Array.isArray(list) || !value) return false;
  const needle = String(value).toLowerCase();
  return list.some((item) => typeof item === 'string' && item.toLowerCase() === needle);
}

function scoreCandidate(product, gapStyleTags, preferences) {
  let score = 0;
  const productTags = Array.isArray(product.styleTags) ? product.styleTags : [];
  score += gapStyleTags.filter((tag) => productTags.includes(tag)).length * SCORE.STYLE_TAG_MATCH;

  if (preferences) {
    if (normalizedIncludes(preferences.preferredColors, product.color)) score += SCORE.PREFERRED_COLOR_MATCH;
    if (normalizedIncludes(preferences.preferredBrands, product.brand)) score += SCORE.PREFERRED_BRAND_MATCH;
    if (normalizedIncludes(preferences.avoidColors, product.color)) score += SCORE.AVOID_COLOR_PENALTY;
  }

  return score;
}

/** Picks the best-scoring row out of a candidate list (or null for an empty list). */
function pickBest(candidates, gapStyleTags, preferences) {
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, gapStyleTags, preferences);
    // Tie-break on most recently ingested, so a stale duplicate never
    // wins over a fresher one purely by insertion order.
    if (score > bestScore || (score === bestScore && best && candidate.feedFetchedAt > best.feedFetchedAt)) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * @param {string} userId
 * @param {object} gapDetails - RecommendationLog.gapDetails (category, weather, ...).
 * @param {string|null} region - resolved via region.service.js.
 * @returns {Promise<{matchType: 'exact'|'closest_other_region'|'none', product: object|null}>}
 */
async function findMatchingProduct(userId, gapDetails, region) {
  const category = gapDetails && gapDetails.category;
  if (!category) return { matchType: 'none', product: null };

  let regionalCandidates;
  let anyCandidates;
  try {
    // Everything in this category, region-eligible or not -- one query,
    // split client-side into the two tiers below, rather than two round
    // trips (the "any region" set is a strict superset of "regional").
    anyCandidates = await ProductFeedItem.findAll({ where: { category } });
  } catch (error) {
    logger.warn('Product matching: candidate lookup failed', { userId, category, region, error: error.message });
    return { matchType: 'none', product: null };
  }
  if (!anyCandidates || anyCandidates.length === 0) return { matchType: 'none', product: null };

  // A feed row with no region restriction (region: null) is available
  // everywhere -- see mockProductFeed.data.js's region-less rows,
  // standing in for a real network's globally-sold products.
  regionalCandidates = anyCandidates.filter((c) => c.region === region || c.region === null);

  let preferences = null;
  try {
    preferences = await UserPreferences.findOne({
      where: { userId },
      attributes: ['preferredColors', 'avoidColors', 'preferredBrands'],
    });
  } catch (error) {
    // No style preferences available is fine -- matching still runs on
    // category/region + weather-derived style tags alone.
    logger.warn('Product matching: preference lookup failed, matching without style bonus', { userId, error: error.message });
  }

  const gapStyleTags = deriveGapStyleTags(gapDetails);

  if (regionalCandidates.length > 0) {
    return { matchType: 'exact', product: pickBest(regionalCandidates, gapStyleTags, preferences) };
  }

  // No candidate confirmed for this region -- fall back to the best
  // candidate from ANY region rather than nothing, explicitly labeled by
  // the caller as unconfirmed (see buildMatchEnvelope).
  return { matchType: 'closest_other_region', product: pickBest(anyCandidates, gapStyleTags, preferences) };
}

/**
 * Shapes a matched ProductFeedItem row into the JSON stored on
 * RecommendationLog.matchedProduct and returned to the client -- includes
 * priceDisplay (Task #39's currency-display piece: shown in the
 * product's own currency, no FX conversion -- see utils/currency.js).
 */
function toMatchedProductPayload(product) {
  return {
    id: product.id,
    title: product.title,
    merchantName: product.merchantName,
    brand: product.brand,
    color: product.color,
    price: product.price,
    currency: product.currency,
    priceDisplay: formatPrice(product.price, product.currency),
    imageUrl: product.imageUrl,
    productUrl: product.productUrl,
    region: product.region,
  };
}

/**
 * Builds the full envelope persisted on RecommendationLog.matchedProduct
 * and returned from the API -- one place that decides the user-facing
 * message for each of the three matchTypes, so gapPurchase.service.js
 * doesn't have to know the wording.
 *
 * @param {'exact'|'closest_other_region'|'none'} matchType
 * @param {object|null} product - a ProductFeedItem row, or null for 'none'.
 * @param {string|null} userRegion - the user's own resolved region.
 */
function buildMatchEnvelope(matchType, product, userRegion) {
  if (matchType === 'none' || !product) {
    return {
      matchType: 'none',
      product: null,
      message: "We don't have a specific product to recommend for this yet -- here's a place to search instead.",
    };
  }

  if (matchType === 'exact') {
    return { matchType: 'exact', product: toMatchedProductPayload(product), message: null };
  }

  // closest_other_region
  const regionLabel = userRegion || 'your region';
  return {
    matchType: 'closest_other_region',
    product: toMatchedProductPayload(product),
    message: `Closest style match we found, but it's listed for ${product.region} -- we can't confirm it ships to ${regionLabel}. Worth checking before you buy, or use the search link instead.`,
  };
}

module.exports = { findMatchingProduct, toMatchedProductPayload, buildMatchEnvelope, deriveGapStyleTags, scoreCandidate };
