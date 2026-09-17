/**
 * Budget reminder dispatch (Bull + Redis) -- Phase 7 (PRD §3.15). Same
 * idempotent-registration shape as every other scheduled job in this
 * app. Runs frequently (hourly, by default) since "the trip just
 * became active today" is a same-day event a once-daily job could
 * miss by many hours.
 */

const Queue = require('bull');
const logger = require('../utils/logger');
const { processDueReminders } = require('../services/budgetReminder.service');

const redisConnection = {
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
};

const budgetReminderQueue = new Queue('budget-reminder-dispatch', { redis: redisConnection });

budgetReminderQueue.on('error', (err) => {
  logger.error('Budget reminder queue error', { message: err.message });
});
budgetReminderQueue.on('failed', (job, err) => {
  logger.error('Budget reminder dispatch job failed', { jobId: job.id, message: err.message });
});

async function processBudgetReminderDispatch() {
  return processDueReminders();
}

async function scheduleBudgetReminderDispatch() {
  const cron = process.env.BUDGET_REMINDER_CRON || '0 * * * *'; // hourly
  await budgetReminderQueue.add(
    'budget-reminder-dispatch-run',
    {},
    {
      repeat: { cron },
      jobId: 'budget-reminder-dispatch-run',
      removeOnComplete: 30,
      removeOnFail: 30,
    }
  );
  logger.info(`Budget reminder dispatch job scheduled (cron: "${cron}")`);
}

module.exports = {
  budgetReminderQueue,
  processBudgetReminderDispatch,
  scheduleBudgetReminderDispatch,
};
