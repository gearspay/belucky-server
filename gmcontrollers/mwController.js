// controllers/MilkyWaysController.js - FIXED VERSION
const Puppeteer = require('puppeteer');
const Captcha = require('../lib/captcha.js');
const { writeFileSync, readFileSync, existsSync } = require('fs');
const Tasks = require('../lib/tasks.js');
const Logger = require('../utils/logger.js');
const GameAccount = require('../models/GameAccount.js');
const Game = require('../models/Game.js');
const path = require('path');

class MilkyWaysController {
    constructor() {
        this.browser = null;
        this.page = null;
        this.cookies = null;
        this.authorized = false;
        this.logger = Logger('Milkyways');
        this.gameType = 'mw';
        this.initialized = false;
        this.agentCredentials = null;
        
        this.keepAlive = true;
        this.lastActivity = Date.now();
        this.activityTimeout = 5 * 60 * 1000;
        
        this.cache = {
            adminBalance: null,
            adminBalanceTimestamp: null,
            cacheDuration: 30 * 1000
        };

        // ⭐ QUEUE SYSTEM
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.maxConcurrentRequests = 1;

        // ⭐ INITIALIZATION STATE
        this.isInitializing = false;
        this.initializationPromise = null;
        this.browserReady = false;

        // ⭐ AUTHORIZATION STATE
        this.isAuthorizing = false;
        this.authorizationPromise = null;
        this.authorizationInProgress = false;

        // ⭐ SESSION MANAGEMENT
        this.sessionTimeout = null;
        this.lastSuccessfulOperation = Date.now();
        this.consecutiveErrors = 0;
        this.maxConsecutiveErrors = 3;

        this.loadAgentCredentials().catch(err => {
            this.error(`Failed to load credentials on startup: ${err.message}`);
        });

        // Session timeout checker
        this.startSessionMonitor();

        process.on('unhandledRejection', e => {
            this.logger.error(e);
        });

        process.on('uncaughtException', e => {
            this.logger.error(e);
        });
    }

    log(log) { this.logger.log(`${log}`) }
    error(log) { this.logger.error(`${log}`) }

    // ========================================
    // SESSION MONITORING
    // ========================================

    startSessionMonitor() {
        setInterval(async () => {
            if (!this.initialized || !this.page || !this.browser) return;

            const timeSinceLastActivity = Date.now() - this.lastSuccessfulOperation;
            
            if (timeSinceLastActivity > this.activityTimeout) {
                this.log('Session timeout detected, reinitializing...');
                await this.reinitialize();
            }
        }, 60000); // Check every minute
    }

    async reinitialize() {
        this.log('Reinitializing browser session...');
        this.initialized = false;
        this.browserReady = false;
        this.authorized = false;
        
        // Clear cache
        this.cache.adminBalance = null;
        this.cache.adminBalanceTimestamp = null;
        
        try {
            await this.initialize();
        } catch (error) {
            this.error(`Reinitialization failed: ${error.message}`);
        }
    }

    // ========================================
    // QUEUE SYSTEM IMPLEMENTATION (FIXED)
    // ========================================

    async queueOperation(operationName, operationFunction) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({
                name: operationName,
                function: operationFunction,
                resolve,
                reject,
                timestamp: Date.now()
            });
            
            this.log(`📥 Queued: "${operationName}" | Queue length: ${this.requestQueue.length}`);
            
