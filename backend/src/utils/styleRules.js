/**
 * Style Rules — rule-based outfit assembly
 *
 * Phase 0 note: this module didn't exist at all (outfitEngine.js required
 * '../utils/styleRules' but the file was missing, which crashed the whole
 * app on boot). This is a real, working implementation — not a stub —
 * because outfitEngine.generateRecommendation() calls it synchronously as
 * the last step before returning a suggestion, and it's exactly the
 * "weighted, interpretable, works from day one" rules-based scoring that
 * PRD §5 calls for as the Phase 1 baseline (before any ML-based ranking
 * sits on top of it in Phase 2).
 *
 * Input: an array of Clothes model instances (or plain objects with the
 * same shape) already filtered by occasion/weather/preferences upstream
 * in outfitEngine.js.
 *
 * Output shape consumed by outfitEngine.js:
 *   { items, colorCoordination, formalityLevel, generatedBy }
 * - items: the chosen Clothes items (outfitEngine reads .length and
 *   spreads the object, so this stays an array of full item objects,
 *   not just ids)
 * - colorCoordination: boolean, read directly by _calculateAIMetadata()
 */

// Keyword buckets for classifying the freeform `type` field into slots.
// `type` has no enum in the schema (see Clothes model), so this is
// necessarily heuristic — tighten as real tagging data comes in.
const SLOT_KEYWORDS = {
  dress: ['dress', 'gown', 'jumpsuit', 'romper'],
  top: ['shirt', 'blouse', 'top', 'tee', 't-shirt', 'sweater', 'sweatshirt', 'hoodie', 'tank', 'polo', 'cardigan'],
  bottom: ['pant', 'trouser', 'jean', 'short', 'skirt', 'legging', 'chino'],
  outerwear: ['jacket', 'coat', 'blazer', 'parka', 'windbreaker', 'vest'],
  shoes: ['shoe', 'sneaker', 'boot', 'sandal', 'heel', 'loafer', 'flat'],
  accessory: ['scarf', 'belt', 'hat', 'bag', 'jewelry', 'tie', 'sunglasses'],
};

function classifySlot(item) {
  const type = (item.type || '').toLowerCase();
  for (const [slot, keywords] of Object.entries(SLOT_KEYWORDS)) {
    if (keywords.some((kw) => type.includes(kw))) return slot;
  }
  return 'other';
}

function groupBySlot(items) {
  const groups = { dress: [], top: [], bottom: [], outerwear: [], shoes: [], accessory: [], other: [] };
  for (const item of items) {
    groups[classifySlot(item)].push(item);
  }
  return groups;
}

/**
 * Diversity score: prefer items that haven't been worn recently /
 * haven't been worn much, so the same 2-3 "safe" pieces don't get
 * suggested every day (PRD §3.3 / §5 exploration principle). Lower is
 * "more overdue to be worn" and sorts first.
 */
function recencyScore(item) {
  const wearCount = item.wearCount ?? 0;
  const lastWornAt = item.lastWornAt ? new Date(item.lastWornAt).getTime() : 0;
  // Never-worn items (lastWornAt falsy) sort first; otherwise older last-worn sorts first.
  return lastWornAt === 0 ? -1 : lastWornAt + wearCount * 1000;
}

function pickBest(candidates) {
  if (!candidates || candidates.length === 0) return null;
  return [...candidates].sort((a, b) => recencyScore(a) - recencyScore(b))[0];
}

// A small, intentionally conservative "these read as coordinated" table.
// Neutral colors coordinate with everything; everything else must either
// match or pair with a neutral to count as coordinated.
const NEUTRALS = ['black', 'white', 'gray', 'grey', 'navy', 'beige', 'tan', 'cream', 'brown', 'denim'];

function colorsCoordinate(colors) {
  const normalized = colors.filter(Boolean).map((c) => c.toLowerCase());
  if (normalized.length <= 1) return true;
  const nonNeutral = normalized.filter((c) => !NEUTRALS.includes(c));
  if (nonNeutral.length <= 1) return true; // at most one "statement" color, rest neutral
  // more than one non-neutral color: coordinated only if they're identical
  return new Set(nonNeutral).size === 1;
}

/**
 * Assemble one outfit from a pre-filtered pool of clothes.
 * @param {Array} filteredClothes - Clothes items already passed through
 *   occasion/weather/preference filters upstream.
 * @returns {{items: Array, colorCoordination: boolean, formalityLevel: string|null, generatedBy: string}}
 */
function generateOutfit(filteredClothes) {
  if (!filteredClothes || filteredClothes.length === 0) {
    return { items: [], colorCoordination: false, formalityLevel: null, generatedBy: 'rule_based_v1' };
  }

  const groups = groupBySlot(filteredClothes);
  const items = [];

  // Prefer a dress (one-piece) over top+bottom when a well-matched dress
  // is available; otherwise build top+bottom.
  const dress = pickBest(groups.dress);
  if (dress) {
    items.push(dress);
  } else {
    const top = pickBest(groups.top);
    const bottom = pickBest(groups.bottom);
    if (top) items.push(top);
    if (bottom) items.push(bottom);
  }

  const shoes = pickBest(groups.shoes);
  if (shoes) items.push(shoes);

  const outerwear = pickBest(groups.outerwear);
  if (outerwear) items.push(outerwear);

  if (items.length === 0) {
    // Nothing matched a recognizable slot — fall back to the single
    // least-recently-worn item from whatever's left rather than
    // returning nothing.
    const fallback = pickBest(filteredClothes);
    if (fallback) items.push(fallback);
  }

  const colorCoordination = colorsCoordinate(items.map((i) => i.color));

  // Rough formality read from occasion field of the chosen items, when present.
  const formalityVotes = items.map((i) => (i.occasion || '').toLowerCase()).filter(Boolean);
  const formalityLevel = formalityVotes.length > 0 ? formalityVotes[0] : null;

  return {
    items,
    colorCoordination,
    formalityLevel,
    generatedBy: 'rule_based_v1',
  };
}

module.exports = {
  generateOutfit,
  // exported for unit testing / reuse elsewhere (e.g. wardrobe gap map, §3.7)
  classifySlot,
  colorsCoordinate,
};
