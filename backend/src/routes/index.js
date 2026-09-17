const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const clothesRoutes = require('./clothes.routes');
const outfitRoutes = require('./outfit.routes');
const tripRoutes = require('./trip.routes');
const preferenceRoutes = require('./userPreference.routes');
const notificationRoutes = require('./notification.routes');
const gapPurchaseRoutes = require('./gapPurchase.routes');
// Phase 7 (Trip Activities, Places, Destination Intelligence & Budgeting)
const outingRoutes = require('./outing.routes');
const destinationRoutes = require('./destination.routes');
const budgetRoutes = require('./budget.routes');
// Phase 8 (Group Trips & Hybrid Group Outfits)
const closetShareRoutes = require('./closetShare.routes');
const participantInviteRoutes = require('./participantInvite.routes');
// Phase 9 (Digital Life-Twin & Grounded Chatbot)
const profileRoutes = require('./profile.routes');
const chatbotRoutes = require('./chatbot.routes');

// Mount routes
router.use('/auth', authRoutes);
router.use('/clothes',clothesRoutes);
router.use('/outfit',outfitRoutes);
router.use('/trip',tripRoutes);
router.use("/UserPreference",preferenceRoutes);
router.use('/notifications', notificationRoutes);
router.use('/gap-recommendations', gapPurchaseRoutes);
router.use('/outing', outingRoutes);
router.use('/destination', destinationRoutes);
router.use('/budget', budgetRoutes);
router.use('/closet-shares', closetShareRoutes);
router.use('/invites', participantInviteRoutes);
router.use('/profile', profileRoutes);
router.use('/chatbot', chatbotRoutes);

// API info endpoint
router.get('/', (req, res) => {
  res.json({
    message: 'Wardrobe System API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/v1/auth',
      clothes: '/api/v1/clothes',
      outfit: '/api/v1/outfit',
      trip: '/api/v1/trip',
      UserPreference: '/api/v1/UserPreference'
    },
    documentation: '/api/v1/docs',
  });
});

module.exports = router;