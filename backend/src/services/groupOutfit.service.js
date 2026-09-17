/**
 * Hybrid group outfits -- Phase 8 (PRD §3.9). Two modes sharing one
 * lifecycle (see the `group_outfits` migration for why they're one
 * table): `coordinated` (each person's own outfit, biased toward a
 * shared theme) and `cross_closet` (an explicitly-picked, always
 * ownership-tagged set of items borrowed under an active ClosetShare).
 *
 * Coordinated theme negotiation is the hybrid model decided 2026-09-17:
 * a default theme is proposed automatically from the activity's
 * occasion, then any accepted participant (or the trip owner) can edit
 * it -- no formal accept step, unlike ClosetShare, which grants real
 * cross-wardrobe data access and needs one.
 *
 * Deliberately trip- and activity-scoped only this phase (no bare
 * event_ref/no-trip case yet -- see PRD §3.9).
 */

const { Trip, TripActivity, TripParticipant, GroupOutfit, Outfit, Clothes } = require('../database/models');
const { recommendOutfits } = require('./AIOutfit recommendation.js');
const { normalizeOccasionForOutfit } = require('./activityOutfit.service');
const { findActiveShareFor } = require('./closetShare.service');
const { assertUserIsPro } = require('../middleware/subscription');
const logger = require('../utils/logger');

function knownError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

const VALID_MODES = ['coordinated', 'cross_closet'];

// Deterministic default-theme mapping from occasion -- same "no ML
// magic, honest deterministic default" spirit as the rest of this
// app's mocked/templated logic. Purely a starting point the theme is
// meant to be edited from, not a claim of styling intelligence.
const OCCASION_DEFAULT_THEME = {
  formal: { formality: 'formal', palette: 'neutral elegant (black, navy, cream)' },
  wedding: { formality: 'formal', palette: 'neutral elegant (black, navy, cream)' },
  business: { formality: 'business', palette: 'neutral professional (navy, grey, white)' },
  party: { formality: 'dressy-casual', palette: 'bold jewel tones' },
  date: { formality: 'dressy-casual', palette: 'bold jewel tones' },
  outdoor: { formality: 'casual', palette: 'earth tones' },
  athletic: { formality: 'casual', palette: 'earth tones' },
  beach: { formality: 'casual', palette: 'light coastal tones' },
  travel: { formality: 'casual', palette: 'neutral casual' },
};

function defaultThemeForOccasion(occasion) {
  return OCCASION_DEFAULT_THEME[occasion] || { formality: 'casual', palette: 'neutral casual' };
}

const COLOR_FAMILIES = {
  neutral: ['black', 'white', 'grey', 'gray', 'beige', 'cream', 'navy', 'tan', 'ivory'],
  earth: ['brown', 'tan', 'olive', 'khaki', 'rust', 'terracotta', 'sand', 'green'],
  bright: ['red', 'purple', 'emerald', 'sapphire', 'magenta', 'gold', 'royal blue', 'jewel'],
  pastel: ['pink', 'lavender', 'mint', 'peach', 'baby blue'],
  coastal: ['white', 'blue', 'turquoise', 'yellow', 'coral', 'light'],
};

function paletteFamily(paletteText = '') {
  const lower = paletteText.toLowerCase();
  if (lower.includes('earth')) return 'earth';
  if (lower.includes('jewel') || lower.includes('bold')) return 'bright';
  if (lower.includes('pastel')) return 'pastel';
  if (lower.includes('coastal') || lower.includes('light')) return 'coastal';
  return 'neutral';
}

/**
 * How well one item matches the theme -- a bias signal, not a hard
 * filter. Baseline 0.3 (not 0) so a theme never overrides "this is
 * weather/occasion-appropriate," which the underlying engine already
 * handled -- it only nudges among options that already passed that bar.
 */
function scoreItemThemeCompatibility(item, theme) {
  let score = 0.3;
  const family = COLOR_FAMILIES[paletteFamily(theme.palette)] || [];
  const color = (item.color || '').toLowerCase();
  if (family.some((keyword) => color.includes(keyword))) score += 0.5;
  if (theme.formality && item.occasion && item.occasion === theme.formality) score += 0.2;
  return Math.min(score, 1);
}

