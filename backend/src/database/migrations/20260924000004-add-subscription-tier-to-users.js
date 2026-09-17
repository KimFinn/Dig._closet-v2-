'use strict';

/**
 * Phase 8 (PRD §7/§3.9) -- the entire group-trip feature set (group
 * trip planning + cross-closet sharing) is gated behind the Pro tier
 * per §7's monetization plan. There is no billing/payment integration
 * anywhere in this codebase yet (Stripe or similar is future work --
 * §7 explicitly defers exact pricing), so this column is a stub in the
 * same spirit as every other credential-gated integration in this app:
 * fully functional to build and test against right now, wired to real
 * billing later. `PATCH /api/v1/auth/me/subscription` is the manual
 * stand-in for a payment webhook until then.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'subscription_tier', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'free',
      comment: 'free | plus | pro -- no billing integration yet, see migration comment',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'subscription_tier');
  },
};
