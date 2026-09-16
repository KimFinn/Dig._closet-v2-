// ============================================================================
// TRIP SERVICE - Complete Business Logic Layer
// ============================================================================
// Orchestrates trip creation, packing list generation, and trip mode activation
// Separates business logic from HTTP layer for better testability
// ============================================================================

const { Trip, User } = require('../database/models');
const { packagingService } = require('./packaging.service');
const WeatherService = require('./weather.service');
const logger = require('../utils/logger');

class TripService {
  
  /**
   * ✅ CREATE TRIP - Main orchestration method
   * 
   * @param {string} userId - User ID
   * @param {Object} tripData - Trip details from request body
   * @returns {Object} Created trip with packing list
   */
  async createTrip(userId, tripData) {
    logger.info('Creating trip', { userId, destination: tripData.destination });

    try {
      // ✅ STEP 1: Validate and parse input
      const validatedData = this._validateTripData(tripData);
      
      // ✅ STEP 2: Parse destination
      const { city, country } = this._parseDestination(validatedData.destination);
      
      // ✅ STEP 3: Calculate trip duration
      const durationDays = this._calculateDuration(validatedData.startDate, validatedData.endDate);
      
      // ✅ STEP 4: Fetch multi-day weather
      logger.info('Fetching weather data', { city, country, days: durationDays });
      const weatherResult = await this._fetchTripWeather(
        city, 
        country, 
        validatedData.startDate, 
        validatedData.endDate
      );

      // ✅ STEP 5: Parse activities per day
      const activities = this._parseActivities(
        tripData.activities,
        validatedData.startDate,
        durationDays
      );

      // ✅ STEP 6: Generate packing list (if activities provided)
      let packingListResult = null;
      if (activities.length > 0) {
        logger.info('Generating packing list', { userId, activities: activities.length });
        
        packingListResult = await packagingService.generatePackingList({
          userId,
          dates: this._generateDateArray(validatedData.startDate, validatedData.endDate),
          activities,
          destination: validatedData.destination,
          luggageConstraints: tripData.luggageConstraints || this._getDefaultLuggageConstraints(tripData.tripType),
          weatherData: weatherResult.dailyWeather
        });

        logger.info('Packing list generated', { 
          totalItems: packingListResult.tripWardrobe.totalItems,
          outfits: packingListResult.dailyGuide.length 
        });
      }

      // ✅ STEP 7: Determine trip status
      const status = this._determineTripStatus(validatedData.startDate, validatedData.endDate);

      // ✅ STEP 8: Create trip record in database
      const trip = await Trip.create({
        userId,
        destination: validatedData.destination.trim(),
        city: city?.trim(),
        country: country?.trim(),
        startDate: validatedData.startDate,
        endDate: validatedData.endDate,
        durationDays,
        purpose: validatedData.purpose || 'leisure',
        tripType: validatedData.tripType,
        budget: validatedData.budget,
        accommodation: validatedData.accommodation,
        transportation: validatedData.transportation,
        weatherSummary: weatherResult.summary,
        weatherData: weatherResult.dailyWeather,
        packingList: packingListResult,
        activities: activities.length > 0 ? activities : null,
        notes: validatedData.notes,
        companions: validatedData.companions || 1,
        status,
        isActive: true
      });

      logger.info('Trip created successfully', { 
        tripId: trip.id, 
        userId, 
        destination: validatedData.destination 
      });

      // ✅ STEP 9: If trip starts today, activate trip mode immediately
      if (status === 'active' && packingListResult) {
        await this._activateTripMode(userId, trip.id, packingListResult, validatedData);
      }

      return {
        trip,
        packingList: packingListResult,
        weatherSummary: weatherResult.summary,
        message: this._getTripCreationMessage(status, packingListResult)
      };

    } catch (error) {
      logger.error('Failed to create trip', { 
        userId, 
        error: error.message,
        stack: error.stack 
      });
      throw error;
    }
  }

  /**
   * ✅ UPDATE TRIP
   */
  async updateTrip(userId, tripId, updateData) {
    logger.info('Updating trip', { userId, tripId });

    const trip = await Trip.findOne({ where: { id: tripId, userId } });
    
    if (!trip) {
      throw new Error('Trip not found');
    }

    // If dates changed, recalculate weather and packing
    const datesChanged = updateData.startDate || updateData.endDate;
    
    if (datesChanged) {
      const newStartDate = updateData.startDate ? new Date(updateData.startDate) : trip.startDate;
      const newEndDate = updateData.endDate ? new Date(updateData.endDate) : trip.endDate;
      
      // Validate new dates
      this._validateDates(newStartDate, newEndDate);
      
      // Recalculate duration
      updateData.durationDays = this._calculateDuration(newStartDate, newEndDate);
      
      // Update status
      updateData.status = this._determineTripStatus(newStartDate, newEndDate);
      
      // If trip is active or was active, update trip mode
      const user = await User.findByPk(userId);
      if (user.activeTripId === tripId) {
        if (updateData.status === 'completed' || updateData.status === 'cancelled') {
          // Deactivate trip mode
          await user.deactivateTrip();
          logger.info('Trip mode deactivated due to trip update', { userId, tripId });
        } else {
          // Update trip dates in user model
          user.tripStartDate = newStartDate;
          user.tripEndDate = newEndDate;
          await user.save();
        }
      }
    }

    // Update trip
    await trip.update(updateData);

    logger.info('Trip updated successfully', { userId, tripId });

    return trip;
  }

