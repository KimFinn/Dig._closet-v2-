/**
 * Phase 8 (PRD §3.9) -- cross-closet borrowing consent HTTP layer.
 */

const {
  inviteShare,
  acceptShare,
  declineShare,
  revokeShare,
  listShares,
} = require('../services/closetShare.service');
const logger = require('../utils/logger');

function handleKnownError(error, res, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  next(error);
}

class ClosetShareController {
  static async invite(req, res, next) {
    try {
      const share = await inviteShare(req.user.userId, req.body);
      res.status(201).json({ success: true, data: { share } });
    } catch (error) {
      logger.error('Invite closet share error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async list(req, res, next) {
    try {
      const shares = await listShares(req.user.userId);
      res.status(200).json({ success: true, data: shares });
    } catch (error) {
      logger.error('List closet shares error', { error: error.message, userId: req.user?.userId });
      next(error);
    }
  }

  static async accept(req, res, next) {
    try {
      const share = await acceptShare(req.user.userId, req.params.shareId);
      res.status(200).json({ success: true, data: { share } });
    } catch (error) {
      logger.error('Accept closet share error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async decline(req, res, next) {
    try {
      const result = await declineShare(req.user.userId, req.params.shareId);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Decline closet share error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async revoke(req, res, next) {
    try {
      const share = await revokeShare(req.user.userId, req.params.shareId);
      res.status(200).json({ success: true, data: { share } });
    } catch (error) {
      logger.error('Revoke closet share error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }
}

module.exports = ClosetShareController;
