const bcrypt = require('bcrypt');
const {v4: uuidv4} = require('uuid');
const {User} = require('../database/models');
const logger = require('../utils/logger');
const oauthService = require('../services/oauth.service');
const {
    issueTokenPair,
    verifyRefreshToken,
    revokeRefreshToken,
    revokeAllRefreshTokens,
    REFRESH_COOKIE_NAME,
    REFRESH_COOKIE_OPTIONS,
} = require('../utils/tokens');

const PROVIDER_ID_FIELD = { google: 'googleId', apple: 'appleId' };

/**
 * Find the User for a verified OAuth profile, creating one if this is
 * the first sign-in and linking the provider to an existing
 * password/other-provider account if the (provider-verified) email
 * already matches one — so a person who registered with a password and
 * later taps "Sign in with Google" using the same address lands on the
 * same account instead of silently getting a second one.
 */
async function findOrCreateOAuthUser(provider, profile) {
    const idField = PROVIDER_ID_FIELD[provider];
    const { providerId, email, fullName } = profile;

    let user = await User.findOne({ where: { [idField]: providerId } });
    if (user) return user;

    if (email) {
        user = await User.findOne({ where: { email } });
        if (user) {
            // Existing account, first time signing in with this
            // provider — link it rather than creating a duplicate.
            user[idField] = providerId;
            await user.save();
            return user;
        }
    }

    // Brand new user. `email` can be null on a non-first Apple sign-in
    // (Apple only ever discloses it once) — without it we can't create
    // a normal account, since `email` is NOT NULL. This should be rare
    // in practice (the frontend only hits this path on first sign-in),
    // but surface it clearly rather than crashing on a DB constraint.
    if (!email) {
        const err = new Error(
            'No email available from this sign-in to create an account. ' +
            'This usually means Apple has already used its one-time email disclosure for this app/account — try a password account or contact support.'
        );
        err.statusCode = 422;
        throw err;
    }

    user = await User.create({
        id: uuidv4(),
        email,
        password: null,
        fullName: fullName || email.split('@')[0],
        isActive: true,
        [idField]: providerId,
    });
    logger.info(`New user registered via ${provider} OAuth: ${email}`);
    return user;
}

