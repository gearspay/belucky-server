// models/Wallet.js
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ['deposit', 'withdrawal', 'game_deposit', 'game_withdrawal', 'bonus', 'refund', 'transfer', 'spin_reward']
    },
    amount: {
        type: Number,
        required: true,
        min: 0
    },
    description: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'cancelled'],
        default: 'pending'
    },
    // Blockchain transaction hash (for crypto transactions)
    txid: {
        type: String,
        sparse: true,
        index: true
    },
    // External transaction ID from payment gateway
    external_id: {
        type: String,
        sparse: true
    },
    // Reference to external transaction (like game account transaction)
    referenceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GameAccount'
    },
    // Game-related transaction details
    gameDetails: {
        gameType: String,
        gameLogin: String,
        gameAccountId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'GameAccount'
        }
    },
    // Payment method for deposits/withdrawals
    paymentMethod: {
        type: String,
        enum: ['credit_card', 'bank_transfer', 'crypto', 'paypal', 'game_balance', 'cashapp', 'chime']
    },
    
    // ✅ CASHAPP WITHDRAWAL DETAILS
    cashappTag: {
        type: String,
        trim: true
    },
    cashappName: {
        type: String,
        trim: true
    },
    
    // ✅ CHIME WITHDRAWAL DETAILS
    chimeTag: {
        type: String,
        trim: true
    },
    chimeFullName: {
        type: String,
        trim: true
    },
    
    // ✅ CRYPTO WITHDRAWAL DETAILS
    cryptoType: {
        type: String,
        enum: ['BTC', 'ETH', 'USDT', 'LTC', 'BNB', 'TRX', null],
        default: null
    },
    withdrawalAddress: {
        type: String,
        trim: true
    },
    cryptoAmount: {
        type: Number,
        min: 0
    },
    
    // For admin tracking
    processedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    notes: String,
    
    // Transaction fees
    fee: {
        type: Number,
        default: 0
    },
    
    // Net amount after fees
    netAmount: {
        type: Number,
        required: true
    },
    
    // Balance before and after transaction for audit trail
    balanceBefore: {
        type: Number,
        required: true
    },
    balanceAfter: {
        type: Number,
        required: true
    },
    
    // Completion timestamp
    completedAt: {
        type: Date
    }
}, {
    timestamps: true
});

const walletSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    balance: {
        type: Number,
        default: 0,
        min: 0
    },
    // Track pending amounts separately
    pendingBalance: {
        type: Number,
        default: 0
    },
    // Available balance (balance - pendingBalance)
    availableBalance: {
        type: Number,
        default: 0
    },
    currency: {
        type: String,
        default: 'USD'
    },
    // Wallet status
    status: {
        type: String,
        enum: ['active', 'suspended', 'frozen'],
        default: 'active'
    },
    // Security settings
    dailyWithdrawalLimit: {
        type: Number,
        default: 1000
    },
    monthlyWithdrawalLimit: {
        type: Number,
        default: 10000
    },
    // Track daily/monthly withdrawal amounts
    todayWithdrawn: {
        amount: { type: Number, default: 0 },
        date: { type: Date, default: Date.now }
    },
    monthlyWithdrawn: {
        amount: { type: Number, default: 0 },
        month: { type: Number, default: () => new Date().getMonth() },
        year: { type: Number, default: () => new Date().getFullYear() }
    },
    // Last transaction timestamp for rate limiting
    lastTransactionAt: {
        type: Date
    },
    // Transaction history embedded in wallet for quick access
    transactions: [transactionSchema]
}, {
    timestamps: true
});

// Indexes for better performance
walletSchema.index({ userId: 1 });
walletSchema.index({ 'transactions.createdAt': -1 });
walletSchema.index({ 'transactions.type': 1 });
walletSchema.index({ 'transactions.status': 1 });
walletSchema.index({ 'transactions.txid': 1 });
walletSchema.index({ 'transactions.external_id': 1 });
walletSchema.index({ 'transactions.paymentMethod': 1 }); // ✅ Index for payment method queries

// Virtual for getting available balance
walletSchema.virtual('calculatedAvailableBalance').get(function() {
    return Math.max(0, this.balance - this.pendingBalance);
});

// Method to add transaction
walletSchema.methods.addTransaction = function(transactionData) {
    const balanceBefore = this.balance;
    
    // Calculate net amount (amount - fees)
    const netAmount = transactionData.netAmount || (transactionData.amount - (transactionData.fee || 0));
    
    let balanceAfter = balanceBefore;
    
    // Update balance based on transaction type
    if (['deposit', 'game_withdrawal', 'bonus', 'refund'].includes(transactionData.type)) {
        balanceAfter = balanceBefore + netAmount;
    } else if (['withdrawal', 'game_deposit'].includes(transactionData.type)) {
        balanceAfter = Math.max(0, balanceBefore - transactionData.amount);
    }
    
    const transaction = {
        ...transactionData,
        netAmount,
        balanceBefore,
        balanceAfter,
        status: transactionData.status || 'pending'
    };
    
    this.transactions.push(transaction);
    
    // Update wallet balance only if transaction is completed
    if (transaction.status === 'completed') {
        this.balance = balanceAfter;
        this.updateAvailableBalance();
        
        // Set completion timestamp if not already set
        if (!transaction.completedAt) {
            transaction.completedAt = new Date();
        }
    } else if (transaction.status === 'pending' && 
               ['withdrawal', 'game_deposit'].includes(transactionData.type)) {
        // Lock pending withdrawal amounts
        this.pendingBalance += transactionData.amount;
        this.updateAvailableBalance();
    }
    
    this.lastTransactionAt = new Date();
    
    return this.transactions[this.transactions.length - 1];
};

