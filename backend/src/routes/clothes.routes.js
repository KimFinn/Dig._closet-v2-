const express = require('express');
const router = express.Router();
const clothesController = require('../controllers/clothes.controller');
const { uploadSingle, uploadMultiple, handleMulterError } = require('../middleware/upload');
const { authenticate } = require('../middleware/auth');

/**
 * @route   POST /api/clothes/upload
 * @desc    Upload a single clothing item with AI tagging
 * @access  Private
 */
router.post(
    '/upload',
    authenticate,
    uploadSingle,
    handleMulterError,
    clothesController.uploadClothingItem
);

/**
 * @route   POST /api/clothes/upload/batch
 * @desc    Upload multiple clothing items at once (up to 20)
 * @access  Private
 * @new     Batch upload support
 */
router.post(
    '/upload/batch',
    authenticate,
    uploadMultiple, // Handles array of files with field name 'images'
    handleMulterError,
    clothesController.uploadBatchClothingItems
);

/**
 * @route   GET /api/clothes/user/:userId
 * @desc    Get all clothing items for a user with filtering
 * @access  Private
 * @query   type, color, season, occasion, isActive, page, limit, sortBy, sortOrder
 */
router.get(
    '/user/:userId',
    authenticate,
    clothesController.getClothingItems
);

// ----------------------------------------------------------------------------
// Every route below this point is a single dynamic segment away from
// colliding with a static one (GET /:itemId vs GET /search, GET /ai-stats):
// Express matches routes in registration order, so a `/:itemId` route
// registered first will swallow a request for literally
// `GET /api/clothes/search` (itemId="search") before it ever reaches the
// real /search handler below. `/search` and `/ai-stats` used to be
// registered AFTER `/:itemId` and were therefore completely unreachable —
// every request to them 500'd trying to look up a clothing item whose id
// was the literal string "search"/"ai-stats" ("invalid input syntax for
// type uuid"). All static-segment routes now come before any `/:itemId`
// route; the other dynamic routes here (`/user/:userId`,
// `/analytics/:userId`, `/review/needed/:userId`, `/:id/retag`) were never
// affected since they have a different number of path segments than
// `/:itemId` alone.
// ----------------------------------------------------------------------------

/**
 * @route   GET /api/clothes/search
 * @desc    Search clothing items with advanced filters
 * @access  Private
 * @query   query, tags, minWearCount, maxWearCount, page, limit
 */
router.get(
    '/search',
    authenticate,
    clothesController.searchClothingItems
);

/**
 * @route   GET /api/clothes/ai-stats
 * @desc    Get AI tagging statistics and cache performance
 * @access  Private
 * @new     AI statistics endpoint
 */
router.get(
    '/ai-stats',
    authenticate,
    clothesController.getAITaggingStats
);

/**
 * @route   GET /api/clothes/analytics/:userId
 * @desc    Get wardrobe analytics and statistics
 * @access  Private
 * @new     Analytics endpoint
 */
router.get(
    '/analytics/:userId',
    authenticate,
    clothesController.getWardrobeAnalytics
);

/**
 * @route   GET /api/clothes/review/needed/:userId
 * @desc    Get items that need manual review (failed AI or low confidence)
 * @access  Private
 * @new     Review queue endpoint
 */
router.get(
    '/review/needed/:userId',
    authenticate,
    clothesController.getItemsNeedingReview
);

/**
 * @route   POST /api/clothes/:id/retag
 * @desc    Re-run AI tagging on an existing item
 * @access  Private
 * @new     Retag endpoint for improving tags
 */
router.post(
    '/:id/retag',
    authenticate,
    clothesController.retagClothingItem
);

/**
 * @route   GET /api/clothes/:itemId
 * @desc    Get a single clothing item by ID
 * @access  Private
 */
router.get(
    '/:itemId',
    authenticate,
    clothesController.getClothingItemById
);

/**
 * @route   PUT /api/clothes/:itemId
 * @desc    Update a clothing item
 * @access  Private
 */
router.put(
    '/:itemId',
    authenticate,
    clothesController.updateClothingItem
);

/**
 * @route   POST /api/clothes/:itemId/wear
 * @desc    Record a wear event for a clothing item
 * @access  Private
 */
router.post(
    '/:itemId/wear',
    authenticate,
    clothesController.recordWear
);

/**
 * @route   DELETE /api/clothes/:itemId
 * @desc    Delete (soft or permanent) a clothing item
 * @access  Private
 * @query   permanent=true for permanent deletion
 */
router.delete(
    '/:itemId',
    authenticate,
    clothesController.deleteClothingItem
);

module.exports = router;