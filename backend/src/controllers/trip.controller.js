const {tripService} = require('../services/tripService');
const logger = require('../utils/logger');
const { validationResult } = require('express-validator');

class TripController {
/**
     * Create a new trip
     * @route POST /api/trips
     */
      static async createTrip(req, res,next) {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ success: false,message:"Validation failed", errors: errors.array() });
        }
      const userId = req.user.id;

      //Call trip service
      const result = await tripService.createTrip(userId, req.body);

      res.status(201).json({
        success : true,
        message: result.message,
        data: {
            trip: result.trip,
            packagingList: result.packagingList,
            weatherSummary: result.weatherSummary
        }
      });

    
    } catch (error) {
     logger.error("Error creating trip", {
        error: error.message,
        stack: error.stack,
        userId: req.user?.id,
     });
     next(error);
    }
  }

/**
     * Get all trips for logged-in user with filtering and pagination
     * @route GET /api/trips
     */
      static async getUserTrips(req, res, next) {
        try {
            const userId = req.user.id;
           
            const filters = {
                status: req.query.status,
                isActive: req.query.isActive !== undefined
                ? req.query.isActive === "true"
                : undefined,
                limit: req.query.limit ? parseInt(req.query.limit) : undefined
            };

            const trips = await tripService.getUserTrips(userId,filters);

            res.status(200).json({
                success: true,
                data: {
                    trips,
                    count: trips.length
            }
            });
        } catch (error) {
        logger.error('Error fetching user trip:', {
            error: error.message,
            userId : req.user?.id
        });
        next();
        }
  }

 /**
     * Get a single trip by ID
     * @route GET /api/trips/:id
     */
  static async getTripById(req, res) {
    try {
        const {tripId} = req.params;
        const userId = req.user.id;

        if(!tripId) {
            return res.status(400).json({
                success : false,
                message : 'Trip Id is required'
            });
        }

        const trip = await tripService.getTripById(userId,tripId);

        res.status(200).json({
            success:true,
            data: {trip}
        });
    } catch (error) {
         if (error.message === 'Trip not found'){
            return res.status(404).json({
                success : false,
                message: error.message
            })
        }

        logger.error("Error fetching trip:", {
            error: error.message,
            tripId:req.params.id,
            userId: req.user?.id
        })
        next(error);
    }
  }

   /**
     * Update trip details
     * @route PUT /api/trips/:id
     */

  static async updateTrip(req, res,next) {
    try {
        const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ 
          success: false,
          message: "Validation failed", 
          errors: errors.array() 
        });
      }
        const {tripId} = req.params;
        const userId = req.user.id;

        if(!tripId) {
            return res.status(400).json({
                success:false,
                message: 'Trip ID is required'
            });
        }

        //Call trip service
        const trip = await tripService.updateTrip(userId,tripId,req.body);

            res.status(200).json({
                success: true,
                message: 'Trip updated successfully',
                data: { trip }
            });
    } catch (error) {
        if (error.message === 'Trip not found'){
            return res.status(404).json({
                success : false,
                message: error.message
            })
        }
        logger.error('Error updating trip:',{
            error:error.message,
            tripId:req.params?.id,
            userId: req.user?.id
        });
        next(error);
    }
  }

  /**
     * Delete trip (soft or permanent)
     * @route DELETE /api/trips/:id
     */
  static async deleteTrip(req, res,next) {
    try {
        const { tripId } = req.params;
        const userId = req.user.id;


        if (!tripId) {
                return res.status(400).json({
                    success: false,
                    message: 'Trip ID is required'
                });
            }

        const trip = await tripService.cancelTrip(userId,tripId)

                return res.status(200).json({
                    success: true,
                    message: 'Trip archived successfully',
                    data : {trip}
                });
    } catch (error) {
        if (error.message === 'Trip not found'){
                return res.status(404).json({
                success : false,
                message: error.message
            })
        }

        logger.error('Error deleting trip:', {
                error: error.message,
                tripId: req.params.id,
                userId: req.user?.id
            });
            next(error);
        }
  }

  /**
   *  GET ACTIVE TRIP (currently ongoing)
   * @route GET /api/trips/active
   */
  static async getActiveTrip(req, res, next) {
    try {
      const userId = req.user.id;

      const trip = await tripService.getActiveTrip(userId);

      if (!trip) {
        return res.status(200).json({
          success: true,
          message: "No active trip",
          data: { trip: null }
        });
      }

      res.status(200).json({
        success: true,
        data: { trip }
      });

    } catch (error) {
      logger.error('Get active trip error', {
        error: error.message,
        userId: req.user?.id
      });
      next(error);
    }
  }
