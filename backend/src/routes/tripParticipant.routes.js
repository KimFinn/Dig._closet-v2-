/**
 * Phase 8 (PRD §3.9/§7). The Pro-tier gate here is a resource-owner
 * entitlement enforced inside tripParticipant.service.js (only the
 * trip owner's own tier is checked, only on invite -- see
 * middleware/subscription.js#assertUserIsPro), not a blanket route
 * middleware -- an invited participant with a free account can still
 * view the itinerary, list participants, and respond to their own
 * invite without needing their own Pro plan.
 */
const express = require('express');
const router = express.Router({ mergeParams: true });
const Joi = require('joi');
const TripParticipantController = require('../controllers/tripParticipant.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const tripIdParamSchema = Joi.object({ tripId: Joi.string().uuid().required() }).unknown(true);

const inviteSchema = Joi.object({
  email: Joi.string().email().required(),
  role: Joi.string().max(50),
});

// @route POST /api/v1/trip/:tripId/participants
router.post('/', authenticate, validate(tripIdParamSchema, 'params'), validate(inviteSchema), TripParticipantController.invite);

// @route GET /api/v1/trip/:tripId/participants
router.get('/', authenticate, validate(tripIdParamSchema, 'params'), TripParticipantController.list);

// @route GET /api/v1/trip/:tripId/participants/itinerary
router.get('/itinerary', authenticate, validate(tripIdParamSchema, 'params'), TripParticipantController.itinerary);

module.exports = router;
