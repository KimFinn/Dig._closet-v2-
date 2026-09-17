/**
 * Product feed ingestion (Bull + Redis) -- Phase 5 (Gap-to-Purchase
 * Funnel, PRD §3.14), Task #38.
 *
 * Real affiliate network product feeds are bulk downloads refreshed on
 * the network's own schedule (typically daily), not something to fetch
 * per-request -- so this is a nightly repeatable job, same shape as
 * gapPurchaseFollowupQueue.js, just running productFeed.service.js's
 * ingestion instead. Idempotent registration (Bull dedups repeatable
 * jobs by cron pattern + jobId), same as every other Phase 2-5 job.
 */

const Queue = require('bull');
const logger = require('../utils/logger');
const { runProductFeedIngestion } = require('../services/productFeed.service');

const redisConnection = {
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
};

const productFeedIngestionQueue = new Queue('product-feed-ingestion', { redis: redisConnection });

productFeedIngestionQueue.on('error', (err) => {
  logger.error('Product feed ingestion queue error', { message: err.message });
});
productFeedIngestionQueue.on('failed', (job, err) => {
  logger.error('Product feed ingestion job failed', { jobId: job.id, message: err.message });
});

async function processProductFeedIngestion() {
  return runProductFeedIngestion();
}

async function scheduleProductFeedIngestion() {
  const cron = process.env.PRODUCT_FEED_INGESTION_CRON || '0 4 * * *'; // 04:00 UTC by default, ahead of the 06:00 gap-purchase followup run
  await productFeedIngestionQueue.add(
    'product-feed-ingestion-run',
    {},
    {
      repeat: { cron },
      jobId: 'product-feed-ingestion-run',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
  logger.info(`Product feed ingestion job scheduled (cron: "${cron}")`);
}

module.exports = {
  productFeedIngestionQueue,
  processProductFeedIngestion,
  scheduleProductFeedIngestion,
};
