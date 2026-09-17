/**
 * Gap-purchase funnel orchestration -- Phase 5 (Gap-to-Purchase Funnel,
 * PRD §3.14). Sits between the raw RecommendationLog rows
 * (gapRecommendation.service.js) and the API layer: decides whether a
 * given gap gets a purchase link at all, generates it when it does, and
 * advances funnel stages (clicked / purchased) as the user acts.
 *
 * The urgency gate is the whole point of this file: a gap classified
 * `too_urgent` (not enough time for standard shipping to arrive before
 * it's needed -- see gapUrgency.service.js) NEVER gets a purchase link.
 * There is no separate "local store" flow to route to here either --
 * that's deliberately deferred to Phase 7's Places integration (PRD
 * §3.14) -- so the honest answer for a too-urgent gap is "no purchase
 * option; see today's recommendation for the best compromise from what
 * you packed," which is exactly what the existing Phase 4 trip-gap
 * fallback (AIOutfit recommendation.js's _buildBestAvailableFallbackOutfit)
 * already surfaces on its own at recommendation time -- nothing new
 * needs to run it, this file just makes sure a purchase CTA never
 * contradicts it.
 */

const { RecommendationLog } = require('../database/models');
const { generateSearchResultsLink, generateProductLink, DISCLOSURE_TEXT } = require('./affiliateLink.service');
const { findMatchingProduct, buildMatchEnvelope } = require('./productMatching.service');
const { findNearbyForCategory } = require('./places.service');
const logger = require('../utils/logger');

const FUNNEL_STAGE_ORDER = ['suggested', 'clicked', 'purchased', 'worn'];

function stageIndex(stage) {
  const idx = FUNNEL_STAGE_ORDER.indexOf(stage);
  return idx === -1 ? 0 : idx;
}

/**
 * Returns what the client should show for one gap recommendation: either
 * a purchase link (with disclosure copy) or an explicit "not available,
 * here's why" for a too-urgent gap. Generates and persists the link on
 * first call (idempotent after that -- a regenerated link would create a
 * confusing "which link did I actually click" gap between what's shown
 * and what's logged).
 *
 * @param {string} userId
 * @param {string} recommendationLogId
 */
async function getGapPurchaseSuggestion(userId, recommendationLogId) {
  const row = await RecommendationLog.findOne({
    where: { id: recommendationLogId, userId, recommendationType: 'gap_purchase' },
  });
  if (!row) {
    const err = new Error('Gap recommendation not found');
    err.statusCode = 404;
    throw err;
  }

  if (row.urgency === 'too_urgent') {
    // Phase 7 (PRD §3.8) -- the nearby-store carryover deliberately
    // deferred from Phase 5: shipping can't make it in time, but a real
    // local-store option is a different kind of answer with no shipping
    // constraint. Surfaced ALONGSIDE the packed-outfit compromise below,
    // never replacing it -- if no suitable nearby store exists (or the
    // lookup itself fails), that compromise is still the honest fallback.
    // This never claims a confirmed purchase the way the shipped-item
    // flow does -- same "unconfirmed, here's a pointer" framing already
    // used for Phase 5's cross-region product match.
    let nearbyStores = null;
    const category = row.gapDetails && row.gapDetails.category;
    if (category) {
      try {
        const { results, live } = await findNearbyForCategory(category, row.region, { count: 3 });
        if (results.length > 0) {
          nearbyStores = {
            places: results.map((r) => ({
              placeId: r.placeId,
              name: r.name,
              formattedAddress: r.formattedAddress,
              rating: r.rating,
            })),
            live,
            message: "There isn't enough time left for standard shipping, but here's somewhere nearby that might have it -- worth calling ahead to confirm before you go.",
          };
        }
      } catch (error) {
        // Never let a Places failure block the too-urgent response --
        // the packed-outfit compromise below is still a complete answer
        // on its own.
        logger.warn('Nearby-store lookup failed, falling back to packed-outfit compromise only', {
          recommendationLogId, category, error: error.message,
        });
      }
    }

    return {
      id: row.id,
      purchaseAvailable: false,
      reason: 'too_urgent',
      message: "There isn't enough time left for standard shipping to arrive before this is needed. See today's recommendation for the best option from what you already packed.",
      nearbyStores,
      gapDetails: row.gapDetails,
    };
  }

  // Link already generated on a previous call -- reuse it rather than
  // regenerating (and definitely rather than silently changing what a
  // user already clicked on). This covers all three match outcomes (an
  // exact-region product, an unconfirmed cross-region one, or the v1
  // generic search link) identically, since affiliateLink/matchedProduct
  // are set exactly once below regardless of which one it was.
  if (row.affiliateLink) {
    const persisted = row.matchedProduct || {};
    return {
      id: row.id,
      purchaseAvailable: true,
      link: row.affiliateLink,
      network: row.affiliateNetwork,
      matchType: persisted.matchType || (persisted.product ? 'exact' : 'none'),
      matchedProduct: persisted.product || null,
      matchMessage: persisted.message || null,
      disclosure: DISCLOSURE_TEXT,
      gapDetails: row.gapDetails,
      funnelStage: row.funnelStage,
    };
  }

  // Task #39: try to find a specific matching product in the locally
  // ingested feed before falling back to v1's generic search-results
  // link -- and be explicit about which of the three outcomes happened
  // (exact / closest-but-unconfirmed-region / no catalog match at all),
  // rather than silently handing over a link with no explanation. See
  // productMatching.service.js's buildMatchEnvelope for the exact wording.
  let envelope;
  let url;
  let network;
  let live;
  try {
    const { matchType, product } = await findMatchingProduct(userId, row.gapDetails, row.region);
    envelope = buildMatchEnvelope(matchType, product, row.region);
  } catch (error) {
    // Matching is a pure upgrade -- any failure here falls straight
    // through to the v1 search-results link below, never blocks it.
    logger.warn('Product matching failed, falling back to search-results link', { recommendationLogId, error: error.message });
    envelope = buildMatchEnvelope('none', null, row.region);
  }

  if (envelope.product) {
    const linkResult = generateProductLink(envelope.product.productUrl, row.id);
    url = linkResult.url;
    network = linkResult.network;
    live = linkResult.live;
  } else {
    const searchResult = generateSearchResultsLink(row.gapDetails, row.region, row.id);
    url = searchResult.url;
    network = searchResult.network;
    live = searchResult.live;
  }

  try {
    await row.update({ affiliateLink: url, affiliateNetwork: network, matchedProduct: envelope });
  } catch (error) {
    // Still return the generated link even if persisting it failed --
    // the user gets a working link either way; the click-tracking write
    // below is where a failed persist would actually matter, and that's
    // guarded separately.
    logger.warn('Failed to persist generated affiliate link', { recommendationLogId, error: error.message });
  }

  return {
    id: row.id,
    purchaseAvailable: true,
    link: url,
    network,
    live,
    matchType: envelope.matchType,
    matchedProduct: envelope.product,
    matchMessage: envelope.message,
    disclosure: DISCLOSURE_TEXT,
    gapDetails: row.gapDetails,
    funnelStage: row.funnelStage,
  };
}

