const express = require('express');
const router = express.Router();
const Joi = require('joi');
const DestinationController = require('../controllers/destination.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const countryParamSchema = Joi.object({
  country: Joi.string().max(100).required(),
}).unknown(true);

// @route GET /api/v1/destination/:country/culture
router.get('/:country/culture', authenticate, validate(countryParamSchema, 'params'), DestinationController.getCulture);

// @route GET /api/v1/destination/:country/advisory
router.get('/:country/advisory', authenticate, validate(countryParamSchema, 'params'), DestinationController.getAdvisory);

// @route POST /api/v1/destination/:country/advisory/refresh
router.post('/:country/advisory/refresh', authenticate, validate(countryParamSchema, 'params'), DestinationController.refreshAdvisory);

module.exports = router;
