/**
 * Phase 7 (Trip Activities & Places, PRD §3.8) -- deterministic mock
 * Places fixture, used by places.service.js whenever PLACES_API_KEY
 * isn't configured (same credential-gated pattern as
 * mockProductFeed.data.js in Phase 5). Deterministic so tests are
 * reproducible: the same query always produces the same place_ids.
 */

function slugify(text) {
  return String(text || 'place')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'place';
}

/**
 * @param {string} query - free-text search, e.g. "hotels in paris" or "clothing store"
 * @param {object} [near] - { lat, lng } hint, purely cosmetic for mock coordinates
 * @param {number} [count=3]
 */
function generateMockPlaces(query, near = null, count = 3) {
  const slug = slugify(query);
  const baseLat = near && typeof near.lat === 'number' ? near.lat : 48.8566;
  const baseLng = near && typeof near.lng === 'number' ? near.lng : 2.3522;

  return Array.from({ length: count }, (_, i) => ({
    placeId: `mock-place-${slug}-${i + 1}`,
    name: `${query.charAt(0).toUpperCase()}${query.slice(1)} Spot ${i + 1}`,
    latitude: Number((baseLat + i * 0.004).toFixed(6)),
    longitude: Number((baseLng + i * 0.004).toFixed(6)),
    rating: Number((4.0 + (i % 3) * 0.2).toFixed(1)),
    priceLevel: (i % 3) + 1,
    formattedAddress: `${i + 1} Example Street, Mock City`,
    types: [slug.replace(/-/g, '_')],
  }));
}

module.exports = { generateMockPlaces };
