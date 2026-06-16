const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

/**
 * Authenticate JWT token
 * For development: Can be disabled or simplified
 */
exports.authenticate = (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'No authorization token provided',
      });
    }

    // Extract token (format: "Bearer <token>")
    const token = authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization format',
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key');

    // Attach user info to request
    req.user = decoded;

    logger.info('User authenticated', {
      userId: decoded.userId,
      email: decoded.email,
    });

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token',
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired',
      });
    }

    logger.error('Authentication error', error);
    res.status(500).json({
      success: false,
      message: 'Authentication failed',
    });
  }
};

/**
 * Optional authentication
 * Attaches user if token is valid, but allows request to proceed without it
 */
exports.optionalAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader) {
      const token = authHeader.split(' ')[1];

      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key');
        req.user = decoded;
      }
    }

    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};

/**
 * Check if user owns the resource
 */
exports.checkOwnership = (userIdField = 'userId') => {
  return (req, res, next) => {
    const resourceUserId = req.params[userIdField] || req.body[userIdField];
    const requestUserId = req.user.userId;

    if (resourceUserId !== requestUserId) {
      logger.warn('Unauthorized access attempt', {
        requestUserId,
        resourceUserId,
        path: req.path,
      });

      return res.status(403).json({
        success: false,
        message: 'You do not have permission to access this resource',
      });
    }

    next();
  };
};

/**
 * Development bypass (disable auth for testing)
 * Set DISABLE_AUTH=true in .env
 */
exports.devBypass = (req, res, next) => {
  if (process.env.DISABLE_AUTH === 'true') {
    // Mock user for development
    req.user = {
      userId: req.body.userId || req.params.userId || 'dev-user',
      email: 'dev@example.com',
    };
    logger.warn('Auth disabled for development');
    return next();
  }

  exports.authenticate(req, res, next);
};