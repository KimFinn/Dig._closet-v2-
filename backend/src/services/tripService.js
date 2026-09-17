// ============================================================================
// TRIP SERVICE - Complete Business Logic Layer
// ============================================================================
// Orchestrates trip creation, packing list generation, and trip mode activation
// Separates business logic from HTTP layer for better testability
// ============================================================================

const { Trip, User } = require('../database/models');
const { packagingService } = require('./packaging.service');
const WeatherService = require('./weather.service');
const { recordGapRecommendations } = require('./gapRecommendation.service');
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

      // ✅ STEPS 4-6: Fetch weather, parse activities, generate packing
      // list -- shared with regeneratePackingList() below, so both paths
      // stay in sync instead of duplicating this logic.
      const { weatherResult, activities, packingListResult, resolvedLuggageConstraints } = await this._generateWeatherAndPackingList(userId, {
        city,
        country,
        startDate: validatedData.startDate,
        endDate: validatedData.endDate,
        activitiesInput: tripData.activities,
        luggageConstraints: tripData.luggageConstraints,
        tripType: validatedData.tripType,
        destination: validatedData.destination
      });

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
        planningMode: validatedData.planningMode,
        totalBudget: validatedData.totalBudget,
        budgetCurrency: validatedData.budgetCurrency,
        weatherSummary: weatherResult.summary,
        weatherData: weatherResult.dailyWeather,
        packingList: packingListResult,
        activities: activities.length > 0 ? activities : null,
        luggageConstraints: resolvedLuggageConstraints,
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

      // Phase 5: log any packing gaps as gap-to-purchase funnel entries.
      // Awaited (not fire-and-forget) so the funnel row exists by the
      // time this response returns, but wrapped defensively -- a
      // logging failure here should never turn into a failed trip
      // creation for the user (gapRecommendation.service already
      // catches per-gap write errors internally; this guards the outer
      // lookups too).
      if (packingListResult?.gaps?.length > 0) {
        try {
          await recordGapRecommendations(userId, trip.id, packingListResult.gaps);
        } catch (error) {
          logger.warn('Gap recommendation logging failed after trip creation', { userId, tripId: trip.id, error: error.message });
        }
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
   * ✅ REGENERATE PACKING LIST for an existing trip (Phase 3 fix)
   *
   * Previously this delegated to createTrip(), which always does a
   * Trip.create() -- every "regenerate" call left the original trip row
   * untouched and silently created a second, orphaned Trip record (never
   * referenced by anything, never cleaned up), while also being liable to
   * throw outright once the trip had already started, since
   * _validateTripData()/_validateDates() reject any startDate that's in
   * the past. This updates the existing row in place instead, matching
   * what "regenerate" actually means.
   *
   * @param {string} userId
   * @param {string} tripId
   * @param {Object} overrides - optional { activities, luggageConstraints }
   *   to use instead of the trip's stored values (e.g. the user edited
   *   the itinerary before regenerating).
   */
  async regeneratePackingList(userId, tripId, overrides = {}) {
    logger.info('Regenerating packing list', { userId, tripId });

    const trip = await Trip.findOne({ where: { id: tripId, userId } });

    if (!trip) {
      throw new Error('Trip not found');
    }

    const { city, country } = this._parseDestination(trip.destination);

    // Phase 4 fix: this used to pass only overrides.luggageConstraints,
    // which is undefined on most regenerates (the client didn't change
    // it) -- _generateWeatherAndPackingList would then fall all the way
    // back to a hardcoded tripType preset, silently discarding whatever
    // the user had actually chosen on a previous create/regenerate.
    // Falling back to the trip's own stored luggageConstraints first
    // means "the user's real choice" is what's remembered, and the
    // tripType preset is only ever used the very first time, before any
    // choice exists yet.
    const { weatherResult, activities, packingListResult, resolvedLuggageConstraints } = await this._generateWeatherAndPackingList(userId, {
      city,
      country,
      startDate: trip.startDate,
      endDate: trip.endDate,
      activitiesInput: overrides.activities || trip.activities,
      luggageConstraints: overrides.luggageConstraints || trip.luggageConstraints,
      tripType: trip.tripType,
      destination: trip.destination
    });

    await trip.update({
      weatherSummary: weatherResult.summary,
      weatherData: weatherResult.dailyWeather,
      packingList: packingListResult,
      activities: activities.length > 0 ? activities : trip.activities,
      luggageConstraints: resolvedLuggageConstraints
    });

    // If this trip is currently the user's active trip, refresh the
    // packed-items list trip mode is using too -- otherwise a
    // regenerate wouldn't actually change what recommendations draw from.
    const user = await User.findByPk(userId);
    if (user?.activeTripId === tripId && packingListResult) {
      await this._activateTripMode(userId, tripId, packingListResult, {
        startDate: trip.startDate,
        endDate: trip.endDate,
        destination: trip.destination
      });
    }

    // Phase 5: dedup'd against anything already logged for this trip --
    // see gapRecommendation.service.js for why a regenerate doesn't
    // re-suggest (or reset the funnel stage of) a gap already logged.
    if (packingListResult?.gaps?.length > 0) {
      try {
        await recordGapRecommendations(userId, tripId, packingListResult.gaps);
      } catch (error) {
        logger.warn('Gap recommendation logging failed after regenerate', { userId, tripId, error: error.message });
      }
    }

    logger.info('Packing list regenerated successfully', {
      userId,
      tripId,
      totalItems: packingListResult?.tripWardrobe?.totalItems ?? 0
    });

    return {
      trip,
      packingList: packingListResult,
      weatherSummary: weatherResult.summary,
      message: packingListResult
        ? `Packing list regenerated with ${packingListResult.tripWardrobe.totalItems} items.`
        : 'No activities to plan a packing list for -- add activities and regenerate again.'
    };
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
      const tripEnding = updateData.status === 'completed' || updateData.status === 'cancelled';
      if (user.activeTripId === tripId) {
        if (tripEnding) {
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

      // Phase 4 fix: an extended/shortened trip used to leave
      // weatherData/packingList exactly as they were for the old date
      // range -- a trip extended by three days had no weather or
      // packing guidance at all for those new days, and a shortened
      // trip kept packing guidance for days that no longer exist.
      // Regenerate through the same shared helper createTrip() and
      // regeneratePackingList() already use, scoped to whatever stored
      // activities still fall inside the new date range (an activity for
      // a day that got trimmed off is dropped, not silently kept around).
      if (!tripEnding) {
        const destination = updateData.destination || trip.destination;
        const { city, country } = this._parseDestination(destination);
        const startKey = this._toDateKey(newStartDate);
        const endKey = this._toDateKey(newEndDate);
        const activitiesInRange = (trip.activities || []).filter((a) => this._toDateKey(a.date) >= startKey && this._toDateKey(a.date) <= endKey);

        const { weatherResult, activities, packingListResult, resolvedLuggageConstraints } = await this._generateWeatherAndPackingList(userId, {
          city,
          country,
          startDate: newStartDate,
          endDate: newEndDate,
          activitiesInput: activitiesInRange,
          luggageConstraints: trip.luggageConstraints,
          tripType: updateData.tripType || trip.tripType,
          destination
        });

        updateData.weatherSummary = weatherResult.summary;
        updateData.weatherData = weatherResult.dailyWeather;
        updateData.packingList = packingListResult;
        updateData.activities = activities.length > 0 ? activities : activitiesInRange;
        updateData.luggageConstraints = resolvedLuggageConstraints;

        if (user.activeTripId === tripId && packingListResult) {
          await this._activateTripMode(userId, tripId, packingListResult, {
            startDate: newStartDate,
            endDate: newEndDate,
            destination
          });
        }

        logger.info('Packing list regenerated for changed trip dates', {
          userId, tripId, totalItems: packingListResult?.tripWardrobe?.totalItems ?? 0
        });

        // Phase 5: same dedup'd gap-recommendation logging as
        // regeneratePackingList() -- a date-change regenerate is still a
        // regenerate as far as the funnel is concerned.
        if (packingListResult?.gaps?.length > 0) {
          try {
            await recordGapRecommendations(userId, tripId, packingListResult.gaps);
          } catch (error) {
            logger.warn('Gap recommendation logging failed after trip date change', { userId, tripId, error: error.message });
          }
        }
      }
    }

    // Update trip
    await trip.update(updateData);

    logger.info('Trip updated successfully', { userId, tripId });

    return trip;
  }

  /**
   * ✅ UPDATE A SINGLE DAY'S ACTIVITIES (Phase 4)
   *
   * Lets the caller add/change/remove one day's plan (e.g. "actually
   * we're going hiking Tuesday, not a museum") without resending the
   * trip's entire `activities` array -- the client only ever needs to
   * know about the one day it's editing. Internally this still runs the
   * same full regenerate the capsule algorithm needs (a single-day
   * change can legitimately change what's reused on other days too), so
   * the simplification here is in the request contract, not a shortcut
   * in the packing logic itself.
   *
   * @param {string} userId
   * @param {string} tripId
   * @param {string} date - ISO date (YYYY-MM-DD), must fall within the trip
   * @param {Array} slots - [{time, occasion}], or [] / undefined to clear that day's plan
   */
  async updateDayActivity(userId, tripId, date, slots) {
    logger.info('Updating single-day activity', { userId, tripId, date });

    const trip = await Trip.findOne({ where: { id: tripId, userId } });
    if (!trip) {
      throw new Error('Trip not found');
    }

    const dateKey = this._toDateKey(date);
    const startKey = this._toDateKey(trip.startDate);
    const endKey = this._toDateKey(trip.endDate);

    if (dateKey < startKey || dateKey > endKey) {
      throw new Error(`Date ${dateKey} is outside this trip's range (${startKey} to ${endKey})`);
    }

    const otherDays = (trip.activities || []).filter((a) => this._toDateKey(a.date) !== dateKey);
    const hasSlots = Array.isArray(slots) && slots.length > 0;
    const updatedActivities = hasSlots
      ? [...otherDays, { date: dateKey, slots }]
      : otherDays; // no slots -- clearing this day's plan entirely

    const result = await this.regeneratePackingList(userId, tripId, { activities: updatedActivities });

    logger.info('Single-day activity updated, packing list regenerated', {
      userId, tripId, date: dateKey, cleared: !hasSlots
    });

    return result;
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
          // Fix: Trip.belongsTo(User, ...) is defined with no explicit
          // `as`, so Sequelize defaults the alias to the model name
          // 'User' (capitalized), not 'user'. The mismatched alias here
          // threw a Sequelize error on every call, which in turn crashed
          // the whole server via the missing `next` param in
          // trip.controller.js#getTripById (fixed alongside this).
          model: User,
          as: 'User',
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
      companions: data.companions ? parseInt(data.companions) : 1,
      // Phase 7 (PRD §3.8/§3.15) -- see trip.validation.js's comment on
      // the same fields for why these need to be threaded through here.
      planningMode: data.planningMode || null,
      totalBudget: data.totalBudget != null ? parseFloat(data.totalBudget) : null,
      budgetCurrency: data.budgetCurrency || (data.totalBudget != null ? 'USD' : null)
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
   * Shared by createTrip() and regeneratePackingList(): fetch weather,
   * parse activities, and generate the capsule packing list. Pulled out
   * so both callers stay in sync instead of duplicating this sequence
   * (regeneratePackingList used to just re-call createTrip(), which is
   * what caused the duplicate-trip bug this was extracted to fix).
   */
  async _generateWeatherAndPackingList(userId, { city, country, startDate, endDate, activitiesInput, luggageConstraints, tripType, destination }) {
    logger.info('Fetching weather data', { city, country, startDate, endDate });
    const weatherResult = await this._fetchTripWeather(city, country, startDate, endDate);

    const durationDays = this._calculateDuration(startDate, endDate);
    const activities = this._parseActivities(activitiesInput, startDate, durationDays);

    // Phase 4: luggage/bag preference promoted to a persisted trip input.
    // Whatever constraints actually get used here -- an explicit
    // override, or (now) the trip's own remembered choice, falling back
    // to the tripType preset only when neither exists yet -- are handed
    // back to the caller so it can save them on the trip row instead of
    // discarding the resolution on every call.
    const resolvedLuggageConstraints = luggageConstraints || this._getDefaultLuggageConstraints(tripType);

    let packingListResult = null;
    if (activities.length > 0) {
      logger.info('Generating packing list', { userId, activities: activities.length });

      packingListResult = await packagingService.generatePackingList({
        userId,
        dates: this._generateDateArray(startDate, endDate),
        activities,
        destination,
        luggageConstraints: resolvedLuggageConstraints,
        weatherData: weatherResult.dailyWeather
      });

      logger.info('Packing list generated', {
        totalItems: packingListResult.tripWardrobe.totalItems,
        outfits: packingListResult.dailyGuide.length
      });
    }

    return { weatherResult, activities, packingListResult, resolvedLuggageConstraints };
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
        // Phase 4 fix: normalize whatever date format arrives here (a
        // plain "2025-01-15", or a full ISO timestamp from an older
        // client, a stored trip.activities row, or -- before the
        // validation-layer fix -- Joi's own isoDate() reformatting) down
        // to the plain YYYY-MM-DD key every other date-keyed structure
        // in this codebase uses (weatherData, weatherByDate lookups,
        // forecast-accuracy rows). A mismatched format here silently
        // means "this day's weather is never found" downstream.
        date: this._toDateKey(activity.date),
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
   * Normalize any date-ish input (plain "YYYY-MM-DD", a full ISO
   * timestamp, or a Date object) to the plain YYYY-MM-DD key every
   * date-keyed structure in this codebase uses.
   */
  _toDateKey(date) {
    return new Date(date).toISOString().split('T')[0];
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