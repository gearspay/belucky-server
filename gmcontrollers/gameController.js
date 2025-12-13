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

const rechargeAccount = async (req, res) => {
  let transactionId = null;
  let walletTransactionId = null;
  let walletDeducted = false;
  let gameRecharged = false;
  let clientDisconnected = false;

  // ✅ Detect if client disconnects (page refresh/close)
  req.on('close', () => {
    if (!res.headersSent) {
      console.log('⚠️ CLIENT DISCONNECTED - Request aborted');
      clientDisconnected = true;
    }
  });

  try {
    const userId = req.user.userId;
    const { slug, accountId } = req.params;
    const { amount, remark, isBonus } = req.body;

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📥 RECHARGE REQUEST RECEIVED`);
    console.log(`User: ${userId}`);
    console.log(`Account: ${accountId}`);
    console.log(`Amount: $${amount}`);
    console.log(`Is Bonus: ${isBonus}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // Validate integer
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be a positive whole number'
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
      userId,
      status: 'active'
    });

    if (!gameAccount) {
      return res.status(404).json({
        success: false,
        message: 'Game account not found'
      });
    }

    // ✅ CHECK FOR EXISTING PENDING TRANSACTIONS
    const existingPending = gameAccount.transactions.find(
      t => t.type === 'recharge' && t.status === 'pending'
    );

    if (existingPending) {
      console.log('⚠️ Found existing pending transaction:', existingPending._id);
      return res.status(409).json({
        success: false,
        message: 'A recharge is already in progress. Please wait or refresh.',
        pendingTransactionId: existingPending._id
      });
    }

    const { game, controller } = await loadGameController(slug);
    const isBonusDeposit = isBonus === true;

    // Calculate amounts
    const bonusAmount = Math.floor(amount * 0.1);
    const totalAmountToGame = amount + bonusAmount;

    console.log(`💰 RECHARGE CALCULATION`);
    console.log(`Wallet Deduction: $${amount} from ${isBonusDeposit ? 'BONUS' : 'REGULAR'}`);
    console.log(`Game Bonus (10%): +$${bonusAmount}`);
    console.log(`Total to Game: $${totalAmountToGame}`);

    // ✅ STEP 1: GET WALLET AND CHECK BALANCE
    console.log('\n📤 Step 1: Checking wallet balance...');
    
    const Wallet = require('../models/Wallet');
    const userWallet = await Wallet.findOne({ userId });

    if (!userWallet) {
      throw new Error('Wallet not found');
    }

    // Check sufficient balance
    const sufficientBalance = isBonusDeposit 
      ? userWallet.bonusBalance >= amount
      : userWallet.balance >= amount;

    if (!sufficientBalance) {
      return res.status(400).json({
        success: false,
        message: `Insufficient ${isBonusDeposit ? 'bonus' : 'regular'} balance. Available: $${isBonusDeposit ? userWallet.bonusBalance : userWallet.balance}`
      });
    }

    // ✅ STEP 2: CREATE WALLET TRANSACTION (PENDING) - This will deduct balance
    console.log('\n📝 Step 2: Creating wallet transaction...');
    
    const walletTransaction = userWallet.addTransaction({
      type: 'game_deposit',
      amount: amount,
      description: `Transfer to ${game.name}${isBonusDeposit ? ' (Bonus)' : ''}`,
      status: 'pending',
      isBonus: isBonusDeposit,
      gameDetails: {
        gameType: game.gameType,
        gameAccountId: accountId,
        gameLogin: gameAccount.gameLogin
      },
      metadata: {
        gameBonus: bonusAmount,
        totalToGame: totalAmountToGame,
        walletSource: isBonusDeposit ? 'bonus' : 'regular'
      }
    });

    await userWallet.save();
    walletTransactionId = walletTransaction._id;
    walletDeducted = true;

    console.log('✅ Wallet transaction created:', walletTransactionId);
    console.log(`   Wallet balance ${isBonusDeposit ? 'bonus' : 'regular'}: $${isBonusDeposit ? userWallet.bonusBalance : userWallet.balance}`);

    // ✅ CHECK IF CLIENT DISCONNECTED AFTER WALLET DEDUCTION
    if (clientDisconnected) {
      console.log('🚫 Client disconnected after wallet deduction - rolling back');
      throw new Error('Request cancelled by client');
    }

    // ✅ STEP 3: CREATE GAME TRANSACTION (LINKED TO WALLET)
    console.log('\n📝 Step 3: Creating game transaction...');
    
    const gameTransaction = {
      type: 'recharge',
      amount: amount,
      remark: remark || `Deposit $${amount}${isBonusDeposit ? ' (Bonus)' : ''}`,
      status: 'pending',
      isBonus: isBonusDeposit,
      walletTransactionId: walletTransactionId,
      metadata: {
        walletSource: isBonusDeposit ? 'bonus' : 'regular',
        walletDeduction: amount,
        gameBonus: bonusAmount,
        totalToGame: totalAmountToGame,
        requestedAt: new Date()
      }
    };

    await gameAccount.addTransaction(gameTransaction);
    transactionId = gameAccount.transactions[gameAccount.transactions.length - 1]._id;

    console.log('✅ Game transaction created:', transactionId);

    // ✅ CHECK CLIENT AGAIN BEFORE PUPPETEER
    if (clientDisconnected) {
      console.log('🚫 Client disconnected before Puppeteer - rolling back');
      throw new Error('Request cancelled by client');
    }

    // ✅ STEP 4: CALL GAME CONTROLLER WITH TIMEOUT
    console.log('\n🎮 Step 4: Calling game controller...');
    
    const puppeteerPromise = controller.rechargeAccount(
      userId, 
      gameAccount.gameLogin, 
      totalAmountToGame,
      amount,
      remark || `Deposit $${amount}`
    );

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Game recharge timeout after 30 seconds')), 30000);
    });

    const result = await Promise.race([puppeteerPromise, timeoutPromise]);

    // ✅ CHECK IF CLIENT DISCONNECTED DURING PUPPETEER
    if (clientDisconnected) {
      console.log('⚠️ Client disconnected during Puppeteer operation');
      
      if (result.success) {
        // Game was charged but client disconnected
        gameRecharged = true;
        
        // Mark game transaction as completed
        const updatedGameAccount = await GameAccount.findById(accountId);
        const recentTransaction = updatedGameAccount.transactions.id(transactionId);
        
        if (recentTransaction) {
          recentTransaction.status = 'completed';
          recentTransaction.completedAt = new Date();
          recentTransaction.processedAt = new Date();
          recentTransaction.metadata.completedDespiteDisconnect = true;
          await updatedGameAccount.save();
        }

        // Mark wallet transaction as completed
        const updatedWallet = await Wallet.findOne({ userId });
        updatedWallet.updateTransactionStatus(walletTransactionId, 'completed');
        await updatedWallet.save();

        console.log('✅ Transaction completed despite client disconnect');
        return; // Don't send response - client is gone
      } else {
        throw new Error('Client disconnected and game recharge failed');
      }
    }

    if (result.success) {
      gameRecharged = true;

      // ✅ Mark game transaction as completed
      const updatedGameAccount = await GameAccount.findById(accountId);
      const recentTransaction = updatedGameAccount.transactions.id(transactionId);
      
      if (recentTransaction) {
        recentTransaction.status = 'completed';
        recentTransaction.completedAt = new Date();
        recentTransaction.processedAt = new Date();
        await updatedGameAccount.save();
      }

      // ✅ Mark wallet transaction as completed
      const updatedWallet = await Wallet.findOne({ userId });
      updatedWallet.updateTransactionStatus(walletTransactionId, 'completed');
      await updatedWallet.save();

      console.log('✅ All transactions completed successfully');

      return res.json({
        success: true,
        message: `Recharge completed${isBonusDeposit ? ' (Bonus Balance Used)' : ''}`,
        data: {
          ...result.data,
          transactionId: recentTransaction?._id,
          walletTransactionId: walletTransactionId,
          status: 'completed',
          walletDeduction: amount,
          gameBonus: bonusAmount,
          totalToGame: totalAmountToGame,
          isBonus: isBonusDeposit
        }
      });
    } else {
      throw new Error(result.message || 'Game recharge failed');
    }

  } catch (error) {
    console.error('❌ RECHARGE FAILED:', error.message);

    const failureReason = clientDisconnected ? 'cancelled' : 'failed';
    
    // ✅ ROLLBACK LOGIC
    if (walletDeducted && !gameRecharged) {
      console.log(`🔄 Rolling back wallet transaction (${failureReason})...`);
      
      try {
        const Wallet = require('../models/Wallet');
        const updatedWallet = await Wallet.findOne({ userId: req.user.userId });
        
        if (updatedWallet && walletTransactionId) {
          // ✅ Use the Wallet's built-in method to update status
          // This will automatically refund the balance
          updatedWallet.updateTransactionStatus(walletTransactionId, failureReason);
          await updatedWallet.save();
          
          console.log(`✅ Wallet transaction marked as ${failureReason} and balance refunded`);
        }
      } catch (rollbackError) {
        console.error('❌ CRITICAL: Rollback failed!', rollbackError);
        // TODO: Log to monitoring system, alert admins
      }
    }

    // ✅ Mark game transaction as failed/cancelled
    if (transactionId) {
      try {
        const updatedGameAccount = await GameAccount.findById(req.params.accountId);
        const failedTx = updatedGameAccount.transactions.id(transactionId);
        
        if (failedTx) {
          failedTx.status = failureReason;
          failedTx.metadata.failureReason = error.message;
          failedTx.metadata.failureType = failureReason;
          failedTx[`${failureReason}At`] = new Date();
          await updatedGameAccount.save();
          
          console.log(`✅ Game transaction marked as ${failureReason}`);
        }
      } catch (updateError) {
        console.error('Failed to update game transaction status:', updateError);
      }
    }

    // Only send response if client is still connected
    if (!clientDisconnected && !res.headersSent) {
      return res.status(400).json({
        success: false,
        message: error.message || 'Recharge failed',
        status: failureReason,
        rolledBack: walletDeducted && !gameRecharged
      });
    }
  }
};

