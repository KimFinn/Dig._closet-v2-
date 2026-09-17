const express = require('express');
const router = express.Router();
const Joi = require('joi');
const ClosetShareController = require('../controllers/closetShare.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validators');
const { VALID_SCOPES } = require('../services/closetShare.service');

const inviteSchema = Joi.object({
  recipientEmail: Joi.string().email().required(),
  scope: Joi.string().valid(...VALID_SCOPES).required(),
  tripId: Joi.string().uuid(),
  activityId: Joi.string().uuid(),
});

const shareIdParamSchema = Joi.object({ shareId: Joi.string().uuid().required() }).unknown(true);

// @route POST /api/v1/closet-shares
// No Pro gate at the route -- enforced inside closetShare.service.js
// against the owner (see tripParticipant.routes.js's header comment
// for why this is a resource-owner entitlement, not a blanket one).
router.post('/', authenticate, validate(inviteSchema), ClosetShareController.invite);

// @route GET /api/v1/closet-shares
router.get('/', authenticate, ClosetShareController.list);

// @route PATCH /api/v1/closet-shares/:shareId/accept
router.patch('/:shareId/accept', authenticate, validate(shareIdParamSchema, 'params'), ClosetShareController.accept);

// @route PATCH /api/v1/closet-shares/:shareId/decline
router.patch('/:shareId/decline', authenticate, validate(shareIdParamSchema, 'params'), ClosetShareController.decline);

// @route PATCH /api/v1/closet-shares/:shareId/revoke
router.patch('/:shareId/revoke', authenticate, validate(shareIdParamSchema, 'params'), ClosetShareController.revoke);

module.exports = router;
