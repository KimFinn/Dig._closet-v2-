/**
 * Packaging Service — capsule-style trip packing
 *
 * STATUS: not implemented. This is a deliberate Phase 0 placeholder, not
 * a bug fix pretending to be a feature.
 *
 * tripService.js required './packaging.service' at module load time and
 * the file didn't exist at all, which crashed the whole app on boot
 * (trip.controller.js -> trip.routes.js -> routes/index.js -> server.js).
 * Fixing that require is a Phase 0 boot issue. The actual capsule-packing
 * algorithm described in PRD §3.4 (minimize total pieces reused across a
 * trip, gap detection, etc.) is explicitly Phase 3 scope — building it
 * now would be exactly the premature feature-building the kickoff prompt
 * said not to do.
 *
 * This stub keeps the require graph intact and lets every other trip
 * endpoint (create/list/get/update/delete/getActiveTrip, none of which
 * touch packing) work from Phase 1 onward. Only the packing-list step
 * inside tripService.createTrip()/regeneratePackingList() will return
 * this "not implemented" shape until Phase 3 replaces the body below
 * with real logic — the exported function signature and the shape of
 * `tripWardrobe`/`dailyGuide` below match what tripService.js already
 * expects (see its `packingListResult.tripWardrobe.totalItems` /
 * `.items` and `packingListResult.dailyGuide.length` reads), so Phase 3
 * can implement this in place without changing any caller.
 */

async function generatePackingList({ userId, dates, activities, destination, luggageConstraints, weatherData }) {
  return {
    implemented: false,
    message: 'Packing list generation is Phase 3 scope and is not built yet.',
    tripWardrobe: {
      totalItems: 0,
      items: [],
    },
    dailyGuide: [],
    // Echoed back for debugging/visibility, not used for anything yet.
    requestedFor: { userId, destination, dayCount: Array.isArray(dates) ? dates.length : 0 },
  };
}

const packagingService = { generatePackingList };

module.exports = { packagingService };
