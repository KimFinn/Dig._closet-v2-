/**
 * Packaging Service — capsule-style trip packing (Phase 3)
 *
 * Replaces the Phase 0 placeholder (see git history / the old comment
 * block that used to live here) with the real thing. This is a
 * deliberately simple, explainable greedy heuristic, not a full
 * combinatorial optimizer — the PRD's actual requirement ("minimize
 * total pieces reused across a trip") is satisfied by a reuse-first
 * assignment rule, not by searching every possible combination, which
 * would be needless complexity for a wardrobe of a few hundred items at
 * most.
 *
 * Algorithm, in one pass per trip:
 *   1. Flatten `activities` into one "day-context" per (date, time
 *      slot): {date, occasion, weather for that date}.
 *   2. Score every active wardrobe item against every context on
 *      occasion fit + weather fit (0..1).
 *   3. For each context and each outfit category it needs (top,
 *      bottom-or-dress, footwear, outerwear if cold/wet), prefer an
 *      item ALREADY in the capsule that still scores acceptably over
 *      picking a fresh one — that's what keeps total pieces packed low.
 *      Only add a new item when nothing already-selected works.
 *   4. Anything a context needs with literally no acceptable candidate
 *      anywhere in the wardrobe becomes a gap, not a silent omission.
 *
 * No paid API calls anywhere in here — this is pure in-memory scoring
 * over the user's own Clothes rows, already fetched by the caller.
 */

const { Clothes } = require('../database/models');
const logger = require('../utils/logger');

const MIN_SCORE_THRESHOLD = 0.35; // below this, an item doesn't count as a candidate for a context at all
const REUSE_SCORE_THRESHOLD = 0.3; // absolute floor for reusing an already-packed item -- slightly more lenient than fresh, since reuse is the point
const REUSE_TOLERANCE = 0.15; // how much worse a reused item is allowed to score than the best fresh alternative before the fresh one wins instead

// ----------------------------------------------------------------------
// Category classification
// ----------------------------------------------------------------------

const CATEGORY_KEYWORDS = {
  outerwear: ['jacket', 'coat', 'parka', 'blazer', 'cardigan'],
  footwear: ['sneakers', 'shoes', 'boots', 'sandals', 'heels', 'flats', 'loafers'],
  dress: ['dress', 'jumpsuit', 'romper'],
  bottom: ['jeans', 'pants', 'trousers', 'shorts', 'skirt', 'leggings', 'sweatpants'],
  top: ['tshirt', 't-shirt', 'shirt', 'blouse', 'sweater', 'hoodie', 'tank-top', 'top', 'polo'],
};

function categorize(item) {
  const type = (item.type || '').toLowerCase().replace(/\s+/g, '-');
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => type.includes(k))) return category;
  }
  return 'accessory'; // unrecognized type -- not required to complete an outfit, but can still be packed
}

// A valid outfit needs either (top + bottom) or (dress), plus footwear.
// Outerwear is conditionally required (see needsOuterwear below).
const REQUIRED_CATEGORY_SETS = [
  ['top', 'bottom', 'footwear'],
  ['dress', 'footwear'],
];

function needsOuterwear(weather) {
  if (!weather) return false;
  const cold = typeof weather.temp === 'number' && weather.temp < 12;
  const wet = typeof weather.precipitation === 'number' && weather.precipitation > 0.4;
  return cold || wet;
}

// ----------------------------------------------------------------------
// Scoring
// ----------------------------------------------------------------------

function seasonForTemp(temp) {
  if (typeof temp !== 'number') return null;
  if (temp < 10) return 'winter';
  if (temp < 18) return 'fall'; // also reasonably matches 'spring'
  if (temp < 27) return 'spring';
  return 'summer';
}

function occasionFit(item, occasion) {
  if (!occasion) return 0.6; // neutral -- no occasion specified, don't penalize
  if (!item.occasion) return 0.5; // item has no occasion tag at all -- mild neutral
  const itemOccasions = String(item.occasion).toLowerCase().split(',').map((s) => s.trim());
  if (itemOccasions.includes(occasion.toLowerCase())) return 1.0;
  // Casual/travel are broadly compatible with most other occasions when nothing better is available.
  if (itemOccasions.includes('casual') || itemOccasions.includes('travel')) return 0.55;
  return 0.2;
}

function weatherFit(item, weather) {
  if (!weather || typeof weather.temp !== 'number') return 0.6; // no weather data -- don't penalize
  const targetSeason = seasonForTemp(weather.temp);
  const itemSeason = (item.season || '').toLowerCase();
  if (!itemSeason || itemSeason === 'all-season') return 0.7;
  const itemSeasons = itemSeason.split(',').map((s) => s.trim());
  if (itemSeasons.includes(targetSeason)) return 1.0;
  // Adjacent seasons (e.g. fall item in spring weather) are an acceptable, not ideal, fit.
  const adjacency = { winter: ['fall'], fall: ['winter', 'spring'], spring: ['fall', 'summer'], summer: ['spring'] };
  if ((adjacency[targetSeason] || []).some((s) => itemSeasons.includes(s))) return 0.55;
  return 0.15;
}

