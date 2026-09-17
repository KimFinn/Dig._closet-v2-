/**
 * Outing HTTP layer -- Phase 7 (PRD §3.8). Thin controller over
 * outing.service.js, mounted at /api/v1/outing.
 */

const {
  createOuting,
  listOutings,
  getOuting,
  updateOuting,
  deleteOuting,
  generateOutfitForOuting,
} = require('../services/outing.service');
const logger = require('../utils/logger');

function handleKnownError(error, res, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  next(error);
}

class OutingController {
  static async create(req, res, next) {
    try {
      const outing = await createOuting(req.user.userId, req.body);
      res.status(201).json({ success: true, data: { outing } });
    } catch (error) {
      logger.error('Create outing error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async list(req, res, next) {
    try {
      const outings = await listOutings(req.user.userId);
      res.status(200).json({ success: true, data: { outings } });
    } catch (error) {
      logger.error('List outings error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async getById(req, res, next) {
    try {
      const outing = await getOuting(req.user.userId, req.params.outingId);
      res.status(200).json({ success: true, data: { outing } });
    } catch (error) {
      logger.error('Get outing error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async update(req, res, next) {
    try {
      const outing = await updateOuting(req.user.userId, req.params.outingId, req.body);
      res.status(200).json({ success: true, data: { outing } });
    } catch (error) {
      logger.error('Update outing error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async remove(req, res, next) {
    try {
      const result = await deleteOuting(req.user.userId, req.params.outingId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Delete outing error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async generateOutfit(req, res, next) {
    try {
      const result = await generateOutfitForOuting(req.user.userId, req.params.outingId);
      res.status(200).json({
        success: true,
        data: {
          outing: result.outing,
          outfit: result.outfit,
          tripMode: result.tripMode,
          message: result.message,
        },
      });
    } catch (error) {
      logger.error('Generate outing outfit error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }
}

module.exports = OutingController;
