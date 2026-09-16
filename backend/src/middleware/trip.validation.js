// ============================================================================
// TRIP VALIDATION MIDDLEWARE
// ============================================================================
// Phase 0 fix (completed): this used to run on express-validator while
// auth/clothes/outfit run on Joi. Ported to Joi here for real, using the
// same `validate(schema, source)` helper auth already uses — one library,
// one pattern, everywhere.
//
// While porting this, found and fixed a real bug: `validateUpdateTrip`
// validated `param('tripId')`, but the route it's attached to
// (PUT /api/v1/trip/:id) actually names its param `:id` — so this check
// was validating a field that never existed and PUT always failed
// validation with a 400, before the handler ever ran. `DELETE /:id` had
// the same mismatch via `validateTripId`, just silently (its controller
// never checked express-validator's result at all, so the bad validator
// there was inert rather than blocking — see trip.routes.js's comment).
// Fixed by standardizing every trip route on `:tripId` as the param name
// (trip.routes.js renames `/:id` -> `/:tripId` for PUT/DELETE to match);
// trip.controller.js already reads `req.params.tripId` in both places, so
// no controller change was needed once the route path matches it.
// ============================================================================

const Joi = require('joi');
const { validate } = require('./validators');

const tripIdParamSchema = Joi.object({
    tripId: Joi.string().uuid().required().label('Trip ID'),
});

const activitySlotSchema = Joi.object({
    time: Joi.string().valid('morning', 'afternoon', 'evening', 'night', 'all-day'),
    occasion: Joi.string().trim().min(1),
});

const activitySchema = Joi.object({
    date: Joi.string().isoDate(),
    slots: Joi.array().items(activitySlotSchema),
}).unknown(true);

const luggageConstraintsSchema = Joi.object({
    type: Joi.string().valid('carry-on', 'checked-luggage', 'backpack', 'unlimited'),
    maxItems: Joi.number().integer().min(1).max(100),
}).unknown(true);

const createTripBodySchema = Joi.object({
    destination: Joi.string().trim().min(2).max(255).required()
        .messages({
            'string.min': 'Destination must be between 2-255 characters',
            'string.max': 'Destination must be between 2-255 characters',
            'any.required': 'Destination is required',
        }),
    startDate: Joi.string().isoDate().required()
        .messages({
            'string.isoDate': 'Invalid start date format (use ISO 8601: YYYY-MM-DD)',
            'any.required': 'Start date is required',
        }),
    endDate: Joi.string().isoDate().required()
        .messages({
            'string.isoDate': 'Invalid end date format (use ISO 8601: YYYY-MM-DD)',
            'any.required': 'End date is required',
        }),
    purpose: Joi.string().trim().valid('leisure', 'business', 'adventure', 'family', 'romantic', 'solo')
        .messages({ 'any.only': 'Invalid trip purpose' }),
    tripType: Joi.string().trim().valid('weekend', 'vacation', 'business', 'backpacking', 'road-trip', 'cruise')
        .messages({ 'any.only': 'Invalid trip type' }),
    budget: Joi.number().min(0).messages({ 'number.min': 'Budget must be a positive number' }),
    accommodation: Joi.string().trim().max(255)
        .messages({ 'string.max': 'Accommodation description too long (max 255 characters)' }),
    transportation: Joi.string().trim().max(255)
        .messages({ 'string.max': 'Transportation description too long (max 255 characters)' }),
    companions: Joi.number().integer().min(1).max(50)
        .messages({ 'number.min': 'Companions must be between 1-50', 'number.max': 'Companions must be between 1-50' }),
    notes: Joi.string().trim().max(2000)
        .messages({ 'string.max': 'Notes too long (max 2000 characters)' }),
    activities: Joi.array().items(activitySchema),
    luggageConstraints: luggageConstraintsSchema,
});

const updateTripBodySchema = Joi.object({
    destination: Joi.string().trim().min(2).max(255)
        .messages({ 'string.min': 'Destination must be between 2-255 characters', 'string.max': 'Destination must be between 2-255 characters' }),
    startDate: Joi.string().isoDate().messages({ 'string.isoDate': 'Invalid start date format' }),
    endDate: Joi.string().isoDate().messages({ 'string.isoDate': 'Invalid end date format' }),
    purpose: Joi.string().trim().valid('leisure', 'business', 'adventure', 'family', 'romantic', 'solo')
        .messages({ 'any.only': 'Invalid trip purpose' }),
    tripType: Joi.string().trim().valid('weekend', 'vacation', 'business', 'backpacking', 'road-trip', 'cruise')
        .messages({ 'any.only': 'Invalid trip type' }),
    budget: Joi.number().min(0).messages({ 'number.min': 'Budget must be a positive number' }),
    status: Joi.string().valid('upcoming', 'active', 'completed', 'cancelled')
        .messages({ 'any.only': 'Invalid trip status' }),
    notes: Joi.string().trim().max(2000).messages({ 'string.max': 'Notes too long (max 2000 characters)' }),
});

const getTripsQuerySchema = Joi.object({
    status: Joi.string().valid('upcoming', 'active', 'completed', 'cancelled'),
    isActive: Joi.boolean(),
    limit: Joi.number().integer().min(1).max(100),
});

const regeneratePackingListBodySchema = Joi.object({
    activities: Joi.array().items(activitySchema),
    luggageConstraints: luggageConstraintsSchema,
});

module.exports = {
    validateCreateTrip: validate(createTripBodySchema, 'body'),
    validateUpdateTrip: [validate(tripIdParamSchema, 'params'), validate(updateTripBodySchema, 'body')],
    validateTripId: validate(tripIdParamSchema, 'params'),
    validateGetTrips: validate(getTripsQuerySchema, 'query'),
    validateRegeneratePackingList: [validate(tripIdParamSchema, 'params'), validate(regeneratePackingListBodySchema, 'body')],
};
