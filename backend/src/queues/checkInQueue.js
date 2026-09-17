/**
 * Daily "did you wear it?" check-in queue (Bull + Redis) — Phase 2.
 *
 * One repeatable nightly job that finds users worth asking and emails
 * them via notification.service.js. Deliberately conservative about who
 * gets an email, for the same reason the rest of Phase 2 avoids
 * unnecessary paid-API/DB traffic: every skip below is either a DB-cost
 * saving or (more importantly here) a real email-quota saving, since
 * Resend's free tier is capped at 100/day — sending to everyone
 * regardless of relevance would burn through that fast for no benefit.
 *
 *   - isActive = false -> skip (deactivated account)
 *   - no wardrobe items -> skip (nothing to have "worn" yet)
 *   - notification_preferences.dailyCheckIn === false -> skip (opted out)
 *   - already logged a 'wear' interaction today -> skip (they already
 *     told us, no need to ask)
 *   - already emailed today (Redis guard, survives a job retry) -> skip
 *   - hard cap per run (DAILY_CHECKIN_MAX_EMAILS) -> stop, so a bug that
 *     somehow widens the candidate set can't blow through the whole
 *     monthly email quota in one run
 */

const Queue = require('bull');
const redis = require('redis');
const { Op, fn, col } = require('sequelize');
const logger = require('../utils/logger');
const { User, Clothes, UserPreferences, UserInteraction } = require('../database/models');
const { sendNotification, dailyCheckInEmail } = require('../services/notification.service');

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

/** True if we haven't already sent this user a check-in today; also claims it. */
async function claimGuard(userId) {
  const cache = await getGuardClient();
  // NX + 25h TTL (a bit over a day, so a late-running job near midnight
  // still covers "today") -- SET ... NX is atomic, so two overlapping
  // job runs can't both send to the same user.
  const result = await cache.set(guardKey(userId), '1', { NX: true, EX: 25 * 60 * 60 });
  return result === 'OK';
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
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
    User.findAll({ where: { id: candidateIds, isActive: true }, attributes: ['id', 'email', 'fullName'] }),
    UserPreferences.findAll({ where: { userId: candidateIds }, attributes: ['userId', 'notificationPreferences'] }),
    UserInteraction.findAll({
      where: { userId: candidateIds, action: 'wear', createdAt: { [Op.gte]: startOfToday() } },
      attributes: ['userId'],
      raw: true,
    }),
  ]);

  const prefsByUser = new Map(preferences.map((p) => [p.userId, p.notificationPreferences || {}]));
  const alreadyWoreToday = new Set(todaysWears.map((w) => w.userId));

  return users.filter((user) => {
    if (alreadyWoreToday.has(user.id)) return false;
    const prefs = prefsByUser.get(user.id) || {};
    if (prefs.dailyCheckIn === false) return false; // explicit opt-out; missing key defaults to "on"
    return true;
  });
}

async function processDailyCheckIn() {
  const eligible = await findEligibleUsers();
  let sent = 0;
  let skippedGuard = 0;
  let failed = 0;

  for (const user of eligible) {
    if (sent >= MAX_EMAILS_PER_RUN) {
      logger.warn('Daily check-in run hit its per-run email cap, stopping early', {
        cap: MAX_EMAILS_PER_RUN,
        remainingEligible: eligible.length - sent - skippedGuard,
      });
      break;
    }

    const claimed = await claimGuard(user.id);
    if (!claimed) {
      skippedGuard += 1;
      continue;
    }

    const { subject, html } = dailyCheckInEmail(user);
    const result = await sendNotification(user, { subject, html });
    if (result.sent || result.reason === 'no_api_key') {
      // "no_api_key" still counts as handled -- dev environments without
      // a Resend account yet shouldn't loop-retry this every run.
      sent += 1;
    } else {
      failed += 1;
      logger.warn('Daily check-in email failed', { userId: user.id, reason: result.reason });
    }
  }

  logger.info('Daily check-in run complete', { eligible: eligible.length, sent, skippedGuard, failed });
  return { eligible: eligible.length, sent, skippedGuard, failed };
}

async function scheduleDailyCheckIn() {
  const cron = process.env.DAILY_CHECKIN_CRON || '0 19 * * *'; // 19:00 UTC by default
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
  logger.info(`Daily check-in job scheduled (cron: "${cron}")`);
}

module.exports = { checkInQueue, processDailyCheckIn, scheduleDailyCheckIn, findEligibleUsers, MAX_EMAILS_PER_RUN };
