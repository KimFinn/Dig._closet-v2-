/**
 * Phase 8 (PRD §3.9) -- hybrid group outfits HTTP layer, nested under
 * /api/v1/trip/:tripId/activities/:activityId/group-outfit.
 */

const {
  getOrCreateForActivity,
  updateTheme,
  generateParticipantOutfit,
  listBorrowableItems,
  buildCrossClosetOutfit,
} = require('../services/groupOutfit.service');
const logger = require('../utils/logger');

function handleKnownError(error, res, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  next(error);
}

class GroupOutfitController {
  static async getOrCreate(req, res, next) {
    try {
      const { tripId, activityId } = req.params;
      const groupOutfit = await getOrCreateForActivity(req.user.userId, tripId, activityId, req.body.mode);
      res.status(200).json({ success: true, data: { groupOutfit } });
    } catch (error) {
      logger.error('Get/create group outfit error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async updateTheme(req, res, next) {
    try {
      const groupOutfit = await updateTheme(req.user.userId, req.params.groupOutfitId, req.body);
      res.status(200).json({ success: true, data: { groupOutfit } });
    } catch (error) {
      logger.error('Update group outfit theme error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async generateMyOutfit(req, res, next) {
    try {
      const result = await generateParticipantOutfit(req.user.userId, req.params.groupOutfitId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Generate coordinated outfit error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async listBorrowable(req, res, next) {
    try {
      const { tripId, activityId } = req.params;
      const items = await listBorrowableItems(req.user.userId, req.params.ownerUserId, { tripId, activityId });
      res.status(200).json({ success: true, data: { items } });
    } catch (error) {
      logger.error('List borrowable items error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async buildCrossClosetOutfit(req, res, next) {
    try {
      const groupOutfit = await buildCrossClosetOutfit(req.user.userId, req.params.groupOutfitId, req.body.itemSelections);
      res.status(200).json({ success: true, data: { groupOutfit } });
    } catch (error) {
      logger.error('Build cross-closet outfit error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }
}

module.exports = GroupOutfitController;
