/**
 * Phase 9 (PRD §3.10) -- "what I know about you" dashboard HTTP layer.
 */

const { getVisibleProfile, correctTrait } = require('../services/profileDashboard.service');
const { getNarrative } = require('../services/profileNarrative.service');
const { synthesizeProfileForUser } = require('../services/profileSynthesis.service');
const logger = require('../utils/logger');

function handleKnownError(error, res, next) {
  if (error.statusCode) {
    return res.status(error.statusCode).json({ success: false, message: error.message });
  }
  next(error);
}

class ProfileController {
  static async getSummary(req, res, next) {
    try {
      const userId = req.user.userId;
      const [profile, narrative] = await Promise.all([getVisibleProfile(userId), getNarrative(userId)]);
      res.status(200).json({
        success: true,
        data: { ...profile, narrative: narrative.narrative, narrativeLive: narrative.live },
      });
    } catch (error) {
      logger.error('Get profile summary error', { error: error.message, userId: req.user?.userId });
      next(error);
    }
  }

  static async correctTrait(req, res, next) {
    try {
      const userId = req.user.userId;
      const { traitKey } = req.params;
      const result = await correctTrait(userId, traitKey, req.body);
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      logger.error('Correct trait error', { error: error.message, userId: req.user?.userId, traitKey: req.params.traitKey });
      handleKnownError(error, res, next);
    }
  }

  // Manual on-demand trigger -- useful for testing/demoing without
  // waiting for the nightly job. Not Pro-gated: viewing/refreshing your
  // own profile is not one of the Pro-tier-reserved capabilities per §7
  // (only the chatbot is); this is the same data the dashboard already
  // shows for free.
  static async resynthesize(req, res, next) {
    try {
      const userId = req.user.userId;
      const summary = await synthesizeProfileForUser(userId);
      res.status(200).json({ success: true, data: { version: summary.version, computedAt: summary.computedAt } });
    } catch (error) {
      logger.error('Manual profile resynthesize error', { error: error.message, userId: req.user?.userId });
      next(error);
    }
  }
}

module.exports = ProfileController;