  /**
   * ✅ CANCEL TRIP
   */
  async cancelTrip(userId, tripId) {
    logger.info('Cancelling trip', { userId, tripId });

    const trip = await Trip.findOne({ where: { id: tripId, userId } });
    
    if (!trip) {
      throw new Error('Trip not found');
    }

    // Update trip status
    await trip.update({ 
      status: 'cancelled',
      isActive: false 
    });

    // If this trip is currently active in trip mode, deactivate it
    const user = await User.findByPk(userId);
    if (user.activeTripId === tripId) {
      await user.deactivateTrip();
      logger.info('Trip mode deactivated due to cancellation', { userId, tripId });
    }

    logger.info('Trip cancelled successfully', { userId, tripId });

    return trip;
  }

  /**
   * ✅ GET TRIP DETAILS
   */
  async getTripById(userId, tripId) {
    const trip = await Trip.findOne({ 
      where: { id: tripId, userId },
      include: [
        { 
          model: User, 
          as: 'user',
          attributes: ['id', 'fullName', 'email'] 
        }
      ]
    });
    
    if (!trip) {
      throw new Error('Trip not found');
    }

    return trip;
  }

  /**
   * ✅ GET USER'S TRIPS
   */
  async getUserTrips(userId, filters = {}) {
    const where = { userId };

    // Apply filters
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    const trips = await Trip.findAll({
      where,
      order: [['startDate', 'DESC']],
      limit: filters.limit || 50
    });

    return trips;
  }

  /**
   * ✅ GET ACTIVE TRIP (currently ongoing)
   */
  async getActiveTrip(userId) {
    const user = await User.findByPk(userId);
    
    if (!user.activeTripId) {
      return null;
    }

    return await this.getTripById(userId, user.activeTripId);
  }

  // ==========================================================================
  // PRIVATE HELPER METHODS
  // ==========================================================================

  /**
   * Validate trip data
   */
  _validateTripData(data) {
    const { destination, startDate, endDate } = data;

    if (!destination || !startDate || !endDate) {
      throw new Error('Destination, start date, and end date are required');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    this._validateDates(start, end);

    return {
      destination,
      startDate: start,
      endDate: end,
      purpose: data.purpose,
      tripType: data.tripType,
      budget: data.budget ? parseFloat(data.budget) : null,
      accommodation: data.accommodation,
      transportation: data.transportation,
      notes: data.notes,
      companions: data.companions ? parseInt(data.companions) : 1
    };
  }

  /**
   * Validate dates
   */
  _validateDates(start, end) {
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('Invalid date format');
    }

    const now = new Date();
    now.setHours(0, 0, 0, 0); // Start of today

    if (start < now) {
      throw new Error('Start date cannot be in the past');
    }

    if (end <= start) {
      throw new Error('End date must be after start date');
    }

    // Maximum trip duration: 90 days
    const maxDuration = 90;
    const duration = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    if (duration > maxDuration) {
      throw new Error(`Trip duration cannot exceed ${maxDuration} days`);
    }
  }

  /**
   * Parse destination into city and country
   */
  _parseDestination(destination) {
    let city = destination;
    let country = null;

    if (destination.includes(',')) {
      [city, country] = destination.split(',').map(x => x.trim());
    }

    return { city, country };
  }

  /**
   * Calculate trip duration in days
   */
  _calculateDuration(startDate, endDate) {
    return Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  }

  /**
   * Fetch multi-day weather forecast
   */
  async _fetchTripWeather(city, country, startDate, endDate) {
    if (!city || !country) {
      return {
        summary: 'Weather data unavailable - destination not specific enough',
        dailyWeather: []
      };
    }

    try {
      // Use multi-day weather service
      const weatherData = await WeatherService.getMultiDayWeatherForTrip(city, country, startDate, endDate);
      
      const summary = this._generateWeatherSummary(weatherData, startDate, endDate);

      return {
        summary,
        dailyWeather: weatherData
      };

    } catch (error) {
      logger.warn('Failed to fetch trip weather', { 
        city, 
        country, 
        error: error.message 
      });

      return {
        summary: 'Weather data unavailable',
        dailyWeather: []
      };
    }
  }

