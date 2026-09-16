const express = require('express');
const router = express.Router();
const OutfitController = require('../controllers/outfit.controller');
const { authenticate } = require('../middleware/auth');

// Phase 0 fix: this file used to also import `body` from express-validator
// and attach validation chains (createOutfitValidation, suggestOutfitValidation,
// and inline arrays on a few routes below) to several routes. None of them
// ever did anything: outfit.controller.js never calls express-validator's
// validationResult() anywhere, so those chains just silently attached
// unread error state to `req` and every request passed through regardless
// of whether it matched the rules. Real validation for every one of these
// routes already happens via Joi directly inside the controller
// (validationSchemas.* — see outfit.controller.js), matching the pattern
// clothes.controller.js already used. Removed the dead express-validator
// chains rather than porting them, since porting inert code would just be
// adding a second, redundant validation pass.

/**
 * @route   POST /api/outfits
 * @desc    Create a manual outfit
 * @access  Private
 */
router.post(
    '/',
    authenticate,
    OutfitController.createOutfit
);

/**
 * @route   POST /api/outfits/suggest
 * @desc    Get AI-based outfit suggestion
 * @access  Private
 */
router.post(
    '/suggest',
    authenticate,
    OutfitController.suggestOutfit
);

/**
 * @route   GET /api/outfits
 * @desc    Get all outfits for authenticated user
 * @access  Private
 * @query   occasion, isFavorite, isSuggested, isActive, page, limit, sortBy, sortOrder
 */
router.get(
    '/',
    authenticate,
    OutfitController.getUserOutfits
);

/**
 * @route   GET /api/outfits/stats
 * @desc    Get outfit statistics
 * @access  Private
 */
router.get(
    '/stats',
    authenticate,
    OutfitController.getOutfitStats
);

/**
 * @route   GET /api/outfits/recommendations/today
 * @desc    Get outfit recommendation for today
 * @access  Private
 * @query   activity, location
 */
router.get(
    '/recommendations/today',
    authenticate,
    OutfitController.getTodayOutfit
);

/**
 * @route   GET /api/outfits/recommendations/tomorrow
 * @desc    Get outfit recommendation for tomorrow
 * @access  Private
 * @query   activity, tripId, location
 */
router.get(
    '/recommendations/tomorrow',
    authenticate,
    OutfitController.getTomorrowOutfit
);

/**
 * @route   POST /api/outfits/recommendations/custom
 * @desc    Get custom outfit recommendation for a specific date
 * @access  Private
 */
router.post(
    '/recommendations/custom',
    authenticate,
    OutfitController.getCustomOutfit
);

/**
 * @route   GET /api/outfits/:id
 * @desc    Get a single outfit by ID
 * @access  Private
 */
router.get(
    '/:id',
    authenticate,
    OutfitController.getOutfitById
);

/**
 * @route   PUT /api/outfits/:id
 * @desc    Update an outfit
 * @access  Private
 */
router.put(
    '/:id',
    authenticate,
    OutfitController.updateOutfit
);

/**
 * @route   DELETE /api/outfits/:id
 * @desc    Delete (soft/permanent) an outfit
 * @access  Private
 * @query   permanent=true for permanent deletion
 */
router.delete(
    '/:id',
    authenticate,
    OutfitController.deleteOutfit
);

/**
 * @route   PATCH /api/outfits/:id/favorite
 * @desc    Toggle outfit favorite status
 * @access  Private
 */
router.patch(
    '/:id/favorite',
    authenticate,
    OutfitController.toggleFavorite
);

/**
 * @route   POST /api/outfits/:id/interaction
 * @desc    Track a user interaction with an outfit (save/like/dislike/skip/share/...)
 * @access  Private
 *
 * Phase 0 fix: this was registered as `POST /interactions` — no `:id`
 * segment at all — while trackInteraction always reads the outfit id from
 * `req.params.id`. Every call therefore had `outfitId = undefined` and
 * 404'd. Renamed to match what the controller (and its own JSDoc, which
 * already documented this route correctly) actually expects.
 */
router.post('/:id/interaction', authenticate, OutfitController.trackInteraction);

/**
 * @route   POST /api/outfits/:id/rate
 * @desc    Rate an outfit
 * @access  Private
 *
 * Phase 0 fix: was registered as `/:outfitId/rate`, but rateOutfit reads
 * `req.params.id` — so `outfitId` was always undefined and every rating
 * request failed. Renamed the param to `:id` to match the controller and
 * every sibling outfit sub-resource route above, rather than the other
 * way around.
 */
router.post('/:id/rate', authenticate, OutfitController.rateOutfit);

/**
 * @route   POST /api/outfits/:id/wear
 * @desc    Record when an outfit was worn (increments wearCount, logs a
 *          UserInteraction 'wear' event)
 * @access  Private
 *
 * Phase 0 fix: this path used to be claimed by TWO handlers registered
 * back to back — `recordWear` here first, then `wearOutfit` at
 * `/:outfitId/wear` (same URL shape, different param name — Express
 * matches whichever is registered first, so wearOutfit was permanently
 * unreachable dead code, the same route-shadowing bug class already found
 * and fixed once in clothes.routes.js). Worse, `recordWear` itself called
 * `OutfitService.recordWear(...)`, a method that doesn't exist anywhere in
 * outfitEngine.js — every call threw and 500'd. `wearOutfit` is the real,
 * working implementation (marks the outfit worn AND logs the
 * UserInteraction event Phase 1's learning loop depends on) and already
 * correctly reads `req.params.id`, so it's now the sole handler for this
 * route. The broken `recordWear` method has been removed from the
 * controller entirely rather than left as unreachable dead code.
 */
router.post('/:id/wear', authenticate, OutfitController.wearOutfit);

module.exports = router;
