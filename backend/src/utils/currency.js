/**
 * Currency display formatting -- Phase 5 (Gap-to-Purchase Funnel), Task
 * #39.
 *
 * This is explicitly display-only, per how the user scoped it: a matched
 * product is shown in whatever currency its own feed row gave it (a
 * Kenyan retailer's product shows KES, a German one shows EUR), with NO
 * live FX conversion to the user's own currency -- that's a real product
 * decision (which rate source, how often refreshed, rounding rules) that
 * was explicitly deferred rather than guessed at here. All this does is
 * turn {price: 68, currency: 'EUR'} into a readable string.
 */

const CURRENCY_SYMBOLS = {
  USD: '$',
  EUR: '€',
  GBP: '£',
};

/**
 * @param {number|string|null} price
 * @param {string|null} currency - ISO 4217-ish code, e.g. 'USD', 'KES'.
 * @returns {string|null} e.g. "$68.00", "3,200 KES" -- null if price is missing.
 */
function formatPrice(price, currency) {
  if (price === null || price === undefined) return null;
  const amount = Number(price);
  if (Number.isNaN(amount)) return null;

  const symbol = currency ? CURRENCY_SYMBOLS[currency.toUpperCase()] : null;
  if (symbol) {
    return `${symbol}${amount.toFixed(2)}`;
  }
  // No known symbol (e.g. KES) -- show the amount with the ISO code
  // instead of guessing at a symbol we're not sure of.
  const rounded = Number.isInteger(amount) ? amount.toLocaleString('en-US') : amount.toFixed(2);
  return currency ? `${rounded} ${currency}` : String(rounded);
}

module.exports = { formatPrice, CURRENCY_SYMBOLS };
