// src/middleware/validators.js
const { body, param, validationResult } = require('express-validator');

/**
 * Handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map((err) => ({
        field: err.param,
        message: err.msg,
      })),
    });
  }

  next();
};

/**
 * Validate photo upload
 */
exports.validatePhoto = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .isString()
    .withMessage('User ID must be a string'),
  body('photoType')
    .notEmpty()
    .withMessage('Photo type is required')
    .isIn(['face', 'front_body', 'side_body', 'back_body'])
    .withMessage('Invalid photo type'),
  handleValidationErrors,
];

/**
 * Validate measurements estimation
 */
exports.validateMeasurementEstimation = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required'),
  body('referenceHeight')
    .notEmpty()
    .withMessage('Reference height is required')
    .isFloat({ min: 100, max: 250 })
    .withMessage('Height must be between 100 and 250 cm'),
  handleValidationErrors,
];

/**
 * Validate measurements update
 */
exports.validateMeasurements = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required'),
  body('measurements')
    .notEmpty()
    .withMessage('Measurements are required')
    .isObject()
    .withMessage('Measurements must be an object'),
  body('measurements.height')
    .optional()
    .isFloat({ min: 100, max: 250 })
    .withMessage('Height must be between 100 and 250 cm'),
  body('measurements.chest')
    .optional()
    .isFloat({ min: 50, max: 200 })
    .withMessage('Chest must be between 50 and 200 cm'),
  body('measurements.waist')
    .optional()
    .isFloat({ min: 40, max: 200 })
    .withMessage('Waist must be between 40 and 200 cm'),
  body('measurements.hips')
    .optional()
    .isFloat({ min: 50, max: 200 })
    .withMessage('Hips must be between 50 and 200 cm'),
  body('measurements.shoulder')
    .optional()
    .isFloat({ min: 30, max: 80 })
    .withMessage('Shoulder must be between 30 and 80 cm'),
  body('measurements.inseam')
    .optional()
    .isFloat({ min: 50, max: 120 })
    .withMessage('Inseam must be between 50 and 120 cm'),
  handleValidationErrors,
];

/**
 * Validate avatar generation
 */
exports.validateAvatarGeneration = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required'),
  body('measurements')
    .notEmpty()
    .withMessage('Measurements are required')
    .isObject()
    .withMessage('Measurements must be an object'),
  handleValidationErrors,
];

/**
 * Validate avatar ID parameter
 */
exports.validateAvatarId = [
  param('avatarId')
    .notEmpty()
    .withMessage('Avatar ID is required')
    .isUUID()
    .withMessage('Invalid avatar ID format'),
  handleValidationErrors,
];

/**
 * Validate user ID parameter
 */
exports.validateUserId = [
  param('userId')
    .notEmpty()
    .withMessage('User ID is required'),
  handleValidationErrors,
];

/**
 * Validate pagination
 */
exports.validatePagination = [
  param('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  param('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  handleValidationErrors,
];

/**
 * Validate user registration
 */
exports.validateRegister = [
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  body('fullName')
    .notEmpty()
    .withMessage('Full name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  handleValidationErrors,
];

/**
 * Validate user login
 */
exports.validateLogin = [
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Invalid email format')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors,
];

/**
 * Validate password change
 */
exports.validatePasswordChange = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number'),
  body('confirmPassword')
    .notEmpty()
    .withMessage('Password confirmation is required')
    .custom((value, { req }) => value === req.body.newPassword)
    .withMessage('Passwords do not match'),
  handleValidationErrors,
];

/**
 * Validate profile update
 */
exports.validateProfileUpdate = [
  body('fullName')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Full name must be between 2 and 100 characters'),
  handleValidationErrors,
];