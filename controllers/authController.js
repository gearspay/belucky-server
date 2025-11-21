// controllers/authController.js
const User = require('../models/User');
const Referral = require('../models/Referral');
const Wallet = require('../models/Wallet');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {
  const role = 2;
  const { username, password = 'user', affiliateUsername } = req.body;
  console.log(req.body);

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
  if (password.length < 6) {
    return res.status(400).json({ 
      success: false,
      message: 'Password must be at least 6 characters' 
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
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create a new user instance (without affiliateId initially)
    const user = new User({
      username: username.toLowerCase(),
      password: hashedPassword,
      role
    });

    // Save the new user to the database
    const newUser = await user.save();

    // ✅ AWARD $5 SIGNUP BONUS TO EVERY NEW USER (IN BONUS WALLET)
    try {
      const newUserWallet = await Wallet.findOrCreateWallet(newUser._id);
      newUserWallet.addTransaction({
        type: 'bonus',
        amount: 3,
        description: 'Welcome signup bonus',
        status: 'completed',
        isBonus: true,
        metadata: {
          source: 'signup_bonus',
          rewardType: 'welcome_bonus'
        }
      });
      await newUserWallet.save();
      console.log('✅ $3 signup bonus awarded to new user');
    } catch (signupBonusError) {
      console.error('Error awarding signup bonus:', signupBonusError);
    }

    // Handle referral code if provided
    let referralApplied = false;
    let referralCode = null;
    console.log('Referral code provided:', affiliateUsername);
    
    if (affiliateUsername) {
      try {
        // Find the TEMPLATE referral (where referredUserId is null)
        const referralTemplate = await Referral.findOne({
          referralCode: affiliateUsername.toUpperCase(),
          referredUserId: null // IMPORTANT: Only find templates
        }).populate('referrerId', 'username');

        if (!referralTemplate) {
          console.log('Invalid referral code provided:', affiliateUsername);
        } else {
          // Check if user is trying to refer themselves
          if (referralTemplate.referrerId._id.toString() === newUser._id.toString()) {
            console.log('User tried to refer themselves');
          } else {
            // Check if this user has already been referred
            const alreadyReferred = await Referral.findOne({
              referredUserId: newUser._id
            });

            if (alreadyReferred) {
              console.log('User has already been referred');
            } else {
              // Update the user with affiliate information
              await User.findByIdAndUpdate(newUser._id, {
                affiliateId: referralTemplate.referrerId._id
              });

              // CREATE A NEW referral record for this specific referred user
              const newReferral = await Referral.create({
                referrerId: referralTemplate.referrerId._id,
                referredUserId: newUser._id,
                referralCode: affiliateUsername.toUpperCase(),
                status: 'pending',
                rewards: {
                  referrerReward: 0,
                  referredReward: 5,
                  rewardType: 'percentage'
                },
                conditions: {
                  minDeposit: 10,
                  minGamesPlayed: 1,
                  maxRewardDeposits: 5
                },
                metadata: {
                  referredUserIP: req.ip,
                  referredUserAgent: req.get('User-Agent'),
                  referralSource: 'registration',
                  depositCount: 0,
                  totalReferralEarnings: 0
                }
              });

              // ✅ NO IMMEDIATE BONUS - Referrer gets rewards later when this user deposits
              // The referral bonus will be processed by processDepositReferral() in referralController

              referralApplied = true;
              referralCode = affiliateUsername.toUpperCase();
              console.log('Referral applied successfully:', referralCode);
            }
          }
        }
      } catch (referralError) {
        console.error('Error processing referral:', referralError);
      }
    }

    // Don't send password back in response
    const userResponse = {
      _id: newUser._id,
      username: newUser.username,
      role: newUser.role,
      affiliateId: newUser.affiliateId || null,
    };

    res.status(201).json({
      success: true,
      message: referralApplied ? 
        `User created successfully with referral code ${referralCode}! $5 signup bonus added to your wallet.` : 
        'User created successfully! $5 signup bonus added to your wallet.',
      data: {
        user: userResponse,
        referralApplied,
        signupBonus: 5
      }
    });

  } catch (error) {
    console.error('Error creating user:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Username already exists',
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error creating user',
      error: error.message,
    });
  }
};

const login = async (req, res) => {
  const { username, password } = req.body;

  // Validate input
  if (!username || !password) {
    return res.status(400).json({ 
      success: false,
      message: 'Username and password are required' 
    });
  }

  try {
    // Check if the user exists - using case-insensitive search
    const lowercaseUsername = username.toLowerCase();
    console.log('username (lowercase):', lowercaseUsername);
    
    const user = await User.findOne({ 
      username: { $regex: new RegExp(`^${lowercaseUsername}$`, 'i') } 
    });
    console.log('User found:', user ? 'Yes' : 'No');
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: 'Username not found' 
      });
    }

    // Check if account is active
    if (!user.account.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Account has been deactivated'
      });
    }

    // Compare the password
    const passwordCheck = await bcrypt.compare(password, user.password);

    if (!passwordCheck) {
      return res.status(400).json({ 
        success: false,
        message: 'Incorrect password' 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user._id,
        userUsername: user.username,
        userRole: user.role
      },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '24h' }
    );

    // Update last login
    await User.findByIdAndUpdate(user._id, {
      'account.lastLogin': new Date()
    });

    console.log('Sending login response with profile:', user.profile);

    // Send success response with complete user data
    res.status(200).json({
      success: true,
      message: 'Login Successful',
      data: {
        user: {
          _id: user._id,
          username: user.username,
          role: user.role,
          wallet: user.wallet,
          profile: {
            firstName: user.profile?.firstName || null,
            lastName: user.profile?.lastName || null,
            email: user.profile?.email || null,
            phone: user.profile?.phone || null,
            avatar: user.profile?.avatar || null
          },
          createdAt: user.createdAt,
          account: user.account
        },
        token
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in',
      error: error.message,
    });
  }
};

