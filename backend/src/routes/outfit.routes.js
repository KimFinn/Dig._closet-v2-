const express = require('express');
const router = express.Router();
const OutfitController = require('../controllers/outfit.controller');
const { authenticateUser } = require('../middleware/auth');
const { body } = require('express-validator');

// Validation middleware
const createOutfitValidation = [
    body('name')
        .notEmpty()
        .withMessage('Outfit name is required')
        .trim()
        .isLength({ min: 1, max: 255 })
        .withMessage('Outfit name must be between 1 and 255 characters'),
    body('items')
        .isArray({ min: 1 })
        .withMessage('At least one clothing item is required'),
    body('items.*')
        .isUUID()
        .withMessage('Invalid clothing item ID'),
    body('occasion')
        .optional()
        .trim()
        .isIn(['casual', 'formal', 'business', 'athletic', 'party', 'date', 'outdoor', 'beach', 'wedding', 'travel'])
        .withMessage('Invalid occasion type'),
    body('notes')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('Notes must be less than 1000 characters')
];

const suggestOutfitValidation = [
    body('occasion')
        .notEmpty()
        .withMessage('Occasion is required')
        .trim(),
    body('city')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('City name too long'),
    body('country')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Country name too long')
];

/**
 * @route   POST /api/outfits
 * @desc    Create a manual outfit
 * @access  Private
 */
router.post(
    '/',
    authenticateUser,
    createOutfitValidation,
    OutfitController.createOutfit
);

/**
 * @route   POST /api/outfits/suggest
 * @desc    Get AI-based outfit suggestion
 * @access  Private
 */
router.post(
    '/suggest',
    authenticateUser,
    suggestOutfitValidation,
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
    authenticateUser,
    OutfitController.getUserOutfits
);

/**
 * @route   GET /api/outfits/stats
 * @desc    Get outfit statistics
 * @access  Private
 */
router.get(
    '/stats',
    authenticateUser,
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
    authenticateUser,
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
    authenticateUser,
    OutfitController.getTomorrowOutfit
);

/**
 * @route   POST /api/outfits/recommendations/custom
 * @desc    Get custom outfit recommendation for a specific date
 * @access  Private
 */
router.post(
    '/recommendations/custom',
    authenticateUser,
    [
        body('date')
            .notEmpty()
            .withMessage('Date is required')
            .isISO8601()
            .withMessage('Invalid date format (use ISO 8601)'),
        body('activity')
            .optional()
            .trim()
            .isLength({ max: 100 })
            .withMessage('Activity name too long')
    ],
    OutfitController.getCustomOutfit
);

/**
 * @route   GET /api/outfits/:id
 * @desc    Get a single outfit by ID
 * @access  Private
 */
router.get(
    '/:id',
    authenticateUser,
    OutfitController.getOutfitById
);

/**
 * @route   PUT /api/outfits/:id
 * @desc    Update an outfit
 * @access  Private
 */
router.put(
    '/:id',
    authenticateUser,
    [
        body('name')
            .optional()
            .trim()
            .isLength({ min: 1, max: 255 })
            .withMessage('Outfit name must be between 1 and 255 characters'),
        body('items')
            .optional()
            .isArray({ min: 1 })
            .withMessage('Items must be a non-empty array'),
        body('items.*')
            .optional()
            .isUUID()
            .withMessage('Invalid clothing item ID'),
        body('occasion')
            .optional()
            .trim(),
        body('notes')
            .optional()
            .trim()
    ],
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
    authenticateUser,
    OutfitController.deleteOutfit
);

/**
 * @route   PATCH /api/outfits/:id/favorite
 * @desc    Toggle outfit favorite status
 * @access  Private
 */
router.patch(
    '/:id/favorite',
    authenticateUser,
    OutfitController.toggleFavorite
);

/**
 * @route   POST /api/outfits/:id/wear
 * @desc    Record when outfit was worn
 * @access  Private
 */
router.post(
    '/:id/wear',
    authenticateUser,
    [
        body('wornAt')
            .optional()
            .isISO8601()
            .withMessage('Invalid date format for wornAt')
    ],
    OutfitController.recordWear
);

router.post('/interactions', authenticateToken, OutfitController.trackInteraction);

router.post('/:outfitId/rate', authenticateToken, OutfitController.rateOutfit);

router.post('/:outfitId/wear', authenticateToken, OutfitController.wearOutfit);


module.exports = router;