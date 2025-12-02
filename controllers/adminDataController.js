// controllers/adminDataController.js
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Game = require('../models/Game');
const Settings = require('../models/Settings');
const PaymentMethod = require('../models/PaymentMethod');
const GameAccount = require('../models/GameAccount');
const axios = require('axios');
const { completeDepositWithBonus } = require('../helpers/depositHelper');
// ================================
// HELPER FUNCTIONS
// ================================

const getTimeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + ' years ago';
    
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + ' months ago';
    
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + ' days ago';
    
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + ' hours ago';
    
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + ' minutes ago';
    
    return Math.floor(seconds) + ' seconds ago';
};

// ================================
// ENHANCED DASHBOARD STATS WITH RECENT DATA
// ================================

const getStats = async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const recentUsers = await User.find()
            .sort({ createdAt: -1 })
            .limit(5)
            .select('username email createdAt')
            .lean();

        // ✅ FIX: Count active game accounts instead of Game model
        const activeGames = await GameAccount.countDocuments({ 
            status: 'active'
        });

        // Get all wallets with transactions
        const wallets = await Wallet.find({})
            .populate('userId', 'username email')
            .lean();

        let totalDeposits = 0;
        let totalWithdrawals = 0;
        let pendingWithdrawals = 0;
        let completedTransactions = 0;
        let totalBalance = 0;
        let activeWallets = 0;
        let recentTransactionsList = [];

        wallets.forEach(wallet => {
            totalBalance += wallet.balance || 0;
            if (wallet.balance > 0) activeWallets++;

            if (wallet.transactions && Array.isArray(wallet.transactions)) {
                wallet.transactions.forEach(tx => {
                    recentTransactionsList.push({
                        _id: tx._id,
                        username: wallet.userId?.username || 'Unknown',
                        userEmail: wallet.userId?.email || '',
                        type: tx.type,
                        amount: tx.amount,
                        netAmount: tx.netAmount,
                        fee: tx.fee || 0,
                        status: tx.status,
                        paymentMethod: tx.paymentMethod || 'N/A',
                        isBonus: tx.isBonus || false, // ✅ Add isBonus flag
                        createdAt: tx.createdAt,
                        timeAgo: getTimeAgo(tx.createdAt)
                    });

                    // ✅ FIXED: Only count REAL deposits (isBonus === false)
                    if (tx.type === 'deposit' && tx.status === 'completed' && tx.isBonus === false) {
                        totalDeposits += tx.amount || 0;
                        completedTransactions++;
                    } else if (tx.type === 'withdrawal') {
                        if (tx.status === 'completed') {
                            totalWithdrawals += tx.amount || 0;
                            completedTransactions++;
                        } else if (tx.status === 'pending') {
                            pendingWithdrawals++;
                        }
                    }
                });
            }
        });

        recentTransactionsList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const recentTransactions = recentTransactionsList.slice(0, 10);

        const monthlyGrowth = totalDeposits > 0 ? ((totalDeposits - totalWithdrawals) / totalDeposits * 100).toFixed(1) : 0;

        res.json({
            success: true,
            data: {
                totalUsers,
                activeGames,
                totalDeposits, // ✅ Now only REAL deposits
                totalWithdrawals,
                pendingTransactions: pendingWithdrawals,
                completedTransactions,
                revenue: totalDeposits - totalWithdrawals,
                totalRevenue: totalDeposits - totalWithdrawals,
                totalBalance,
                activeWallets,
                monthlyGrowth: parseFloat(monthlyGrowth),
                recentUsers,
                recentTransactions
            }
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ================================
// CHART DATA FOR DEPOSITS & WITHDRAWALS
// ================================

const getChartData = async (req, res) => {
    try {
        const { period = 'week', startDate, endDate } = req.query;

        // Calculate date range
        let start = new Date();
        let end = new Date();
        let groupBy = 'day';

        if (period === 'today') {
            start.setHours(0, 0, 0, 0);
            groupBy = 'hour';
        } else if (period === 'week') {
            start.setDate(start.getDate() - 7);
            groupBy = 'day';
        } else if (period === 'month') {
            start.setDate(start.getDate() - 30);
            groupBy = 'day';
        } else if (period === 'custom' && startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
            const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            groupBy = daysDiff > 60 ? 'month' : daysDiff > 7 ? 'week' : 'day';
        }

        // Get all wallets with transactions
        const wallets = await Wallet.find({}).lean();

        // Initialize data structure
        const chartData = [];
        const deposits = {};
        const withdrawals = {};

        // Process transactions
        wallets.forEach(wallet => {
            if (wallet.transactions && Array.isArray(wallet.transactions)) {
                wallet.transactions.forEach(tx => {
                    const txDate = new Date(tx.createdAt);
                    
                    // Filter by date range
                    if (txDate < start || txDate > end) return;
                    if (tx.status !== 'completed') return;

                    // Format date key based on groupBy
                    let dateKey;
                    if (groupBy === 'hour') {
                        dateKey = `${String(txDate.getHours()).padStart(2, '0')}:00`;
                    } else if (groupBy === 'day') {
                        dateKey = txDate.toISOString().split('T')[0];
                    } else if (groupBy === 'week') {
                        const weekStart = new Date(txDate);
                        weekStart.setDate(txDate.getDate() - txDate.getDay());
                        dateKey = weekStart.toISOString().split('T')[0];
                    } else if (groupBy === 'month') {
                        dateKey = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;
                    }

                    // ✅ FIXED: Only count REAL deposits (isBonus === false)
                    if (tx.type === 'deposit' && tx.isBonus === false) {
                        deposits[dateKey] = (deposits[dateKey] || 0) + (tx.amount || 0);
                    } else if (tx.type === 'withdrawal') {
                        withdrawals[dateKey] = (withdrawals[dateKey] || 0) + (tx.amount || 0);
                    }
                });
            }
        });

        // Convert to array format for charts
        const allDates = new Set([...Object.keys(deposits), ...Object.keys(withdrawals)]);
        const sortedDates = Array.from(allDates).sort();

        sortedDates.forEach(date => {
            chartData.push({
                date,
                deposits: deposits[date] || 0,
                withdrawals: withdrawals[date] || 0,
                net: (deposits[date] || 0) - (withdrawals[date] || 0)
            });
        });

        // Calculate summary
        const summary = {
            totalDeposits: Object.values(deposits).reduce((sum, val) => sum + val, 0),
            totalWithdrawals: Object.values(withdrawals).reduce((sum, val) => sum + val, 0),
            netRevenue: 0,
            averageDeposit: 0,
            averageWithdrawal: 0,
            transactionCount: sortedDates.length
        };

        summary.netRevenue = summary.totalDeposits - summary.totalWithdrawals;
        summary.averageDeposit = sortedDates.length > 0 ? summary.totalDeposits / sortedDates.length : 0;
        summary.averageWithdrawal = sortedDates.length > 0 ? summary.totalWithdrawals / sortedDates.length : 0;

        res.json({
            success: true,
            data: {
                chartData,
                summary,
                period,
                groupBy,
                dateRange: {
                    start: start.toISOString(),
                    end: end.toISOString()
                }
            }
        });

    } catch (error) {
        console.error('Error fetching chart data:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch chart data',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const getTransactions = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 50,
            type,
            status,
            paymentMethod,
            dateRange
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Build date filter
        let dateFilter = {};
        if (dateRange && dateRange !== 'all') {
            const now = new Date();
            const startDate = new Date();

            switch (dateRange) {
                case 'lastWeek':
                    startDate.setDate(now.getDate() - 7);
                    break;
                case 'lastMonth':
                    startDate.setMonth(now.getMonth() - 1);
                    break;
                case 'lastYear':
                    startDate.setFullYear(now.getFullYear() - 1);
                    break;
            }

            dateFilter = {
                $gte: startDate,
                $lte: now
            };
        }

        // Get all wallets with their transactions
        const wallets = await Wallet.find({}).populate('userId', 'username email').lean();

        let allTransactions = [];

        // Extract and format transactions from wallets
        wallets.forEach(wallet => {
            if (wallet.transactions && Array.isArray(wallet.transactions)) {
                wallet.transactions.forEach(tx => {
                    // Apply filters
                    let includeTransaction = true;

                    if (type && tx.type !== type) includeTransaction = false;
                    if (status && tx.status !== status) includeTransaction = false;
                    if (paymentMethod && tx.paymentMethod !== paymentMethod) includeTransaction = false;

                    if (dateFilter.$gte) {
                        const txDate = new Date(tx.createdAt);
                        if (txDate < dateFilter.$gte || txDate > dateFilter.$lte) {
                            includeTransaction = false;
                        }
                    }

                    if (includeTransaction) {
                        // Calculate risk level
                        let riskLevel = 'low';
                        if (tx.amount > 1000) riskLevel = 'high';
                        else if (tx.amount > 500) riskLevel = 'medium';
                        if (tx.status === 'failed') riskLevel = 'high';
                        if (tx.paymentMethod === 'crypto' && tx.amount > 100) riskLevel = 'medium';

                        // ✅ Build complete transaction object with ALL withdrawal details
                        allTransactions.push({
                            _id: tx._id,
                            transactionId: tx._id?.toString(),
                            user: wallet.userId?.username || 'Unknown',
                            userEmail: wallet.userId?.email || '',
                            userId: wallet.userId?._id || wallet.userId,
                            walletId: wallet._id,
                            type: tx.type,
                            amount: tx.amount,
                            netAmount: tx.netAmount,
                            fee: tx.fee || 0,
                            status: tx.status,
                            paymentMethod: tx.paymentMethod || 'N/A',
                            description: tx.description,
                            createdAt: tx.createdAt,
                            completedAt: tx.completedAt,
                            failedAt: tx.failedAt,
                            external_id: tx.external_id,
                            txid: tx.txid,
                            
                            // ✅ Crypto withdrawal details
                            withdrawalAddress: tx.withdrawalAddress,
                            cryptoType: tx.cryptoType,
                            cryptoAmount: tx.cryptoAmount,
                            
                            // ✅ CashApp withdrawal details
                            cashappTag: tx.cashappTag,
                            cashappName: tx.cashappName,
                            
                            // ✅ Chime withdrawal details
                            chimeTag: tx.chimeTag,
                            chimeFullName: tx.chimeFullName,
                            
                            // ✅ Bonus flag
                            isBonus: tx.isBonus || false,
                            
                            paymentRef: tx.paymentRef,
                            riskLevel: riskLevel,
                            timeAgo: getTimeAgo(tx.createdAt),
                            direction: ['deposit', 'game_withdrawal', 'bonus', 'refund'].includes(tx.type) ? 'in' : 'out',
                            balanceBefore: tx.balanceBefore || 0,
                            balanceAfter: tx.balanceAfter || 0
                        });
                    }
                });
            }
        });

        // Sort by date (most recent first)
        allTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // ✅ FIXED: Calculate stats for all transactions (before pagination) - only count REAL deposits
        const stats = {
            totalDeposits: 0,
            totalWithdrawals: 0,
            pendingCount: 0,
            completedCount: 0,
            failedCount: 0
        };

        allTransactions.forEach(tx => {
            if (tx.status === 'completed') {
                // ✅ FIXED: Only count REAL deposits (isBonus === false)
                if (tx.type === 'deposit' && tx.isBonus === false) {
                    stats.totalDeposits += tx.netAmount || tx.amount || 0;
                } else if (tx.type === 'withdrawal') {
                    stats.totalWithdrawals += tx.amount || 0;
                }
                stats.completedCount++;
            } else if (tx.status === 'pending') {
                stats.pendingCount++;
            } else if (tx.status === 'failed') {
                stats.failedCount++;
            }
        });

        // Apply pagination
        const paginatedTransactions = allTransactions.slice(skip, skip + parseInt(limit));

        res.json({
            success: true,
            data: {
                transactions: paginatedTransactions,
                stats,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(allTransactions.length / parseInt(limit)),
                    totalTransactions: allTransactions.length,
                    limit: parseInt(limit)
                }
            }
        });

    } catch (error) {
        console.error('Error fetching transactions:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transactions',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ================================
// WITHDRAWAL MANAGEMENT
// ================================

const approveWithdrawal = async (req, res) => {
    try {
        const { walletId, transactionId } = req.body;

        if (!walletId || !transactionId) {
            return res.status(400).json({
                success: false,
                message: 'Wallet ID and Transaction ID are required'
            });
        }

        const wallet = await Wallet.findById(walletId).populate('userId', 'username email');
        if (!wallet) {
            return res.status(404).json({
                success: false,
                message: 'Wallet not found'
            });
        }

        const transaction = wallet.transactions.id(transactionId);
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        if (transaction.type !== 'withdrawal') {
            return res.status(400).json({
                success: false,
                message: 'Only withdrawal transactions can be approved'
            });
        }

        if (transaction.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Transaction is already ${transaction.status}`
            });
        }

        const paymentMethod = transaction.paymentMethod || 'unknown';

        if (paymentMethod === 'crypto') {
            return await processCryptoWithdrawalAdmin(wallet, transaction, req, res);
        } else if (paymentMethod === 'cashapp' || paymentMethod === 'chime') {
            return await approveManualWithdrawal(wallet, transaction, res);
        } else {
            return res.status(400).json({
                success: false,
                message: `Unknown payment method: ${paymentMethod}`
            });
        }

    } catch (error) {
        console.error('Error approving withdrawal:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve withdrawal',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const processCryptoWithdrawalAdmin = async (wallet, transaction, req, res) => {
    try {
        // Get crypto config
        const cryptoConfig = await PaymentMethod.getConfig('crypto');
        if (!cryptoConfig || !cryptoConfig.gatewayUrl || !cryptoConfig.username || !cryptoConfig.password) {
            return res.status(500).json({
                success: false,
                message: 'Crypto payment gateway not configured properly'
            });
        }

        const { withdrawalAddress, cryptoType, cryptoAmount, amount } = transaction;

        if (!withdrawalAddress || !cryptoType) {
            return res.status(400).json({
                success: false,
                message: 'Missing withdrawal address or crypto type'
            });
        }

        const { processCryptoWithdrawal } = require('./paymentController');
        const finalCryptoAmount = cryptoAmount || amount;

        console.log('🔄 Processing crypto withdrawal via gateway...');
        console.log('   Crypto Type:', cryptoType);
        console.log('   Amount:', finalCryptoAmount);
        console.log('   Address:', withdrawalAddress);

        // Process the withdrawal through the gateway
        const withdrawalResult = await processCryptoWithdrawal(
            finalCryptoAmount,
            cryptoType,
            withdrawalAddress,
            transaction._id
        );

        console.log('✅ Crypto withdrawal processed successfully');
        console.log('   Task ID:', withdrawalResult.task_id);
        console.log('   TX Hash:', withdrawalResult.transaction_hash);

        // Reload wallet to get updated state
        const updatedWallet = await Wallet.findById(wallet._id);
        
        res.json({
            success: true,
            message: 'Crypto withdrawal processed successfully',
            data: {
                transactionId: transaction._id,
                txid: withdrawalResult.transaction_hash || withdrawalResult.task_id,
                taskId: withdrawalResult.task_id,
                amount: transaction.amount,
                status: 'completed',
                cryptoType: cryptoType,
                withdrawalAddress: withdrawalAddress,
                newPendingBalance: updatedWallet.pendingBalance,
                newAvailableBalance: updatedWallet.availableBalance
            }
        });

    } catch (error) {
        console.error('❌ Error processing crypto withdrawal:', error);
        console.error('   Error message:', error.message);
        console.error('   Error response:', error.response?.data);

        // ✅ CRITICAL FIX: Do NOT manually adjust balances here
        // Let updateWalletTransactionStatus handle everything
        
        // Just mark transaction as failed - the helper function will handle refund
        try {
            // Get fresh wallet state before update
            const freshWallet = await Wallet.findById(wallet._id);
            const freshTransaction = freshWallet.transactions.id(transaction._id);
            
            // Only update if still pending (prevent double processing)
            if (freshTransaction && freshTransaction.status === 'pending') {
                console.log('🔄 Marking transaction as failed and triggering refund...');
                
                // ✅ This will handle the refund properly - no manual balance adjustments needed
                const { updateWalletTransactionStatus } = require('./paymentController');
                await updateWalletTransactionStatus(transaction._id, 'failed', {
                    error: error.message,
                    errorResponse: error.response?.data,
                    failedAt: new Date().toISOString()
                });
                
                console.log('✅ Transaction marked as failed and refund completed');
            } else {
                console.log('⚠️  Transaction already processed, skipping refund');
            }
        } catch (updateError) {
            console.error('❌ Error updating transaction status:', updateError);
        }

        res.status(500).json({
            success: false,
            message: 'Failed to process crypto withdrawal',
            error: process.env.NODE_ENV === 'development' 
                ? error.response?.data || error.message 
                : 'Withdrawal processing failed. Amount has been refunded.'
        });
    }
};

const approveManualWithdrawal = async (wallet, transaction, res) => {
    try {
        wallet.pendingBalance = Math.max(0, wallet.pendingBalance - transaction.amount);
        wallet.balance = Math.max(0, wallet.balance - transaction.amount);
        wallet.updateAvailableBalance();
        
        transaction.status = 'completed';
        transaction.completedAt = new Date();
        transaction.description = `${transaction.paymentMethod} withdrawal - Completed (Manual payment confirmed)`;

        await wallet.save();

        res.json({
            success: true,
            message: `${transaction.paymentMethod} withdrawal approved successfully`,
            data: {
                transactionId: transaction._id,
                amount: transaction.amount,
                status: transaction.status,
                paymentMethod: transaction.paymentMethod,
                newPendingBalance: wallet.pendingBalance,
                newAvailableBalance: wallet.availableBalance
            }
        });

    } catch (error) {
        console.error('Error approving manual withdrawal:', error);
        throw error;
    }
};

const rejectWithdrawal = async (req, res) => {
    try {
        const { walletId, transactionId, reason } = req.body;

        if (!walletId || !transactionId) {
            return res.status(400).json({
                success: false,
                message: 'Wallet ID and Transaction ID are required'
            });
        }

        const wallet = await Wallet.findById(walletId);
        if (!wallet) {
            return res.status(404).json({
                success: false,
                message: 'Wallet not found'
            });
        }

        const transaction = wallet.transactions.id(transactionId);
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        if (transaction.type !== 'withdrawal') {
            return res.status(400).json({
                success: false,
                message: 'Only withdrawal transactions can be rejected'
            });
        }

        if (transaction.status !== 'pending') {
            return res.status(400).json({
                success: false,
                message: `Transaction is already ${transaction.status}`
            });
        }

        wallet.pendingBalance = Math.max(0, wallet.pendingBalance - transaction.amount);
        wallet.updateAvailableBalance();

        transaction.status = 'failed';
        transaction.failedAt = new Date();
        transaction.description = `Withdrawal rejected by admin${reason ? `: ${reason}` : ''}`;

        await wallet.save();

        res.json({
            success: true,
            message: 'Withdrawal rejected and amount refunded to user',
            data: {
                transactionId: transaction._id,
                refundedAmount: transaction.amount,
                newBalance: wallet.balance,
                newPendingBalance: wallet.pendingBalance,
                newAvailableBalance: wallet.availableBalance
            }
        });

    } catch (error) {
        console.error('Error rejecting withdrawal:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reject withdrawal',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const getTransactionDetails = async (req, res) => {
    try {
        const { transactionId } = req.params;

        const wallet = await Wallet.findOne({
            'transactions._id': transactionId
        }).populate('userId', 'username email createdAt');

        if (!wallet) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        const transaction = wallet.transactions.id(transactionId);

        res.json({
            success: true,
            data: {
                transaction: {
                    _id: transaction._id,
                    type: transaction.type,
                    amount: transaction.amount,
                    netAmount: transaction.netAmount,
                    fee: transaction.fee || 0,
                    status: transaction.status,
                    paymentMethod: transaction.paymentMethod,
                    description: transaction.description,
                    createdAt: transaction.createdAt,
                    completedAt: transaction.completedAt,
                    failedAt: transaction.failedAt,
                    external_id: transaction.external_id,
                    txid: transaction.txid,
                    withdrawalAddress: transaction.withdrawalAddress,
                    cryptoType: transaction.cryptoType,
                    chimeTag: transaction.chimeTag,
                    paymentRef: transaction.paymentRef
                },
                user: {
                    _id: wallet.userId._id,
                    username: wallet.userId.username,
                    email: wallet.userId.email,
                    memberSince: wallet.userId.createdAt
                },
                wallet: {
                    _id: wallet._id,
                    currentBalance: wallet.balance,
                    availableBalance: wallet.availableBalance,
                    pendingBalance: wallet.pendingBalance
                }
            }
        });

    } catch (error) {
        console.error('Error fetching transaction details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch transaction details',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ================================
// USERS MANAGEMENT
// =================================

const getUsers = async (req, res) => {
    try {
        const { page = 1, limit = 20, search, status } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // ✅ BUILD QUERY WITH IP SEARCH SUPPORT
        let query = {};
        
        if (search) {
            query.$or = [
                { username: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { 'profile.email': { $regex: search, $options: 'i' } }, // ✅ Added
                { 'account.signupIP': { $regex: search, $options: 'i' } }, // ✅ Added
                { 'account.lastLoginIP': { $regex: search, $options: 'i' } } // ✅ Added
            ];
        }
        
        if (status && status !== 'all') {
            if (status === 'active') {
                query['account.isActive'] = true;
            } else if (status === 'suspended') {
                query['account.isActive'] = false;
            }
        }

        // ✅ FETCH USERS WITH ACCOUNT FIELDS (INCLUDING IP DATA)
        const users = await User.find(query)
            .select('username email createdAt account profile') // ✅ Include account field
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 })
            .lean();

        // Get wallet balance for each user
        const usersWithWallets = await Promise.all(
            users.map(async (user) => {
                const wallet = await Wallet.findOne({ userId: user._id }).lean();
                return {
                    ...user,
                    wallet: wallet ? {
                        balance: wallet.balance || 0,
                        availableBalance: wallet.availableBalance || 0,
                        pendingBalance: wallet.pendingBalance || 0
                    } : {
                        balance: 0,
                        availableBalance: 0,
                        pendingBalance: 0
                    }
                };
            })
        );

        const totalUsers = await User.countDocuments(query);

        res.json({
            success: true,
            data: {
                users: usersWithWallets,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: Math.ceil(totalUsers / parseInt(limit)),
                    totalUsers,
                    limit: parseInt(limit)
                }
            }
        });

    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch users',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ================================
// GAMES MANAGEMENT
// ================================

// ================================
// GAMES MANAGEMENT
// ================================

const getGames = async (req, res) => {
    try {
        const { 
            page = 1, 
            limit = 100, 
            search, 
            status, 
            category,
            sortBy = 'order',
            sortOrder = 'asc' 
        } = req.query;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Build query
        let query = {};
        
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { shortcode: { $regex: search, $options: 'i' } },
                { category: { $regex: search, $options: 'i' } }
            ];
        }
        
        if (status && status !== 'all') {
            query.status = status;
        }

        if (category && category !== 'all') {
            query.category = category;
        }

        // Build sort object
        const sort = {};
        sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Fetch games with all fields including images
        const games = await Game.find(query)
            .select('name slug shortcode category status gameUrl downloadUrl image thumbnail agentUsername rating isNew isFeatured order displayName gameType title stats createdAt updatedAt')
            .sort(sort)
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        // Get game accounts stats for each game
        const gamesWithStats = await Promise.all(
            games.map(async (game) => {
                const GameAccount = require('../models/GameAccount');
                
                const accountStats = await GameAccount.aggregate([
                    { $match: { gameId: game._id } },
                    {
                        $group: {
                            _id: null,
                            totalAccounts: { $sum: 1 },
                            activeAccounts: {
                                $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
                            }
                        }
                    }
                ]);

                // Calculate total transactions and volume from wallets
                const wallets = await Wallet.find({
                    'transactions.gameDetails.gameType': game.gameType
                }).lean();

                let totalTransactions = 0;
                let totalVolume = 0;

                wallets.forEach(wallet => {
                    if (wallet.transactions && Array.isArray(wallet.transactions)) {
                        wallet.transactions.forEach(tx => {
                            if (tx.gameDetails?.gameType === game.gameType && 
                                tx.status === 'completed') {
                                totalTransactions++;
                                totalVolume += tx.amount || 0;
                            }
                        });
                    }
                });

                return {
                    ...game,
                    stats: {
                        totalAccounts: accountStats[0]?.totalAccounts || 0,
                        activeAccounts: accountStats[0]?.activeAccounts || 0,
                        totalTransactions: totalTransactions,
                        totalVolume: totalVolume
                    }
                };
            })
        );

        const totalGames = await Game.countDocuments(query);

        // Calculate overall stats
        const overallStats = {
            totalGames: totalGames,
            activeGames: gamesWithStats.filter(g => g.status === 'active').length,
            totalPlayers: gamesWithStats.reduce((sum, g) => sum + (g.stats?.totalAccounts || 0), 0),
            totalRevenue: gamesWithStats.reduce((sum, g) => sum + (g.stats?.totalVolume || 0), 0)
        };

        res.json({
            success: true,
            data: gamesWithStats,
            stats: overallStats,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalGames / parseInt(limit)),
                totalGames,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error fetching games:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch games',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ================================
// WALLET STATISTICS
// ================================

const getWalletStats = async (req, res) => {
    try {
        const wallets = await Wallet.find({}).lean();

        let totalBalance = 0;
        let totalAvailableBalance = 0;
        let totalPendingBalance = 0;
        let activeWallets = 0;
        let totalDeposits = 0;
        let totalWithdrawals = 0;

        wallets.forEach(wallet => {
            totalBalance += wallet.balance || 0;
            totalAvailableBalance += wallet.availableBalance || 0;
            totalPendingBalance += wallet.pendingBalance || 0;
            
            if (wallet.balance > 0) activeWallets++;

            if (wallet.transactions && Array.isArray(wallet.transactions)) {
                wallet.transactions.forEach(tx => {
                    // ✅ FIXED: Only count REAL deposits (isBonus === false)
                    if (tx.type === 'deposit' && tx.status === 'completed' && tx.isBonus === false) {
                        totalDeposits += tx.amount || 0;
                    } else if (tx.type === 'withdrawal' && tx.status === 'completed') {
                        totalWithdrawals += tx.amount || 0;
                    }
                });
            }
        });

        res.json({
            success: true,
            data: {
                totalBalance,
                totalAvailableBalance,
                totalPendingBalance,
                activeWallets,
                totalWallets: wallets.length,
                totalDeposits, // ✅ Now only REAL deposits
                totalWithdrawals,
                netRevenue: totalDeposits - totalWithdrawals
            }
        });

    } catch (error) {
        console.error('Error fetching wallet stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch wallet statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ================================
// USER WALLET DEBUG
// ================================

const getUserWallet = async (req, res) => {
    try {
        const { userId } = req.params;

        const wallet = await Wallet.findOne({ userId })
            .populate('userId', 'username email createdAt')
            .lean();

        if (!wallet) {
            return res.status(404).json({
                success: false,
                message: 'Wallet not found for this user'
            });
        }

        res.json({
            success: true,
            data: { wallet }
        });

    } catch (error) {
        console.error('Error fetching user wallet:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user wallet',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ================================
// DEBUG UTILITIES
// ================================

const getDebugUsersWithWallets = async (req, res) => {
    try {
        const users = await User.find({})
            .select('username email createdAt account')
            .limit(10)
            .lean();

        const usersWithWallets = await Promise.all(
            users.map(async (user) => {
                const wallet = await Wallet.findOne({ userId: user._id }).lean();
                return {
                    ...user,
                    wallet: wallet ? {
                        balance: wallet.balance,
                        availableBalance: wallet.availableBalance,
                        pendingBalance: wallet.pendingBalance,
                        transactionCount: wallet.transactions?.length || 0
                    } : null
                };
            })
        );

        res.json({
            success: true,
            data: { users: usersWithWallets }
        });

    } catch (error) {
        console.error('Error fetching debug users with wallets:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch debug data',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Add this new function to adminDataController.js

const updateUserStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        const { action } = req.body; // 'activate' or 'suspend'

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }

        if (!action || !['activate', 'suspend'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: 'Valid action is required (activate or suspend)'
            });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Update user status
        if (!user.account) {
            user.account = {};
        }
        user.account.isActive = action === 'activate';
        await user.save();

        res.json({
            success: true,
            message: `User ${action === 'activate' ? 'activated' : 'suspended'} successfully`,
            data: {
                userId: user._id,
                username: user.username,
                isActive: user.account.isActive
            }
        });

    } catch (error) {
        console.error('Error updating user status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update user status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Add this to get user details
const getUserDetails = async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findById(userId)
            .select('username email createdAt account profile')
            .lean();

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Get wallet with transactions
        const wallet = await Wallet.findOne({ userId }).lean();

        // Calculate stats
        let totalDeposits = 0;
        let totalWithdrawals = 0;
        let completedDeposits = 0;
        let completedWithdrawals = 0;
        let pendingTransactions = 0;

        if (wallet && wallet.transactions) {
            wallet.transactions.forEach(tx => {
                if (tx.type === 'deposit') {
                    if (tx.status === 'completed') {
                        totalDeposits += tx.amount || 0;
                        completedDeposits++;
                    }
                } else if (tx.type === 'withdrawal') {
                    if (tx.status === 'completed') {
                        totalWithdrawals += tx.amount || 0;
                        completedWithdrawals++;
                    } else if (tx.status === 'pending') {
                        pendingTransactions++;
                    }
                }
            });
        }

        // Get game accounts
        const GameAccount = require('../models/GameAccount');
        const gameAccounts = await GameAccount.find({ userId })
            .populate('gameId', 'name slug')
            .lean();

        res.json({
            success: true,
            data: {
                user: {
                    ...user,
                    wallet: wallet ? {
                        balance: wallet.balance || 0,
                        availableBalance: wallet.availableBalance || 0,
                        pendingBalance: wallet.pendingBalance || 0
                    } : null
                },
                stats: {
                    totalDeposits,
                    totalWithdrawals,
                    completedDeposits,
                    completedWithdrawals,
                    pendingTransactions,
                    netAmount: totalDeposits - totalWithdrawals,
                    gameAccountsCount: gameAccounts.length
                },
                gameAccounts
            }
        });

    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user details',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


const manualCompleteDeposit = async (req, res) => {
    try {
        const { walletId, transactionId, notes } = req.body;

        // Validation
        if (!walletId || !transactionId) {
            return res.status(400).json({
                success: false,
                message: 'Wallet ID and Transaction ID are required'
            });
        }

        // ✅ Use centralized helper
        const result = await completeDepositWithBonus(walletId, transactionId, {
            completedBy: req.user.username || 'Admin',
            completedByUserId: req.user.userId,
            adminNotes: notes,
            isManual: true
        });

        const responseData = {
            transactionId: transactionId,
            userId: result.wallet.userId,
            amount: result.transaction.amount,
            previousStatus: 'pending',
            newStatus: 'completed',
            paymentMethod: result.transaction.paymentMethod,
            completedBy: req.user.username || 'Admin',
            completedAt: result.transaction.completedAt,
            wallet: result.wallet
        };

        // Add bonus info if applicable
        if (result.bonusInfo) {
            responseData.bonusApplied = result.bonusInfo;
        }

        const message = result.bonusInfo 
            ? `Deposit of $${result.transaction.amount.toFixed(2)} manually completed with ${result.bonusInfo.description} of $${result.bonusInfo.amount.toFixed(2)}!`
            : `Deposit of $${result.transaction.amount.toFixed(2)} manually completed successfully`;

        res.json({
            success: true,
            message,
            data: responseData
        });

    } catch (error) {
        console.error('Error in manualCompleteDeposit:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to manually complete deposit',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};



const getSettings = async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    
    res.json({
      success: true,
      data: settings
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch settings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const updateSignupBonus = async (req, res) => {
  try {
    const { amount, enabled } = req.body;
    
    if (amount === undefined || amount < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required (must be >= 0)'
      });
    }
    
    const settings = await Settings.getSettings();
    await settings.updateSignupBonus(amount, enabled !== false);
    
    res.json({
      success: true,
      message: 'Signup bonus updated successfully',
      data: {
        signupBonus: settings.signupBonus
      }
    });
  } catch (error) {
    console.error('Error updating signup bonus:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update signup bonus',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const updateFirstDepositBonus = async (req, res) => {
  try {
    const { percentage, minDeposit, maxBonus, enabled } = req.body;
    
    if (percentage === undefined || percentage < 0 || percentage > 500) {
      return res.status(400).json({
        success: false,
        message: 'Valid percentage is required (0-500%)'
      });
    }
    
    if (minDeposit === undefined || minDeposit < 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid minimum deposit is required'
      });
    }
    
    const settings = await Settings.getSettings();
    await settings.updateFirstDepositBonus(
      percentage, 
      minDeposit, 
      maxBonus || null, 
      enabled !== false
    );
    
    res.json({
      success: true,
      message: 'First deposit bonus updated successfully',
      data: {
        firstDepositBonus: settings.firstDepositBonus
      }
    });
  } catch (error) {
    console.error('Error updating first deposit bonus:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update first deposit bonus',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const createPromotionalBonus = async (req, res) => {
  try {
    const {
      title,
      description,
      bonusPercentage,
      bonusType,
      startDate,
      endDate,
      minDeposit,
      maxBonus,
      termsAndConditions,
      isVisible
    } = req.body;
    
    if (!title || !bonusPercentage || !startDate || !endDate) {
      return res.status(400).json({
        success: false,
        message: 'Title, bonus percentage, start date, and end date are required'
      });
    }
    
    if (bonusPercentage < 0 || bonusPercentage > 500) {
      return res.status(400).json({
        success: false,
        message: 'Bonus percentage must be between 0 and 500%'
      });
    }
    
    if (new Date(startDate) >= new Date(endDate)) {
      return res.status(400).json({
        success: false,
        message: 'End date must be after start date'
      });
    }
    
    const settings = await Settings.getSettings();
    
    const bonusData = {
      title,
      description: description || '',
      bonusPercentage,
      bonusType: bonusType || 'deposit',
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      minDeposit: minDeposit || 0,
      maxBonus: maxBonus || null,
      termsAndConditions: termsAndConditions || '',
      isVisible: isVisible !== false
    };
    
    await settings.addPromotionalBonus(bonusData);
    
    res.json({
      success: true,
      message: 'Promotional bonus created successfully',
      data: {
        bonus: settings.promotionalBonuses[settings.promotionalBonuses.length - 1]
      }
    });
  } catch (error) {
    console.error('Error creating promotional bonus:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create promotional bonus',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const updatePromotionalBonus = async (req, res) => {
  try {
    const { bonusId } = req.params;
    const updateData = req.body;
    
    if (!bonusId) {
      return res.status(400).json({
        success: false,
        message: 'Bonus ID is required'
      });
    }
    
    if (updateData.startDate && updateData.endDate) {
      if (new Date(updateData.startDate) >= new Date(updateData.endDate)) {
        return res.status(400).json({
          success: false,
          message: 'End date must be after start date'
        });
      }
    }
    
    const settings = await Settings.getSettings();
    await settings.updatePromotionalBonus(bonusId, updateData);
    
    const updatedBonus = settings.promotionalBonuses.id(bonusId);
    
    res.json({
      success: true,
      message: 'Promotional bonus updated successfully',
      data: {
        bonus: updatedBonus
      }
    });
  } catch (error) {
    console.error('Error updating promotional bonus:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to update promotional bonus',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const deletePromotionalBonus = async (req, res) => {
  try {
    const { bonusId } = req.params;
    
    if (!bonusId) {
      return res.status(400).json({
        success: false,
        message: 'Bonus ID is required'
      });
    }
    
    const settings = await Settings.getSettings();
    await settings.deletePromotionalBonus(bonusId);
    
    res.json({
      success: true,
      message: 'Promotional bonus deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting promotional bonus:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete promotional bonus',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


const getActivePromotionalBonus = async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    const activeBonus = settings.getActivePromotionalBonus();
    
    res.json({
      success: true,
      data: {
        activeBonus: activeBonus || null,
        signupBonus: settings.signupBonus,  // ✅ Add signup bonus
        firstDepositBonus: settings.firstDepositBonus
      }
    });
  } catch (error) {
    console.error('Error fetching active promotional bonus:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch active promotional bonus',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

const updateGeneralSettings = async (req, res) => {
  try {
    const { siteName, siteDescription, maintenanceMode, registrationEnabled, emailVerificationRequired } = req.body;
    
    const settings = await Settings.getSettings();
    
    if (siteName !== undefined) settings.general.siteName = siteName;
    if (siteDescription !== undefined) settings.general.siteDescription = siteDescription;
    if (maintenanceMode !== undefined) settings.general.maintenanceMode = maintenanceMode;
    if (registrationEnabled !== undefined) settings.general.registrationEnabled = registrationEnabled;
    if (emailVerificationRequired !== undefined) settings.general.emailVerificationRequired = emailVerificationRequired;
    
    await settings.save();
    
    res.json({
      success: true,
      message: 'General settings updated successfully',
      data: {
        general: settings.general
      }
    });
  } catch (error) {
    console.error('Error updating general settings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update general settings',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


// Don't forget to export these new functions
module.exports = {
    getStats,
    getChartData,
    getTransactions,
    approveWithdrawal,
    rejectWithdrawal,
    getTransactionDetails,
    updateUserStatus, // ✅ Add this
    getUserDetails,   // ✅ Add this
    manualCompleteDeposit,

    // Existing exports
    getUsers,
    getGames,
    getWalletStats,
    getUserWallet,
    getDebugUsersWithWallets,

    getSettings,
  updateSignupBonus,
  updateFirstDepositBonus,
  createPromotionalBonus,
  updatePromotionalBonus,
  deletePromotionalBonus,
  getActivePromotionalBonus,
  updateGeneralSettings
};

