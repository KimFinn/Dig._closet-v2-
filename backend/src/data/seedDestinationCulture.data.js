/**
 * Phase 7 (Destination Intelligence, PRD §3.15) -- initial curated
 * cultural-context seed. Deliberately small, deliberately cautious:
 * general, verifiable-in-spirit etiquette notes rather than sweeping
 * generalizations about a whole country's people. Meant to be reviewed
 * and expanded by an actual person over time (see feature-roadmap
 * open decision #15) -- this seed is a starting point, not a finished
 * product.
 *
 * nativeToForeignerNotes intentionally stays general and low-risk
 * (tipping/greeting/dress-code conventions, general visitor reception)
 * rather than asserting specific claims about how "natives feel about
 * foreigners" that no seed data could responsibly assert with
 * confidence.
 */

const SEED_DESTINATION_CULTURE = [
  {
    country: 'France',
    summary: 'Greetings matter -- a polite "bonjour"/"bonsoir" on entering a shop is expected. Meals are unhurried; asking for the check quickly can read as rude.',
    nativeToForeignerNotes: 'Visitors are generally welcomed, especially when making an effort to greet people in French first. Formality (vous vs. tu) is noticed and appreciated with strangers and service staff.',
  },
  {
    country: 'Japan',
    summary: 'Punctuality and quiet public behavior are strongly valued. Tipping is not customary and can cause confusion. Removing shoes indoors is standard in many settings.',
    nativeToForeignerNotes: 'Visitors are generally treated with patience and courtesy; direct confrontation is rare, so polite indirectness in service interactions is normal, not a sign of a problem.',
  },
  {
    country: 'Germany',
    summary: 'Punctuality is taken seriously for both social and business plans. Direct, plain-spoken communication is the norm, not rudeness.',
    nativeToForeignerNotes: 'Visitors are generally received matter-of-factly rather than with overt warmth up front; this is a communication-style difference, not unfriendliness.',
  },
  {
    country: 'United Arab Emirates',
    summary: 'Modest dress is expected in public and religious sites, especially outside tourist zones. Public displays of affection are frowned upon. Friday is the main day of rest.',
    nativeToForeignerNotes: 'Visitors are generally welcomed given the country\'s large expatriate and tourism economy, but local laws and customs around dress, alcohol, and public behavior are actively enforced, not just cultural preference.',
  },
  {
    country: 'Thailand',
    summary: 'The monarchy is treated with deep respect; criticism of it is both a serious social taboo and, per Thai law, illegal. Feet are considered the "lowest" body part -- avoid pointing them at people or Buddha images.',
    nativeToForeignerNotes: 'Visitors are generally warmly received ("mai pen rai" -- no worries -- is a common attitude), and a calm, non-confrontational manner in disagreements is valued and expected.',
  },
  {
    country: 'Italy',
    summary: 'Meals follow a distinct structure and timing (lunch/dinner run later than in much of Northern Europe); cappuccino after 11am is a minor faux pas locally, though tourists are rarely judged harshly for it.',
    nativeToForeignerNotes: 'Visitors are generally welcomed warmly, especially when showing genuine interest in local food and regional identity, which is a significant source of local pride.',
  },
  {
    country: 'Kenya',
    summary: 'Greetings are important and often longer/more personal than a quick hello -- rushing through them can seem cold. Bargaining is expected in markets, not in fixed-price shops.',
    nativeToForeignerNotes: 'Visitors are generally received with hospitality; Swahili greetings, even basic ones, are well received as a sign of respect and effort.',
  },
  {
    country: 'South Korea',
    summary: 'Age and social hierarchy influence greeting/address customs (bowing, two-handed gestures for elders). Shoes are typically removed indoors.',
    nativeToForeignerNotes: 'Visitors are generally treated politely and helpfully, particularly when showing basic effort with customs like bowing or two-handed giving/receiving.',
  },
];

module.exports = { SEED_DESTINATION_CULTURE };
