/**
 * Notification delivery — Phase 2.
 *
 * Email via Resend (https://resend.com): a real free tier (100/day,
 * 3,000/month as of when this was written) that's actually still free
 * in 2026 — SendGrid dropped its free plan in 2025, which was the
 * obvious alternative. Scales to a paid plan with the same API/SDK when
 * volume grows past the free tier, so nothing here needs to change,
 * just the account.
 *
 * Deliberately email-only for now, not push: this repo has no mobile
 * client code to check for push-token registration against, and a push
 * provider (Firebase Cloud Messaging, Expo push, etc.) only works once
 * a client app is registering device tokens. Every call site below goes
 * through `sendNotification(user, payload)` rather than calling Resend
 * directly, so adding a push channel later is "add a case to the
 * switch", not a rewrite of the callers.
 *
 * Graceful degradation matches weather.service.js's own pattern: no
 * RESEND_API_KEY configured (e.g. local dev before the account exists)
 * logs the content that would have been sent and returns sent:false
 * instead of throwing — a missing notification should never fail the
 * request or job that triggered it.
 */

const logger = require('../utils/logger');

let resendClient = null;
function getResendClient() {
  if (!process.env.RESEND_API_KEY) return null;
  if (!resendClient) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

const FROM_ADDRESS = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
const FRONTEND_URL = process.env.FRONTEND_URL || '';

async function sendEmail({ to, subject, html }) {
  const client = getResendClient();

  if (!client) {
    logger.info('RESEND_API_KEY not set — logging email instead of sending', { to, subject });
    return { sent: false, reason: 'no_api_key' };
  }

  try {
    const result = await client.emails.send({ from: FROM_ADDRESS, to, subject, html });
    if (result.error) {
      logger.warn('Resend accepted the request but reported an error', { to, error: result.error });
      return { sent: false, reason: result.error.message || 'resend_error' };
    }
    return { sent: true, id: result.data?.id };
  } catch (error) {
    // A notification failure should never break whatever triggered it
    // (a batch job, a request handler) -- log and move on.
    logger.warn('Email send failed', { to, subject, error: error.message });
    return { sent: false, reason: error.message };
  }
}

/**
 * Placeholder for the push channel (PRD's "notification" side of the
 * daily check-in doesn't have to be email forever). Not wired to
 * anything yet since there's no client registering device tokens.
 */
async function sendPush(/* user, payload */) {
  logger.info('Push notifications are not configured yet — skipping (email is the only channel for now)');
  return { sent: false, reason: 'push_not_configured' };
}

/**
 * The one function callers use. `channel` defaults to email since
 * that's the only one that actually works right now.
 */
async function sendNotification(user, { subject, html }, channel = 'email') {
  if (channel === 'push') return sendPush(user, { subject, html });
  if (!user?.email) return { sent: false, reason: 'no_email_on_user' };
  return sendEmail({ to: user.email, subject, html });
}

function dailyCheckInEmail(user) {
  const appLink = FRONTEND_URL || '#';
  const firstName = (user.fullName || '').split(' ')[0] || 'there';
  return {
    subject: 'Did you wear something from your wardrobe today?',
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${firstName},</h2>
        <p>Quick check-in: what did you wear today?</p>
        <p>Telling us takes a few seconds and helps your outfit recommendations get better over time.</p>
        <p><a href="${appLink}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Log today's outfit</a></p>
        <p style="color:#888;font-size:12px;margin-top:24px;">
          You're getting this because daily check-ins are on for your account.
          You can turn them off any time in your notification settings.
        </p>
      </div>
    `,
  };
}

/**
 * Phase 3: sent by queues/tripMaintenanceQueue.js when the forecast for
 * an upcoming/active trip has drifted enough since the packing list was
 * generated that it auto-regenerated the list. `changes` is an array of
 * { date, oldTemp, newTemp, oldCondition, newCondition } for the days
 * that actually drifted (not every day of the trip).
 */
function tripReplanEmail(user, trip, changes) {
  const appLink = FRONTEND_URL || '#';
  const firstName = (user.fullName || '').split(' ')[0] || 'there';
  const destination = trip.destination || 'your trip';

  const changeRows = (changes || [])
    .map((c) => {
      const dateLabel = new Date(c.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `<li>${dateLabel}: ${Math.round(c.oldTemp)}°C ${c.oldCondition} → ${Math.round(c.newTemp)}°C ${c.newCondition}</li>`;
    })
    .join('');

  return {
    subject: `Forecast changed for ${destination} — your packing list was updated`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${firstName},</h2>
        <p>The forecast for <strong>${destination}</strong> shifted enough that we regenerated your packing list:</p>
        <ul>${changeRows}</ul>
        <p><a href="${appLink}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Review updated packing list</a></p>
        <p style="color:#888;font-size:12px;margin-top:24px;">
          You're getting this because you have an upcoming or active trip with packing recommendations enabled.
        </p>
      </div>
    `,
  };
}

/**
 * Phase 5: "did you end up buying it?" self-report, sent for a
 * gap-purchase suggestion the user clicked through on but hasn't been
 * confirmed as purchased yet (either self-reported or via network
 * conversion reconciliation). Faster signal than waiting on the
 * network's own delayed conversion reporting -- see
 * affiliateConversion.service.js.
 */
function gapPurchaseCheckInEmail(user, gapDetails) {
  const appLink = FRONTEND_URL || '#';
  const firstName = (user.fullName || '').split(' ')[0] || 'there';
  const category = gapDetails?.category || 'item';
  return {
    subject: `Did you end up getting that ${category}?`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Hi ${firstName},</h2>
        <p>You checked out a ${category} we suggested a little while ago. Did you end up buying it?</p>
        <p><a href="${appLink}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px;">Let us know</a></p>
        <p style="color:#888;font-size:12px;margin-top:24px;">
          You're getting this because you clicked through a purchase suggestion recently.
        </p>
      </div>
    `,
  };
}

module.exports = {
  sendNotification,
  dailyCheckInEmail,
  tripReplanEmail,
  gapPurchaseCheckInEmail,
  // exported for tests / direct use if ever needed
  sendEmail,
  sendPush,
};
