/**
 * Grounded life-twin chatbot -- Phase 9 (PRD §3.10).
 *
 * "Grounded, not freestyled": every answer is built from the full
 * current structured summary plus a fixed recent-stats bundle, always
 * handed to the model as context regardless of the question asked -- no
 * LLM-driven evidence selection (2026-09-18 scoping decision).
 *
 * Honesty-over-agreeableness rule (2026-09-18 scoping discussion,
 * prompted by a concrete case -- a user hiding "you own mostly black
 * clothing" shouldn't make the chatbot able to deny owning black
 * clothing if asked directly):
 *   - `observed_fact` traits ALWAYS use the live computed value here,
 *     regardless of any `suppress` correction. Suppression only ever
 *     limits what profileNarrative.service.js / profileDashboard.
 *     service.js volunteer UNPROMPTED -- never what the chatbot says
 *     when the user asks a direct question. A `scope_only` correction
 *     is passed through as an instruction not to use the fact when
 *     shaping a suggestion, which is a different thing from hiding it.
 *   - `inferred_preference` traits are different: an `override`/`delete`
 *     correction there is the user's own self-report replacing the
 *     model's opinion, not a fact being hidden -- there's no truth being
 *     obscured, since the user is the authority on their own taste. So
 *     these ARE honored even in direct answers.
 *
 * Confidence-aware: if there isn't enough data (no summary yet, or every
 * visible trait's confidence is below CHATBOT_MIN_CONFIDENCE), the
 * chatbot says so rather than guessing, and never calls the LLM for that
 * turn -- this is also the interim mechanism used before any real
 * query-gating shape exists (gating shape itself is explicitly deferred,
 * see feature-roadmap-tracker.md Phase 9/Phase 11).
 */

const Anthropic = require('@anthropic-ai/sdk');
const { Op } = require('sequelize');
const { UserProfileSummary, Clothes, Trip } = require('../database/models');
const logger = require('../utils/logger');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || null;
const CHATBOT_MODEL = process.env.PROFILE_CHATBOT_MODEL || 'claude-3-5-haiku-20241022';
const MIN_CONFIDENCE = parseFloat(process.env.CHATBOT_MIN_CONFIDENCE || '0.3');

let warnedNoKey = false;
function isLive() {
  if (!ANTHROPIC_API_KEY && !warnedNoKey) {
    logger.warn('ANTHROPIC_API_KEY not configured -- chatbot answers will use a plain templated dump of the trait data, not LLM-narrated phrasing.');
    warnedNoKey = true;
  }
  return !!ANTHROPIC_API_KEY;
}

async function buildRecentStatsBundle(userId) {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [wardrobeItemCount, tripsPlannedLast90Days] = await Promise.all([
    Clothes.count({ where: { userId, isActive: true } }),
    Trip.count({ where: { userId, isActive: true, createdAt: { [Op.gte]: ninetyDaysAgo } } }),
  ]);
  return { wardrobeItemCount, tripsPlannedLast90Days };
}

function buildTraitForChatbot(fresh, correction) {
  if (fresh.traitType === 'observed_fact') {
    const entry = { ...fresh };
    if (correction?.correctionType === 'scope_only') entry.doNotUseInRecommendations = true;
    return entry; // a 'suppress' correction is intentionally NOT applied here -- see header comment
  }
  // inferred_preference
  if (correction?.correctionType === 'delete') return null; // the user disclaimed this opinion -- omit, don't state it
  if (correction?.correctionType === 'override') {
    return { ...fresh, value: correction.overrideValue, userCorrected: true };
  }
  if (correction?.correctionType === 'scope_only') {
    return { ...fresh, doNotUseInRecommendations: true };
  }
  return fresh;
}

async function buildChatbotContext(userId) {
  const summary = await UserProfileSummary.findOne({ where: { userId } });
  const stats = await buildRecentStatsBundle(userId);

  if (!summary || !summary.structuredTraits) {
    return { traits: {}, stats, maxConfidence: 0 };
  }

  const traits = {};
  let maxConfidence = 0;
  for (const [traitKey, fresh] of Object.entries(summary.structuredTraits)) {
    const correction = (summary.userCorrections || {})[traitKey];
    const entry = buildTraitForChatbot(fresh, correction);
    if (entry) {
      traits[traitKey] = entry;
      maxConfidence = Math.max(maxConfidence, entry.confidence || 0);
    }
  }
  return { traits, stats, maxConfidence };
}

function buildTemplatedAnswer(context) {
  const lines = Object.entries(context.traits).map(([key, t]) => `${key}: ${JSON.stringify(t.value)}`).slice(0, 6);
  if (lines.length === 0) {
    return "I don't have enough data about you yet to answer that confidently.";
  }
  return `I can't phrase a natural answer to that specific question right now (no LLM key configured), but here's what your data shows: ${lines.join(' | ')}.`;
}

async function answerQuestion(userId, question) {
  if (!question || !question.trim()) {
    const err = new Error('question is required');
    err.statusCode = 400;
    throw err;
  }

  const context = await buildChatbotContext(userId);

  if (context.maxConfidence < MIN_CONFIDENCE) {
    return {
      answer: "I don't have enough history yet to answer that confidently -- keep using the app (uploading your wardrobe, planning trips, wearing/rating outfits) and I'll have more to go on soon.",
      confidenceAware: true,
      live: false,
    };
  }

  if (!isLive()) {
    return { answer: buildTemplatedAnswer(context), confidenceAware: false, live: false };
  }

  try {
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: CHATBOT_MODEL,
      max_tokens: 250,
      system:
        'You are a grounded assistant answering a question about the user\'s own style, travel, spending, and occasion habits inside a wardrobe app. ' +
        'Answer using ONLY the JSON context given below -- never use outside knowledge about what people are "usually" like, and never invent a fact, number, or habit that is not present in the context. ' +
        'If the context does not contain enough information to answer the question, say so honestly rather than guessing. ' +
        'State facts neutrally and factually -- never as an argument, and never framed as correcting the user\'s self-image. ' +
        'A trait marked doNotUseInRecommendations may still be stated as fact if asked about directly, but must never be used to shape an outfit or trip suggestion.',
      messages: [{
        role: 'user',
        content: `Context:\n${JSON.stringify(context, null, 2)}\n\nQuestion: ${question}\n\nAnswer now.`,
      }],
    });
    const text = message.content?.[0]?.text?.trim();
    if (!text) throw new Error('Empty LLM response');
    return { answer: text, confidenceAware: false, live: true };
  } catch (error) {
    logger.warn('Chatbot LLM call failed, falling back to templated answer', { error: error.message });
    return { answer: buildTemplatedAnswer(context), confidenceAware: false, live: false };
  }
}

module.exports = { answerQuestion, buildChatbotContext, buildRecentStatsBundle };
