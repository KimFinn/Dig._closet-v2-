const express = require('express');
const router = express.Router();
const UserPreferencesController = require('../controllers/userPreference.controller');
const { authenticate } = require('../middleware/auth');
const { body } = require('express-validator');

// Validation middleware
const preferencesValidation = [
    body('stylePersona')
        .optional()
        .trim()
        .isIn(['minimalist', 'classic', 'trendy', 'bohemian', 'preppy', 'streetwear', 'sporty', 'elegant', 'edgy', 'romantic'])
        .withMessage('Invalid style persona'),
    body('preferredColors')
        .optional()
        .isArray()
        .withMessage('Preferred colors must be an array'),
    body('employmentStatus')
        .optional()
        .trim()
        .isIn(['employed_office', 'employed_remote', 'employed_hybrid', 'self_employed', 'student', 'retired', 'unemployed', 'not_specified'])
        .withMessage('Invalid employment status'),
    body('workDresscode')
        .optional()
        .trim()
        .isIn(['business_formal', 'business_casual', 'smart_casual', 'casual', 'creative', 'uniform', 'no_dresscode'])
        .withMessage('Invalid work dresscode'),
    body('workdays')
        .optional()
        .isArray()
        .withMessage('Workdays must be an array')
        .custom((value) => {
            const validDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
            return value.every(day => validDays.includes(day.toLowerCase()));
        })
        .withMessage('Invalid workday values'),
    body('bodyType')
        .optional()
        .trim()
        .isIn(['rectangle', 'triangle', 'inverted_triangle', 'hourglass', 'oval'])
        .withMessage('Invalid body type'),
    body('fitPreference')
        .optional()
        .trim()
        .isIn(['tight', 'fitted', 'regular', 'relaxed', 'oversized'])
        .withMessage('Invalid fit preference'),
    body('climate')
        .optional()
        .trim()
        .isIn(['tropical', 'hot_dry', 'temperate', 'cold', 'variable'])
        .withMessage('Invalid climate'),
    body('lifestyle')
        .optional()
        .trim()
        .isIn(['active', 'balanced', 'professional', 'creative', 'casual', 'social'])
        .withMessage('Invalid lifestyle'),
    body('budget')
        .optional()
        .trim()
        .isIn(['budget', 'moderate', 'premium', 'luxury', 'mixed'])
        .withMessage('Invalid budget'),
    body('shoppingFrequency')
        .optional()
        .trim()
        .isIn(['weekly', 'bi_weekly', 'monthly', 'quarterly', 'bi_annually', 'annually', 'rarely'])
        .withMessage('Invalid shopping frequency'),
    body('sustainabilityPreference')
        .optional()
        .trim()
        .isIn(['not_important', 'somewhat_important', 'important', 'very_important'])
        .withMessage('Invalid sustainability preference'),
    body('ageRange')
        .optional()
        .trim()
        .isIn(['18-24', '25-34', '35-44', '45-54', '55-64', '65+'])
        .withMessage('Invalid age range'),
    body('gender')
        .optional()
        .trim()
        .isIn(['male', 'female', 'non_binary', 'prefer_not_to_say'])
        .withMessage('Invalid gender'),
    body('notes')
        .optional()
        .trim()
        .isLength({ max: 2000 })
        .withMessage('Notes must be less than 2000 characters')
];

/**
 * @route   POST /api/preferences
 * @desc    Create or update user preferences (upsert)
 * @access  Private
 */
router.post(
    '/',
    authenticate,
    preferencesValidation,
    UserPreferencesController.createOrUpdatePreferences
);

/**
 * @route   GET /api/preferences
 * @desc    Get user preferences
 * @access  Private
 */
router.get(
    '/',
    authenticate,
    UserPreferencesController.getPreferences
);

/**
 * @route   PATCH /api/preferences/:section
 * @desc    Update specific preference section
 * @access  Private
 * @params  section - style, work, body, lifestyle, shopping, notifications
 */
router.patch(
    '/:section',
    authenticate,
    UserPreferencesController.updatePreferenceSection
);

/**
 * @route   DELETE /api/preferences
 * @desc    Delete user preferences
 * @access  Private
 */
router.delete(
    '/',
    authenticate,
    UserPreferencesController.deletePreferences
);

/**
 * @route   GET /api/preferences/schedule-recommendations
 * @desc    Get outfit recommendations based on user's schedule
 * @access  Private
 * @query   date - Optional date to get recommendations for (defaults to today)
 */
router.get(
    '/schedule-recommendations',
    authenticate,
    UserPreferencesController.getScheduleBasedRecommendations
);

/**
 * @route   GET /api/preferences/suggestions
 * @desc    Get available options for preference fields (for onboarding)
 * @access  Private
 */
router.get(
    '/suggestions',
    authenticate,
    UserPreferencesController.getPreferenceSuggestions
);

/**
 * @route   GET /api/preferences/validate
 * @desc    Validate preferences completeness
 * @access  Private
 */
router.get(
    '/validate',
    authenticate,
    UserPreferencesController.validatePreferences
);

module.exports = router;