const express = require('express');
const router = express.Router();
const TripController = require('../controllers/trip.controller');
const { authenticateUser } = require('../middleware/auth');
const { body } = require('express-validator');
const {
  validateCreateTrip,
  validateUpdateTrip,
  validateTripId,
  validateGetTrips,
  validateRegeneratePackingList
} = require('../middleware/trip.validation');


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
    authenticateUser,
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
    authenticateUser,
    validateGetTrips,
    TripController.getUserTrips
);

/**
 * @route  GET/api/trips/active
 * @desc et the currently active trips if any
 * @access Private
 */
router.get('/active',
    authenticateUser,
    TripController.getActiveTrip
);

/**
 * @route   GET /api/trips/:id
 * @desc    Get a single trip by ID
 * @access  Private
 */
router.get(
    '/:tripId',
    authenticateUser,
    validateTripId,
    TripController.getTripById
);

/**
 * @route   PUT /api/trips/:id
 * @desc    Update trip details
 * @access  Private
 */
router.put(
    '/:id',
    authenticateUser,
    validateUpdateTrip,
    TripController.updateTrip
);

/**
 * @route   DELETE /api/trips/:id
 * @desc    Delete trip (soft or permanent)
 * @access  Private
 * @query   permanent=true for permanent deletion
 */
router.delete(
    '/:id',
    authenticateUser,
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
    authenticateUser,
    validateRegeneratePackingList,
    TripController.regeneratePackingList
);

// To be implemented later

// /**
//  * @route   PATCH /api/trips/:id/complete
//  * @desc    Mark trip as completed
//  * @access  Private
//  */
// router.patch(
//     '/:id/complete',
//     authenticateUser,
//     TripController.completeTrip
// );

// /**
//  * @route   GET /api/trips/stats
//  * @desc    Get trip statistics
//  * @access  Private
//  */
// router.get(
//     '/stats',
//     authenticateUser,
//     TripController.getTripStats
// );

// /**
//  * @route   GET /api/trips/upcoming
//  * @desc    Get upcoming trips (next 30 days)
//  * @access  Private
//  */
// router.get(
//     '/upcoming',
//     authenticateUser,
//     TripController.getUpcomingTrips
// );


module.exports = router;