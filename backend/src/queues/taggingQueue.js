/**
 * Clothing tagging queue (Bull + Redis)
 *
 * Phase 0 fix: garment upload used to `await` the vision-API tagging call
 * directly inside the HTTP request (clothes.controller.js ->
 * processSingleClothingItem -> tagger.tagClothing), blocking the response
 * for however long the vision API took. `bull` and `ioredis` were already
 * dependencies but nothing required them anywhere. This module is the
 * queue producer side; src/workers/taggingWorker.js is the consumer.
 *
 * Jobs carry only ids/URLs, never image bytes — the worker re-fetches the
 * image from Cloudinary's URL. That keeps job payloads small in Redis and
 * lets a job be retried without the caller keeping a buffer around.
 */

const Queue = require('bull');
const logger = require('../utils/logger');

const redisConnection = {
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
};

const taggingQueue = new Queue('clothing-tagging', { redis: redisConnection });

taggingQueue.on('error', (err) => {
  logger.error('Tagging queue error', { message: err.message });
});

taggingQueue.on('failed', (job, err) => {
  logger.error('Tagging job failed', { jobId: job.id, clothesId: job.data.clothesId, message: err.message });
});

/**
 * @param {Object} params
 * @param {string} params.clothesId - Clothes record to update once tagging completes
 * @param {string} params.userId
 * @param {string} params.imageUrl - Cloudinary secure_url the worker will download and tag
 * @param {'initial'|'retag'} [params.mode]
 */
async function enqueueTaggingJob({ clothesId, userId, imageUrl, mode = 'initial' }) {
  const job = await taggingQueue.add(
    { clothesId, userId, imageUrl, mode },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 500,
      removeOnFail: 500,
    }
  );
  logger.info('Tagging job enqueued', { jobId: job.id, clothesId, mode });
  return job;
}

module.exports = { taggingQueue, enqueueTaggingJob };
