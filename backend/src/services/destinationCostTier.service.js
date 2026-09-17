/**
 * Curated cost-tier seeding -- Phase 7 (PRD §3.15). Same idempotent
 * seed pattern as destinationCulture.service.js: only fills in rows
 * that don't exist yet, never overwrites a manually-edited one.
 */

const { DestinationCostTier } = require('../database/models');
const { SEED_DESTINATION_COST_TIERS } = require('../data/seedDestinationCostTiers.data');

async function seedDestinationCostTiers() {
  let created = 0;
  for (const entry of SEED_DESTINATION_COST_TIERS) {
    const [, wasCreated] = await DestinationCostTier.findOrCreate({
      where: { countryOrRegion: entry.countryOrRegion, tier: entry.tier },
      defaults: { ...entry, lastUpdated: new Date() },
    });
    if (wasCreated) created++;
  }
  return { seeded: SEED_DESTINATION_COST_TIERS.length, created };
}

module.exports = { seedDestinationCostTiers };
