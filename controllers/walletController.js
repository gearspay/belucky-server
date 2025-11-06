// controllers/walletController.js
const Wallet = require('../models/Wallet');
const GameAccount = require('../models/GameAccount');
const PaymentMethod = require('../models/PaymentMethod');


// Get user's wallet information
const getWallet = async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        // ✅ REMOVED wallet.updateAvailableBalance() - trust DB value
        
        // Calculate pending withdrawals
        const pendingWithdrawals = wallet.transactions
            .filter(t => t.status === 'pending' && t.type === 'withdrawal')
            .reduce((sum, t) => sum + t.amount, 0);
        
        // Calculate pending deposits
        const pendingDeposits = wallet.transactions
            .filter(t => t.status === 'pending' && t.type === 'deposit')
            .reduce((sum, t) => sum + t.amount, 0);
        
        // Get recent transactions (last 10)
        const recentTransactions = wallet.transactions
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 10);
        
        const summary = wallet.getTransactionSummary(30);
        
        res.json({
            success: true,
            message: 'Wallet retrieved successfully',
            data: {
                balance: wallet.balance,
                availableBalance: wallet.availableBalance, // Use DB value directly
                pendingBalance: wallet.pendingBalance, // Use DB value directly
                pendingWithdrawals: pendingWithdrawals,
                pendingDeposits: pendingDeposits,
                currency: wallet.currency,
                status: wallet.status,
                limits: {
                    dailyWithdrawalLimit: wallet.dailyWithdrawalLimit,
                    monthlyWithdrawalLimit: wallet.monthlyWithdrawalLimit,
                    todayWithdrawn: wallet.todayWithdrawn.amount,
                    monthlyWithdrawn: wallet.monthlyWithdrawn.amount
                },
                recentTransactions,
                summary
            }
        });
        
    } catch (error) {
        console.error('Error fetching wallet:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching wallet information'
        });
    }
};

// Get wallet balance only (for header)
const getWalletBalance = async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        res.json({
            success: true,
            data: {
                balance: wallet.balance,
                availableBalance: wallet.availableBalance,
                pendingBalance: wallet.pendingBalance,
                currency: wallet.currency
            }
        });
        
    } catch (error) {
        console.error('Error fetching wallet balance:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching wallet balance'
        });
    }
};

// Add funds to wallet (deposit) - WITH DYNAMIC FEES
const depositFunds = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { amount, paymentMethod, description, external_id } = req.body;
        
        // Validation
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required (must be greater than 0)'
            });
        }
        
        if (amount > 10000) {
            return res.status(400).json({
                success: false,
                message: 'Maximum deposit amount is $10,000'
            });
        }
        
        if (!paymentMethod) {
            return res.status(400).json({
                success: false,
                message: 'Payment method is required'
            });
        }
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        if (wallet.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Wallet is not active. Please contact support.'
            });
        }
        
        // Get dynamic deposit fee from payment method config
        let depositFeePercent = 0;
        try {
            const paymentMethodConfig = await PaymentMethod.findOne({ 
                method: paymentMethod,
                isActive: true 
            });
            
            if (paymentMethodConfig) {
                const config = paymentMethodConfig[`${paymentMethod}Config`];
                depositFeePercent = config?.depositChargePercent || 0;
            }
        } catch (error) {
            console.error('Error fetching payment method config:', error);
            // Continue with 0% fee as fallback
        }
        
        // Calculate dynamic fee
        const feeAmount = (amount * depositFeePercent) / 100;
        
        // Add deposit transaction with external_id for crypto payments
        const transactionData = {
            type: 'deposit',
            amount,
            description: description || 'Wallet deposit',
            paymentMethod,
            status: 'pending',
            fee: feeAmount // Dynamic fee based on payment method
        };
        
        // Store external_id for crypto transactions
        if (paymentMethod === 'crypto' && external_id) {
            transactionData.external_id = external_id.toString();
        }
        
        const transaction = wallet.addTransaction(transactionData);
        
        await wallet.save();
        
        res.json({
            success: true,
            message: 'Deposit initiated successfully',
            data: {
                transactionId: transaction._id,
                amount,
                fee: feeAmount,
                feePercent: depositFeePercent,
                status: transaction.status,
                external_id: external_id || null,
                newBalance: wallet.balance,
                availableBalance: wallet.availableBalance
            }
        });
        
    } catch (error) {
        console.error('Error processing deposit:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing deposit'
        });
    }
};

