// routes/adminSpinRoutes.js
const express = require('express');
const router = express.Router();
const adminSpinController = require('../controllers/adminSpinWheelController');
const adminAuthMiddleware = require('../middleware/adminMiddleware'); // Your admin auth middleware

// Apply admin authentication to all routes
router.use(adminAuthMiddleware);

// SPIN REWARDS CRUD

// Get all spin rewards with filters
router.get('/rewards', adminSpinController.getAllSpinRewards);

// Get single spin reward
router.get('/rewards/:rewardId', adminSpinController.getSpinReward);

// Update spin reward status
router.put('/rewards/:rewardId/status', adminSpinController.updateRewardStatus);

// Delete spin reward (soft delete)
router.delete('/rewards/:rewardId', adminSpinController.deleteSpinReward);

// SPIN CONFIGURATION CRUD

// Get current spin configuration
router.get('/config', adminSpinController.getSpinConfig);

// Update spin configuration
router.put('/config', adminSpinController.updateSpinConfig);

// ANALYTICS & REPORTS

// Get spin analytics
router.get('/analytics', adminSpinController.getSpinAnalytics);

// Get detailed reports
router.get('/reports', adminSpinController.getDetailedReports);

// Export spin data
router.get('/export', adminSpinController.exportSpinData);

// USER MANAGEMENT

// Get users with spin history
router.get('/users', adminSpinController.getUsersWithSpins);

// Get specific user's spin history
router.get('/users/:userId/spins', adminSpinController.getUserSpinHistory);

// Reset user's daily spin (emergency use)
router.post('/users/:userId/reset-spin', adminSpinController.resetUserSpin);

// Add this line
   router.put('/settings', adminSpinController.updateGlobalSettings);

module.exports = router;