/**
   * ✅ REGENERATE PACKING LIST
   * @route POST /api/trips/:tripId/packing/regenerate
   */
  static async regeneratePackingList(req, res, next) {
    try {
      const userId = req.user.id;
      const { tripId } = req.params;

      // Get trip
      const trip = await tripService.getTripById(userId, tripId);

      // Regenerate packing list with potentially updated activities
      const newActivities = req.body.activities || trip.activities;
      
      const result = await tripService.createTrip(userId, {
        destination: trip.destination,
        startDate: trip.startDate,
        endDate: trip.endDate,
        purpose: trip.purpose,
        tripType: trip.tripType,
        activities: newActivities,
        luggageConstraints: req.body.luggageConstraints
      });

      // Update trip with new packing list
      await tripService.updateTrip(userId, tripId, {
        packingList: result.packingList
      });

      res.status(200).json({
        success: true,
        message: "Packing list regenerated successfully",
        data: {
          packingList: result.packingList
        }
      });

    } catch (error) {
      logger.error('Regenerate packing list error', {
        error: error.message,
        userId: req.user?.id,
        tripId: req.params?.tripId
      });
      next(error);
    }
  }

  // To be impemented if  neccesary
  
    // /**
    //  * Get trip statistics for user
    //  * @route GET /api/trips/stats
    //  */
    // static async getTripStats(req, res, next) {
    //     try {
    //         const userId = req.user.id;
    //         const now = new Date();

    //         const [
    //             totalTrips,
    //             upcomingTrips,
    //             activeTrips,
    //             completedTrips,
    //             totalDays,
    //             uniqueDestinations
    //         ] = await Promise.all([
    //             Trip.count({ where: { userId, isActive: true } }),
    //             Trip.count({
    //                 where: {
    //                     userId,
    //                     isActive: true,
    //                     startDate: { [Op.gt]: now }
    //                 }
    //             }),
    //             Trip.count({
    //                 where: {
    //                     userId,
    //                     isActive: true,
    //                     status: 'active'
    //                 }
    //             }),
    //             Trip.count({
    //                 where: {
    //                     userId,
    //                     isActive: true,
    //                     status: 'completed'
    //                 }
    //             }),
    //             Trip.sum('durationDays', {
    //                 where: { userId, isActive: true }
    //             }),
    //             Trip.findAll({
    //                 where: { userId, isActive: true },
    //                 attributes: ['destination'],
    //                 group: ['destination']
    //             })
    //         ]);

    //         const stats = {
    //             total: totalTrips,
    //             upcoming: upcomingTrips,
    //             active: activeTrips,
    //             completed: completedTrips,
    //             totalDaysTraveled: totalDays || 0,
    //             uniqueDestinations: uniqueDestinations.length,
    //             averageTripDuration: totalTrips > 0 ? Math.round((totalDays || 0) / totalTrips) : 0
    //         };

    //         res.status(200).json({
    //             success: true,
    //             data: { stats }
    //         });

    //     } catch (error) {
    //         logger.error('Error getting trip stats:', {
    //             error: error.message,
    //             userId: req.user?.id
    //         });
    //         next(error);
    //     }
    // }

    // /**
    //  * Get upcoming trips (next 30 days)
    //  * @route GET /api/trips/upcoming
    //  */
    // static async getUpcomingTrips(req, res, next) {
    //     try {
    //         const userId = req.user.id;
    //         const now = new Date();
    //         const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    //         const trips = await Trip.findAll({
    //             where: {
    //                 userId,
    //                 isActive: true,
    //                 startDate: {
    //                     [Op.between]: [now, thirtyDaysFromNow]
    //                 }
    //             },
    //             order: [['startDate', 'ASC']]
    //         });

    //         res.status(200).json({
    //             success: true,
    //             data: { trips }
    //         });

    //     } catch (error) {
    //         logger.error('Error getting upcoming trips:', {
    //             error: error.message,
    //             userId: req.user?.id
    //         });
    //         next(error);
    //     }
    // }

    // /**
    //  * Mark trip as completed
    //  * @route PATCH /api/trips/:id/complete
    //  */
    // static async completeTrip(req, res, next) {
    //     try {
    //         const { id } = req.params;
    //         const userId = req.user.id;

    //         const trip = await Trip.findOne({
    //             where: { id, userId }
    //         });

    //         if (!trip) {
    //             return res.status(404).json({
    //                 success: false,
    //                 message: "Trip not found"
    //             });
    //         }

    //         await trip.markAsCompleted();

    //         logger.info('Trip marked as completed', {
    //             userId,
    //             tripId: id
    //         });

    //         res.status(200).json({
    //             success: true,
    //             message: 'Trip marked as completed',
    //             data: { trip }
    //         });

    //     } catch (error) {
    //         logger.error('Error completing trip:', {
    //             error: error.message,
    //             tripId: req.params.id,
    //             userId: req.user?.id
    //         });
    //         next(error);
    //     }
    // }
}


module.exports = TripController;
