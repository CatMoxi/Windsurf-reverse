#!/usr/bin/env node
const fs = require('fs');
const src = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/dist/extension.js', 'utf-8');

function extractContexts(pattern, beforeChars, afterChars, maxHits) {
  const results = [];
  let pos = 0;
  while (results.length < (maxHits || 5)) {
    pos = src.indexOf(pattern, pos);
    if (pos === -1) break;
    const start = Math.max(0, pos - beforeChars);
    const end = Math.min(src.length, pos + pattern.length + afterChars);
    results.push({ offset: pos, text: src.substring(start, end) });
    pos += pattern.length;
  }
  return results;
}

// 1. How extension calls rate limit check
console.log('=== 1. RATE LIMIT CALL FLOW ===\n');
const rlCalls = extractContexts('.checkUserMessageRateLimit(', 100, 500, 3);
for (const r of rlCalls) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 600));
  console.log();
}

// 2. Chat capacity check flow
console.log('\n=== 2. CHAT CAPACITY CALL FLOW ===\n');
const ccCalls = extractContexts('.checkChatCapacity(', 100, 500, 3);
for (const r of ccCalls) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 600));
  console.log();
}

// 3. How hasCapacity response is handled
console.log('\n=== 3. HAS_CAPACITY RESPONSE HANDLING ===\n');
const hcHandling = extractContexts('hasCapacity', 200, 400, 5);
for (const r of hcHandling) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 500));
  console.log();
}

// 4. Daily/weekly quota display
console.log('\n=== 4. DAILY/WEEKLY QUOTA DISPLAY ===\n');
const dqDisplay = extractContexts('dailyQuota', 200, 400, 4);
for (const r of dqDisplay) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 500));
  console.log();
}

// 5. Overage balance handling
console.log('\n=== 5. OVERAGE BALANCE HANDLING ===\n');
const ovHandling = extractContexts('overageBalance', 200, 400, 5);
for (const r of ovHandling) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 500));
  console.log();
}

// 6. Grace period logic
console.log('\n=== 6. GRACE PERIOD UI LOGIC ===\n');
const gpLogic = extractContexts('gracePeriodStatus', 200, 400, 5);
for (const r of gpLogic) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 500));
  console.log();
}

// 7. Annoyance Manager internals
console.log('\n=== 7. ANNOYANCE MANAGER IMPLEMENTATION ===\n');
const amImpl = extractContexts('AnnoyanceManager', 100, 600, 4);
for (const r of amImpl) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 700));
  console.log();
}

// 8. Flex credits purchase flow
console.log('\n=== 8. FLEX CREDITS / PURCHASE ===\n');
const fcFlow = extractContexts('purchaseCascadeCredits', 200, 400, 3);
for (const r of fcFlow) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 500));
  console.log();
}

// 9. Credit top-up auto settings  
console.log('\n=== 9. CREDIT TOP-UP AUTO ===\n');
const tuFlow = extractContexts('updateCreditTopUp', 200, 400, 3);
for (const r of tuFlow) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 500));
  console.log();
}

// 10. CASCADE_ENFORCE_QUOTA handling
console.log('\n=== 10. CASCADE_ENFORCE_QUOTA ===\n');
const ceq = extractContexts('CASCADE_ENFORCE_QUOTA', 200, 400, 3);
for (const r of ceq) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 500));
  console.log();
}

// 11. Arena invocation cap
console.log('\n=== 11. ARENA INVOCATION CAP ===\n');
const aic = extractContexts('arenaInvocationCapReached', 200, 400, 3);
for (const r of aic) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 500));
  console.log();
}

// 12. Kill switch
console.log('\n=== 12. KILL SWITCH ===\n');
const ks = extractContexts('killSwitch', 200, 400, 3);
for (const r of ks) {
  console.log(`@${r.offset}:`);
  console.log(r.text.substring(0, 500));
  console.log();
}