// controllers/adminDataController.js - UPDATED getTransactions function

const withdrawFunds = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { 
            amount, 
            paymentMethod, 
            description, 
            cryptoType, 
            cryptoAddress, 
            cryptoAmount, 
            cashappTag,
            cashappName,
            chimeTag,
            chimeName
        } = req.body;

        console.log(req.body)
        
        // Validation
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required (must be greater than 0)'
            });
        }
        
        if (!paymentMethod) {
            return res.status(400).json({
                success: false,
                message: 'Payment method is required'
            });
        }

        // Validate payment method specific details
        if (paymentMethod === 'cashapp' && !cashappTag) {
            return res.status(400).json({
                success: false,
                message: 'CashApp tag is required for CashApp withdrawals'
            });
        }

        if (paymentMethod === 'chime' && (!chimeTag || !chimeName)) {
            return res.status(400).json({
                success: false,
                message: 'Chime tag and full name are required for Chime withdrawals'
            });
        }

        if (paymentMethod === 'crypto' && (!cryptoType || !cryptoAddress)) {
            return res.status(400).json({
                success: false,
                message: 'Crypto type and address are required for crypto withdrawals'
            });
        }
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        if (wallet.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Wallet is not active. Please contact support.'
            });
        }
        
        // Get dynamic withdrawal fee from payment method config
        let withdrawalFeePercent = 0;
        try {
            const paymentMethodConfig = await PaymentMethod.findOne({ 
                method: paymentMethod,
                isActive: true 
            });
            
            if (paymentMethodConfig) {
                const config = paymentMethodConfig[`${paymentMethod}Config`];
                withdrawalFeePercent = config?.withdrawChargePercent || 0;
            }
        } catch (error) {
            console.error('Error fetching payment method config:', error);
        }
        
        // Calculate dynamic fee
        const feeAmount = (amount * withdrawalFeePercent) / 100;
        const netAmount = amount - feeAmount;
        
        // Check availableBalance
        if (wallet.availableBalance < amount) {
            return res.status(400).json({
                success: false,
                message: `Insufficient available balance. You have ${wallet.availableBalance.toFixed(2)} available`
            });
        }
        
        // Check withdrawal limits
        const canWithdraw = wallet.canWithdraw(amount);
        
        if (!canWithdraw.allowed) {
            let message = 'Withdrawal not allowed: ';
            if (!canWithdraw.sufficient_balance) message += 'Insufficient balance. ';
            if (!canWithdraw.within_daily_limit) message += 'Daily limit exceeded. ';
            if (!canWithdraw.within_monthly_limit) message += 'Monthly limit exceeded. ';
            
            return res.status(400).json({
                success: false,
                message: message.trim()
            });
        }
        
        // Build transaction data with payment method specific details
        const transactionData = {
            type: 'withdrawal',
            amount,
            description: description || 'Wallet withdrawal',
            paymentMethod,
            status: 'pending', // ✅ ALL withdrawals start as pending
            fee: feeAmount,
            netAmount: netAmount
        };

        // Add CashApp details if CashApp withdrawal
        if (paymentMethod === 'cashapp') {
            transactionData.cashappTag = cashappTag;
            if (cashappName) {
                transactionData.cashappName = cashappName;
            }
        }

        // Add Chime details if Chime withdrawal
        if (paymentMethod === 'chime') {
            transactionData.chimeTag = chimeTag;
            transactionData.chimeFullName = chimeName;
        }

        // ✅ Add Crypto details if crypto withdrawal (SAVE FOR ADMIN APPROVAL)
        if (paymentMethod === 'crypto') {
            transactionData.cryptoType = cryptoType;
            transactionData.withdrawalAddress = cryptoAddress;
            if (cryptoAmount) {
                transactionData.cryptoAmount = cryptoAmount;
            }
        }
        
        // Add withdrawal transaction (ALWAYS PENDING)
        const transaction = wallet.addTransaction(transactionData);
        
        // Update withdrawal tracking
        wallet.processWithdrawal(amount);
        
        await wallet.save();

        // ✅ REMOVED: No automatic crypto processing here
        // Admin will approve in dashboard and it will process automatically

        res.json({
            success: true,
            message: paymentMethod === 'crypto' 
                ? 'Crypto withdrawal requested successfully. Waiting for admin approval.' 
                : 'Withdrawal requested successfully',
            data: {
                transactionId: transaction._id,
                amount,
                fee: feeAmount,
                feePercent: withdrawalFeePercent,
                netAmount: netAmount,
                status: transaction.status,
                paymentMethod,
                ...(paymentMethod === 'cashapp' && { cashappTag }),
                ...(paymentMethod === 'chime' && { chimeTag, chimeName }),
                ...(paymentMethod === 'crypto' && { cryptoType, cryptoAddress, cryptoAmount }),
                newBalance: wallet.balance,
                availableBalance: wallet.availableBalance,
                pendingBalance: wallet.pendingBalance
            }
        });
        
    } catch (error) {
        console.error('Error processing withdrawal:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing withdrawal'
        });
    }
}