class AuthController {
    // User Registration
    async register(req,res,next) {
        try {
            const {email,password,fullName} = req.body;
            //Check if user already exists
            const existingUser = await User.findOne({where: {email}});
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    message: 'Email already exists'
                });
            }

            //Hash the password
            const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 10);
            const hashedPassword = await bcrypt.hash(password,salt);

            //Create new user
            const newUser = await User.create({
                id: uuidv4(),
                email,
                password: hashedPassword,
                fullName,
                isActive: true
            });

            logger.info(`New user registered: ${email}`);

             res.status(201).json({
                success: true,
                message: 'User registered successfully',
                user: {
                    id: newUser.id,
                    email: newUser.email,
                    fullName: newUser.fullName,
                    createdAt: newUser.createdAt
                }
            });
        } catch (error) {
            logger.error('Error during user registration:', error);
            next(error);
        }
    }

    // User Login
    async login(req,res,next) {
        try {
            const {email,password} = req.body;

            //Find user by email
            const user = await User.findOne({where: {email}});
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password'
                });
            }

            //Check if user is active
            if (!user.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'User account is inactive. Please contact support.'
                });
            }

            // Verify password. OAuth-only users (signed up via Google/Apple)
            // have password === null — bcrypt.compare would throw on a
            // null hash, so this is checked explicitly rather than let
            // it surface as a 500.
            if (!user.password) {
                return res.status(401).json({
                    success: false,
                    message: 'This account uses Google or Apple sign-in — there is no password to log in with.'
                });
            }
            const isPasswordValid = await bcrypt.compare(password,user.password);
            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid email or password'
                });
            }

            //Update last login
            await user.update({lastLogin: new Date()});

            // Phase 0 fix: was a single 24h JWT with no refresh token at
            // all. Now a short-lived access token (returned in the body,
            // for the client to hold in memory/send as a Bearer header)
            // plus a rotating refresh token (set as an httpOnly cookie —
            // never exposed to JS — see utils/tokens.js).
            const { accessToken, refreshToken } = await issueTokenPair(user);
            res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTIONS);

            logger.info(`User logged in: ${email}`);

            res.status(200).json({
                success: true,
                message: 'Login successful',
               data: {
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    createdAt: user.createdAt,
                    lastLogin: user.lastLogin
                },
                token: accessToken,
                // Also returned in the body (not just the cookie) for
                // non-browser clients (mobile apps) that can't rely on
                // cookie storage.
                refreshToken,
            },
            });
        } catch (error) {
            logger.error('Error during user login:', error);
            next(error);
        }
    }

    /**
   * Get current user profile
   */
  async getProfile(req, res, next) {
    try {
      const userId = req.user.userId;

      const user = await User.findByPk(userId, {
        attributes: ['id', 'email', 'fullName', 'createdAt', 'lastLogin', 'isActive'],
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      res.json({
        success: true,
        data: {
          user,
        },
      });
    } catch (error) {
      logger.error('Get profile error:', error);
      next(error);
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(req, res, next) {
    try {
      const userId = req.user.userId;
      const { fullName } = req.body;

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Update allowed fields
      if (fullName !== undefined) {
        user.fullName = fullName;
      }

      await user.save();

      logger.info('Profile updated', { userId });

      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
          },
        },
      });
    } catch (error) {
      logger.error('Update profile error:', error);
      next(error);
    }
  }

  /**
   * Change password
   */
  async changePassword(req, res, next) {
    try {
      const userId = req.user.userId;
      const { currentPassword, newPassword } = req.body;

      const user = await User.findByPk(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Verify current password.
      // Bug fix (found while wiring up refresh tokens, not a Phase 0
      // boot issue but in the same file/area): the Sequelize model's JS
      // attribute is `password` (mapped to the `password_hash` column
      // via `field:`), not `passwordHash` — `user.passwordHash` was
      // always undefined, so this compare always failed and the update
      // below never touched a real column. Change-password has never
      // worked.
      const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Current password is incorrect',
        });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 10);
      const newPasswordHash = await bcrypt.hash(newPassword, salt);

      // Update password
      await user.update({ password: newPasswordHash });

      // Changing your password should invalidate every other session's
      // refresh token, not just leave them all valid until they expire.
      await revokeAllRefreshTokens(userId);

      logger.info('Password changed', { userId });

      res.json({
        success: true,
        message: 'Password changed successfully. Please log in again.',
      });
    } catch (error) {
      logger.error('Change password error:', error);
      next(error);
    }
  }

  /**
   * Logout — Phase 0 fix: this used to do nothing server-side (a
   * stolen/leaked token stayed valid until it naturally expired, up to
   * 24h). Now it actually revokes the refresh token's jti in Redis, so
   * it can never be used again, and clears the cookie.
   */
  async logout(req, res, next) {
    try {
      const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

      if (token) {
        try {
          const decoded = await verifyRefreshToken(token);
          await revokeRefreshToken(decoded);
        } catch (e) {
          // Already invalid/expired/revoked — fine, logout's goal
          // (this token no longer works) is already satisfied.
          logger.info('Logout: refresh token already invalid', { message: e.message });
        }
      }

      res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_OPTIONS.path });
      logger.info('User logged out', { userId: req.user?.userId });

      res.json({
        success: true,
        message: 'Logout successful',
      });
    } catch (error) {
      logger.error('Logout error:', error);
      next(error);
    }
  }

  /**
   * Google sign-in / sign-up — POST /api/v1/auth/google, body { idToken }.
   * Frontend uses Google's native SDK to sign the user in and passes the
   * resulting ID token here; it's verified against Google's own public
   * keys (services/oauth.service.js), then mapped to a User the same way
   * password login is, issuing the same access+refresh token pair.
   */
  async googleAuth(req, res, next) {
    try {
      const { idToken } = req.body;
      const profile = await oauthService.verifyGoogleIdToken(idToken);
      const user = await findOrCreateOAuthUser('google', profile);

      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: 'User account is inactive. Please contact support.',
        });
      }

      await user.update({ lastLogin: new Date() });

      const { accessToken, refreshToken } = await issueTokenPair(user);
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTIONS);

      logger.info(`User signed in via Google: ${user.email}`);

      res.status(200).json({
        success: true,
        message: 'Google sign-in successful',
        data: {
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
          },
          token: accessToken,
          refreshToken,
        },
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      logger.error('Google auth error:', error);
      next(error);
    }
  }

  /**
   * Apple sign-in / sign-up — POST /api/v1/auth/apple, body { idToken }.
   * Same shape as googleAuth; see services/oauth.service.js for the
   * caveats specific to Apple's identity token (email only disclosed on
   * first sign-in, name never in the token at all).
   */
  async appleAuth(req, res, next) {
    try {
      const { idToken } = req.body;
      const profile = await oauthService.verifyAppleIdToken(idToken);
      const user = await findOrCreateOAuthUser('apple', profile);

      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          message: 'User account is inactive. Please contact support.',
        });
      }

      await user.update({ lastLogin: new Date() });

      const { accessToken, refreshToken } = await issueTokenPair(user);
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTIONS);

      logger.info(`User signed in via Apple: ${user.email}`);

      res.status(200).json({
        success: true,
        message: 'Apple sign-in successful',
        data: {
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            createdAt: user.createdAt,
            lastLogin: user.lastLogin,
          },
          token: accessToken,
          refreshToken,
        },
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      logger.error('Apple auth error:', error);
      next(error);
    }
  }

  /**
   * Refresh token — Phase 0 fix: this used to require a still-valid
   * access token (via the `authenticate` middleware on this route,
   * removed in auth.routes.js) to hand back another 24h token, which is
   * backwards — the whole point of a refresh endpoint is to get a new
   * access token once the old one has expired. Now it takes the refresh
   * token itself (httpOnly cookie, or body for non-browser clients),
   * verifies it against the Redis allowlist, and rotates: the old jti
   * is consumed and a brand new access+refresh pair is issued.
   */
  async refreshToken(req, res, next) {
    try {
      const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Refresh token required',
        });
      }

      let decoded;
      try {
        decoded = await verifyRefreshToken(token);
      } catch (e) {
        res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_OPTIONS.path });
        return res.status(401).json({
          success: false,
          message: 'Invalid or expired refresh token',
        });
      }

      const user = await User.findByPk(decoded.userId);
      if (!user || !user.isActive) {
        return res.status(401).json({
          success: false,
          message: 'Invalid token',
        });
      }

      // Rotation: consume the used refresh token before issuing a new
      // pair, so it can't be replayed even if it leaks.
      await revokeRefreshToken(decoded);
      const { accessToken, refreshToken } = await issueTokenPair(user);
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, REFRESH_COOKIE_OPTIONS);

      res.json({
        success: true,
        message: 'Token refreshed',
        data: { token: accessToken, refreshToken },
      });
    } catch (error) {
      logger.error('Refresh token error:', error);
      next(error);
    }
  }
}

module.exports = new AuthController();