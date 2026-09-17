/**
 * Phase 8 (PRD §3.9) -- group trip membership HTTP layer.
 */

const {
  inviteParticipant,
  respondToInvite,
  listParticipants,
  getSharedItinerary,
} = require('../services/tripParticipant.service');
const logger = require('../utils/logger');

function handleKnownError(error, res, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  next(error);
}

class TripParticipantController {
  static async invite(req, res, next) {
    try {
      const participant = await inviteParticipant(req.user.userId, req.params.tripId, req.body);
      res.status(201).json({ success: true, data: { participant } });
    } catch (error) {
      logger.error('Invite trip participant error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async list(req, res, next) {
    try {
      const participants = await listParticipants(req.user.userId, req.params.tripId);
      res.status(200).json({ success: true, data: { participants } });
    } catch (error) {
      logger.error('List trip participants error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async itinerary(req, res, next) {
    try {
      const itinerary = await getSharedItinerary(req.user.userId, req.params.tripId);
      res.status(200).json({ success: true, data: itinerary });
    } catch (error) {
      logger.error('Get shared itinerary error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }

  static async respond(req, res, next) {
    try {
      const participant = await respondToInvite(req.user.userId, req.params.participantId, req.body.decision);
      res.status(200).json({ success: true, data: { participant } });
    } catch (error) {
      logger.error('Respond to trip invite error', { error: error.message, userId: req.user?.userId });
      handleKnownError(error, res, next);
    }
  }
}

module.exports = TripParticipantController;