// Method to update transaction status
walletSchema.methods.updateTransactionStatus = function(transactionId, status, notes) {
    const transaction = this.transactions.id(transactionId);
    if (!transaction) {
        throw new Error('Transaction not found');
    }
    
    const oldStatus = transaction.status;
    const balanceBefore = this.balance;
    
    transaction.status = status;
    if (notes) transaction.notes = notes;
    
    // Handle balance updates based on status change
    if (oldStatus === 'pending' && status === 'completed') {
        // Complete pending transaction
        if (['deposit', 'game_withdrawal', 'bonus', 'refund'].includes(transaction.type)) {
            this.balance += transaction.netAmount;
        }
        
        // Remove from pending if it was a withdrawal/game_deposit
        if (['withdrawal', 'game_deposit'].includes(transaction.type)) {
            this.pendingBalance = Math.max(0, this.pendingBalance - transaction.amount);
        }
        
        // Set completion timestamp
        transaction.completedAt = new Date();
    } else if (oldStatus === 'pending' && ['failed', 'cancelled'].includes(status)) {
        // Cancel pending transaction - refund the amount
        if (['withdrawal', 'game_deposit'].includes(transaction.type)) {
            this.pendingBalance = Math.max(0, this.pendingBalance - transaction.amount);
            // Balance was already deducted, so we don't need to add it back
        }
    }
    
    // Update balance after in transaction record
    transaction.balanceAfter = this.balance;
    this.updateAvailableBalance();
    
    return transaction;
};

// Method to update available balance
walletSchema.methods.updateAvailableBalance = function() {
    this.availableBalance = Math.max(0, this.balance - this.pendingBalance);
};

// Method to check if withdrawal is allowed
walletSchema.methods.canWithdraw = function(amount) {
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    // Reset daily counter if new day
    if (this.todayWithdrawn.date.toDateString() !== today.toDateString()) {
        this.todayWithdrawn.amount = 0;
        this.todayWithdrawn.date = today;
    }
    
    // Reset monthly counter if new month
    if (this.monthlyWithdrawn.month !== currentMonth || 
        this.monthlyWithdrawn.year !== currentYear) {
        this.monthlyWithdrawn.amount = 0;
        this.monthlyWithdrawn.month = currentMonth;
        this.monthlyWithdrawn.year = currentYear;
    }
    
    const canWithdraw = {
        sufficient_balance: this.availableBalance >= amount,
        within_daily_limit: (this.todayWithdrawn.amount + amount) <= this.dailyWithdrawalLimit,
        within_monthly_limit: (this.monthlyWithdrawn.amount + amount) <= this.monthlyWithdrawalLimit,
        wallet_active: this.status === 'active'
    };
    
    canWithdraw.allowed = Object.values(canWithdraw).every(Boolean);
    
    return canWithdraw;
};

// Method to process withdrawal
walletSchema.methods.processWithdrawal = function(amount) {
    const today = new Date();
    
    this.todayWithdrawn.amount += amount;
    this.monthlyWithdrawn.amount += amount;
    
    return true;
};

// Method to get transaction summary
walletSchema.methods.getTransactionSummary = function(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const recentTransactions = this.transactions.filter(t => 
        t.createdAt >= startDate && t.status === 'completed'
    );
    
    const summary = {
        totalDeposits: 0,
        totalWithdrawals: 0,
        totalGameDeposits: 0,
        totalGameWithdrawals: 0,
        transactionCount: recentTransactions.length,
        netFlow: 0
    };
    
    recentTransactions.forEach(t => {
        switch (t.type) {
            case 'deposit':
            case 'bonus':
            case 'refund':
                summary.totalDeposits += t.netAmount;
                summary.netFlow += t.netAmount;
                break;
            case 'withdrawal':
                summary.totalWithdrawals += t.amount;
                summary.netFlow -= t.amount;
                break;
            case 'game_deposit':
                summary.totalGameDeposits += t.amount;
                summary.netFlow -= t.amount;
                break;
            case 'game_withdrawal':
                summary.totalGameWithdrawals += t.netAmount;
                summary.netFlow += t.netAmount;
                break;
        }
    });
    
    return summary;
};

// ✅ Method to get withdrawal details by transaction ID
walletSchema.methods.getWithdrawalDetails = function(transactionId) {
    const transaction = this.transactions.id(transactionId);
    
    if (!transaction || transaction.type !== 'withdrawal') {
        return null;
    }
    
    const details = {
        transactionId: transaction._id,
        amount: transaction.amount,
        netAmount: transaction.netAmount,
        fee: transaction.fee,
        paymentMethod: transaction.paymentMethod,
        status: transaction.status,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt
    };
    
    // Add payment method specific details
    if (transaction.paymentMethod === 'cashapp') {
        details.cashappTag = transaction.cashappTag;
        details.cashappName = transaction.cashappName;
    } else if (transaction.paymentMethod === 'chime') {
        details.chimeTag = transaction.chimeTag;
        details.chimeFullName = transaction.chimeFullName;
    } else if (transaction.paymentMethod === 'crypto') {
        details.cryptoType = transaction.cryptoType;
        details.withdrawalAddress = transaction.withdrawalAddress;
        details.cryptoAmount = transaction.cryptoAmount;
        details.txid = transaction.txid;
    }
    
    return details;
};

// Static method to find or create wallet
walletSchema.statics.findOrCreateWallet = async function(userId) {
    let wallet = await this.findOne({ userId });
    
    if (!wallet) {
        wallet = new this({ userId });
        await wallet.save();
    }
    
    return wallet;
};

// Pre-save middleware to ensure data consistency
walletSchema.pre('save', function(next) {
    this.updateAvailableBalance();
    next();
});

module.exports = mongoose.model('Wallet', walletSchema);