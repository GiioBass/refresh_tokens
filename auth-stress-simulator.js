/**
 * AUTH STRESS & CONCURRENCY SIMULATOR FOR SANCTUM DOUBLE TOKEN ROTATION
 * 
 * This script simulates massive concurrent user behavior, clock offsets,
 * and overlapping /refresh requests to stress test session drops, grace periods,
 * and database write lock bottlenecks.
 * 
 * Usage:
 *   node auth-stress-simulator.js --url=http://localhost:8001/api/v2 --users=5 --concurrency=3
 */

import axios from 'axios';

// Configure options from arguments or defaults
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.split('=');
  acc[key.replace(/^--/, '')] = val;
  return acc;
}, {});

const API_BASE_URL = args.url || 'http://localhost:8001/api/v2';
const VIRTUAL_USERS_COUNT = parseInt(args.users || '5', 10);
const CONCURRENT_CALLS = parseInt(args.concurrency || '3', 10);
const TEST_EMAIL = args.email || 'dev@creativejungle.co';
const TEST_PASSWORD = args.password || '787878';
const CLIENT_TYPE = args.client || 'mobile'; // 'web' uses cookies, 'mobile' uses JSON body

console.log(`================================================================`);
console.log(`🚀 STARTING AUTH CONCURRENCY STRESS SIMULATOR`);
console.log(`   Base URL:      ${API_BASE_URL}`);
console.log(`   Users:         ${VIRTUAL_USERS_COUNT}`);
console.log(`   Concurrency:   ${CONCURRENT_CALLS} overlapping requests/user`);
console.log(`   Client Type:   ${CLIENT_TYPE}`);
console.log(`================================================================\n`);

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
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Client-Type': CLIENT_TYPE,
        'X-Tenant': 'supplier',
        'X-Device-Name': `Stress-Bot-User-${id}`
      }
    });
  }

  async login() {
    try {
      console.log(`[User #${this.id}] 🔑 Authenticating...`);
      const response = await this.client.post('/auth/login/login', {
        email: this.email,
        password: this.password
      });

      if (response.data?.success) {
        this.accessToken = response.data.token || response.data.data?.access_token;
        this.refreshToken = response.data.refresh_token || response.data.data?.refresh_token;
        this.client.defaults.headers.common['Authorization'] = `Bearer ${this.accessToken}`;
        console.log(`[User #${this.id}] ✅ Login successful. Initial tokens obtained.`);
        return true;
      }
    } catch (err) {
      console.error(`[User #${this.id}] ❌ Login failed: ${err.message}`, err.response?.data || '');
    }
    return false;
  }

  /**
   * Option A: Simulates multiple overlapping parallel requests to trigger race conditions on 401
   */
  async simulateOverlappingCalls() {
    if (!this.accessToken) return;
    
    console.log(`[User #${this.id}] ⚡ Simulating ${CONCURRENT_CALLS} concurrent protected API calls...`);
    
    // Intentionally corrupt access token to force 401 and trigger concurrent interceptor-driven refreshes
    this.client.defaults.headers.common['Authorization'] = `Bearer INVALID_OR_EXPIRED_TOKEN`;

    // Fire parallel requests
    const requests = Array.from({ length: CONCURRENT_CALLS }).map((_, index) => {
      // Add slight jitter/delay to mock realistic network dispersion
      const delay = index * 50; 
      return sleep(delay).then(() => {
        console.log(`   -> [User #${this.id}] Dispatching call ${index + 1}...`);
        return this.client.get('/suppliers/users/information/139').catch(err => err);
      });
    });

    const results = await Promise.all(requests);
    
    let successes = 0;
    let failures = 0;

    results.forEach((res, index) => {
      if (res.status === 200) {
        successes++;
      } else {
        failures++;
      }
    });

    console.log(`[User #${this.id}] 📊 Concurrency Results: ${successes} Succeeded, ${failures} Failed`);
  }

  /**
   * Option C: Simulates an immediate malicious or race replay attack
   */
  async simulateReplayAttack() {
    if (!this.refreshToken) {
      console.log(`[User #${this.id}] Cannot test replay, no refresh token stored.`);
      return;
    }

    console.log(`[User #${this.id}] ⚔ Testing Token Replay Attack...`);
    
    // We fire two duplicate refresh requests at the same time
    const payload = CLIENT_TYPE === 'mobile' ? { refresh_token: this.refreshToken } : {};

    const req1 = this.client.post('/auth/login/refresh', payload).catch(err => err.response || err);
    const req2 = this.client.post('/auth/login/refresh', payload).catch(err => err.response || err);

    const [res1, res2] = await Promise.all([req1, req2]);

    console.log(`[User #${this.id}] First Refresh Response Status:  ${res1.status}`);
    console.log(`[User #${this.id}] Second Refresh Response Status: ${res2.status}`);

    if (res1.status === 401 || res2.status === 401) {
      console.log(`[User #${this.id}] 🚨 Replay Attack successfully caught and locked down!`);
    } else {
      console.log(`[User #${this.id}] ⚠️ Warning: Replay attack might not have been caught.`);
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
    console.log('❌ No users could be logged in. Aborting test.');
    return;
  }

  console.log(`\n================================================================`);
  console.log(`🔄 PHASE 1: CONCURRENT OVERLAPPING API CALLS (401 RACE COND)`);
  console.log(`================================================================`);
  for (const user of activeUsers) {
    await user.simulateOverlappingCalls();
    await sleep(500);
  }

  console.log(`\n================================================================`);
  console.log(`⚔ PHASE 2: IMMEDIATE TOKEN REPLAY ATTACK DETECTION`);
  console.log(`================================================================`);
  for (const user of activeUsers) {
    await user.simulateReplayAttack();
    await sleep(500);
  }

  console.log(`\n================================================================`);
  console.log(`🎉 STRESS TEST COMPLETED`);
  console.log(`   Check the telemetry log dashboard or run:`);
  console.log(`   SELECT * FROM auth_failures_telemetry ORDER BY id DESC LIMIT 20;`);
  console.log(`================================================================\n`);
}

runStressTest();
