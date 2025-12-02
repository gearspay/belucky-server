// controllers/walletController.js - UPDATED WITH BONUS LOGIC

const Wallet = require('../models/Wallet');
const GameAccount = require('../models/GameAccount');
const PaymentMethod = require('../models/PaymentMethod');

// Get user's wallet information
const getWallet = async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        const pendingWithdrawals = wallet.transactions
            .filter(t => t.status === 'pending' && t.type === 'withdrawal')
            .reduce((sum, t) => sum + t.amount, 0);
        
        const pendingDeposits = wallet.transactions
            .filter(t => t.status === 'pending' && t.type === 'deposit')
            .reduce((sum, t) => sum + t.amount, 0);
        
        const recentTransactions = wallet.transactions
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 10);
        
        const summary = wallet.getTransactionSummary(30);
        
        res.json({
            success: true,
            message: 'Wallet retrieved successfully',
            data: {
                balance: wallet.balance,
                bonusBalance: wallet.bonusBalance, // ✅ NEW
                availableBalance: wallet.availableBalance,
                availableBonusBalance: wallet.availableBonusBalance, // ✅ NEW
                totalAvailableBalance: wallet.availableBalance + wallet.availableBonusBalance, // ✅ NEW
                pendingBalance: wallet.pendingBalance,
                pendingWithdrawals,
                pendingDeposits,
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

// Get wallet balance only
const getWalletBalance = async (req, res) => {
    try {
        const userId = req.user.userId;
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        res.json({
            success: true,
            data: {
                balance: wallet.balance,
                bonusBalance: wallet.bonusBalance, // ✅ NEW
                availableBalance: wallet.availableBalance,
                availableBonusBalance: wallet.availableBonusBalance, // ✅ NEW
                totalAvailableBalance: wallet.availableBalance + wallet.availableBonusBalance, // ✅ NEW
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

// ✅ NEW: Add bonus to wallet
const addBonus = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { amount, description } = req.body;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required (must be greater than 0)'
            });
        }
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        if (wallet.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Wallet is not active'
            });
        }
        
        const transaction = wallet.addBonus(amount, description || 'Bonus added to wallet');
        await wallet.save();
        
        res.json({
            success: true,
            message: 'Bonus added successfully',
            data: {
                transactionId: transaction._id,
                amount,
                bonusBalance: wallet.bonusBalance,
                availableBonusBalance: wallet.availableBonusBalance
            }
        });
        
    } catch (error) {
        console.error('Error adding bonus:', error);
        res.status(500).json({
            success: false,
            message: 'Error adding bonus'
        });
    }
};

// Deposit funds
const depositFunds = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { amount, paymentMethod, description, external_id } = req.body;
        
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
        }
        
        const feeAmount = (amount * depositFeePercent) / 100;
        
        const transactionData = {
            type: 'deposit',
            amount,
            description: description || 'Wallet deposit',
            paymentMethod,
            status: 'pending',
            fee: feeAmount
        };
        
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

