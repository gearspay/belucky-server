// models/GameAccount.js
const mongoose = require('mongoose');

const gameAccountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  gameId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Game',
    required: true
  },
  gameType: {
    type: String,
    required: false
    // Removed static enum - now gets value from linked Game
  },
  gameLogin: {
    type: String,
    required: false,
    sparse: true // Allow multiple null values but unique non-null values
  },
  gamePassword: {
    type: String,
    required: false
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended', 'pending', 'failed'],
    default: 'pending'
  },
  downloadCode: {
    type: String,
    default: null
  },
  lastBalanceCheck: {
    type: Date,
    default: Date.now
  },
  transactions: [{
    type: {
      type: String,
      enum: ['recharge', 'redeem', 'balance_check'],
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    previousBalance: Number,
    newBalance: Number,
    remark: String,
    status: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'cancelled'],
      default: 'pending'
    },
    processedAt: Date,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  metadata: {
    createdVia: {
      type: String,
      enum: ['manual', 'api', 'bulk'],
      default: 'api'
    },
    lastLoginAttempt: Date,
    failedLoginAttempts: {
      type: Number,
      default: 0
    },
    notes: String
  }
}, {
  timestamps: true
});

// Updated indexes for better performance
gameAccountSchema.index({ userId: 1, gameId: 1 });
gameAccountSchema.index({ gameLogin: 1 }, { 
  unique: true, 
  sparse: true // Allow multiple null values
});
gameAccountSchema.index({ status: 1 });
gameAccountSchema.index({ gameId: 1, status: 1 });

// Virtual for account age
gameAccountSchema.virtual('accountAge').get(function() {
  return Date.now() - this.createdAt;
});

// Instance methods
gameAccountSchema.methods.addTransaction = function(transactionData) {
  this.transactions.push(transactionData);
  return this.save();
};

gameAccountSchema.methods.updateBalance = function(newBalance, transactionId = null) {
  const previousBalance = this.balance;
  this.balance = newBalance;
  this.lastBalanceCheck = new Date();
    
  if (transactionId) {
    const transaction = this.transactions.id(transactionId);
    if (transaction) {
      transaction.previousBalance = previousBalance;
      transaction.newBalance = newBalance;
      transaction.status = 'completed';
      transaction.processedAt = new Date();
    }
  }
    
  return this.save();
};

// NEW: Get last completed recharge (deposit) for cashout validation
gameAccountSchema.methods.getLastDeposit = function() {
  const lastRecharge = this.transactions
    .filter(t => t.type === 'recharge' && t.status === 'completed')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  
  return lastRecharge ? lastRecharge.amount : null;
};

// NEW: Get last deposit with full details
gameAccountSchema.methods.getLastDepositDetails = function() {
  const lastRecharge = this.transactions
    .filter(t => t.type === 'recharge' && t.status === 'completed')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  
  if (!lastRecharge) return null;
  
  return {
    amount: lastRecharge.amount,
    date: lastRecharge.createdAt,
    transactionId: lastRecharge._id
  };
};

// NEW: Calculate total recharges for this account
gameAccountSchema.methods.getTotalRecharges = function() {
  return this.transactions
    .filter(t => t.type === 'recharge' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0);
};

// NEW: Calculate total redeems for this account
gameAccountSchema.methods.getTotalRedeems = function() {
  return this.transactions
    .filter(t => t.type === 'redeem' && t.status === 'completed')
    .reduce((sum, t) => sum + t.amount, 0);
};

// Updated static methods
gameAccountSchema.statics.findByUser = function(userId, gameId = null) {
  const query = { userId };
  if (gameId) query.gameId = gameId;
  return this.find(query)
    .populate('userId', 'username email')
    .populate('gameId', 'name slug gameType status');
};

gameAccountSchema.statics.findByGameLogin = function(gameLogin) {
  return this.findOne({ gameLogin })
    .populate('userId', 'username email')
    .populate('gameId', 'name slug gameType status');
};

// NEW: Find by game
gameAccountSchema.statics.findByGame = function(gameId, status = null) {
  const query = { gameId };
  if (status) query.status = status;
  return this.find(query)
    .populate('userId', 'username email')
    .populate('gameId', 'name slug gameType status');
};

// NEW: Find active accounts for a game
gameAccountSchema.statics.findActiveByGame = function(gameId) {
  return this.find({ gameId, status: 'active' })
    .populate('userId', 'username email')
    .populate('gameId', 'name slug gameType status');
};

// Pre-save middleware to set gameType from linked Game
gameAccountSchema.pre('save', async function(next) {
  if (this.isNew || this.isModified('gameId')) {
    try {
      const Game = mongoose.model('Game');
      const game = await Game.findById(this.gameId);
      if (game) {
        this.gameType = game.gameType;
      }
    } catch (error) {
      console.error('Error setting gameType:', error);
    }
  }
  next();
});

module.exports = mongoose.model('GameAccount', gameAccountSchema);