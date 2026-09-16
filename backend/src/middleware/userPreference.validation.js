// ============================================================================
// USER PREFERENCE VALIDATION MIDDLEWARE
// ============================================================================
// Phase 0 fix: ported from express-validator to Joi, using the same
// `validate(schema, source)` helper auth already uses.
//
// Important detail found while porting: the old `preferencesValidation`
// array only declared rules for 14 of the ~20 fields
// createOrUpdatePreferences actually reads from req.body (it never had
// any rule at all for avoidColors, preferredFabrics, avoidFabrics,
// preferredBrands, occasionFrequency, workSchedule, sizes, activities, or
// notificationPreferences — those just passed through unchecked). The Joi
// `validate()` helper runs with `stripUnknown: true`, so a schema that
// only listed the original 14 fields would have started silently
// DROPPING all of those other real, currently-working fields instead of
// just leaving them unvalidated like before. This schema explicitly
// includes all of them — strict rules for the originally-validated 14,
// permissive (but correctly typed) rules for the rest — to keep exact
// existing behavior for those fields while still gaining real enum/type
// checking on the ones that had it before.
// ============================================================================

const Joi = require('joi');
const { validate } = require('./validators');

const preferencesBodySchema = Joi.object({
    // Originally validated (enum/length rules preserved exactly)
    stylePersona: Joi.string().trim()
        .valid('minimalist', 'classic', 'trendy', 'bohemian', 'preppy', 'streetwear', 'sporty', 'elegant', 'edgy', 'romantic')
        .messages({ 'any.only': 'Invalid style persona' }),
    preferredColors: Joi.array().items(Joi.string())
        .messages({ 'array.base': 'Preferred colors must be an array' }),
    employmentStatus: Joi.string().trim()
        .valid('employed_office', 'employed_remote', 'employed_hybrid', 'self_employed', 'student', 'retired', 'unemployed', 'not_specified')
        .messages({ 'any.only': 'Invalid employment status' }),
    workDresscode: Joi.string().trim()
        .valid('business_formal', 'business_casual', 'smart_casual', 'casual', 'creative', 'uniform', 'no_dresscode')
        .messages({ 'any.only': 'Invalid work dresscode' }),
    workdays: Joi.array().items(
        Joi.string().lowercase().valid('monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday')
    ).messages({ 'array.base': 'Workdays must be an array', 'any.only': 'Invalid workday values' }),
    bodyType: Joi.string().trim()
        .valid('rectangle', 'triangle', 'inverted_triangle', 'hourglass', 'oval')
        .messages({ 'any.only': 'Invalid body type' }),
    fitPreference: Joi.string().trim()
        .valid('tight', 'fitted', 'regular', 'relaxed', 'oversized')
        .messages({ 'any.only': 'Invalid fit preference' }),
    climate: Joi.string().trim()
        .valid('tropical', 'hot_dry', 'temperate', 'cold', 'variable')
        .messages({ 'any.only': 'Invalid climate' }),
    lifestyle: Joi.string().trim()
        .valid('active', 'balanced', 'professional', 'creative', 'casual', 'social')
        .messages({ 'any.only': 'Invalid lifestyle' }),
    budget: Joi.string().trim()
        .valid('budget', 'moderate', 'premium', 'luxury', 'mixed')
        .messages({ 'any.only': 'Invalid budget' }),
    shoppingFrequency: Joi.string().trim()
        .valid('weekly', 'bi_weekly', 'monthly', 'quarterly', 'bi_annually', 'annually', 'rarely')
        .messages({ 'any.only': 'Invalid shopping frequency' }),
    sustainabilityPreference: Joi.string().trim()
        .valid('not_important', 'somewhat_important', 'important', 'very_important')
        .messages({ 'any.only': 'Invalid sustainability preference' }),
    ageRange: Joi.string().trim()
        .valid('18-24', '25-34', '35-44', '45-54', '55-64', '65+')
        .messages({ 'any.only': 'Invalid age range' }),
    gender: Joi.string().trim()
        .valid('male', 'female', 'non_binary', 'prefer_not_to_say')
        .messages({ 'any.only': 'Invalid gender' }),
    notes: Joi.string().trim().max(2000)
        .messages({ 'string.max': 'Notes must be less than 2000 characters' }),

    // Previously read by the controller with NO validation at all —
    // kept permissive on purpose, just typed, to preserve behavior.
    avoidColors: Joi.array().items(Joi.string()),
    preferredFabrics: Joi.array().items(Joi.string()),
    avoidFabrics: Joi.array().items(Joi.string()),
    preferredBrands: Joi.array().items(Joi.string()),
    occasionFrequency: Joi.object().unknown(true),
    workSchedule: Joi.object().unknown(true),
    sizes: Joi.object().unknown(true),
    activities: Joi.array().items(Joi.string()),
    notificationPreferences: Joi.object().unknown(true),
});

module.exports = {
    validatePreferences: validate(preferencesBodySchema, 'body'),
};