async function assertParticipantOrOwner(userId, trip) {
  if (trip.userId === userId) return;
  const participant = await TripParticipant.findOne({
    where: { tripId: trip.id, userId, status: 'accepted' },
  });
  if (!participant) throw knownError('You do not have access to this trip', 403);
}

async function loadTripAndActivity(tripId, activityId) {
  const activity = await TripActivity.findByPk(activityId, { include: [{ model: Trip }] });
  if (!activity || activity.tripId !== tripId) throw knownError('Activity not found on this trip', 404);
  return { trip: activity.Trip, activity };
}

/**
 * @param {string} mode - 'coordinated' | 'cross_closet'
 */
async function getOrCreateForActivity(userId, tripId, activityId, mode) {
  if (!VALID_MODES.includes(mode)) throw knownError(`mode must be one of ${VALID_MODES.join(', ')}`, 400);
  const { trip, activity } = await loadTripAndActivity(tripId, activityId);
  await assertParticipantOrOwner(userId, trip);

  const existing = await GroupOutfit.findOne({ where: { tripId, activityId, mode } });
  if (existing) return existing;

  // Pro gate: the trip owner's own tier, checked once at the moment a
  // new GroupOutfit is actually created for this trip -- not the
  // caller's, since any accepted participant may be the one to start
  // it. Generating a per-person outfit, editing the theme, browsing
  // borrowable items, or building the final cross-closet pick all
  // happen inside an already-created GroupOutfit, so they don't
  // re-check this.
  await assertUserIsPro(trip.userId);

  const theme = mode === 'coordinated' ? defaultThemeForOccasion(activity.occasion) : null;
  return GroupOutfit.create({
    tripId,
    activityId,
    mode,
    theme,
    participantOutfits: [],
    items: [],
    createdBy: userId,
  });
}

async function assertAccess(userId, groupOutfit) {
  const trip = await Trip.findByPk(groupOutfit.tripId);
  if (!trip) throw knownError('Trip not found', 404);
  await assertParticipantOrOwner(userId, trip);
  return trip;
}

/**
 * Either participant can propose/edit the theme -- no formal accept
 * step (2026-09-17 decision). Only meaningful for `coordinated` mode.
 */
async function updateTheme(userId, groupOutfitId, theme) {
  const groupOutfit = await GroupOutfit.findByPk(groupOutfitId);
  if (!groupOutfit) throw knownError('Group outfit not found', 404);
  if (groupOutfit.mode !== 'coordinated') throw knownError('Only "coordinated" mode has a theme', 400);
  await assertAccess(userId, groupOutfit);

  groupOutfit.theme = { ...groupOutfit.theme, ...theme };
  await groupOutfit.save();
  return groupOutfit;
}

/**
 * Generates and persists this one participant's own outfit, biased
 * toward the shared theme -- never touches anyone else's wardrobe.
 * Re-ranks a wider candidate set from the existing recommendation
 * engine (unmodified) by theme compatibility, rather than changing the
 * core scorer -- keeps this additive rather than risking the shared
 * scoring logic every other recommendation path also depends on.
 */
