const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const {
  validateRegister,
  validateLogin,
  validatePasswordChange,
  validateProfileUpdate,
  validateOAuth,
} = require('../middleware/validators');

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register', validateRegister, authController.register);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', validateLogin, authController.login);

/**
 * @route   POST /api/v1/auth/google
 * @desc    Sign in/up with a Google ID token (frontend uses Google's own
 *          SDK to obtain it — see services/oauth.service.js)
 * @access  Public
 */
router.post('/google', validateOAuth, authController.googleAuth);

/**
 * @route   POST /api/v1/auth/apple
 * @desc    Sign in/up with an Apple identity token (frontend uses Sign
 *          in with Apple's own SDK to obtain it)
 * @access  Public
 */
router.post('/apple', validateOAuth, authController.appleAuth);

/**
 * @route   GET /api/v1/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', authenticate, authController.getProfile);

/**
 * @route   PUT /api/v1/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put('/profile', authenticate, validateProfileUpdate, authController.updateProfile);

/**
 * @route   POST /api/v1/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post('/change-password', authenticate, validatePasswordChange, authController.changePassword);

/**
 * @route   POST /api/v1/auth/refresh-token
 * @desc    Exchange a refresh token (cookie or body) for a new access
 *          token + rotated refresh token.
 * @access  Public — intentionally NOT behind `authenticate`. The access
 *          token has usually already expired by the time this is
 *          called; the refresh token itself (verified inside the
 *          controller against the Redis allowlist) is the credential.
 */
router.post('/refresh-token', authController.refreshToken);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Revoke the caller's refresh token (real server-side logout).
 * @access  Public — not gated behind `authenticate`: the access token
 *          may well already be expired when the user logs out, and the
 *          thing actually being revoked is the refresh token/cookie.
 */
router.post('/logout', authController.logout);

module.exports = router;