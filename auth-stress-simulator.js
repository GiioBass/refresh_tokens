/**
 * AUTH STRESS & CONCURRENCY SIMULATOR FOR SANCTUM DOUBLE TOKEN ROTATION
 * 
 * This script simulates massive concurrent user behavior, clock offsets,
 * and overlapping /refresh requests to stress test session drops, grace periods,
 * and database write lock bottlenecks.
 * 
 * All configurations are read strictly from the .env file of the project.
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Parse .env dynamically
let projectDir = '.';
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  projectDir = __dirname;
  const envPath = path.resolve(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split(/\r?\n/).forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const [key, ...values] = trimmed.split('=');
        if (key) {
          const val = values.join('=').trim();
          process.env[key.trim()] = val;
        }
      }
    });
  }
} catch (err) {
  // Ignore env reading errors
}

// Setup dedicated stress log file
const LOG_FILE_PATH = path.resolve(projectDir, 'logs', 'stress-test.log');
try {
  const logDir = path.dirname(LOG_FILE_PATH);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  // Reset log file on each new run
  fs.writeFileSync(LOG_FILE_PATH, `=== AUTH STRESS SIMULATOR INITIALIZED AT ${new Date().toISOString()} ===\n`, 'utf8');
} catch (err) {
  // Ignore filesystem log errors
}

// Custom log helper to write to terminal AND to logs/stress-test.log
function log(message, type = 'INFO') {
  const timestamp = new Date().toISOString();
  // Strip ANSI color codes for file logging
  const cleanMsg = message.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  const fileLine = `[${timestamp}] [${type}] ${cleanMsg}`;

  // Log to console
  if (type === 'ERROR' || type === 'CRITICAL') {
    console.error(message);
  } else {
    console.log(message);
  }

  // Log to file
  try {
    fs.appendFileSync(LOG_FILE_PATH, fileLine + '\n', 'utf8');
  } catch (err) {
    // Ignore logging write errors
  }
}

// Configure options from arguments or defaults
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.split('=');
  acc[key.replace(/^--/, '')] = val;
  return acc;
}, {});

const API_BASE_URL = args.url || process.env.VITE_API_BASE_URL;
const VIRTUAL_USERS_COUNT = parseInt(args.users || '5', 10);
const CONCURRENT_CALLS = parseInt(args.concurrency || '3', 10);
const TEST_EMAIL = args.email || process.env.VITE_DEFAULT_EMAIL;
const TEST_PASSWORD = args.password || process.env.VITE_DEFAULT_PASSWORD;
const TEST_PIN = args.pin || process.env.VITE_DEFAULT_PIN;
const CLIENT_TYPE = args.client || process.env.VITE_DEFAULT_CLIENT_TYPE;
const TENANT = process.env.VITE_API_TENANT;

// Loop configurations
const LOOP_MODE = args.loop === 'true';
const INTERVAL_MS = parseInt(args.interval || '5000', 10);

// Endpoint paths
const LOGIN_PATH = process.env.VITE_API_LOGIN_PATH;
const PIN_PATH = process.env.VITE_API_PIN_LOGIN_PATH;
const REFRESH_PATH = process.env.VITE_API_REFRESH_PATH;

// Validate strictly required environment variables
const missingConfigs = [];
if (!API_BASE_URL) missingConfigs.push('VITE_API_BASE_URL');
if (!TEST_EMAIL) missingConfigs.push('VITE_DEFAULT_EMAIL');
if (!TEST_PASSWORD) missingConfigs.push('VITE_DEFAULT_PASSWORD');
if (!CLIENT_TYPE) missingConfigs.push('VITE_DEFAULT_CLIENT_TYPE');
if (!TENANT) missingConfigs.push('VITE_API_TENANT');
if (!LOGIN_PATH) missingConfigs.push('VITE_API_LOGIN_PATH');
if (!REFRESH_PATH) missingConfigs.push('VITE_API_REFRESH_PATH');

if (CLIENT_TYPE === 'mobile') {
  if (!TEST_PIN) missingConfigs.push('VITE_DEFAULT_PIN');
  if (!PIN_PATH) missingConfigs.push('VITE_API_PIN_LOGIN_PATH');
}

if (missingConfigs.length > 0) {
  log(`\n❌ ERROR: Las siguientes variables de entorno requeridas faltan en el .env:`, 'ERROR');
  missingConfigs.forEach(cfg => log(`   - ${cfg}`, 'ERROR'));
  log(`\nPor favor, define estas variables en tu archivo .env del proyecto de pruebas.\n`, 'ERROR');
  process.exit(1);
}

log(`================================================================`);
log(`🚀 STARTING AUTH CONCURRENCY STRESS SIMULATOR`);
log(`   Base URL:      ${API_BASE_URL}`);
log(`   Users:         ${VIRTUAL_USERS_COUNT}`);
log(`   Concurrency:   ${CONCURRENT_CALLS} overlapping requests/user`);
log(`   Client Type:   ${CLIENT_TYPE}`);
log(`   Tenant ID:     ${TENANT}`);
log(`   Continuous Loop: ${LOOP_MODE ? `ENABLED (Every ${INTERVAL_MS/1000}s)` : 'DISABLED'}`);
if (CLIENT_TYPE === 'mobile') {
  log(`   PIN Code:      ${TEST_PIN}`);
}
log(`   Log File:      ${LOG_FILE_PATH}`);
log(`================================================================\n`);

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class VirtualUser {
  constructor(id) {
    this.id = id;
    this.email = TEST_EMAIL;
    this.password = TEST_PASSWORD;
    this.accessToken = null;
    this.refreshToken = null;
    this.rotationCount = 0;
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Client-Type': CLIENT_TYPE,
        'X-Tenant': TENANT,
        'X-Device-Name': `Stress-Bot-User-${id}`
      }
    });

    this.isRefreshing = false;
    this.failedQueue = [];

    this.setupInterceptors();
  }

  setupInterceptors() {
    // Request Interceptor
    this.client.interceptors.request.use((config) => {
      if (this.accessToken && !config.url.includes(REFRESH_PATH)) {
        config.headers['Authorization'] = `Bearer ${this.accessToken}`;
      }
      return config;
    }, (err) => Promise.reject(err));

    // Response Interceptor
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        
        if (error.response?.status === 401 && !originalRequest._retry) {
          log(`   -> [User #${this.id}] ⚠️ 401 Unauthorized caught on [${originalRequest.method.toUpperCase()} ${originalRequest.url}]. Initiating rotation flow...`, 'WARN');
          
          if (this.isRefreshing) {
            log(`   -> [User #${this.id}] ⏳ Queueing overlapping request [${originalRequest.url}]`, 'INFO');
            return new Promise((resolve, reject) => {
              this.failedQueue.push({ resolve, reject });
            })
              .then((token) => {
                originalRequest.headers['Authorization'] = `Bearer ${token}`;
                return this.client(originalRequest);
              })
              .catch((err) => Promise.reject(err));
          }

          originalRequest._retry = true;
          this.isRefreshing = true;

          return new Promise(async (resolve, reject) => {
            try {
              const payload = CLIENT_TYPE === 'mobile' ? { refresh_token: this.refreshToken } : {};
              
              log(`   -> [User #${this.id}] 📤 POST ${REFRESH_PATH} | Payload: ${JSON.stringify(payload)}`, 'INFO');
              
              const refreshResponse = await axios.post(`${API_BASE_URL}${REFRESH_PATH}`, payload, {
                headers: {
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                  'X-Client-Type': CLIENT_TYPE,
                  'X-Tenant': TENANT
                }
              });

              log(`   -> [User #${this.id}] 📥 Response 200 from ${REFRESH_PATH} | Rotated successfully!`, 'INFO');
              
              const responseData = refreshResponse.data.data || refreshResponse.data;
              this.accessToken = responseData.access_token;
              
              if (CLIENT_TYPE === 'mobile' && responseData.refresh_token) {
                this.refreshToken = responseData.refresh_token;
              }

              this.rotationCount++;

              // Process queue
              this.failedQueue.forEach(prom => prom.resolve(this.accessToken));
              this.failedQueue = [];

              originalRequest.headers['Authorization'] = `Bearer ${this.accessToken}`;
              resolve(this.client(originalRequest));
            } catch (refreshError) {
              const status = refreshError.response?.status || 'Network Error';
              const body = JSON.stringify(refreshError.response?.data || 'No body');
              log(`   -> [User #${this.id}] ❌ CRITICAL: Refresh failed [Status ${status}]! Body: ${body}`, 'ERROR');
              
              this.failedQueue.forEach(prom => prom.reject(refreshError));
              this.failedQueue = [];
              reject(refreshError);
            } finally {
              this.isRefreshing = false;
            }
          });
        }
        return Promise.reject(error);
      }
    );
  }

  async login() {
    try {
      log(`[User #${this.id}] 🔑 Step 1: Authenticating Email...`);
      log(`   -> POST ${LOGIN_PATH} | Body: { email: "${this.email}", app_id: ${process.env.VITE_APP_ID || 1} }`);
      
      const response = await this.client.post(LOGIN_PATH, {
        email: this.email,
        password: this.password,
        app_id: process.env.VITE_APP_ID || 1
      });

      log(`   -> Response Status: ${response.status} | Body: ${JSON.stringify(response.data).substring(0, 100)}...`);

      if (!response.data?.success) {
        log(`[User #${this.id}] ❌ Step 1 failed: ${JSON.stringify(response.data)}`, 'ERROR');
        return false;
      }

      const intermediateToken = response.data.token || response.data.data?.access_token;

      if (CLIENT_TYPE === 'web') {
        this.accessToken = intermediateToken;
        this.refreshToken = response.data.refresh_token || response.data.data?.refresh_token;
        log(`[User #${this.id}] ✅ Web Login successful. Session started.`);
        return true;
      } else {
        log(`[User #${this.id}] 🔑 Step 2: Authenticating PIN...`);
        log(`   -> POST ${PIN_PATH} | Body: { pin: "${TEST_PIN}", app_id: 2 } | Headers: Authorization: Bearer ${intermediateToken.substring(0, 15)}...`);
        
        const pinResponse = await this.client.post(PIN_PATH, {
          pin: TEST_PIN,
          app_id: 2
        }, {
          headers: { 'Authorization': `Bearer ${intermediateToken}` }
        });

        log(`   -> Response Status: ${pinResponse.status} | Body: ${JSON.stringify(pinResponse.data).substring(0, 100)}...`);

        if (pinResponse.data?.success) {
          this.accessToken = pinResponse.data.token || pinResponse.data.data?.access_token;
          this.refreshToken = pinResponse.data.refresh_token || pinResponse.data.data?.refresh_token;
          log(`[User #${this.id}] ✅ Mobile Login successful. Final tokens obtained.`);
          return true;
        } else {
          log(`[User #${this.id}] ❌ Step 2 PIN failed: ${JSON.stringify(pinResponse.data)}`, 'ERROR');
          return false;
        }
      }
    } catch (err) {
      const status = err.response?.status || 'Network Error';
      const body = JSON.stringify(err.response?.data || 'No data');
      log(`[User #${this.id}] ❌ Login failed: ${err.message} [Status ${status}] | Body: ${body}`, 'ERROR');
    }
    return false;
  }

  /**
   * Option A: Simulates multiple overlapping parallel requests to trigger race conditions on 401
   */
  async simulateOverlappingCalls() {
    if (!this.accessToken) return;
    
    log(`\n[User #${this.id}] ⚡ Simulating ${CONCURRENT_CALLS} concurrent protected API calls...`);
    log(`   -> Sending 3 requests to GET /suppliers/users/information/139`);
    log(`   -> Corrupting Access Token to force 401: "Bearer INVALID_OR_EXPIRED_TOKEN"`);
    
    // Backup active token
    const oldAccessToken = this.accessToken;

    // Intentionally corrupt access token to force 401. We include a "|" so the custom backend middleware
    // doesn't throw a 500 error on array destructuring.
    this.accessToken = '999|INVALID_OR_EXPIRED_TOKEN';

    // Fire parallel requests
    const requests = Array.from({ length: CONCURRENT_CALLS }).map((_, index) => {
      const delay = index * 50; 
      return sleep(delay).then(() => {
        log(`   [User #${this.id}] Dispatching call ${index + 1}...`);
        return this.client.get('/suppliers/users/information/139')
          .then(res => {
            log(`   [User #${this.id}] Call ${index + 1} Succeeded | Status ${res.status}`);
            return { index: index + 1, success: true, res };
          })
          .catch(err => {
            const status = err.response?.status || 'Error';
            const msg = JSON.stringify(err.response?.data || err.message);
            log(`   [User #${this.id}] Call ${index + 1} Failed | Status ${status} | Body: ${msg}`, 'ERROR');
            return { index: index + 1, success: false, err };
          });
      });
    });

    const results = await Promise.all(requests);
    
    let successes = 0;
    let failures = 0;

    results.forEach((r) => {
      if (r.success) {
        successes++;
      } else {
        failures++;
      }
    });

    log(`[User #${this.id}] 📊 Concurrency Results: ${successes} Succeeded, ${failures} Failed`);
    
    // If failures happened, restore old token so loop can continue, otherwise we use the newly rotated token
    if (successes === 0 && !this.accessToken) {
      this.accessToken = oldAccessToken;
    }
  }

  /**
   * Option C: Simulates an immediate malicious or race replay attack
   */
  async simulateReplayAttack() {
    if (!this.refreshToken) {
      log(`[User #${this.id}] Cannot test replay, no refresh token stored.`, 'WARN');
      return;
    }

    log(`\n[User #${this.id}] ⚔ Testing Token Replay Attack...`);
    log(`   -> Triggering 2 parallel POST requests to ${REFRESH_PATH} with same token: "${this.refreshToken.substring(0, 8)}..."`);
    
    const payload = CLIENT_TYPE === 'mobile' ? { refresh_token: this.refreshToken } : {};

    const req1 = axios.post(`${API_BASE_URL}${REFRESH_PATH}`, payload, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Client-Type': CLIENT_TYPE, 'X-Tenant': TENANT }
    }).catch(err => err.response || err);

    const req2 = axios.post(`${API_BASE_URL}${REFRESH_PATH}`, payload, {
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Client-Type': CLIENT_TYPE, 'X-Tenant': TENANT }
    }).catch(err => err.response || err);

    const [res1, res2] = await Promise.all([req1, req2]);

    log(`   -> Response 1: Status ${res1.status} | Body: ${JSON.stringify(res1.data)}`);
    log(`   -> Response 2: Status ${res2.status} | Body: ${JSON.stringify(res2.data)}`);

    if (res1.status === 401 || res2.status === 401) {
      log(`[User #${this.id}] 🚨 Replay Attack successfully caught by the backend! Chain broken & session revoked.`, 'SECURITY');
    } else {
      log(`[User #${this.id}] ⚠️ Warning: Replay attack might not have been caught.`, 'WARN');
    }
  }
}

