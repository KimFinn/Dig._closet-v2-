const express = require('express');
const router = express.Router({ mergeParams: true });
const Joi = require('joi');
const TripActivityController = require('../controllers/tripActivity.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const tripIdParamSchema = Joi.object({
  tripId: Joi.string().uuid().required(),
}).unknown(true);

const activityIdParamSchema = Joi.object({
  activityId: Joi.string().uuid().required(),
}).unknown(true);

const createActivitySchema = Joi.object({
  date: Joi.date().required(),
  timeSlot: Joi.string().max(50).allow(null, ''),
  occasion: Joi.string().max(100).allow(null, ''),
  title: Joi.string().max(255).allow(null, ''),
  notes: Joi.string().allow(null, ''),
  category: Joi.string().max(50).allow(null, ''),
  locationText: Joi.string().max(255).allow(null, ''),
  estimatedCost: Joi.number().min(0).allow(null),
  categoryBudgetTag: Joi.string().valid('accommodation', 'food', 'activities', null),
});

const updateActivitySchema = Joi.object({
  date: Joi.date(),
  timeSlot: Joi.string().max(50).allow(null, ''),
  occasion: Joi.string().max(100).allow(null, ''),
  title: Joi.string().max(255).allow(null, ''),
  notes: Joi.string().allow(null, ''),
  category: Joi.string().max(50).allow(null, ''),
  locationText: Joi.string().max(255).allow(null, ''),
  placeId: Joi.string().max(255).allow(null, ''),
  estimatedCost: Joi.number().min(0).allow(null),
  categoryBudgetTag: Joi.string().valid('accommodation', 'food', 'activities', null),
  status: Joi.string().valid('planned', 'confirmed', 'skipped', 'replaced'),
}).min(1);

// @route POST /api/v1/trip/:tripId/activities
router.post('/', authenticate, validate(tripIdParamSchema, 'params'), validate(createActivitySchema), TripActivityController.create);

// @route GET /api/v1/trip/:tripId/activities
router.get('/', authenticate, validate(tripIdParamSchema, 'params'), TripActivityController.list);

// @route PATCH /api/v1/trip/:tripId/activities/:activityId
router.patch('/:activityId', authenticate, validate(activityIdParamSchema, 'params'), validate(updateActivitySchema), TripActivityController.update);

// @route DELETE /api/v1/trip/:tripId/activities/:activityId
router.delete('/:activityId', authenticate, validate(activityIdParamSchema, 'params'), TripActivityController.remove);

// @route POST /api/v1/trip/:tripId/activities/:activityId/outfit
router.post('/:activityId/outfit', authenticate, validate(activityIdParamSchema, 'params'), TripActivityController.generateOutfit);

module.exports = router;