// Transfer funds to game account
const transferToGame = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { gameAccountId, amount, description } = req.body;
        
        // Validation
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required (must be greater than 0)'
            });
        }
        
        if (!gameAccountId) {
            return res.status(400).json({
                success: false,
                message: 'Game account ID is required'
            });
        }
        
        // Verify game account belongs to user
        const gameAccount = await GameAccount.findOne({ _id: gameAccountId, userId });
        if (!gameAccount) {
            return res.status(404).json({
                success: false,
                message: 'Game account not found'
            });
        }
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        if (wallet.availableBalance < amount) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance'
            });
        }
        
        // Add game deposit transaction to wallet
        const transaction = wallet.addTransaction({
            type: 'game_deposit',
            amount,
            description: description || `Transfer to ${gameAccount.gameType} - ${gameAccount.gameLogin}`,
            status: 'completed',
            gameDetails: {
                gameType: gameAccount.gameType,
                gameLogin: gameAccount.gameLogin,
                gameAccountId: gameAccount._id
            },
            referenceId: gameAccount._id
        });
        
        await wallet.save();
        
        // Here you would trigger the actual game account recharge
        // For now, we'll just return success
        
        res.json({
            success: true,
            message: 'Transfer to game account completed successfully',
            data: {
                transactionId: transaction._id,
                amount,
                gameAccount: {
                    gameType: gameAccount.gameType,
                    gameLogin: gameAccount.gameLogin
                },
                newWalletBalance: wallet.balance,
                availableBalance: wallet.availableBalance
            }
        });
        
    } catch (error) {
        console.error('Error transferring to game:', error);
        res.status(500).json({
            success: false,
            message: 'Error transferring funds to game account'
        });
    }
};

