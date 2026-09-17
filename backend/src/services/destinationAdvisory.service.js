/**
 * Destination safety/security advisory ingestion -- Phase 7 (PRD
 * §3.15). Fallback chain decided in the Phase 7 brainstorm: UK FCDO's
 * API (primary) -> Canada's official open-data travel-advisory feed
 * (secondary) -> Australia's Smartraveller RSS feed (tertiary). All
 * three are free, official government sources.
 *
 * NO LLM ANYWHERE IN THIS FILE. Political instability and
 * natural-disaster risk change day to day, and an LLM's frozen
 * training knowledge would be actively dangerous to trust here --
 * worse than the budget-feasibility case (PRD §3.15). Every source
 * below is parsed deterministically (keyword/field matching against a
 * documented response shape), never LLM-extracted.
 *
 * HONESTY ON SOURCE CONFIDENCE (read before wiring real traffic to
 * this): FCDO's endpoint pattern (GOV.UK's Content API,
 * www.gov.uk/api/content/<path>) is a stable, documented GOV.UK
 * platform convention and was directly confirmed to have a real page
 * for arbitrary destinations (including the USA) during this phase's
 * brainstorm. Canada's and Smartraveller's exact machine-readable
 * endpoints were NOT confirmed with the same confidence -- rather than
 * guess a URL and present it as verified, those two are wired through
 * env-configured endpoints (CANADA_ADVISORY_RESOURCE_ID,
 * SMARTRAVELLER_RSS_BASE_URL) that default to unset, meaning those
 * sources are skipped (fall through immediately) until someone
 * confirms the real resource id/URL and sets it -- a config change,
 * not a code change, and never a fabricated endpoint masquerading as
 * verified. This is a real limitation to close before this ingestion
 * job is trusted in production; see feature-roadmap-tracker Phase 7.
 *
 * Every fetcher degrades to "this source failed, try the next one" on
 * ANY error (network, non-200, unexpected shape) -- never returns
 * guessed content. If all three fail, ingestAdvisoryForCountry()
 * returns allSourcesFailed: true and writes NOTHING to the DB -- the
 * read path (getAdvisoryForCountry) is what turns that into the
 * explicit "advisory data temporarily unavailable" message the PRD
 * requires, rather than silently omitting it or inventing content.
 */

const axios = require('axios');
const { Op } = require('sequelize');
const { DestinationAdvisory, Trip } = require('../database/models');
const logger = require('../utils/logger');

const FCDO_BASE_URL = 'https://www.gov.uk/api/content/foreign-travel-advice';
const CANADA_RESOURCE_ID = process.env.CANADA_ADVISORY_RESOURCE_ID || null;
const CANADA_DATASTORE_URL = 'https://open.canada.ca/data/api/action/datastore_search';
const SMARTRAVELLER_RSS_BASE = process.env.SMARTRAVELLER_RSS_BASE_URL || null;

const RISK_KEYWORDS = [
  { level: 'avoid_all', patterns: [/advis(e|ory) against all travel/i] },
  { level: 'avoid_nonessential', patterns: [/advis(e|ory) against all but essential travel/i] },
  { level: 'heightened_caution', patterns: [/exercise (a )?high degree of caution/i, /increased risk/i] },
  { level: 'normal', patterns: [] },
];

function detectRiskLevel(text) {
  if (!text) return 'normal';
  for (const { level, patterns } of RISK_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) return level;
  }
  return 'normal';
}

function stripHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function slugifyCountry(country) {
  return String(country).toLowerCase().trim().replace(/\s+/g, '-');
}

/**
 * FCDO -- GOV.UK Content API. Real, documented endpoint shape:
 * { details: { parts: [{ slug, title, body }] } }. Looks for a
 * "safety-and-security" part; falls through (throws) if the shape
 * doesn't match what's expected, rather than guessing.
 */
async function fetchFromFCDO(country) {
  const slug = slugifyCountry(country);
  const response = await axios.get(`${FCDO_BASE_URL}/${slug}`, { timeout: 8000 });
  const parts = response.data?.details?.parts;
  if (!Array.isArray(parts)) throw new Error('Unexpected FCDO response shape (no details.parts)');

  const safetyPart = parts.find((p) => /safety/i.test(p.slug || ''));
  const summaryPart = parts.find((p) => /summary/i.test(p.slug || '')) || parts[0];
  const bodyText = stripHtml(safetyPart?.body || summaryPart?.body);
  if (!bodyText) throw new Error('No usable FCDO content found');

  return {
    source: 'fcdo',
    riskLevel: detectRiskLevel(bodyText),
    summary: bodyText.slice(0, 1000),
    categories: { safetyAndSecurity: bodyText.slice(0, 1000) },
    sourceUrl: `https://www.gov.uk/foreign-travel-advice/${slug}`,
  };
}

/**
 * Canada -- open.canada.ca CKAN datastore. Skipped entirely (throws
 * immediately) until CANADA_ADVISORY_RESOURCE_ID is configured with a
 * confirmed real resource id -- see module doc above.
 */
