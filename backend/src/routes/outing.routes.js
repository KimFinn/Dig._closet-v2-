const express = require('express');
const router = express.Router();
const Joi = require('joi');
const OutingController = require('../controllers/outing.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const outingIdParamSchema = Joi.object({
  outingId: Joi.string().uuid().required(),
}).unknown(true);

const createOutingSchema = Joi.object({
  title: Joi.string().max(255).required(),
  date: Joi.date().required(),
  timeSlot: Joi.string().max(50).allow(null, ''),
  occasion: Joi.string().max(100).allow(null, ''),
  category: Joi.string().max(50).allow(null, ''),
  locationText: Joi.string().max(255).allow(null, ''),
  budgetAmount: Joi.number().min(0).allow(null),
  budgetCurrency: Joi.string().length(3).allow(null, ''),
});

const updateOutingSchema = Joi.object({
  title: Joi.string().max(255),
  date: Joi.date(),
  timeSlot: Joi.string().max(50).allow(null, ''),
  occasion: Joi.string().max(100).allow(null, ''),
  category: Joi.string().max(50).allow(null, ''),
  locationText: Joi.string().max(255).allow(null, ''),
  placeId: Joi.string().max(255).allow(null, ''),
  budgetAmount: Joi.number().min(0).allow(null),
  budgetCurrency: Joi.string().length(3).allow(null, ''),
  status: Joi.string().valid('planned', 'completed', 'skipped'),
}).min(1);

// @route POST /api/v1/outing
router.post('/', authenticate, validate(createOutingSchema), OutingController.create);

// @route GET /api/v1/outing
router.get('/', authenticate, OutingController.list);

// @route GET /api/v1/outing/:outingId
router.get('/:outingId', authenticate, validate(outingIdParamSchema, 'params'), OutingController.getById);

// @route PATCH /api/v1/outing/:outingId
router.patch('/:outingId', authenticate, validate(outingIdParamSchema, 'params'), validate(updateOutingSchema), OutingController.update);

// @route DELETE /api/v1/outing/:outingId
router.delete('/:outingId', authenticate, validate(outingIdParamSchema, 'params'), OutingController.remove);

// @route POST /api/v1/outing/:outingId/outfit
router.post('/:outingId/outfit', authenticate, validate(outingIdParamSchema, 'params'), OutingController.generateOutfit);

module.exports = router;
