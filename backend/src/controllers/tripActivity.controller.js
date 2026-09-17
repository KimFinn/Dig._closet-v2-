/**
 * TripActivity HTTP layer -- Phase 7 (PRD §3.8). Thin controller over
 * tripActivity.service.js, mounted under /api/v1/trip/:tripId/activities.
 */

const {
  createActivity,
  listActivitiesForTrip,
  getActivity,
  updateActivity,
  deleteActivity,
  generateOutfitForActivity,
} = require('../services/tripActivity.service');
const logger = require('../utils/logger');

function handleKnownError(error, res, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  next(error);
}

class TripActivityController {
  static async create(req, res, next) {
    try {
      const activity = await createActivity(req.user.userId, req.params.tripId, req.body);
      res.status(201).json({ success: true, data: { activity } });
    } catch (error) {
      logger.error('Create trip activity error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async list(req, res, next) {
    try {
      const activities = await listActivitiesForTrip(req.user.userId, req.params.tripId);
      res.status(200).json({ success: true, data: { activities } });
    } catch (error) {
      logger.error('List trip activities error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async update(req, res, next) {
    try {
      const { activity, replan } = await updateActivity(req.user.userId, req.params.activityId, req.body);
      res.status(200).json({ success: true, data: { activity, replan } });
    } catch (error) {
      logger.error('Update trip activity error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async remove(req, res, next) {
    try {
      const result = await deleteActivity(req.user.userId, req.params.activityId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Delete trip activity error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async generateOutfit(req, res, next) {
    try {
      const result = await generateOutfitForActivity(req.user.userId, req.params.activityId);
      res.status(200).json({
        success: true,
        data: {
          activity: result.activity,
          outfit: result.outfit,
          tripMode: result.tripMode,
          tripGap: result.tripGap,
          message: result.message,
        },
      });
    } catch (error) {
      logger.error('Generate trip activity outfit error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }
}

module.exports = TripActivityController;
