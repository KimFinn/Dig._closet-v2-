const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth');

/**
 * @route   POST /api/v1/notifications/checkin/respond
 * @desc    Respond to the daily "did you wear it?" check-in
 * @access  Private
 * @new     Phase 2: daily check-in
 */
router.post(
    '/checkin/respond',
    authenticate,
    notificationController.respondToCheckIn
);

module.exports = router;