async function generateParticipantOutfit(userId, groupOutfitId) {
  const groupOutfit = await GroupOutfit.findByPk(groupOutfitId);
  if (!groupOutfit) throw knownError('Group outfit not found', 404);
  if (groupOutfit.mode !== 'coordinated') throw knownError('Only "coordinated" mode generates a per-person outfit', 400);
  await assertAccess(userId, groupOutfit);

  const activity = await TripActivity.findByPk(groupOutfit.activityId);
  const occasion = activity?.occasion || 'casual';
  const theme = groupOutfit.theme || defaultThemeForOccasion(occasion);

  const result = await recommendOutfits(userId, occasion, { count: 8 });
  if (!result.outfits || result.outfits.length === 0) {
    return { groupOutfit, outfit: null, message: result.message || 'No outfit candidates available' };
  }

  const reranked = result.outfits
    .map((combo) => {
      const items = combo.items || [];
      const avgThemeScore = items.length
        ? items.reduce((sum, item) => sum + scoreItemThemeCompatibility(item, theme), 0) / items.length
        : 0.3;
      const blended = 0.6 * (combo.score?.totalScore || 0) + 0.4 * avgThemeScore;
      return { combo, blended };
    })
    .sort((a, b) => b.blended - a.blended);

  const top = reranked[0].combo;
  const itemIds = (top.items || []).map((i) => i.id).filter(Boolean);
  if (itemIds.length === 0) {
    return { groupOutfit, outfit: null, message: 'No usable items in the top theme-matched recommendation' };
  }

  let outfit;
  try {
    // Duplicates activityOutfit.service.js's small persist step rather
    // than importing it -- that function always calls the unbiased
    // top-1 result, and threading a pre-picked combo through it would
    // couple two independently-evolving call paths for no real reuse.
    outfit = await Outfit.create({
      userId,
      name: `${activity?.title || occasion} (coordinated) outfit`,
      occasion: normalizeOccasionForOutfit(occasion),
      items: itemIds,
      isSuggested: true,
    });
  } catch (error) {
    logger.warn('Failed to persist coordinated outfit', { userId, groupOutfitId, error: error.message });
    throw knownError('Could not save outfit recommendation', 500);
  }

  const participantOutfits = (groupOutfit.participantOutfits || []).filter((p) => p.userId !== userId);
  participantOutfits.push({ userId, outfitId: outfit.id });
  groupOutfit.participantOutfits = participantOutfits;
  await groupOutfit.save();

  return { groupOutfit, outfit, message: null };
}

/** What can `recipientUserId` currently borrow from `ownerUserId` for this activity? */
async function listBorrowableItems(recipientUserId, ownerUserId, { tripId, activityId }) {
  if (ownerUserId === recipientUserId) throw knownError('Use your own wardrobe directly, no share needed', 400);
  const share = await findActiveShareFor(ownerUserId, recipientUserId, { tripId, activityId });
  if (!share) throw knownError('No active closet-sharing connection covers this trip/activity', 403);

  return Clothes.findAll({
    where: { userId: ownerUserId, isActive: true },
    attributes: ['id', 'type', 'color', 'pattern', 'occasion', 'imageUrl'],
  });
}

/**
 * Assembles a cross-closet outfit from explicit picks, tagging true
 * ownership on every item -- never an algorithmically blended pool.
 * @param {{itemId: string, ownerUserId: string}[]} itemSelections
 */
async function buildCrossClosetOutfit(recipientUserId, groupOutfitId, itemSelections) {
  const groupOutfit = await GroupOutfit.findByPk(groupOutfitId);
  if (!groupOutfit) throw knownError('Group outfit not found', 404);
  if (groupOutfit.mode !== 'cross_closet') throw knownError('Only "cross_closet" mode builds a borrowed-item outfit', 400);
  const trip = await assertAccess(recipientUserId, groupOutfit);

  if (!Array.isArray(itemSelections) || itemSelections.length === 0) {
    throw knownError('itemSelections must be a non-empty array of { itemId, ownerUserId }', 400);
  }

  const taggedItems = [];
  for (const { itemId, ownerUserId } of itemSelections) {
    if (ownerUserId !== recipientUserId) {
      const share = await findActiveShareFor(ownerUserId, recipientUserId, {
        tripId: groupOutfit.tripId,
        activityId: groupOutfit.activityId,
      });
      if (!share) {
        throw knownError(`No active closet-sharing connection lets you borrow from ${ownerUserId} for this activity`, 403);
      }
    }
    const item = await Clothes.findOne({ where: { id: itemId, userId: ownerUserId, isActive: true } });
    if (!item) throw knownError(`Item ${itemId} not found in that person's wardrobe`, 404);
    taggedItems.push({ itemId: item.id, ownerUserId });
  }

  groupOutfit.items = taggedItems;
  await groupOutfit.save();
  return groupOutfit;
}

module.exports = {
  getOrCreateForActivity,
  updateTheme,
  generateParticipantOutfit,
  listBorrowableItems,
  buildCrossClosetOutfit,
  defaultThemeForOccasion,
  scoreItemThemeCompatibility,
};