// Withdraw funds - UPDATED WITH DEPOSIT PLAY REQUIREMENT CHECK
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

        if (paymentMethod === 'cashapp' && !cashappTag) {
            return res.status(400).json({
                success: false,
                message: 'CashApp tag is required'
            });
        }

        if (paymentMethod === 'chime' && (!chimeTag || !chimeName)) {
            return res.status(400).json({
                success: false,
                message: 'Chime tag and full name are required'
            });
        }

        if (paymentMethod === 'crypto' && (!cryptoType || !cryptoAddress)) {
            return res.status(400).json({
                success: false,
                message: 'Crypto type and address are required'
            });
        }
        
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        if (wallet.status !== 'active') {
            return res.status(403).json({
                success: false,
                message: 'Wallet is not active'
            });
        }
        
        // ✅ NEW CHECK: Must play deposit before withdrawal
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔍 CHECKING DEPOSIT PLAY REQUIREMENT');
        
        // ✅ FIXED: Get last REAL deposit (excluding bonus deposits)
        const lastDeposit = wallet.transactions
            .filter(t => 
                t.type === 'deposit' && 
                t.status === 'completed' && 
                t.isBonus === false  // ✅ Only real deposits, not bonus transactions
            )
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
        
        if (lastDeposit) {
            console.log(`   Last Real Deposit: $${lastDeposit.amount} at ${lastDeposit.createdAt}`);
            console.log(`   Is Bonus: ${lastDeposit.isBonus ? 'YES' : 'NO'}`);
            
            // Get total amount transferred to games AFTER this deposit (both cash and bonus)
            const transferredToGames = wallet.transactions
                .filter(t => 
                    t.type === 'game_deposit' && 
                    t.status === 'completed' &&
                    new Date(t.createdAt) >= new Date(lastDeposit.createdAt)
                )
                .reduce((sum, t) => sum + t.amount, 0);
            
            console.log(`   Amount Played in Games: $${transferredToGames}`);
            console.log(`   Deposit Amount: $${lastDeposit.amount}`);
            
            // Check if deposit amount has been fully played
            if (transferredToGames < lastDeposit.amount) {
                const remainingToPlay = lastDeposit.amount - transferredToGames;
                
                console.log(`   ❌ INSUFFICIENT PLAY - Need $${remainingToPlay} more`);
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
                
                return res.status(400).json({
                    success: false,
                    message: `You must play your deposit ($${lastDeposit.amount.toFixed(2)}) in games before withdrawing. You've played $${transferredToGames.toFixed(2)} so far. Play $${remainingToPlay.toFixed(2)} more to unlock withdrawals.`,
                    data: {
                        depositAmount: lastDeposit.amount,
                        playedAmount: transferredToGames,
                        remainingToPlay: remainingToPlay,
                        depositDate: lastDeposit.createdAt,
                        requirementMet: false
                    }
                });
            }
            
            console.log(`   ✅ REQUIREMENT MET - Deposit has been played`);
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        } else {
            console.log('   ℹ️  No real deposit found - allowing withdrawal');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
        }
        
        // ✅ CHECK: Cannot withdraw bonus balance directly
        if (amount > wallet.availableBalance) {
            return res.status(400).json({
                success: false,
                message: `Insufficient withdrawable balance. You have $${wallet.availableBalance.toFixed(2)} available for withdrawal. Bonus balance ($${wallet.bonusBalance.toFixed(2)}) can only be used for games.`
            });
        }
        
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
        
        const feeAmount = (amount * withdrawalFeePercent) / 100;
        const netAmount = amount - feeAmount;
        
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
        
        const transactionData = {
            type: 'withdrawal',
            amount,
            description: description || 'Wallet withdrawal',
            paymentMethod,
            status: 'pending',
            fee: feeAmount,
            netAmount: netAmount
        };

        if (paymentMethod === 'cashapp') {
            transactionData.cashappTag = cashappTag;
            if (cashappName) {
                transactionData.cashappName = cashappName;
            }
        }

        if (paymentMethod === 'chime') {
            transactionData.chimeTag = chimeTag;
            transactionData.chimeFullName = chimeName;
        }

        if (paymentMethod === 'crypto') {
            transactionData.cryptoType = cryptoType;
            transactionData.withdrawalAddress = cryptoAddress;
            if (cryptoAmount) {
                transactionData.cryptoAmount = cryptoAmount;
            }
        }
        
        const transaction = wallet.addTransaction(transactionData);
        wallet.processWithdrawal(amount);
        
        await wallet.save();

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
};

