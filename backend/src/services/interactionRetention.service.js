/**
 * Raw `UserInteraction` retention -- Phase 9 (PRD §3.10, §8 item 4,
 * resolved 2026-09-18).
 *
 * A real scheduled purge job, not just a stated policy: deletes raw
 * interaction events older than the retention window. This is
 * deliberately scoped to `UserInteraction` ONLY -- `UserProfileSummary`
 * (the distilled structured traits + narrative) is a separate, computed
 * output and is never touched here; it persists indefinitely until the
 * user deletes an individual trait via the dashboard or deletes their
 * account. Raw input has a retention clock; the computed output doesn't.
 */

const { Op } = require('sequelize');
const { UserInteraction } = require('../database/models');
const logger = require('../utils/logger');

const DEFAULT_RETENTION_DAYS = parseInt(process.env.INTERACTION_RETENTION_DAYS || '90', 10);

async function purgeOldInteractions({ retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const deletedCount = await UserInteraction.destroy({ where: { createdAt: { [Op.lt]: cutoff } } });

  logger.info('Raw UserInteraction retention purge complete', {
    retentionDays,
    cutoff: cutoff.toISOString(),
    deletedCount,
  });

  return { deletedCount, cutoff, retentionDays };
}

module.exports = { purgeOldInteractions, DEFAULT_RETENTION_DAYS };
