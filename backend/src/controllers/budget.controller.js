/**
 * Budgeting HTTP layer -- Phase 7 (PRD §3.15). Feasibility check +
 * reminders. The live per-trip tracker is exposed from trip.controller
 * instead (GET /api/v1/trip/:tripId/budget), since it's inherently
 * trip-scoped.
 */

const { getFeasibilityVerdict } = require('../services/budgetFeasibility.service');
const { createReminder, listReminders, dismissReminder } = require('../services/budgetReminder.service');
const logger = require('../utils/logger');

function handleKnownError(error, res, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  next(error);
}

class BudgetController {
  static async checkFeasibility(req, res, next) {
    try {
      const { countryOrRegion, days, statedBudget, currency } = req.body;
      const result = await getFeasibilityVerdict({ countryOrRegion, days, statedBudget, currency });
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Budget feasibility check error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async createReminder(req, res, next) {
    try {
      const reminder = await createReminder(req.user.userId, req.body);
      res.status(201).json({ success: true, data: { reminder } });
    } catch (error) {
      logger.error('Create budget reminder error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async listReminders(req, res, next) {
    try {
      const reminders = await listReminders(req.user.userId);
      res.status(200).json({ success: true, data: { reminders } });
    } catch (error) {
      logger.error('List budget reminders error', { error: error.message, userId: req.user?.userId });
      next(error);
    }
  }

  static async dismissReminder(req, res, next) {
    try {
      const reminder = await dismissReminder(req.user.userId, req.params.reminderId);
      res.status(200).json({ success: true, data: { reminder } });
    } catch (error) {
      logger.error('Dismiss budget reminder error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }
}

module.exports = BudgetController;
