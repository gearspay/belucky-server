// controllers/gameController.js
const GameAccount = require('../models/GameAccount');
const Game = require('../models/Game');

// Get all available games
const getAllGames = async (req, res) => {
  try {
    const games = await Game.find({ 
      status: { $in: ['active', 'maintenance'] }
    }).sort({ order: 1, name: 1 });

    const gamesList = games.map(game => ({
      _id: game._id,
      title: game.name,
      name: game.name,
      slug: game.slug,
      shortcode: game.shortcode,
      gameType: game.gameType,
      category: game.category,
      status: game.status,
      gameUrl: game.gameUrl,
      downloadUrl: game.downloadUrl,
      image: game.image,
      displayName: game.name,
      rating: game.rating,
      isNew: game.isNew,
      isFeatured: game.isFeatured,
      totalPlayers: game.stats?.totalAccounts || 0
    }));

    res.json({
      success: true,
      message: 'Games retrieved successfully',
      data: gamesList
    });
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching games'
    });
  }
};

// Get single game by slug
const getGameBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    
    const game = await Game.findOne({
      slug,
      status: 'active'
    });
    
    if (!game) {
      return res.status(404).json({
        success: false,
        message: 'Game not found'
      });
    }

    const gameData = {
      _id: game._id,
      title: game.name,
      name: game.name,
      slug: game.slug,
      shortcode: game.shortcode,
      gameType: game.gameType,
      category: game.category,
      status: game.status,
      gameUrl: game.gameUrl,
      downloadUrl: game.downloadUrl,
      image: game.image,
      displayName: game.name,
      rating: game.rating,
      isNew: game.isNew,
      isFeatured: game.isFeatured,
      totalPlayers: game.stats?.totalAccounts || 0
    };

    res.json({
      success: true,
      message: 'Game retrieved successfully',
      data: gameData
    });
  } catch (error) {
    console.error('Error fetching game:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching game'
    });
  }
};

// Get user's game accounts
const getUserGameAccounts = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { gameType } = req.query;
        
    const gameAccounts = await GameAccount.findByUser(userId, gameType);

    const accountsWithBalance = gameAccounts.map(account => ({
      id: account._id,
      gameType: account.gameType,
      gameLogin: account.gameLogin,
      gamePassword: account.gamePassword,
      balance: account.balance,
      status: account.status,
      downloadCode: account.downloadCode,
      lastBalanceCheck: account.lastBalanceCheck,
      createdAt: account.createdAt,
      transactionCount: account.transactions.length
    }));

    res.json({
      success: true,
      message: 'Game accounts retrieved successfully',
      data: { accounts: accountsWithBalance }
    });
  } catch (error) {
    console.error('Error fetching game accounts:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching game accounts'
    });
  }
};

// Helper function to load game controller
const loadGameController = async (slug) => {
  const game = await Game.findOne({ slug, status: 'active' });
  
  if (!game) {
    throw new Error(`Game '${slug}' not found`);
  }

  if (!game.isImplemented()) {
    throw new Error(`${slug} is not yet implemented`);
  }

  const controllerPath = `../gmcontrollers/${game.shortcode.toLowerCase()}Controller.js`;
  const GameController = require(controllerPath);
  
  return { game, controller: GameController };
};

// Create game account - Uses specific game controller
const createGameAccount = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { slug } = req.params;

    const { game, controller } = await loadGameController(slug);

    // Check for existing account
    const existingAccount = await GameAccount.findOne({
      userId,
      gameId: game._id,
      status: 'active'
    });

    if (existingAccount) {
      return res.status(409).json({
        success: false,
        message: 'You already have an active account for this game'
      });
    }

    // Call the controller's createGameAccount method
    const result = await controller.createGameAccount(userId, game);
    
    if (result.success) {
      res.json({
        success: true,
        message: 'Game account created successfully',
        data: {
          accountId: result.data._id,
          gameLogin: result.data.gameLogin,
          gamePassword: result.data.gamePassword,
          gameType: result.data.gameType,
          status: result.data.status
        }
      });
    } else {
      throw new Error(result.message || 'Failed to create game account');
    }
   
  } catch (error) {
    console.error('Error creating game account:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating game account'
    });
  }
};

