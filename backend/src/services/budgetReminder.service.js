/**
 * "Remind me to buy X while there" -- Phase 7 (PRD §3.15). Reuses the
 * existing Bull/Redis notification pipeline (same infra as
 * weather-triggered push notifications) -- this file only decides WHAT
 * to remind about and WHEN a reminder's trigger condition is met; the
 * actual delivery is notification.service.js's sendNotification(),
 * unchanged.
 */

const { Op } = require('sequelize');
const { BudgetReminder, Trip, Outing, User } = require('../database/models');
const { sendNotification, budgetReminderEmail } = require('./notification.service');
const logger = require('../utils/logger');

async function createReminder(userId, data) {
  if (!data.itemDescription) {
    const err = new Error('A reminder needs an item description');
    err.statusCode = 400;
    throw err;
  }
  if (!data.tripId && !data.outingId) {
    const err = new Error('A reminder needs either a tripId or an outingId');
    err.statusCode = 400;
    throw err;
  }

  // Ownership check on whichever parent was given.
  if (data.tripId) {
    const trip = await Trip.findOne({ where: { id: data.tripId, userId } });
    if (!trip) { const err = new Error('Trip not found'); err.statusCode = 404; throw err; }
  }
  if (data.outingId) {
    const outing = await Outing.findOne({ where: { id: data.outingId, userId } });
    if (!outing) { const err = new Error('Outing not found'); err.statusCode = 404; throw err; }
  }

  return BudgetReminder.create({
    userId,
    tripId: data.tripId || null,
    outingId: data.outingId || null,
    itemDescription: data.itemDescription,
    triggerType: data.triggerType || 'trip_active',
    triggerDate: data.triggerDate || null,
  });
}

async function listReminders(userId) {
  return BudgetReminder.findAll({ where: { userId }, order: [['created_at', 'DESC']] });
}

async function dismissReminder(userId, reminderId) {
  const reminder = await BudgetReminder.findOne({ where: { id: reminderId, userId } });
  if (!reminder) { const err = new Error('Reminder not found'); err.statusCode = 404; throw err; }
  await reminder.update({ status: 'dismissed' });
  return reminder;
}

/**
 * Scheduled-job entry point. Two trigger shapes:
 *   - trip_active: fires once the linked trip/outing is actually
 *     underway (status === 'active', or an outing whose date is today).
 *   - specific_date: fires once trigger_date has arrived.
 * Every fired reminder gets exactly one notification, then flips to
 * 'sent' so it never re-fires.
 */
async function processDueReminders() {
  const pending = await BudgetReminder.findAll({
    where: { status: 'pending' },
    include: [{ model: Trip, required: false }, { model: Outing, required: false }],
  });

  const today = new Date().toISOString().split('T')[0];
  let sent = 0;
  let skipped = 0;

  for (const reminder of pending) {
    let due = false;

    if (reminder.triggerType === 'specific_date') {
      due = !!reminder.triggerDate && reminder.triggerDate <= today;
    } else {
      // trip_active
      if (reminder.Trip) due = reminder.Trip.status === 'active';
      else if (reminder.Outing) due = reminder.Outing.date <= today;
    }

    if (!due) { skipped++; continue; }

    try {
      const user = await User.findByPk(reminder.userId);
      if (user) {
        await sendNotification(user, budgetReminderEmail(user, reminder));
      }
      await reminder.update({ status: 'sent', sentAt: new Date() });
      sent++;
    } catch (error) {
      // Never let one bad reminder block the rest of the batch -- same
      // per-row try/catch pattern as productFeed.service.js's ingestion.
      logger.warn('Failed to send budget reminder, leaving it pending for the next run', { reminderId: reminder.id, error: error.message });
    }
  }

  return { sent, skipped, total: pending.length };
}

module.exports = { createReminder, listReminders, dismissReminder, processDueReminders };
