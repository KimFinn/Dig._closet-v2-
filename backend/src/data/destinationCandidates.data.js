/**
 * Phase 7 (Trip Activities & Places, PRD §3.8) -- curated destination
 * shortlist backing Mode B (open-ended leisure planning: "the user
 * hasn't fully decided a destination"). Same pattern already used
 * elsewhere in this codebase for data that's stable enough to curate
 * rather than needing a live third-party API (mockProductFeed.data.js,
 * destination cost/culture tables) -- there's no clean external
 * "recommend me a destination" API to depend on, and this is exactly
 * the kind of slow-changing reference data a small in-house table
 * suits.
 *
 * climate: coarse per-destination climate character used to match
 * against a requested "vibe" (warm/cold/mild) and, loosely, a month —
 * warmMonths/coldMonths are Northern/Southern-hemisphere-aware (e.g.
 * Cape Town is warm in December, London is not).
 */

const DESTINATION_CANDIDATES = [
  { country: 'Thailand', city: 'Bangkok', climate: 'warm', warmMonths: [11, 12, 1, 2, 3], interestTags: ['nightlife', 'shopping', 'dining', 'sightseeing'] },
  { country: 'Portugal', city: 'Lisbon', climate: 'mild', warmMonths: [6, 7, 8, 9], interestTags: ['sightseeing', 'dining', 'relaxation', 'beach'] },
  { country: 'South Africa', city: 'Cape Town', climate: 'warm', warmMonths: [11, 12, 1, 2], interestTags: ['hiking', 'sightseeing', 'beach', 'relaxation'] },
  { country: 'Iceland', city: 'Reykjavik', climate: 'cold', warmMonths: [6, 7, 8], interestTags: ['hiking', 'sightseeing', 'relaxation'] },
  { country: 'Japan', city: 'Tokyo', climate: 'mild', warmMonths: [4, 5, 9, 10], interestTags: ['sightseeing', 'shopping', 'dining', 'museums'] },
  { country: 'Mexico', city: 'Tulum', climate: 'warm', warmMonths: [11, 12, 1, 2, 3, 4], interestTags: ['beach', 'relaxation', 'nightlife'] },
  { country: 'Italy', city: 'Rome', climate: 'mild', warmMonths: [5, 6, 9, 10], interestTags: ['sightseeing', 'museums', 'dining'] },
  { country: 'Kenya', city: 'Nairobi', climate: 'warm', warmMonths: [12, 1, 2, 3], interestTags: ['hiking', 'sightseeing', 'relaxation'] },
  { country: 'Norway', city: 'Bergen', climate: 'cold', warmMonths: [6, 7, 8], interestTags: ['hiking', 'sightseeing'] },
  { country: 'Australia', city: 'Sydney', climate: 'warm', warmMonths: [12, 1, 2, 3], interestTags: ['beach', 'nightlife', 'sightseeing', 'relaxation'] },
  { country: 'United Arab Emirates', city: 'Dubai', climate: 'warm', warmMonths: [11, 12, 1, 2, 3], interestTags: ['shopping', 'nightlife', 'sightseeing'] },
  { country: 'France', city: 'Paris', climate: 'mild', warmMonths: [5, 6, 9], interestTags: ['museums', 'dining', 'sightseeing', 'shopping'] },
  { country: 'Vietnam', city: 'Hanoi', climate: 'warm', warmMonths: [10, 11, 12, 1, 2, 3], interestTags: ['dining', 'sightseeing', 'hiking'] },
  { country: 'Peru', city: 'Cusco', climate: 'mild', warmMonths: [5, 6, 7, 8, 9], interestTags: ['hiking', 'sightseeing'] },
  { country: 'Greece', city: 'Santorini', climate: 'warm', warmMonths: [6, 7, 8, 9], interestTags: ['beach', 'relaxation', 'dining', 'sightseeing'] },
];

module.exports = { DESTINATION_CANDIDATES };
