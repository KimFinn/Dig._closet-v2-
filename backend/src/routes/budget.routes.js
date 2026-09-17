const express = require('express');
const router = express.Router();
const Joi = require('joi');
const BudgetController = require('../controllers/budget.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const feasibilitySchema = Joi.object({
  countryOrRegion: Joi.string().max(100).required(),
  days: Joi.number().integer().min(1).required(),
  statedBudget: Joi.number().min(0).required(),
  currency: Joi.string().length(3).default('USD'),
});

const createReminderSchema = Joi.object({
  tripId: Joi.string().uuid(),
  outingId: Joi.string().uuid(),
  itemDescription: Joi.string().max(255).required(),
  triggerType: Joi.string().valid('trip_active', 'specific_date').default('trip_active'),
  triggerDate: Joi.date().allow(null),
}).xor('tripId', 'outingId');

const reminderIdParamSchema = Joi.object({
  reminderId: Joi.string().uuid().required(),
}).unknown(true);

// @route POST /api/v1/budget/feasibility
router.post('/feasibility', authenticate, validate(feasibilitySchema), BudgetController.checkFeasibility);

// @route POST /api/v1/budget/reminders
router.post('/reminders', authenticate, validate(createReminderSchema), BudgetController.createReminder);

// @route GET /api/v1/budget/reminders
router.get('/reminders', authenticate, BudgetController.listReminders);

// @route PATCH /api/v1/budget/reminders/:reminderId/dismiss
router.patch('/reminders/:reminderId/dismiss', authenticate, validate(reminderIdParamSchema, 'params'), BudgetController.dismissReminder);

module.exports = router;
