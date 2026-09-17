/**
 * "Haven't worn this in a while" resurfacing nudge -- Phase 10 (PRD
 * §3.11, scoped 2026-09-18).
 *
 * Selects at most one neglected item to nudge on in tonight's evening
 * digest. Two independent conditions gate an item:
 *   - neglected: `lastWornAt` is older than HAVENT_WORN_MONTHS (or the
 *     item has never been worn at all -- `lastWornAt` is null).
 *   - not on cooldown: `lastNudgedAt` is null, or older than
 *     NUDGE_COOLDOWN_DAYS -- so the same item isn't renominated every
 *     single night just because it stays neglected.
 *
 * Picks the single most-neglected eligible item (oldest `lastWornAt`
 * first, never-worn items last since there's no date to rank them by).
 * Calling `markNudged` is the caller's responsibility, done only once
 * the digest actually sends -- see queues/checkInQueue.js.
 */

const { Op } = require('sequelize');
const { Clothes } = require('../database/models');

const HAVENT_WORN_MONTHS = parseInt(process.env.HAVENT_WORN_MONTHS || '6', 10);
const NUDGE_COOLDOWN_DAYS = parseInt(process.env.HAVENT_WORN_NUDGE_COOLDOWN_DAYS || '30', 10);

function monthsAgo(months, now = new Date()) {
  const d = new Date(now);
  d.setMonth(d.getMonth() - months);
  return d;
}

function daysAgo(days, now = new Date()) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

async function getHavenNotWornNudge(userId, { now = new Date() } = {}) {
  const neglectedCutoff = monthsAgo(HAVENT_WORN_MONTHS, now);
  const cooldownCutoff = daysAgo(NUDGE_COOLDOWN_DAYS, now);

  const candidates = await Clothes.findAll({
    where: {
      userId,
      isActive: true,
      // Two independent OR conditions -- each needs its own Op.or, so
      // both live inside an Op.and rather than as sibling keys (two
      // [Op.or] keys in the same object literal would silently collide,
      // the second overwriting the first).
      [Op.and]: [
        { [Op.or]: [{ lastWornAt: { [Op.lt]: neglectedCutoff } }, { lastWornAt: null }] },
        { [Op.or]: [{ lastNudgedAt: { [Op.lt]: cooldownCutoff } }, { lastNudgedAt: null }] },
      ],
    },
    attributes: ['id', 'type', 'color', 'brand', 'imageUrl', 'lastWornAt', 'lastNudgedAt'],
    order: [['lastWornAt', 'ASC']], // oldest lastWornAt first; NULLs (never worn) sort last in Postgres ASC
  });

  if (candidates.length === 0) return null;

  const chosen = candidates[0];
  return {
    id: chosen.id,
    type: chosen.type,
    color: chosen.color,
    brand: chosen.brand,
    imageUrl: chosen.imageUrl,
    lastWornAt: chosen.lastWornAt,
    neverWorn: chosen.lastWornAt === null,
  };
}

async function markNudged(itemId, { now = new Date() } = {}) {
  await Clothes.update({ lastNudgedAt: now }, { where: { id: itemId } });
}

module.exports = { getHavenNotWornNudge, markNudged, HAVENT_WORN_MONTHS, NUDGE_COOLDOWN_DAYS };
