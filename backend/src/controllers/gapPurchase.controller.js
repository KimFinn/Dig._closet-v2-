const Joi = require('joi');
const { recordGapClick, recordSelfReportedPurchase } = require('../services/gapPurchase.service');
const logger = require('../utils/logger');

const respondSchema = Joi.object({
  purchased: Joi.boolean().required(),
});

class GapPurchaseController {
  /**
   * Phase 5 -- record that the user clicked through a gap-purchase
   * suggestion. Advances funnel_stage to 'clicked' (never backward --
   * see gapPurchase.service.js).
   * @route POST /api/gap-recommendations/:id/click
   */
  static async click(req, res, next) {
    try {
      const userId = req.user.userId;
      const { id } = req.params;

      const row = await recordGapClick(userId, id);

      res.status(200).json({
        success: true,
        data: { id: row.id, funnelStage: row.funnelStage, clickedAt: row.clickedAt },
      });
    } catch (error) {
      logger.error('Gap-purchase click tracking error', {
        error: error.message,
        userId: req.user?.userId,
        recommendationLogId: req.params?.id,
      });
      if (error.statusCode === 404) return res.status(404).json({ success: false, message: error.message });
      next(error);
    }
  }

  /**
   * Phase 5 -- lightweight "did you end up buying it?" self-report.
   * Faster signal than waiting on network conversion reconciliation.
   * @route POST /api/gap-recommendations/:id/respond
   */
  static async respond(req, res, next) {
    try {
      const userId = req.user.userId;
      const { id } = req.params;
      const { error, value } = respondSchema.validate(req.body);
      if (error) {
        return res.status(400).json({ success: false, message: error.details[0]?.message || 'Invalid response' });
      }

      const row = await recordSelfReportedPurchase(userId, id, value.purchased);

      res.status(200).json({
        success: true,
        data: { id: row.id, funnelStage: row.funnelStage, purchasedAt: row.purchasedAt },
      });
    } catch (error) {
      logger.error('Gap-purchase self-report error', {
        error: error.message,
        userId: req.user?.userId,
        recommendationLogId: req.params?.id,
      });
      if (error.statusCode === 404) return res.status(404).json({ success: false, message: error.message });
      next(error);
    }
  }
}

module.exports = GapPurchaseController;