async function fetchFromCanada(country) {
  if (!CANADA_RESOURCE_ID) throw new Error('CANADA_ADVISORY_RESOURCE_ID not configured -- source skipped, not guessed');

  const response = await axios.get(CANADA_DATASTORE_URL, {
    params: { resource_id: CANADA_RESOURCE_ID, q: country },
    timeout: 8000,
  });
  const records = response.data?.result?.records;
  if (!Array.isArray(records) || records.length === 0) throw new Error('No Canada advisory record found for this country');

  const record = records[0];
  const bodyText = stripHtml(record.advisory_text || record.summary || '');
  if (!bodyText) throw new Error('No usable Canada advisory content found');

  return {
    source: 'canada',
    riskLevel: detectRiskLevel(bodyText),
    summary: bodyText.slice(0, 1000),
    categories: { general: bodyText.slice(0, 1000) },
    sourceUrl: record.url || 'https://travel.gc.ca/travelling/advisories',
  };
}

/**
 * Smartraveller -- RSS feed. Skipped entirely (throws immediately)
 * until SMARTRAVELLER_RSS_BASE_URL is configured with a confirmed real
 * per-country feed pattern -- see module doc above.
 */
async function fetchFromSmartraveller(country) {
  if (!SMARTRAVELLER_RSS_BASE) throw new Error('SMARTRAVELLER_RSS_BASE_URL not configured -- source skipped, not guessed');

  const slug = slugifyCountry(country);
  const response = await axios.get(`${SMARTRAVELLER_RSS_BASE}/${slug}.rss`, { timeout: 8000 });
  const xml = String(response.data || '');
  const descriptionMatch = xml.match(/<description>([\s\S]*?)<\/description>/i);
  const bodyText = stripHtml(descriptionMatch?.[1]);
  if (!bodyText) throw new Error('No usable Smartraveller RSS content found');

  return {
    source: 'smartraveller',
    riskLevel: detectRiskLevel(bodyText),
    summary: bodyText.slice(0, 1000),
    categories: { general: bodyText.slice(0, 1000) },
    sourceUrl: `https://smartraveller.gov.au/destinations/${slug}`,
  };
}

const FALLBACK_CHAIN = [
  { name: 'fcdo', fetch: fetchFromFCDO },
  { name: 'canada', fetch: fetchFromCanada },
  { name: 'smartraveller', fetch: fetchFromSmartraveller },
];

/**
 * Tries each source in order, upserting DestinationAdvisory on the
 * first success. Writes NOTHING if every source fails -- an existing
 * (possibly older) stored advisory is left as-is rather than being
 * overwritten with nothing, since a slightly stale real advisory is
 * still better than losing it.
 */
async function ingestAdvisoryForCountry(country) {
  for (const { name, fetch } of FALLBACK_CHAIN) {
    try {
      const result = await fetch(country);
      await DestinationAdvisory.upsert({
        country,
        source: result.source,
        riskLevel: result.riskLevel,
        summary: result.summary,
        categories: result.categories,
        sourceUrl: result.sourceUrl,
        fetchedAt: new Date(),
      });
      logger.info('Destination advisory ingested', { country, source: name });
      return { ok: true, source: name };
    } catch (error) {
      logger.warn(`Destination advisory source failed, trying next in chain`, { country, source: name, error: error.message });
    }
  }
  logger.warn('All destination advisory sources failed for this country', { country });
  return { ok: false, allSourcesFailed: true };
}

/**
 * Read path -- the only place the PRD's explicit "temporarily
 * unavailable" fallback message gets constructed. Never fabricates
 * content: either a real ingested advisory exists, or the user is told
 * plainly that it doesn't, with a pointer to check the official source
 * directly.
 */
async function getAdvisoryForCountry(country) {
  if (!country) return { available: false, message: 'No destination country given.' };

  const row = await DestinationAdvisory.findOne({ where: { country } });
  if (!row) {
    return {
      available: false,
      message: 'Advisory data temporarily unavailable -- check gov.uk/foreign-travel-advice directly.',
    };
  }

  return {
    available: true,
    country: row.country,
    source: row.source,
    riskLevel: row.riskLevel,
    summary: row.summary,
    categories: row.categories,
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt,
  };
}

/**
 * Scheduled-job entry point -- ingests advisories for every distinct
 * country currently referenced by an active or upcoming trip. A
 * practical scope (not the whole world upfront): countries no one is
 * actually planning to visit right now don't need daily advisory
 * ingestion, and this list naturally grows as real trips get created.
 */
async function runDestinationAdvisoryIngestion() {
  const trips = await Trip.findAll({
    where: { status: { [Op.in]: ['upcoming', 'active'] }, country: { [Op.ne]: null } },
    attributes: ['country'],
    group: ['country'],
  });
  const countries = trips.map((t) => t.country).filter(Boolean);

  const results = [];
  for (const country of countries) {
    const result = await ingestAdvisoryForCountry(country);
    results.push({ country, ...result });
  }
  return { countriesProcessed: countries.length, results };
}

module.exports = {
  ingestAdvisoryForCountry,
  getAdvisoryForCountry,
  runDestinationAdvisoryIngestion,
  fetchFromFCDO,
  fetchFromCanada,
  fetchFromSmartraveller,
  detectRiskLevel,
};
