// controllers/spinWheelController.js - FRONTEND FIRST APPROACH
const SpinReward = require('../models/SpinReward');
const SpinConfiguration = require('../models/SpinConfiguration');
const Wallet = require('../models/Wallet');

// Get spin wheel configuration and user status
// controllers/spinWheelController.js - Update getSpinConfig
const getSpinConfig = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    // Get segments from database
    const config = await SpinConfiguration.getOrCreateDefault();
    
    // Check if user can spin today
    const canSpinToday = await SpinReward.canUserSpinToday(userId);
    
    // Get user's last spin if any today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    
    const todaysSpin = await SpinReward.findOne({
      userId,
      spinDate: { $gte: startOfDay }
    }).sort({ spinDate: -1 });
    
    // ✅ CHECK DEPOSIT REQUIREMENT
    let depositCheckPassed = false;
    let depositAmount = 0;
    let depositRequired = 10;
    let message = '';
    let code = '';
    
    if (canSpinToday) {
      // Verify user has made at least $10 deposit in last 24 hours
      const wallet = await Wallet.findOne({ userId });
      
      if (wallet) {
        const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        // Sum completed deposits from last 24 hours
        depositAmount = wallet.transactions
          .filter(tx => 
            tx.type === 'deposit' && 
            tx.status === 'completed' && 
            new Date(tx.createdAt) >= last24Hours
          )
          .reduce((sum, tx) => sum + (tx.amount || 0), 0);
        
        depositCheckPassed = depositAmount >= depositRequired;
        
        if (!depositCheckPassed) {
          const remaining = depositRequired - depositAmount;
          message = `You need at least $${depositRequired.toFixed(2)} in deposits within the last 24 hours to spin. Current: $${depositAmount.toFixed(2)}. Deposit $${remaining.toFixed(2)} more to unlock.`;
          code = 'INSUFFICIENT_DEPOSITS';
        }
      } else {
        message = 'Wallet not found. Please contact support.';
        code = 'NO_WALLET';
        depositCheckPassed = false;
      }
    }
    
    res.json({
      success: true,
      message: message || 'Spin wheel configuration retrieved successfully',
      code: code || undefined,
      data: {
        segments: config.segments.filter(segment => segment.isActive),
        canSpinToday: canSpinToday && depositCheckPassed, // ✅ BOTH CONDITIONS MUST BE TRUE
        todaysSpin: todaysSpin || null,
        nextSpinAvailable: canSpinToday && depositCheckPassed ? null : getNextSpinTime(),
        requiresDeposit: canSpinToday && !depositCheckPassed, // ✅ FLAG FOR FRONTEND
        depositAmount: depositAmount,
        depositRequired: depositRequired,
        reason: message || undefined
      }
    });
    
  } catch (error) {
    console.error('Error getting spin config:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error retrieving spin wheel configuration' 
    });
  }
};

// Process spin result from frontend - SECURED WITH VALIDATION
const spinWheel = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { segmentId, rewardType, rewardValue, rewardLabel } = req.body;
    
    console.log('Received spin result from frontend:', {
      userId,
      segmentId,
      rewardType,
      rewardValue,
      rewardLabel
    });
    
    // VALIDATION 1: Check if user can spin today
    const canSpin = await SpinReward.canUserSpinToday(userId);
    if (!canSpin) {
      return res.status(400).json({
        success: false,
        message: 'You have already spun today. Come back tomorrow!'
      });
    }
    
    // VALIDATION 2: Get config to validate segment exists and is active
    const config = await SpinConfiguration.getOrCreateDefault();
    const segment = config.segments.find(s => s.id === segmentId && s.isActive);
    
    if (!segment) {
      console.error('Invalid segment - not found or inactive:', { segmentId });
      return res.status(400).json({
        success: false,
        message: 'Invalid segment selected'
      });
    }
    
    // VALIDATION 3: Verify frontend data matches backend segment EXACTLY
    if (segment.type !== rewardType || 
        segment.value !== rewardValue || 
        segment.label !== rewardLabel) {
      console.error('Segment data mismatch - possible tampering:', {
        expected: { type: segment.type, value: segment.value, label: segment.label },
        received: { rewardType, rewardValue, rewardLabel }
      });
      return res.status(400).json({
        success: false,
        message: 'Segment data validation failed'
      });
    }
    
    // VALIDATION 4: Probability check - verify the segment could reasonably be selected
    // Calculate if this segment's weight makes it possible to win
    const totalWeight = config.segments
      .filter(s => s.isActive)
      .reduce((sum, s) => sum + s.weight, 0);
    
    const segmentProbability = segment.weight / totalWeight;
    
    // Log for monitoring (can detect if high-value segments are being hit too often)
    console.log('Spin probability check:', {
      userId,
      segmentId,
      segmentValue: segment.value,
      segmentWeight: segment.weight,
      probability: (segmentProbability * 100).toFixed(2) + '%',
      timestamp: new Date()
    });
    
    // Optional: Add rate limiting check for suspicious patterns
    // Check if user is hitting high-value segments too frequently
    const recentSpins = await SpinReward.find({
      userId,
      spinDate: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
    }).sort({ spinDate: -1 }).limit(7);
    
    // If this is a high-value segment (top 25% by value)
    const sortedSegments = [...config.segments]
      .filter(s => s.type === 'cash' && s.isActive)
      .sort((a, b) => Number(b.value) - Number(a.value));
    
    const topQuartileThreshold = sortedSegments.length > 0 ? 
      sortedSegments[Math.floor(sortedSegments.length * 0.25)]?.value || 0 : 0;
    
    const isHighValue = segment.type === 'cash' && Number(segment.value) >= topQuartileThreshold;
    
    if (isHighValue && recentSpins.length >= 3) {
      const highValueCount = recentSpins.filter(spin => 
        spin.rewardType === 'cash' && Number(spin.rewardValue) >= topQuartileThreshold
      ).length;
      
      // If user hit 3+ high-value segments in last 7 spins, flag for review
      if (highValueCount >= 3) {
        console.warn('⚠️ Suspicious pattern detected:', {
          userId,
          highValueHits: highValueCount,
          last7Spins: recentSpins.length,
          currentSegment: segment.value,
          message: 'User hitting high-value segments frequently - may need review'
        });
        
        // Optional: You could reject here or just flag for manual review
        // return res.status(429).json({
        //   success: false,
        //   message: 'Spin rate limit exceeded. Please contact support.'
        // });
      }
    }
    
    // VALIDATION 5: Check for duplicate spin attempts (within last 5 seconds)
    const recentDuplicate = await SpinReward.findOne({
      userId,
      segmentId,
      spinDate: { $gte: new Date(Date.now() - 5000) } // Last 5 seconds
    });
    
    if (recentDuplicate) {
      console.error('Duplicate spin attempt detected:', { userId, segmentId });
      return res.status(400).json({
        success: false,
        message: 'Duplicate spin detected. Please wait before spinning again.'
      });
    }
    
    // ALL VALIDATIONS PASSED - Create spin reward record
    const spinReward = new SpinReward({
      userId,
      rewardType,
      rewardValue,
      rewardLabel,
      segmentId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      metadata: {
        source: 'frontend_spin',
        probability: segmentProbability,
        totalWeight,
        segmentWeight: segment.weight,
        timestamp: new Date(),
        validated: true
      }
    });
    
    await spinReward.save();
    
    // Process reward immediately (except retry)
    let processResult = null;
    if (rewardType !== 'retry') {
      processResult = await processReward(spinReward, userId);
      // Auto-claim for non-retry rewards
      await spinReward.claimReward();
    }
    
    console.log('✅ Spin processed successfully:', {
      rewardId: spinReward._id,
      userId,
      segment: segment.label,
      processResult
    });
    
    res.json({
      success: true,
      message: 'Spin completed successfully',
      data: {
        rewardId: spinReward._id,
        processResult,
        claimed: rewardType !== 'retry'
      }
    });
    
  } catch (error) {
    console.error('Error processing spin:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing spin request'
    });
  }
};

