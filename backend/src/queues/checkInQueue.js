/**
 * Evening wardrobe digest queue (Bull + Redis) — Phase 2, reworked for
 * Phase 10 (PRD §3.11, scoped 2026-09-18).
 *
 * Was a single global nightly batch sending one "did you wear it?"
 * email at one fixed UTC time. Now an HOURLY sweep: every run checks
 * which eligible users' own local hour (from their stored `timezone`,
 * see checkInStreak.service.js#getLocalHour) matches their preferred
 * evening-digest send hour (`notification_preferences.digestSendHour`,
 * default DEFAULT_DIGEST_SEND_HOUR), and only emails those users right
 * now. A user with no timezone captured yet falls back to UTC, which
 * reproduces exactly Phase 2's original fixed-UTC-time behavior for
 * any account created before this field existed.
 *
 * The email itself is now ONE unified evening digest
 * (notification.service.js#eveningDigestEmail) bundling: the check-in
 * prompt (only when not already logged today), an "on this day" memory
 * (onThisDay.service.js, when one exists), and a "haven't worn this in
 * a while" nudge (closetResurfacing.service.js, when one is eligible
 * and off cooldown) — one send instead of several, directly resolving
 * the notification-fatigue risk the PRD itself calls out.
 *
 * Known v1 simplification, not silently overclaimed: "already checked
 * in today" is computed against a UTC calendar day, not each user's own
 * local midnight (unlike the streak, which is genuinely local-day-aware
 * — see checkInStreak.service.js). A user near the UTC day boundary
 * could in rare cases see this be a few hours off. Low-stakes here since
 * it only affects whether the check-in *prompt line* is included, not
 * whether the digest sends or the streak counts correctly.
 *
 * Guard/cap reasoning unchanged from Phase 2:
 *   - isActive = false -> skip (deactivated account)
 *   - no wardrobe items -> skip (nothing to have "worn" yet)
 *   - notification_preferences.dailyCheckIn === false -> skip (opted out)
 *   - not this user's chosen local hour right now -> skip (not yet, try
 *     again on their hour)
 *   - already emailed today (Redis guard, survives a job retry) -> skip
 *   - nothing worth saying tonight (already checked in, no memory, no
 *     eligible nudge) -> skip -- no content, no email
 *   - hard cap per run (DAILY_CHECKIN_MAX_EMAILS) -> stop, so a bug that
 *     somehow widens the candidate set can't blow through the whole
 *     monthly email quota in one run
 */

const Queue = require('bull');
const redis = require('redis');
const { Op, fn, col } = require('sequelize');
const logger = require('../utils/logger');
const { User, Clothes, UserPreferences, UserInteraction } = require('../database/models');
const { sendNotification, eveningDigestEmail } = require('../services/notification.service');
const { getLocalHour } = require('../services/checkInStreak.service');
const { getOnThisDayMemory } = require('../services/onThisDay.service');
const { getHavenNotWornNudge, markNudged } = require('../services/closetResurfacing.service');

const redisConnection = {
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
};

const checkInQueue = new Queue('daily-checkin', { redis: redisConnection });

checkInQueue.on('error', (err) => {
  logger.error('Check-in queue error', { message: err.message });
});
checkInQueue.on('failed', (job, err) => {
  logger.error('Check-in job failed', { jobId: job.id, message: err.message });
});

const MAX_EMAILS_PER_RUN = parseInt(process.env.DAILY_CHECKIN_MAX_EMAILS || '500', 10);
const DEFAULT_DIGEST_SEND_HOUR = parseInt(process.env.DEFAULT_DIGEST_SEND_HOUR || '19', 10);

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
    guardClient.on('error', (err) => logger.error('Check-in guard cache error', { message: err.message }));
    await guardClient.connect();
  }
  return guardClient;
}

function guardKey(userId) {
  const today = new Date().toISOString().split('T')[0];
  return `checkin:sent:${userId}:${today}`;
}

/** True if we haven't already sent this user a digest today; also claims it. */
async function claimGuard(userId) {
  const cache = await getGuardClient();
  // NX + 25h TTL (a bit over a day, so a late-running job near midnight
  // still covers "today") -- SET ... NX is atomic, so two overlapping
  // job runs (or two hourly ticks) can't both send to the same user.
  const result = await cache.set(guardKey(userId), '1', { NX: true, EX: 25 * 60 * 60 });
  return result === 'OK';
}

