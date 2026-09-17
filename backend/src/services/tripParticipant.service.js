/**
 * Group trip membership -- Phase 8 (PRD §3.9). Activates `TripParticipant`
 * from Phase 3's schema-only scaffolding into a real invite/accept/decline
 * flow.
 *
 * 2026-09-17 scoping decision: every participant must have a real
 * account. There is no permanent name/email-only guest state -- invite
 * looks the invitee up by email and requires a match. This also fully
 * resolves what was tracked as PRD §8 open decision #17 (how an invite
 * reaches someone with no account yet): it doesn't try to, by design --
 * the inviter is told to ask that person to sign up first, rather than
 * this service inventing a token-based pre-registration flow.
 *
 * Shared itinerary visibility is view-only this phase (also decided
 * 2026-09-17) -- only the trip owner edits activities; `role` stays a
 * descriptive label. `getSharedItinerary` is a deliberately separate,
 * narrower read path rather than widening `tripService.getTripById`'s
 * existing strict-owner query used everywhere else in the app (budget,
 * packing regenerate, etc.) -- keeps this phase's blast radius to
 * exactly the one new read-only view it's supposed to add.
 */

const { Trip, TripActivity, TripParticipant, User } = require('../database/models');
const { sendNotification, tripInviteEmail, tripInviteRespondedEmail } = require('./notification.service');
const { assertUserIsPro } = require('../middleware/subscription');
const logger = require('../utils/logger');

function knownError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function assertOwnsTrip(userId, tripId) {
  const trip = await Trip.findOne({ where: { id: tripId, userId } });
  if (!trip) throw knownError('Trip not found', 404);
  return trip;
}

/** Owner, or an accepted participant, may view the trip. */
async function assertCanViewTrip(userId, tripId) {
  const trip = await Trip.findByPk(tripId);
  if (!trip) throw knownError('Trip not found', 404);
  if (trip.userId === userId) return { trip, isOwner: true };

  const participant = await TripParticipant.findOne({
    where: { tripId, userId, status: 'accepted' },
  });
  if (!participant) throw knownError('You do not have access to this trip', 403);
  return { trip, isOwner: false, participant };
}

/**
 * @param {string} inviterUserId
 * @param {string} tripId
 * @param {{ email: string, role?: string }} data
 */
async function inviteParticipant(inviterUserId, tripId, { email, role }) {
  const trip = await assertOwnsTrip(inviterUserId, tripId);
  // Pro gate: the trip owner's own tier, checked once here at the one
  // action that actually spends the "group trip planning" feature --
  // not on list/itinerary/respond, which any invited participant needs
  // regardless of their own plan.
  await assertUserIsPro(inviterUserId);

  const invitee = await User.findOne({ where: { email } });
  if (!invitee) {
    throw knownError(
      `No account found for ${email}. Ask them to create an account first, then invite them again.`,
      422
    );
  }
  if (invitee.id === inviterUserId) {
    throw knownError('You cannot invite yourself to your own trip', 400);
  }

  const existing = await TripParticipant.findOne({ where: { tripId, userId: invitee.id } });
  if (existing) {
    if (existing.status === 'declined') {
      // Re-invite after a decline: reset to invited rather than leaving
      // a dead row the trip owner can't do anything further with.
      existing.status = 'invited';
      existing.role = role || existing.role;
      await existing.save();
      await sendInviteEmailSafe(invitee, trip, existing);
      return existing;
    }
    throw knownError('This person is already invited/participating on this trip', 409);
  }

  const participant = await TripParticipant.create({
    tripId,
    userId: invitee.id,
    name: invitee.fullName,
    email: invitee.email,
    role: role || 'companion',
    status: 'invited',
  });

  await sendInviteEmailSafe(invitee, trip, participant);
  return participant;
}

async function sendInviteEmailSafe(invitee, trip, participant) {
  try {
    await sendNotification(invitee, tripInviteEmail(invitee, trip, participant));
  } catch (error) {
    logger.warn('Trip invite email failed to send', { participantId: participant.id, error: error.message });
  }
}

async function respondToInvite(userId, participantId, decision) {
  if (!['accepted', 'declined'].includes(decision)) {
    throw knownError('decision must be "accepted" or "declined"', 400);
  }
  const participant = await TripParticipant.findByPk(participantId, { include: [{ model: Trip }] });
  if (!participant || participant.userId !== userId) {
    throw knownError('Invite not found', 404);
  }
  if (participant.status !== 'invited') {
    throw knownError(`This invite is already ${participant.status}`, 409);
  }

  participant.status = decision;
  await participant.save();

  try {
    const tripOwner = await User.findByPk(participant.Trip.userId);
    if (tripOwner) await sendNotification(tripOwner, tripInviteRespondedEmail(tripOwner, participant, decision));
  } catch (error) {
    logger.warn('Trip invite response email failed to send', { participantId, error: error.message });
  }

  return participant;
}

async function listParticipants(userId, tripId) {
  await assertCanViewTrip(userId, tripId);
  return TripParticipant.findAll({ where: { tripId }, order: [['createdAt', 'ASC']] });
}

/**
 * Read-only shared itinerary -- deliberately narrower than the trip
 * owner's own view: no budget/estimatedCost fields, no packing list.
 * "Visibility" this phase means "what's planned," not "how much it
 * costs" or "what's in someone else's suitcase."
 */
async function getSharedItinerary(userId, tripId) {
  const { trip } = await assertCanViewTrip(userId, tripId);

  const activities = await TripActivity.findAll({
    where: { tripId },
    attributes: ['id', 'date', 'timeSlot', 'occasion', 'title', 'notes', 'category', 'status'],
    order: [['date', 'ASC']],
  });

  return {
    trip: {
      id: trip.id,
      destination: trip.destination,
      startDate: trip.startDate,
      endDate: trip.endDate,
      purpose: trip.purpose,
    },
    activities,
  };
}

module.exports = {
  inviteParticipant,
  respondToInvite,
  listParticipants,
  getSharedItinerary,
  assertCanViewTrip,
};