const redeemFromAccount = async (req, res) => {
  let transactionId = null;
  let walletTransactionId = null;
  let walletCredited = false;
  let gameRedeemed = false;
  let clientDisconnected = false;

  // ✅ Detect if client disconnects (page refresh/close)
  req.on('close', () => {
    if (!res.headersSent) {
      console.log('⚠️ CLIENT DISCONNECTED - Redeem request aborted');
      clientDisconnected = true;
    }
  });

  try {
    const userId = req.user.userId;
    const { slug, accountId } = req.params;
    const { amount, remark } = req.body;

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💵 REDEEM REQUEST RECEIVED`);
    console.log(`User: ${userId}`);
    console.log(`Account: ${accountId}`);
    console.log(`Requested Amount: $${amount}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // ✅ Validate integer
    if (!amount || amount <= 0 || !Number.isInteger(amount)) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be a positive whole number'
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

    // ✅ CHECK FOR EXISTING PENDING REDEEM TRANSACTIONS
    const existingPending = gameAccount.transactions.find(
      t => t.type === 'redeem' && t.status === 'pending'
    );

    if (existingPending) {
      console.log('⚠️ Found existing pending redeem transaction:', existingPending._id);
      return res.status(409).json({
        success: false,
        message: 'A cashout is already in progress. Please wait or refresh.',
        pendingTransactionId: existingPending._id
      });
    }

    const lastDeposit = gameAccount.getLastDeposit();
    
    if (!lastDeposit) {
      return res.status(400).json({
        success: false,
        message: 'No deposit history found. Please deposit first.'
      });
    }

    const CashoutRule = require('../models/CashoutRule');
    const rule = await CashoutRule.findApplicableRule(lastDeposit.amount);

    if (!rule) {
      return res.status(400).json({
        success: false,
        message: `No cashout rule found for deposit $${lastDeposit.amount}`
      });
    }

    if (amount < rule.cashoutLimits.min) {
      return res.status(400).json({
        success: false,
        message: `Minimum cashout is $${rule.cashoutLimits.min} for your deposit of $${lastDeposit.amount}`
      });
    }

    if (amount > rule.cashoutLimits.max) {
      return res.status(400).json({
        success: false,
        message: `Maximum cashout is $${rule.cashoutLimits.max} for your deposit of $${lastDeposit.amount}`
      });
    }

    // ✅ Get fresh balance from game
    const { game, controller } = await loadGameController(slug);
    
    console.log('\n🔍 Step 1: Checking current game balance...');
    const balanceCheck = await controller.getGameBalance(userId, gameAccount.gameLogin);
    
    if (!balanceCheck.success) {
      throw new Error('Failed to fetch current game balance');
    }

    const currentGameBalance = Math.floor(balanceCheck.data.balance);
    console.log(`Current game balance: $${currentGameBalance}`);
    
    if (amount > currentGameBalance) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: $${currentGameBalance}`
      });
    }

    const totalGameBalance = currentGameBalance;
    const voidedAmount = totalGameBalance - amount;
    
    // ✅ Calculate wallet transfer amount
    const walletTransferAmount = lastDeposit.isBonus 
      ? Math.floor(amount * 0.10)
      : amount;
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`💵 CASHOUT CALCULATION`);
    console.log(`Requested Cashout: $${amount}`);
    console.log(`Total Game Balance: $${totalGameBalance}`);
    console.log(`Will Void: $${voidedAmount}`);
    console.log(`Last Deposit: $${lastDeposit.amount} (Bonus: ${lastDeposit.isBonus ? 'YES' : 'NO'})`);
    console.log(`Wallet Will Receive: $${walletTransferAmount} (${lastDeposit.isBonus ? '10%' : '100%'})`);
    console.log(`Cashout Limits: $${rule.cashoutLimits.min}-$${rule.cashoutLimits.max}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

    // ✅ STEP 2: CREATE GAME TRANSACTION (PENDING)
    console.log('\n📝 Step 2: Creating game transaction...');
    
    const gameTransaction = {
      type: 'redeem',
      amount: amount,
      remark: remark || `Cashout $${amount}`,
      status: 'pending',
      isBonus: lastDeposit.isBonus,
      metadata: {
        totalGameBalance: totalGameBalance,
        requestedCashout: amount,
        voidedAmount: voidedAmount,
        walletTransferAmount: walletTransferAmount,
        transferPercentage: lastDeposit.isBonus ? 10 : 100,
        lastDepositAmount: lastDeposit.amount,
        lastDepositWasBonus: lastDeposit.isBonus
      }
    };

    await gameAccount.addTransaction(gameTransaction);
    transactionId = gameAccount.transactions[gameAccount.transactions.length - 1]._id;
    
    console.log('✅ Game transaction created:', transactionId);

    // ✅ CHECK IF CLIENT DISCONNECTED
    if (clientDisconnected) {
      console.log('🚫 Client disconnected after game transaction creation');
      throw new Error('Request cancelled by client');
    }

    // ✅ STEP 3: CALL GAME CONTROLLER (PUPPETEER) WITH TIMEOUT
    console.log('\n🎮 Step 3: Calling game controller to redeem...');
    
    const puppeteerPromise = controller.redeemFromAccount(
      userId, 
      gameAccount.gameLogin, 
      totalGameBalance,
      amount,
      remark || `Cashout $${amount}`
    );

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Game redeem timeout after 30 seconds')), 30000);
    });

    const result = await Promise.race([puppeteerPromise, timeoutPromise]);

    // ✅ CHECK IF CLIENT DISCONNECTED DURING PUPPETEER
    if (clientDisconnected) {
      console.log('⚠️ Client disconnected during Puppeteer operation');
      
      if (result.success) {
        // Game was redeemed but client disconnected
        gameRedeemed = true;
        
        // Continue with wallet credit even though client is gone
        console.log('🔄 Proceeding to credit wallet despite disconnect...');
      } else {
        throw new Error('Client disconnected and game redeem failed');
      }
    }

    if (result.success) {
      gameRedeemed = true;

      // ✅ STEP 4: CREDIT WALLET (ONLY IF GAME REDEEM SUCCEEDED)
      console.log('\n💰 Step 4: Crediting wallet...');
      
      const Wallet = require('../models/Wallet');
      const userWallet = await Wallet.findOne({ userId });

      if (!userWallet) {
        throw new Error('Wallet not found');
      }

      // Create wallet transaction (game_withdrawal adds to balance)
      const walletTransaction = userWallet.addTransaction({
        type: 'game_withdrawal',
        amount: walletTransferAmount,
        description: `Cashout from ${game.name}${lastDeposit.isBonus ? ' (10% restriction)' : ''}`,
        status: 'completed', // ✅ Immediately completed since game already redeemed
        isBonus: false, // Always goes to regular balance
        gameDetails: {
          gameType: game.gameType,
          gameAccountId: accountId,
          gameLogin: gameAccount.gameLogin
        },
        metadata: {
          gameRedeemedAmount: totalGameBalance,
          requestedCashout: amount,
          voidedAmount: voidedAmount,
          fundedByBonus: lastDeposit.isBonus,
          transferPercentage: lastDeposit.isBonus ? 10 : 100
        }
      });

      await userWallet.save();
      walletTransactionId = walletTransaction._id;
      walletCredited = true;

      console.log('✅ Wallet credited:', walletTransactionId);
      console.log(`   Wallet balance: $${userWallet.balance}`);

      // ✅ STEP 5: MARK GAME TRANSACTION AS COMPLETED
      const updatedGameAccount = await GameAccount.findById(accountId);
      const recentTransaction = updatedGameAccount.transactions.id(transactionId);
      
      if (recentTransaction) {
        recentTransaction.status = 'completed';
        recentTransaction.completedAt = new Date();
        recentTransaction.processedAt = new Date();
        recentTransaction.walletTransactionId = walletTransactionId;
        
        if (clientDisconnected) {
          recentTransaction.metadata.completedDespiteDisconnect = true;
        }
        
        await updatedGameAccount.save();
      }

      console.log('✅ Cashout completed successfully');

      // Only send response if client is still connected
      if (!clientDisconnected && !res.headersSent) {
        return res.json({
          success: true,
          message: `Cashout completed successfully${lastDeposit.isBonus ? ' (10% restriction applied)' : ''}`,
          data: {
            ...result.data,
            transactionId: recentTransaction?._id,
            walletTransactionId: walletTransactionId,
            status: 'completed',
            totalRedeemedFromGame: totalGameBalance,
            requestedCashout: amount,
            voidedAmount: voidedAmount,
            walletTransferAmount: walletTransferAmount,
            wasFundedByBonus: lastDeposit.isBonus,
            transferPercentage: lastDeposit.isBonus ? 10 : 100
          }
        });
      }
    } else {
      throw new Error(result.message || 'Redeem failed');
    }

  } catch (error) {
    console.error('❌ REDEEM FAILED:', error.message);

    const failureReason = clientDisconnected ? 'cancelled' : 'failed';

    // ✅ ROLLBACK LOGIC
    // Note: For redeem, we DON'T refund wallet because:
    // 1. Game redeem happens BEFORE wallet credit
    // 2. If game redeem fails, nothing was taken from wallet yet
    // 3. If game redeem succeeds, wallet should be credited (even if client disconnected)

    if (gameRedeemed && !walletCredited) {
      // ⚠️ CRITICAL SITUATION: Game was redeemed but wallet credit failed
      console.error('🚨 CRITICAL: Game redeemed but wallet credit failed!');
      console.error('   Manual intervention required - user balance voided from game');
      
      // TODO: Log to monitoring system, create manual review ticket
      // For now, mark transaction as needing review
      try {
        const updatedGameAccount = await GameAccount.findById(req.params.accountId);
        const failedTx = updatedGameAccount.transactions.id(transactionId);
        
        if (failedTx) {
          failedTx.status = 'requires_review';
          failedTx.metadata.criticalError = true;
          failedTx.metadata.errorReason = 'Game redeemed but wallet credit failed';
          failedTx.metadata.gameRedeemedSuccessfully = true;
          await updatedGameAccount.save();
        }
      } catch (updateError) {
        console.error('Failed to update transaction for review:', updateError);
      }
    }

    // ✅ Mark game transaction as failed/cancelled (if no wallet credit happened)
    if (transactionId && !walletCredited) {
      try {
        const updatedGameAccount = await GameAccount.findById(req.params.accountId);
        const failedTx = updatedGameAccount.transactions.id(transactionId);
        
        if (failedTx) {
          failedTx.status = failureReason;
          failedTx.metadata.failureReason = error.message;
          failedTx.metadata.failureType = failureReason;
          failedTx[`${failureReason}At`] = new Date();
          await updatedGameAccount.save();
          
          console.log(`✅ Game transaction marked as ${failureReason}`);
        }
      } catch (updateError) {
        console.error('Failed to update game transaction status:', updateError);
      }
    }

    // Only send response if client is still connected
    if (!clientDisconnected && !res.headersSent) {
      return res.status(400).json({
        success: false,
        message: error.message || 'Cashout failed',
        status: failureReason,
        requiresReview: gameRedeemed && !walletCredited
      });
    }
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

    // ✅ Get last deposit
    const lastDeposit = gameAccount.getLastDeposit();
    
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 CASHOUT INFO DEBUG`);
    console.log(`Game Account: ${gameAccount.gameLogin}`);
    console.log(`Account ID: ${accountId}`);
    console.log(`Current Balance: $${gameAccount.balance}`);
    console.log(`\n🔍 LAST DEPOSIT DETAILS:`);
    if (lastDeposit) {
      console.log(`   Amount: $${lastDeposit.amount}`);
      console.log(`   Date: ${lastDeposit.date}`);
      console.log(`   isBonus: ${lastDeposit.isBonus}`);
      console.log(`   Transaction ID: ${lastDeposit.transactionId}`);
      console.log(`   Wallet Transaction ID: ${lastDeposit.walletTransactionId}`);
    } else {
      console.log(`   ❌ NO DEPOSIT FOUND`);
    }
    
    console.log(`\n📜 ALL RECHARGE TRANSACTIONS:`);
    const allRecharges = gameAccount.transactions
      .filter(t => t.type === 'recharge')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    allRecharges.forEach((t, index) => {
      console.log(`   ${index + 1}. ID: ${t._id}`);
      console.log(`      Amount: $${t.amount}`);
      console.log(`      Status: ${t.status}`);
      console.log(`      isBonus: ${t.isBonus}`);
      console.log(`      Created: ${t.createdAt}`);
      console.log(`      Wallet Tx: ${t.walletTransactionId || 'none'}`);
      console.log(`      Metadata:`, t.metadata);
      console.log(`      ---`);
    });
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    if (!lastDeposit) {
      return res.status(400).json({
        success: false,
        message: 'No deposit history found. Please deposit first.'
      });
    }

    // Find applicable cashout rule
    const CashoutRule = require('../models/CashoutRule');
    const rule = await CashoutRule.findApplicableRule(lastDeposit.amount);

    if (!rule) {
      return res.status(404).json({
        success: false,
        message: `No cashout rule found for deposit amount $${lastDeposit.amount}`
      });
    }

    console.log(`✅ Cashout Rule Found:`);
    console.log(`   Min: $${rule.cashoutLimits.min}`);
    console.log(`   Max: $${rule.cashoutLimits.max}`);
    console.log(`   Bonus Restriction Applies: ${lastDeposit.isBonus}`);

    res.json({
      success: true,
      data: {
        lastDeposit: lastDeposit.amount,
        isBonus: lastDeposit.isBonus,
        depositDate: lastDeposit.date,
        cashoutLimits: rule.cashoutLimits,
        currentBalance: gameAccount.balance,
        bonusRestrictionApplies: lastDeposit.isBonus,
        expectedCashoutPercentage: lastDeposit.isBonus ? 10 : 100
      }
    });

  } catch (error) {
    console.error('❌ Error getting cashout info:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving cashout information'
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

    // ✅ ADD THIS DEBUG SECTION:
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 GET ACCOUNT TRANSACTIONS DEBUG');
    console.log(`Account ID: ${accountId}`);
    console.log(`User ID: ${userId}`);
    console.log(`Total Transactions in DB: ${gameAccount.transactions.length}`);
    
    // Check for duplicates by ID
    const txIds = gameAccount.transactions.map(t => t._id.toString());
    const uniqueTxIds = new Set(txIds);
    
    if (txIds.length !== uniqueTxIds.size) {
      console.error('🚨 DUPLICATE TRANSACTION IDs IN DATABASE!');
      console.log('Total:', txIds.length);
      console.log('Unique:', uniqueTxIds.size);
    }
    
    console.log('\n🔍 ALL TRANSACTIONS:');
    gameAccount.transactions
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .forEach((t, i) => {
        console.log(`\n  ${i + 1}. Transaction ID: ${t._id}`);
        console.log(`     Type: ${t.type}`);
        console.log(`     Amount: $${t.amount}`);
        console.log(`     Remark: ${t.remark || 'none'}`);
        console.log(`     Status: ${t.status}`);
        console.log(`     isBonus: ${t.isBonus}`);
        console.log(`     Created: ${t.createdAt}`);
        console.log(`     Wallet TX ID: ${t.walletTransactionId || 'none'}`);
        if (t.metadata && Object.keys(t.metadata).length > 0) {
          console.log(`     Metadata:`, t.metadata);
        }
      });
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

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