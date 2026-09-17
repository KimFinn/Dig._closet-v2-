/**
 * Phase 8 (PRD §7/§3.9): the whole group-trip feature set (group trip
 * planning + cross-closet sharing) is gated behind the Pro tier, per
 * §7's monetization plan -- confirmed on rereading §7 during the
 * 2026-09-17 scoping discussion, not a new decision made here.
 *
 * There is no real billing integration behind `subscriptionTier` yet
 * (see the migration that added it) -- this middleware is real and
 * enforced, it's just checking a field nothing but
 * PATCH /auth/me/subscription can set for now.
 */

const { User } = require('../database/models');
const logger = require('../utils/logger');

const TIER_RANK = { free: 0, plus: 1, pro: 2 };

/**
 * Service-layer entitlement check, used instead of a blanket route
 * middleware. Phase 8's gate is a resource-owner entitlement (like a
 * paid workspace seat), not a per-caller one -- a friend accepting a
 * trip invite, responding, or generating their own coordinated outfit
 * inside a trip a Pro owner already set up shouldn't need their own
 * Pro plan just to participate. Only the action that actually spends
 * the owner's Pro feature (inviting a participant, sharing a closet,
 * starting a new GroupOutfit) checks that owner's tier -- always the
 * resource owner's `userId`, not necessarily the caller's.
 */
async function assertUserIsPro(userId, minTier = 'pro') {
  const user = await User.findByPk(userId, { attributes: ['id', 'subscriptionTier'] });
  if (!user) {
    const err = new Error('User not found');
    err.statusCode = 404;
    throw err;
  }
  if ((TIER_RANK[user.subscriptionTier] ?? 0) < TIER_RANK[minTier]) {
    const err = new Error(
      `This feature requires the "${minTier}" plan. The current plan is "${user.subscriptionTier}".`
    );
    err.statusCode = 402;
    throw err;
  }
}

function requireTier(minTier) {
  const RANK = { free: 0, plus: 1, pro: 2 };
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId;
      const user = await User.findByPk(userId, { attributes: ['id', 'subscriptionTier'] });
      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }
      if ((RANK[user.subscriptionTier] ?? 0) < RANK[minTier]) {
        return res.status(403).json({
          success: false,
          message: `This feature requires the "${minTier}" plan. Your current plan is "${user.subscriptionTier}".`,
        });
      }
      next();
    } catch (error) {
      logger.error('Subscription tier check error', { error: error.message });
      next(error);
    }
  };
}

module.exports = {
  requirePro: requireTier('pro'),
  requireTier,
  assertUserIsPro,
};
