// models/Referral.js
const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  referredUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
    index: true,
    default: null
  },
  referralCode: {
    type: String,
    required: true,
    uppercase: true,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'pending'
  },
  rewards: {
    referrerReward: {
      type: Number,
      default: 0
    },
    referredReward: {
      type: Number,
      default: 5
    },
    rewardType: {
      type: String,
      enum: ['cash', 'bonus', 'free_spins', 'percentage'],
      default: 'percentage'
    }
  },
  conditions: {
    minDeposit: {
      type: Number,
      default: 10
    },
    minGamesPlayed: {
      type: Number,
      default: 1
    },
    maxRewardDeposits: {
      type: Number,
      default: 5
    },
    completedAt: {
      type: Date,
      default: null
    }
  },
  metadata: {
    referredUserIP: String,
    referredUserAgent: String,
    referralSource: String, // 'link', 'code', 'social', 'registration', etc.
    campaignId: String,
    depositCount: {
      type: Number,
      default: 0
    },
    totalReferralEarnings: {
      type: Number,
      default: 0
    }
  },
  completedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Compound indexes for better query performance
referralSchema.index({ referrerId: 1, status: 1 });
referralSchema.index({ referredUserId: 1, status: 1 });
referralSchema.index({ referralCode: 1, status: 1 });
referralSchema.index({ referralCode: 1, referredUserId: 1 }, { unique: true, sparse: true });
referralSchema.index({ createdAt: -1 });

// Virtual for calculating referral completion rate
referralSchema.virtual('isCompleted').get(function() {
  return this.status === 'completed';
});

// Static method to generate unique referral code
referralSchema.statics.generateReferralCode = function(username) {
  const randomString = Math.random().toString(36).substring(2, 8).toUpperCase();
  const userPrefix = username.substring(0, 3).toUpperCase();
  return `${userPrefix}${randomString}`;
};

// Static method to find or create referral code for a user
referralSchema.statics.findOrCreateReferralCode = async function(userId, username) {
  // Check if user already has a referral code
  let referral = await this.findOne({
    referrerId: userId,
    referredUserId: null // Template referral
  });

  if (referral) {
    return referral.referralCode;
  }

  // Generate new unique code
  let referralCode;
  let isUnique = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isUnique && attempts < maxAttempts) {
    referralCode = this.generateReferralCode(username);
    const existing = await this.findOne({ 
      referralCode,
      referredUserId: null 
    });
    if (!existing) {
      isUnique = true;
    }
    attempts++;
  }

  if (!isUnique) {
    throw new Error('Unable to generate unique referral code');
  }

  // Create template referral
  await this.create({
    referrerId: userId,
    referredUserId: null,
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

  return referralCode;
};

// Method to check if referral conditions are met
referralSchema.methods.checkCompletionConditions = async function() {
  const User = mongoose.model('User');
  const referredUser = await User.findById(this.referredUserId);
  
  if (!referredUser) return false;
  
  const depositCount = this.metadata?.depositCount || 0;
  const maxDeposits = this.conditions?.maxRewardDeposits || 5;
  
  const conditionsMet = {
    hasDeposits: depositCount > 0,
    reachedMaxDeposits: depositCount >= maxDeposits,
    minGamesPlayed: referredUser.gameStats?.totalGamesPlayed >= (this.conditions?.minGamesPlayed || 1)
  };
  
  return conditionsMet.reachedMaxDeposits && conditionsMet.minGamesPlayed;
};

// Method to complete referral and award rewards
referralSchema.methods.complete = async function() {
  if (this.status === 'completed') {
    throw new Error('Referral already completed');
  }
  
  const conditionsMet = await this.checkCompletionConditions();
  if (!conditionsMet) {
    throw new Error('Referral conditions not met');
  }
  
  this.status = 'completed';
  this.completedAt = new Date();
  this.conditions.completedAt = new Date();
  await this.save();
  
  return this;
};

// Method to process deposit and award referrer bonus
referralSchema.methods.processDeposit = async function(depositAmount) {
  if (this.status !== 'pending') {
    return { success: false, message: 'Referral not active' };
  }

  if (!this.referredUserId) {
    return { success: false, message: 'No referred user' };
  }

  const depositCount = this.metadata?.depositCount || 0;
  const maxDeposits = this.conditions?.maxRewardDeposits || 5;

  if (depositCount >= maxDeposits) {
    return { success: false, message: 'Maximum referral deposits reached' };
  }

  const minDeposit = this.conditions?.minDeposit || 10;
  if (depositAmount < minDeposit) {
    return { success: false, message: `Deposit amount below minimum ($${minDeposit})` };
  }

  // Calculate 10% reward for referrer
  const rewardAmount = depositAmount * 0.10;

  // Update metadata
  this.metadata.depositCount = depositCount + 1;
  this.metadata.totalReferralEarnings = (this.metadata.totalReferralEarnings || 0) + rewardAmount;

  // If reached max deposits, mark as completed
  if (this.metadata.depositCount >= maxDeposits) {
    this.status = 'completed';
    this.completedAt = new Date();
    this.conditions.completedAt = new Date();
  }

  await this.save();

  return {
    success: true,
    rewardAmount,
    depositNumber: this.metadata.depositCount,
    totalEarnings: this.metadata.totalReferralEarnings,
    isCompleted: this.status === 'completed'
  };
};

// Pre-save hook to handle automatic completion
referralSchema.pre('save', async function(next) {
  // Auto-complete if conditions are met
  if (this.status === 'pending' && this.metadata?.depositCount >= (this.conditions?.maxRewardDeposits || 5)) {
    this.status = 'completed';
    if (!this.completedAt) {
      this.completedAt = new Date();
    }
    if (!this.conditions.completedAt) {
      this.conditions.completedAt = new Date();
    }
  }
  next();
});

module.exports = mongoose.model('Referral', referralSchema);