// Get user's spin history
const getSpinHistory = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { page = 1, limit = 10 } = req.query;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const history = await SpinReward.find({ userId })
      .sort({ spinDate: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const total = await SpinReward.countDocuments({ userId });
    
    res.json({
      success: true,
      message: 'Spin history retrieved successfully',
      data: {
        history,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalTransactions: total,
          hasNextPage: skip + parseInt(limit) < total,
          hasPrevPage: page > 1
        }
      }
    });
    
  } catch (error) {
    console.error('Error getting spin history:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving spin history'
    });
  }
};

// Get pending rewards (for retry functionality)
const getPendingRewards = async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const pendingRewards = await SpinReward.find({
      userId,
      claimed: false,
      expiresAt: { $gt: new Date() }
    }).sort({ spinDate: -1 });
    
    res.json({
      success: true,
      message: 'Pending rewards retrieved successfully',
      data: { pendingRewards }
    });
    
  } catch (error) {
    console.error('Error getting pending rewards:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving pending rewards'
    });
  }
};

// Process reward and add to user wallet/account
const processReward = async (spinReward, userId) => {
  const result = { processed: false, message: '', data: {} };
  
  try {
    switch (spinReward.rewardType) {
      case 'cash':
        // Add cash to user wallet
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        // Add transaction to wallet using 'bonus' type
        wallet.addTransaction({
          type: 'bonus',
          amount: parseFloat(spinReward.rewardValue),
          description: `Spin wheel reward - ${spinReward.rewardLabel}`,
          status: 'completed',
          referenceId: spinReward._id,
          metadata: {
            source: 'daily_spin_wheel',
            rewardType: 'cash'
          }
        });
        
        await wallet.save();
        
        result.processed = true;
        result.message = `$${spinReward.rewardValue} added to your wallet`;
        result.data.balanceAdded = parseFloat(spinReward.rewardValue);
        result.data.newBalance = wallet.balance;
        break;
        
      case 'freeplay':
        // TODO: Implement freeplay credit system
        result.processed = true;
        result.message = `${spinReward.rewardValue} free play credits awarded`;
        result.data.creditsAdded = parseInt(spinReward.rewardValue);
        break;
        
      case 'deposit_bonus':
        // TODO: Implement deposit bonus system
        result.processed = true;
        result.message = `${spinReward.rewardValue}% bonus for your next deposit`;
        result.data.bonusPercentage = parseFloat(spinReward.rewardValue);
        break;
        
      case 'vip_xp':
        // TODO: Implement VIP XP system
        result.processed = true;
        result.message = `${spinReward.rewardValue} VIP XP points added`;
        result.data.xpAdded = parseInt(spinReward.rewardValue);
        break;
        
      case 'retry':
        result.processed = true;
        result.message = 'You got a retry! Spin again!';
        break;
        
      default:
        result.message = 'Unknown reward type';
    }
    
  } catch (error) {
    console.error('Error processing reward:', error);
    result.message = 'Error processing reward';
    result.error = error.message;
  }
  
  return result;
};

// Get next available spin time
const getNextSpinTime = () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return tomorrow;
};

module.exports = {
  getSpinConfig,
  spinWheel,
  getSpinHistory,
  getPendingRewards
};