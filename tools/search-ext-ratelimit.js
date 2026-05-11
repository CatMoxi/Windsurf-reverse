#!/usr/bin/env node
const fs = require('fs');
const src = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/dist/extension.js', 'utf-8');

const patterns = [
  'checkUserMessageRateLimit', 'CheckUserMessageRateLimit',
  'checkChatCapacity', 'CheckChatCapacity',
  'hasCapacity', 'messagesRemaining', 'maxMessages',
  'activeSession', 'quotaRemaining', 'dailyQuota', 'weeklyQuota',
  'creditCost', 'premiumModel', 'rateLimitMessage',
  'rateLimitExceeded', 'no_capacity', 'overageBalance',
  'gracePeriod', 'planStatus', 'planInfo',
  'availablePromptCredits', 'availableFlowCredits',
  'usedPromptCredits', 'usedFlowCredits', 'flexCredits',
  'creditMultiplier', 'isCapacityLimited', 'isPremium',
  'arenaInvocationCapReached', 'committedCreditCost',
  'committedQuotaCostBasisPoints', 'committedOverageCostCents',
  'deviceFingerprint', 'hasFingerprintSet',
  'lifeguardConfig', 'lifeguardMode', 'disableLifeguard',
  'annoyanceManager', 'AnnoyanceManager',
  'maxIntentionalRejections', 'maxAutoRejections',
  'autoExecutionPolicy', 'forceDisable',
  'allowlist', 'denylist', 'nooplist',
  'killSwitch', 'apiServerCutoff',
  'cyberVerification', 'maxSessionDuration',
  'recordCascadeUsage', 'RecordCascadeUsage',
  'CASCADE_ENFORCE_QUOTA', 'cascadeEnforceQuota',
];

console.log('=== Extension.js Rate Limit / Safety Pattern Hits ===\n');

for (const p of patterns) {
  const re = new RegExp(p, 'gi');
  const matches = src.match(re);
  if (matches) {
    console.log(`  ${p}: ${matches.length} hits`);
  }
}

// Now extract context around key patterns
console.log('\n=== Context Extraction ===\n');

const keyPatterns = [
  'checkUserMessageRateLimit',
  'checkChatCapacity',
  'hasCapacity',
  'messagesRemaining',
  'creditCost',
  'rateLimitExceeded',
  'gracePeriod',
  'quotaRemaining',
  'overageBalance',
  'arenaInvocationCapReached',
  'annoyanceManager',
  'recordCascadeUsage',
  'lifeguardConfig',
  'deviceFingerprint',
];

for (const p of keyPatterns) {
  const idx = src.indexOf(p);
  if (idx === -1) continue;
  
  // Extract ~200 chars around each occurrence
  const start = Math.max(0, idx - 100);
  const end = Math.min(src.length, idx + p.length + 200);
  const ctx = src.substring(start, end);
  
  console.log(`\n--- ${p} @${idx} ---`);
  console.log(ctx.replace(/\n/g, ' ').substring(0, 400));
}