const changePassword = async (req, res) => {
  const userId = req.user.userId;
  const { currentPassword, newPassword } = req.body;
  console.log(req.body);

  // Validate inputs
  if (!currentPassword) {
    return res.status(400).json({
      success: false,
      message: 'Current password is required'
    });
  }

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'New password must be at least 6 characters long'
    });
  }

  try {
    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isPasswordCorrect = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordCorrect) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await User.findByIdAndUpdate(userId, {
      password: hashedPassword
    });

    res.status(200).json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating password',
      error: error.message
    });
  }
};

const changePin = async (req, res) => {
  const userId = req.user.userId;
  const { pin, oldPin } = req.body;

  // Validate PIN
  if (!pin || pin.length !== 4) {
    return res.status(400).json({
      success: false,
      message: 'Withdrawal PIN must be exactly 4 digits'
    });
  }

  try {
    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user has existing PIN
    if (user.pin && user.pin !== oldPin) {
      return res.status(402).json({
        success: false,
        message: 'Old pin is not correct'
      });
    }

    console.log(pin);
    
    // Update user with new PIN
    const data = await User.findByIdAndUpdate(userId, {
      pin: pin
    });
    
    console.log(data);
    
    res.status(200).json({
      success: true,
      message: 'Withdrawal PIN set successfully'
    });

  } catch (error) {
    console.error('Error setting withdrawal PIN:', error);
    res.status(500).json({
      success: false,
      message: 'Error setting withdrawal PIN',
      error: error.message
    });
  }
};

const getCurrentUser = async (req, res) => {
  try {
    // Fetch user with fresh data from database
    const user = await User.findById(req.user.userId).select('-password').lean();
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log('Full user from DB:', JSON.stringify(user, null, 2));

    res.status(200).json({
      success: true,
      message: 'User data retrieved successfully',
      data: {
        user: {
          _id: user._id,
          username: user.username,
          role: user.role,
          profile: {
            firstName: user.profile?.firstName || null,
            lastName: user.profile?.lastName || null,
            email: user.profile?.email || null,
            phone: user.profile?.phone || null,
            avatar: user.profile?.avatar || null
          },
          wallet: user.wallet,
          account: user.account,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          affiliateId: user.affiliateId,
          pin: user.pin
        }
      }
    });
  } catch (error) {
    console.error('Error getting current user:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving user data',
      error: error.message
    });
  }
};

const updateProfile = async (req, res) => {
  const userId = req.user.userId;
  const { username, firstName, lastName, email, phone } = req.body;

  try {
    // Build update object
    const updateData = {};
    
    // Handle username update separately (if provided and different)
    if (username) {
      const lowercaseUsername = username.toLowerCase();
      
      // Check if username is being changed
      const currentUser = await User.findById(userId);
      if (currentUser.username !== lowercaseUsername) {
        // Check if new username already exists
        const existingUser = await User.findOne({ 
          username: lowercaseUsername,
          _id: { $ne: userId } // Exclude current user
        });
        
        if (existingUser) {
          return res.status(409).json({
            success: false,
            message: 'Username already exists'
          });
        }
        
        updateData.username = lowercaseUsername;
      }
    }
    
    // Handle profile fields - only update if provided
    if (firstName !== undefined) updateData['profile.firstName'] = firstName;
    if (lastName !== undefined) updateData['profile.lastName'] = lastName;
    if (email !== undefined) updateData['profile.email'] = email;
    if (phone !== undefined) updateData['profile.phone'] = phone;

    // Only update if there are changes
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          _id: user._id,
          username: user.username,
          role: user.role,
          profile: {
            firstName: user.profile?.firstName || null,
            lastName: user.profile?.lastName || null,
            email: user.profile?.email || null,
            phone: user.profile?.phone || null,
            avatar: user.profile?.avatar || null
          },
          wallet: user.wallet,
          createdAt: user.createdAt,
          account: user.account
        }
      }
    });
  } catch (error) {
    console.error('Error updating profile:', error);
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error updating profile',
      error: error.message
    });
  }
};

module.exports = {
  register,
  login,
  changePassword,
  changePin,
  getCurrentUser,
  updateProfile
};