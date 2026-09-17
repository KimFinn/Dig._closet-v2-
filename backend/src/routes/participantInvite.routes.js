/**
 * Phase 8 (PRD §3.9) -- responding to a trip invite, from the
 * invitee's side. Deliberately not trip-nested (unlike
 * tripParticipant.routes.js): the invitee is acting on their own
 * invite by its id, not browsing a trip they may not have accepted
 * into yet.
 */
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const TripParticipantController = require('../controllers/tripParticipant.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const participantIdParamSchema = Joi.object({ participantId: Joi.string().uuid().required() }).unknown(true);
const respondSchema = Joi.object({ decision: Joi.string().valid('accepted', 'declined').required() });

// @route PATCH /api/v1/invites/:participantId/respond
// No Pro gate: responding to your own invite never requires your own
// subscription tier, see tripParticipant.routes.js's header comment.
router.patch(
  '/:participantId/respond',
  authenticate,
  validate(participantIdParamSchema, 'params'),
  validate(respondSchema),
  TripParticipantController.respond
);

module.exports = router;
