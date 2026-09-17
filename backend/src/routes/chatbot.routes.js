const express = require('express');
const router = express.Router();
const Joi = require('joi');
const ChatbotController = require('../controllers/chatbot.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validators');
const { requireTier } = require('../middleware/subscription');

const askSchema = Joi.object({ question: Joi.string().min(1).max(1000).required() });

// @route POST /api/v1/chatbot/ask
// Pro-gated per §7 ("Pro: life-twin chatbot") -- this is the CALLER's
// own tier, not a resource-owner check like Phase 8's, since the
// chatbot only ever answers about the caller's own data. Gating shape
// (a free daily cap vs. unlimited Pro) is deliberately deferred
// (2026-09-18 scoping, tied to real billing) -- this Pro-only gate is
// the interim mechanism, not a final pricing decision. See
// feature-roadmap-tracker.md Phase 9 / Phase 11.
router.post('/ask', authenticate, requireTier('pro'), validate(askSchema), ChatbotController.ask);

module.exports = router;
