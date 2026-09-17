/**
 * Daily check-in response endpoint — Phase 2.
 *
 * The email sent by src/queues/checkInQueue.js links here (well, to the
 * frontend, which calls this). Responding is just a normal wear/skip
 * event under the hood, tagged with its source, so it feeds the exact
 * same learning pipeline (UserInteraction -> nightly
 * NeuralPreferenceLearner run) as wearing something logged any other
 * way -- no separate code path to keep in sync.
 */

const Joi = require('joi');
const { Clothes, Outfit, UserInteraction } = require('../database/models');
const { analyzeWearEvent } = require('../services/outfitAnalytics.service');
const logger = require('../utils/logger');

const respondSchema = Joi.object({
    worn: Joi.boolean().required(),
    outfitId: Joi.string().uuid().optional(),
    itemIds: Joi.array().items(Joi.string().uuid()).min(1).optional(),
});

class NotificationController {
    /**
     * @route POST /api/v1/notifications/checkin/respond
     */
    static async respondToCheckIn(req, res, next) {
        try {
            const userId = req.user.userId;
            const { error, value } = respondSchema.validate(req.body);
            if (error) {
                return res.status(400).json({
                    success: false,
                    message: error.details[0]?.message || 'Invalid check-in response',
                });
            }

            const { worn, outfitId, itemIds } = value;

            if (worn && !outfitId && (!itemIds || itemIds.length === 0)) {
                return res.status(400).json({
                    success: false,
                    message: 'outfitId or itemIds is required when worn is true',
                });
            }

            if (!worn) {
                await UserInteraction.create({
                    userId,
                    action: 'skip',
                    context: { source: 'daily_checkin' },
                });
                return res.status(200).json({ success: true, message: 'Thanks for letting us know' });
            }

            let wornItemIds = itemIds || [];

            if (outfitId) {
                const outfit = await Outfit.findOne({ where: { id: outfitId, userId } });
                if (!outfit) {
                    return res.status(404).json({ success: false, message: 'Outfit not found' });
                }
                await outfit.markAsWorn();
                wornItemIds = Array.isArray(outfit.items) ? outfit.items : [];

                const analytics = await analyzeWearEvent(userId, { itemIds: wornItemIds, outfitId });
                await UserInteraction.create({
                    userId,
                    outfitId,
                    action: 'wear',
                    context: { source: 'daily_checkin', ...analytics },
                });
            } else {
                // Ownership check up front -- don't record wear on items
                // that aren't the requesting user's.
                const items = await Clothes.findAll({ where: { id: wornItemIds, userId } });
                if (items.length === 0) {
                    return res.status(404).json({ success: false, message: 'No matching clothing items found' });
                }

                const analytics = await analyzeWearEvent(userId, { itemIds: items.map((i) => i.id) });

                for (const item of items) {
                    await item.increment('wearCount');
                    await item.update({ lastWornAt: new Date() });
                    await UserInteraction.create({
                        userId,
                        itemId: item.id,
                        action: 'wear',
                        context: { source: 'daily_checkin', ...analytics },
                    });
                }
            }

            logger.info('Daily check-in response recorded', { userId, worn, outfitId, itemCount: wornItemIds.length });
            return res.status(200).json({ success: true, message: 'Logged, thanks!' });
        } catch (error) {
            logger.error('Error recording check-in response', { error: error.message });
            next(error);
        }
    }
}

module.exports = NotificationController;
