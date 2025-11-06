// controllers/referralController.js
const Referral = require('../models/Referral');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const { validationResult } = require('express-validator');
const mongoose = require('mongoose');

// Generate referral code for user
// controllers/referralController.js

const generateReferralCode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Check if user already has a referral code (template)
    const existingTemplate = await Referral.findOne({
      referrerId: userId,
      referredUserId: null // Only find templates
    });

    let referralCode;
    
    // If template exists, return it
    if (existingTemplate) {
      referralCode = existingTemplate.referralCode;
      
      // Get count of actual referrals (where referredUserId is not null)
      const actualReferrals = await Referral.countDocuments({
        referrerId: userId,
        referredUserId: { $ne: null }
      });

      const activeReferrals = await Referral.countDocuments({
        referrerId: userId,
        referredUserId: { $ne: null },
        status: 'pending'
      });

      const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
      
      return res.json({
        success: true,
        message: 'Referral code retrieved successfully',
        data: {
          referralCode,
          referralLink: `${baseUrl}/register?ref=${referralCode}`,
          rewards: {
            referrerReward: '10% of first 5 deposits',
            referredReward: 5,
            maxDeposits: 5
          },
          totalReferrals: actualReferrals,
          activeReferrals: activeReferrals
        }
      });
    }

    // Generate new referral code if no template exists
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      referralCode = Referral.generateReferralCode(user.username);
      const existing = await Referral.findOne({ 
        referralCode,
        referredUserId: null 
      });
      if (!existing) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      return res.status(500).json({
        success: false,
        message: 'Unable to generate unique referral code'
      });
    }

    // Create ONLY ONE template record (no referredUserId)
    await Referral.create({
      referrerId: userId,
      referredUserId: null, // Template - will never be filled
      referralCode,
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
        depositCount: 0,
        totalReferralEarnings: 0
      }
    });

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;
    
    res.json({
      success: true,
      message: 'Referral code generated successfully',
      data: {
        referralCode,
        referralLink: `${baseUrl}/register?ref=${referralCode}`,
        rewards: {
          referrerReward: '10% of first 5 deposits',
          referredReward: 5,
          maxDeposits: 5
        }
      }
    });

  } catch (error) {
    console.error('Generate referral code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// Fixed applyReferralCode - Creates NEW record for each referral
const applyReferralCode = async (req, res) => {
  try {
    const { referralCode, newUserId } = req.body;

    if (!referralCode || !newUserId) {
      return res.status(400).json({
        success: false,
        message: 'Referral code and new user ID are required'
      });
    }

    // Find ANY referral with this code to get the referrer
    const referralTemplate = await Referral.findOne({
      referralCode: referralCode.toUpperCase()
    }).populate('referrerId', 'username');

    if (!referralTemplate) {
      return res.status(404).json({
        success: false,
        message: 'Invalid referral code'
      });
    }

    // Check if the new user exists
    const newUser = await User.findById(newUserId);
    if (!newUser) {
      return res.status(404).json({
        success: false,
        message: 'New user not found'
      });
    }

    // Check if user is trying to refer themselves
    if (referralTemplate.referrerId._id.toString() === newUserId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot refer yourself'
      });
    }

    // Check if this specific user has already been referred by ANYONE
    const alreadyReferred = await Referral.findOne({
      referredUserId: newUserId
    });

    if (alreadyReferred) {
      return res.status(400).json({
        success: false,
        message: 'User has already been referred'
      });
    }

    // Update the user with affiliate information
    await User.findByIdAndUpdate(newUserId, {
      affiliateId: referralTemplate.referrerId._id
    });

    // CREATE A NEW referral record for this specific referred user
    const newReferral = await Referral.create({
      referrerId: referralTemplate.referrerId._id,
      referredUserId: newUserId,
      referralCode: referralCode.toUpperCase(),
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
        referralSource: 'code',
        depositCount: 0,
        totalReferralEarnings: 0
      }
    });

    // Award welcome bonus to new user
    try {
      const referredWallet = await Wallet.findOrCreateWallet(newUserId);
      await referredWallet.addTransaction({
        type: 'bonus',
        amount: newReferral.rewards.referredReward,
        description: `Welcome bonus - referred by ${referralTemplate.referrerId.username}`,
        status: 'completed',
        referenceId: newReferral._id,
        metadata: {
          source: 'referral_program',
          rewardType: 'referred_bonus'
        }
      });
    } catch (walletError) {
      console.error('Error awarding welcome bonus:', walletError);
      // Continue even if wallet bonus fails
    }

    res.json({
      success: true,
      message: 'Referral applied successfully',
      data: {
        referrerUsername: referralTemplate.referrerId.username,
        rewards: newReferral.rewards,
        welcomeBonus: newReferral.rewards.referredReward
      }
    });

  } catch (error) {
    console.error('Apply referral code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// Process referral reward on deposit
const processDepositReferral = async (userId, depositAmount) => {
  try {
    // Find if this user was referred
    const referral = await Referral.findOne({
      referredUserId: userId,
      status: 'pending'
    }).populate('referrerId', 'username');

    if (!referral) {
      return { success: false, message: 'No referral found' };
    }

    // Check if we've already processed 5 deposits
    const depositCount = referral.metadata?.depositCount || 0;
    if (depositCount >= 5) {
      return { success: false, message: 'Maximum referral deposits reached' };
    }

    // Check minimum deposit amount
    if (depositAmount < (referral.conditions?.minDeposit || 10)) {
      return { success: false, message: 'Deposit amount below minimum' };
    }

    // Calculate 10% reward
    const rewardAmount = depositAmount * 0.10;

    // Award reward to referrer
    const referrerWallet = await Wallet.findOrCreateWallet(referral.referrerId);
    await referrerWallet.addTransaction({
      type: 'bonus',
      amount: rewardAmount,
      description: `Referral bonus - ${referral.referredUserId.username || 'User'} deposit ${depositCount + 1}/5`,
      status: 'completed',
      referenceId: referral._id,
      metadata: {
        source: 'referral_program',
        rewardType: 'referrer_deposit_bonus',
        depositNumber: depositCount + 1,
        depositAmount: depositAmount,
        bonusPercentage: 10
      }
    });

    // Update referral metadata
    referral.metadata.depositCount = depositCount + 1;
    referral.metadata.totalReferralEarnings = (referral.metadata.totalReferralEarnings || 0) + rewardAmount;
    
    // If this was the 5th deposit, mark as completed
    if (depositCount + 1 >= 5) {
      referral.status = 'completed';
      referral.completedAt = new Date();
    }

    await referral.save();

    return {
      success: true,
      rewardAmount,
      depositNumber: depositCount + 1,
      totalEarnings: referral.metadata.totalReferralEarnings
    };

  } catch (error) {
    console.error('Process deposit referral error:', error);
    throw error;
  }
};

const getReferralStats = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get ONLY actual referrals (exclude templates where referredUserId is null)
    const referrals = await Referral.find({ 
      referrerId: userId,
      referredUserId: { $ne: null } // IMPORTANT: Exclude templates
    })
      .populate('referredUserId', 'username profile.firstName profile.lastName account.createdAt')
      .sort({ createdAt: -1 });

    // Calculate statistics
    const stats = {
      totalReferrals: referrals.length,
      pendingReferrals: 0,
      completedReferrals: 0,
      totalEarnings: 0,
      lifetimeEarnings: 0
    };

    referrals.forEach(ref => {
      if (ref.status === 'pending') {
        stats.pendingReferrals++;
      } else if (ref.status === 'completed') {
        stats.completedReferrals++;
      }
      
      if (ref.metadata?.totalReferralEarnings) {
        stats.totalEarnings += ref.metadata.totalReferralEarnings;
      }
    });

    stats.lifetimeEarnings = stats.totalEarnings;

    // Format referral data
    const formattedReferrals = referrals.map(ref => ({
      _id: ref._id,
      referralCode: ref.referralCode,
      referredUser: ref.referredUserId ? {
        username: ref.referredUserId.username,
        firstName: ref.referredUserId.profile?.firstName || '',
        lastName: ref.referredUserId.profile?.lastName || '',
        joinedAt: ref.referredUserId.account?.createdAt
      } : null,
      status: ref.status,
      depositCount: ref.metadata?.depositCount || 0,
      maxDeposits: ref.conditions?.maxRewardDeposits || 5,
      earnings: ref.metadata?.totalReferralEarnings || 0,
      createdAt: ref.createdAt,
      completedAt: ref.completedAt
    }));

    res.json({
      success: true,
      message: 'Referral statistics retrieved successfully',
      data: {
        stats,
        referrals: formattedReferrals
      }
    });

  } catch (error) {
    console.error('Get referral stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// Validate referral code
const validateReferralCode = async (req, res) => {
  try {
    const { code } = req.params;

    const referral = await Referral.findOne({
      referralCode: code.toUpperCase(),
      status: 'pending'
    }).populate('referrerId', 'username profile.firstName profile.lastName');

    if (!referral) {
      return res.status(404).json({
        success: false,
        message: 'Invalid referral code'
      });
    }

    res.json({
      success: true,
      message: 'Valid referral code',
      data: {
        referrerInfo: {
          username: referral.referrerId.username,
          name: `${referral.referrerId.profile?.firstName || ''} ${referral.referrerId.profile?.lastName || ''}`.trim()
        },
        rewards: {
          referrerReward: '10% of first 5 deposits',
          referredReward: referral.rewards.referredReward,
          maxDeposits: 5
        },
        conditions: referral.conditions
      }
    });

  } catch (error) {
    console.error('Validate referral code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// Get user's referral code and link
const getMyCode = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    let referral = await Referral.findOne({
      referrerId: userId,
      status: { $in: ['pending', 'completed'] }
    });

    // Auto-generate if doesn't exist
    if (!referral) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      let referralCode;
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        referralCode = Referral.generateReferralCode(user.username);
        const existing = await Referral.findOne({ referralCode });
        if (!existing) {
          isUnique = true;
        }
        attempts++;
      }

      referral = await Referral.create({
        referrerId: userId,
        referredUserId: null,
        referralCode,
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
          depositCount: 0,
          totalReferralEarnings: 0
        }
      });
    }

    const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`;

    res.json({
      success: true,
      message: 'Referral code retrieved successfully',
      data: {
        referralCode: referral.referralCode,
        referralLink: `${baseUrl}/register?ref=${referral.referralCode}`,
        rewards: {
          referrerReward: '10% of first 5 deposits',
          referredReward: referral.rewards.referredReward,
          maxDeposits: 5
        },
        createdAt: referral.createdAt
      }
    });

  } catch (error) {
    console.error('Get my referral code error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// Get referral leaderboard
const getLeaderboard = async (req, res) => {
  try {
    const leaderboard = await Referral.aggregate([
      {
        $group: {
          _id: '$referrerId',
          totalReferrals: { $sum: 1 },
          completedReferrals: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          totalEarnings: { $sum: { $ifNull: ['$metadata.totalReferralEarnings', 0] } }
        }
      },
      { $sort: { totalEarnings: -1 } },
      { $limit: 10 },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user',
          pipeline: [
            { $project: { username: 1, 'profile.firstName': 1, 'profile.lastName': 1 } }
          ]
        }
      },
      { $unwind: '$user' },
      {
        $project: {
          username: '$user.username',
          name: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$user.profile.firstName', ''] },
                  ' ',
                  { $ifNull: ['$user.profile.lastName', ''] }
                ]
              }
            }
          },
          totalReferrals: 1,
          completedReferrals: 1,
          totalEarnings: { $round: ['$totalEarnings', 2] }
        }
      }
    ]);

    res.json({
      success: true,
      message: 'Referral leaderboard retrieved successfully',
      data: { leaderboard }
    });

  } catch (error) {
    console.error('Get referral leaderboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred'
    });
  }
};

// Export all functions
module.exports = {
  generateReferralCode,
  applyReferralCode,
  getReferralStats,
  validateReferralCode,
  getMyCode,
  getLeaderboard,
  processDepositReferral // Export for use in wallet deposit handler
};