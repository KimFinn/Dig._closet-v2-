/**
 * Affiliate conversion reconciliation -- Phase 5 (Gap-to-Purchase Funnel,
 * PRD §3.14).
 *
 * Attribution isn't manual follow-up: a network reports conversions back
 * on its own schedule (often after the retailer's own return window
 * closes -- commonly one to several weeks), matched back to internal
 * click IDs (the RecommendationLog row id, embedded in the link by
 * affiliateLink.service.js). This is the job that does that matching.
 *
 * fetchNetworkConversions() is the credential-gated part -- no real
 * account exists yet, so it returns nothing rather than failing, same
 * pattern as every other external integration in this app. Once a real
 * network account exists, only this function needs a real API call
 * added; reconcileConversions() (the actual matching logic) doesn't
 * change and is fully testable today with synthetic conversion data.
 */

const { RecommendationLog } = require('../database/models');
const { stageIndex } = require('./gapPurchase.service');
const logger = require('../utils/logger');

const SKIMLINKS_PUBLISHER_ID = process.env.SKIMLINKS_PUBLISHER_ID || null;

/**
 * @param {string} network - e.g. 'skimlinks'
 * @returns {Promise<Array<{clickId: string, purchasedAt: Date}>>}
 */
async function fetchNetworkConversions(network) {
  if (network === 'skimlinks' && SKIMLINKS_PUBLISHER_ID) {
    // TODO once a real Skimlinks/Sovrn account exists: call their real
    // conversion-reporting API for the reconciliation window and map
    // each conversion's subid back to {clickId, purchasedAt}. No account
    // to test this against yet, so left as a clearly-marked stub rather
    // than a guessed implementation.
    logger.warn('fetchNetworkConversions: real Skimlinks credentials are configured but the reporting-API call is not implemented yet -- returning no conversions.');
    return [];
  }
  return [];
}

/**
 * Matches a batch of conversions back to RecommendationLog rows by click
 * ID and advances them to 'purchased'. Never regresses a stage (a
 * conversion for a row already marked purchased, e.g. via the
 * self-report check-in, is a no-op, not a double-write).
 *
 * @param {Array<{clickId: string, purchasedAt?: Date}>} conversions
 */
async function reconcileConversions(conversions) {
  let matched = 0;
  let alreadyPurchased = 0;
  let notFound = 0;

  for (const conversion of conversions) {
    const row = await RecommendationLog.findOne({
      where: { id: conversion.clickId, recommendationType: 'gap_purchase' },
    });
    if (!row) {
      notFound++;
      logger.warn('Conversion reconciliation: no matching gap recommendation for click id', { clickId: conversion.clickId });
      continue;
    }
    if (stageIndex(row.funnelStage) >= stageIndex('purchased')) {
      alreadyPurchased++;
      continue;
    }
    await row.update({
      funnelStage: 'purchased',
      purchasedAt: conversion.purchasedAt || new Date(),
      purchaseSelfReported: false,
    });
    matched++;
  }

  return { matched, alreadyPurchased, notFound, total: conversions.length };
}

/** Networks that currently exist in the hybrid mix -- extend as direct network integrations are added (see roadmap). */
const RECONCILED_NETWORKS = ['skimlinks'];

async function runConversionReconciliation() {
  let fetched = 0;
  let matched = 0;
  let alreadyPurchased = 0;
  let notFound = 0;

  for (const network of RECONCILED_NETWORKS) {
    const conversions = await fetchNetworkConversions(network);
    fetched += conversions.length;
    const result = await reconcileConversions(conversions);
    matched += result.matched;
    alreadyPurchased += result.alreadyPurchased;
    notFound += result.notFound;
  }

  logger.info('Affiliate conversion reconciliation complete', { fetched, matched, alreadyPurchased, notFound });
  return { fetched, matched, alreadyPurchased, notFound };
}

module.exports = { fetchNetworkConversions, reconcileConversions, runConversionReconciliation, RECONCILED_NETWORKS };
