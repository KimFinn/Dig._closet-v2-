const express = require('express');
const router = express.Router();
const TripController = require('../controllers/trip.controller');
const { authenticate } = require('../middleware/auth');
const {
  validateCreateTrip,
  validateUpdateTrip,
  validateTripId,
  validateGetTrips,
  validateRegeneratePackingList,
  validateUpdateDayActivity
} = require('../middleware/trip.validation');
// Phase 7 (PRD §3.8) -- TripActivity full logic, mounted below.
const tripActivityRoutes = require('./tripActivity.routes');


/**
 * @route   POST /api/trips
 * @desc    Create a new trip with packing recommendations
 * @access  Private
 * @body    {
 *   destination: string (required) - "Paris, France"
 *   startDate: string (required) - "2025-01-15"
 *   endDate: string (required) - "2025-01-20"
 *   purpose: string (optional) - "leisure" | "business" | "adventure"
 *   tripType: string (optional) - "weekend" | "vacation" | "business"
 *   budget: number (optional)
 *   accommodation: string (optional)
 *   transportation: string (optional)
 *   companions: number (optional) - default 1
 *   notes: string (optional)
 *   activities: array (optional) - [{
 *     date: "2025-01-15",
 *     slots: [{ time: "morning", occasion: "business meeting" }]
 *   }]
 *   luggageConstraints: object (optional) - {
 *     type: "carry-on",
 *     maxItems: 20
 *   }
 * }
 */
router.post(
    '/',
    authenticate,
    validateCreateTrip,
    TripController.createTrip
);

/**
 * @route   GET /api/trips
 * @desc    Get all trips for authenticated user
 * @access  Private
 * @query   status - Filter by trip status (upcoming/active/completed/cancelled)
 * @query   isActive - Filter by active status (true/false)
 * @query   limit - Maximum number of trips to return (1-100) */
router.get(
    '/',
    authenticate,
    validateGetTrips,
    TripController.getUserTrips
);

/**
 * @route  GET/api/trips/active
 * @desc et the currently active trips if any
 * @access Private
 */
router.get('/active',
    authenticate,
    TripController.getActiveTrip
);

/**
 * @route   POST /api/v1/trip/suggest-destinations
 * @desc    Phase 7 Mode B -- open-ended leisure planning, no destination
 *          chosen yet. Body: { vibe?: 'warm'|'cold'|'mild', month?: 1-12,
 *          interests?: string[] } (interests falls back to the user's
 *          own activityCategories preference when omitted).
 * @access  Private
 * @note    Registered BEFORE the /:tripId routes below -- otherwise
 *          Express would match "suggest-destinations" as a :tripId.
 */
router.post('/suggest-destinations',
    authenticate,
    TripController.suggestDestinations
);

/**
 * @route   GET /api/trips/:id
 * @desc    Get a single trip by ID
 * @access  Private
 */
router.get(
    '/:tripId',
    authenticate,
    validateTripId,
    TripController.getTripById
);

/**
 * @route   POST /api/v1/trip/:tripId/fill-leisure-time
 * @desc    Phase 7 Mode A -- fills open leisure slots on an existing
 *          trip with real Places-backed suggestions.
 * @access  Private
 */
router.post('/:tripId/fill-leisure-time',
    authenticate,
    validateTripId,
    TripController.fillLeisureTime
);

/**
 * @route   GET /api/v1/trip/:tripId/budget
 * @desc    Phase 7 -- live per-category budget tracker.
 * @access  Private
 */
router.get('/:tripId/budget',
    authenticate,
    validateTripId,
    TripController.getBudgetSummary
);

/**
 * @route   PUT /api/trips/:tripId
 * @desc    Update trip details
 * @access  Private
 *
 * Phase 0 fix: this was registered as `/:id`, but both `validateUpdateTrip`
 * and TripController.updateTrip read `req.params.tripId` — so this route
 * always 400'd on a param-name mismatch before the handler ever ran
 * (confirmed: `req.params.tripId` was always undefined here). Renamed to
 * `/:tripId` to match what the validator/controller actually read, rather
 * than changing them to match a wrong path.
 */
router.put(
    '/:tripId',
    authenticate,
    validateUpdateTrip,
    TripController.updateTrip
);

/**
 * @route   DELETE /api/trips/:tripId
 * @desc    Delete trip (soft or permanent)
 * @access  Private
 * @query   permanent=true for permanent deletion
 *
 * Phase 0 fix: same `/:id` vs `/:tripId` mismatch as PUT above —
 * TripController.deleteTrip reads `req.params.tripId`, which this route
 * never provided under the old `/:id` path.
 */
router.delete(
    '/:tripId',
    authenticate,
    validateTripId,
    TripController.deleteTrip
);

/**
 * @route   POST /api/trips/:id/packaging/regenerate
 * @desc    Refresh weather and packing list
 * @access  Private
 * @body    {
 *   activities: array (optional) - Updated activities
 *   luggageConstraints: object (optional) - Updated constraints
 * }
 */
router.post(
    '/:tripId/packaging/regenerate',
    authenticate,
    validateRegeneratePackingList,
    TripController.regeneratePackingList
);

/**
 * @route   PATCH /api/trips/:tripId/activities
 * @desc    Add/change/remove one day's activity plan and regenerate the
 *          packing list -- without resending the full activities array
 * @access  Private
 * @body    {
 *   date: string (required) - "2025-01-16"
 *   slots: array (optional) - [{ time: "morning", occasion: "hiking" }]
 *          -- omit or pass [] to clear that day's plan entirely
 * }
 */
router.patch(
    '/:tripId/activities',
    authenticate,
    validateUpdateDayActivity,
    TripController.updateDayActivity
);

/**
 * @route   GET /api/trips/:tripId/gap-recommendations
 * @desc    Phase 5 -- list this trip's gap-to-purchase funnel entries,
 *          each resolved to a purchase suggestion or an explicit
 *          "too urgent to ship" result.
 * @access  Private
 */
router.get(
    '/:tripId/gap-recommendations',
    authenticate,
    validateTripId,
    TripController.getGapRecommendations
);

// To be implemented later

// /**
//  * @route   PATCH /api/trips/:id/complete
//  * @desc    Mark trip as completed
//  * @access  Private
//  */
// router.patch(
//     '/:id/complete',
//     authenticate,
//     TripController.completeTrip
// );

// /**
//  * @route   GET /api/trips/stats
//  * @desc    Get trip statistics
//  * @access  Private
//  */
// router.get(
//     '/stats',
//     authenticate,
//     TripController.getTripStats
// );

// /**
//  * @route   GET /api/trips/upcoming
//  * @desc    Get upcoming trips (next 30 days)
//  * @access  Private
//  */
// router.get(
//     '/upcoming',
//     authenticate,
//     TripController.getUpcomingTrips
// );


// Phase 7 (PRD §3.8) -- /api/v1/trip/:tripId/activities/*
router.use('/:tripId/activities', tripActivityRoutes);

module.exports = router;