async function runStressTest() {
  const users = Array.from({ length: VIRTUAL_USERS_COUNT }).map((_, i) => new VirtualUser(i + 1));

  // Step 1: Login all users
  const loginPromises = users.map(user => user.login());
  const loginResults = await Promise.all(loginPromises);
  const activeUsers = users.filter((_, idx) => loginResults[idx]);

  if (activeUsers.length === 0) {
    log('❌ No users could be logged in. Aborting test.', 'ERROR');
    return;
  }

  if (!LOOP_MODE) {
    log(`\n================================================================`);
    log(`🔄 PHASE 1: CONCURRENT OVERLAPPING API CALLS (401 RACE COND)`);
    log(`================================================================`);
    for (const user of activeUsers) {
      await user.simulateOverlappingCalls();
      await sleep(1000);
    }

    log(`\n================================================================`);
    log(`⚔ PHASE 2: IMMEDIATE TOKEN REPLAY ATTACK DETECTION`);
    log(`================================================================`);
    for (const user of activeUsers) {
      await user.simulateReplayAttack();
      await sleep(1000);
    }

    log(`\n================================================================`);
    log(`🎉 STRESS TEST COMPLETED`);
    log(`   Check the telemetry log dashboard or run:`);
    log(`   SELECT * FROM auth_failures_telemetry ORDER BY id DESC LIMIT 20;`);
    log(`================================================================\n`);
  } else {
    log(`\n================================================================`);
    log(`🔄 RUNNING IN CONTINUOUS STRESS LOOP MODE (Ctrl+C to stop)`);
    log(`================================================================`);
    
    let loopCycle = 1;
    while (true) {
      log(`\n--- [Cycle #${loopCycle}] Performing pings & security audits ---`);
      
      for (const user of activeUsers) {
        try {
          if (loopCycle % 4 !== 0) {
            log(`   [User #${user.id}] 📡 Sending healthy ping to users/information...`);
            const res = await user.client.get('/suppliers/users/information/139');
            log(`   [User #${user.id}] ✅ Ping Succeeded | Status ${res.status}`);
          } else {
            await user.simulateOverlappingCalls();
          }
        } catch (err) {
          const status = err.response?.status || 'Network Error';
          const msg = JSON.stringify(err.response?.data || err.message);
          log(`\n❌ CRITICAL CRASH: [User #${user.id}] was KICKED OUT of the system!`, 'CRITICAL');
          log(`   Status Code: ${status} | Response: ${msg}`, 'CRITICAL');
          log(`   Total Successful Rotations before failure: ${user.rotationCount}`, 'CRITICAL');
          log(`\n   Consulte la pestaña "📡 Security Telemetry" en la web para ver el volcado de cabeceras.`, 'CRITICAL');
          process.exit(1);
        }
      }
      
      loopCycle++;
      await sleep(INTERVAL_MS);
    }
  }
}

runStressTest();
