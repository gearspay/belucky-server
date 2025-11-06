// routes/adminAuthRoutes.js
const express = require('express');
const {
  adminLogin,
  createAdmin,
  getAdminProfile,
  changeAdminPassword,
  updateAdminProfile
} = require('../controllers/adminAuthController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Middleware to check if user is admin
const adminMiddleware = (req, res, next) => {
  if (req.user.userRole !== 1) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin privileges required.'
    });
  }
  next();
};

// @route   POST /api/admin/login
// @desc    Admin login
// @access  Public
router.post('/login', adminLogin);

// @route   POST /api/admin/create-admin
// @desc    Create new admin user (super admin only)
// @access  Private (Admin only)
router.post('/create-admin', authMiddleware, adminMiddleware, createAdmin);

// @route   GET /api/admin/profile
// @desc    Get admin profile
// @access  Private (Admin only)
router.get('/profile', authMiddleware, adminMiddleware, getAdminProfile);

// @route   PUT /api/admin/profile
// @desc    Update admin profile
// @access  Private (Admin only)
router.put('/profile', authMiddleware, adminMiddleware, updateAdminProfile);

// @route   PUT /api/admin/change-password
// @desc    Change admin password
// @access  Private (Admin only)
router.put('/change-password', authMiddleware, adminMiddleware, changeAdminPassword);

module.exports = router;