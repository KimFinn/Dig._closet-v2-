/**
 * Preference-learning queue (Bull + Redis) — Phase 2.
 *
 * Two job types on one queue, mirroring src/queues/taggingQueue.js's
 * producer/consumer split (producer here, consumer in
 * src/workers/taggingWorker.js, which already processes the tagging
 * queue and now also processes this one — see the comment there for
 * why they share a process for now):
 *
 *  - 'nightly-learn-all': a single repeatable job (registered once, at
 *    server boot, via scheduleNightlyLearning()) that queries which
 *    users have actually been active recently and runs
 *    NeuralPreferenceLearner.learnUserPreferences() for each of them,
 *    writing the learned_preferences snapshot table. This is a DB-only
 *    job — it never calls the weather API or any vision/LLM API — so
 *    running it nightly has no paid-API cost, only DB load, which is
 *    itself bounded by only touching users who were actually active
 *    (see ACTIVE_WINDOW_DAYS below) rather than the whole user table.
 *  - 'learn-one': an on-demand backfill for a single user, enqueued by
 *    AIOutfitRecommendationService.getRecommendationPreferences() the
 *    first time a user is asked for a recommendation before they have
 *    any snapshot yet (a brand-new account). Deduped by jobId so a
 *    burst of requests from the same new user before the job finishes
 *    doesn't queue it more than once.
 */

const Queue = require('bull');
const logger = require('../utils/logger');

const redisConnection = {
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
};

const preferenceLearningQueue = new Queue('preference-learning', { redis: redisConnection });

preferenceLearningQueue.on('error', (err) => {
  logger.error('Preference learning queue error', { message: err.message });
});

preferenceLearningQueue.on('failed', (job, err) => {
  logger.error('Preference learning job failed', { jobId: job.id, jobName: job.name, message: err.message });
});

// How far back a user has to have interacted to count as "active" for
// the nightly job. Keeps the nightly run's DB cost proportional to real
// usage instead of scanning every account that ever signed up.
const ACTIVE_WINDOW_DAYS = parseInt(process.env.PREFERENCE_LEARNING_ACTIVE_WINDOW_DAYS || '30', 10);
// How many users' learnUserPreferences() calls run concurrently during
// the nightly pass. Each one issues several sequential queries of its
// own, so this bounds total DB connection pressure rather than firing
// all active users at once.
const NIGHTLY_CONCURRENCY = parseInt(process.env.PREFERENCE_LEARNING_CONCURRENCY || '5', 10);

/**
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} [params.reason]
 */
async function enqueueLearnPreferencesJob({ userId, reason = 'manual' }) {
  const job = await preferenceLearningQueue.add(
    'learn-one',
    { userId, reason },
    {
      jobId: `learn-one-${userId}`, // dedup: a second request from the same not-yet-learned user before this completes just no-ops
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 200,
    }
  );
  logger.info('Preference learning job enqueued', { jobId: job.id, userId, reason });
  return job;
}

/**
 * Registers the nightly repeatable job. Bull dedups repeatable jobs by
 * their cron pattern + jobId, so calling this on every server boot is
 * safe/idempotent — it does not create a second nightly run.
 */
async function scheduleNightlyLearning() {
  const cron = process.env.PREFERENCE_LEARNING_CRON || '0 2 * * *'; // 02:00 UTC by default
  await preferenceLearningQueue.add(
    'nightly-learn-all',
    {},
    {
      repeat: { cron },
      jobId: 'nightly-learn-all',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
  logger.info(`Nightly preference-learning job scheduled (cron: "${cron}")`);
}

module.exports = {
  preferenceLearningQueue,
  enqueueLearnPreferencesJob,
  scheduleNightlyLearning,
  ACTIVE_WINDOW_DAYS,
  NIGHTLY_CONCURRENCY,
};