  /**
   * Generate weather summary
   */
  _generateWeatherSummary(weatherData, startDate, endDate) {
    if (!weatherData || weatherData.length === 0) {
      return 'Weather data unavailable';
    }

    const temps = weatherData.map(w => w.temp);
    const avgTemp = Math.round(temps.reduce((a, b) => a + b, 0) / temps.length);
    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);

    const conditions = weatherData.map(w => w.condition);
    const commonCondition = this._getMostCommon(conditions);

    return `${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}: Avg ${avgTemp}°C (${minTemp}-${maxTemp}°C), mostly ${commonCondition}`;
  }

  /**
   * Parse activities from request
   */
  _parseActivities(activitiesInput, startDate, durationDays) {
    // activitiesInput can be:
    // 1. Array of activity objects per day
    // 2. Simple array of occasions (apply to all days)
    // 3. null/undefined (return empty array)

    if (!activitiesInput || activitiesInput.length === 0) {
      return [];
    }

    const activities = [];
    const dates = this._generateDateArray(startDate, durationDays);

    // If activities is array of objects with 'date' field
    if (activitiesInput[0]?.date) {
      return activitiesInput.map(activity => ({
        date: activity.date,
        slots: activity.slots || [{ time: 'all-day', occasion: activity.occasion || 'casual' }]
      }));
    }

    // If activities is simple array of occasions, apply to all days
    for (const date of dates) {
      const dayActivities = {
        date,
        slots: []
      };

      for (const activity of activitiesInput) {
        if (typeof activity === 'string') {
          // Simple occasion string
          dayActivities.slots.push({
            time: 'all-day',
            occasion: activity
          });
        } else if (activity.occasion) {
          // Activity object
          dayActivities.slots.push({
            time: activity.time || 'all-day',
            occasion: activity.occasion
          });
        }
      }

      if (dayActivities.slots.length > 0) {
        activities.push(dayActivities);
      }
    }

    return activities;
  }

  /**
   * Generate array of date strings
   */
  _generateDateArray(startDate, endDateOrDays) {
    const dates = [];
    const start = new Date(startDate);
    
    let days;
    if (typeof endDateOrDays === 'number') {
      days = endDateOrDays;
    } else {
      days = this._calculateDuration(startDate, endDateOrDays);
    }

    for (let i = 0; i < days; i++) {
      const date = new Date(start);
      date.setDate(date.getDate() + i);
      dates.push(date.toISOString().split('T')[0]);
    }

    return dates;
  }

  /**
   * Get default luggage constraints based on trip type
   */
  _getDefaultLuggageConstraints(tripType) {
    const constraints = {
      'business': { type: 'carry-on', maxItems: 15 },
      'weekend': { type: 'carry-on', maxItems: 12 },
      'backpacking': { type: 'backpack', maxItems: 10 },
      'vacation': { type: 'checked-luggage', maxItems: 25 },
      'adventure': { type: 'backpack', maxItems: 15 }
    };

    return constraints[tripType] || { type: 'carry-on', maxItems: 20 };
  }

  /**
   * Determine trip status
   */
  _determineTripStatus(startDate, endDate) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    if (now < start) return 'upcoming';
    if (now > end) return 'completed';
    return 'active';
  }

  /**
   * Activate trip mode for user
   */
  async _activateTripMode(userId, tripId, packingListResult, tripData) {
    const user = await User.findByPk(userId);
    
    if (!user) {
      throw new Error('User not found');
    }

    const packedItemIds = packingListResult.tripWardrobe.items;

    await user.activateTrip(
      tripId,
      tripData.startDate,
      tripData.endDate,
      packedItemIds,
      tripData.destination
    );

    logger.info('Trip mode activated', { 
      userId, 
      tripId, 
      itemsPacked: packedItemIds.length 
    });
  }

  /**
   * Get trip creation success message
   */
  _getTripCreationMessage(status, packingListResult) {
    const messages = [];

    if (status === 'active') {
      messages.push('Trip is active! Trip mode enabled - outfit recommendations will use your packed items.');
    } else {
      messages.push('Trip created successfully!');
    }

    if (packingListResult) {
      messages.push(`Packing list generated with ${packingListResult.tripWardrobe.totalItems} items.`);
    }

    return messages.join(' ');
  }

  /**
   * Get most common item in array
   */
  _getMostCommon(arr) {
    const counts = {};
    arr.forEach(item => {
      counts[item] = (counts[item] || 0) + 1;
    });

    return Object.keys(counts).reduce((a, b) => 
      counts[a] > counts[b] ? a : b
    );
  }
}

// ============================================================================
// EXPORT SINGLETON
// ============================================================================

const tripService = new TripService();

module.exports = {
  tripService,
  TripService
};