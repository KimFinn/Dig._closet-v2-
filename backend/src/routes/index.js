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

// Mount routes
router.use('/auth', authRoutes);
router.use('/clothes',clothesRoutes);
router.use('/outfit',outfitRoutes);
router.use('/trip',tripRoutes);
router.use("/UserPreference",preferenceRoutes);
router.use('/notifications', notificationRoutes);
router.use('/gap-recommendations', gapPurchaseRoutes);

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