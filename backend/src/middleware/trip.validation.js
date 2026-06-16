// ============================================================================
// TRIP VALIDATION MIDDLEWARE
// ============================================================================
// Express-validator rules for trip endpoints
// ============================================================================

const { body, param, query } = require('express-validator');

/**
 * ✅ VALIDATION: Create Trip
 */
const validateCreateTrip = [
  body('destination')
    .trim()
    .notEmpty()
    .withMessage('Destination is required')
    .isLength({ min: 2, max: 255 })
    .withMessage('Destination must be between 2-255 characters'),

  body('startDate')
    .notEmpty()
    .withMessage('Start date is required')
    .isISO8601()
    .withMessage('Invalid start date format (use ISO 8601: YYYY-MM-DD)'),

  body('endDate')
    .notEmpty()
    .withMessage('End date is required')
    .isISO8601()
    .withMessage('Invalid end date format (use ISO 8601: YYYY-MM-DD)'),

  body('purpose')
    .optional()
    .trim()
    .isIn(['leisure', 'business', 'adventure', 'family', 'romantic', 'solo'])
    .withMessage('Invalid trip purpose'),

  body('tripType')
    .optional()
    .trim()
    .isIn(['weekend', 'vacation', 'business', 'backpacking', 'road-trip', 'cruise'])
    .withMessage('Invalid trip type'),

  body('budget')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Budget must be a positive number'),

  body('accommodation')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Accommodation description too long (max 255 characters)'),

  body('transportation')
    .optional()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Transportation description too long (max 255 characters)'),

  body('companions')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Companions must be between 1-50'),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Notes too long (max 2000 characters)'),

  // ✅ ACTIVITIES VALIDATION
  body('activities')
    .optional()
    .isArray()
    .withMessage('Activities must be an array'),

  body('activities.*.date')
    .optional()
    .isISO8601()
    .withMessage('Activity date must be valid ISO 8601 format'),

  body('activities.*.slots')
    .optional()
    .isArray()
    .withMessage('Activity slots must be an array'),

  body('activities.*.slots.*.time')
    .optional()
    .isIn(['morning', 'afternoon', 'evening', 'night', 'all-day'])
    .withMessage('Invalid time slot'),

  body('activities.*.slots.*.occasion')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Occasion cannot be empty'),

  // ✅ LUGGAGE CONSTRAINTS VALIDATION
  body('luggageConstraints')
    .optional()
    .isObject()
    .withMessage('Luggage constraints must be an object'),

  body('luggageConstraints.type')
    .optional()
    .isIn(['carry-on', 'checked-luggage', 'backpack', 'unlimited'])
    .withMessage('Invalid luggage type'),

  body('luggageConstraints.maxItems')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Max items must be between 1-100')
];

/**
 * ✅ VALIDATION: Update Trip
 */
const validateUpdateTrip = [
  param('tripId')
    .isUUID()
    .withMessage('Invalid trip ID'),

  body('destination')
    .optional()
    .trim()
    .isLength({ min: 2, max: 255 })
    .withMessage('Destination must be between 2-255 characters'),

  body('startDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid start date format'),

  body('endDate')
    .optional()
    .isISO8601()
    .withMessage('Invalid end date format'),

  body('purpose')
    .optional()
    .trim()
    .isIn(['leisure', 'business', 'adventure', 'family', 'romantic', 'solo'])
    .withMessage('Invalid trip purpose'),

  body('tripType')
    .optional()
    .trim()
    .isIn(['weekend', 'vacation', 'business', 'backpacking', 'road-trip', 'cruise'])
    .withMessage('Invalid trip type'),

  body('budget')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Budget must be a positive number'),

  body('status')
    .optional()
    .isIn(['upcoming', 'active', 'completed', 'cancelled'])
    .withMessage('Invalid trip status'),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Notes too long (max 2000 characters)')
];

/**
 * ✅ VALIDATION: Trip ID Parameter
 */
const validateTripId = [
  param('tripId')
    .isUUID()
    .withMessage('Invalid trip ID format')
];

/**
 * ✅ VALIDATION: Get Trips Query Filters
 */
const validateGetTrips = [
  query('status')
    .optional()
    .isIn(['upcoming', 'active', 'completed', 'cancelled'])
    .withMessage('Invalid status filter'),

  query('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be boolean'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1-100')
];

/**
 * ✅ VALIDATION: Regenerate Packing List
 */
const validateRegeneratePackingList = [
  param('tripId')
    .isUUID()
    .withMessage('Invalid trip ID'),

  body('activities')
    .optional()
    .isArray()
    .withMessage('Activities must be an array'),

  body('luggageConstraints')
    .optional()
    .isObject()
    .withMessage('Luggage constraints must be an object')
];

module.exports = {
  validateCreateTrip,
  validateUpdateTrip,
  validateTripId,
  validateGetTrips,
  validateRegeneratePackingList
};