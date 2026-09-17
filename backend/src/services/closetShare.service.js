/**
 * Cross-closet borrowing consent -- Phase 8 (PRD §3.9). Explicit mutual
 * consent (invite -> accept), revocable anytime by either side, scoped
 * by the owner's choice. Kept as three genuinely distinct scopes per
 * the 2026-09-17 scoping decision:
 *  - event_only: valid only for one specific TripActivity
 *  - trip_only: valid for any activity on one specific Trip
 *  - full_wardrobe: valid anywhere, ongoing
 *
 * This module owns the consent lifecycle and scope validity rules.
 * Which items are actually borrowed for a given shared outfit is
 * groupOutfit.service.js's job (buildCrossClosetOutfit) -- this module
 * only answers "is X allowed to see/borrow from Y's closet right now,
 * for this trip/activity".
 */

const { ClosetShare, Trip, TripActivity, User } = require('../database/models');
const { sendNotification, closetShareInviteEmail, closetShareStatusEmail } = require('./notification.service');
const { assertUserIsPro } = require('../middleware/subscription');
const logger = require('../utils/logger');

function knownError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const VALID_SCOPES = ['event_only', 'trip_only', 'full_wardrobe'];

/**
 * @param {string} ownerUserId
 * @param {{ recipientEmail: string, scope: 'event_only'|'trip_only'|'full_wardrobe', tripId?: string, activityId?: string }} data
 */
async function inviteShare(ownerUserId, data) {
  const { recipientEmail, scope } = data;
  if (!VALID_SCOPES.includes(scope)) {
    throw knownError(`scope must be one of ${VALID_SCOPES.join(', ')}`, 400);
  }
  // Pro gate: the closet owner's own tier -- the one action that
  // spends the "cross-closet sharing" feature. Accepting/declining/
  // revoking on the recipient's side never requires their own plan.
  await assertUserIsPro(ownerUserId);

  const recipient = await User.findOne({ where: { email: recipientEmail } });
  if (!recipient) {
    throw knownError(`No account found for ${recipientEmail}. Ask them to create an account first.`, 422);
  }
  if (recipient.id === ownerUserId) {
    throw knownError('You cannot share your closet with yourself', 400);
  }

  let scopedTripId = null;
  let scopedActivityId = null;

  if (scope === 'event_only') {
    if (!data.activityId) throw knownError('activityId is required for scope "event_only"', 400);
    const activity = await TripActivity.findByPk(data.activityId, { include: [{ model: Trip }] });
    if (!activity || activity.Trip.userId !== ownerUserId) {
      throw knownError('Activity not found on one of your own trips', 404);
    }
    scopedActivityId = activity.id;
    scopedTripId = activity.tripId;
  } else if (scope === 'trip_only') {
    if (!data.tripId) throw knownError('tripId is required for scope "trip_only"', 400);
    const trip = await Trip.findOne({ where: { id: data.tripId, userId: ownerUserId } });
    if (!trip) throw knownError('Trip not found', 404);
    scopedTripId = trip.id;
  } else if (data.tripId || data.activityId) {
    throw knownError('scope "full_wardrobe" does not take a tripId/activityId', 400);
  }

  const existing = await ClosetShare.findOne({
    where: {
      ownerUserId,
      recipientUserId: recipient.id,
      scope,
      scopedTripId,
      scopedActivityId,
    },
  });
  if (existing && existing.status !== 'revoked') {
    throw knownError('A share with this exact scope already exists for this person', 409);
  }

  const share = existing
    ? await existing.update({ status: 'pending' })
    : await ClosetShare.create({
        ownerUserId,
        recipientUserId: recipient.id,
        scope,
        scopedTripId,
        scopedActivityId,
        status: 'pending',
      });

  try {
    const owner = await User.findByPk(ownerUserId);
    await sendNotification(recipient, closetShareInviteEmail(recipient, owner, share));
  } catch (error) {
    logger.warn('ClosetShare invite email failed to send', { shareId: share.id, error: error.message });
  }

  return share;
}

async function acceptShare(recipientUserId, shareId) {
  const share = await ClosetShare.findByPk(shareId);
  if (!share || share.recipientUserId !== recipientUserId) throw knownError('Share not found', 404);
  if (share.status !== 'pending') throw knownError(`This share is already ${share.status}`, 409);

  share.status = 'active';
  await share.save();
  await notifyOtherSide(share, 'accepted', share.ownerUserId);
  return share;
}

async function declineShare(recipientUserId, shareId) {
  const share = await ClosetShare.findByPk(shareId);
  if (!share || share.recipientUserId !== recipientUserId) throw knownError('Share not found', 404);
  if (share.status !== 'pending') throw knownError(`This share is already ${share.status}`, 409);

  await share.destroy();
  return { id: shareId };
}

/** Either side can revoke, anytime, per PRD §3.9 ("no silent access, ever; sharing is always visible and revocable"). */
async function revokeShare(userId, shareId) {
  const share = await ClosetShare.findByPk(shareId);
  if (!share || (share.ownerUserId !== userId && share.recipientUserId !== userId)) {
    throw knownError('Share not found', 404);
  }
  if (share.status === 'revoked') return share;

  share.status = 'revoked';
  await share.save();

  const notifyUserId = share.ownerUserId === userId ? share.recipientUserId : share.ownerUserId;
  await notifyOtherSide(share, 'revoked', notifyUserId);
  return share;
}

async function notifyOtherSide(share, event, notifyUserId) {
  try {
    const [toUser, otherUser] = await Promise.all([
      User.findByPk(notifyUserId),
      User.findByPk(notifyUserId === share.ownerUserId ? share.recipientUserId : share.ownerUserId),
    ]);
    if (toUser && otherUser) {
      await sendNotification(toUser, closetShareStatusEmail(toUser, otherUser, share, event));
    }
  } catch (error) {
    logger.warn('ClosetShare status email failed to send', { shareId: share.id, event, error: error.message });
  }
}

async function listShares(userId) {
  const [owned, received] = await Promise.all([
    ClosetShare.findAll({ where: { ownerUserId: userId } }),
    ClosetShare.findAll({ where: { recipientUserId: userId } }),
  ]);
  return { owned, received };
}

/**
 * Is `recipientUserId` currently allowed to borrow from `ownerUserId`
 * for this trip/activity context? Used by groupOutfit.service.js before
 * letting a cross-closet outfit reference someone else's item.
 */
async function findActiveShareFor(ownerUserId, recipientUserId, { tripId, activityId } = {}) {
  const shares = await ClosetShare.findAll({
    where: { ownerUserId, recipientUserId, status: 'active' },
  });

  return shares.find((share) => {
    if (share.scope === 'full_wardrobe') return true;
    if (share.scope === 'trip_only') return tripId && share.scopedTripId === tripId;
    if (share.scope === 'event_only') return activityId && share.scopedActivityId === activityId;
    return false;
  }) || null;
}

module.exports = {
  inviteShare,
  acceptShare,
  declineShare,
  revokeShare,
  listShares,
  findActiveShareFor,
  VALID_SCOPES,
};
