/**
 * Destination advisory ingestion (Bull + Redis) -- Phase 7 (PRD §3.15).
 * Daily job, same idempotent-registration shape as every other
 * Phase 2-7 scheduled job. Runs destinationAdvisory.service.js's
 * FCDO -> Canada -> Smartraveller fallback chain for every country
 * currently referenced by an active/upcoming trip.
 */

const Queue = require('bull');
const logger = require('../utils/logger');
const { runDestinationAdvisoryIngestion } = require('../services/destinationAdvisory.service');

const redisConnection = {
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
};

const destinationAdvisoryQueue = new Queue('destination-advisory-ingestion', { redis: redisConnection });

destinationAdvisoryQueue.on('error', (err) => {
  logger.error('Destination advisory queue error', { message: err.message });
});
destinationAdvisoryQueue.on('failed', (job, err) => {
  logger.error('Destination advisory ingestion job failed', { jobId: job.id, message: err.message });
});

async function processDestinationAdvisoryIngestion() {
  return runDestinationAdvisoryIngestion();
}

async function scheduleDestinationAdvisoryIngestion() {
  const cron = process.env.DESTINATION_ADVISORY_CRON || '0 5 * * *'; // 05:00 UTC, ahead of the 06:00 gap-purchase followup run
  await destinationAdvisoryQueue.add(
    'destination-advisory-ingestion-run',
    {},
    {
      repeat: { cron },
      jobId: 'destination-advisory-ingestion-run',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
  logger.info(`Destination advisory ingestion job scheduled (cron: "${cron}")`);
}

module.exports = {
  destinationAdvisoryQueue,
  processDestinationAdvisoryIngestion,
  scheduleDestinationAdvisoryIngestion,
};
