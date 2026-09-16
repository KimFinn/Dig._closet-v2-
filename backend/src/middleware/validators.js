// src/middleware/validators.js
//
// Phase 0 fix: this file mixed two validation libraries — express-validator
// here, Joi in outfit.controller.js/clothes.controller.js. Standardizing on
// Joi since those two controllers already had real, detailed schemas in
// use; porting this file's four auth validators (register/login/
// password-change/profile-update) to Joi was far less churn than the
// reverse. The photo/measurement/avatar-generation/avatar-id/userId/
// pagination validators that used to live here were never wired to any
// route — dead code left over from what looks like a prior AR/avatar
// try-on project (see package.json's original "avatar/3d/ar/try-on"
// keywords) — so they're deleted rather than ported.
const Joi = require('joi');

/**
 * Generic Express middleware factory: validates `req[source]` against a
 * Joi schema, responding 400 with field-level detail on failure (same
 * response shape the rest of the API already uses), or replacing
 * `req[source]` with the validated/coerced value on success.
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map((d) => ({
          field: d.path.join('.'),
          message: d.message,
        })),
      });
    }

    req[source] = value;
    next();
  };
}

const passwordRule = Joi.string()
  .min(6)
  .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  .messages({
    'string.min': '{{#label}} must be at least 6 characters long',
    'string.pattern.base':
      '{{#label}} must contain at least one uppercase letter, one lowercase letter, and one number',
  });

const registerSchema = Joi.object({
  email: Joi.string().email().required().label('Email'),
  password: passwordRule.required().label('Password'),
  fullName: Joi.string().min(2).max(100).required().label('Full name'),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required().label('Email'),
  password: Joi.string().required().label('Password'),
});

const passwordChangeSchema = Joi.object({
  currentPassword: Joi.string().required().label('Current password'),
  newPassword: passwordRule.required().label('New password'),
  confirmPassword: Joi.string()
    .required()
    .valid(Joi.ref('newPassword'))
    .label('Password confirmation')
    .messages({ 'any.only': 'Passwords do not match' }),
});

const profileUpdateSchema = Joi.object({
  fullName: Joi.string().min(2).max(100).optional(),
});

// Both Google and Apple's native sign-in SDKs hand the frontend a signed
// ID token; that's the only thing these two endpoints need from the
// client — everything else (email, name, provider user id) comes out of
// the token itself once verified server-side (see services/oauth.service.js).
const oauthSchema = Joi.object({
  idToken: Joi.string().required().label('ID token'),
});

module.exports = {
  validate,
  validateRegister: validate(registerSchema),
  validateLogin: validate(loginSchema),
  validatePasswordChange: validate(passwordChangeSchema),
  validateProfileUpdate: validate(profileUpdateSchema),
  validateOAuth: validate(oauthSchema),
};
