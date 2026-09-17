const express = require('express');
const router = express.Router({ mergeParams: true });
const Joi = require('joi');
const TripActivityController = require('../controllers/tripActivity.controller');
// Phase 8 (PRD §3.9)
const GroupOutfitController = require('../controllers/groupOutfit.controller');
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

// ============================================================
// Phase 8 (PRD §3.9) -- hybrid group outfits for this activity.
// No Pro gate at the route -- enforced inside groupOutfit.service.js
// against the trip owner, not necessarily the caller (see
// tripParticipant.routes.js's header comment for the reasoning).
// ============================================================

const groupOutfitIdParamSchema = Joi.object({ groupOutfitId: Joi.string().uuid().required() }).unknown(true);
const ownerUserIdParamSchema = Joi.object({ ownerUserId: Joi.string().uuid().required() }).unknown(true);

const createGroupOutfitSchema = Joi.object({
  mode: Joi.string().valid('coordinated', 'cross_closet').required(),
});

const themeSchema = Joi.object({
  palette: Joi.string().max(255),
  formality: Joi.string().max(50),
  notes: Joi.string().max(500).allow(null, ''),
}).min(1);

const crossClosetSchema = Joi.object({
  itemSelections: Joi.array()
    .items(
      Joi.object({
        itemId: Joi.string().uuid().required(),
        ownerUserId: Joi.string().uuid().required(),
      })
    )
    .min(1)
    .required(),
});

// @route POST /api/v1/trip/:tripId/activities/:activityId/group-outfit
// @desc  Get-or-create the coordinated/cross_closet GroupOutfit for
//        this activity. Idempotent -- returns the existing one if
//        already created (by any participant) for this mode.
router.post(
  '/:activityId/group-outfit',
  authenticate,
  validate(activityIdParamSchema, 'params'),
  validate(createGroupOutfitSchema),
  GroupOutfitController.getOrCreate
);

// @route GET /api/v1/trip/:tripId/activities/:activityId/group-outfit/borrowable/:ownerUserId
// @desc  Cross-closet mode: what can the caller currently borrow from
//        ownerUserId for this activity (requires an active ClosetShare).
router.get(
  '/:activityId/group-outfit/borrowable/:ownerUserId',
  authenticate,
  validate(activityIdParamSchema, 'params'),
  validate(ownerUserIdParamSchema, 'params'),
  GroupOutfitController.listBorrowable
);

// @route PATCH /api/v1/trip/:tripId/activities/:activityId/group-outfit/:groupOutfitId/theme
// @desc  Coordinated mode: propose/edit the shared theme. Either
//        participant may call this, no accept step (2026-09-17 decision).
router.patch(
  '/:activityId/group-outfit/:groupOutfitId/theme',
  authenticate,
  validate(activityIdParamSchema, 'params'),
  validate(groupOutfitIdParamSchema, 'params'),
  validate(themeSchema),
  GroupOutfitController.updateTheme
);

// @route POST /api/v1/trip/:tripId/activities/:activityId/group-outfit/:groupOutfitId/generate-mine
// @desc  Coordinated mode: generate+persist the caller's own outfit,
//        biased toward the shared theme. Never touches anyone else's wardrobe.
router.post(
  '/:activityId/group-outfit/:groupOutfitId/generate-mine',
  authenticate,
  validate(activityIdParamSchema, 'params'),
  validate(groupOutfitIdParamSchema, 'params'),
  GroupOutfitController.generateMyOutfit
);

// @route POST /api/v1/trip/:tripId/activities/:activityId/group-outfit/:groupOutfitId/cross-closet
// @desc  Cross-closet mode: assemble the final outfit from explicitly
//        picked, ownership-tagged items.
router.post(
  '/:activityId/group-outfit/:groupOutfitId/cross-closet',
  authenticate,
  validate(activityIdParamSchema, 'params'),
  validate(groupOutfitIdParamSchema, 'params'),
  validate(crossClosetSchema),
  GroupOutfitController.buildCrossClosetOutfit
);

module.exports = router;
