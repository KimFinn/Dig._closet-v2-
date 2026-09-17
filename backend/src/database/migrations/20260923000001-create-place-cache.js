'use strict';

/**
 * Phase 7 (Trip Activities, Places, Destination Intelligence & Budgeting,
 * PRD §3.8) -- the PERMANENT, ToS-compliant slice of the Places cache.
 *
 * Verified against Google's current terms while scoping this phase
 * (2026-09): `place_id` is explicitly exempt from the Places API caching
 * restrictions and may be stored indefinitely; latitude/longitude may be
 * cached for up to 30 consecutive calendar days (Maps Platform Service
 * Specific Terms §14.3). Full place details -- name, address, rating,
 * price level, photos -- have NO caching exception at all, at any
 * duration. That's why this table stores only place_id + coordinates,
 * never full details: it's the one part of "cache what Google returns"
 * that's actually allowed, and it's genuinely useful on its own (internal
 * history, dedup, click-tracking -- same spirit as the clickId-embedding
 * pattern from Phase 5's affiliate links).
 *
 * Full place details are fetched fresh per real display, backed only by
 * a short (~1hr) operational Redis cache in places.service.js -- NOT
 * stored here, and deliberately not extended to a longer TTL (see PRD
 * §3.8 -- a longer TTL on restricted content doesn't fix the compliance
 * problem, since the prohibition isn't duration-based).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('place_cache', {
      id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.UUIDV4,
        primaryKey: true,
      },
      place_id: {
        type: Sequelize.STRING(255),
        allowNull: false,
        comment: 'Google Places place_id -- exempt from caching restrictions, stored indefinitely',
      },
      latitude: { type: Sequelize.DECIMAL(9, 6), allowNull: true },
      longitude: { type: Sequelize.DECIMAL(9, 6), allowNull: true },
      query_key: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: 'Normalized search that first surfaced this place, e.g. "hotels in paris" -- for dedup/debugging only, not itself cached content',
      },
      first_seen_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP'),
      },
    });

    await queryInterface.addIndex('place_cache', ['place_id'], {
      name: 'idx_place_cache_place_id',
      unique: true,
    });
    await queryInterface.addIndex('place_cache', ['query_key'], {
      name: 'idx_place_cache_query_key',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('place_cache');
  },
};
