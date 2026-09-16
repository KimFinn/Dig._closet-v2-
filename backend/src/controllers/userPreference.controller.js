const { UserPreferences } = require("../database/models");
const logger = require('../utils/logger');
// Phase 0 fix: validation now happens entirely in the Joi middleware
// (userPreference.validation.js, applied in userPreference.routes.js) —
// the express-validator check that used to live here is gone.

class UserPreferencesController {
    /**
     * Create or update user preferences (upsert)
     * @route POST /api/preferences
     */
    static async createOrUpdatePreferences(req, res, next) {
        try {
            const userId = req.user.userId;
            const {
                // Style preferences
                stylePersona,
                preferredColors,
                avoidColors,
                preferredFabrics,
                avoidFabrics,
                preferredBrands,
                
                // Occasion preferences
                occasionFrequency,
                
                // Work/Schedule information
                employmentStatus,
                workSchedule,
                workDresscode,
                workdays,
                
                // Body & Fit
                bodyType,
                fitPreference,
                sizes,
                
                // Lifestyle
                climate,
                activities,
                lifestyle,
                budget,
                
                // Shopping preferences
                shoppingFrequency,
                sustainabilityPreference,
                
                // Personal details
                ageRange,
                gender,
                
                // Additional
                notes,
                notificationPreferences
            } = req.body;

            // Check if preferences already exist
            let preferences = await UserPreferences.findOne({
                where: { userId }
            });

            if (preferences) {
                // Update existing preferences
                await preferences.update({
                    stylePersona: stylePersona?.trim(),
                    preferredColors: preferredColors || preferences.preferredColors,
                    avoidColors: avoidColors || preferences.avoidColors,
                    preferredFabrics: preferredFabrics || preferences.preferredFabrics,
                    avoidFabrics: avoidFabrics || preferences.avoidFabrics,
                    preferredBrands: preferredBrands || preferences.preferredBrands,
                    occasionFrequency: occasionFrequency || preferences.occasionFrequency,
                    employmentStatus: employmentStatus?.trim(),
                    workSchedule: workSchedule || preferences.workSchedule,
                    workDresscode: workDresscode?.trim(),
                    workdays: workdays || preferences.workdays,
                    bodyType: bodyType?.trim(),
                    fitPreference: fitPreference?.trim(),
                    sizes: sizes || preferences.sizes,
                    climate: climate?.trim(),
                    activities: activities || preferences.activities,
                    lifestyle: lifestyle?.trim(),
                    budget: budget?.trim(),
                    shoppingFrequency: shoppingFrequency?.trim(),
                    sustainabilityPreference: sustainabilityPreference?.trim(),
                    ageRange: ageRange?.trim(),
                    gender: gender?.trim(),
                    notes: notes?.trim(),
                    notificationPreferences: notificationPreferences || preferences.notificationPreferences
                });

                logger.info('User preferences updated', {
                    userId,
                    preferencesId: preferences.id
                });

                return res.status(200).json({
                    success: true,
                    message: "Preferences updated successfully",
                    data: { preferences }
                });
            } else {
                // Create new preferences
                preferences = await UserPreferences.create({
                    userId,
                    stylePersona: stylePersona?.trim(),
                    preferredColors: preferredColors || [],
                    avoidColors: avoidColors || [],
                    preferredFabrics: preferredFabrics || [],
                    avoidFabrics: avoidFabrics || [],
                    preferredBrands: preferredBrands || [],
                    occasionFrequency: occasionFrequency || {},
                    employmentStatus: employmentStatus?.trim() || 'not_specified',
                    workSchedule: workSchedule || {},
                    workDresscode: workDresscode?.trim(),
                    workdays: workdays || [],
                    bodyType: bodyType?.trim(),
                    fitPreference: fitPreference?.trim() || 'regular',
                    sizes: sizes || {},
                    climate: climate?.trim(),
                    activities: activities || [],
                    lifestyle: lifestyle?.trim(),
                    budget: budget?.trim(),
                    shoppingFrequency: shoppingFrequency?.trim(),
                    sustainabilityPreference: sustainabilityPreference?.trim(),
                    ageRange: ageRange?.trim(),
                    gender: gender?.trim(),
                    notes: notes?.trim(),
                    notificationPreferences: notificationPreferences || {
                        outfitSuggestions: true,
                        weatherAlerts: true,
                        tripReminders: true
                    }
                });

                logger.info('User preferences created', {
                    userId,
                    preferencesId: preferences.id
                });

                return res.status(201).json({
                    success: true,
                    message: "Preferences created successfully",
                    data: { preferences }
                });
            }

        } catch (error) {
            logger.error('Error creating/updating preferences:', {
                error: error.message,
                stack: error.stack,
                userId: req.user?.userId
            });
            next(error);
        }
    }