function scoreItemForContext(item, context) {
  return occasionFit(item, context.occasion) * 0.55 + weatherFit(item, context.weather) * 0.45;
}

// ----------------------------------------------------------------------
// Day-context construction
// ----------------------------------------------------------------------

function buildDayContexts(activities, weatherByDate) {
  const contexts = [];
  for (const day of activities || []) {
    const weather = weatherByDate.get(day.date) || null;
    for (const slot of day.slots || []) {
      contexts.push({
        date: day.date,
        time: slot.time || 'all-day',
        occasion: slot.occasion || 'casual',
        weather,
      });
    }
  }
  return contexts;
}

// ----------------------------------------------------------------------
// Capsule assembly
// ----------------------------------------------------------------------

/**
 * For one context, picks the best category-fulfilling set from the
 * capsule-so-far, falling back to the wardrobe, or records a gap.
 * Mutates `capsule` (Map category -> Set of item ids) and `gaps`.
 */
function assignContext(context, wardrobeByCategory, capsule, itemsById, gaps) {
  const chosenIds = [];
  let usedDressForBottomTop = false;

  function pickForCategory(category) {
    const candidates = wardrobeByCategory.get(category) || [];
    if (candidates.length === 0) return null;

    const alreadyPacked = candidates
      .filter((c) => capsule.get(category)?.has(c.item.id))
      .filter((c) => c.score >= REUSE_SCORE_THRESHOLD)
      .sort((a, b) => b.score - a.score);
    const bestAlreadyPacked = alreadyPacked[0] || null;

    const fresh = candidates.filter((c) => c.score >= MIN_SCORE_THRESHOLD).sort((a, b) => b.score - a.score);
    const bestFresh = fresh[0] || null;

    // Prefer something already in the capsule -- that's the actual
    // "minimize total pieces" mechanism -- but only when it's still a
    // reasonably close fit to the best fresh alternative. Without this
    // comparison, a poor-fitting already-packed item (a casual summer
    // tee for a formal, cold-weather day) would always win just because
    // it clears the lower reuse floor, even when a far better-fitting
    // fresh item sits right there unused. REUSE_TOLERANCE caps how much
    // worse a reused pick is allowed to be before the fresh one wins.
    if (bestAlreadyPacked && (!bestFresh || bestAlreadyPacked.score >= bestFresh.score - REUSE_TOLERANCE)) {
      return bestAlreadyPacked;
    }

    return bestFresh;
  }

  // Try dress-based outfit first only if it clearly beats a top+bottom
  // combo for this context (dresses aren't always the right call for
  // every occasion, so this isn't an unconditional preference).
  const dressPick = pickForCategory('dress');
  const topPick = pickForCategory('top');
  const bottomPick = pickForCategory('bottom');

  if (dressPick && (!topPick || !bottomPick || dressPick.score >= Math.min(topPick.score, bottomPick.score))) {
    chosenIds.push(dressPick.item.id);
    capsule.get('dress').add(dressPick.item.id);
    usedDressForBottomTop = true;
  } else if (topPick && bottomPick) {
    chosenIds.push(topPick.item.id, bottomPick.item.id);
    capsule.get('top').add(topPick.item.id);
    capsule.get('bottom').add(bottomPick.item.id);
  } else {
    // Neither a dress nor a full top+bottom pair is achievable.
    if (!topPick) gaps.push({ date: context.date, time: context.time, occasion: context.occasion, category: 'top', message: `No suitable top for ${context.occasion} on ${context.date}${context.weather ? ` (${Math.round(context.weather.temp)}°C)` : ''}.` });
    if (!bottomPick && !dressPick) gaps.push({ date: context.date, time: context.time, occasion: context.occasion, category: 'bottom', message: `No suitable bottom or dress for ${context.occasion} on ${context.date}.` });
    if (topPick) { chosenIds.push(topPick.item.id); capsule.get('top').add(topPick.item.id); }
    if (bottomPick) { chosenIds.push(bottomPick.item.id); capsule.get('bottom').add(bottomPick.item.id); }
  }

  const footwearPick = pickForCategory('footwear');
  if (footwearPick) {
    chosenIds.push(footwearPick.item.id);
    capsule.get('footwear').add(footwearPick.item.id);
  } else {
    gaps.push({ date: context.date, time: context.time, occasion: context.occasion, category: 'footwear', message: `No suitable footwear for ${context.date}.` });
  }

  if (needsOuterwear(context.weather)) {
    const outerwearPick = pickForCategory('outerwear');
    if (outerwearPick) {
      chosenIds.push(outerwearPick.item.id);
      capsule.get('outerwear').add(outerwearPick.item.id);
    } else {
      gaps.push({ date: context.date, time: context.time, occasion: context.occasion, category: 'outerwear', message: `No warm/rain layer available for ${context.date}${context.weather ? ` (${Math.round(context.weather.temp)}°C${context.weather.precipitation > 0.4 ? ', wet' : ''})` : ''}.` });
    }
  }

  return {
    date: context.date,
    time: context.time,
    occasion: context.occasion,
    weather: context.weather ? { temp: context.weather.temp, condition: context.weather.condition } : null,
    itemIds: chosenIds,
    items: chosenIds.map((id) => {
      const it = itemsById.get(id);
      return it ? { id: it.id, type: it.type, color: it.color } : { id };
    }),
    usedDress: usedDressForBottomTop,
  };
}