/**
 * Advances a gap recommendation to `clicked`. Never moves a funnel stage
 * backward (e.g. a re-click after purchase stays `purchased`) -- stage
 * transitions are monotonic, matching the funnel's intended shape
 * (suggested -> clicked -> purchased -> worn).
 */
async function recordGapClick(userId, recommendationLogId) {
  const row = await RecommendationLog.findOne({
    where: { id: recommendationLogId, userId, recommendationType: 'gap_purchase' },
  });
  if (!row) {
    const err = new Error('Gap recommendation not found');
    err.statusCode = 404;
    throw err;
  }

  const update = { clickedAt: new Date() };
  if (stageIndex(row.funnelStage) < stageIndex('clicked')) {
    update.funnelStage = 'clicked';
  }
  await row.update(update);
  return row;
}

/**
 * Self-reported "did you end up buying it?" response -- faster signal
 * than waiting on network conversion reconciliation (which can lag days
 * to weeks). purchaseSelfReported distinguishes this from a
 * network-confirmed conversion for anyone later auditing funnel data.
 *
 * A "no" doesn't move the funnel stage backward or forward -- it's
 * useful signal (this suggestion didn't convert) but there's no
 * "declined" stage in the funnel; logged for visibility, not state.
 */
async function recordSelfReportedPurchase(userId, recommendationLogId, purchased) {
  const row = await RecommendationLog.findOne({
    where: { id: recommendationLogId, userId, recommendationType: 'gap_purchase' },
  });
  if (!row) {
    const err = new Error('Gap recommendation not found');
    err.statusCode = 404;
    throw err;
  }

  if (!purchased) {
    logger.info('Gap-purchase self-report: user said they did not buy it', { userId, recommendationLogId });
    return row;
  }

  if (stageIndex(row.funnelStage) < stageIndex('purchased')) {
    await row.update({ funnelStage: 'purchased', purchasedAt: new Date(), purchaseSelfReported: true });
  } else if (!row.purchasedAt) {
    // Already at/past 'purchased' (e.g. network reconciliation beat the
    // self-report here) but somehow missing a timestamp -- fill it in
    // without touching purchaseSelfReported, since the network's own
    // confirmation should still get credit as the source of truth.
    await row.update({ purchasedAt: new Date() });
  }
  return row;
}

module.exports = { getGapPurchaseSuggestion, recordGapClick, recordSelfReportedPurchase, FUNNEL_STAGE_ORDER, stageIndex };