    /**
     * Get user preferences
     * @route GET /api/preferences
     */
    static async getPreferences(req, res, next) {
        try {
            const userId = req.user.userId;

            const preferences = await UserPreferences.findOne({
                where: { userId }
            });

            if (!preferences) {
                return res.status(404).json({
                    success: false,
                    message: "Preferences not found. Please set up your preferences."
                });
            }

            // Add completion percentage
            const completionPercentage = preferences.calculateCompleteness();

            res.status(200).json({
                success: true,
                data: {
                    preferences,
                    completionPercentage
                }
            });

        } catch (error) {
            logger.error('Error fetching preferences:', {
                error: error.message,
                userId: req.user?.userId
            });
            next(error);
        }
    }

    /**
     * Update specific preference sections
     * @route PATCH /api/preferences/:section
     */
    static async updatePreferenceSection(req, res, next) {
        try {
            const userId = req.user.userId;
            const { section } = req.params;

            const validSections = [
                'style',
                'work',
                'body',
                'lifestyle',
                'shopping',
                'notifications'
            ];

            if (!validSections.includes(section)) {
                return res.status(400).json({
                    success: false,
                    message: `Invalid section. Valid sections: ${validSections.join(', ')}`
                });
            }

            const preferences = await UserPreferences.findOne({
                where: { userId }
            });

            if (!preferences) {
                return res.status(404).json({
                    success: false,
                    message: "Preferences not found. Please create preferences first."
                });
            }

            // Update based on section
            const updates = {};

            switch (section) {
                case 'style':
                    if (req.body.stylePersona) updates.stylePersona = req.body.stylePersona.trim();
                    if (req.body.preferredColors) updates.preferredColors = req.body.preferredColors;
                    if (req.body.avoidColors) updates.avoidColors = req.body.avoidColors;
                    if (req.body.preferredFabrics) updates.preferredFabrics = req.body.preferredFabrics;
                    if (req.body.avoidFabrics) updates.avoidFabrics = req.body.avoidFabrics;
                    if (req.body.preferredBrands) updates.preferredBrands = req.body.preferredBrands;
                    break;

                case 'work':
                    if (req.body.employmentStatus) updates.employmentStatus = req.body.employmentStatus.trim();
                    if (req.body.workSchedule) updates.workSchedule = req.body.workSchedule;
                    if (req.body.workDresscode) updates.workDresscode = req.body.workDresscode.trim();
                    if (req.body.workdays) updates.workdays = req.body.workdays;
                    break;

                case 'body':
                    if (req.body.bodyType) updates.bodyType = req.body.bodyType.trim();
                    if (req.body.fitPreference) updates.fitPreference = req.body.fitPreference.trim();
                    if (req.body.sizes) updates.sizes = req.body.sizes;
                    break;

                case 'lifestyle':
                    if (req.body.climate) updates.climate = req.body.climate.trim();
                    if (req.body.activities) updates.activities = req.body.activities;
                    if (req.body.lifestyle) updates.lifestyle = req.body.lifestyle.trim();
                    if (req.body.budget) updates.budget = req.body.budget.trim();
                    break;

                case 'shopping':
                    if (req.body.shoppingFrequency) updates.shoppingFrequency = req.body.shoppingFrequency.trim();
                    if (req.body.sustainabilityPreference) updates.sustainabilityPreference = req.body.sustainabilityPreference.trim();
                    break;

                case 'notifications':
                    if (req.body.notificationPreferences) updates.notificationPreferences = req.body.notificationPreferences;
                    break;
            }

            if (Object.keys(updates).length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'No valid fields to update'
                });
            }

            await preferences.update(updates);

            logger.info('Preference section updated', {
                userId,
                section,
                updatedFields: Object.keys(updates)
            });