// ✅ UPDATED: Transfer to game (with bonus support)
const transferToGame = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { gameAccountId, amount, description, useBonus } = req.body;
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💸 TRANSFER TO GAME REQUEST`);
    console.log(`User: ${userId}`);
    console.log(`Game Account: ${gameAccountId}`);
    console.log(`Amount: $${amount}`);
    console.log(`Use Bonus: ${useBonus}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be a positive whole number'
      });
    }
    
    if (!gameAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Game account ID is required'
      });
    }
    
    const gameAccount = await GameAccount.findOne({ _id: gameAccountId, userId });
    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }
    
    const wallet = await Wallet.findOrCreateWallet(userId);
    
    console.log(`📊 WALLET STATE BEFORE:`);
    console.log(`   Regular Balance: $${wallet.balance}`);
    console.log(`   Bonus Balance: $${wallet.bonusBalance}`);
    console.log(`   Available Balance: $${wallet.availableBalance}`);
    console.log(`   Available Bonus Balance: $${wallet.availableBonusBalance}`);
    
    const isBonus = useBonus === true;
    
    // Check appropriate balance
    if (isBonus) {
      console.log(`✅ Checking BONUS balance: $${wallet.availableBonusBalance} >= $${amount}?`);
      if (wallet.availableBonusBalance < amount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient bonus balance. Available: $${wallet.availableBonusBalance.toFixed(2)}`
        });
      }
    } else {
      console.log(`✅ Checking REGULAR balance: $${wallet.availableBalance} >= $${amount}?`);
      if (wallet.availableBalance < amount) {
        return res.status(400).json({
          success: false,
          message: `Insufficient balance. Available: $${wallet.availableBalance.toFixed(2)}`
        });
      }
    }
    
    // ✅ Create wallet transaction
    const transaction = wallet.addTransaction({
      type: 'game_deposit',
      amount,
      description: description || `Transfer to ${gameAccount.gameType}${isBonus ? ' (Bonus)' : ''}`,
      status: 'completed',
      isBonus: isBonus, // ✅ CRITICAL
      gameDetails: {
        gameType: gameAccount.gameType,
        gameLogin: gameAccount.gameLogin,
        gameAccountId: gameAccount._id
      },
      referenceId: gameAccount._id,
      metadata: {
        sourceBalance: isBonus ? 'bonus' : 'regular',
        timestamp: new Date()
      }
    });
    
    await wallet.save();
    
    console.log(`✅ Wallet transaction created: ${transaction._id}`);
    console.log(`📊 WALLET STATE AFTER:`);
    console.log(`   Regular Balance: $${wallet.balance}`);
    console.log(`   Bonus Balance: $${wallet.bonusBalance}`);
    console.log(`   Available Balance: $${wallet.availableBalance}`);
    console.log(`   Available Bonus Balance: $${wallet.availableBonusBalance}`);
    
    // ✅ IMPROVED: Find and link to game transaction
    // Look for the most recent recharge that matches amount and doesn't have wallet link yet
    const recentRecharges = gameAccount.transactions
      .filter(t => 
        t.type === 'recharge' && 
        t.amount === amount &&
        !t.walletTransactionId && // Not yet linked
        (new Date().getTime() - new Date(t.createdAt).getTime() < 60000) // Created within last 60 seconds
      )
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    if (recentRecharges.length > 0) {
      const lastRecharge = recentRecharges[0];
      
      console.log(`🔗 Found matching game recharge transaction:`);
      console.log(`   Transaction ID: ${lastRecharge._id}`);
      console.log(`   Created: ${lastRecharge.createdAt}`);
      console.log(`   Current isBonus: ${lastRecharge.isBonus}`);
      console.log(`   Updating to isBonus: ${isBonus}`);
      
      // ✅ Update the game transaction
      lastRecharge.isBonus = isBonus;
      lastRecharge.walletTransactionId = transaction._id;
      
      // ✅ Ensure metadata exists
      if (!lastRecharge.metadata) {
        lastRecharge.metadata = {};
      }
      lastRecharge.metadata.walletSource = isBonus ? 'bonus' : 'regular';
      lastRecharge.metadata.linkedAt = new Date();
      
      await gameAccount.save();
      
      console.log(`✅ Game transaction updated successfully`);
      console.log(`   Final isBonus value: ${lastRecharge.isBonus}`);
      
      // ✅ VERIFY the update by re-fetching
      const verifyAccount = await GameAccount.findById(gameAccountId);
      const verifyTransaction = verifyAccount.transactions.id(lastRecharge._id);
      console.log(`🔍 VERIFICATION:`);
      console.log(`   Transaction ${lastRecharge._id} isBonus: ${verifyTransaction.isBonus}`);
      
    } else {
      console.warn(`⚠️  Could not find recent matching recharge transaction`);
      console.warn(`   Looking for: amount=$${amount}, within last 60 seconds`);
      console.warn(`   Available recharges:`);
      gameAccount.transactions
        .filter(t => t.type === 'recharge')
        .slice(0, 5)
        .forEach(t => {
          console.warn(`     - ID: ${t._id}, Amount: $${t.amount}, Created: ${t.createdAt}, Linked: ${!!t.walletTransactionId}`);
        });
    }
    
    res.json({
      success: true,
      message: `Transfer completed${isBonus ? ' (using bonus balance)' : ''}`,
      data: {
        transactionId: transaction._id,
        amount,
        isBonus,
        balanceType: isBonus ? 'bonus' : 'regular',
        newWalletBalance: wallet.balance,
        newBonusBalance: wallet.bonusBalance,
        availableBalance: wallet.availableBalance,
        availableBonusBalance: wallet.availableBonusBalance
      }
    });
    
  } catch (error) {
    console.error('❌ Error transferring to game:', error);
    res.status(500).json({
      success: false,
      message: 'Error transferring funds'
    });
  }
};

// ✅ UPDATED: Transfer from game (with 10% bonus rule)
const transferFromGame = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { gameAccountId, amount, description } = req.body;
    
    // ✅ UPDATED: Validate integer
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be a positive whole number'
      });
    }
    
    if (!gameAccountId) {
      return res.status(400).json({
        success: false,
        message: 'Game account ID is required'
      });
    }
    
    const gameAccount = await GameAccount.findOne({ _id: gameAccountId, userId });
    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }
    
    const wallet = await Wallet.findOrCreateWallet(userId);
    
    const lastDeposit = gameAccount.getLastDeposit();
    const wasFundedByBonus = lastDeposit ? lastDeposit.isBonus : false;
    
    // ✅ UPDATED: Integer calculation
    let actualWalletAmount = amount;
    let restrictedAmount = 0;
    
    if (wasFundedByBonus) {
      actualWalletAmount = Math.floor(amount * 0.10); // ✅ Round down
      restrictedAmount = amount - actualWalletAmount;
    }
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💰 TRANSFER FROM GAME`);
    console.log(`Requested Transfer: $${amount}`);
    console.log(`Last Deposit Was Bonus-Funded: ${wasFundedByBonus ? 'YES ✓' : 'NO ✗'}`);
    if (wasFundedByBonus) {
      console.log(`⚠️  10% RESTRICTION APPLIED`);
      console.log(`   → Wallet Receives: $${actualWalletAmount} (10%)`);
      console.log(`   → Restricted: $${restrictedAmount} (90%)`);
    } else {
      console.log(`✅ NO RESTRICTION - Wallet Receives: $${actualWalletAmount} (100%)`);
    }
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    const transaction = wallet.addTransaction({
      type: 'game_withdrawal',
      amount: actualWalletAmount,
      description: description || `Transfer from ${gameAccount.gameType}${wasFundedByBonus ? ' (10% Bonus Restriction)' : ''}`,
      status: 'completed',
      isBonus: false,
      bonusRestrictionAmount: restrictedAmount,
      relatedDepositId: lastDeposit?.transactionId,
      gameDetails: {
        gameType: gameAccount.gameType,
        gameLogin: gameAccount.gameLogin,
        gameAccountId: gameAccount._id
      },
      referenceId: gameAccount._id,
      completedAt: new Date(),
      metadata: {
        requestedAmount: amount,
        actualWalletAmount: actualWalletAmount,
        restrictedAmount: restrictedAmount,
        wasFundedByBonus: wasFundedByBonus,
        transferPercentage: wasFundedByBonus ? 10 : 100
      }
    });
    
    await wallet.save();
    
    console.log(`✅ Wallet updated: +$${actualWalletAmount} (restricted: $${restrictedAmount})`);
    
    res.json({
      success: true,
      message: wasFundedByBonus 
        ? `Transfer completed (10% restriction: $${actualWalletAmount} added to wallet, $${restrictedAmount} restricted)`
        : `Transfer completed ($${actualWalletAmount} added to wallet)`,
      data: {
        transactionId: transaction._id,
        requestedAmount: amount,
        actualWalletAmount: actualWalletAmount,
        restrictedAmount: restrictedAmount,
        wasFundedByBonus: wasFundedByBonus,
        transferPercentage: wasFundedByBonus ? 10 : 100,
        newWalletBalance: wallet.balance,
        availableBalance: wallet.availableBalance
      }
    });
    
  } catch (error) {
    console.error('❌ Error transferring from game:', error);
    res.status(500).json({
      success: false,
      message: 'Error transferring funds'
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
        
        transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
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

// Get single transaction
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

// Get recent winners
const getRecentWinners = async (req, res) => {
    try {
        const User = require('../models/User');
        const Game = require('../models/Game');
        
        const wallets = await Wallet.find({
            'transactions.type': 'game_withdrawal',
            'transactions.status': 'completed'
        }).populate('userId', 'username email');
        
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
        
        const topWinners = allWinners
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 10);
        
        const winnersWithImages = await Promise.all(
            topWinners.map(async (winner) => {
                let gameName = winner.gameType;
                let gameImage = null;
                
                try {
                    if (winner.gameAccountId) {
                        const gameAccount = await GameAccount.findById(winner.gameAccountId)
                            .populate({
                                path: 'gameId',
                                select: 'name displayName title image shortcode'
                            });
                        
                        if (gameAccount && gameAccount.gameId) {
                            const game = gameAccount.gameId;
                            gameName = game.displayName || game.name || game.title || winner.gameType;
                            gameImage = game.image || null;
                        }
                    }
                    
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
                    game: gameName,
                    gameImage: gameImage,
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

const maskUsername = (username) => {
    if (!username || username.length < 3) return 'User ***';
    
    const firstPart = username.substring(0, Math.min(username.length - 2, Math.ceil(username.length / 2)));
    const stars = '*'.repeat(Math.min(5, username.length - firstPart.length));
    
    return `${firstPart} ${stars}`;
};

module.exports = {
    getWallet,
    getWalletBalance,
    addBonus, // ✅ NEW
    depositFunds,
    withdrawFunds,
    transferToGame,
    transferFromGame,
    getTransactionHistory,
    getTransaction,
    updateWalletSettings,
    getRecentWinners
};