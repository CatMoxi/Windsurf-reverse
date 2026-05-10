/**
 * API Key Pool - Multi-account rotation with health tracking.
 * 
 * Features:
 * - Round-robin key selection
 * - Automatic failover on errors
 * - Rate limit / quota exhaustion detection
 * - Health status per key (healthy, rate_limited, exhausted, error)
 * - Periodic health recovery check
 */
'use strict';

const KEY_STATUS = {
  HEALTHY: 'healthy',
  RATE_LIMITED: 'rate_limited',   // Daily/weekly quota hit
  EXHAUSTED: 'exhausted',         // Monthly credits depleted
  ERROR: 'error',                 // Auth failure or other error
  COOLDOWN: 'cooldown',           // Temporarily backed off
};

class ApiKeyPool {
  /**
   * @param {object} opts
   * @param {string[]} opts.keys - Array of API keys
   * @param {object} [opts.logger] - Winston logger
   * @param {number} [opts.cooldownMs=60000] - Cooldown duration for rate-limited keys
   * @param {number} [opts.maxConsecutiveErrors=3] - Max errors before marking key as error
   */
  constructor({ keys = [], logger, cooldownMs = 60000, maxConsecutiveErrors = 3 } = {}) {
    this.logger = logger || console;
    this.cooldownMs = cooldownMs;
    this.maxConsecutiveErrors = maxConsecutiveErrors;
    this.currentIdx = 0;
    
    // Initialize key entries
    this.entries = keys.map(key => ({
      key,
      status: KEY_STATUS.HEALTHY,
      consecutiveErrors: 0,
      totalRequests: 0,
      totalErrors: 0,
      lastUsed: null,
      lastError: null,
      cooldownUntil: null,
      metadata: {},  // email, plan, etc.
    }));
  }
  
  /** Number of keys in pool */
  get size() { return this.entries.length; }
  
  /** Number of currently usable keys */
  get healthyCount() {
    return this.entries.filter(e => this._isUsable(e)).length;
  }
  
  /**
   * Get the next usable API key (round-robin with skip).
   * @returns {string|null} API key or null if none available
   */
  getKey() {
    if (this.entries.length === 0) return null;
    
    const startIdx = this.currentIdx;
    let attempts = 0;
    
    while (attempts < this.entries.length) {
      const entry = this.entries[this.currentIdx];
      this.currentIdx = (this.currentIdx + 1) % this.entries.length;
      
      if (this._isUsable(entry)) {
        entry.lastUsed = Date.now();
        entry.totalRequests++;
        return entry.key;
      }
      
      attempts++;
    }
    
    // All keys exhausted — try to recover cooldown keys
    const cooldownRecovered = this._recoverCooldownKeys();
    if (cooldownRecovered > 0) {
      return this.getKey(); // retry
    }
    
    this.logger.warn('ApiKeyPool: no usable keys available');
    return null;
  }
  
  /**
   * Report success for a key — resets consecutive errors.
   * @param {string} key
   */
  reportSuccess(key) {
    const entry = this._findEntry(key);
    if (!entry) return;
    entry.consecutiveErrors = 0;
    if (entry.status === KEY_STATUS.COOLDOWN || entry.status === KEY_STATUS.ERROR) {
      entry.status = KEY_STATUS.HEALTHY;
    }
  }
  
  /**
   * Report failure for a key.
   * @param {string} key
   * @param {object} [opts]
   * @param {boolean} [opts.rateLimited] - True if rate limited
   * @param {boolean} [opts.exhausted] - True if credits exhausted
   * @param {string} [opts.error] - Error message
   */
  reportFailure(key, { rateLimited = false, exhausted = false, error = '' } = {}) {
    const entry = this._findEntry(key);
    if (!entry) return;
    
    entry.consecutiveErrors++;
    entry.totalErrors++;
    entry.lastError = error || 'unknown';
    
    if (exhausted) {
      entry.status = KEY_STATUS.EXHAUSTED;
      this.logger.warn(`ApiKeyPool: key ${this._mask(key)} marked EXHAUSTED`);
    } else if (rateLimited) {
      entry.status = KEY_STATUS.RATE_LIMITED;
      entry.cooldownUntil = Date.now() + this.cooldownMs;
      this.logger.info(`ApiKeyPool: key ${this._mask(key)} rate limited, cooldown ${this.cooldownMs}ms`);
    } else if (entry.consecutiveErrors >= this.maxConsecutiveErrors) {
      entry.status = KEY_STATUS.ERROR;
      this.logger.error(`ApiKeyPool: key ${this._mask(key)} marked ERROR after ${entry.consecutiveErrors} failures`);
    } else {
      entry.status = KEY_STATUS.COOLDOWN;
      entry.cooldownUntil = Date.now() + this.cooldownMs;
    }
  }
  
