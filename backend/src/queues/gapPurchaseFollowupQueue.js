/**
 * Gap-purchase funnel follow-up (Bull + Redis) -- Phase 5 (Gap-to-
 * Purchase Funnel, PRD §3.14).
 *
 * One repeatable job, two things it does each run, same shape as
 * checkInQueue.js's daily check-in but for the purchase funnel instead
 * of the wear funnel:
 *
 *   1. Conversion reconciliation -- pull each affiliate network's
 *      conversion report and advance matching gap recommendations to
 *      'purchased'. See affiliateConversion.service.js; no-op with no
 *      real network credentials configured, same as every other
 *      credential-gated piece of this integration.
 *   2. Self-report check-in emails -- for a gap recommendation the user
 *      clicked through on but hasn't been confirmed purchased (by
 *      either the network or a prior self-report), and enough time has
 *      passed to plausibly have made a decision, ask "did you end up
 *      buying it?" This is the faster signal than waiting on (1)'s
 *      network-reporting delay.
 *
 * Redis-guarded per RECOMMENDATION (not per user, unlike the daily wear
 * check-in) -- asking about the same specific suggestion more than once
 * is just annoying, and if it eventually converts through the network
 * that's still caught by reconciliation regardless of whether the email
 * was sent.
 */

const Queue = require('bull');
const redis = require('redis');
const { Op } = require('sequelize');
const logger = require('../utils/logger');
const { RecommendationLog, User, UserPreferences } = require('../database/models');
const { sendNotification, gapPurchaseCheckInEmail } = require('../services/notification.service');
const { runConversionReconciliation } = require('../services/affiliateConversion.service');

const redisConnection = {
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
};

const gapPurchaseFollowupQueue = new Queue('gap-purchase-followup', { redis: redisConnection });

gapPurchaseFollowupQueue.on('error', (err) => {
  logger.error('Gap-purchase followup queue error', { message: err.message });
});
gapPurchaseFollowupQueue.on('failed', (job, err) => {
  logger.error('Gap-purchase followup job failed', { jobId: job.id, message: err.message });
});

// How long to wait after a click before asking "did you buy it?" -- long
// enough that a real purchase decision has plausibly been made, short
// enough that the person still remembers what they clicked on.
const CHECKIN_DELAY_HOURS = parseInt(process.env.GAP_PURCHASE_CHECKIN_DELAY_HOURS || '24', 10);
const MAX_CHECKIN_EMAILS_PER_RUN = parseInt(process.env.GAP_PURCHASE_CHECKIN_MAX_EMAILS || '500', 10);

let guardClient = null;
async function getGuardClient() {
  if (!guardClient) {
    guardClient = redis.createClient({
      socket: {
        host: process.env.REDIS_CLOUD_HOST || 'localhost',
        port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
        tls: process.env.REDIS_TLS === 'true',
        rejectUnauthorized: false,
      },
      password: process.env.REDIS_CLOUD_PASSWORD,
    });
    guardClient.on('error', (err) => logger.error('Gap-purchase check-in guard cache error', { message: err.message }));
    await guardClient.connect();
  }
  return guardClient;
}

function guardKey(recommendationLogId) {
  return `gappurchase:checkin:sent:${recommendationLogId}`;
}

/** True if this specific gap recommendation hasn't already been asked about; also claims it. */
async function claimGuard(recommendationLogId) {
  const cache = await getGuardClient();
  // NX, no re-ask window needed -- once asked about a specific
  // suggestion is enough (30 days is just "don't keep this key forever
  // for no reason", not a deliberate re-ask window).
  const result = await cache.set(guardKey(recommendationLogId), '1', { NX: true, EX: 30 * 24 * 60 * 60 });
  return result === 'OK';
}

async function findEligibleForCheckIn() {
  const cutoff = new Date(Date.now() - CHECKIN_DELAY_HOURS * 60 * 60 * 1000);

  const rows = await RecommendationLog.findAll({
    where: {
      recommendationType: 'gap_purchase',
      funnelStage: 'clicked',
      clickedAt: { [Op.lte]: cutoff },
      purchasedAt: null,
    },
  });
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.userId))];
  const [users, preferences] = await Promise.all([
    User.findAll({ where: { id: userIds, isActive: true }, attributes: ['id', 'email', 'fullName'] }),
    UserPreferences.findAll({ where: { userId: userIds }, attributes: ['userId', 'notificationPreferences'] }),
  ]);
  const usersById = new Map(users.map((u) => [u.id, u]));
  const prefsByUser = new Map(preferences.map((p) => [p.userId, p.notificationPreferences || {}]));

  const eligible = [];
  for (const row of rows) {
    const user = usersById.get(row.userId);
    if (!user) continue; // deactivated/deleted since the click
    const prefs = prefsByUser.get(row.userId) || {};
    if (prefs.gapPurchaseCheckIn === false) continue; // explicit opt-out; missing key defaults to "on"
    eligible.push({ row, user });
  }
  return eligible;
}

async function processGapPurchaseFollowup() {
  const reconciliation = await runConversionReconciliation();

  const eligible = await findEligibleForCheckIn();
  let sent = 0;
  let skippedGuard = 0;
  let failed = 0;

  for (const { row, user } of eligible) {
    if (sent >= MAX_CHECKIN_EMAILS_PER_RUN) {
      logger.warn('Gap-purchase check-in run hit its per-run email cap, stopping early', { cap: MAX_CHECKIN_EMAILS_PER_RUN });
      break;
    }

    const claimed = await claimGuard(row.id);
    if (!claimed) {
      skippedGuard += 1;
      continue;
    }

    const { subject, html } = gapPurchaseCheckInEmail(user, row.gapDetails);
    const result = await sendNotification(user, { subject, html });
    if (result.sent || result.reason === 'no_api_key') {
      sent += 1;
    } else {
      failed += 1;
      logger.warn('Gap-purchase check-in email failed', { userId: user.id, recommendationLogId: row.id, reason: result.reason });
    }
  }

  const outcome = { reconciliation, checkIn: { eligible: eligible.length, sent, skippedGuard, failed } };
  logger.info('Gap-purchase followup run complete', outcome);
  return outcome;
}

async function scheduleGapPurchaseFollowup() {
  const cron = process.env.GAP_PURCHASE_FOLLOWUP_CRON || '0 6 * * *'; // 06:00 UTC by default
  await gapPurchaseFollowupQueue.add(
    'gap-purchase-followup-run',
    {},
    {
      repeat: { cron },
      jobId: 'gap-purchase-followup-run',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
  logger.info(`Gap-purchase followup job scheduled (cron: "${cron}")`);
}

module.exports = {
  gapPurchaseFollowupQueue,
  processGapPurchaseFollowup,
  scheduleGapPurchaseFollowup,
  findEligibleForCheckIn,
};