// Transfer funds from game account
const transferFromGame = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { gameAccountId, amount, description } = req.body;
        
        // Validation
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required (must be greater than 0)'
            });
        }
        
        if (!gameAccountId) {
            return res.status(400).json({
                success: false,
                message: 'Game account ID is required'
            });
        }
        
        // Verify game account belongs to user
        const gameAccount = await GameAccount.findOne({ _id: gameAccountId, userId });
        if (!gameAccount) {
            return res.status(404).json({
                success: false,
                message: 'Game account not found'
            });
        }
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        // Add game withdrawal transaction to wallet as COMPLETED
        const transaction = wallet.addTransaction({
            type: 'game_withdrawal',
            amount,
            description: description || `Transfer from ${gameAccount.gameType} - ${gameAccount.gameLogin}`,
            status: 'completed',
            gameDetails: {
                gameType: gameAccount.gameType,
                gameLogin: gameAccount.gameLogin,
                gameAccountId: gameAccount._id
            },
            referenceId: gameAccount._id,
            completedAt: new Date()
        });
        
        await wallet.save();
        
        res.json({
            success: true,
            message: 'Transfer from game account completed successfully',
            data: {
                transactionId: transaction._id,
                amount,
                status: 'completed',
                gameAccount: {
                    gameType: gameAccount.gameType,
                    gameLogin: gameAccount.gameLogin
                },
                newWalletBalance: wallet.balance,
                availableBalance: wallet.availableBalance,
                completedAt: transaction.completedAt
            }
        });
        
    } catch (error) {
        console.error('Error transferring from game:', error);
        res.status(500).json({
            success: false,
            message: 'Error transferring funds from game account'
        });
    }
};

// Get transaction history
const getTransactionHistory = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { page = 1, limit = 20, type, status, startDate, endDate } = req.query;
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        let transactions = [...wallet.transactions];
        
        // Apply filters
        if (type) {
            transactions = transactions.filter(t => t.type === type);
        }
        
        if (status) {
            transactions = transactions.filter(t => t.status === status);
        }
        
        if (startDate) {
            transactions = transactions.filter(t => new Date(t.createdAt) >= new Date(startDate));
        }
        
        if (endDate) {
            transactions = transactions.filter(t => new Date(t.createdAt) <= new Date(endDate));
        }
        
        // Sort by date (newest first)
        transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        // Pagination
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + parseInt(limit);
        const paginatedTransactions = transactions.slice(startIndex, endIndex);
        
        const totalTransactions = transactions.length;
        const totalPages = Math.ceil(totalTransactions / limit);
        
        res.json({
            success: true,
            message: 'Transaction history retrieved successfully',
            data: {
                transactions: paginatedTransactions,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalTransactions,
                    hasNextPage: endIndex < totalTransactions,
                    hasPrevPage: page > 1
                }
            }
        });
        
    } catch (error) {
        console.error('Error fetching transaction history:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching transaction history'
        });
    }
};

// Get single transaction details
const getTransaction = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { transactionId } = req.params;
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        const transaction = wallet.transactions.id(transactionId);
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Transaction retrieved successfully',
            data: { transaction }
        });
        
    } catch (error) {
        console.error('Error fetching transaction:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching transaction'
        });
    }
};

// Update wallet settings
const updateWalletSettings = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { dailyWithdrawalLimit, monthlyWithdrawalLimit } = req.body;
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        if (dailyWithdrawalLimit !== undefined) {
            if (dailyWithdrawalLimit < 0 || dailyWithdrawalLimit > 5000) {
                return res.status(400).json({
                    success: false,
                    message: 'Daily withdrawal limit must be between $0 and $5,000'
                });
            }
            wallet.dailyWithdrawalLimit = dailyWithdrawalLimit;
        }
        
        if (monthlyWithdrawalLimit !== undefined) {
            if (monthlyWithdrawalLimit < 0 || monthlyWithdrawalLimit > 50000) {
                return res.status(400).json({
                    success: false,
                    message: 'Monthly withdrawal limit must be between $0 and $50,000'
                });
            }
            wallet.monthlyWithdrawalLimit = monthlyWithdrawalLimit;
        }
        
        await wallet.save();
        
        res.json({
            success: true,
            message: 'Wallet settings updated successfully',
            data: {
                dailyWithdrawalLimit: wallet.dailyWithdrawalLimit,
                monthlyWithdrawalLimit: wallet.monthlyWithdrawalLimit
            }
        });
        
    } catch (error) {
        console.error('Error updating wallet settings:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating wallet settings'
        });
    }
};