async function generatePackingList({ userId, dates, activities, destination, luggageConstraints, weatherData }) {
  const wardrobe = await Clothes.findAll({ where: { userId, isActive: true } });

  if (!activities || activities.length === 0) {
    return {
      implemented: true,
      message: 'No activities provided -- nothing to plan a capsule for yet.',
      tripWardrobe: { totalItems: 0, items: [] },
      dailyGuide: [],
      gaps: [],
      requestedFor: { userId, destination, dayCount: Array.isArray(dates) ? dates.length : 0 },
    };
  }

  if (wardrobe.length === 0) {
    return {
      implemented: true,
      message: 'Your wardrobe is empty -- add clothes before packing a trip.',
      tripWardrobe: { totalItems: 0, items: [] },
      dailyGuide: [],
      gaps: [{ date: null, category: 'wardrobe', message: 'No active wardrobe items found for this user.' }],
      requestedFor: { userId, destination, dayCount: Array.isArray(dates) ? dates.length : 0 },
    };
  }

  const weatherByDate = new Map((weatherData || []).map((w) => [w.date, w]));
  const contexts = buildDayContexts(activities, weatherByDate);
  const itemsById = new Map(wardrobe.map((item) => [item.id, item]));

  // Pre-score every item against every context once, grouped by
  // category, so assignContext() below does no repeated scoring work.
  const scoredByContextAndCategory = contexts.map(() => new Map());
  for (const item of wardrobe) {
    const category = categorize(item);
    contexts.forEach((context, idx) => {
      const score = scoreItemForContext(item, context);
      const bucket = scoredByContextAndCategory[idx];
      if (!bucket.has(category)) bucket.set(category, []);
      bucket.get(category).push({ item, score });
    });
  }

  const capsule = new Map(['top', 'bottom', 'dress', 'footwear', 'outerwear'].map((c) => [c, new Set()]));
  const gaps = [];
  const dailyGuideBySlot = contexts.map((context, idx) => assignContext(context, scoredByContextAndCategory[idx], capsule, itemsById, gaps));

  // Group the flat per-slot guide back into per-day entries for the caller.
  const dailyGuideByDate = new Map();
  for (const slot of dailyGuideBySlot) {
    if (!dailyGuideByDate.has(slot.date)) dailyGuideByDate.set(slot.date, { date: slot.date, slots: [] });
    dailyGuideByDate.get(slot.date).slots.push(slot);
  }
  const dailyGuide = Array.from(dailyGuideByDate.values());

  const allPackedIds = new Set();
  for (const set of capsule.values()) {
    for (const id of set) allPackedIds.add(id);
  }
  const tripWardrobeItems = Array.from(allPackedIds);

  const constraints = luggageConstraints || {};
  const overLimit = typeof constraints.maxItems === 'number' && tripWardrobeItems.length > constraints.maxItems;

  logger.info('Packing list generated', {
    userId,
    contexts: contexts.length,
    totalItems: tripWardrobeItems.length,
    gaps: gaps.length,
    overLuggageLimit: overLimit,
  });

  return {
    implemented: true,
    message: gaps.length > 0
      ? `Packing list generated with ${gaps.length} gap(s) flagged -- see gaps below.`
      : 'Packing list generated.',
    tripWardrobe: {
      totalItems: tripWardrobeItems.length,
      items: tripWardrobeItems,
      byCategory: Object.fromEntries(Array.from(capsule.entries()).map(([k, v]) => [k, v.size])),
    },
    dailyGuide,
    gaps,
    // Known simplification: we flag going over the requested luggage
    // limit rather than re-running assignment to force it under --
    // dropping an already-assigned item would need re-solving every
    // context it appears in, which isn't worth the complexity for a
    // first pass. The flag tells the caller (and the user) to either
    // loosen the limit or trim manually.
    luggageWarning: overLimit
      ? `Capsule needs ${tripWardrobeItems.length} items, over your ${constraints.maxItems}-item limit.`
      : null,
    requestedFor: { userId, destination, dayCount: Array.isArray(dates) ? dates.length : 0 },
  };
}

const packagingService = { generatePackingList, categorize, scoreItemForContext };

module.exports = { packagingService };
