/**
 * "What I know about you" dashboard -- Phase 9 (PRD §3.10).
 *
 * Applies the corrections overlay to the live-computed structuredTraits
 * for DISPLAY purposes only (the nightly job in profileSynthesis.service.js
 * always keeps computing the honest live value regardless of what's
 * suppressed/overridden here -- see that file's header comment).
 *
 * Fact-vs-preference split (2026-09-18 scoping decision):
 *   - `observed_fact` traits: only `suppress` (hide from view) or
 *     `scope_only` are valid corrections. There is no "this fact is
 *     wrong" option, because a fact-trait can't be wrong -- it's
 *     arithmetic over the user's own rows. If a fact-trait looks wrong,
 *     the real fix is correcting the underlying item's tag through the
 *     existing tag-correction flow (clothes.controller.js
 *     #correctClothingTags) -- the derived trait then self-corrects on
 *     the next nightly run.
 *   - `inferred_preference` traits: `override` (replace the value),
 *     `delete` (suppress pending a possible reversal), or `scope_only`.
 *     Legitimate, since these are the model's opinion and the user is
 *     the higher authority on their own taste.
 *   - `restore` clears any correction on either type, going back to the
 *     live computed value.
 */

const { UserProfileSummary } = require('../database/models');

function buildDisplayEntry(fresh, correction) {
  if (!correction) return { ...fresh, corrected: false };
  if (correction.correctionType === 'suppress' || correction.correctionType === 'delete') return null;
  if (correction.correctionType === 'override') {
    return { ...fresh, value: correction.overrideValue, corrected: true, correctionType: 'override' };
  }
  if (correction.correctionType === 'scope_only') {
    return { ...fresh, corrected: true, correctionType: 'scope_only', doNotUseInRecommendations: true };
  }
  return { ...fresh, corrected: false };
}

async function getVisibleProfile(userId) {
  const summary = await UserProfileSummary.findOne({ where: { userId } });
  if (!summary || !summary.computedAt) {
    return { hasProfile: false, version: 0, computedAt: null, traits: {}, hiddenTraits: [] };
  }

  const traits = {};
  const hiddenTraits = [];
  for (const [traitKey, fresh] of Object.entries(summary.structuredTraits || {})) {
    const correction = (summary.userCorrections || {})[traitKey];
    const display = buildDisplayEntry(fresh, correction);
    if (display) {
      traits[traitKey] = display;
    } else {
      hiddenTraits.push({ traitKey, pillar: fresh.pillar, traitType: fresh.traitType, correctionType: correction?.correctionType });
    }
  }

  return { hasProfile: true, version: summary.version, computedAt: summary.computedAt, traits, hiddenTraits };
}

async function correctTrait(userId, traitKey, { correctionType, overrideValue } = {}) {
  const summary = await UserProfileSummary.findOne({ where: { userId } });
  if (!summary) {
    const err = new Error('No profile summary yet -- nothing to correct. Check back after your first nightly synthesis run.');
    err.statusCode = 404;
    throw err;
  }

  const fresh = (summary.structuredTraits || {})[traitKey];
  if (!fresh) {
    const err = new Error(`Unknown trait "${traitKey}"`);
    err.statusCode = 404;
    throw err;
  }

  if (correctionType === 'restore') {
    const corrections = { ...(summary.userCorrections || {}) };
    delete corrections[traitKey];
    await summary.update({ userCorrections: corrections });
    return { traitKey, restored: true };
  }

  if (fresh.traitType === 'observed_fact' && ['override', 'delete'].includes(correctionType)) {
    const err = new Error(
      `"${traitKey}" is a fact computed directly from your own data, not an opinion -- it can't be marked wrong. ` +
        `If it looks wrong, the real fix is correcting the underlying item's tag; that will update this automatically on the next nightly run. ` +
        `You can still hide it from your summary ("suppress") or tell the app not to use it in recommendations ("scope_only").`
    );
    err.statusCode = 422;
    throw err;
  }

  // Keep the fact/preference vocabulary distinct in the API, not just
  // internally -- a preference trait is "deleted" (a real dispute,
  // reversal-eligible), a fact trait is "suppressed" (a display
  // preference only). Accept either spelling and normalize per traitType
  // so the split stays visible without being a footgun.
  let normalizedType = correctionType;
  if (fresh.traitType === 'inferred_preference' && correctionType === 'suppress') normalizedType = 'delete';
  if (fresh.traitType === 'observed_fact' && correctionType === 'delete') normalizedType = 'suppress';

  if (!['suppress', 'override', 'delete', 'scope_only'].includes(normalizedType)) {
    const err = new Error(`Unknown correctionType "${correctionType}"`);
    err.statusCode = 400;
    throw err;
  }

  if (normalizedType === 'override' && overrideValue === undefined) {
    const err = new Error('overrideValue is required for correctionType "override"');
    err.statusCode = 400;
    throw err;
  }

  const entry = { correctionType: normalizedType, correctedAt: new Date().toISOString() };
  if (normalizedType === 'override') entry.overrideValue = overrideValue;
  if (['override', 'delete'].includes(normalizedType) && fresh.traitType === 'inferred_preference') {
    entry.baselineSignal = fresh.signal ?? null;
    entry.reversalStreak = 0;
  }

  const corrections = { ...(summary.userCorrections || {}), [traitKey]: entry };
  await summary.update({ userCorrections: corrections });

  return { traitKey, correction: entry };
}

module.exports = { getVisibleProfile, correctTrait, buildDisplayEntry };
