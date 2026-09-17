const express = require('express');
const router = express.Router();
const Joi = require('joi');
const GapPurchaseController = require('../controllers/gapPurchase.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const idParamSchema = Joi.object({
    id: Joi.string().uuid().required().label('Gap recommendation ID'),
});

/**
 * @route   POST /api/gap-recommendations/:id/click
 * @desc    Phase 5 -- record a click-through on a gap-purchase suggestion
 * @access  Private
 */
router.post(
    '/:id/click',
    authenticate,
    validate(idParamSchema, 'params'),
    GapPurchaseController.click
);

/**
 * @route   POST /api/gap-recommendations/:id/respond
 * @desc    Phase 5 -- "did you end up buying it?" self-report
 * @access  Private
 */
router.post(
    '/:id/respond',
    authenticate,
    validate(idParamSchema, 'params'),
    GapPurchaseController.respond
);

module.exports = router;
