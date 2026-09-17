/**
 * Profile-synthesis + retention-purge queue (Bull + Redis) -- Phase 9
 * (PRD §3.10). Two repeatable jobs on one queue, mirroring
 * preferenceLearningQueue.js's producer/consumer split (producer here,
 * consumer in src/workers/taggingWorker.js):
 *
 *  - 'nightly-synthesize-all': runs profileSynthesis.service.js's
 *    synthesizeProfileForUser() for every user with at least one active
 *    wardrobe item. DB-only cost (no external API calls at this step --
 *    the narrative LLM call is lazy, see profileNarrative.service.js),
 *    bounded by only touching users who have real data to synthesize
 *    from, same reasoning as the Phase 2 nightly learning job.
 *  - 'nightly-interaction-purge': runs interactionRetention.service.js's
 *    purgeOldInteractions() -- the real scheduled job behind the
 *    90-day raw UserInteraction retention window (2026-09-18 scoping
 *    decision, resolves PRD §8 item 4). Deliberately does NOT touch
 *    UserProfileSummary -- see that service's header comment.
 */

const Queue = require('bull');
const logger = require('../utils/logger');

const redisConnection = {
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
};

const profileSynthesisQueue = new Queue('profile-synthesis', { redis: redisConnection });

profileSynthesisQueue.on('error', (err) => {
  logger.error('Profile synthesis queue error', { message: err.message });
});

profileSynthesisQueue.on('failed', (job, err) => {
  logger.error('Profile synthesis job failed', { jobId: job.id, jobName: job.name, message: err.message });
});

// How many users' synthesizeProfileForUser() calls run concurrently
// during the nightly pass -- same DB-connection-pressure reasoning as
// preferenceLearningQueue's NIGHTLY_CONCURRENCY.
const SYNTHESIS_CONCURRENCY = parseInt(process.env.PROFILE_SYNTHESIS_CONCURRENCY || '5', 10);

async function scheduleNightlyProfileSynthesis() {
  const cron = process.env.PROFILE_SYNTHESIS_CRON || '30 2 * * *'; // just after the 02:00 preference-learning run
  await profileSynthesisQueue.add(
    'nightly-synthesize-all',
    {},
    {
      repeat: { cron },
      jobId: 'nightly-synthesize-all',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
  logger.info(`Nightly profile-synthesis job scheduled (cron: "${cron}")`);
}

async function scheduleInteractionPurge() {
  const cron = process.env.INTERACTION_PURGE_CRON || '0 3 * * *';
  await profileSynthesisQueue.add(
    'nightly-interaction-purge',
    {},
    {
      repeat: { cron },
      jobId: 'nightly-interaction-purge',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
  logger.info(`Nightly UserInteraction retention purge job scheduled (cron: "${cron}")`);
}

module.exports = {
  profileSynthesisQueue,
  scheduleNightlyProfileSynthesis,
  scheduleInteractionPurge,
  SYNTHESIS_CONCURRENCY,
};
