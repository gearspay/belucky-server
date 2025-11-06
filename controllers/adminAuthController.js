// controllers/adminAuthController.js
const User = require('../models/User');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const adminLogin = async (req, res) => {
  const { username, password } = req.body;

  // Validate input
  if (!username || !password) {
    return res.status(400).json({ 
      success: false,
      message: 'Username and password are required' 
    });
  }

  try {
    // Check if the admin exists - using case-insensitive search
    const lowercaseUsername = username.toLowerCase();
    console.log('Admin login attempt for username:', lowercaseUsername);
    
    // Find admin user (role = 1) with case-insensitive username match
    const admin = await User.findOne({ 
      username: { $regex: new RegExp(`^${lowercaseUsername}$`, 'i') },
      role: 1 // Only admin users
    });
    
    if (!admin) {
      return res.status(404).json({ 
        success: false,
        message: 'Admin user not found or insufficient privileges' 
      });
    }

    // Check if admin account is active
    if (!admin.account.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Admin account has been deactivated'
      });
    }

    // Compare the password
    const passwordCheck = await bcrypt.compare(password, admin.password);

    if (!passwordCheck) {
      return res.status(400).json({ 
        success: false,
        message: 'Incorrect password' 
      });
    }

    // Generate JWT token with admin flag
    const token = jwt.sign(
      {
        userId: admin._id,
        userUsername: admin.username,
        userRole: admin.role,
        isAdmin: true
      },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '8h' } // Shorter session for admin security
    );

    // Update last login
    await User.findByIdAndUpdate(admin._id, {
      'account.lastLogin': new Date()
    });

    // Send success response
    res.status(200).json({
      success: true,
      message: 'Admin login successful',
      data: {
        admin: {
          _id: admin._id,
          username: admin.username,
          role: admin.role,
          profile: admin.profile,
          lastLogin: new Date()
        },
        token
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in admin',
      error: error.message,
    });
  }
};

const createAdmin = async (req, res) => {
  const { username, password, email } = req.body;

  // Only allow super admin (you can add additional checks here)
  if (req.user.userRole !== 1) {
    return res.status(403).json({
      success: false,
      message: 'Insufficient privileges to create admin users'
    });
  }

  // Validate input
  if (!username || !password) {
    return res.status(400).json({ 
      success: false,
      message: 'Username and password are required' 
    });
  }

  // Username validation
  if (username.length < 3 || username.length > 20) {
    return res.status(400).json({ 
      success: false,
      message: 'Username must be between 3 and 20 characters' 
    });
  }

  // Password validation
  if (password.length < 8) {
    return res.status(400).json({ 
      success: false,
      message: 'Admin password must be at least 8 characters' 
    });
  }

  try {
    // Check if username already exists
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({ 
        success: false,
        message: 'Username already exists' 
      });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 12); // Higher salt rounds for admin

    // Create a new admin user instance
    const admin = new User({
      username: username.toLowerCase(),
      password: hashedPassword,
      role: 1, // Admin role
      'profile.email': email || '',
      'account.isActive': true
    });

    // Save the new admin to the database
    const result = await admin.save();

    // Don't send password back in response
    const adminResponse = {
      _id: result._id,
      username: result.username,
      role: result.role,
      profile: result.profile,
      createdAt: result.createdAt
    };

    res.status(201).json({
      success: true,
      message: 'Admin user created successfully',
      data: {
        admin: adminResponse
      }
    });

  } catch (error) {
    console.error('Error creating admin:', error);
    
    // Handle different types of errors
    if (error.code === 11000) { // MongoDB duplicate key error
      return res.status(409).json({
        success: false,
        message: 'Username already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating admin user',
      error: error.message,
    });
  }
};

const getAdminProfile = async (req, res) => {
  try {
    // Find admin user
    const admin = await User.findById(req.user.userId).select('-password');
    
    if (!admin || admin.role !== 1) {
      return res.status(404).json({
        success: false,
        message: 'Admin user not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Admin profile retrieved successfully',
      data: {
        admin
      }
    });
  } catch (error) {
    console.error('Error getting admin profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving admin profile',
      error: error.message
    });
  }
};

const changeAdminPassword = async (req, res) => {
  const userId = req.user.userId;
  const { oldPassword, newPassword } = req.body;

  // Validate inputs
  if (!oldPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      message: 'Current password and new password are required'
    });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      message: 'New password must be at least 8 characters long'
    });
  }

  try {
    // Find admin user
    const admin = await User.findOne({ _id: userId, role: 1 });
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin user not found'
      });
    }

    // Verify old password
    const isPasswordCorrect = await bcrypt.compare(oldPassword, admin.password);
    if (!isPasswordCorrect) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password with higher salt rounds
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await User.findByIdAndUpdate(userId, {
      password: hashedPassword
    });

    res.status(200).json({
      success: true,
      message: 'Admin password updated successfully'
    });

  } catch (error) {
    console.error('Error changing admin password:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating admin password',
      error: error.message
    });
  }
};

const updateAdminProfile = async (req, res) => {
  const userId = req.user.userId;
  const { firstName, lastName, email, phone } = req.body;

  try {
    const admin = await User.findOneAndUpdate(
      { _id: userId, role: 1 }, // Ensure it's an admin
      {
        'profile.firstName': firstName,
        'profile.lastName': lastName,
        'profile.email': email,
        'profile.phone': phone
      },
      { new: true, runValidators: true, select: '-password' }
    );

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin user not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Admin profile updated successfully',
      data: {
        admin
      }
    });
  } catch (error) {
    console.error('Error updating admin profile:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating admin profile',
      error: error.message
    });
  }
};

module.exports = {
  adminLogin,
  createAdmin,
  getAdminProfile,
  changeAdminPassword,
  updateAdminProfile
};