// Get recent winners (last 10 game withdrawals) - WITH GAME IMAGES
const getRecentWinners = async (req, res) => {
    try {
        const User = require('../models/User');
        const GameAccount = require('../models/GameAccount');
        const Game = require('../models/Game');
        
        // Get all wallets with game_withdrawal transactions
        const wallets = await Wallet.find({
            'transactions.type': 'game_withdrawal',
            'transactions.status': 'completed'
        }).populate('userId', 'username email');
        
        // Collect all game_withdrawal transactions with user info
        const allWinners = [];
        
        for (const wallet of wallets) {
            const gameWithdrawals = wallet.transactions
                .filter(t => t.type === 'game_withdrawal' && t.status === 'completed')
                .map(t => ({
                    username: wallet.userId?.username || 'Anonymous',
                    email: wallet.userId?.email || '',
                    amount: t.netAmount || t.amount,
                    gameAccountId: t.gameDetails?.gameAccountId || t.referenceId,
                    gameType: t.gameDetails?.gameType || 'Unknown',
                    gameLogin: t.gameDetails?.gameLogin || '',
                    createdAt: t.createdAt,
                    transactionId: t._id
                }));
            
            allWinners.push(...gameWithdrawals);
        }
        
        // Sort by date (newest first) and get top 10
        const topWinners = allWinners
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 10);
        
        // Fetch game details and images for each winner
        const winnersWithImages = await Promise.all(
            topWinners.map(async (winner) => {
                let gameName = winner.gameType;
                let gameImage = null;
                
                try {
                    // If we have gameAccountId, use it to get the actual game
                    if (winner.gameAccountId) {
                        const gameAccount = await GameAccount.findById(winner.gameAccountId)
                            .populate({
                                path: 'gameId',
                                select: 'name displayName title image shortcode'
                            });
                        
                        if (gameAccount && gameAccount.gameId) {
                            const game = gameAccount.gameId;
                            // ✅ Use displayName, name, or title (in that order)
                            gameName = game.displayName || game.name || game.title || winner.gameType;
                            // ✅ Use image field
                            gameImage = game.image || null;
                        }
                    }
                    
                    // Fallback: try to find game by gameType/shortcode if gameAccount lookup failed
                    if (!gameImage) {
                        const game = await Game.findOne({
                            $or: [
                                { shortcode: winner.gameType.toUpperCase() },
                                { gameType: winner.gameType.toLowerCase() },
                                { name: { $regex: new RegExp(winner.gameType, 'i') } },
                                { slug: winner.gameType.toLowerCase() }
                            ]
                        }).select('name displayName title image shortcode');
                        
                        if (game) {
                            gameName = game.displayName || game.name || game.title || winner.gameType;
                            gameImage = game.image || null;
                        }
                    }
                } catch (err) {
                    console.error('Error fetching game details:', err);
                }
                
                return {
                    name: maskUsername(winner.username),
                    amount: winner.amount,
                    game: gameName, // ✅ Actual game name (e.g., "Juwa", "Fire Kirin")
                    gameImage: gameImage, // ✅ Game image path from image field
                    gameLogin: winner.gameLogin,
                    timestamp: winner.createdAt
                };
            })
        );
        
        res.json({
            success: true,
            message: 'Recent winners retrieved successfully',
            data: {
                winners: winnersWithImages
            }
        });
        
    } catch (error) {
        console.error('Error fetching recent winners:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching recent winners',
            data: {
                winners: []
            }
        });
    }
};

// Helper function to mask username
const maskUsername = (username) => {
    if (!username || username.length < 3) return 'User ***';
    
    const firstPart = username.substring(0, Math.min(username.length - 2, Math.ceil(username.length / 2)));
    const stars = '*'.repeat(Math.min(5, username.length - firstPart.length));
    
    return `${firstPart} ${stars}`;
};

module.exports = {
    getWallet,
    getWalletBalance,
    depositFunds,
    withdrawFunds,
    transferToGame,
    transferFromGame,
    getTransactionHistory,
    getTransaction,
    updateWalletSettings,
    getRecentWinners
};