const express = require('express');
const router = express.Router();
const UserPreferencesController = require('../controllers/userPreference.controller');
const { authenticate } = require('../middleware/auth');
// Phase 0 fix: ported off express-validator onto Joi (see
// userPreference.validation.js) — one validation library across the app,
// and the new schema also covers several fields this controller reads
// that the old express-validator array never had a rule for at all.
const { validatePreferences } = require('../middleware/userPreference.validation');

/**
 * @route   POST /api/preferences
 * @desc    Create or update user preferences (upsert)
 * @access  Private
 */
router.post(
    '/',
    authenticate,
    validatePreferences,
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