  /**
   * Add a key to the pool.
   * @param {string} key
   * @param {object} [metadata] - Optional metadata (email, plan, etc.)
   */
  addKey(key, metadata = {}) {
    if (this.entries.some(e => e.key === key)) return; // Dedup
    this.entries.push({
      key,
      status: KEY_STATUS.HEALTHY,
      consecutiveErrors: 0,
      totalRequests: 0,
      totalErrors: 0,
      lastUsed: null,
      lastError: null,
      cooldownUntil: null,
      metadata,
    });
    this.logger.info(`ApiKeyPool: added key ${this._mask(key)} (total: ${this.entries.length})`);
  }
  
  /**
   * Remove a key from the pool.
   * @param {string} key
   */
  removeKey(key) {
    this.entries = this.entries.filter(e => e.key !== key);
  }
  
  /**
   * Get pool status summary.
   */
  getStatus() {
    const byStatus = {};
    for (const e of this.entries) {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    }
    return {
      total: this.entries.length,
      healthy: byStatus[KEY_STATUS.HEALTHY] || 0,
      rateLimited: byStatus[KEY_STATUS.RATE_LIMITED] || 0,
      exhausted: byStatus[KEY_STATUS.EXHAUSTED] || 0,
      error: byStatus[KEY_STATUS.ERROR] || 0,
      cooldown: byStatus[KEY_STATUS.COOLDOWN] || 0,
      totalRequests: this.entries.reduce((sum, e) => sum + e.totalRequests, 0),
      totalErrors: this.entries.reduce((sum, e) => sum + e.totalErrors, 0),
    };
  }
  
  /**
   * Get detailed info for all keys.
   */
  getEntries() {
    return this.entries.map(e => ({
      key: this._mask(e.key),
      status: e.status,
      requests: e.totalRequests,
      errors: e.totalErrors,
      lastError: e.lastError,
      email: e.metadata?.email || '',
    }));
  }
  
  /**
   * Reset all keys to healthy (e.g., after daily quota reset).
   */
  resetAll() {
    for (const e of this.entries) {
      e.status = KEY_STATUS.HEALTHY;
      e.consecutiveErrors = 0;
      e.cooldownUntil = null;
    }
    this.logger.info('ApiKeyPool: all keys reset to healthy');
  }
  
  // ==================== Internal ====================
  
  _isUsable(entry) {
    if (entry.status === KEY_STATUS.HEALTHY) return true;
    if (entry.status === KEY_STATUS.COOLDOWN || entry.status === KEY_STATUS.RATE_LIMITED) {
      if (entry.cooldownUntil && Date.now() >= entry.cooldownUntil) {
        entry.status = KEY_STATUS.HEALTHY;
        entry.cooldownUntil = null;
        entry.consecutiveErrors = 0;
        return true;
      }
      return false;
    }
    return false; // EXHAUSTED, ERROR
  }
  
  _recoverCooldownKeys() {
    let recovered = 0;
    for (const e of this.entries) {
      if ((e.status === KEY_STATUS.COOLDOWN || e.status === KEY_STATUS.RATE_LIMITED) &&
          e.cooldownUntil && Date.now() >= e.cooldownUntil) {
        e.status = KEY_STATUS.HEALTHY;
        e.cooldownUntil = null;
        e.consecutiveErrors = 0;
        recovered++;
      }
    }
    return recovered;
  }
  
  _findEntry(key) {
    return this.entries.find(e => e.key === key);
  }
  
  _mask(key) {
    if (!key || key.length < 12) return '***';
    return key.substring(0, 8) + '...' + key.slice(-4);
  }
}

module.exports = { ApiKeyPool, KEY_STATUS };
