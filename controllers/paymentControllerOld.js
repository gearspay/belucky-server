
// controllers/paymentController.js
const axios = require('axios');
const https = require('https');

// Import the depositFunds function from walletController
const walletController = require('./walletController');
const { depositFunds } = walletController;
const Wallet = require('../models/Wallet');
const PaymentMethod = require('../models/PaymentMethod');
const mailTmService = require('../services/mailTmService');

const PAYMENT_GATEWAY_URL = process.env.PAYMENT_GATEWAY_URL;
const SHKEEPER_API_KEY = process.env.SHKEEPER_API_KEY;
const CALLBACK_URL = process.env.CALLBACK_URL;
const SHKEEPER_USERNAME = process.env.SHKEEPER_USERNAME || 'shkeeper';
const SHKEEPER_PASSWORD = process.env.SHKEEPER_PASSWORD || 'shkeeper';

// Get list of available cryptocurrencies
const getCryptoList = async (req, res) => {
    console.log('list')
    try {
        if (!PAYMENT_GATEWAY_URL) {
            return res.status(500).json({
                success: false,
                message: 'Payment gateway not configured'
            });
        }

        const response = await axios.get(`${PAYMENT_GATEWAY_URL}/api/v1/crypto`);
        res.json({
            success: true,
            message: 'Crypto list retrieved successfully',
            data: response.data
        });

    } catch (error) {
        console.error('Error fetching crypto list:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch cryptocurrency list',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Create crypto payment request
const createPaymentRequest = async (req, res) => {
    try {
        const { cryptoType, amount, fiat = 'USD' } = req.body;
        const userId = req.user.userId;

        // Validation
        if (!cryptoType) {
            return res.status(400).json({
                success: false,
                message: 'Cryptocurrency type is required'
            });
        }

        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required (must be greater than 0)'
            });
        }

        if (amount < 5) {
            return res.status(400).json({
                success: false,
                message: 'Minimum deposit amount is $5'
            });
        }

        if (amount > 10000) {
            return res.status(400).json({
                success: false,
                message: 'Maximum deposit amount is $10,000'
            });
        }

        if (!PAYMENT_GATEWAY_URL || !SHKEEPER_API_KEY) {
            return res.status(500).json({
                success: false,
                message: 'Payment gateway not configured'
            });
        }

        // Generate unique external ID
        const externalId = parseInt(`${userId.toString().slice(-6)}${Date.now().toString().slice(-6)}`);

        // Create payment request with gateway
        const paymentResponse = await axios.post(
            `${PAYMENT_GATEWAY_URL}/api/v1/${cryptoType}/payment_request`,
            {
                external_id: externalId,
                fiat: fiat,
                amount: amount.toString(),
                callback_url: CALLBACK_URL
            },
            {
                headers: {
                    'X-Shkeeper-Api-Key': SHKEEPER_API_KEY,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Create ONLY ONE pending transaction with external_id
        const wallet = await Wallet.findOrCreateWallet(userId);
        const transaction = wallet.addTransaction({
            type: 'deposit
            amount: parseFloat(amount),
            description: `${cryptoType} deposit - Pending payment`,
            paymentMethod: 'crypto',
            status: 'pending',
            external_id: externalId.toString(),
            fee: 0
        });
        
        await wallet.save();

        const gatewayData = paymentResponse.data;
        const expirationTime = new Date();
        expirationTime.setHours(expirationTime.getHours() + 1);

        const formattedResponse = {
            id: gatewayData.id || externalId.toString(),
            external_id: externalId,
            wallet: gatewayData.wallet,
            amount: gatewayData.amount,
            fiat_amount: amount.toString(),
            fiat: fiat,
            status: gatewayData.status || 'pending',
            callback_url: CALLBACK_URL,
            created_at: new Date().toISOString(),
            expired_at: expirationTime.toISOString(),
            display_name: gatewayData.display_name,
            exchange_rate: gatewayData.exchange_rate,
            requestedAmount: amount,
            cryptoType: cryptoType,
            qr_code: gatewayData.qr_code || null,
            payment_url: gatewayData.payment_url || null,
            transactionId: transaction._id
        };

        res.json({
            success: true,
            message: 'Payment request created successfully',
            data: formattedResponse
        });

    } catch (error) {
        console.error('Error creating payment request:', error.response?.data || error.message);
        
        if (error.response?.status === 400) {
            return res.status(400).json({
                success: false,
                message: error.response.data?.message || 'Invalid payment request parameters'
            });
        }

        if (error.response?.status === 401) {
            return res.status(500).json({
                success: false,
                message: 'Payment gateway authentication failed'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to create payment request',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Handle payment confirmation webhook with txid-based duplicate detection
const confirmPayment = async (req, res) => {
    try {
        const paymentData = req.body;

        const { 
            external_id, 
            crypto, 
            addr, 
            fiat, 
            balance_fiat, 
            balance_crypto, 
            paid, 
            status, 
            transactions,
            fee_percent,
            overpaid_fiat 
        } = paymentData;

        if (!external_id) {
            return res.status(400).json({
                success: false,
                message: 'External ID is required'
            });
        }

        // Extract transaction hash from webhook
        const lastTransaction = transactions && transactions.length > 0 
            ? transactions[transactions.length - 1] 
            : null;
        
        const transactionHash = lastTransaction ? lastTransaction.txid : null;
        
        if (!transactionHash) {
            return res.status(400).json({
                success: false,
                message: 'Transaction hash is required'
            });
        }

        console.log(`Processing external_id: ${external_id}, txid: ${transactionHash}`);

        if (status === 'PAID' && paid === true) {
            const depositAmount = parseFloat(balance_fiat);
            const cryptoAmount = lastTransaction ? lastTransaction.amount_crypto : balance_crypto;
            const feeAmount = lastTransaction ? parseFloat(lastTransaction.fee_fiat) : 0;
            
            try {
                // First, check if this txid already exists in ANY completed transaction
                const existingWallet = await Wallet.findOne({
                    'transactions.txid': transactionHash,
                    'transactions.status': 'completed'
                });

                if (existingWallet) {
                    console.log(`Duplicate webhook ignored - Transaction with txid ${transactionHash} already completed for user ${existingWallet.userId}`);
                    return res.status(200).json({
                        success: true,
                        message: 'Transaction already completed with this txid',
                        duplicate: true,
                        txid: transactionHash,
                        existing_transaction: true
                    });
                }

                // Find wallet with pending crypto transaction matching the external_id
                const walletWithPendingTransaction = await Wallet.findOne({
                    'transactions.external_id': external_id.toString(),
                    'transactions.paymentMethod': 'crypto',
                    'transactions.status': 'pending'
                });

                if (walletWithPendingTransaction) {
                    // Find the most recent pending crypto transaction with matching external_id
                    const pendingTransactions = walletWithPendingTransaction.transactions.filter(t => 
                        t.external_id === external_id.toString() &&
                        t.paymentMethod === 'crypto' && 
                        t.status === 'pending'
                    ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                    
                    if (pendingTransactions.length > 0) {
                        const pendingTransaction = pendingTransactions[0];
                        
                        // Store transaction details
                        const transactionNotes = JSON.stringify({
                            crypto: crypto,
                            address: addr,
                            cryptoAmount: cryptoAmount,
                            transactionHash: transactionHash,
                            feeAmount: feeAmount,
                            overpaid: overpaid_fiat,
                            external_id: external_id,
                            processed_at: new Date().toISOString(),
                            webhook_amount: depositAmount,
                            original_amount: pendingTransaction.amount
                        });
                        
                        // Use wallet's updateTransactionStatus method to trigger balance update
                        walletWithPendingTransaction.updateTransactionStatus(
                            pendingTransaction._id, 
                            'completed', 
                            transactionNotes
                        );
                        
                        // Set additional fields AFTER status update
                        pendingTransaction.txid = transactionHash;
                        pendingTransaction.description = `${crypto} deposit - ${addr} (${cryptoAmount} ${crypto}) - TX: ${transactionHash}`;
                        pendingTransaction.completedAt = new Date();
                        
                        await walletWithPendingTransaction.save();
                        
                        console.log(`Payment confirmed - Updated transaction ${pendingTransaction._id} with txid ${transactionHash} for user ${walletWithPendingTransaction.userId}: ${pendingTransaction.amount} (webhook amount: ${depositAmount})`);
                        
                        res.status(200).json({
                            success: true,
                            message: 'Payment confirmed and wallet transaction updated',
                            data: {
                                userId: walletWithPendingTransaction.userId,
                                transactionId: pendingTransaction._id,
                                originalAmount: pendingTransaction.amount,
                                webhookAmount: depositAmount,
                                crypto,
                                transactionHash,
                                status: 'completed',
                                external_id: external_id
                            }
                        });
                        
                    } else {
                        throw new Error(`No pending crypto transaction found matching external_id ${external_id}`);
                    }
                } else {
                    console.log(`No wallet found with pending crypto transaction for external_id: ${external_id}`);
                    console.log(`This might be a webhook for a transaction not initiated through our system`);
                    
                    res.status(200).json({
                        success: true,
                        message: 'No matching pending transaction found',
                        info: 'This might be a webhook for a transaction not initiated through our system',
                        external_id: external_id,
                        txid: transactionHash,
                        amount: depositAmount
                    });
                }
                
            } catch (error) {
                console.error('Error updating wallet transaction:', error);
                
                res.status(500).json({
                    success: false,
                    message: 'Payment confirmed but failed to update wallet transaction',
                    error: error.message
                });
            }
            
        } else if (status === 'FAILED' || status === 'EXPIRED' || status === 'CANCELLED') {
            console.log(`Payment failed/expired for external_id: ${external_id}, status: ${status}`);
            
            try {
                const walletWithPendingTransaction = await Wallet.findOne({
                    'transactions.external_id': external_id.toString(),
                    'transactions.paymentMethod': 'crypto',
                    'transactions.status': 'pending'
                });

                if (walletWithPendingTransaction) {
                    const pendingTransactions = walletWithPendingTransaction.transactions.filter(t => 
                        t.external_id === external_id.toString() &&
                        t.paymentMethod === 'crypto' && 
                        t.status === 'pending'
                    ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
                    
                    if (pendingTransactions.length > 0) {
                        const pendingTransaction = pendingTransactions[0];
                        
                        walletWithPendingTransaction.updateTransactionStatus(
                            pendingTransaction._id, 
                            'failed', 
                            `Payment ${status.toLowerCase()}: ${external_id}`
                        );
                        
                        pendingTransaction.txid = transactionHash;
                        await walletWithPendingTransaction.save();
                        
                        console.log(`Updated transaction ${pendingTransaction._id} to failed status with txid ${transactionHash}`);
                    }
                }
            } catch (error) {
                console.error('Error updating failed transaction:', error);
            }
            
            res.status(200).json({
                success: true,
                message: 'Payment status updated - failed/expired',
                txid: transactionHash,
                external_id: external_id
            });
        } else {
            console.log(`Payment status: ${status} for external_id: ${external_id}, txid: ${transactionHash}`);
            res.status(200).json({
                success: true,
                message: 'Payment status received',
                status,
                txid: transactionHash,
                external_id: external_id
            });
        }

    } catch (error) {
        console.error('Error processing payment webhook:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing payment confirmation'
        });
    }
};

// Updated processCryptoWithdrawal - no polling needed
const processCryptoWithdrawal = async (cryptoAmount, cryptoType, destination, walletTransactionId) => {
    try {
        if (!PAYMENT_GATEWAY_URL || !SHKEEPER_USERNAME || !SHKEEPER_PASSWORD) {
            throw new Error('Payment gateway not configured');
        }

        console.log(`Processing crypto withdrawal: ${cryptoAmount} ${cryptoType} to ${destination}`);

        // Create Basic Auth header
        const authString = `${SHKEEPER_USERNAME}:${SHKEEPER_PASSWORD}`;
        const encodedAuth = Buffer.from(authString).toString('base64');

        // Set appropriate fee and decimal places based on crypto type
        let fee;
        let decimalPlaces;
        
        switch (cryptoType.toUpperCase()) {
            case 'BTC':
                fee = "20";
                decimalPlaces = 8;
                break;
            case 'LTC':
                fee = "100";
                decimalPlaces = 8;
                break;
            case 'DOGE':
                fee = "100";
                decimalPlaces = 8;
                break;
            case 'ETH':
                fee = "10";
                decimalPlaces = 18;
                break;
            case 'XMR':
                fee = "2";
                decimalPlaces = 12;
                break;
            case 'ADA':
                fee = "10";
                decimalPlaces = 6;
                break;
            case 'DOT':
                fee = "10";
                decimalPlaces = 10;
                break;
            case 'BCH':
                fee = "10";
                decimalPlaces = 8;
                break;
            default:
                fee = "10";
                decimalPlaces = 8;
                break;
        }

        // Format the crypto amount
        const formattedAmount = parseFloat(cryptoAmount).toFixed(decimalPlaces);
        const finalAmount = parseFloat(formattedAmount);

        if (finalAmount <= 0) {
            throw new Error(`Invalid crypto amount after formatting: ${finalAmount}`);
        }

        const payoutData = {
            amount: finalAmount,
            destination: destination,
            fee: fee
        };

        console.log(`Sending payout request to: ${PAYMENT_GATEWAY_URL}/api/v1/${cryptoType}/payout`);
        console.log(`Payout data:`, JSON.stringify(payoutData, null, 2));
        console.log(`Transaction ID: ${walletTransactionId}`);

        // Create payout request
        const payoutResponse = await axios.post(
            `${PAYMENT_GATEWAY_URL}/api/v1/${cryptoType}/payout`,
            payoutData,
            {
                headers: {
                    'Authorization': `Basic ${encodedAuth}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 second timeout
            }
        );

        console.log(`Payout response:`, JSON.stringify(payoutResponse.data, null, 2));

        // Check for error in response
        if (payoutResponse.data.error && payoutResponse.data.error !== null) {
            throw new Error(`Gateway error: ${payoutResponse.data.error.message || JSON.stringify(payoutResponse.data.error)}`);
        }

        // Extract task_id (which is actually the transaction hash in your case)
        const task_id = payoutResponse.data.result || payoutResponse.data.task_id;

        if (!task_id) {
            console.error('No task_id/result in response:', payoutResponse.data);
            throw new Error('No task ID received from payment gateway');
        }

        console.log(`Payout processed successfully with ID: ${task_id}`);

        // Since error is null, the transaction is accepted and will be processed
        // Mark as completed immediately
        await updateWalletTransactionStatus(walletTransactionId, 'completed', {
            cryptoTxHash: task_id,
            cryptoAddress: destination,
            cryptoAmount: finalAmount,
            originalCryptoAmount: cryptoAmount,
            cryptoType: cryptoType,
            processedAt: new Date().toISOString(),
            gatewayResponse: payoutResponse.data
        });

        console.log(`Marked wallet transaction ${walletTransactionId} as completed`);

        return {
            success: true,
            task_id,
            transaction_hash: task_id,
            status: 'completed',
            message: 'Payment has been processed successfully. You will receive it in your wallet shortly.'
        };

    } catch (error) {
        console.error('Error processing crypto withdrawal:', error);
        
        // Log more details about the error
        if (error.response) {
            console.error('Gateway response status:', error.response.status);
            console.error('Gateway response data:', JSON.stringify(error.response.data, null, 2));
        }
        
        throw error;
    }
};

// Helper function to update wallet transaction status
const updateWalletTransactionStatus = async (transactionId, status, metadata = {}) => {
    try {
        const Wallet = require('../models/Wallet');
        
        // Find the wallet containing this transaction
        const wallet = await Wallet.findOne({
            'transactions._id': transactionId
        });

        if (wallet) {
            const transaction = wallet.transactions.id(transactionId);
            
            if (!transaction) {
                console.error(`Transaction ${transactionId} not found in wallet`);
                return null;
            }
            
            const oldStatus = transaction.status;
            const transactionAmount = transaction.amount;
            const transactionType = transaction.type;
            
            console.log(`Updating transaction ${transactionId} from ${oldStatus} to ${status}, amount: ${transactionAmount}, type: ${transactionType}`);
            
            // Update transaction status and metadata
            transaction.status = status;
            transaction.notes = JSON.stringify(metadata);
            
            if (status === 'completed') {
                transaction.completedAt = new Date();
                
                // Deduct balance when withdrawal is completed
                if (transactionType === 'withdrawal' && oldStatus === 'pending') {
                    const oldBalance = wallet.balance;
                    const oldAvailableBalance = wallet.availableBalance;
                    
                    wallet.balance -= transactionAmount;
                    wallet.availableBalance -= transactionAmount;
                    
                    console.log(`Withdrawal completed - Balance deducted: ${transactionAmount}`);
                    console.log(`Balance: ${oldBalance} → ${wallet.balance}`);
                    console.log(`Available: ${oldAvailableBalance} → ${wallet.availableBalance}`);
                }
                
                // Add balance when deposit is completed
                if (transactionType === 'deposit' && oldStatus === 'pending') {
                    const oldBalance = wallet.balance;
                    const oldAvailableBalance = wallet.availableBalance;
                    
                    wallet.balance += transactionAmount;
                    wallet.availableBalance += transactionAmount;
                    
                    console.log(`Deposit completed - Balance added: ${transactionAmount}`);
                    console.log(`Balance: ${oldBalance} → ${wallet.balance}`);
                    console.log(`Available: ${oldAvailableBalance} → ${wallet.availableBalance}`);
                }
            }
            
            if (status === 'failed') {
                transaction.failedAt = new Date();
                console.log(`Transaction ${transactionId} marked as failed`);
                
                // No balance changes needed for failed withdrawals since balance wasn't deducted yet
                if (transactionType === 'withdrawal') {
                    console.log(`Failed withdrawal - no balance restoration needed (balance was not deducted)`);
                }
            }
            
            await wallet.save();
            
            console.log(`Successfully updated wallet transaction ${transactionId} to ${status}`);
            return transaction;
        } else {
            console.error(`Wallet containing transaction ${transactionId} not found`);
            return null;
        }
    } catch (error) {
        console.error('Error updating wallet transaction:', error);
        throw error;
    }
};

// Create cashapp payment request
const createCashappPaymentRequest = async (req, res) => {
    try {
        const { amount } = req.body;
        const userId = req.user.userId;

        // Validation
        if (!amount || amount <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Valid amount is required (must be greater than 0)'
            });
        }

        if (amount < 5) {
            return res.status(400).json({
                success: false,
                message: 'Minimum deposit amount is $5'
            });
        }

        if (amount > 10000) {
            return res.status(400).json({
                success: false,
                message: 'Maximum deposit amount is $10,000'
            });
        }

        const CASHAPP_API_URL = process.env.CASHAPP_API_URL;
        const CASHAPP_AUTH_TOKEN = process.env.CASHAPP_AUTH_TOKEN;
        const CASHAPP_MCH_NO = process.env.CASHAPP_MCH_NO || '2025079012';
        const CASHAPP_CURR_CODE = process.env.CASHAPP_CURR_CODE || 'usd';
        const CASHAPP_WAY_CODE = process.env.CASHAPP_WAY_CODE || 'cashapp';

        if (!CASHAPP_API_URL || !CASHAPP_AUTH_TOKEN) {
            return res.status(500).json({
                success: false,
                message: 'Cashapp payment gateway not configured'
            });
        }

        // Adjust amount - subtract 1 cent if amount is a whole number (e.g., 20 -> 19.99)
        let adjustedAmount = amount;
        if (Number.isInteger(amount)) {
            adjustedAmount = amount - 0.01;
        }

        // Convert amount to cents (multiply by 100)
        const amountInCents = Math.round(adjustedAmount * 100);

        console.log(`Cashapp payment request: Original amount: ${amount}, Adjusted amount: ${adjustedAmount}, Amount in cents: ${amountInCents}`);

        // Create payment request with Cashapp gateway
        const paymentResponse = await axios.post(
            CASHAPP_API_URL,
            {
                mchNo: CASHAPP_MCH_NO,
                currCode: CASHAPP_CURR_CODE,
                wayCode: CASHAPP_WAY_CODE,
                amount: amountInCents.toString()
            },
            {
                headers: {
                    'Authori-Zation': CASHAPP_AUTH_TOKEN,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30 second timeout
            }
        );

        // Check response status code
        if (paymentResponse.status !== 200) {
            console.error('Cashapp gateway returned non-200 status:', paymentResponse.status);
            return res.status(500).json({
                success: false,
                message: `Payment gateway error: Received status ${paymentResponse.status}`,
                error: process.env.NODE_ENV === 'development' ? paymentResponse.data : undefined
            });
        }

        // Check for API-level errors in the response
        if (paymentResponse.data && paymentResponse.data.code !== 200 && paymentResponse.data.code !== '0') {
            console.error('Cashapp gateway returned error code:', paymentResponse.data);
            return res.status(400).json({
                success: false,
                message: paymentResponse.data.message || 'Payment gateway returned an error',
                error: process.env.NODE_ENV === 'development' ? paymentResponse.data : undefined
            });
        }

        // Generate unique external ID for tracking
        const externalId = `cashapp_${userId}_${Date.now()}`;

        // Create pending transaction in wallet
        const wallet = await Wallet.findOrCreateWallet(userId);
        const transaction = wallet.addTransaction({
            type: 'deposit',
            amount: parseFloat(amount), // Store original amount
            description: `Cashapp deposit - Pending payment`,
            paymentMethod: 'cashapp',
            status: 'pending',
            external_id: externalId,
            fee: 0
        });
        
        await wallet.save();

        // Parse the data string from response
        let parsedData = null;
        let cashierUrl = null;
        let payOrderNo = null;
        let mchOrderNo = null;
        let expireTimestamp = null;

        if (paymentResponse.data && paymentResponse.data.data && paymentResponse.data.data.data) {
            try {
                // The data field is a JSON string, so we need to parse it
                parsedData = JSON.parse(paymentResponse.data.data.data);
                cashierUrl = parsedData.cashierUrl;
                payOrderNo = parsedData.payOrderNo;
                mchOrderNo = parsedData.mchOrderNo;
                expireTimestamp = parsedData.expireTimestamp;
                
                console.log('Parsed Cashapp payment data:', { cashierUrl, payOrderNo, mchOrderNo, expireTimestamp });
            } catch (parseError) {
                console.error('Error parsing gateway data:', parseError);
                // Don't fail the request, just log the error
            }
        }

        // Check if we got a cashier URL (critical for payment)
        if (!cashierUrl) {
            console.error('No cashier URL received from gateway:', paymentResponse.data);
            
            // Delete the pending transaction since we can't proceed
            wallet.transactions.pull(transaction._id);
            await wallet.save();
            
            return res.status(500).json({
                success: false,
                message: 'Payment gateway did not return a payment URL. Please try again.',
                error: process.env.NODE_ENV === 'development' ? 'Missing cashierUrl in response' : undefined
            });
        }

        // Format response for frontend
        const formattedResponse = {
            success: true,
            external_id: externalId,
            transactionId: transaction._id,
            amount: amount, // Original amount
            adjustedAmount: adjustedAmount, // Adjusted amount sent to gateway
            amountInCents: amountInCents,
            paymentMethod: 'cashapp',
            status: 'pending',
            cashierUrl: cashierUrl,
            payOrderNo: payOrderNo,
            mchOrderNo: mchOrderNo,
            expireTimestamp: expireTimestamp,
            gatewayResponse: paymentResponse.data,
            created_at: new Date().toISOString()
        };

        res.json({
            success: true,
            message: 'Cashapp payment request created successfully',
            data: formattedResponse
        });

    } catch (error) {
        console.error('Error creating cashapp payment request:', error.response?.data || error.message);
        
        // Handle different error types
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            return res.status(504).json({
                success: false,
                message: 'Payment gateway request timed out. Please try again.'
            });
        }

        if (error.response) {
            console.error('Gateway response error:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });

            if (error.response.status === 400) {
                return res.status(400).json({
                    success: false,
                    message: error.response.data?.message || 'Invalid payment request parameters'
                });
            }

            if (error.response.status === 401 || error.response.status === 403) {
                return res.status(500).json({
                    success: false,
                    message: 'Payment gateway authentication failed. Please contact support.'
                });
            }

            if (error.response.status >= 500) {
                return res.status(502).json({
                    success: false,
                    message: 'Payment gateway is currently unavailable. Please try again later.'
                });
            }

            return res.status(500).json({
                success: false,
                message: error.response.data?.message || 'Payment gateway error occurred',
                error: process.env.NODE_ENV === 'development' ? error.response.data : undefined
            });
        } else if (error.request) {
            console.error('No response from gateway:', error.request);
            return res.status(503).json({
                success: false,
                message: 'Unable to connect to payment gateway. Please try again.'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to create cashapp payment request',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Cashapp proxy
const cashappProxy = async (req, res) => {
  try {
    let { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL parameter is required',
      });
    }

    console.log('🟢 Received proxy request for:', url);

    // Force desktop User-Agent & allow invalid SSL
    const agent = new https.Agent({ rejectUnauthorized: false });

    const response = await axios.get(url, {
      httpsAgent: agent,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        Connection: 'keep-alive',
      },
      timeout: 30000,
      maxRedirects: 5,
      validateStatus: (status) => status < 500,
    });

    console.log(`✅ Proxy fetched: ${response.status} (${response.request?.res?.responseUrl || url})`);

    // Preserve response headers
    const contentType = response.headers['content-type'] || 'text/html';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('X-Frame-Options', 'ALLOWALL');

    // Send the raw content back to the iframe
    res.send(response.data);
  } catch (error) {
    console.error('❌ Proxy error:', error.message);

    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body {
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              font-family: Arial, sans-serif;
            }
            .error-box {
              background: white;
              padding: 30px;
              border-radius: 12px;
              max-width: 400px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.3);
              text-align: center;
            }
            h2 { color: #e53e3e; }
            p { color: #555; }
          </style>
        </head>
        <body>
          <div class="error-box">
            <h2>⚠️ Payment Page Load Failed</h2>
            <p>Unable to load payment content. Please open in a desktop browser.</p>
          </div>
        </body>
      </html>
    `);
  }
};

// Setup Chime payment method
const setupChimePayment = async (req, res) => {
    try {
        const { chimeTag, fullName } = req.body;
        const userId = req.user.userId;

        // Validation
        if (!chimeTag || !fullName) {
            return res.status(400).json({
                success: false,
                message: 'Chime tag and full name are required'
            });
        }

        // Validate Chime tag format ($ChimeSign)
        if (!/^\$[a-zA-Z0-9_-]+$/.test(chimeTag)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Chime tag format. Must start with $ (e.g., $JohnDoe)'
            });
        }

        // Get Mail.tm credentials from environment
        const MAIL_TM_USERNAME = process.env.MAIL_TM_USERNAME;
        const MAIL_TM_PASSWORD = process.env.MAIL_TM_PASSWORD;

        if (!MAIL_TM_USERNAME || !MAIL_TM_PASSWORD) {
            return res.status(500).json({
                success: false,
                message: 'Chime payment gateway not configured'
            });
        }

        // Save Chime payment method
        const paymentMethod = await PaymentMethod.findOrCreate(userId, 'chime', {
            chimeTag: chimeTag.trim(),
            fullName: fullName.trim(),
            mailTmUsername: MAIL_TM_USERNAME,
            mailTmPassword: MAIL_TM_PASSWORD,
            lastVerified: new Date()
        });

        res.json({
            success: true,
            message: 'Chime payment method configured successfully',
            data: {
                chimeTag: paymentMethod.chimeConfig.chimeTag,
                fullName: paymentMethod.chimeConfig.fullName,
                isActive: paymentMethod.isActive
            }
        });

    } catch (error) {
        console.error('Error setting up Chime payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to setup Chime payment method',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// controllers/paymentController.js

// controllers/paymentController.js

const createChimePaymentRequest = async (req, res) => {
    console.log('=== CREATE CHIME PAYMENT REQUEST START ===');
    console.log('Request body:', req.body);
    console.log('User ID from token:', req.user?.id);
    
    try {
        const { amount, chimeTag, fullName } = req.body;
        const userId = req.user.id;

        console.log('Extracted values:', { amount, chimeTag, fullName, userId });

        // Validate amount
        if (!amount || amount <= 0) {
            console.log('❌ Validation failed: Invalid amount');
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid amount' 
            });
        }
        console.log('✅ Amount validation passed:', amount);

        // Validate Chime details from request
        if (!chimeTag || !fullName) {
            console.log('❌ Validation failed: Missing chimeTag or fullName');
            console.log('chimeTag:', chimeTag, 'fullName:', fullName);
            return res.status(400).json({ 
                success: false, 
                message: 'Chime tag and full name are required' 
            });
        }
        console.log('✅ Chime details validation passed');

        // Validate Chime tag format
        if (!chimeTag.startsWith('$')) {
            console.log('❌ Validation failed: Chime tag does not start with $');
            return res.status(400).json({ 
                success: false, 
                message: 'Chime tag must start with $' 
            });
        }
        console.log('✅ Chime tag format validation passed');

        // Get business Chime configuration from PaymentMethod
        console.log('📥 Fetching business Chime configuration...');
        const PaymentMethod = require('../models/PaymentMethod');
        const chimeConfig = await PaymentMethod.getConfig('chime');
        
        console.log('Business Chime config:', chimeConfig);
        
        if (!chimeConfig || !chimeConfig.businessChimeTag) {
            console.log('❌ Business Chime configuration not found or incomplete');
            return res.status(400).json({ 
                success: false, 
                message: 'Chime payment is not configured. Please contact support.' 
            });
        }
        console.log('✅ Business Chime config loaded:', {
            businessChimeTag: chimeConfig.businessChimeTag,
            businessChimeName: chimeConfig.businessChimeName
        });

        // Save/Update user's Chime details in UserChimeDetails
        console.log('💾 Saving user Chime details...');
        const UserChimeDetails = require('../models/UserChimeDetails');
        const userChimeDetails = await UserChimeDetails.findOrCreate(userId, {
            chimeTag: chimeTag.trim(),
            fullName: fullName.trim(),
            isActive: true
        });

        console.log('✅ User Chime details saved:', {
            id: userChimeDetails._id,
            userId: userChimeDetails.userId,
            chimeTag: userChimeDetails.chimeTag,
            fullName: userChimeDetails.fullName,
            isActive: userChimeDetails.isActive
        });

        // Generate unique external ID
        const external_id = `CHIME_${Date.now()}_${userId}`;
        console.log('🔑 Generated external_id:', external_id);

        // Create transaction in wallet
        console.log('💳 Creating wallet transaction...');
        const Wallet = require('../models/Wallet');
        const wallet = await Wallet.findOrCreateWallet(userId);
        
        console.log('Wallet found/created:', {
            walletId: wallet._id,
            currentBalance: wallet.balance,
            userId: wallet.userId
        });
        
        const transaction = wallet.addTransaction({
            type: 'deposit',
            amount: amount,
            description: `Chime deposit of $${amount} from ${chimeTag}`,
            status: 'pending',
            paymentMethod: 'chime',
            external_id: external_id,
            fee: 0,
            completedAt: null
        });

        console.log('Transaction added to wallet:', {
            transactionId: transaction._id,
            amount: transaction.amount,
            status: transaction.status,
            external_id: transaction.external_id
        });

        await wallet.save();
        console.log('✅ Wallet saved successfully');

        // Set expiration time (30 minutes from now)
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
        console.log('⏰ Payment expires at:', expiresAt.toISOString());

        // Return payment instructions
        const response = {
            success: true,
            external_id: external_id,
            transactionId: transaction._id.toString(),
            amount: amount,
            paymentMethod: 'chime',
            status: 'pending',
            chimeTag: chimeConfig.businessChimeTag,
            recipientName: chimeConfig.businessChimeName,
            instructions: [
                '1. Open your Chime app',
                '2. Go to "Pay Friends"',
                `3. Search for ${chimeConfig.businessChimeTag}`,
                `4. Send exactly $${amount.toFixed(2)}`,
                '5. Wait for automatic verification (usually within minutes)',
                '6. Your balance will be updated automatically'
            ],
            expiresAt: expiresAt.toISOString(),
            created_at: new Date().toISOString(),
            userChimeTag: chimeTag // Return user's chime tag for reference
        };

        console.log('📤 Sending response:', response);
        console.log('=== CREATE CHIME PAYMENT REQUEST SUCCESS ===');

        res.json({
            success: true,
            data: response
        });

    } catch (error) {
        console.error('❌❌❌ ERROR in createChimePaymentRequest:', error);
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.log('=== CREATE CHIME PAYMENT REQUEST FAILED ===');
        
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to create Chime payment request' 
        });
    }
};

// Verify Chime payment (manual trigger or cron job)
const verifyChimePayment = async (req, res) => {
    try {
        const { transactionId } = req.body;
        const userId = req.user.userId;

        if (!transactionId) {
            return res.status(400).json({
                success: false,
                message: 'Transaction ID is required'
            });
        }

        // Find the pending transaction
        const wallet = await Wallet.findOne({
            userId,
            'transactions._id': transactionId,
            'transactions.paymentMethod': 'chime',
            'transactions.status': 'pending'
        });

        if (!wallet) {
            return res.status(404).json({
                success: false,
                message: 'Pending Chime transaction not found'
            });
        }

        const transaction = wallet.transactions.id(transactionId);
        
        if (!transaction) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found'
            });
        }

        // Get payment method config
        const paymentMethod = await PaymentMethod.findOne({
            userId,
            method: 'chime',
            isActive: true
        });

        if (!paymentMethod) {
            return res.status(400).json({
                success: false,
                message: 'Chime payment method not configured'
            });
        }

        const { mailTmUsername, mailTmPassword, fullName } = paymentMethod.chimeConfig;

        // Login to Mail.tm
        await mailTmService.login(mailTmUsername, mailTmPassword);

        // Search for payments after transaction creation
        const transactionDate = new Date(transaction.createdAt);
        const chimeMessages = await mailTmService.searchChimePayments(transactionDate);

        console.log(`Found ${chimeMessages.length} Chime payment emails`);

        // Parse and match payments
        let matchedPayment = null;
        for (const message of chimeMessages) {
            const paymentDetails = await mailTmService.parseChimePayment(message.id);
            
            console.log('Checking payment:', paymentDetails);

            // Match by amount and sender name
            const amountMatches = paymentDetails.amount && 
                                 Math.abs(paymentDetails.amount - transaction.amount) < 0.01;
            
            const nameMatches = paymentDetails.senderName && 
                               paymentDetails.senderName.toLowerCase().includes(fullName.toLowerCase().split(' ')[0]);

            // Date should be after transaction creation and within 30 minutes
            const dateMatches = paymentDetails.date > transactionDate &&
                               (paymentDetails.date - transactionDate) <= 30 * 60 * 1000;

            if (amountMatches && nameMatches && dateMatches) {
                matchedPayment = paymentDetails;
                break;
            }
        }

        if (matchedPayment) {
            // Payment found - mark as completed
            const metadata = {
                senderName: matchedPayment.senderName,
                amount: matchedPayment.amount,
                chimeTag: matchedPayment.chimeTag,
                emailSubject: matchedPayment.subject,
                verifiedAt: new Date().toISOString(),
                messageId: matchedPayment.messageId
            };

            wallet.updateTransactionStatus(
                transaction._id,
                'completed',
                JSON.stringify(metadata)
            );

            transaction.description = `Chime deposit from ${matchedPayment.senderName} - Verified`;
            transaction.completedAt = new Date();

            await wallet.save();

            console.log(`Chime payment verified for transaction ${transactionId}: ${matchedPayment.amount}`);

            res.json({
                success: true,
                message: 'Payment verified successfully',
                data: {
                    transactionId: transaction._id,
                    amount: transaction.amount,
                    senderName: matchedPayment.senderName,
                    status: 'completed'
                }
            });

        } else {
            // Payment not found yet
            res.json({
                success: false,
                message: 'Payment not verified yet. Please wait a few minutes and try again.',
                data: {
                    transactionId: transaction._id,
                    amount: transaction.amount,
                    status: 'pending',
                    searchedEmails: chimeMessages.length
                }
            });
        }

    } catch (error) {
        console.error('Error verifying Chime payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify Chime payment',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Auto-verify all pending Chime payments (for cron job)
const autoVerifyChimePayments = async () => {
    try {
        console.log('Starting auto-verification of Chime payments...');

        // Find all pending Chime transactions
        const walletsWithPending = await Wallet.find({
            'transactions.paymentMethod': 'chime',
            'transactions.status': 'pending'
        });

        console.log(`Found ${walletsWithPending.length} wallets with pending Chime transactions`);

        for (const wallet of walletsWithPending) {
            const pendingTransactions = wallet.transactions.filter(t =>
                t.paymentMethod === 'chime' &&
                t.status === 'pending'
            );

            for (const transaction of pendingTransactions) {
                try {
                    // Get payment method config
                    const paymentMethod = await PaymentMethod.findOne({
                        userId: wallet.userId,
                        method: 'chime',
                        isActive: true
                    });

                    if (!paymentMethod) continue;

                    const { mailTmUsername, mailTmPassword, fullName } = paymentMethod.chimeConfig;

                    // Login to Mail.tm
                    await mailTmService.login(mailTmUsername, mailTmPassword);

                    // Search for payments
                    const transactionDate = new Date(transaction.createdAt);
                    const chimeMessages = await mailTmService.searchChimePayments(transactionDate);

                    // Match payment
                    for (const message of chimeMessages) {
                        const paymentDetails = await mailTmService.parseChimePayment(message.id);

                        const amountMatches = paymentDetails.amount &&
                                            Math.abs(paymentDetails.amount - transaction.amount) < 0.01;

                        const nameMatches = paymentDetails.senderName &&
                                           paymentDetails.senderName.toLowerCase().includes(fullName.toLowerCase().split(' ')[0]);

                        const dateMatches = paymentDetails.date > transactionDate &&
                                           (paymentDetails.date - transactionDate) <= 30 * 60 * 1000;

                        if (amountMatches && nameMatches && dateMatches) {
                            // Mark as completed
                            const metadata = {
                                senderName: paymentDetails.senderName,
                                amount: paymentDetails.amount,
                                chimeTag: paymentDetails.chimeTag,
                                emailSubject: paymentDetails.subject,
                                verifiedAt: new Date().toISOString(),
                                messageId: paymentDetails.messageId,
                                autoVerified: true
                            };

                            wallet.updateTransactionStatus(
                                transaction._id,
                                'completed',
                                JSON.stringify(metadata)
                            );

                            transaction.description = `Chime deposit from ${paymentDetails.senderName} - Auto-verified`;
                            transaction.completedAt = new Date();

                            await wallet.save();

                            console.log(`✅ Auto-verified Chime payment: Transaction ${transaction._id}, Amount: ${paymentDetails.amount}`);
                            break;
                        }
                    }

                } catch (error) {
                    console.error(`Error auto-verifying transaction ${transaction._id}:`, error);
                }
            }
        }

        console.log('Auto-verification completed');

    } catch (error) {
        console.error('Error in auto-verify Chime payments:', error);
    }
};

// Get user's Chime details
const getUserChimeDetails = async (req, res) => {
    try {
        const userId = req.user.userId;

        const paymentMethod = await PaymentMethod.findOne({
            userId,
            method: 'chime',
            isActive: true
        });

        if (!paymentMethod || !paymentMethod.chimeConfig) {
            return res.json({
                success: true,
                data: null,
                message: 'Chime not configured'
            });
        }

        res.json({
            success: true,
            data: {
                chimeTag: paymentMethod.chimeConfig.chimeTag,
                fullName: paymentMethod.chimeConfig.fullName,
                isActive: paymentMethod.isActive,
                lastVerified: paymentMethod.chimeConfig.lastVerified
            }
        });

    } catch (error) {
        console.error('Error fetching Chime details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch Chime details'
        });
    }
};

// Get user's payment methods
const getPaymentMethods = async (req, res) => {
    try {
        const userId = req.user.userId;

        const paymentMethods = await PaymentMethod.find({
            userId,
            isActive: true
        }).select('-cryptoConfig.apiKey -cryptoConfig.password -cashappConfig.authToken -chimeConfig.mailTmPassword');

        const formattedMethods = paymentMethods.map(method => ({
            id: method._id,
            method: method.method,
            config: method.method === 'chime' ? {
                chimeTag: method.chimeConfig?.chimeTag,
                fullName: method.chimeConfig?.fullName,
                lastVerified: method.chimeConfig?.lastVerified
            } : null,
            isActive: method.isActive,
            createdAt: method.createdAt
        }));

        res.json({
            success: true,
            data: formattedMethods
        });

    } catch (error) {
        console.error('Error fetching payment methods:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payment methods'
        });
    }
};

// Export all functions
const exportedFunctions = {
    getCryptoList,
    createPaymentRequest,
    confirmPayment,
    processCryptoWithdrawal,
    createCashappPaymentRequest,
    cashappProxy,
    setupChimePayment,
    createChimePaymentRequest,
    verifyChimePayment,
    autoVerifyChimePayments,
    getUserChimeDetails,
    getPaymentMethods
};

console.log('Exporting payment controller functions:', Object.keys(exportedFunctions));

module.exports = exportedFunctions;