// Get account balance - Uses specific game controller
const getAccountBalance = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { slug, accountId } = req.params;

    const gameAccount = await GameAccount.findOne({ 
      _id: accountId, 
      userId 
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    const { game, controller } = await loadGameController(slug);

    // Call the controller's getGameBalance method
    const result = await controller.getGameBalance(userId, gameAccount.gameLogin);

    // Check if the controller returned a successful result
    if (result && result.success) {
      res.json({
        success: true,
        message: 'Balance retrieved successfully',
        data: result.data
      });
    } else {
      // Handle case where controller returns error or no data
      return res.status(500).json({
        success: false,
        message: result?.message || 'Failed to retrieve balance from game server'
      });
    }

  } catch (error) {
    console.error('Error getting balance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error retrieving balance'
    });
  }
};

// Recharge account - Uses specific game controller
const rechargeAccount = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { slug, accountId } = req.params;
    const { amount, remark } = req.body;

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required (must be greater than 0)'
      });
    }

    if (amount > 1000) {
      return res.status(400).json({
        success: false,
        message: 'Maximum recharge amount is $1000'
      });
    }

    const gameAccount = await GameAccount.findOne({ 
      _id: accountId,
      userId
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    const { game, controller } = await loadGameController(slug);

    // ✅ CALCULATE BONUS AMOUNT (10%)
    const bonusAmount = Math.round(amount * 0.1);
    const totalAmountWithBonus = amount + bonusAmount;

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`RECHARGE REQUEST:`);
    console.log(`User: ${userId}`);
    console.log(`Account: ${gameAccount.gameLogin}`);
    console.log(`Base Amount: $${amount}`);
    console.log(`Bonus (10%): $${bonusAmount}`);
    console.log(`Total to Game: $${totalAmountWithBonus}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Call the controller's rechargeAccount method with TOTAL amount (including bonus)
    const result = await controller.rechargeAccount(
      userId, 
      gameAccount.gameLogin, 
      totalAmountWithBonus, // ✅ Pass amount WITH bonus to game
      amount, // ✅ Pass base amount for transaction record
      remark || 'API Recharge'
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Recharge completed successfully',
        data: {
          ...result.data,
          baseAmount: amount,
          bonusAmount: bonusAmount,
          totalAmount: totalAmountWithBonus
        }
      });
    } else {
      throw new Error(result.message || 'Recharge failed');
    }

  } catch (error) {
    console.error('Error processing recharge:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Error processing recharge'
    });
  }
};

const redeemFromAccount = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { slug, accountId } = req.params;
    const { amount, remark } = req.body;

    // Basic validation
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid amount is required (must be greater than 0)'
      });
    }

    if (amount > 500) {
      return res.status(400).json({
        success: false,
        message: 'Maximum redeem amount is $500'
      });
    }

    const gameAccount = await GameAccount.findOne({ 
      _id: accountId,
      userId
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    // CRITICAL VALIDATION: Get last deposit and validate cashout limits
    const lastDeposit = gameAccount.getLastDeposit();
    
    if (!lastDeposit) {
      return res.status(400).json({
        success: false,
        message: 'No deposit history found. Please deposit first to enable cashout.'
      });
    }

    // Find applicable cashout rule
    const CashoutRule = require('../models/CashoutRule');
    const rule = await CashoutRule.findApplicableRule(lastDeposit);

    if (!rule) {
      return res.status(400).json({
        success: false,
        message: `No cashout rule found for deposit amount $${lastDeposit}. Please contact support.`
      });
    }

    // VALIDATE: Check if cashout amount is within limits
    if (amount < rule.cashoutLimits.min) {
      return res.status(400).json({
        success: false,
        message: `Minimum cashout amount is $${rule.cashoutLimits.min} for your deposit of $${lastDeposit}`
      });
    }

    if (amount > rule.cashoutLimits.max) {
      return res.status(400).json({
        success: false,
        message: `Maximum cashout amount is $${rule.cashoutLimits.max} for your deposit of $${lastDeposit}`
      });
    }

    // VALIDATE: Check if amount exceeds current balance
    if (amount > gameAccount.balance) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: $${gameAccount.balance.toFixed(2)}`
      });
    }

    // Rate limiting: Check for multiple cashout attempts
    const recentRedeems = gameAccount.transactions.filter(
      t => t.type === 'redeem' && 
      t.createdAt > new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
    );

    if (recentRedeems.length >= 3) {
      return res.status(429).json({
        success: false,
        message: 'Too many cashout attempts. Please wait 5 minutes before trying again.'
      });
    }

    const { game, controller } = await loadGameController(slug);

    // Get FULL game balance to redeem (void all balance)
    const totalGameBalance = gameAccount.balance;
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`CASHOUT REQUEST:`);
    console.log(`User: ${userId}`);
    console.log(`Account: ${gameAccount.gameLogin}`);
    console.log(`Requested Cashout: $${amount}`);
    console.log(`Total Game Balance: $${totalGameBalance}`);
    console.log(`Will Void: $${(totalGameBalance - amount).toFixed(2)}`);
    console.log(`Last Deposit: $${lastDeposit}`);
    console.log(`Cashout Limits: $${rule.cashoutLimits.min} - $${rule.cashoutLimits.max}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // ✅ CREATE TRANSACTION HERE with cashout amount
    const transaction = {
      type: 'redeem',
      amount: amount, // ✅ User's cashout amount (what they receive)
      remark: remark || `Cashout $${amount}`,
      status: 'pending',
      metadata: {
        totalGameBalance: totalGameBalance,
        cashoutAmount: amount,
        willVoid: totalGameBalance - amount
      }
    };

    await gameAccount.addTransaction(transaction);
    const transactionId = gameAccount.transactions[gameAccount.transactions.length - 1]._id;
    console.log('✅ Transaction created:', transactionId, 'with amount:', amount);

    // Call the controller's redeemFromAccount method
    const result = await controller.redeemFromAccount(
      userId, 
      gameAccount.gameLogin, 
      totalGameBalance, // Full balance to redeem from game
      amount, // Cashout amount (what user receives)
      remark || `Cashout $${amount}`
    );

    if (result.success) {
      // ✅ MARK TRANSACTION AS COMPLETED
      const updatedGameAccount = await GameAccount.findById(accountId);
      const recentTransaction = updatedGameAccount.transactions.id(transactionId);
      
      if (recentTransaction) {
        recentTransaction.status = 'completed';
        recentTransaction.completedAt = new Date();
        recentTransaction.metadata = {
          totalRedeemedFromGame: totalGameBalance,
          cashoutAmount: amount,
          voidedAmount: totalGameBalance - amount,
          lastDeposit: lastDeposit,
          appliedRule: {
            depositRange: rule.depositRange,
            cashoutLimits: rule.cashoutLimits
          },
          note: 'Full game balance voided, cashout amount transferred to wallet'
        };
        await updatedGameAccount.save();
        
        console.log(`✓ Redeemed full balance of $${totalGameBalance} from game`);
        console.log(`✓ Cashout amount: $${amount} to wallet`);
        console.log(`✓ Voided amount: $${(totalGameBalance - amount).toFixed(2)}`);
        console.log(`✓ Transaction ${recentTransaction._id} amount: $${recentTransaction.amount}`);
        console.log(`✓ Transaction marked as completed`);
      }

      res.json({
        success: true,
        message: 'Cashout completed successfully',
        data: {
          ...result.data,
          transactionId: recentTransaction?._id,
          status: 'completed',
          completedAt: recentTransaction?.completedAt,
          totalRedeemedFromGame: totalGameBalance,
          cashoutAmount: amount,
          voidedAmount: totalGameBalance - amount,
          transactionAmount: amount
        }
      });
    } else {
      // ✅ MARK TRANSACTION AS FAILED
      const updatedGameAccount = await GameAccount.findById(accountId);
      const recentTransaction = updatedGameAccount.transactions.id(transactionId);
      
      if (recentTransaction) {
        recentTransaction.status = 'failed';
        recentTransaction.metadata = {
          ...recentTransaction.metadata,
          error: result.message || 'Redeem failed'
        };
        await updatedGameAccount.save();
      }
      
      throw new Error(result.message || 'Redeem failed');
    }

  } catch (error) {
    console.error('Error processing redeem:', error);
    res.status(400).json({
      success: false,
      message: error.message || 'Error processing redeem'
    });
  }
};


const getCashoutInfo = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { accountId } = req.params;

    const gameAccount = await GameAccount.findOne({ 
      _id: accountId, 
      userId 
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    // Get last deposit for THIS game account
    const lastDeposit = gameAccount.getLastDeposit();
    
    if (!lastDeposit) {
      return res.status(400).json({
        success: false,
        message: 'No deposit history found. Please deposit first.'
      });
    }

    // Find applicable cashout rule
    const CashoutRule = require('../models/CashoutRule');
    const rule = await CashoutRule.findApplicableRule(lastDeposit);

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: `No cashout rule found for deposit amount $${lastDeposit}`
      });
    }

    res.json({
      success: true,
      data: {
        lastDeposit,
        cashoutLimits: rule.cashoutLimits,
        currentBalance: gameAccount.balance
      }
    });

  } catch (error) {
    console.error('Error getting cashout info:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error retrieving cashout information'
    });
  }
};

// Get download code - Uses specific game controller
// Get download code - Uses specific game controller
const getDownloadCode = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { slug, accountId } = req.params;

    const gameAccount = await GameAccount.findOne({ 
      _id: accountId, 
      userId 
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    const { game, controller } = await loadGameController(slug);

    // Call the controller's getDownloadCodeForUser method
    const result = await controller.getDownloadCodeForUser(userId, gameAccount.gameLogin);

    if (result && result.success) {
      res.json({
        success: true,
        message: 'Download code retrieved successfully',
        data: result.data
      });
    } else {
      throw new Error(result?.message || 'Failed to get download code');
    }

  } catch (error) {
    console.error('Error getting download code:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error retrieving download code'
    });
  }
};

// Reset account password - Uses specific game controller
const resetAccountPassword = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { slug, accountId } = req.params;
    // const { newPassword, confirmPassword } = req.body;

    const generateRandomString = () => {
                    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
                    let result = '';
                    for (let i = 0; i < 4; i++) {
                        result += chars.charAt(Math.floor(Math.random() * chars.length));
                    }
                    return result;
                };
                
    const newPassword = `bc${generateRandomString()}_${generateRandomString()}`;

    // Validation
    if (!newPassword) {
      return res.status(400).json({
        success: false,
        message: 'New password is required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const gameAccount = await GameAccount.findOne({ 
      _id: accountId, 
      userId 
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    const { game, controller } = await loadGameController(slug);

    // Call the controller's resetAccountPassword method (NOT resetPassword)
    const result = await controller.resetAccountPassword(
      userId, 
      gameAccount.gameLogin, 
      newPassword
    );
    
    if (result && result.success) {
      // Update password in database
      gameAccount.gamePassword = newPassword;
      await gameAccount.save();
      
      res.json({
        success: true,
        message: 'Password reset successfully',
        data: {
          gameLogin: gameAccount.gameLogin,
          newPassword: newPassword
        }
      });
    } else {
      throw new Error(result?.message || 'Password reset failed');
    }

  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error resetting password'
    });
  }
};

// Get account transactions
const getAccountTransactions = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { accountId } = req.params;
    const { page = 1, limit = 20 } = req.query;

    const gameAccount = await GameAccount.findOne({ 
      _id: accountId, 
      userId 
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);

    const transactions = gameAccount.transactions
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(startIndex, endIndex);

    const totalTransactions = gameAccount.transactions.length;
    const totalPages = Math.ceil(totalTransactions / limit);

    res.json({
      success: true,
      message: 'Transaction history retrieved successfully',
      data: {
        transactions,
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
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching transaction history'
    });
  }
};

// Deactivate account
const deactivateAccount = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { accountId } = req.params;

    const gameAccount = await GameAccount.findOne({ 
      _id: accountId, 
      userId 
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    gameAccount.status = 'inactive';
    await gameAccount.save();

    res.json({
      success: true,
      message: 'Game account deactivated successfully'
    });

  } catch (error) {
    console.error('Error deactivating account:', error);
    res.status(500).json({
      success: false,
      message: 'Error deactivating game account'
    });
  }
};

// Start game session
const startGameSession = async (req, res) => {
  try {
    const { slug } = req.params;
    const userId = req.user.userId;

    const { game, controller } = await loadGameController(slug);
    
    const gameAccount = await GameAccount.findOne({ 
      userId, 
      gameId: game._id, 
      status: 'active' 
    });

    if (!gameAccount) {
      return res.status(400).json({
        success: false,
        message: 'No active game account found. Please create an account first.',
        requiresAccount: true
      });
    }

    const sessionData = {
      gameSlug: slug,
      gameType: game.gameType,
      userId,
      gameLogin: gameAccount.gameLogin,
      sessionId: `session_${Date.now()}_${userId}`,
      balance: gameAccount.balance,
      downloadCode: gameAccount.downloadCode,
      accountId: gameAccount._id
    };

    res.json({
      success: true,
      message: 'Game session started',
      data: sessionData
    });

  } catch (error) {
    console.error('Error starting game:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error starting game'
    });
  }
};

// Get account summary - Uses specific game controller
const getAccountSummary = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { slug, accountId } = req.params;

    const gameAccount = await GameAccount.findOne({ 
      _id: accountId, 
      userId 
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    const { game, controller } = await loadGameController(slug);

    // Get fresh balance from controller
    const balanceResult = await controller.getGameBalance(userId, gameAccount.gameLogin);

    // Get recent transactions (last 5)
    const transactions = gameAccount.transactions
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);

    // Calculate transaction summaries
    const totalRecharges = gameAccount.transactions
      .filter(t => t.type === 'recharge' && t.status === 'completed')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const totalRedeems = gameAccount.transactions
      .filter(t => t.type === 'redeem' && t.status === 'completed')
      .reduce((sum, t) => sum + t.amount, 0);

    res.json({
      success: true,
      message: 'Account summary retrieved successfully',
      data: {
        balance: balanceResult.data,
        recentTransactions: transactions,
        summary: {
          totalRecharges,
          totalRedeems,
          netAmount: totalRecharges - totalRedeems,
          transactionCount: gameAccount.transactions.length
        }
      }
    });

  } catch (error) {
    console.error('Error getting account summary:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error retrieving account summary'
    });
  }
};

// Refresh account balance - Uses specific game controller
const refreshAccountBalance = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { slug, accountId } = req.params;

    const gameAccount = await GameAccount.findOne({ 
      _id: accountId, 
      userId 
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    const { game, controller } = await loadGameController(slug);

    // Get fresh balance from controller - pass userId and gameLogin
    const result = await controller.getGameBalance(userId, gameAccount.gameLogin);

    res.json({
      success: true,
      message: 'Balance refreshed successfully',
      data: result.data
    });

  } catch (error) {
    console.error('Error refreshing balance:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error refreshing balance'
    });
  }
};

module.exports = {
  getAllGames,
  getGameBySlug,
  getUserGameAccounts,
  createGameAccount,
  getAccountBalance,
  rechargeAccount,
  redeemFromAccount,
  getCashoutInfo,
  getDownloadCode,
  getAccountTransactions,
  resetAccountPassword,
  deactivateAccount,
  startGameSession,
  getAccountSummary,
  refreshAccountBalance
};