            res.status(200).json({
                success: true,
                message: `${section} preferences updated successfully`,
                data: { preferences }
            });

        } catch (error) {
            logger.error('Error updating preference section:', {
                error: error.message,
                userId: req.user?.userId,
                section: req.params.section
            });
            next(error);
        }
    }

    /**
     * Delete user preferences
     * @route DELETE /api/preferences
     */
    static async deletePreferences(req, res, next) {
        try {
            const userId = req.user.userId;

            const preferences = await UserPreferences.findOne({
                where: { userId }
            });

            if (!preferences) {
                return res.status(404).json({
                    success: false,
                    message: "Preferences not found"
                });
            }

            await preferences.destroy();

            logger.info('User preferences deleted', {
                userId,
                preferencesId: preferences.id
            });

            res.status(200).json({
                success: true,
                message: "Preferences deleted successfully"
            });

        } catch (error) {
            logger.error('Error deleting preferences:', {
                error: error.message,
                userId: req.user?.userId
            });
            next(error);
        }
    }

    /**
     * Get outfit recommendations based on schedule
     * @route GET /api/preferences/schedule-recommendations
     */
    static async getScheduleBasedRecommendations(req, res, next) {
        try {
            const userId = req.user.userId;
            const { date } = req.query;

            const preferences = await UserPreferences.findOne({
                where: { userId }
            });

            if (!preferences) {
                return res.status(404).json({
                    success: false,
                    message: "Please set up your preferences first"
                });
            }

            const targetDate = date ? new Date(date) : new Date();
            const dayOfWeek = targetDate.toLocaleDateString('en-US', { weekday: 'lowercase' });

            // Check if it's a workday
            const isWorkday = preferences.workdays?.includes(dayOfWeek);
            
            const recommendations = {
                date: targetDate,
                isWorkday,
                dresscode: isWorkday ? preferences.workDresscode : 'casual',
                suggestedOccasions: isWorkday ? ['business', 'work'] : ['casual', 'leisure'],
                workSchedule: isWorkday ? preferences.workSchedule : null,
                styleHints: {
                    colors: preferences.preferredColors,
                    fabrics: preferences.preferredFabrics,
                    fitPreference: preferences.fitPreference
                }
            };

            res.status(200).json({
                success: true,
                data: { recommendations }
            });

        } catch (error) {
            logger.error('Error generating schedule recommendations:', {
                error: error.message,
                userId: req.user?.userId
            });
            next(error);
        }
    }

    /**
     * Get preference suggestions for onboarding
     * @route GET /api/preferences/suggestions
     */
    static async getPreferenceSuggestions(req, res, next) {
        try {
            const suggestions = {
                stylePersonas: [
                    'minimalist', 'classic', 'trendy', 'bohemian', 'preppy',
                    'streetwear', 'sporty', 'elegant', 'edgy', 'romantic'
                ],
                employmentStatuses: [
                    'employed_office', 'employed_remote', 'employed_hybrid',
                    'self_employed', 'student', 'retired', 'unemployed', 'not_specified'
                ],
                dressCodes: [
                    'business_formal', 'business_casual', 'smart_casual',
                    'casual', 'creative', 'uniform', 'no_dresscode'
                ],
                bodyTypes: [
                    'rectangle', 'triangle', 'inverted_triangle', 'hourglass', 'oval'
                ],
                fitPreferences: [
                    'tight', 'fitted', 'regular', 'relaxed', 'oversized'
                ],
                climates: [
                    'tropical', 'hot_dry', 'temperate', 'cold', 'variable'
                ],
                lifestyles: [
                    'active', 'balanced', 'professional', 'creative', 'casual', 'social'
                ],
                budgets: [
                    'budget', 'moderate', 'premium', 'luxury', 'mixed'
                ],
                sustainabilityLevels: [
                    'not_important', 'somewhat_important', 'important', 'very_important'
                ]
            };

            res.status(200).json({
                success: true,
                data: { suggestions }
            });

        } catch (error) {
            logger.error('Error fetching suggestions:', {
                error: error.message
            });
            next(error);
        }
    }

    /**
     * Validate preferences completeness
     * @route GET /api/preferences/validate
     */
    static async validatePreferences(req, res, next) {
        try {
            const userId = req.user.userId;

            const preferences = await UserPreferences.findOne({
                where: { userId }
            });

            if (!preferences) {
                return res.status(200).json({
                    success: true,
                    data: {
                        isComplete: false,
                        completionPercentage: 0,
                        missingFields: ['All preferences'],
                        recommendations: ['Please set up your preferences to get personalized recommendations']
                    }
                });
            }

            const validation = preferences.validateCompleteness();

            res.status(200).json({
                success: true,
                data: validation
            });

        } catch (error) {
            logger.error('Error validating preferences:', {
                error: error.message,
                userId: req.user?.userId
            });
            next(error);
        }
    }
}

module.exports = UserPreferencesController;