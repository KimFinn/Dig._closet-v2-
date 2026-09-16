// ============================================================================
// TRIP MODE MANAGER - Automated Trip Activation/Deactivation
// ============================================================================
// Background job that runs daily to:
// 1. Activate trips that start today
// 2. Deactivate trips that ended yesterday
// ============================================================================

const cron = require('node-cron');
const { User, Trip } = require('../database/models');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

class TripModeManager {
  constructor() {
    this.isRunning = false;
    this.cronJob = null;
  }

  /**
   * ✅ START TRIP MODE MANAGER
   * Runs daily at midnight
   */
  start() {
    if (this.isRunning) {
      logger.warn('Trip mode manager already running');
      return;
    }

    // Run daily at 00:01 (1 minute past midnight)
    this.cronJob = cron.schedule('1 0 * * *', async () => {
      logger.info('Trip mode manager: Running daily check');
      await this.runDailyCheck();
    });

    this.isRunning = true;
    logger.info('Trip mode manager started (runs daily at 00:01)');

    // Also run immediately on startup to catch any missed trips
    this.runDailyCheck();
  }

  /**
   * ✅ STOP TRIP MODE MANAGER
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.isRunning = false;
      logger.info('Trip mode manager stopped');
    }
  }

  /**
   * ✅ RUN DAILY CHECK
   * Main logic for activating/deactivating trips
   */
  async runDailyCheck() {
    try {
      const today = new Date().toISOString().split('T')[0];
      logger.info('Trip mode check starting', { date: today });

      // ✅ STEP 1: Activate trips starting today
      const activatedCount = await this.activateTripsStartingToday(today);

      // ✅ STEP 2: Deactivate trips that ended
      const deactivatedCount = await this.deactivateEndedTrips(today);

      // ✅ STEP 3: Update trip statuses
      const updatedCount = await this.updateTripStatuses(today);

      logger.info('Trip mode check completed', {
        date: today,
        activated: activatedCount,
        deactivated: deactivatedCount,
        updated: updatedCount
      });

    } catch (error) {
      logger.error('Trip mode check failed', {
        error: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * ✅ ACTIVATE TRIPS STARTING TODAY
   */
  async activateTripsStartingToday(today) {
    try {
      // Find trips that:
      // 1. Start today
      // 2. Are not cancelled
      // 3. Have packing lists
      // 4. User is not already on another trip
      
      const tripsToActivate = await Trip.findAll({
        where: {
          startDate: today,
          status: { [Op.ne]: 'cancelled' },
          isActive: true,
          packingList: { [Op.ne]: null }
        },
        include: [{
          model: User,
          as: 'user',
          where: {
            activeTripId: null // User not already on a trip
          }
        }]
      });

      let activatedCount = 0;

      for (const trip of tripsToActivate) {
        try {
          const user = trip.user;
          const packedItemIds = trip.packingList?.tripWardrobe?.items || [];

          if (packedItemIds.length === 0) {
            logger.warn('Trip has no packed items, skipping activation', {
              tripId: trip.id,
              userId: user.id
            });
            continue;
          }

          // Activate trip mode
          await user.activateTrip(
            trip.id,
            trip.startDate,
            trip.endDate,
            packedItemIds,
            trip.destination
          );

          // Update trip status
          await trip.update({ status: 'active' });

          activatedCount++;

          logger.info('Trip activated', {
            tripId: trip.id,
            userId: user.id,
            destination: trip.destination,
            itemsPacked: packedItemIds.length
          });

        } catch (error) {
          logger.error('Failed to activate trip', {
            tripId: trip.id,
            error: error.message
          });
        }
      }

      return activatedCount;

    } catch (error) {
      logger.error('Error activating trips', { error: error.message });
      return 0;
    }
  }

  /**
   * ✅ DEACTIVATE ENDED TRIPS
   */
  async deactivateEndedTrips(today) {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      // Find users with active trips that ended yesterday or before
      const users = await User.findAll({
        where: {
          activeTripId: { [Op.ne]: null },
          tripEndDate: { [Op.lt]: today } // Trip ended before today
        },
        include: [{
          model: Trip,
          as: 'activeTrip',
          required: false
        }]
      });

      let deactivatedCount = 0;

      for (const user of users) {
        try {
          const tripId = user.activeTripId;

          // Deactivate trip mode
          await user.deactivateTrip();

          // Update trip status to completed
          if (user.activeTrip) {
            await user.activeTrip.update({ status: 'completed' });
          } else {
            // Fallback: update trip directly if association not loaded
            await Trip.update(
              { status: 'completed' },
              { where: { id: tripId } }
            );
          }

          deactivatedCount++;

          logger.info('Trip deactivated', {
            tripId,
            userId: user.id,
            endDate: user.tripEndDate
          });

        } catch (error) {
          logger.error('Failed to deactivate trip', {
            userId: user.id,
            error: error.message
          });
        }
      }

      return deactivatedCount;

    } catch (error) {
      logger.error('Error deactivating trips', { error: error.message });
      return 0;
    }
  }

  /**
   * ✅ UPDATE TRIP STATUSES
   * Update upcoming/active/completed statuses
   */
  async updateTripStatuses(today) {
    try {
      let updatedCount = 0;

      // Update upcoming → active (for trips without packing lists)
      const upcomingToActive = await Trip.update(
        { status: 'active' },
        {
          where: {
            startDate: { [Op.lte]: today },
            endDate: { [Op.gte]: today },
            status: 'upcoming',
            isActive: true
          }
        }
      );
      updatedCount += upcomingToActive[0];

      // Update active → completed (for trips that ended)
      const activeToCompleted = await Trip.update(
        { status: 'completed' },
        {
          where: {
            endDate: { [Op.lt]: today },
            status: 'active',
            isActive: true
          }
        }
      );
      updatedCount += activeToCompleted[0];

      return updatedCount;

    } catch (error) {
      logger.error('Error updating trip statuses', { error: error.message });
      return 0;
    }
  }

  /**
   * ✅ MANUAL TRIGGER (for testing or admin actions)
   */
  async manualActivateTrip(tripId) {
    try {
      const trip = await Trip.findByPk(tripId, {
        include: [{ model: User, as: 'user' }]
      });

      if (!trip) {
        throw new Error('Trip not found');
      }

      if (trip.status === 'cancelled') {
        throw new Error('Cannot activate cancelled trip');
      }

      const user = trip.user;
      const packedItemIds = trip.packingList?.tripWardrobe?.items || [];

      if (packedItemIds.length === 0) {
        throw new Error('Trip has no packed items');
      }

      if (user.activeTripId && user.activeTripId !== tripId) {
        throw new Error('User already has an active trip');
      }

      await user.activateTrip(
        trip.id,
        trip.startDate,
        trip.endDate,
        packedItemIds,
        trip.destination
      );

      await trip.update({ status: 'active' });

      logger.info('Trip manually activated', {
        tripId: trip.id,
        userId: user.id
      });

      return trip;

    } catch (error) {
      logger.error('Manual trip activation failed', {
        tripId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * ✅ MANUAL DEACTIVATE (for testing or admin actions)
   */
  async manualDeactivateTrip(tripId) {
    try {
      const trip = await Trip.findByPk(tripId, {
        include: [{ model: User, as: 'user' }]
      });

      if (!trip) {
        throw new Error('Trip not found');
      }

      const user = trip.user;

      if (user.activeTripId !== tripId) {
        throw new Error('Trip is not currently active');
      }

      await user.deactivateTrip();
      await trip.update({ status: 'completed' });

      logger.info('Trip manually deactivated', {
        tripId: trip.id,
        userId: user.id
      });

      return trip;

    } catch (error) {
      logger.error('Manual trip deactivation failed', {
        tripId,
        error: error.message
      });
      throw error;
    }
  }
}

// ============================================================================
// EXPORT SINGLETON
// ============================================================================

const tripModeManager = new TripModeManager();

module.exports = {
  tripModeManager,
  TripModeManager
};

// ============================================================================
// USAGE IN YOUR APP
// ============================================================================

/*
// In your main app.js or server.js:

const { tripModeManager } = require('./services/tripModeManager.service');

// Start the manager when server starts
tripModeManager.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  tripModeManager.stop();
  // ... other cleanup
});
*/