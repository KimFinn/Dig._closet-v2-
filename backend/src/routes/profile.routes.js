const express = require('express');
const router = express.Router();
const Joi = require('joi');
const ProfileController = require('../controllers/profile.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validators');

const correctionSchema = Joi.object({
  correctionType: Joi.string().valid('suppress', 'override', 'delete', 'scope_only', 'restore').required(),
  overrideValue: Joi.alternatives().try(Joi.object(), Joi.string(), Joi.number(), Joi.array(), Joi.boolean()).optional(),
});

const traitKeyParamSchema = Joi.object({ traitKey: Joi.string().required() }).unknown(true);

// @route GET /api/v1/profile/summary
// The "what I know about you" dashboard: visible traits (correction
// overlay already applied), hidden-traits list (for the restore UI), and
// the lazily-generated/cached narrative.
router.get('/summary', authenticate, ProfileController.getSummary);

// @route PATCH /api/v1/profile/traits/:traitKey
// correctionType: suppress | override | delete | scope_only | restore.
// See profileDashboard.service.js for the fact-vs-preference validation
// (an observed_fact trait can only be suppressed/scope_only/restored,
// never overridden/deleted).
router.patch(
  '/traits/:traitKey',
  authenticate,
  validate(traitKeyParamSchema, 'params'),
  validate(correctionSchema),
  ProfileController.correctTrait
);

// @route POST /api/v1/profile/resynthesize
// Manual on-demand trigger, mainly for testing/demoing without waiting
// for the nightly job.
router.post('/resynthesize', authenticate, ProfileController.resynthesize);

module.exports = router;
