/**
 * Curated cultural-context reads/seeding -- Phase 7 (PRD §3.15). Kept
 * deliberately separate from destinationAdvisory.service.js (dynamic
 * safety data, ingested live) since culture doesn't need re-fetching --
 * this is our own curated content, seeded once and expanded over time
 * by a person, not a scraped/ingested feed.
 */

const { DestinationCulture } = require('../database/models');
const { SEED_DESTINATION_CULTURE } = require('../data/seedDestinationCulture.data');

/**
 * Idempotent -- safe to call on every boot (mirrors the ingestion-job
 * upsert pattern elsewhere in this app). Only fills in rows that don't
 * exist yet; never overwrites a manually-edited row, since the person
 * curating this table over time (roadmap open decision #15) should
 * always win over the seed.
 */
async function seedDestinationCulture() {
  let created = 0;
  for (const entry of SEED_DESTINATION_CULTURE) {
    const [, wasCreated] = await DestinationCulture.findOrCreate({
      where: { country: entry.country },
      defaults: { ...entry, lastUpdated: new Date() },
    });
    if (wasCreated) created++;
  }
  return { seeded: SEED_DESTINATION_CULTURE.length, created };
}

async function getCultureForCountry(country) {
  if (!country) return { available: false, message: 'No destination country given.' };
  const row = await DestinationCulture.findOne({ where: { country } });
  if (!row) {
    return {
      available: false,
      message: `We don't have curated cultural notes for ${country} yet.`,
    };
  }
  return {
    available: true,
    country: row.country,
    summary: row.summary,
    nativeToForeignerNotes: row.nativeToForeignerNotes,
    lastUpdated: row.lastUpdated,
  };
}

module.exports = { seedDestinationCulture, getCultureForCountry };
