// controllers/JuwaController.js - COMPLETE REWRITTEN FIXED VERSION
const Puppeteer = require('puppeteer');
const Captcha = require('../lib/captcha.js');
const { writeFileSync, readFileSync, existsSync, readdirSync, rmSync } = require('fs');
const Tasks = require('../lib/tasks.js');
const Logger = require('../utils/logger.js');
const GameAccount = require('../models/GameAccount.js');
const Game = require('../models/Game.js');
const path = require('path');
const axios = require('axios');

class JuwaController {
    constructor() {
        this.browser = null;
        this.page = null;
        this.cookies = null;
        this.authorized = false;
        this.logger = Logger('Juwa');
        this.gameType = 'juwa';
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

        // QUEUE SYSTEM
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.maxConcurrentRequests = 1;

        // INITIALIZATION STATE
        this.isInitializing = false;
        this.initializationPromise = null;
        this.browserReady = false;

        // AUTHORIZATION STATE
        this.isAuthorizing = false;
        this.authorizationPromise = null;
        this.authorizationInProgress = false;

        // SESSION MANAGEMENT
        this.sessionTimeout = null;
        this.lastSuccessfulOperation = Date.now();
        this.consecutiveErrors = 0;
        this.maxConsecutiveErrors = 3;

        this.loadAgentCredentials().catch(err => {
            this.error(`Failed to load credentials on startup: ${err.message}`);
        });

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
    // HTTP REQUEST HELPER
    // ========================================

    async makeRequest({ url, method, body }) {
        try {
            const sessionPath = path.join(__dirname, 'sessionjuwa.json');
            
            if (!existsSync(sessionPath)) {
                this.error('Session file not found. Need to login first.');
                return {
                    code: 401,
                    status: 401,
                    msg: 'Session not found'
                };
            }

            const buffer = readFileSync(sessionPath);
            const json = buffer.toString();
            const session_details = JSON.parse(json);

            if (!session_details.token) {
                this.error('No token found in session file');
                return {
                    code: 401,
                    status: 401,
                    msg: 'Token not found'
                };
            }

            // Parse the token (it's stored as a JSON string in sessionStorage)
            let token = session_details.token;
            try {
                token = JSON.parse(session_details.token);
            } catch (e) {
                // If it's already a string (not JSON), use it as-is
                token = session_details.token;
            }

            const response = await axios({
                url,
                method,
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                data: body,
                validateStatus: () => true
            });

            this.log(`${method} ${url} - Status: ${response.status}`);

            if (response.data) {
                return response.data;
            }

            return {
                code: response.status,
                status: response.status,
                msg: response.statusText || 'No response data'
            };

        } catch (error) {
            this.error(`Request error: ${error.message}`);
            
            if (error.response) {
                this.error(`Status: ${error.response.status}, Message: ${error.response.statusText}`);
                return {
                    code: error.response.status,
                    status: error.response.status,
                    msg: error.response.data?.msg || error.response.statusText
                };
            } else if (error.request) {
                this.error('No response received from server');
                return {
                    code: 500,
                    status: 500,
                    msg: 'No response from server'
                };
            } else {
                this.error(`Setup error: ${error.message}`);
                return {
                    code: 500,
                    status: 500,
                    msg: error.message
                };
            }
        }
    }

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
        }, 60000);
    }

    async reinitialize() {
        this.log('Reinitializing browser session...');
        this.initialized = false;
        this.browserReady = false;
        this.authorized = false;
        
        this.cache.adminBalance = null;
        this.cache.adminBalanceTimestamp = null;
        
        try {
            await this.initialize();
        } catch (error) {
            this.error(`Reinitialization failed: ${error.message}`);
        }
    }

    // ========================================
    // QUEUE SYSTEM IMPLEMENTATION
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
            
            if (this.isInitializing || this.isAuthorizing) {
                this.log('Browser is initializing or authorizing, queue will be processed after completion');
                return;
            }
            
            if (!this.isProcessingQueue && this.initialized && this.browserReady && this.authorized) {
                this.processQueue();
            } else if (!this.initialized || !this.browserReady) {
                this.log('Browser not ready, initializing...');
                this.initialize().catch(err => {
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

    if (!this.initialized || !this.browserReady || !this.authorized) {
        this.log(`Not ready to process queue yet (initialized: ${this.initialized}, browserReady: ${this.browserReady}, authorized: ${this.authorized})`);
        return;
    }

    // ⭐ ADD THIS CHECK - Prevent race condition
    if (this.requestQueue.length === 0) {
        this.log('Queue is empty, nothing to process');
        return;
    }
    
    this.isProcessingQueue = true;
    this.log('🚀 Queue processor started');
    
    while (this.requestQueue.length > 0) {
        const task = this.requestQueue.shift();
        const queueWaitTime = Date.now() - task.timestamp;
        this.log(`▶️  Processing: "${task.name}" (waited ${queueWaitTime}ms) | Remaining: ${this.requestQueue.length}`);
        
        try {
            await this.ensureBrowserReady();
            
            const startTime = Date.now();
            const result = await task.function();
            const executionTime = Date.now() - startTime;
            
            this.log(`✅ Completed: "${task.name}" in ${executionTime}ms`);
            this.lastSuccessfulOperation = Date.now();
            this.consecutiveErrors = 0;
            task.resolve(result);
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (error) {
            this.error(`❌ Failed: "${task.name}" - ${error.message}`);
            this.consecutiveErrors++;
            
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
        if (this.isInitializing && this.initializationPromise) {
            this.log('Waiting for initialization to complete...');
            await this.initializationPromise;
        }

        if (this.isAuthorizing && this.authorizationPromise) {
            this.log('Waiting for authorization to complete...');
            await this.authorizationPromise;
        }

        if (!this.browser || !this.page) {
            this.log('Browser or page missing, reinitializing...');
            await this.initialize();
            return;
        }

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

        if (!this.authorized) {
            this.log('Not authorized, waiting for authorization...');
            if (this.isAuthorizing && this.authorizationPromise) {
                await this.authorizationPromise;
            } else {
                await this.checkAuthorization();
            }
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

    // ========================================
    // CORE METHODS
    // ========================================

    async loadAgentCredentials() {
        try {
            const game = await Game.findOne({ 
                shortcode: 'JW', 
                status: { $in: ['active', 'maintenance'] } 
            });

            if (!game) {
                throw new Error('Juwa game not found in database');
            }

            if (!game.agentUsername || !game.agentPassword) {
                throw new Error('Agent credentials not configured for Juwa');
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
        if (this.initialized && this.browserReady && await this.isBrowserValid()) {
            this.lastActivity = Date.now();
            return;
        }

        if (this.isInitializing) {
            this.log('Initialization already in progress, waiting...');
            if (this.initializationPromise) {
                await this.initializationPromise;
                return;
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
            return this.initialize();
        }

        this.isInitializing = true;
        this.browserReady = false;

        try {
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
        this.log('Initializing browser for Juwa...');
        
        if (this.browser) {
            try {
                this.browser.removeAllListeners('disconnected');
                if (this.page) {
                    this.page.removeAllListeners('error');
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
                "--fast-start",
                "--disable-extensions",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu"
            ],
            ignoreHTTPSErrors: true
        });

        this.page = await this.browser.newPage();
        await this.page.setViewport({ width: 1312, height: 800 });

        const cookiesPath = path.join(__dirname, 'cookiesjuwa.json');
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

        this.page.on('error', (error) => {
            this.error(`Page crashed: ${error.message}`);
            this.browserReady = false;
            this.initialized = false;
        });

        this.page.on('close', () => {
            this.log('Page closed unexpectedly');
            this.browserReady = false;
            this.initialized = false;
        });

        this.browser.once('disconnected', () => {
            this.log('Browser disconnected');
            this.browser = null;
            this.page = null;
            this.initialized = false;
            this.browserReady = false;
            this.authorized = false;
        });

        this.browserReady = true;
        await this.checkAuthorization();
    }

    async checkAuthorization() {
        try {
            if (this.isAuthorizing) {
                this.log('Authorization already in progress, waiting...');
                if (this.authorizationPromise) {
                    await this.authorizationPromise;
                }
                return;
            }

            if (!this.page || this.page.isClosed()) {
                this.log('Page is closed, recreating browser...');
                await this.createBrowser();
                return;
            }

            this.log('Checking authorization status...');
            
            await this.page.goto('https://ht.juwa777.com/userManagement', {
                waitUntil: 'load',
                timeout: 15000
            });

            const sessionPath = path.join(__dirname, 'sessionjuwa.json');
            if (existsSync(sessionPath)) {
                try {
                    const session = readFileSync(sessionPath).toString();
                    const session_parsed = JSON.parse(session);

                    await this.page.evaluate((session_parsed) => {
                        for (const key of Object.keys(session_parsed)) {
                            sessionStorage.setItem(key, session_parsed[key]);
                        }
                    }, session_parsed);

                    await this.page.goto('https://ht.juwa777.com/userManagement', {
                        waitUntil: 'domcontentloaded',
                        timeout: 15000
                    });
                    
                    this.log('Session storage loaded');
                } catch (error) {
                    this.log('Error loading session, continuing without it');
                }
            }

            await new Promise(resolve => setTimeout(resolve, 2000));

            const isLoginPage = await this.page.evaluate(() => {
                const div = document.querySelector('div[aria-label="Login timeout"]');
                if (div) return true;
                return location.pathname === '/login';
            });

            if (isLoginPage) {
                this.authorized = false;
                this.log('Not authorized - need to login');
                await this.authorize();
                return;
            } else {
                this.log('Already authorized');
                this.authorized = true;
                this.initialized = true;
                this.browserReady = true;
                
                if (this.requestQueue.length > 0 && !this.isProcessingQueue) {
                    this.log('Authorization complete, starting queue processor...');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    setImmediate(() => this.processQueue());
                }
                
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
            
            if (!this.isAuthorizing) {
                setTimeout(() => this.checkAuthorization(), 5000);
            }
        }
    }

    async reload() {
        this.log('Reloading and clearing session files...');
        
        const dir = readdirSync(__dirname);
        
        for (const file of dir) {
            if (["sessionjuwa.json", "cookiesjuwa.json", "localjuwa.json"].includes(file)) {
                try {
                    rmSync(path.join(__dirname, file));
                    this.log(`Removed ${file}`);
                } catch (error) {
                    this.log(`Failed to remove ${file}: ${error.message}`);
                }
            }
        }
        
        this.authorized = false;
        await this.authorize();
        return true;
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

            await this.page.goto('https://ht.juwa777.com/login', {
                waitUntil: 'domcontentloaded',
                timeout: 10000
            });

            // ⚡ REDUCED: From 2000ms to 1000ms
            await new Promise(resolve => setTimeout(resolve, 1000));

            if (!this.agentCredentials) {
                const credentialsLoaded = await this.loadAgentCredentials();
                if (!credentialsLoaded) {
                    throw new Error('Cannot authorize without agent credentials');
                }
            }

            this.log(`Using agent credentials: ${this.agentCredentials.username}`);

            await this.page.evaluate(() => {
                const inputs = document.querySelectorAll('input');
                if (inputs.length < 4) {
                    throw new Error('Login form not found - not enough input fields');
                }
                inputs[0].setAttribute('id', 'login');
                inputs[0].value = '';
                inputs[1].setAttribute('id', 'password');
                inputs[1].value = '';
                inputs[2].setAttribute('id', 'captcha');
                inputs[3].checked = true;
            });

            await this.page.type('#login', this.agentCredentials.username);
            await this.page.type('#password', this.agentCredentials.password);

            // ❌ REMOVED: No delay after typing password

            this.log('Waiting for captcha image...');
            await this.page.waitForSelector('.imgCode', { timeout: 5000 });
            
            await this.page.waitForFunction(() => {
                const img = document.querySelector('.imgCode');
                return img && img.complete && img.naturalHeight !== 0;
            }, { timeout: 5000 });

            // ❌ REMOVED: No delay before capturing captcha

            const base64Captcha = await this.page.evaluate(() => {
                const canvas = document.createElement('canvas');
                canvas.width = 132;
                canvas.height = 40;

                const context = canvas.getContext('2d');
                context.drawImage(document.querySelector('.imgCode'), 0, 0, 132, 40);

                return canvas.toDataURL("image/png").replace(/^data:image\/?[A-z]*;base64,/, "");
            });

            if (!base64Captcha || base64Captcha.length < 100) {
                throw new Error('Failed to capture captcha image');
            }

            this.log('Solving captcha...');
            const captchaValue = await Captcha(base64Captcha, 4);
            
            if (!captchaValue) {
                throw new Error('Failed to solve captcha');
            }
            
            this.log(`Captcha solved: ${captchaValue}`);

            // ⚡ TYPE IMMEDIATELY - No delay!
            await this.page.type('#captcha', captchaValue);
            
            // ⚡ CLICK IMMEDIATELY - No delay!
            await this.page.click('button');

            // ⚡ REDUCED: From 3000ms to 1500ms
            await new Promise(resolve => setTimeout(resolve, 1500));

            const currentUrl = this.page.url();
            const currentPath = await this.page.evaluate(() => location.pathname);
            this.log(`After login click - URL: ${currentUrl}, Path: ${currentPath}`);

            const is_logged_in = await this.page.evaluate(() => {
                return location.pathname === '/HomeDetail';
            });

            if (is_logged_in) {
                this.authorized = true;
                this.log('Successfully authorized');
                
                // ⚡ REDUCED: From 3000ms to 2000ms
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                await this.saveCookies();
                await this.saveSession();
                
                // ⚡ REDUCED: From 2000ms to 1000ms
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                this.log('Session and cookies saved, authorization complete');
                
                if (this.requestQueue.length > 0 && !this.isProcessingQueue) {
                    this.log('Starting queue processor...');
                    // ⚡ IMMEDIATE: No delay before processing queue
                    setImmediate(() => this.processQueue());
                }
            } else {
                const error_message = await this.page.evaluate(() => {
                    const message = document.querySelector('.el-message-box__message p');
                    return message ? message.innerText : 'unknown';
                });

                this.log(`Failed login: ${error_message}`);
                
                if (error_message.includes('captcha') || error_message === 'unknown') {
                    this.log('Retrying login in 2 seconds...');
                    setTimeout(() => this.authorize(), 2000); // ⚡ REDUCED: From 3000ms
                } else {
                    throw new Error(`Login failed: ${error_message}`);
                }
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
            
            // ⚡ REDUCED: From 3000ms to 2000ms
            setTimeout(() => this.authorize(), 2000);
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
            const cookiesPath = path.join(__dirname, 'cookiesjuwa.json');
            writeFileSync(cookiesPath, JSON.stringify(cookies, null, 4));
            this.log('Cookies saved successfully');
            return true;
        } catch (error) {
            this.error(`Error saving cookies: ${error.message}`);
            return false;
        }
    }

    async saveSession() {
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const session = await this.page.evaluate(() => {
                return {
                    i18n: sessionStorage.getItem('i18n'),
                    user: sessionStorage.getItem('user'),
                    token: sessionStorage.getItem('token')
                };
            });

            if (!session.token) {
                this.error('Warning: No token found in sessionStorage after login!');
                
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                const retrySession = await this.page.evaluate(() => {
                    return {
                        i18n: sessionStorage.getItem('i18n'),
                        user: sessionStorage.getItem('user'),
                        token: sessionStorage.getItem('token')
                    };
                });
                
                if (!retrySession.token) {
                    throw new Error('Failed to get token from sessionStorage after retry');
                }
                
                this.log('Token retrieved on retry');
                const sessionPath = path.join(__dirname, 'sessionjuwa.json');
                writeFileSync(sessionPath, JSON.stringify(retrySession, null, 4));
                this.log('Session saved successfully (after retry)');
                return true;
            }

            const sessionPath = path.join(__dirname, 'sessionjuwa.json');
            writeFileSync(sessionPath, JSON.stringify(session, null, 4));
            this.log(`Session saved successfully - Token: ${session.token ? session.token.substring(0, 20) + '...' : 'NONE'}`);
            return true;
        } catch (error) {
            this.error(`Error saving session: ${error.message}`);
            return false;
        }
    }

    async checkQueue() {
        try {
            const task = await Tasks.get('juwa');

            if (!task) {
                return setTimeout(this.checkQueue.bind(this), 5000);
            }

            console.log('Processing task:', task);

            let task_result = null;

            switch (task.type) {
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
    // HELPER METHODS FOR API CALLS
    // ========================================

    async getSessionData() {
        try {
            const sessionPath = path.join(__dirname, 'sessionjuwa.json');
            const buffer = readFileSync(sessionPath);
            const json = buffer.toString();
            const session_data = JSON.parse(json);
            const session_user_data = JSON.parse(session_data.user);
            return { session_data, session_user_data };
        } catch (error) {
            this.error(`Error reading session data: ${error.message}`);
            return null;
        }
    }

    async getLoginBalance(login) {
    try {
        const response = await this.makeRequest({
            url: "https://ht.juwa777.com/api/user/userList",
            method: "POST",
            body: {
                limit: 20,
                locale: "en",
                order_by: "desc",
                page: 1,
                search: login,
                timezone: "cst",
                sort_field: "register_time",
                type: 1
            }
        });

        if (response.code !== 200) {
            if ([400, 401].includes(response.status)) {
                await this.reload();
                return -1;
            }
            
            this.error(`${response.status}, ${response.msg}`);
            return false;
        }

        for (const user of response.data.list) {
            if (user.login_name == login) {
                return {
                    balance: user.balance,
                    user_id: user.user_id,
                    bonus: user.bonus
                };
            }
        }

        return false;
    } catch (error) {
        this.error(`Error getting login balance: ${error.message}`);
        return false;
    }
}

    async isLoginExist(login) {
    try {
        const response = await this.makeRequest({
            url: "https://ht.juwa777.com/api/user/userList",
            method: "POST",
            body: {
                limit: 20,
                locale: "en",
                order_by: "desc",
                page: 1,
                search: login,
                timezone: "cst",
                sort_field: "register_time",
                type: 1
            }
        });

        if (response.code !== 200) {
            if ([400, 401].includes(response.status)) {
                await this.reload();
                return -1;
            }
            
            this.error(`${response.status}, ${response.msg}`);
            return false;
        }

        for (const user of response.data.list) {
            if (user.login_name == login) {
                return true;  // ← CHANGED: Return true instead of user object
            }
        }

        return false;
    } catch (error) {
        this.error(`Error checking login existence: ${error.message}`);
        return false;
    }
}

    async redeemRecharge({ amount, balance, remark, user_id, type = 1 }) {
        try {
            if (!this.agentCredentials) {
                await this.loadAgentCredentials();
            }

            const response = await this.makeRequest({
                url: "https://ht.juwa777.com/api/user/rechargeRedeem",
                method: "POST",
                body: {
                    account: this.agentCredentials.username,
                    amount,
                    balance,
                    remark,
                    user_id,
                    locale: "en",
                    timezone: "cst",
                    type
                }
            });

            return response;
        } catch (error) {
            this.error(`Error in redeemRecharge: ${error.message}`);
            return false;
        }
    }

    timeout(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms, true));
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
                    login,
                    password,
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
                // Find by userId and gameLogin only (more flexible)
                const gameAccount = await GameAccount.findOne({
                    userId,
                    gameLogin
                }).sort({ createdAt: -1 });

                if (!gameAccount) {
                    throw new Error('Game account not found');
                }

                const userInfo = await this.getLoginBalance(gameLogin);

                if (!userInfo || userInfo === -1) {
                    return {
                        success: false,
                        data: null,
                        message: 'Failed to retrieve balance from game server'
                    };
                }

                const balance = userInfo.balance;

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
                console.log(`Base Amount: ${baseAmount}, Total Amount (with bonus): ${totalAmount}`);
                
                // Find by userId and gameLogin only
                const gameAccount = await GameAccount.findOne({
                    userId,
                    gameLogin
                }).sort({ createdAt: -1 });

                if (!gameAccount) {
                    throw new Error('Game account not found');
                }

                const transaction = {
                    type: 'recharge',
                    amount: baseAmount,
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
                console.log(`✅ Transaction created: ${transactionId} with base amount: ${baseAmount}`);

                const task = {
                    id: transactionId.toString(),
                    login: gameLogin,
                    amount: totalAmount,
                    remark,
                    is_manual: false
                };

                console.log(`Calling recharge with total amount: ${totalAmount}`);
                const result = await this.recharge(task);

                if (result && result !== -1) {
                    const updatedGameAccount = await GameAccount.findById(gameAccount._id);
                    
                    console.log(`✅ Recharge successful`);
                    console.log(`   - User paid: ${baseAmount}`);
                    console.log(`   - Bonus: ${totalAmount - baseAmount}`);
                    console.log(`   - Total recharged in game: ${totalAmount}`);
                    console.log(`   - New balance: ${updatedGameAccount.balance}`);
                    
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
                    gameLogin
                }).sort({ createdAt: -1 });

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

                const task = {
                    id: null,
                    login: gameLogin,
                    amount: totalAmount,
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

    async resetAccountPassword(userId, gameLogin, newPassword) {
        return await this.queueOperation(`resetPassword:${gameLogin}`, async () => {
            try {
                const gameAccount = await GameAccount.findOne({
                    userId,
                    gameLogin
                }).sort({ createdAt: -1 });

                if (!gameAccount) {
                    return {
                        success: false,
                        message: 'Game account not found'
                    };
                }

                const task = {
                    id: null,
                    login: gameLogin,
                    password: newPassword
                };

                const result = await this.resetPassword(task);
                
                if (result && result !== -1) {
                    return {
                        success: true,
                        message: 'Password reset successfully'
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
            if (this.cache.adminBalance !== null && 
                this.cache.adminBalanceTimestamp && 
                Date.now() - this.cache.adminBalanceTimestamp < this.cache.cacheDuration) {
                this.log(`Returning cached admin balance: ${this.cache.adminBalance}`);
                return this.cache.adminBalance;
            }
            
            const balance = await this._getAdminBalanceCore();
            
            if (balance !== false && balance !== -1 && balance !== null) {
                this.cache.adminBalance = balance;
                this.cache.adminBalanceTimestamp = Date.now();
            }
            
            return balance;
        });
    }

    async _getAdminBalanceCore() {
        try {
            const response = await this.makeRequest({
                url: "https://ht.juwa777.com/api/agent/balance",
                method: "GET"
            });

            if (response.code !== 200) {
                if ([400, 401].includes(response.status)) {
                    await this.reload();
                    return -1;
                }

                this.error(`${response.status}, ${response.msg}`);
                return false;
            }

            const balance = response.data.t;
            this.log(`Current admin balance: ${balance}`);
            return balance;
            
        } catch (error) {
            this.error(`Error getting admin balance: ${error.message}`);
            return false;
        }
    }

    // ========================================
    // CORE OPERATION METHODS
    // ========================================

    async getBalance({ id }) {
        console.log('🔴 GET BALANCE ADMIN START:', { id });
        
        try {
            await this.ensureBrowserReady();
            
            const balance = await this._getAdminBalanceCore();

            if (balance === false || balance === -1) {
                this.error('Failed to get admin balance');
                await Tasks.error(id, 'failed to get balance');
                return false;
            }

            this.log(`Current admin balance: ${balance}`);
            await Tasks.approve(id, balance);
            
            console.log('✅ GET BALANCE ADMIN COMPLETE');
            return balance;
            
        } catch (error) {
            console.error('❌ GET BALANCE ADMIN ERROR:', error.message);
            this.error(`Error during get balance: ${error.message}`);
            return false;
        }
    }

    async createAccount({ id, login, password }) {
        console.log('🔴 CREATE ACCOUNT START:', { id, login, password: '***' });
        
        try {
            await this.ensureBrowserReady();
            
            const response = await this.makeRequest({
                url: "https://ht.juwa777.com/api/user/addUser",
                method: "POST",
                body: {
                    account: login,
                    check_pwd: password,
                    locale: "en",
                    login_pwd: password,
                    nickname: login,
                    rechargeamount: "0.01",
                    timezone: "cst"
                }
            });

            const responseCode = response.code || response.status;
            
            if (responseCode !== 200) {
                if ([400, 401].includes(responseCode)) {
                    this.error('Authentication error detected, reloading session...');
                    await this.reload();
                    return -1;
                }

                const errorMsg = response.msg || `Error code: ${responseCode}`;
                this.error(errorMsg);

                try {
                    const gameAccount = await GameAccount.findById(id);
                    if (gameAccount) {
                        gameAccount.status = 'failed';
                        if (!gameAccount.metadata) {
                            gameAccount.metadata = {};
                        }
                        gameAccount.metadata.notes = errorMsg;
                        await gameAccount.save();
                    }
                } catch (dbError) {
                    console.log('DB update error:', dbError.message);
                }

                await Tasks.error(id, errorMsg);
                return { success: false, message: errorMsg };
            }

            console.log('✅ SUCCESS! Account created');
            this.log(`Successfully created account ${login}:${password}`);

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
            } catch (dbError) {
                console.log('DB update error:', dbError.message);
                this.error(`Error updating account status in DB: ${dbError.message}`);
            }

            await Tasks.approve(id);
            
            console.log('✅ CREATE ACCOUNT COMPLETE');
            return {
                success: true,
                login: login,
                password: password
            };
            
        } catch (error) {
            console.log('❌ CREATE ACCOUNT ERROR:', error.message);
            this.error(`Error creating account: ${error.message}`);
            
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
            
            return { success: false, message: error.message };
        }
    }

    async recharge({ id, login, amount, remark, is_manual = false }) {
        console.log('🔴 RECHARGE START:', { id, login, amount, remark, is_manual });
        
        try {
            await this.ensureBrowserReady();
            
            const hasLogin = await this.isLoginExist(login);
            
            if (!hasLogin) {
                this.error(`Login ${login} not found`);
                await Tasks.error(id, 'login not found');
                return false;
            }

            await this.timeout(500);
        
            const userInfo = await this.getLoginBalance(login);

            if (!userInfo || userInfo === -1) {
                this.error(`Failed to get balance for ${login}`);
                await Tasks.error(id, 'failed to get balance');
                return false;
            }

            if (userInfo.balance >= 2) {
                this.log(`Balance too high: ${userInfo.balance}`);
                
                if (is_manual) {
                    await Tasks.cancel(id, ` balance is more than $2 (${userInfo.balance})`);
                }

                await Tasks.error(id, `balance is more than $2 (${userInfo.balance})`);
                return false;
            }

            await this.timeout(500);

            const result = await this.redeemRecharge({
                amount,
                balance: userInfo.balance,
                remark,
                user_id: userInfo.user_id,
                type: 1
            });

            console.log('Recharge result:', result);

            if (!result || result.code !== 200) {
                await Tasks.error(id, 'wrong response status');

                if (result && result.msg && result.msg.toLowerCase().indexOf('wager') >= 0) {
                    if (is_manual) {
                        await Tasks.cancel(id, result.msg);
                    }
                    return false;
                }

                if (result && [400, 401].includes(result.status)) {
                    await this.reload();
                    return -1;
                }

                const errorMsg = result ? `${result.status}, ${result.msg}` : 'Recharge failed';
                this.error(errorMsg);
                return false;
            }

            const newBalance = result.data.Balance;
            console.log('✅ SUCCESS! New balance:', newBalance);
            this.log(`Successfully recharged ${amount} to ${login}`);

            try {
                const gameAccount = await GameAccount.findOne({ gameLogin: login });
                if (gameAccount) {
                    await gameAccount.updateBalance(newBalance, id);
                    console.log('Database updated with new balance');
                }
            } catch (dbError) {
                console.log('DB update error:', dbError.message);
                this.error(`Error updating balance in DB: ${dbError.message}`);
            }

            await Tasks.approve(id, newBalance);
            
            this.cache.adminBalance = null;
            this.cache.adminBalanceTimestamp = null;
            
            console.log('✅ RECHARGE COMPLETE');
            return true;
            
        } catch (error) {
            console.log('❌ RECHARGE ERROR:', error.message);
            this.error(`Error during recharge: ${error.message}`);
            return false;
        }
    }

    async redeem({ id, login, amount, remark, is_manual = false }) {
        console.log('🔴 REDEEM START:', { id, login, amount, remark, is_manual });
        
        try {
            await this.ensureBrowserReady();
            
            const hasLogin = await this.isLoginExist(login);
        
            if (!hasLogin) {
                this.error(`Login ${login} not found`);
                await Tasks.error(id, 'login not found');
                return false;
            }

            await this.timeout(500);
        
            const userInfo = await this.getLoginBalance(login);

            if (!userInfo || userInfo === -1) {
                this.error(`Failed to get balance for ${login}`);
                await Tasks.error(id, 'failed to get balance');
                return false;
            }

            console.log('Current balance:', userInfo.balance);

            if (userInfo.bonus > 0) {
                await Tasks.cancel(id, 'user in bonus session', 'text');
                return true;
            }

            if (!is_manual) {
                if (parseInt(userInfo.balance) !== parseInt(amount)) {
                    console.log(`Balance mismatch: Expected ${amount}, got ${userInfo.balance}`);
                    await Tasks.cancel(id, parseInt(userInfo.balance));
                    return true;
                }
            }

            if (is_manual) {
                if (parseInt(userInfo.balance) < parseInt(amount)) {
                    console.log(`Insufficient balance: Has ${userInfo.balance}, needs ${amount}`);
                    await Tasks.cancel(id, parseInt(userInfo.balance));
                    return true;
                }
            }

            await this.timeout(500);

            const result = await this.redeemRecharge({
                amount,
                balance: userInfo.balance,
                remark,
                user_id: userInfo.user_id,
                type: 2
            });

            if (!result || result.code !== 200) {
                if (result && result.msg && result.msg.toLowerCase().indexOf('wager') >= 0) {
                    if (is_manual) {
                        await Tasks.cancel(id, result.msg);
                    }
                    return false;
                }

                if (result && [400, 401].includes(result.status)) {
                    await this.reload();
                    return -1;
                }

                const errorMsg = result ? `${result.status}, ${result.msg}` : 'Redeem failed';
                this.error(errorMsg);
                await Tasks.cancel(id);
                return false;
            }

            const newBalance = result.data.Balance;
            console.log('✅ SUCCESS! New balance:', newBalance);
            this.log(`Successfully withdrew ${amount} from ${login}`);

            try {
                const gameAccount = await GameAccount.findOne({ gameLogin: login });
                if (gameAccount) {
                    await gameAccount.updateBalance(newBalance, id);
                    console.log('Database updated with new balance');
                }
            } catch (dbError) {
                console.log('DB update error:', dbError.message);
                this.error(`Error updating balance in DB: ${dbError.message}`);
            }

            await Tasks.approve(id, newBalance);
            
            this.cache.adminBalance = null;
            this.cache.adminBalanceTimestamp = null;
            
            console.log('✅ REDEEM COMPLETE');
            return true;
            
        } catch (error) {
            console.log('❌ REDEEM ERROR:', error.message);
            this.error(`Error during redeem: ${error.message}`);
            return false;
        }
    }

    async resetPassword({ id, login, password }) {
        console.log('🔴 RESET PASSWORD START:', { id, login, password: '***' });
        
        try {
            await this.ensureBrowserReady();
            
            const hasLogin = await this.isLoginExist(login);
            
            if (!hasLogin) {
                this.error(`Login ${login} not found`);
                await Tasks.error(id, 'login not found');
                return false;
            }

            await this.timeout(500);
        
            const userInfo = await this.getLoginBalance(login);

            if (!userInfo) {
                this.error(`Failed to get user info for ${login}`);
                await Tasks.error(id, 'failed to get user info');
                return false;
            }

            const response = await this.makeRequest({
                url: "https://ht.juwa777.com/api/user/resetUserPwd",
                method: "POST",
                body: {
                    locale: "en",
                    timezone: "cst",
                    uid: userInfo.user_id,
                    check_pwd: password,
                    login_pwd: password
                }
            });

            if (response.code !== 200) {
                if ([400, 401].includes(response.status)) {
                    await Tasks.error(id);
                    await this.reload();
                    return -1;
                }
                
                const errorMsg = response.msg || 'Password reset failed';
                this.error(errorMsg);
                await Tasks.error(id, errorMsg);
                return false;
            }

            this.log(`Successfully reset password for ${login}`);
            await Tasks.approve(id, password);
            
            console.log('✅ RESET PASSWORD COMPLETE');
            return true;
            
        } catch (error) {
            console.log('❌ RESET PASSWORD ERROR:', error.message);
            this.error(`Error during reset password: ${error.message}`);
            return false;
        }
    }

    async getBalanceAdmin(task) {
        try {
            await this.ensureBrowserReady();
            
            const balance = await this._getAdminBalanceCore();

            if (balance !== null && !isNaN(balance) && balance !== false && balance !== -1) {
                this.log(`Current admin balance: ${balance}`);
                
                this.cache.adminBalance = balance;
                this.cache.adminBalanceTimestamp = Date.now();
                
                await Tasks.approve(task.id, balance);
                return balance;
            }

            this.error('Could not retrieve admin balance');
            return false;
        } catch (error) {
            this.error(`Error in getBalanceAdmin: ${error.message}`);
            return false;
        }
    }

    async getDownloadCode(task) {
        this.log('Download codes not supported for Juwa');
        await Tasks.error(task.id, 'Download codes not supported');
        return false;
    }
}

const juwaController = new JuwaController();
module.exports = juwaController;