#!/usr/bin/env node
/**
 * Deep extraction: behavior detection, rate limiting, safety, lifeguard,
 * abuse detection, throttling, and restriction mechanisms.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app',
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const buf = fs.readFileSync(binPath);

const queries = [
  // Rate limiting
  'rate_limit', 'rate limit', 'rateLimit', 'rateLimi',
  'throttle', 'throttling',
  'too many requests', 'Too many',
  'request limit', 'request_limit',
  'quota', 'Quota',
  'credits', 'Credits',
  'capacity', 'Capacity',
  'exceeded', 'Exceeded',
  'cooldown', 'cool_down',
  'backoff', 'back_off', 'retry_after', 'retryAfter',
  'wait_time', 'waitTime',
  'reset_time', 'resetTime',
  'window', 'time_window', 'timeWindow',
  
  // Behavior detection / abuse
  'abuse', 'Abuse',
  'suspicious', 'Suspicious',
  'anomaly', 'anomalous',
  'violation', 'Violation',
  'banned', 'Banned', 'BANNED',
  'blocked', 'Blocked',
  'restrict', 'Restrict',
  'forbidden', 'Forbidden',
  'deny', 'denied', 'Denied',
  'blacklist', 'blocklist',
  'allowlist', 'Allowlist',
  'fingerprint', 'Fingerprint',
  'device_id', 'deviceId',
  'machine_id', 'machineId',
  'telemetry', 'Telemetry',
  'tracking', 'Tracking',
  
  // Lifeguard
  'lifeguard', 'Lifeguard', 'LIFEGUARD',
  'life_guard',
  'safety', 'Safety',
  'guardrail', 'guard_rail',
  'content_filter', 'contentFilter',
  'moderation', 'Moderation',
  'harmful', 'Harmful',
  'dangerous', 'Dangerous',
  'malicious', 'Malicious',
  'injection', 'Injection',
  'jailbreak', 'Jailbreak',
  
  // Specific safety mechanisms
  'EXTREME SUSPICION',
  'consecutive times',
  'failed %d',
  'BANNED: You have failed',
  'edit attempts on this file',
  'unproductive loops',
  'MOVE ON',
  'too large to be edited',
  
  // Account/session controls
  'session_token', 'sessionToken',
  'api_key_invalid', 'apiKeyInvalid',
  'unauthenticated', 'Unauthenticated',
  'unauthorized', 'Unauthorized',
  'token_expired', 'tokenExpired',
  'permission_denied', 'permissionDenied',
  'access_denied', 'accessDenied',
  
  // Feature flags / experiments
  'unleash', 'Unleash',
  'feature_flag', 'featureFlag',
  'experiment', 'Experiment',
  'rollout', 'Rollout',
  'variant', 'Variant',
  'A/B test', 'ab_test',
  'canary', 'Canary',
  'toggle', 'Toggle',
  'kill_switch', 'killSwitch',
  
  // Cascade-specific limits
  'max_steps', 'maxSteps',
  'max_turns', 'maxTurns',
  'max_tokens', 'maxTokens',
  'max_tool_calls', 'maxToolCalls',
  'max_iterations', 'maxIterations',
  'max_retries', 'maxRetries',
  'context_window', 'contextWindow',
  'token_limit', 'tokenLimit',
  'step_limit', 'stepLimit',
  'turn_limit', 'turnLimit',
  'budget', 'Budget',
  
  // Plan/task limits
  'max_files', 'maxFiles',
  'max_edit', 'maxEdit',
  'max_command', 'maxCommand',
  'auto_run', 'autoRun', 'SafeToAutoRun',
  
  // Pricing/billing
  'premium', 'Premium',
  'pro_tier', 'proTier',
  'free_tier', 'freeTier',
  'plan_type', 'planType',
  'subscription', 'Subscription',
  'billing', 'Billing',
  'payment', 'Payment',
  'trial', 'Trial',
  'usage_limit', 'usageLimit',
  'flow_action_credit', 'flowActionCredit',
  'premium_model', 'premiumModel',
  
  // Anti-patterns / circuit breakers
  'circuit_breaker', 'circuitBreaker',
  'fail_open', 'failOpen',
  'fail_close', 'failClose',
  'dead_letter', 'deadLetter',
  'poison', 'Poison',
  'infinite loop', 'infinite_loop',
  'runaway', 'Runaway',
  'stuck', 'Stuck',
  'timeout', 'Timeout',
  'deadline', 'Deadline',
];

// Find all occurrences, extract context
const results = new Map(); // offset -> {query, text}

for (const q of queries) {
  const qBuf = Buffer.from(q, 'utf-8');
  let idx = 0;
  while (true) {
    idx = buf.indexOf(qBuf, idx);
    if (idx === -1) break;
    
    // Check if this is in readable text (not binary noise)
    const before = buf.subarray(Math.max(0, idx - 10), idx);
    const after = buf.subarray(idx + q.length, Math.min(buf.length, idx + q.length + 10));
    const ctx = Buffer.concat([before, qBuf, after]).toString('utf-8');
    const alpha = (ctx.match(/[a-zA-Z0-9_ .,;:!?'"()\-/{}[\]<>=+*@#$%&|\\~`\n\r\t]/g) || []).length / ctx.length;
    
    if (alpha < 0.5) { idx += q.length; continue; }
    
    // Extract surrounding text block
    const windowSize = 800;
    let start = Math.max(0, idx - windowSize);
    let end = Math.min(buf.length, idx + q.length + windowSize);
    
    // Filter to readable text only
    const raw = buf.subarray(start, end).toString('utf-8');
    const lines = raw.split('\n');
    const cleanLines = [];
    for (const line of lines) {
      if (line.length === 0) continue;
      const lineAlpha = (line.match(/[a-zA-Z0-9_ .,;:!?'"()\-/{}[\]<>=+*@#$%&|\\~`\t]/g) || []).length / line.length;
      if (lineAlpha > 0.6 && line.length > 10 && line.length < 500) {
        cleanLines.push(line);
      }
    }
    
    if (cleanLines.length > 0) {
      const blockKey = Math.floor(idx / 500); // Deduplicate by ~500 byte blocks
      if (!results.has(blockKey)) {
        results.set(blockKey, {
          query: q,
          offset: idx,
          text: cleanLines.join('\n'),
        });
      }
    }
    
    idx += q.length;
  }
}

// Sort by offset and output
const sorted = [...results.values()].sort((a, b) => a.offset - b.offset);

// Filter: only keep entries with interesting prompt-like text (not just Go runtime stuff)
const interesting = sorted.filter(r => {
  const t = r.text.toLowerCase();
  return (
    t.includes('rate') || t.includes('limit') || t.includes('quota') ||
    t.includes('credit') || t.includes('throttl') || t.includes('abuse') ||
    t.includes('lifeguard') || t.includes('safety') || t.includes('guard') ||
    t.includes('banned') || t.includes('restrict') || t.includes('suspicion') ||
    t.includes('violat') || t.includes('detect') || t.includes('block') ||
    t.includes('allow') || t.includes('unleash') || t.includes('experiment') ||
    t.includes('rollout') || t.includes('variant') || t.includes('feature') ||
    t.includes('premium') || t.includes('subscription') || t.includes('billing') ||
    t.includes('token') || t.includes('budget') || t.includes('capacity') ||
    t.includes('max_') || t.includes('cascade') || t.includes('prompt') ||
    t.includes('plan') || t.includes('tier') || t.includes('model') ||
    t.includes('telemetry') || t.includes('fingerprint') || t.includes('machine')
  );
});

let output = `# Safety & Rate Limiting Deep Extraction\n`;
output += `# Generated: ${new Date().toISOString()}\n`;
output += `# Total hits: ${sorted.length}, Filtered: ${interesting.length}\n\n`;

for (const r of interesting) {
  output += `\n---\n### [${r.query}] @${r.offset}\n\`\`\`\n${r.text.substring(0, 1200)}\n\`\`\`\n`;
}

const outPath = path.join(__dirname, '..', 'docs', 'safety-ratelimit-extraction.md');
fs.writeFileSync(outPath, output, 'utf-8');
console.log(`Saved ${interesting.length} results to ${outPath} (${(output.length / 1024).toFixed(1)} KB)`);
