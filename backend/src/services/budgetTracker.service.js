/**
 * Live in-trip budget tracker -- Phase 7 (PRD §3.15/§3.8). Per-category
 * (accommodation/food/activities) totals against the trip's stated
 * budget, engaging the user before they overspend rather than only
 * reporting after the fact.
 */

const { Trip, TripActivity } = require('../database/models');
const { formatPrice } = require('../utils/currency');

const CATEGORIES = ['accommodation', 'food', 'activities'];

function nudgeMessage(percentUsed, remaining, currency) {
  if (percentUsed > 100) {
    return `You're over budget by ${formatPrice(Math.abs(remaining), currency) || Math.abs(remaining)}.`;
  }
  if (percentUsed >= 90) {
    return `You're close to your budget -- only ${formatPrice(remaining, currency) || remaining} left.`;
  }
  if (percentUsed >= 70) {
    return `You've used ${Math.round(percentUsed)}% of your budget -- worth keeping an eye on it.`;
  }
  return "You're on track.";
}

async function getTripBudgetSummary(userId, tripId) {
  const trip = await Trip.findOne({ where: { id: tripId, userId } });
  if (!trip) {
    const err = new Error('Trip not found');
    err.statusCode = 404;
    throw err;
  }

  const activities = await TripActivity.findAll({
    where: { tripId },
    attributes: ['id', 'title', 'categoryBudgetTag', 'estimatedCost'],
  });

  const byCategory = { accommodation: 0, food: 0, activities: 0, uncategorized: 0 };
  for (const activity of activities) {
    const cost = Number(activity.estimatedCost || 0);
    const tag = CATEGORIES.includes(activity.categoryBudgetTag) ? activity.categoryBudgetTag : 'uncategorized';
    byCategory[tag] += cost;
  }

  const totalSpentEstimate = Object.values(byCategory).reduce((sum, v) => sum + v, 0);
  const totalBudget = trip.totalBudget != null ? Number(trip.totalBudget) : null;
  const currency = trip.budgetCurrency || 'USD';

  if (totalBudget == null) {
    return {
      hasBudget: false,
      byCategory,
      totalSpentEstimate,
      message: 'No overall budget set for this trip yet -- set one to get live tracking and nudges.',
    };
  }

  const remaining = totalBudget - totalSpentEstimate;
  const percentUsed = totalBudget > 0 ? (totalSpentEstimate / totalBudget) * 100 : 0;

  return {
    hasBudget: true,
    totalBudget,
    currency,
    byCategory,
    totalSpentEstimate,
    remaining,
    percentUsed: Math.round(percentUsed * 10) / 10,
    message: nudgeMessage(percentUsed, remaining, currency),
  };
}

module.exports = { getTripBudgetSummary };