            // Don't start processing if we're not initialized yet
            if (!this.isProcessingQueue && this.initialized && this.browserReady) {
                this.processQueue();
            } else if (!this.initialized || !this.browserReady) {
                this.log('Browser not ready, will process queue after initialization');
                this.initialize().then(() => {
                    if (!this.isProcessingQueue) {
                        this.processQueue();
                    }
                }).catch(err => {
                    this.error(`Failed to initialize for queued operation: ${err.message}`);
                });
            }
        });
    }

    async processQueue() {
        if (this.isProcessingQueue) {
            this.log('Queue processor already running');
            return;
        }
        
        this.isProcessingQueue = true;
        this.log('🚀 Queue processor started');
        
        while (this.requestQueue.length > 0) {
            const task = this.requestQueue.shift();
            const queueWaitTime = Date.now() - task.timestamp;
            this.log(`▶️  Processing: "${task.name}" (waited ${queueWaitTime}ms) | Remaining: ${this.requestQueue.length}`);
            
            try {
                // Ensure browser is ready before each operation
                await this.ensureBrowserReady();
                
                const startTime = Date.now();
                const result = await task.function();
                const executionTime = Date.now() - startTime;
                
                this.log(`✅ Completed: "${task.name}" in ${executionTime}ms`);
                this.lastSuccessfulOperation = Date.now();
                this.consecutiveErrors = 0;
                task.resolve(result);
                
                // Delay between operations for stability
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                this.error(`❌ Failed: "${task.name}" - ${error.message}`);
                this.consecutiveErrors++;
                
                // If too many consecutive errors, reinitialize
                if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
                    this.error(`Too many consecutive errors (${this.consecutiveErrors}), reinitializing...`);
                    await this.reinitialize();
                    this.consecutiveErrors = 0;
                }
                
                task.reject(error);
            }
        }
        
        this.isProcessingQueue = false;
        this.log('🏁 Queue processor stopped');
    }

    // ========================================
    // BROWSER STATE VALIDATION
    // ========================================

    async ensureBrowserReady() {
        // Check if browser exists
        if (!this.browser || !this.page) {
            this.log('Browser or page missing, reinitializing...');
            await this.initialize();
            return;
        }

        // Check if page is closed
        try {
            if (this.page.isClosed()) {
                this.log('Page is closed, reinitializing...');
                await this.initialize();
                return;
            }
        } catch (error) {
            this.log('Error checking page state, reinitializing...');
            await this.initialize();
            return;
        }

        // Check if browser is connected
        try {
            const version = await this.browser.version();
            if (!version) {
                throw new Error('Browser not responding');
            }
        } catch (error) {
            this.log('Browser not responding, reinitializing...');
            await this.initialize();
            return;
        }

        // Verify authorization
        if (!this.authorized) {
            this.log('Not authorized, checking authorization...');
            await this.checkAuthorization();
        }
    }

    async isBrowserValid() {
        if (!this.browser || !this.page) return false;
        
        try {
            if (this.page.isClosed()) return false;
            await this.browser.version();
            return true;
        } catch (error) {
            return false;
        }
    }

    async isIframeAccessible(selector = '#frm_main_content') {
        try {
            return await this.page.evaluate((sel) => {
                try {
                    const iframe = document.querySelector(sel);
                    if (!iframe) return false;
                    const doc = iframe.contentWindow.document;
                    return doc && doc.readyState === 'complete';
                } catch (e) {
                    return false;
                }
            }, selector);
        } catch (error) {
            return false;
        }
    }

    // ========================================
    // CORE METHODS (FIXED)
    // ========================================

    async loadAgentCredentials() {
        try {
            const game = await Game.findOne({ 
                shortcode: 'MW', 
                status: { $in: ['active', 'maintenance'] } 
            });

            if (!game) {
                throw new Error('MilkyWays game not found in database');
            }

            if (!game.agentUsername || !game.agentPassword) {
                throw new Error('Agent credentials not configured for MilkyWays');
            }

            this.agentCredentials = {
                username: game.agentUsername,
                password: game.agentPassword
            };

            this.log(`Loaded agent credentials for user: ${game.agentUsername}`);
            return true;
        } catch (error) {
            this.error(`Failed to load agent credentials: ${error.message}`);
            return false;
        }
    }

    async initialize() {
        // If already initialized and browser is valid, just return
        if (this.initialized && this.browserReady && await this.isBrowserValid()) {
            this.lastActivity = Date.now();
            return;
        }

        // If initialization is in progress, wait for it
        if (this.isInitializing) {
            this.log('Initialization already in progress, waiting...');
            if (this.initializationPromise) {
                await this.initializationPromise;
                return;
            }
            // Fallback: wait and retry
            await new Promise(resolve => setTimeout(resolve, 2000));
            return this.initialize();
        }

        this.isInitializing = true;
        this.browserReady = false;

        try {
            // Load credentials if not loaded
            if (!this.agentCredentials) {
                const credentialsLoaded = await this.loadAgentCredentials();
                if (!credentialsLoaded) {
                    throw new Error('Cannot initialize without agent credentials');
                }
            }

            this.initializationPromise = this.createBrowser();
            await this.initializationPromise;
            this.initialized = true;
            this.browserReady = true;
            this.lastSuccessfulOperation = Date.now();
            
        } catch (error) {
            this.error(`Initialization failed: ${error.message}`);
            this.initialized = false;
            this.browserReady = false;
            throw error;
        } finally {
            this.isInitializing = false;
            this.initializationPromise = null;
        }
    }

    async createBrowser() {
        this.log('Initializing browser for MilkyWays...');
        
        // Clean up existing browser
        if (this.browser) {
            try {
                this.browser.removeAllListeners('disconnected');
                if (this.page) {
                    this.page.removeAllListeners('error');
                    this.page.removeAllListeners('request');
                    this.page.removeAllListeners('close');
                }
                await this.browser.close();
            } catch (e) {
                this.log(`Error closing existing browser: ${e.message}`);
            }
            this.browser = null;
            this.page = null;
        }

        this.browser = await Puppeteer.launch({
            headless: 'new',
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-web-security",
                "--disable-features=VizDisplayCompositor",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
                "--disable-background-networking",
                "--disable-breakpad",
                "--disable-component-extensions-with-background-pages",
                "--disable-extensions",
                "--disable-features=TranslateUI",
                "--disable-ipc-flooding-protection",
                "--disable-hang-monitor",
                "--disable-prompt-on-repost",
                "--disable-sync",
                "--force-color-profile=srgb",
                "--metrics-recording-only",
                "--enable-automation",
                "--password-store=basic",
                "--use-mock-keychain",
                "--disable-blink-features=AutomationControlled",
                "--enable-features=NetworkService,NetworkServiceInProcess",
                "--force-webrtc-ip-handling-policy=default_public_interface_only"
            ],
            pipe: true,
            ignoreHTTPSErrors: true,
            defaultViewport: {
                width: 1312,
                height: 800
            }
        });

        const pages = await this.browser.pages();
        this.page = pages[0] || await this.browser.newPage();
        
        await this.page.setRequestInterception(true);
        
        this.page.on('request', (req) => {
            if (req.isInterceptResolutionHandled()) {
                return;
            }

            const resourceType = req.resourceType();
            const url = req.url();
            
            if (url.includes('/default.aspx') || 
                url.includes('ImageCheck') || 
                url.includes('VerifyCode') || 
                url.includes('captcha') ||
                url.includes('.aspx')) {
                req.continue().catch(() => {});
                return;
            }
            
            if (['stylesheet', 'font', 'media'].includes(resourceType)) {
                req.abort().catch(() => {});
            } else {
                req.continue().catch(() => {});
            }
        });

        // Handle page errors
        this.page.on('error', (error) => {
            this.error(`Page crashed: ${error.message}`);
            this.browserReady = false;
            this.initialized = false;
        });

        // Handle page close
        this.page.on('close', () => {
            this.log('Page closed unexpectedly');
            this.browserReady = false;
            this.initialized = false;
        });

        await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');

        // Load cookies
        const cookiesPath = path.join(__dirname, 'cookiesmw.json');
        if (existsSync(cookiesPath)) {
            try {
                const cookies = readFileSync(cookiesPath).toString();
                const cookies_parsed = JSON.parse(cookies);
                await this.page.setCookie(...cookies_parsed);
                this.log('Cookies loaded successfully');
            } catch (error) {
                this.log('Error loading cookies, continuing without them');
            }
        }

        // Handle browser disconnect
        this.browser.once('disconnected', () => {
            this.log('Browser disconnected');
            this.browser = null;
            this.page = null;
            this.initialized = false;
            this.browserReady = false;
            this.authorized = false;
        });

        await this.checkAuthorization();
    }

        async checkAuthorization() {
        try {
            // Prevent multiple authorization attempts
            if (this.isAuthorizing) {
                this.log('Authorization already in progress, skipping...');
                return;
            }

            if (!this.page || this.page.isClosed()) {
                this.log('Page is closed, recreating browser...');
                await this.createBrowser();
                return;
            }

            this.log('Checking authorization status...');
            
            await this.page.goto(`https://milkywayapp.xyz:8781/Store.aspx`, {
                waitUntil: 'domcontentloaded',
                timeout: 15000
            });

            // Wait a moment for any redirect
            await new Promise(resolve => setTimeout(resolve, 1500));

            const currentPath = await this.page.evaluate(() => location.pathname);
            this.log(`Landed on: ${currentPath}`);

            if (currentPath === '/default.aspx') {
                this.authorized = false;
                this.log('Redirected to login page - need to authorize');
                
                // Call authorize and wait for it to complete (including iframe wait)
                await this.authorize();
                return;
            } else {
                this.log('On Store.aspx, verifying iframe...');
                
                // Wait for iframe to be ready
                await this.page.waitForSelector('#frm_main_content', { timeout: 10000 });
                
                // Wait for iframe content to be accessible
                await this.page.waitForFunction(() => {
                    const iframe = document.querySelector('#frm_main_content');
                    if (!iframe) return false;
                    
                    try {
                        const iframe_document = iframe.contentWindow.document;
                        if (!iframe_document) return false;
                        
                        const hasContent = iframe_document.querySelector('#txtSearch') !== null;
                        return iframe_document.readyState === 'complete' && hasContent;
                    } catch (e) {
                        return false;
                    }
                }, { timeout: 10000 });
                
                this.log('Authorized - iframe ready');
                this.authorized = true;
                await new Promise(resolve => setTimeout(resolve, 1000));
                this.checkQueue();
                return true;
            }
        } catch (error) {
            this.error(`Error checking authorization: ${error.message}`);
            
            if (error.message.includes('detached Frame') || 
                error.message.includes('Target closed') ||
                error.message.includes('Session closed')) {
                this.log('Detected detached frame, recreating browser...');
                this.browserReady = false;
                this.initialized = false;
                await this.createBrowser();
                return;
            }
            
            // Only retry if not already authorizing
            if (!this.isAuthorizing) {
                setTimeout(() => this.checkAuthorization(), 5000);
            }
        }
    }

    async authorize() {
        if (this.authorizationInProgress) {
            this.log('Authorization already in progress, waiting...');
            if (this.authorizationPromise) {
                await this.authorizationPromise;
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 3000));
            return;
        }

        this.authorizationInProgress = true;
        this.isAuthorizing = true;
        
        this.authorizationPromise = (async () => {
            try {
                this.log('Starting authorization...');
                
                if (!this.page || this.page.isClosed()) {
                    this.log('Page is invalid, recreating browser...');
                    await this.createBrowser();
                    return;
                }

                await this.page.goto(`https://milkywayapp.xyz:8781/default.aspx`, {
                    waitUntil: 'domcontentloaded',
                    timeout: 15000
                });

                await Promise.all([
                    this.page.waitForSelector('#txtLoginName', { timeout: 10000 }),
                    this.page.waitForSelector('#txtLoginPass', { timeout: 10000 }),
                    this.page.waitForSelector('#txtVerifyCode', { timeout: 10000 }),
                    this.page.waitForSelector('#ImageCheck', { timeout: 10000 })
                ]);

                if (!this.agentCredentials) {
                    const credentialsLoaded = await this.loadAgentCredentials();
                    if (!credentialsLoaded) {
                        throw new Error('Cannot authorize without agent credentials');
                    }
                }

                this.log(`Using agent credentials: ${this.agentCredentials.username}`);
                
                // Clear and type credentials
                await this.page.evaluate(() => {
                    document.querySelector('#txtLoginName').value = '';
                    document.querySelector('#txtLoginPass').value = '';
                });
                
                await this.page.type('#txtLoginName', this.agentCredentials.username);
                await this.page.type('#txtLoginPass', this.agentCredentials.password);

                await this.page.waitForSelector('#ImageCheck', { timeout: 10000 });
                
                // Wait for captcha image to fully load
                await this.page.waitForFunction(() => {
                    const img = document.querySelector('#ImageCheck');
                    return img && img.complete && img.naturalHeight !== 0;
                }, { timeout: 10000 });

                await new Promise(resolve => setTimeout(resolve, 500));

                const base64Captcha = await this.page.evaluate(() => {
                    const img = document.querySelector('#ImageCheck');
                    if (!img || !img.complete || img.naturalHeight === 0) {
                        throw new Error('Captcha image not loaded');
                    }
                    
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth || 132;
                    canvas.height = img.naturalHeight || 40;
                    const context = canvas.getContext('2d');
                    context.drawImage(img, 0, 0);
                    return canvas.toDataURL("image/png").replace(/^data:image\/?[A-z]*;base64,/, "");
                });

                if (!base64Captcha || base64Captcha.length < 100) {
                    throw new Error('Failed to capture captcha image');
                }

                const captchaValue = await Captcha(base64Captcha, 5);
                
                if (!captchaValue) {
                    throw new Error('Failed to solve captcha');
                }
                
                this.log(`Captcha solved: ${captchaValue}`);
                
                await this.page.type('#txtVerifyCode', captchaValue);
                await this.page.click('#btnLogin');

                await new Promise(resolve => setTimeout(resolve, 2000));

                const error_message = await this.page.evaluate(() => {
                    const element = document.querySelector('#mb_con p');
                    if (!element) return false;
                    return element.innerText;
                });

                if (error_message) {
                    this.error(`Error while login: ${error_message}`);
                    throw new Error(`Login failed: ${error_message}`);
                }

                const is_authorized = await this.page.evaluate(() => {
                    return location.pathname === '/Store.aspx';
                });

                if (is_authorized) {
    this.authorized = true;
    this.log('Successfully authorized');
    await this.saveCookies();
    
    // ⭐ ADD THIS SECTION - Wait for iframe before calling checkQueue
    this.log('Waiting for Store.aspx iframe to be ready...');
    try {
        await this.page.waitForSelector('#frm_main_content', { timeout: 10000 });
        
        // Wait for iframe content to be accessible
        await this.page.waitForFunction(() => {
            const iframe = document.querySelector('#frm_main_content');
            if (!iframe) return false;
            
            try {
                const iframe_document = iframe.contentWindow.document;
                if (!iframe_document) return false;
                
                const hasContent = iframe_document.querySelector('#txtSearch') !== null;
                return iframe_document.readyState === 'complete' && hasContent;
            } catch (e) {
                return false;
            }
        }, { timeout: 10000 });
        
        this.log('Store.aspx iframe is fully loaded and ready');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
    } catch (iframeError) {
        this.error(`Iframe failed to load after authorization: ${iframeError.message}`);
    }
    
    // NOW it's safe to call checkQueue
    this.checkQueue();
} else {
                    this.log('Failed login - not redirected to Store.aspx');
                    throw new Error('Login failed - no redirect');
                }
                
            } catch (error) {
                this.error(`Error during authorization: ${error.message}`);
                this.authorized = false;
                
                if (error.message.includes('detached Frame') || 
                    error.message.includes('Target closed') ||
                    error.message.includes('Session closed')) {
                    this.log('Browser session lost, recreating...');
                    this.browserReady = false;
                    this.initialized = false;
                    setTimeout(async () => {
                        await this.createBrowser();
                    }, 5000);
                    return;
                }
                
                // Retry authorization
                setTimeout(() => this.authorize(), 5000);
            } finally {
                this.authorizationInProgress = false;
                this.isAuthorizing = false;
                this.authorizationPromise = null;
            }
        })();

        await this.authorizationPromise;
    }

    async saveCookies() {
        try {
            const cookies = await this.page.cookies();
            const cookiesPath = path.join(__dirname, 'cookiesos.json');
            writeFileSync(cookiesPath, JSON.stringify(cookies, null, 4));
            this.log('Cookies saved successfully');
            return true;
        } catch (error) {
            this.error(`Error saving cookies: ${error.message}`);
            return false;
        }
    }

    async checkQueue() {
        try {
            const task = await Tasks.get('milkyway');

            if (!task) {
                return setTimeout(this.checkQueue.bind(this), 1000);
            }

            console.log('Processing task:', task);

            let task_result = null;

            switch (task.type) {
                case 'download_code':
                    task_result = await this.getDownloadCode(task);
                    break;
                case 'get_balance':
                    task_result = await this.getBalance(task);
                    break;
                case 'get_admin_balance':
                    task_result = await this.getBalanceAdmin(task);
                    break;
                case 'recharge':
                    task_result = await this.recharge(task);
                    break;
                case 'redeem':
                    task_result = await this.redeem(task);
                    break;
                case 'create':
                    task_result = await this.createAccount(task);
                    break;
                case 'reset':
                    task_result = await this.resetPassword(task);
                    break;
                default:
                    this.error(`Unknown task type: ${task.type}`);
            }

            if (task_result === -1) {
                return;
            }

            return setTimeout(this.checkQueue.bind(this), 5000);
        } catch (error) {
            this.error(`Error in checkQueue: ${error.message}`);
            setTimeout(this.checkQueue.bind(this), 5000);
        }
    }

    // ========================================
    // API METHODS WITH QUEUE
    // ========================================

    async createGameAccount(userId, game) {
        return await this.queueOperation('createGameAccount', async () => {
            try {
                const generateRandomString = () => {
                    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
                    let result = '';
                    for (let i = 0; i < 4; i++) {
                        result += chars.charAt(Math.floor(Math.random() * chars.length));
                    }
                    return result;
                };
                
                const login = `bc${generateRandomString()}_${generateRandomString()}`;
                const password = `bc${generateRandomString()}_${generateRandomString()}`;

                console.log(`Generated credentials for API - Login: ${login}, Password: ${password}`);

                const gameAccount = new GameAccount({
                    userId,
                    gameId: game._id,
                    gameLogin: login,
                    gamePassword: password,
                    status: 'pending',
                    metadata: {
                        createdVia: 'api'
                    }
                });

                await gameAccount.save();

                const task = {
                    id: gameAccount._id.toString(),
                    type: 'create',
                    userId
                };

                const result = await this.createAccount(task);

                if (result && result.success) {
                    gameAccount.status = 'active';
                    gameAccount.gameLogin = result.login;
                    gameAccount.gamePassword = result.password;
                    
                    if (!gameAccount.metadata) {
                        gameAccount.metadata = {};
                    }
                    gameAccount.metadata.login = result.login;
                    gameAccount.metadata.password = result.password;
                    
                    await gameAccount.save();

                    return {
                        success: true,
                        data: {
                            _id: gameAccount._id,
                            gameLogin: result.login,
                            gamePassword: result.password,
                            gameType: gameAccount.gameType,
                            status: gameAccount.status
                        },
                        message: 'Game account created successfully'
                    };
                } else {
                    gameAccount.status = 'failed';
                    if (result && result.message) {
                        if (!gameAccount.metadata) {
                            gameAccount.metadata = {};
                        }
                        gameAccount.metadata.notes = result.message;
                    }
                    await gameAccount.save();
                    throw new Error(result ? result.message : 'Failed to create game account');
                }

            } catch (error) {
                this.error(`Error creating game account: ${error.message}`);
                throw error;
            }
        });
    }

    async getGameBalance(userId, gameLogin) {
        return await this.queueOperation(`getBalance:${gameLogin}`, async () => {
            console.log('=== getGameBalance (Queued) ===');
            console.log('userId:', userId);
            console.log('gameLogin:', gameLogin);
            
            try {
                const gameAccount = await GameAccount.findOne({
                    userId,
                    gameLogin,
                    gameType: this.gameType
                }).sort({ createdAt: -1 });

                if (!gameAccount) {
                    throw new Error('Game account not found');
                }

                const task = {
                    id: gameAccount._id.toString(),
                    login: gameLogin
                };

                const balance = await this.getBalance(task);

                if (balance !== null && balance !== false && balance !== -1) {
                    await gameAccount.updateBalance(balance);

                    return {
                        success: true,
                        data: {
                            gameLogin,
                            balance,
                            lastCheck: new Date(),
                            accountId: gameAccount._id
                        }
                    };
                } else {
                    return {
                        success: false,
                        data: null,
                        message: 'Failed to retrieve balance from game server'
                    };
                }

            } catch (error) {
                this.error(`Error getting balance: ${error.message}`);
                return {
                    success: false,
                    data: null,
                    message: error.message
                };
            }
        });
    }

    async rechargeAccount(userId, gameLogin, totalAmount, baseAmount, remark = 'API Recharge') {
    return await this.queueOperation(`recharge:${gameLogin}:${totalAmount}`, async () => {
        try {
            console.log("Recharge (Queued) - Finding game account...");
            console.log(`Base Amount: $${baseAmount}, Total Amount (with bonus): $${totalAmount}`);
            
            const gameAccount = await GameAccount.findOne({
                userId,
                gameLogin,
                gameType: this.gameType
            });

            if (!gameAccount) {
                throw new Error('Game account not found');
            }

            // ✅ CREATE TRANSACTION with BASE amount (what user paid)
            const transaction = {
                type: 'recharge',
                amount: baseAmount, // ✅ Record only the base amount user paid
                remark,
                status: 'pending',
                metadata: {
                    baseAmount: baseAmount,
                    bonusAmount: totalAmount - baseAmount,
                    totalAmount: totalAmount,
                    note: 'Includes 10% bonus'
                }
            };

            await gameAccount.addTransaction(transaction);
            const transactionId = gameAccount.transactions[gameAccount.transactions.length - 1]._id;
            console.log(`✅ Transaction created: ${transactionId} with base amount: $${baseAmount}`);

            // ✅ CREATE TASK with TOTAL amount (to recharge in game)
            const task = {
                id: transactionId.toString(),
                login: gameLogin,
                amount: totalAmount, // ✅ Recharge the TOTAL amount (with bonus) in game
                remark,
                is_manual: false
            };

            console.log(`Calling recharge with total amount: $${totalAmount}`);
            const result = await this.recharge(task);

            if (result && result !== -1) {
                const updatedGameAccount = await GameAccount.findById(gameAccount._id);
                
                console.log(`✅ Recharge successful`);
                console.log(`   - User paid: $${baseAmount}`);
                console.log(`   - Bonus: $${totalAmount - baseAmount}`);
                console.log(`   - Total recharged in game: $${totalAmount}`);
                console.log(`   - New balance: $${updatedGameAccount.balance}`);
                
                return {
                    success: true,
                    data: {
                        transactionId,
                        newBalance: updatedGameAccount.balance,
                        baseAmount: baseAmount,
                        bonusAmount: totalAmount - baseAmount,
                        totalAmount: totalAmount
                    },
                    message: 'Recharge completed successfully'
                };
            } else {
                throw new Error('Recharge failed');
            }

        } catch (error) {
            this.error(`Error processing recharge: ${error.message}`);
            throw error;
        }
    });
}

    async redeemFromAccount(userId, gameLogin, totalAmount, cashoutAmount, remark = 'API Redeem') {
    return await this.queueOperation(`redeem:${gameLogin}:${cashoutAmount}`, async () => {
        try {
            console.log('🔵 redeemFromAccount START:', { userId, gameLogin, totalAmount, cashoutAmount, remark });
            
            const gameAccount = await GameAccount.findOne({
                userId,
                gameLogin,
                gameType: this.gameType
            });

            if (!gameAccount) {
                console.log('❌ Game account not found in database');
                throw new Error('Game account not found');
            }
            console.log('✅ Game account found:', gameAccount._id);

            if (gameAccount.balance < totalAmount) {
                console.log(`❌ Insufficient balance: Has ${gameAccount.balance}, needs ${totalAmount}`);
                throw new Error('Insufficient balance');
            }
            console.log('✅ Balance sufficient');

            // ❌ REMOVED: Don't create transaction here
            // The gameController already created it

            const task = {
                id: null, // We don't have a transaction ID yet since gameController created it
                login: gameLogin,
                amount: totalAmount, // Full amount to redeem from game
                remark,
                is_manual: true
            };

            console.log('Calling redeem with task:', task);
            const result = await this.redeem(task);
            console.log('Redeem result:', result);

            if (result && result !== -1) {
                console.log('✅ Redeem successful, fetching updated balance...');
                const updatedGameAccount = await GameAccount.findById(gameAccount._id);
                
                return {
                    success: true,
                    data: {
                        newBalance: updatedGameAccount.balance
                    },
                    message: 'Redeem completed successfully'
                };
            } else {
                console.log('❌ Redeem returned false or -1');
                throw new Error('Redeem failed');
            }

        } catch (error) {
            console.log('❌ redeemFromAccount ERROR:', error.message);
            this.error(`Error processing redeem: ${error.message}`);
            throw error;
        }
    });
}

    async getDownloadCodeForUser(userId, gameLogin) {
        return await this.queueOperation(`downloadCode:${gameLogin}`, async () => {
            try {
                const gameAccount = await GameAccount.findOne({
                    userId,
                    gameLogin,
                    gameType: this.gameType
                });

                if (!gameAccount) {
                    return {
                        success: false,
                        data: null,
                        message: 'Game account not found'
                    };
                }

                const task = {
                    id: gameAccount._id.toString()
                };

                const code = await this.getDownloadCode(task);

                if (code && code !== -1) {
                    gameAccount.downloadCode = code;
                    await gameAccount.save();

                    return {
                        success: true,
                        data: { downloadCode: code },
                        message: 'Download code retrieved successfully'
                    };
                } else {
                    return {
                        success: false,
                        data: null,
                        message: 'Failed to get download code'
                    };
                }

            } catch (error) {
                this.error(`Error getting download code: ${error.message}`);
                return {
                    success: false,
                    data: null,
                    message: error.message || 'Error retrieving download code'
                };
            }
        });
    }

    async resetAccountPassword(userId, gameLogin, newPassword) {
        return await this.queueOperation(`resetPassword:${gameLogin}`, async () => {
            try {
                const gameAccount = await GameAccount.findOne({
                    userId,
                    gameLogin,
                    gameType: this.gameType
                });

                if (!gameAccount) {
                    return {
                        success: false,
                        message: 'Game account not found'
                    };
                }

                const task = {
                    id: gameAccount._id.toString(),
                    type: 'reset',
                    login: gameLogin,
                    password: newPassword,
                    userId
                };

                const result = await this.resetPassword(task);

                if (result && result !== -1) {
                    gameAccount.gamePassword = newPassword;
                    await gameAccount.save();

                    return {
                        success: true,
                        data: {
                            gameLogin: gameLogin,
                            message: 'Password reset successfully'
                        },
                        message: 'Password reset completed successfully'
                    };
                } else {
                    return {
                        success: false,
                        message: 'Password reset failed'
                    };
                }

            } catch (error) {
                this.error(`Error resetting password: ${error.message}`);
                return {
                    success: false,
                    message: error.message || 'Error resetting password'
                };
            }
        });
    }

    async getAdminBalance() {
        return await this.queueOperation('getAdminBalance', async () => {
            // Check cache first
            if (this.cache.adminBalance !== null && 
                this.cache.adminBalanceTimestamp && 
                Date.now() - this.cache.adminBalanceTimestamp < this.cache.cacheDuration) {
                this.log(`Returning cached admin balance: $${this.cache.adminBalance}`);
                return this.cache.adminBalance;
            }
            
            const balance = await this._getAdminBalanceCore();
            
            // Update cache on success
            if (balance !== false && balance !== -1 && balance !== null) {
                this.cache.adminBalance = balance;
                this.cache.adminBalanceTimestamp = Date.now();
            }
            
            return balance;
        });
    }

    async _getAdminBalanceCore() {
        try {
            // Ensure we're on the right page
            const currentPath = await this.page.evaluate(() => location.pathname);
            if (currentPath !== '/Store.aspx') {
                await this.page.goto('https://milkywayapp.xyz:8781/Store.aspx', { 
                    waitUntil: 'domcontentloaded',
                    timeout: 10000 
                });
                await new Promise(resolve => setTimeout(resolve, 2000));
            }

            // Check for session timeout
            const need_login = await this.page.evaluate(() => {
                const login_pathname = location.pathname === '/default.aspx';
                if (login_pathname) return true;
                const msg = document.querySelector('#mb_con p');
                return msg ? msg.innerText.indexOf('Session timeout. Please login again.') >= 0 : false;
            });

            if (need_login) {
                this.log('Session timeout detected, re-authorizing...');
                this.authorized = false;
                await this.authorize();
                return -1;
            }

            await this.page.waitForSelector('#UserBalance', { timeout: 10000 });

            const balance = await this.page.evaluate(() => {
                const el = document.querySelector('#UserBalance');
                if (!el) return null;
                const txt = el.innerText || el.textContent || '';
                const m = txt.match(/([0-9][0-9,]*\.?[0-9]*)/);
                if (!m) return null;
                return parseFloat(m[1].replace(/,/g, ''));
            });

            if (balance == null || Number.isNaN(balance)) {
                this.error('Admin balance: could not parse #UserBalance');
                return false;
            }

            this.log(`Current admin balance: $${balance}`);
            return balance;
        } catch (error) {
            this.error(`Error getting admin balance: ${error.message}`);
            
            // Handle session errors
            if (error.message.includes('Session closed') || 
                error.message.includes('Target closed')) {
                this.browserReady = false;
                this.initialized = false;
                await this.reinitialize();
                return -1;
            }
            
            return false;
        }
    }

    // ========================================
    // CORE OPERATION METHODS (WITH FIXES)
    // ========================================

    async getBalance({ id, login }) {
        console.log('getBalance called with:', id, login);
        
        try {
            // Ensure browser is ready
            await this.ensureBrowserReady();
            
            const currentPath = await this.page.evaluate(() => location.pathname);
            console.log('Current path:', currentPath);
            
            if (currentPath !== '/Store.aspx') {
                console.log('Not on Store.aspx, navigating...');
                await this.page.goto('https://milkywayapp.xyz:8781/Store.aspx', {
                    waitUntil: 'networkidle2',
                    timeout: 15000
                });
                
                await this.page.waitForSelector('#frm_main_content', { timeout: 10000 });
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            // Check for session timeout
            const needLogin = await this.page.evaluate(() => {
                return location.pathname === '/default.aspx';
            });
            
            if (needLogin) {
                console.log('Need to login');
                this.authorized = false;
                await this.authorize();
                return -1;
            }
            
            // Verify iframe is accessible
            console.log('Checking iframe accessibility...');
            const iframeAccessible = await this.isIframeAccessible('#frm_main_content');
            
            if (!iframeAccessible) {
                console.log('Iframe not accessible, waiting and retrying...');
                await new Promise(resolve => setTimeout(resolve, 3000));
                
                const stillNotAccessible = await this.isIframeAccessible('#frm_main_content');
                if (stillNotAccessible) {
                    console.log('Iframe still not accessible, reloading...');
                    await this.page.reload({ waitUntil: 'networkidle2' });
                    await this.page.waitForSelector('#frm_main_content', { timeout: 10000 });
                    await new Promise(resolve => setTimeout(resolve, 3000));
                }
            }
            
            console.log('Searching for account:', login);
            
            await this.page.evaluate(login => {
                const iframe = document.querySelector('#frm_main_content');
                const iframe_document = iframe.contentWindow.document;
                const searchBox = iframe_document.querySelector('#txtSearch');
                
                searchBox.value = '';
                searchBox.value = login;
                
                iframe_document.querySelectorAll('#content a')[0].click();
            }, login);
            
            console.log('Search initiated, waiting for results...');
            
            await this.page.waitForFunction((login) => {
                try {
                    const iframe = document.querySelector('#frm_main_content');
                    if (!iframe) return false;
                    const iframe_document = iframe.contentWindow.document;
                    const items = iframe_document.querySelectorAll('#item tr');
                    
                    if (items.length < 2) return false;
                    
                    for (let i = 1; i < items.length; i++) {
                        const tds = items[i].querySelectorAll('td');
                        if (tds.length > 2) {
                            const accountName = tds[2].innerText.trim().toLowerCase();
                            if (accountName === login.toLowerCase()) {
                                return true;
                            }
                        }
                    }
                    return false;
                } catch (e) {
                    return false;
                }
            }, { timeout: 8000 }, login);
            
            console.log('Search results appeared');
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const login_selected = await this.page.evaluate(login => {
                const iframe = document.querySelector('#frm_main_content');
                const iframe_document = iframe.contentWindow.document;
                const items = iframe_document.querySelectorAll('#item tr');
                
                console.log('Found', items.length, 'rows in search results');
                
                if (items.length < 2) {
                    console.log('No results found');
                    return false;
                }
                
                let matchingRows = [];
                
                for (let i = 1; i < items.length; i++) {
                    const tds = items[i].querySelectorAll('td');
                    if (tds.length > 2) {
                        const accountName = tds[2].innerText.trim().toLowerCase();
                        if (accountName === login.toLowerCase()) {
                            matchingRows.push(i);
                        }
                    }
                }
                
                console.log('Found', matchingRows.length, 'matching rows');
                
                if (matchingRows.length === 0) {
                    return false;
                }
                
                const latestRowIndex = matchingRows[matchingRows.length - 1];
                const latestRow = items[latestRowIndex];
                const tds = latestRow.querySelectorAll('td');
                
                console.log('Clicking on row', latestRowIndex);
                tds[0].querySelector('a').click();
                return true;
            }, login);
            
            console.log('Account selection result:', login_selected);
            
            if (!login_selected) {
                this.error(`Error while getting balance: login ${login} not found!`);
                await Tasks.error(id, 'login not found');
                return false;
            }
            
            console.log('Waiting for account details to load...');
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const balance = await this.page.evaluate(() => {
                try {
                    const iframe = document.querySelector('#frm_main_content');
                    const iframe_document = iframe.contentWindow.document;
                    const balance_element = iframe_document.querySelector('#txtBalance');
                    
                    if (!balance_element) {
                        return false;
                    }
                    
                    const balanceText = balance_element.value || balance_element.innerText || balance_element.textContent;
                    const balanceValue = parseFloat(balanceText);
                    
                    return isNaN(balanceValue) ? false : balanceValue;
                } catch (e) {
                    return false;
                }
            });
            
            console.log('Balance retrieved:', balance);
            
            if (balance === false) {
                this.error(`Could not find balance element for login ${login}`);
                await Tasks.error(id, 'balance element not found');
                return false;
            }
            
            this.log(`Current balance for ${login}: ${balance}`);
            
            // Update database
            try {
                const gameAccount = await GameAccount.findOne({ gameLogin: login });
                if (gameAccount) {
                    await gameAccount.updateBalance(balance);
                }
            } catch (dbError) {
                this.error(`Error updating balance in DB: ${dbError.message}`);
            }
            
            await Tasks.approve(id, balance);
            
            console.log('Navigating back to store main page...');
            await this.page.goto('https://milkywayapp.xyz:8781/Store.aspx', {
                waitUntil: 'networkidle2',
                timeout: 10000
            });
            
            await this.page.waitForSelector('#frm_main_content', { timeout: 10000 });
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            console.log('Back on main store page, ready for next operation');
            
            return balance;
            
        } catch (error) {
            console.error('Error during get balance:', error.message);
            this.error(`Error during get balance: ${error.message}`);
            
            // Handle session errors
            if (error.message.includes('Session closed') || 
                error.message.includes('Target closed') ||
                error.message.includes('detached Frame')) {
                this.browserReady = false;
                this.initialized = false;
                await this.reinitialize();
                return -1;
            }
            
            // Try to navigate back to store
            try {
                await this.page.goto('https://milkywayapp.xyz:8781/Store.aspx', {
                    waitUntil: 'networkidle2',
                    timeout: 10000
                });
            } catch (navError) {
                console.error('Failed to navigate back to store:', navError.message);
            }
            
            return false;
        }
    }

    async getDownloadCode(task) {
        try {
            // Ensure browser is ready
            await this.ensureBrowserReady();
            
            const need_login = await this.page.evaluate(() => {
                const msg = document.querySelector('#mb_con p');
                return msg ? msg.innerText.indexOf('Session timeout. Please login again.') >= 0 : false;
            });

            if (need_login) {
                this.authorized = false;
                await this.authorize();
                return -1;
            }

            await this.page.goto('https://milkywayapp.xyz:8781/IphoneCode.aspx', {
                waitUntil: 'domcontentloaded',
                timeout: 10000
            });
            await new Promise(resolve => setTimeout(resolve, 1000));

            const code = await this.page.evaluate(() => {
                const codeEl = document.querySelector("#IphoneCodeTex");
                return codeEl ? codeEl.innerText : null;
            });

            if (!code) {
                this.error('Download code element not found');
                return false;
            }

            this.log(`Download code: ${code}`);

            // Update database
            try {
                const gameAccount = await GameAccount.findById(task.id);
                if (gameAccount) {
                    gameAccount.downloadCode = code;
                    await gameAccount.save();
                }
            } catch (error) {
                this.error(`Error saving download code to DB: ${error.message}`);
            }

            await Tasks.approve(task.id, code);
            
            // Navigate back
            await this.page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });

            return code;
        } catch (error) {
            this.error(`Error getting download code: ${error.message}`);
            
            // Handle session errors
            if (error.message.includes('Session closed') || 
                error.message.includes('Target closed')) {
                this.browserReady = false;
                this.initialized = false;
                await this.reinitialize();
                return -1;
            }
            
            return false;
        }
    }

    async createAccount({ id, userId }) {
    console.log('🔴 CREATE ACCOUNT START:', { id, userId });
    
    try {
        // Ensure browser is ready
        await this.ensureBrowserReady();
        
        // Generate credentials
        const generateRandomString = () => {
            const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
            let result = '';
            for (let i = 0; i < 4; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return result;
        };
        
        const login = `bc${generateRandomString()}_${generateRandomString()}`;
        const password = `bc${generateRandomString()}_${generateRandomString()}`;
        
        console.log(`Generated credentials - Login: ${login}, Password: ${password}`);

        // Step 1: Check page state
        console.log('Step 1: Checking page state...');
        const currentPath = await this.page.evaluate(() => location.pathname);
        console.log('Current path:', currentPath);
        
        if (currentPath === '/default.aspx') {
            console.log('Need to authorize, returning -1');
            this.authorized = false;
            await this.authorize();
            return -1;
        }
        console.log('✅ On correct page');

        // Step 2: Wait for main iframe to be ready
        console.log('Step 2: Waiting for main iframe to be ready...');
        await this.page.waitForSelector('#frm_main_content', { timeout: 10000 });
        
        // Wait for iframe to be fully accessible
        await this.page.waitForFunction(() => {
            const iframe = document.querySelector('#frm_main_content');
            if (!iframe) return false;
            
            try {
                const iframe_document = iframe.contentWindow.document;
                if (!iframe_document) return false;
                
                const hasContent = iframe_document.querySelector('#txtSearch') !== null;
                return iframe_document.readyState === 'complete' && hasContent;
            } catch (e) {
                return false;
            }
        }, { timeout: 15000 });
        
        console.log('✅ Main iframe ready');
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Step 3: Verify iframe is accessible
        console.log('Step 3: Verifying iframe accessibility...');
        const iframeAccessible = await this.isIframeAccessible('#frm_main_content');
        
        if (!iframeAccessible) {
            console.log('⚠️  Iframe not fully accessible, waiting 2 more seconds...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            const stillNotAccessible = await this.isIframeAccessible('#frm_main_content');
            if (!stillNotAccessible) {
                throw new Error('Main iframe not accessible after retries');
            }
        }
        console.log('✅ Iframe verified accessible');

        // Step 4: Click "Add Account" button
        console.log('Step 4: Clicking Add Account button...');
        await this.page.evaluate(() => {
            const iframe = document.querySelector('#frm_main_content');
            const iframe_document = iframe.contentWindow.document;
            const buttons = iframe_document.querySelectorAll('#content a');
            console.log('Found buttons:', buttons.length);
            console.log('Clicking button index 1 (Add Account)');
            buttons[1].click();
        });
        console.log('✅ Add Account button clicked');

        // Step 5: Wait for dialog to appear
        console.log('Step 5: Waiting for account creation dialog...');
        await this.page.waitForSelector('#DialogBySHF iframe', { timeout: 15000 });
        console.log('✅ Dialog selector found');
        
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Step 6: Verify dialog iframe is accessible
        console.log('Step 6: Verifying dialog iframe accessibility...');
        await this.page.waitForFunction(() => {
            const iframe = document.querySelector('#DialogBySHF iframe');
            if (!iframe) return false;
            
            try {
                const iframe_document = iframe.contentWindow.document;
                if (!iframe_document) return false;
                
                const accountInput = iframe_document.querySelector('#txtAccount');
                const nickNameInput = iframe_document.querySelector('#txtNickName');
                const passInput = iframe_document.querySelector('#txtLogonPass');
                const pass2Input = iframe_document.querySelector('#txtLogonPass2');
                const button = iframe_document.querySelector('a');
                
                console.log('Form elements found:', {
                    account: !!accountInput,
                    nickname: !!nickNameInput,
                    password: !!passInput,
                    password2: !!pass2Input,
                    button: !!button
                });
                
                return accountInput && nickNameInput && passInput && pass2Input && button;
            } catch (e) {
                console.log('Error checking dialog iframe:', e.message);
                return false;
            }
        }, { timeout: 10000 });
        
        console.log('✅ Dialog iframe verified and form elements ready');
        await new Promise(resolve => setTimeout(resolve, 500));

        // Step 7: Fill account creation form
        console.log('Step 7: Filling account creation form...');
        const formFilled = await this.page.evaluate(({ login, password }) => {
            try {
                const iframe = document.querySelector('#DialogBySHF iframe');
                if (!iframe) {
                    console.log('Dialog iframe not found');
                    return false;
                }
                
                const iframe_document = iframe.contentWindow.document;
                
                const accountInput = iframe_document.querySelector('#txtAccount');
                const nickNameInput = iframe_document.querySelector('#txtNickName');
                const passInput = iframe_document.querySelector('#txtLogonPass');
                const pass2Input = iframe_document.querySelector('#txtLogonPass2');
                const button = iframe_document.querySelector('a');
                
                if (!accountInput || !nickNameInput || !passInput || !pass2Input || !button) {
                    console.log('Some form elements not found');
                    return false;
                }
                
                console.log('Setting account:', login);
                accountInput.value = login;
                
                console.log('Setting nickname:', login);
                nickNameInput.value = login;
                
                console.log('Setting password');
                passInput.value = password;
                pass2Input.value = password;
                
                console.log('Clicking submit button');
                button.click();
                
                return true;
            } catch (e) {
                console.log('Error filling form:', e.message);
                return false;
            }
        }, { login, password });

        if (!formFilled) {
            throw new Error('Failed to fill account creation form');
        }
        console.log('✅ Form filled and submitted');

        // Step 8: Wait for result message
        console.log('Step 8: Waiting for result message...');
        await this.page.waitForSelector('#mb_con p', { timeout: 30000 });
        
        const message = await this.page.evaluate(() => {
            const msgEl = document.querySelector('#mb_con p');
            return msgEl ? msgEl.innerText : 'No message found';
        });
        
        console.log('Result message:', message);

        // Step 9: Close dialogs
        console.log('Step 9: Closing dialogs...');
        await this.page.click("#mb_btn_ok");
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Try to close the dialog
        try {
            const closeButton = await this.page.$('#Close');
            if (closeButton) {
                await this.page.click('#Close');
                console.log('✅ Dialog closed');
            }
        } catch (e) {
            console.log('No close button found or already closed');
        }
        
        await new Promise(resolve => setTimeout(resolve, 500));

        // Step 10: Process result
        console.log('Step 10: Processing result...');
        const successMessages = [
            "Added successfully",
            "Users added successfully, but failed to obtain the game ID number, the system will assign you later!"
        ];

        if (successMessages.includes(message)) {
            console.log('✅ SUCCESS! Account created');
            this.log(`New account created ${login}:${password}`);

            // Update database
            try {
                const gameAccount = await GameAccount.findById(id);
                if (gameAccount) {
                    gameAccount.status = 'active';
                    gameAccount.gameLogin = login;
                    gameAccount.gamePassword = password;
                    
                    if (!gameAccount.metadata) {
                        gameAccount.metadata = {};
                    }
                    gameAccount.metadata.login = login;
                    gameAccount.metadata.password = password;
                    await gameAccount.save();
                    console.log('✅ Database updated');
                }
            } catch (error) {
                console.log('DB update error:', error.message);
                this.error(`Error updating account status in DB: ${error.message}`);
            }

            await Tasks.approve(id);
            
            console.log('✅ CREATE ACCOUNT COMPLETE');
            return {
                success: true,
                login: login,
                password: password
            };
            
        } else {
            console.log('❌ Account creation failed:', message);
            this.error(`Error while creating account: ${message}`);

            // Update database with failure
            try {
                const gameAccount = await GameAccount.findById(id);
                if (gameAccount) {
                    gameAccount.status = 'failed';
                    if (!gameAccount.metadata) {
                        gameAccount.metadata = {};
                    }
                    gameAccount.metadata.notes = message;
                    await gameAccount.save();
                    console.log('Database updated with failure status');
                }
            } catch (error) {
                console.log('DB update error:', error.message);
                this.error(`Error updating account status in DB: ${error.message}`);
            }

            await Tasks.error(id, message);
            return { success: false, message: message };
        }
        
    } catch (error) {
        console.log('❌ CREATE ACCOUNT ERROR:', error.message);
        console.log('Stack:', error.stack);
        this.error(`Error creating account: ${error.message}`);
        
        // Handle session errors
        if (error.message.includes('Session closed') || 
            error.message.includes('Target closed') ||
            error.message.includes('detached Frame')) {
            console.log('Session error detected, reinitializing...');
            this.browserReady = false;
            this.initialized = false;
            await this.reinitialize();
            return -1;
        }
        
        // Update database with failure
        try {
            const gameAccount = await GameAccount.findById(id);
            if (gameAccount) {
                gameAccount.status = 'failed';
                if (!gameAccount.metadata) {
                    gameAccount.metadata = {};
                }
                gameAccount.metadata.notes = error.message;
                await gameAccount.save();
            }
        } catch (dbError) {
            console.log('Failed to update DB with error:', dbError.message);
        }
        
        // Try to recover
        try {
            console.log('Attempting to navigate back to store...');
            await this.page.goto('https://milkywayapp.xyz:8781/Store.aspx', {
                waitUntil: 'networkidle2',
                timeout: 10000
            });
            console.log('Recovery navigation complete');
        } catch (navError) {
            console.log('Recovery failed:', navError.message);
        }
        
        return { success: false, message: error.message };
    }
}

    async recharge({ id, login, amount, remark, is_manual }) {
    console.log('🔴 RECHARGE START:', { id, login, amount, remark, is_manual });
    
    try {
        await this.ensureBrowserReady();
        
        const currentPath = await this.page.evaluate(() => location.pathname);
        
        if (currentPath === '/default.aspx') {
            this.authorized = false;
            await this.authorize();
            return -1;
        }

        // Check session errors
        const hasSessionError = await this.page.evaluate(() => {
            const msg = document.querySelector('#mb_con p');
            if (!msg) return false;
            const text = msg.innerText || msg.textContent;
            return text.includes('Session timeout') || text.includes('Please login again');
        });

        if (hasSessionError) {
            this.log('Session error detected, re-authorizing...');
            this.authorized = false;
            await this.authorize();
            return -1;
        }

        // Verify iframe is accessible
        const iframeAccessible = await this.isIframeAccessible('#frm_main_content');
        if (!iframeAccessible) {
            this.error('Iframe not accessible for recharge');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Search for account
        console.log('Searching for account:', login);
        await this.page.evaluate(login => {
            const iframe = document.querySelector('#frm_main_content');
            const iframe_document = iframe.contentWindow.document;
            iframe_document.querySelector('#txtSearch').value = login;
            iframe_document.querySelectorAll('#content a')[0].click();
        }, login);

        await this.page.waitForFunction((login) => {
            const iframe = document.querySelector('#frm_main_content');
            if (!iframe) return false;
            const iframe_document = iframe.contentWindow.document;
            const items = iframe_document.querySelectorAll('#item tr');
            return items.length >= 2;
        }, { timeout: 5000 }, login);

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Select account
        const login_selected = await this.page.evaluate(login => {
            const iframe = document.querySelector('#frm_main_content');
            const iframe_document = iframe.contentWindow.document;
            const items = iframe_document.querySelectorAll('#item tr');

            if (items.length < 2) return false;

            for (let i = 1; i < items.length; i++) {
                const tds = items[i].querySelectorAll('td');
                if (tds[2].innerText.trim().toLowerCase() === login.toLowerCase()) {
                    tds[0].querySelector('a').click();
                    return true;
                }
            }
            return false;
        }, login);

        if (!login_selected) {
            this.error(`Error while deposit: login ${login} not found!`);
            await Tasks.error(id, 'login not found');
            return false;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // ✅ OPTIMIZED: Click recharge button directly at index 1
        console.log('Clicking RECHARGE button (index 1)...');
        await this.page.evaluate(() => {
            const iframe = document.querySelector('#frm_main_content');
            const iframe_document = iframe.contentWindow.document;
            const links = iframe_document.querySelectorAll('.btn12');
            links[1].click(); // ✅ Direct click - Button[1] = Recharge
        });
        console.log('✅ Recharge button clicked');

        await this.page.waitForSelector('#Container iframe', { timeout: 10000 });
        
        // Wait for dialog to be fully ready
        await this.page.waitForFunction(() => {
            const iframe = document.querySelector('#Container iframe');
            if (!iframe) return false;
            
            try {
                const iframe_document = iframe.contentWindow.document;
                const balance_input = iframe_document.querySelector('#txtLeScore');
                const amount_input = iframe_document.querySelector('#txtAddGold');
                const remark_input = iframe_document.querySelector('#txtReason');
                const button = iframe_document.querySelector('#Button1');
                
                return balance_input && amount_input && remark_input && button;
            } catch (e) {
                return false;
            }
        }, { timeout: 10000 });
        
        await new Promise(resolve => setTimeout(resolve, 1500));

        // Read current balance
        const current_balance = await this.page.evaluate(() => {
            const iframe = document.querySelector('#Container iframe');
            const iframe_document = iframe.contentWindow.document;
            const balance_input = iframe_document.querySelector('#txtLeScore');

            if (!balance_input) return false;
            return parseInt(balance_input.value);
        });

        console.log('Player balance:', current_balance);

        if (current_balance >= 2) {
            this.error(`Could not deposit ${amount} to login ${login} (Balance more than $2 -> ${current_balance})`);
            
            if (is_manual) {
                await Tasks.cancel(id, ` balance is more than $2 (${current_balance})`);
            }
            
            await Tasks.error(id, `balance is more than $2 (${current_balance})`);
            return false;
        }

        // Fill form
        console.log('Filling recharge form...');
        const session_amount = await this.page.evaluate(({ amount, remark }) => {
            const iframe = document.querySelector('#Container iframe');
            const iframe_document = iframe.contentWindow.document;

            const amount_input = iframe_document.querySelector('#txtAddGold');
            const remark_input = iframe_document.querySelector('#txtReason');
            const button = iframe_document.querySelector('#Button1');

            if (!amount_input || !remark_input || !button) return false;

            const balance_input = iframe_document.querySelector('#txtLeScore');
            const session_amount = parseInt(balance_input.value) + amount;

            amount_input.value = '';
            amount_input.focus();
            amount_input.value = amount.toString();
            amount_input.dispatchEvent(new Event('input', { bubbles: true }));
            amount_input.dispatchEvent(new Event('change', { bubbles: true }));
            
            remark_input.value = '';
            remark_input.value = remark;
            
            button.click();

            return session_amount;
        }, { amount, remark });

        if (!session_amount) {
            await Tasks.error(id, `session amount doesn't exist`);
            return false;
        }

        console.log('Waiting for result...');
        await this.page.waitForSelector('#mb_con p', { timeout: 60000 });

        const result = await this.page.evaluate(() => {
            const closeButton = document.querySelector('#Close');
            if (closeButton) closeButton.click();
            return document.querySelector('#mb_con p').innerText;
        });

        console.log('Result:', result);
        await this.page.click("#mb_btn_ok");

        if (result === "Confirmed successful") {
            this.log(`Successfully deposit ${amount} to login ${login}`);
            
            try {
                const gameAccount = await GameAccount.findOne({ gameLogin: login });
                if (gameAccount) {
                    await gameAccount.updateBalance(session_amount, id);
                }
            } catch (dbError) {
                this.error(`Error updating balance in DB: ${dbError.message}`);
            }
            
            await Tasks.approve(id, session_amount);
            
            this.cache.adminBalance = null;
            this.cache.adminBalanceTimestamp = null;
            
            console.log('✅ RECHARGE SUCCESS');
            return true;
        } else {
            this.log(`Error while deposit ${amount} to login ${login}: ${result}`);
            await Tasks.error(id, `wrong message: ${result}`);
            return false;
        }

    } catch (error) {
        this.error(`Error during recharge: ${error.message}`);
        
        if (error.message.includes('Session closed') || 
            error.message.includes('Target closed')) {
            this.browserReady = false;
            this.initialized = false;
            await this.reinitialize();
            return -1;
        }
        
        return false;
    }
}

async redeem({ id, login, amount, remark, is_manual = false }) {
    console.log('🔴 REDEEM START:', { id, login, amount, remark, is_manual });
    
    try {
        await this.ensureBrowserReady();
        
        const currentPath = await this.page.evaluate(() => location.pathname);
        
        if (currentPath === '/default.aspx') {
            this.authorized = false;
            await this.authorize();
            return -1;
        }

        // Verify iframe is accessible
        const iframeAccessible = await this.isIframeAccessible('#frm_main_content');
        if (!iframeAccessible) {
            this.error('Iframe not accessible for redeem');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Search for account
        console.log('Searching for account:', login);
        await this.page.evaluate(login => {
            const iframe = document.querySelector('#frm_main_content');
            const iframe_document = iframe.contentWindow.document;

            const checkbox = iframe_document.querySelector('#ShowHideAccount_0');
            if (checkbox && !checkbox.checked) {
                checkbox.click();
            }

            iframe_document.querySelector('#txtSearch').value = login;
            iframe_document.querySelectorAll('#content a')[0].click();
        }, login);

        await this.page.waitForFunction((login) => {
            const iframe = document.querySelector('#frm_main_content');
            if (!iframe) return false;
            const iframe_document = iframe.contentWindow.document;
            const items = iframe_document.querySelectorAll('#item tr');
            return items.length >= 2;
        }, { timeout: 5000 }, login);

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Select account
        const login_selected = await this.page.evaluate(login => {
            const iframe = document.querySelector('#frm_main_content');
            const iframe_document = iframe.contentWindow.document;
            const items = iframe_document.querySelectorAll('#item tr');

            if (items.length < 2) return false;

            for (let i = 1; i < items.length; i++) {
                const tds = items[i].querySelectorAll('td');
                const accountName = tds[2].innerText.trim().toLowerCase();
                
                if (accountName === login.toLowerCase()) {
                    tds[0].querySelector('a').click();
                    return true;
                }
            }
            return false;
        }, login);

        if (!login_selected) {
            this.error(`Login ${login} not found in redeem`);
            await Tasks.error(id, 'login not found');
            return false;
        }

        await new Promise(resolve => setTimeout(resolve, 1000));

        // ✅ OPTIMIZED: Click redeem button directly at index 2
        console.log('Clicking REDEEM button (index 2)...');
        await this.page.evaluate(() => {
            const iframe = document.querySelector('#frm_main_content');
            const iframe_document = iframe.contentWindow.document;
            const links = iframe_document.querySelectorAll('.btn12');
            links[2].click(); // ✅ Direct click - Button[2] = Redeem
        });
        console.log('✅ Redeem button clicked');

        await this.page.waitForSelector('#Container iframe', { timeout: 10000 });
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Read current balance
        const current_balance = await this.page.evaluate(() => {
            const iframe = document.querySelector('#Container iframe');
            if (!iframe) return false;
            
            const iframe_document = iframe.contentWindow.document;
            const balance_input = iframe_document.querySelector('#txtLeScore');

            if (!balance_input) return false;
            
            return parseFloat(parseFloat(balance_input.value).toFixed(2));
        });

        console.log('Current balance:', current_balance);

        if (current_balance === false) {
            await Tasks.error(id, 'Could not read balance');
            return false;
        }

        // Validate balance
        if (!is_manual) {
            if (parseInt(current_balance) !== parseInt(amount)) {
                console.log(`Balance mismatch: Expected ${amount}, got ${current_balance}`);
                await Tasks.cancel(id, parseInt(current_balance));
                return true;
            }
        }

        if (is_manual) {
            if (parseInt(current_balance) < parseInt(amount)) {
                console.log(`Insufficient balance: Has ${current_balance}, needs ${amount}`);
                await Tasks.cancel(id, parseInt(current_balance));
                return true;
            }
        }

        // Fill form
        console.log('Filling redeem form...');
        const processed = await this.page.evaluate(({ amount, remark }) => {
            const iframe = document.querySelector('#Container iframe');
            if (!iframe) return false;
            
            const iframe_document = iframe.contentWindow.document;

            const amount_input = iframe_document.querySelector('#txtAddGold');
            const remark_input = iframe_document.querySelector('#txtReason');
            const button = iframe_document.querySelector('#Button1');

            if (!amount_input || !remark_input || !button) return false;

            amount_input.value = amount;
            remark_input.value = remark;
            button.click();

            return true;
        }, { amount, remark });

        if (!processed) {
            await Tasks.error(id, 'Failed to fill form');
            return false;
        }

        console.log('Waiting for result...');
        await this.page.waitForSelector('#mb_con p', { timeout: 30000 });

        const result = await this.page.evaluate(() => {
            const closeButton = document.querySelector('#Close');
            if (closeButton) closeButton.click();
            const messageEl = document.querySelector('#mb_con p');
            return messageEl ? messageEl.innerText : 'No message found';
        });

        console.log('Result:', result);
        await this.page.click("#mb_btn_ok");
        await new Promise(resolve => setTimeout(resolve, 500));

        if (result === "Confirmed successful") {
            const newBalance = parseFloat((current_balance - amount).toFixed(2));
            this.log(`Successfully cashout ${amount} from login ${login}`);
            
            try {
                const gameAccount = await GameAccount.findOne({ gameLogin: login });
                if (gameAccount) {
                    await gameAccount.updateBalance(newBalance, id);
                }
            } catch (dbError) {
                this.error(`Error updating balance in DB: ${dbError.message}`);
            }
            
            await Tasks.approve(id, newBalance);
            
            this.cache.adminBalance = null;
            this.cache.adminBalanceTimestamp = null;
            
            console.log('✅ REDEEM SUCCESS');
            return true;
            
        } else {
            if (result === "Sorry, there is not enough gold for the operator!") {
                await Tasks.cancel(id);
            }
            this.log(`Error while cashout ${amount} from login ${login}: ${result}`);
            await Tasks.error(id, result);
            return false;
        }

    } catch (error) {
        this.error(`Error during redeem: ${error.message}`);
        
        if (error.message.includes('Session closed') || 
            error.message.includes('Target closed') ||
            error.message.includes('detached Frame')) {
            this.browserReady = false;
            this.initialized = false;
            await this.reinitialize();
            return -1;
        }
        
        try {
            await this.page.goto('https://milkywayapp.xyz:8781/Store.aspx', {
                waitUntil: 'networkidle2',
                timeout: 10000
            });
        } catch (navError) {
            // Ignore
        }
        
        return false;
    }
}

async resetPassword({ id, login, password }) {
    console.log('🔴 RESET PASSWORD START:', { id, login, password: '***' });
    
    try {
        // Ensure browser is ready
        await this.ensureBrowserReady();
        
        // Step 1: Check page state
        console.log('Step 1: Checking page state...');
        const currentPath = await this.page.evaluate(() => location.pathname);
        console.log('Current path:', currentPath);
        
        if (currentPath === '/default.aspx') {
            console.log('Need to authorize, returning -1');
            this.authorized = false;
            await this.authorize();
            return -1;
        }

        // Verify iframe is accessible
        const iframeAccessible = await this.isIframeAccessible('#frm_main_content');
        if (!iframeAccessible) {
            this.error('Iframe not accessible for password reset');
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        // Step 2: Search for account
        console.log('Step 2: Searching for account...');
        await this.page.evaluate(login => {
            const iframe = document.querySelector('#frm_main_content');
            const iframe_document = iframe.contentWindow.document;

            const checkbox = iframe_document.querySelector('#ShowHideAccount_0');
            if (checkbox && !checkbox.checked) {
                console.log('Clicking checkbox to show hidden accounts');
                checkbox.click();
            }

            iframe_document.querySelector('#txtSearch').value = login;
            iframe_document.querySelectorAll('#content a')[0].click();
        }, login);

        // Step 3: Wait for search results
        console.log('Step 3: Waiting for search results...');
        await this.page.waitForFunction((login) => {
            const iframe = document.querySelector('#frm_main_content');
            if (!iframe) return false;
            const iframe_document = iframe.contentWindow.document;
            const items = iframe_document.querySelectorAll('#item tr');
            return items.length >= 2;
        }, { timeout: 5000 }, login);
        console.log('Search results loaded');

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 4: Select account
        console.log('Step 4: Selecting account...');
        const login_selected = await this.page.evaluate(login => {
            const iframe = document.querySelector('#frm_main_content');
            const iframe_document = iframe.contentWindow.document;
            const items = iframe_document.querySelectorAll('#item tr');

            console.log('Found rows:', items.length);

            if (items.length < 2) {
                console.log('No results found');
                return false;
            }

            for (let i = 1; i < items.length; i++) {
                const tds = items[i].querySelectorAll('td');
                const accountName = tds[2].innerText.trim().toLowerCase();
                console.log('Row', i, ':', accountName);
                
                if (accountName === login.toLowerCase()) {
                    console.log('Found match at row', i);
                    tds[0].querySelector('a').click();
                    return true;
                }
            }
            
            console.log('No matching account found');
            return false;
        }, login);

        if (!login_selected) {
            const errorMsg = `Login ${login} not found in password reset`;
            console.log('❌', errorMsg);
            this.error(errorMsg);
            await Tasks.error(id, 'login not found');
            return false;
        }
        console.log('✅ Account selected');

        await new Promise(resolve => setTimeout(resolve, 1000));

        // Step 5: Click reset password button directly
        console.log('Step 5: Clicking RESET PASSWORD button (index 1)...');
        await this.page.evaluate(() => {
            const iframe = document.querySelector('#frm_main_content');
            const iframe_document = iframe.contentWindow.document;
            const links = iframe_document.querySelectorAll('.btn13');
            links[1].click(); // ✅ Direct click - Button[1] = Reset Password
        });
        console.log('✅ Reset password button clicked');

        // Step 6: Wait for reset password dialog
        console.log('Step 6: Waiting for reset password dialog...');
        await this.page.waitForSelector('#Container iframe', { timeout: 10000 });
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('✅ Dialog opened');

        // Step 7: Wait for form elements to be ready inside iframe
        console.log('Step 7: Waiting for form elements to load...');
        await this.page.waitForFunction(() => {
            const iframe = document.querySelector('#Container iframe');
            if (!iframe) return false;
            
            try {
                const iframe_document = iframe.contentWindow.document;
                const new_password = iframe_document.querySelector('#txtConfirmPass');
                const confirm_password = iframe_document.querySelector('#txtSureConfirmPass');
                const button = iframe_document.querySelector('#Button1');
                
                console.log('Checking form elements:', {
                    new_password: !!new_password,
                    confirm_password: !!confirm_password,
                    button: !!button
                });
                
                return new_password && confirm_password && button;
            } catch (e) {
                console.log('Error accessing iframe:', e.message);
                return false;
            }
        }, { timeout: 10000 });

        console.log('✅ Form elements loaded');
        await new Promise(resolve => setTimeout(resolve, 500));

        // Step 8: Fill reset password form
        console.log('Step 8: Filling reset password form...');
        const processed = await this.page.evaluate(({ password }) => {
            const iframe = document.querySelector('#Container iframe');
            if (!iframe) {
                console.log('Container iframe not found');
                return false;
            }
            
            const iframe_document = iframe.contentWindow.document;

            const new_password = iframe_document.querySelector('#txtConfirmPass');
            const confirm_password = iframe_document.querySelector('#txtSureConfirmPass');
            const button = iframe_document.querySelector('#Button1');

            if (!new_password) {
                console.log('New password input not found');
                return false;
            }
            if (!confirm_password) {
                console.log('Confirm password input not found');
                return false;
            }
            if (!button) {
                console.log('Submit button not found');
                return false;
            }

            console.log('Setting new password');
            new_password.value = password;
            confirm_password.value = password;
            
            console.log('Clicking submit button');
            button.click();

            return true;
        }, { password });

        if (!processed) {
            const errorMsg = 'Failed to fill reset password form';
            console.log('❌', errorMsg);
            await Tasks.error(id, errorMsg);
            return false;
        }
        console.log('✅ Form submitted');

        // Step 9: Wait for result
        console.log('Step 9: Waiting for result message...');
        await this.page.waitForSelector('#mb_con p', { timeout: 30000 });

        const result = await this.page.evaluate(() => {
            const closeButton = document.querySelector('#Close');
            if (closeButton) closeButton.click();
            const messageEl = document.querySelector('#mb_con p');
            return messageEl ? messageEl.innerText : 'No message found';
        });

        console.log('Result message:', result);

        await this.page.click("#mb_btn_ok");
        await new Promise(resolve => setTimeout(resolve, 500));

        // Step 10: Process result
        console.log('Step 10: Processing result...');
        if (result === "Modified success!") {
            console.log('✅ SUCCESS! Password reset complete');
            this.log(`Password for login ${login} has been restored!`);
            
            // Update database
            try {
                const gameAccount = await GameAccount.findOne({ gameLogin: login });
                if (gameAccount) {
                    gameAccount.gamePassword = password;
                    await gameAccount.save();
                    console.log('Database updated with new password');
                }
            } catch (dbError) {
                console.log('DB update error:', dbError.message);
                this.error(`Error updating password in DB: ${dbError.message}`);
            }
            
            await Tasks.approve(id, password);
            
            console.log('✅ RESET PASSWORD COMPLETE');
            return true;
            
        } else {
            console.log('❌ Unexpected result:', result);
            this.log(`Error while reset password -> ${result}`);
            await Tasks.error(id, `password reset failed: ${result}`);
            return false;
        }

    } catch (error) {
        console.log('❌ RESET PASSWORD ERROR:', error.message);
        console.log('Stack:', error.stack);
        this.error(`Error during password reset: ${error.message}`);
        
        // Handle session errors
        if (error.message.includes('Session closed') || 
            error.message.includes('Target closed') ||
            error.message.includes('detached Frame')) {
            this.browserReady = false;
            this.initialized = false;
            await this.reinitialize();
            return -1;
        }
        
        // Try to recover
        try {
            console.log('Attempting to navigate back to store...');
            await this.page.goto('https://milkywayapp.xyz:8781/Store.aspx', {
                waitUntil: 'networkidle2',
                timeout: 10000
            });
            console.log('Recovery navigation complete');
        } catch (navError) {
            console.log('Recovery failed:', navError.message);
        }
        
        return false;
    }
}

    async getBalanceAdmin(task) {
        try {
            // Ensure browser is ready
            await this.ensureBrowserReady();
            
            const balance = await this.page.evaluate(() => {
                const el = document.querySelector('#UserBalance');
                if (!el) return null;
                const txt = el.innerText || el.textContent || '';
                const m = txt.match(/([0-9][0-9,]*\.?[0-9]*)/);
                if (!m) return null;
                return parseFloat(m[1].replace(/,/g, ''));
            });

            if (balance !== null && !isNaN(balance)) {
                this.log(`Current admin balance: ${balance}`);
                
                // Update cache
                this.cache.adminBalance = balance;
                this.cache.adminBalanceTimestamp = Date.now();
                
                await Tasks.approve(task.id, balance);
                return balance;
            }

            this.error('Could not retrieve admin balance');
            return false;
        } catch (error) {
            this.error(`Error in getBalanceAdmin: ${error.message}`);
            
            // Handle session errors
            if (error.message.includes('Session closed') || 
                error.message.includes('Target closed')) {
                this.browserReady = false;
                this.initialized = false;
                await this.reinitialize();
                return -1;
            }
            
            return false;
        }
    }
}

// Export singleton instance
const milkyWaysController = new MilkyWaysController();
module.exports = milkyWaysController;