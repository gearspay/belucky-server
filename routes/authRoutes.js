// routes/authRoutes.js
const express = require('express');
const {
  register,
  login,
  changePassword,
  changePin,
  getCurrentUser,
  updateProfile
} = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', register);

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', login);

// @route   GET /api/auth/me
// @desc    Get current user data
// @access  Private
router.get('/me', authMiddleware, getCurrentUser);

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', authMiddleware, updateProfile);

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put('/change-password', authMiddleware, changePassword);

// @route   PUT /api/auth/change-pin
// @desc    Change/set withdrawal PIN
// @access  Private
router.put('/change-pin', authMiddleware, changePin);

module.exports = router;