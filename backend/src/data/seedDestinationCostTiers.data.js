/**
 * Phase 7 (Budget Feasibility, PRD §3.15) -- initial curated
 * cost-of-living seed. Own data, in-house, deliberately NOT Numbeo's
 * paid API (~$1250/mo, priced out during the Phase 7 brainstorm as
 * unjustified pre-traction). Figures here are illustrative starting
 * estimates meant to be reviewed/refined by a person over time (see
 * feature-roadmap-tracker Phase 7, open decision #15) -- not
 * authoritative, precisely-researched numbers. All in USD; per-day.
 *
 * A "Global" fallback row exists for any destination not yet seeded,
 * so the feasibility check always has SOMETHING reasonable to compute
 * against rather than failing outright for an unseeded country.
 */

const SEED_DESTINATION_COST_TIERS = [
  // country_or_region, tier, accommodation, food, local transport, activities
  { countryOrRegion: 'Global', tier: 'budget', dailyAccommodation: 30, dailyFood: 20, dailyLocalTransport: 8, dailyActivities: 10 },
  { countryOrRegion: 'Global', tier: 'mid', dailyAccommodation: 80, dailyFood: 45, dailyLocalTransport: 15, dailyActivities: 25 },
  { countryOrRegion: 'Global', tier: 'comfortable', dailyAccommodation: 180, dailyFood: 90, dailyLocalTransport: 30, dailyActivities: 60 },

  { countryOrRegion: 'France', tier: 'budget', dailyAccommodation: 50, dailyFood: 30, dailyLocalTransport: 10, dailyActivities: 15 },
  { countryOrRegion: 'France', tier: 'mid', dailyAccommodation: 110, dailyFood: 55, dailyLocalTransport: 15, dailyActivities: 30 },
  { countryOrRegion: 'France', tier: 'comfortable', dailyAccommodation: 250, dailyFood: 100, dailyLocalTransport: 25, dailyActivities: 70 },

  { countryOrRegion: 'Thailand', tier: 'budget', dailyAccommodation: 15, dailyFood: 10, dailyLocalTransport: 5, dailyActivities: 8 },
  { countryOrRegion: 'Thailand', tier: 'mid', dailyAccommodation: 45, dailyFood: 25, dailyLocalTransport: 10, dailyActivities: 20 },
  { countryOrRegion: 'Thailand', tier: 'comfortable', dailyAccommodation: 120, dailyFood: 55, dailyLocalTransport: 20, dailyActivities: 45 },

  { countryOrRegion: 'Japan', tier: 'budget', dailyAccommodation: 40, dailyFood: 25, dailyLocalTransport: 10, dailyActivities: 15 },
  { countryOrRegion: 'Japan', tier: 'mid', dailyAccommodation: 100, dailyFood: 50, dailyLocalTransport: 18, dailyActivities: 35 },
  { countryOrRegion: 'Japan', tier: 'comfortable', dailyAccommodation: 220, dailyFood: 95, dailyLocalTransport: 30, dailyActivities: 75 },

  { countryOrRegion: 'Iceland', tier: 'budget', dailyAccommodation: 60, dailyFood: 35, dailyLocalTransport: 12, dailyActivities: 20 },
  { countryOrRegion: 'Iceland', tier: 'mid', dailyAccommodation: 140, dailyFood: 65, dailyLocalTransport: 20, dailyActivities: 45 },
  { countryOrRegion: 'Iceland', tier: 'comfortable', dailyAccommodation: 280, dailyFood: 110, dailyLocalTransport: 35, dailyActivities: 90 },

  { countryOrRegion: 'Kenya', tier: 'budget', dailyAccommodation: 20, dailyFood: 12, dailyLocalTransport: 6, dailyActivities: 15 },
  { countryOrRegion: 'Kenya', tier: 'mid', dailyAccommodation: 55, dailyFood: 28, dailyLocalTransport: 12, dailyActivities: 35 },
  { countryOrRegion: 'Kenya', tier: 'comfortable', dailyAccommodation: 140, dailyFood: 60, dailyLocalTransport: 25, dailyActivities: 80 },

  { countryOrRegion: 'United Kingdom', tier: 'budget', dailyAccommodation: 45, dailyFood: 28, dailyLocalTransport: 12, dailyActivities: 15 },
  { countryOrRegion: 'United Kingdom', tier: 'mid', dailyAccommodation: 100, dailyFood: 50, dailyLocalTransport: 18, dailyActivities: 30 },
  { countryOrRegion: 'United Kingdom', tier: 'comfortable', dailyAccommodation: 220, dailyFood: 95, dailyLocalTransport: 30, dailyActivities: 65 },

  { countryOrRegion: 'Germany', tier: 'budget', dailyAccommodation: 40, dailyFood: 25, dailyLocalTransport: 10, dailyActivities: 12 },
  { countryOrRegion: 'Germany', tier: 'mid', dailyAccommodation: 90, dailyFood: 45, dailyLocalTransport: 15, dailyActivities: 25 },
  { countryOrRegion: 'Germany', tier: 'comfortable', dailyAccommodation: 190, dailyFood: 85, dailyLocalTransport: 25, dailyActivities: 55 },
];

module.exports = { SEED_DESTINATION_COST_TIERS };
