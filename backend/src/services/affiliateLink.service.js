/**
 * Affiliate link generation v1 -- Phase 5 (Gap-to-Purchase Funnel, PRD
 * §3.14).
 *
 * v1 deliberately does NOT depend on a product catalog: it wraps an
 * affiliate-tracked link straight to a retailer's on-site search results
 * for the gap's category/keywords. No product-feed dependency, works the
 * same way across regions/retailers, and is fast to ship -- the
 * style-aware product-matching upgrade (later in Phase 5) replaces this
 * with a specific matched product when the ingested feed has one, and
 * falls back to this exact mechanism when it doesn't.
 *
 * Built credential-gated, same pattern as weather.service.js's
 * WEATHER_API_KEY: no real affiliate account exists yet, and network
 * approval isn't guaranteed or instant, so this can't be an engineering
 * blocker. With no AFFILIATE_* env vars configured, every function here
 * still works end-to-end -- it just returns a plain, untracked retailer
 * link (network: 'mock', live: false) instead of a commercially tracked
 * one. The moment real credentials exist, only buildAffiliateUrl()
 * needs to start returning a real wrapped URL; nothing else in the
 * pipeline (funnel logging, urgency gating, the API surface) changes.
 *
 * Aggregator-first, per the PRD §3.14 network-strategy decision: the
 * default network is a Skimlinks/Sovrn-style aggregator (one integration,
 * broad regional coverage via networks it partners with) rather than a
 * single direct network -- direct network integrations for top retailers
 * are a later, funnel-data-justified addition (see feature-roadmap-tracker
 * Phase 5, item "Direct network integration(s)").
 */

const logger = require('../utils/logger');

const SKIMLINKS_PUBLISHER_ID = process.env.SKIMLINKS_PUBLISHER_ID || null;
let warnedNoCredentials = false;

/**
 * Very small, deliberately non-exhaustive region -> default retailer
 * search-URL template map, just enough to demonstrate the real mechanic
 * (region-aware retailer selection feeding one shared affiliate-wrap
 * step) -- NOT a curated retailer strategy. Widening this list, or
 * replacing it with a data-driven lookup, is exactly the kind of
 * decision the roadmap's "funnel data reviewed" step exists to inform;
 * hardcoding a large list now would be guessing.
 */
const RETAILER_SEARCH_BY_REGION = {
  default: (query) => `https://www.amazon.com/s?k=${encodeURIComponent(query)}`,
  Germany: (query) => `https://www.zalando.de/search/?q=${encodeURIComponent(query)}`,
  Iceland: (query) => `https://www.zalando.de/search/?q=${encodeURIComponent(query)}`,
  'United Kingdom': (query) => `https://www.zalando.co.uk/search/?q=${encodeURIComponent(query)}`,
};

function buildSearchQuery(gapDetails) {
  const parts = [gapDetails.category];
  if (gapDetails.weather && gapDetails.weather.condition === 'rain') parts.push('rain');
  if (gapDetails.weather && typeof gapDetails.weather.temp === 'number' && gapDetails.weather.temp < 10) parts.push('warm');
  return parts.filter(Boolean).join(' ');
}

function destinationUrlFor(region, query) {
  const template = RETAILER_SEARCH_BY_REGION[region] || RETAILER_SEARCH_BY_REGION.default;
  return template(query);
}

/**
 * Wraps a plain destination URL in an affiliate redirect when real
 * credentials exist, else returns it unwrapped. Isolated in its own
 * function so this is the ONLY place that needs to change once a real
 * account exists.
 *
 * @param {string} destinationUrl
 * @param {string} clickId - our own RecommendationLog row id, passed
 *   through as the network's subid/click-reference parameter so a real
 *   network's conversion report can be matched back to this exact
 *   suggestion later (see affiliateConversion.service.js). Embedded
 *   regardless of live/mock, so the shape is exercised even without
 *   real credentials.
 */
function buildAffiliateUrl(destinationUrl, clickId) {
  if (SKIMLINKS_PUBLISHER_ID) {
    // Illustrative of Skimlinks' actual redirect shape -- exact format
    // should be confirmed against real account docs once one exists;
    // this branch is untestable live without real credentials, so it's
    // written to be obviously correct in shape rather than verified
    // end-to-end here.
    return {
      url: `https://go.skimresources.com/?id=${encodeURIComponent(SKIMLINKS_PUBLISHER_ID)}&xs=1&url=${encodeURIComponent(destinationUrl)}&subid=${encodeURIComponent(clickId)}`,
      network: 'skimlinks',
      live: true,
    };
  }

  if (!warnedNoCredentials) {
    logger.warn('No affiliate network credentials configured (SKIMLINKS_PUBLISHER_ID) -- affiliate links will be plain, untracked retailer links until a real account is connected.');
    warnedNoCredentials = true;
  }
  // Mock mode still appends our click id as an ordinary query param --
  // harmless for a plain retailer link, and keeps the URL shape
  // consistent with the live branch for anything downstream that reads it.
  const separator = destinationUrl.includes('?') ? '&' : '?';
  return { url: `${destinationUrl}${separator}claude_click_id=${encodeURIComponent(clickId)}`, network: 'mock', live: false };
}

/**
 * @param {object} gapDetails - the RecommendationLog.gapDetails JSONB
 *   (category, occasion, weather, ...).
 * @param {string|null} region - resolved via region.service.js.
 * @param {string} clickId - RecommendationLog row id (see buildAffiliateUrl).
 * @returns {{url: string, network: string, live: boolean, query: string}}
 */
function generateSearchResultsLink(gapDetails, region, clickId) {
  const query = buildSearchQuery(gapDetails);
  const destinationUrl = destinationUrlFor(region, query);
  const { url, network, live } = buildAffiliateUrl(destinationUrl, clickId);
  return { url, network, live, query };
}

/**
 * Style-aware upgrade (Task #39) over generateSearchResultsLink(): wraps
 * a SPECIFIC matched product's page instead of a generic search-results
 * page. Deliberately routes through the exact same buildAffiliateUrl()
 * used above -- the credential-gating logic (real network vs mock) stays
 * in exactly one place regardless of which kind of link is being made.
 *
 * @param {string} productUrl - a ProductFeedItem.productUrl.
 * @param {string} clickId - RecommendationLog row id.
 */
function generateProductLink(productUrl, clickId) {
  const { url, network, live } = buildAffiliateUrl(productUrl, clickId);
  return { url, network, live };
}

const DISCLOSURE_TEXT = 'This may be an affiliate link -- we may earn a commission if you buy through it, at no extra cost to you.';

module.exports = { generateSearchResultsLink, generateProductLink, DISCLOSURE_TEXT, buildSearchQuery };
