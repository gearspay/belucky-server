// routes/adminDataRoutes.js
const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const adminMiddleware = require('../middleware/adminMiddleware');
const adminDataController = require('../controllers/adminDataController');

const router = express.Router();

// Apply auth and admin middleware to all routes
router.use(authMiddleware);
router.use(adminMiddleware);

// ================================
// DASHBOARD & ANALYTICS
// ================================

// @route   GET /api/admin-data/stats
// @desc    Get dashboard statistics with recent users and transactions
// @access  Private/Admin
router.get('/stats', adminDataController.getStats);

// @route   GET /api/admin-data/chart-data
// @desc    Get chart data for deposits/withdrawals (today, week, month, custom)
// @access  Private/Admin
// @query   ?period=today|week|month|custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
router.get('/chart-data', adminDataController.getChartData);

// ================================
// USERS MANAGEMENT
// ================================

// @route   GET /api/admin-data/users
// @desc    Get users list with pagination and filters
// @access  Private/Admin
router.get('/users', adminDataController.getUsers);

// ================================
// TRANSACTIONS MANAGEMENT
// ================================

// @route   GET /api/admin-data/transactions
// @desc    Get transactions with advanced filtering
// @access  Private/Admin
// @query   ?page=1&limit=50&type=deposit|withdrawal&status=pending|completed|failed&paymentMethod=crypto|cashapp|chime&dateRange=lastWeek|lastMonth|lastYear|all
router.get('/transactions', adminDataController.getTransactions);

// @route   GET /api/admin-data/transactions/:transactionId
// @desc    Get single transaction details
// @access  Private/Admin
router.get('/transactions/:transactionId', adminDataController.getTransactionDetails);

// ================================
// WITHDRAWAL MANAGEMENT
// ================================

// @route   POST /api/admin-data/withdrawals/approve
// @desc    Approve/confirm withdrawal request
// @access  Private/Admin
// @body    { walletId, transactionId }
router.post('/withdrawals/approve', adminDataController.approveWithdrawal);


router.post('/deposits/manual-complete', adminDataController.manualCompleteDeposit);

// @route   POST /api/admin-data/withdrawals/reject
// @desc    Reject withdrawal request and refund to user
// @access  Private/Admin
// @body    { walletId, transactionId, reason }
router.post('/withdrawals/reject', adminDataController.rejectWithdrawal);

// ================================
// GAMES & WALLET STATS
// ================================

// @route   GET /api/admin-data/games-stat
// @desc    Get games with player counts and revenue
// @access  Private/Admin
router.get('/games-stat', adminDataController.getGames);

// @route   GET /api/admin-data/wallet-stats
// @desc    Get wallet system statistics
// @access  Private/Admin
router.get('/wallet-stats', adminDataController.getWalletStats);

// ================================
// DEBUG & UTILITY ROUTES
// ================================

// @route   GET /api/admin-data/user/:userId/wallet
// @desc    Get specific user's wallet (debug)
// @access  Private/Admin
router.get('/user/:userId/wallet', adminDataController.getUserWallet);

// @route   GET /api/admin-data/debug/users-with-wallets
// @desc    Debug: Get users with wallet structures
// @access  Private/Admin
router.get('/debug/users-with-wallets', adminDataController.getDebugUsersWithWallets);

// @route   PUT /api/admin-data/users/:userId/status
// @desc    Update user status (activate/suspend)
// @access  Private/Admin
router.put('/users/:userId/status', adminDataController.updateUserStatus);

// @route   GET /api/admin-data/users/:userId
// @desc    Get user details with transaction stats
// @access  Private/Admin
router.get('/users/:userId', adminDataController.getUserDetails);

module.exports = router;