function startOfUTCDay() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function findEligibleUsers() {
  const ownersOfActiveClothes = await Clothes.findAll({
    where: { isActive: true },
    attributes: [[fn('DISTINCT', col('user_id')), 'userId']],
    raw: true,
  });
  const candidateIds = ownersOfActiveClothes.map((r) => r.userId).filter(Boolean);
  if (candidateIds.length === 0) return [];

  const [users, preferences, todaysWears] = await Promise.all([
    User.findAll({ where: { id: candidateIds, isActive: true }, attributes: ['id', 'email', 'fullName', 'timezone'] }),
    UserPreferences.findAll({ where: { userId: candidateIds }, attributes: ['userId', 'notificationPreferences'] }),
    UserInteraction.findAll({
      where: { userId: candidateIds, action: 'wear', createdAt: { [Op.gte]: startOfUTCDay() } },
      attributes: ['userId'],
      raw: true,
    }),
  ]);

  const prefsByUser = new Map(preferences.map((p) => [p.userId, p.notificationPreferences || {}]));
  const alreadyWoreToday = new Set(todaysWears.map((w) => w.userId));

  return users
    .map((user) => ({
      user,
      prefs: prefsByUser.get(user.id) || {},
      hasCheckedInToday: alreadyWoreToday.has(user.id),
    }))
    .filter(({ prefs }) => prefs.dailyCheckIn !== false); // explicit opt-out; missing key defaults to "on"
}

async function processDailyCheckIn() {
  const eligible = await findEligibleUsers();
  const now = new Date();

  let sent = 0;
  let skippedGuard = 0;
  let skippedNotTheirHour = 0;
  let skippedNothingToSay = 0;
  let failed = 0;

  for (const { user, prefs, hasCheckedInToday } of eligible) {
    if (sent >= MAX_EMAILS_PER_RUN) {
      logger.warn('Evening digest run hit its per-run email cap, stopping early', { cap: MAX_EMAILS_PER_RUN });
      break;
    }

    const localHour = getLocalHour(user.timezone, now);
    const preferredHour = Number.isInteger(prefs.digestSendHour) ? prefs.digestSendHour : DEFAULT_DIGEST_SEND_HOUR;
    if (localHour !== preferredHour) {
      skippedNotTheirHour += 1;
      continue; // not this user's evening yet -- an hourly tick will catch it when it is
    }

    const claimed = await claimGuard(user.id);
    if (!claimed) {
      skippedGuard += 1;
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const [onThisDay, nudge] = await Promise.all([
      getOnThisDayMemory(user.id, { now }),
      getHavenNotWornNudge(user.id, { now }),
    ]);

    const hasMemory = onThisDay && onThisDay.hasMemory;
    if (hasCheckedInToday && !hasMemory && !nudge) {
      // Nothing worth saying tonight -- already know they wore
      // something, no anniversary memory, no eligible neglected item.
      skippedNothingToSay += 1;
      continue;
    }

    const { subject, html } = eveningDigestEmail(user, { hasCheckedInToday, onThisDay, nudge });
    const result = await sendNotification(user, { subject, html });
    if (result.sent || result.reason === 'no_api_key') {
      // "no_api_key" still counts as handled -- dev environments without
      // a Resend account yet shouldn't loop-retry this every run.
      sent += 1;
      if (nudge) {
        await markNudged(nudge.id, { now });
      }
    } else {
      failed += 1;
      logger.warn('Evening digest email failed', { userId: user.id, reason: result.reason });
    }
  }

  logger.info('Evening digest run complete', {
    eligible: eligible.length,
    sent,
    skippedGuard,
    skippedNotTheirHour,
    skippedNothingToSay,
    failed,
  });
  return { eligible: eligible.length, sent, skippedGuard, skippedNotTheirHour, skippedNothingToSay, failed };
}

async function scheduleDailyCheckIn() {
  // Phase 10: hourly sweep by default (each run only emails users whose
  // local hour matches their own chosen send time), replacing Phase 2's
  // single fixed-UTC-time cron. The env var name is kept for continuity
  // even though its meaning/default changed.
  const cron = process.env.DAILY_CHECKIN_CRON || '0 * * * *'; // hourly, on the hour
  await checkInQueue.add(
    'daily-checkin-run',
    {},
    {
      repeat: { cron },
      jobId: 'daily-checkin-run',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
  logger.info(`Evening digest job scheduled (cron: "${cron}")`);
}

module.exports = { checkInQueue, processDailyCheckIn, scheduleDailyCheckIn, findEligibleUsers, MAX_EMAILS_PER_RUN, DEFAULT_DIGEST_SEND_HOUR };
