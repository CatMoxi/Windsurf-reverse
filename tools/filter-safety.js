#!/usr/bin/env node
/**
 * Filter the safety extraction to only the most interesting prompt-like entries.
 * Especially: Cascade-specific rate limiting, lifeguard, behavior detection.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app',
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const buf = fs.readFileSync(binPath);

// Targeted searches - exact phrases that are prompt-like
const targets = [
  // Rate limiting messages
  { name: 'RATE_LIMIT_MESSAGE', text: 'CheckUserMessageRateLimit' },
  { name: 'RATE_LIMIT_CHECK', text: 'rate limit' },
  { name: 'CHECK_CHAT_CAPACITY', text: 'CheckChatCapacity' },
  { name: 'RATE_LIMIT_EXCEEDED', text: 'rate_limit_exceeded' },
  { name: 'RATE_LIMIT_RESET', text: 'rate_limit_reset' },
  { name: 'QUOTA_EXCEEDED', text: 'quota exceeded' },
  { name: 'QUOTA_USAGE', text: 'quota_usage' },
  { name: 'CREDITS_REMAINING', text: 'credits_remaining' },
  { name: 'FLOW_ACTION_CREDITS', text: 'flow_action_credit' },
  { name: 'PREMIUM_CREDITS', text: 'premium_credits' },
  { name: 'FREE_CREDITS', text: 'free_credits' },
  { name: 'USAGE_CREDITS', text: 'usage_credits' },
  
  // Lifeguard / safety
  { name: 'LIFEGUARD_CONFIG', text: 'GetLifeguardConfig' },
  { name: 'LIFEGUARD_MODE', text: 'lifeguard_mode' },
  { name: 'LIFEGUARD_AGENT', text: 'lifeguard_agent' },
  { name: 'LIFEGUARD_INSTRUCTIONS', text: 'lifeguard_instructions' },
  { name: 'LIFEGUARD_ENABLED', text: 'lifeguard_enabled' },
  { name: 'LIFEGUARD_MODEL', text: 'cognition-lifeguard' },
  { name: 'CONTENT_SAFETY', text: 'content_safety' },
  { name: 'SAFETY_CHECK', text: 'safety_check' },
  { name: 'HARMFUL_CONTENT', text: 'harmful_content' },
  { name: 'CONTENT_FILTER', text: 'content_filter' },
  
  // Behavior detection
  { name: 'CONSECUTIVE_FAILURES', text: 'consecutive times on this' },
  { name: 'SUSPICION_REQUIRED', text: 'SUSPICION REQUIRED' },
  { name: 'BANNED_EDIT', text: 'BANNED: You have failed' },
  { name: 'BANNED_NOTEBOOK', text: 'BANNED from making further edit' },
  { name: 'UNPRODUCTIVE_LOOPS', text: 'unproductive loops' },
  { name: 'DETECT_YOURSELF', text: 'detect yourself repeatedly' },
  { name: 'INFINITE_LOOP_DETECT', text: 'infinite loop' },
  { name: 'RUNAWAY_DETECT', text: 'command timed out' },
  
  // Feature flags / experiments  
  { name: 'UNLEASH_CLIENT', text: 'unleash-client' },
  { name: 'UNLEASH_FEATURES', text: '/client/features' },
  { name: 'FEATURE_TOGGLE', text: 'flexibleRollout' },
  { name: 'EXPERIMENT_PARSE', text: 'experiment' },
  { name: 'VARIANT_DISABLED', text: 'Variant disabled' },
  { name: 'BASE_EXPERIMENTS', text: 'SetBaseExperiments' },
  { name: 'PROMPT_CONFIG_UNLEASH', text: 'prompt config from experiment' },
  
  // Telemetry / tracking
  { name: 'TELEMETRY_DISABLE', text: 'disableTelemetry' },
  { name: 'SENTRY_TELEMETRY', text: 'sentry_telemetry' },
  { name: 'SENTRY_ENVIRONMENT', text: 'SENTRY_ENVIRONMENT' },
  { name: 'ANALYTICS_SERVICE', text: 'AnalyticsService' },
  { name: 'CASCADE_ANALYTICS', text: 'CascadeAnalytics' },
  { name: 'TIME_SINCE_INSTALL', text: 'time_since_install' },
  { name: 'CODEIUM_PROFILING', text: 'codeium_profiling' },
  
  // Subscription / plan tiers
  { name: 'PLAN_INFO', text: 'plan_info' },
  { name: 'PLAN_TYPE', text: 'plan_type' },
  { name: 'PRO_TIER', text: 'pro_tier' },
  { name: 'FREE_TIER', text: 'FREE_TIER' },
  { name: 'PREMIUM_MODEL', text: 'premium_model' },
  { name: 'PREMIUM_ACTION', text: 'premium_action' },
  { name: 'SUBSCRIPTION_STATE', text: 'SubscriptionState' },
  
  // Step/turn limits
  { name: 'MAX_STEPS_CONFIG', text: 'max_steps' },
  { name: 'MAX_TURNS', text: 'max_turns' },
  { name: 'STEP_LIMIT', text: 'step_limit' },
  { name: 'CONTEXT_WINDOW_WARN', text: 'context window' },
  { name: 'CONTEXT_DELETED', text: 'CONTEXT, INCLUDING checkpoint summaries, will be deleted' },
  { name: 'TOKEN_BUDGET', text: 'token_budget' },
  { name: 'MAX_OUTPUT_TOKENS', text: 'max output tokens' },
  
  // Model assignment / arena
  { name: 'MODEL_ASSIGNMENT', text: 'model assignment' },
  { name: 'ARENA_CONVERGENCE', text: 'ConvergeArenaCascades' },
  { name: 'ARENA_JWT', text: 'arena_assignment_jwt' },
  { name: 'MODEL_ROUTER', text: 'model_router' },
  { name: 'DEV_MODEL_ROUTER', text: 'dev-model-router' },
  
  // Proxy / network detection
  { name: 'DETECT_PROXY', text: 'detect_proxy' },
  { name: 'PROXY_AUTH', text: 'proxy authentication' },
  { name: 'PROXY_WEB', text: 'proxy_web_server' },
  
  // Auto-approve / auto-run
  { name: 'AUTO_RUN_SAFE', text: 'SafeToAutoRun' },
  { name: 'AUTO_APPROVE', text: 'auto_approve' },
  { name: 'USER_REVIEWED', text: 'user reviewed the command' },
  
  // MCP / plugin safety
  { name: 'MCP_SAFETY', text: 'banned-extension' },
  { name: 'ALLOWED_DOMAINS', text: 'ALLOWED_DOMAINS' },
  { name: 'DISABLE_COOKIES', text: 'DISABLE_COOKIES' },
  { name: 'IGNORE_ROBOTS', text: 'IGNORE_ROBOTSTXT' },
  { name: 'FOLLOW_REDIRECTS', text: 'FOLLOW_REDIRECTS' },
];

const output = [];

for (const t of targets) {
  const idx = buf.indexOf(t.text);
  if (idx === -1) continue;
  
  // Get all occurrences
  const occurrences = [];
  let pos = 0;
  while (true) {
    pos = buf.indexOf(t.text, pos);
    if (pos === -1) break;
    occurrences.push(pos);
    pos += t.text.length;
  }
  
  // For each occurrence, extract surrounding readable text
  for (const occ of occurrences.slice(0, 3)) { // max 3 per target
    let start = occ;
    let bad = 0;
    while (start > 0 && bad < 2) {
      const b = buf[start - 1];
      if (b >= 32 && b <= 126 || b === 10 || b === 13 || b === 9) { start--; bad = 0; }
      else { bad++; start--; }
    }
    start += bad;
    
    let end = occ + t.text.length;
    bad = 0;
    while (end < buf.length && bad < 2) {
      const b = buf[end];
      if (b >= 32 && b <= 126 || b === 10 || b === 13 || b === 9) { end++; bad = 0; }
      else { bad++; end++; }
    }
    end -= bad;
    
    const full = buf.subarray(start, end).toString('utf-8');
    const anchorPos = full.indexOf(t.text);
    
    // Extract window around anchor
    const ws = Math.max(0, anchorPos - 400);
    const we = Math.min(full.length, anchorPos + t.text.length + 600);
    let extract = full.substring(ws, we);
    
    // Clean: only keep lines with decent readability
    const lines = extract.split('\n').filter(l => {
      if (l.length < 5) return false;
      const a = (l.match(/[a-zA-Z0-9 .,;:!?'"()\-_/{}\[\]<>=+*@#$%&|~`]/g) || []).length / l.length;
      return a > 0.55;
    });
    
    if (lines.length === 0) continue;
    extract = lines.join('\n');
    
    output.push({ name: t.name, offset: occ, text: extract });
  }
}

// Deduplicate by offset proximity
const deduped = [];
const seenOffsets = new Set();
for (const r of output.sort((a, b) => a.offset - b.offset)) {
  const key = Math.floor(r.offset / 200);
  if (seenOffsets.has(key)) continue;
  seenOffsets.add(key);
  deduped.push(r);
}

// Print findings
console.log(`=== Safety & Rate Limiting Analysis ===`);
console.log(`Total unique findings: ${deduped.length}\n`);

for (const r of deduped) {
  console.log(`\n${'━'.repeat(60)}`);
  console.log(`[${r.name}] @${r.offset}`);
  console.log(`${'━'.repeat(60)}`);
  console.log(r.text.substring(0, 800));
}
