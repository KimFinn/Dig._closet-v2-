/**
 * Access/refresh token issuance + a Redis-backed refresh-token allowlist.
 *
 * Phase 0 fix: the app previously issued one long-lived JWT (24h) with no
 * refresh token at all — "refresh" just re-signed a fresh 24h token from
 * a still-valid one (self-defeating: if you already have a valid token
 * you don't need a new one, and if it's expired you couldn't call the
 * endpoint, which was gated behind the same `authenticate` middleware).
 * Logout did nothing server-side, so a leaked/stolen token stayed valid
 * for up to 24h no matter what.
 *
 * Now: a short-lived access token (JWT, stateless, used on every
 * request) plus a longer-lived refresh token (JWT with a unique `jti`,
 * tracked in Redis as an allowlist entry). Refreshing checks the jti is
 * still allowlisted, deletes it, and issues a brand new access+refresh
 * pair (rotation — a stolen refresh token that gets used once by an
 * attacker invalidates itself, since the legitimate client's next
 * refresh will find its jti already gone and can alert/force
 * re-auth). Logout deletes the jti — real revocation, not a no-op.
 */

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
const logger = require('./logger');

const ACCESS_SECRET = process.env.JWT_SECRET || 'dev-secret-key';
// Falls back to the access secret if a dedicated one isn't set, but a
// distinct secret is strongly recommended in production so an access
// token can never be replayed as a refresh token or vice versa.
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || ACCESS_SECRET;

const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
const REFRESH_EXPIRES_SEC = parseDurationToSeconds(REFRESH_EXPIRES_IN);

const REFRESH_KEY_PREFIX = 'refresh_token:';

function parseDurationToSeconds(duration) {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 7 * 24 * 60 * 60; // default 7 days if unparseable
  const value = parseInt(match[1], 10);
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[match[2]];
  return value * unit;
}

const redisClient = new Redis({
  host: process.env.REDIS_CLOUD_HOST || 'localhost',
  port: parseInt(process.env.REDIS_CLOUD_PORT || '6379', 10),
  password: process.env.REDIS_CLOUD_PASSWORD || undefined,
  lazyConnect: false,
  maxRetriesPerRequest: 2,
});

redisClient.on('error', (err) => {
  logger.error('Token store Redis error', { message: err.message });
});

function signAccessToken(user) {
  return jwt.sign({ userId: user.id, email: user.email }, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRES_IN,
  });
}

async function signRefreshToken(user) {
  const jti = uuidv4();
  const token = jwt.sign({ userId: user.id, jti }, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRES_IN,
  });
  await redisClient.set(`${REFRESH_KEY_PREFIX}${user.id}:${jti}`, '1', 'EX', REFRESH_EXPIRES_SEC);
  return token;
}

/**
 * Issue a fresh access+refresh pair for a user (register/login/rotation).
 */
async function issueTokenPair(user) {
  const accessToken = signAccessToken(user);
  const refreshToken = await signRefreshToken(user);
  return { accessToken, refreshToken };
}

/**
 * Verify a refresh token's signature/expiry AND that its jti is still
 * allowlisted in Redis (i.e. hasn't been used already or revoked by
 * logout). Throws on any failure — callers should catch and respond 401.
 */
async function verifyRefreshToken(token) {
  const decoded = jwt.verify(token, REFRESH_SECRET); // throws if invalid/expired
  const key = `${REFRESH_KEY_PREFIX}${decoded.userId}:${decoded.jti}`;
  const exists = await redisClient.get(key);
  if (!exists) {
    throw new Error('Refresh token has been revoked or already used');
  }
  return decoded;
}

/** Revoke one refresh token by its decoded {userId, jti}. */
async function revokeRefreshToken({ userId, jti }) {
  await redisClient.del(`${REFRESH_KEY_PREFIX}${userId}:${jti}`);
}

/** Revoke every refresh token for a user (e.g. "log out everywhere", password change). */
async function revokeAllRefreshTokens(userId) {
  const keys = await redisClient.keys(`${REFRESH_KEY_PREFIX}${userId}:*`);
  if (keys.length > 0) await redisClient.del(keys);
}

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: REFRESH_EXPIRES_SEC * 1000,
  path: '/api/v1/auth', // only sent back to auth endpoints, not every request
};

module.exports = {
  issueTokenPair,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_OPTIONS,
};
