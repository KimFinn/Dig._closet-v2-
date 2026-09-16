/**
 * Google / Apple ID-token verification for the "token verification" OAuth
 * flow: the frontend uses each provider's own native SDK to sign the user
 * in directly and gets back a signed ID token, which it sends to this API
 * (POST /api/v1/auth/google or /apple). This service verifies that token's
 * signature, issuer, audience and expiry against the provider's own public
 * keys — never trusting anything the client claims about the user beyond
 * what's inside the verified token — and returns a small, normalized
 * profile for the controller to find-or-create a User from. No redirects,
 * no server-side session/state; this is stateless from the API's side.
 */

const { OAuth2Client } = require('google-auth-library');
const appleSignin = require('apple-signin-auth');
const logger = require('../utils/logger');

const GOOGLE_CLIENT_IDS = (process.env.GOOGLE_CLIENT_ID || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const APPLE_CLIENT_IDS = (process.env.APPLE_CLIENT_ID || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

const googleClient = new OAuth2Client();

function isGoogleConfigured() {
  return GOOGLE_CLIENT_IDS.length > 0;
}

function isAppleConfigured() {
  return APPLE_CLIENT_IDS.length > 0;
}

/**
 * Verify a Google ID token and return a normalized profile.
 * Throws (with a client-safe .message and .statusCode) on any failure.
 */
async function verifyGoogleIdToken(idToken) {
  if (!isGoogleConfigured()) {
    const err = new Error('Google sign-in is not configured on this server (GOOGLE_CLIENT_ID unset)');
    err.statusCode = 503;
    throw err;
  }
  if (!idToken || typeof idToken !== 'string') {
    const err = new Error('idToken is required');
    err.statusCode = 400;
    throw err;
  }

  let ticket;
  try {
    ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_IDS,
    });
  } catch (e) {
    logger.warn('Google ID token verification failed', { message: e.message });
    const err = new Error('Invalid Google ID token');
    err.statusCode = 401;
    throw err;
  }

  const payload = ticket.getPayload();
  if (!payload || !payload.sub || !payload.email) {
    const err = new Error('Google ID token missing required claims');
    err.statusCode = 401;
    throw err;
  }
  if (payload.email_verified === false) {
    const err = new Error('Google account email is not verified');
    err.statusCode = 401;
    throw err;
  }

  return {
    providerId: payload.sub,
    email: payload.email,
    fullName: payload.name || payload.email.split('@')[0],
  };
}

/**
 * Verify an Apple identity token and return a normalized profile.
 *
 * Apple only includes `email` on the very first sign-in for a given app
 * (a real address or a private-relay one, depending on the user's
 * choice) and omits it on every subsequent one. The user's name never
 * appears in the ID token at all — Apple sends it once, out of band, in
 * the native SDK's authorization credential on that same first sign-in.
 * Callers must treat `email`/`fullName` as possibly absent here and not
 * assume Apple will ever hand them over again.
 */
async function verifyAppleIdToken(idToken) {
  if (!isAppleConfigured()) {
    const err = new Error('Apple sign-in is not configured on this server (APPLE_CLIENT_ID unset)');
    err.statusCode = 503;
    throw err;
  }
  if (!idToken || typeof idToken !== 'string') {
    const err = new Error('idToken is required');
    err.statusCode = 400;
    throw err;
  }

  let payload;
  try {
    payload = await appleSignin.verifyIdToken(idToken, {
      audience: APPLE_CLIENT_IDS,
      ignoreExpiration: false,
    });
  } catch (e) {
    logger.warn('Apple ID token verification failed', { message: e.message });
    const err = new Error('Invalid Apple ID token');
    err.statusCode = 401;
    throw err;
  }

  if (!payload || !payload.sub) {
    const err = new Error('Apple ID token missing required claims');
    err.statusCode = 401;
    throw err;
  }

  return {
    providerId: payload.sub,
    email: payload.email || null,
    fullName: null,
  };
}

module.exports = {
  verifyGoogleIdToken,
  verifyAppleIdToken,
  isGoogleConfigured,
  isAppleConfigured,
};
