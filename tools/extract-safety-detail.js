#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app',
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const buf = fs.readFileSync(binPath);

function extractAroundText(searchText, before = 400, after = 800) {
  const idx = buf.indexOf(searchText);
  if (idx === -1) return null;
  
  let start = Math.max(0, idx - before);
  let end = Math.min(buf.length, idx + searchText.length + after);
  
  const raw = buf.subarray(start, end).toString('utf-8');
  // Clean to readable lines
  const lines = raw.split('\n');
  const clean = [];
  for (const l of lines) {
    if (l.length < 3) continue;
    const a = (l.match(/[a-zA-Z0-9_ .,;:!?'"()\-/{}\[\]<>=+*@#$%&|~`]/g) || []).length / l.length;
    if (a > 0.55 && l.length < 600) clean.push(l);
  }
  return clean.join('\n');
}

const sections = [
  {
    title: 'LIFEGUARD - Go Source Files',
    search: 'lifeguard_agent_manager.go',
    before: 200, after: 2000
  },
  {
    title: 'LIFEGUARD INSTRUCTIONS',
    search: 'lifeguard_instructions',
    before: 300, after: 600
  },
  {
    title: 'BANNED EXTENSIONS',
    search: 'banned_extensions.go',
    before: 100, after: 1500
  },
  {
    title: 'CASCADE TOOLS ENABLED / READ ONLY',
    search: 'cascade_tools_enabled',
    before: 200, after: 800
  },
  {
    title: 'RATE LIMIT RPC - rpcs_check_user_message_rate_limit',
    search: 'rpcs_check_user_message_rate_limit',
    before: 200, after: 1200
  },
  {
    title: 'CHECK CHAT CAPACITY RPC',
    search: 'rpcs_check_chat_capacity',
    before: 200, after: 800
  },
  {
    title: 'ARENA MODE CONFIG',
    search: 'last_arena_mode_category',
    before: 400, after: 200
  },
  {
    title: 'MODEL ROUTER',
    search: 'dev-model-router',
    before: 200, after: 400
  },
  {
    title: 'PREMIUM MODEL STICKY',
    search: 'allow_sticky_premium_models',
    before: 200, after: 400
  },
  {
    title: 'MAX STEPS CONFIG',
    search: 'max_steps',
    before: 200, after: 400
  },
  {
    title: 'CONTEXT WINDOW WARNING (from prompt)',
    search: 'limited context window and ALL CONVERSATION CONTEXT',
    before: 100, after: 400
  },
  {
    title: 'QUOTA EXCEEDED',
    search: 'quota exceeded',
    before: 300, after: 400
  },
  {
    title: 'FEATURE FLAG - Unleash',
    search: 'cumulative prompt config from experiment',
    before: 300, after: 400
  },
  {
    title: 'COGNITION LIFEGUARD MODEL',
    search: 'cognition-lifeguard',
    before: 200, after: 400
  },
  {
    title: 'CONTENT FILTER', 
    search: 'content_filter',
    before: 200, after: 400
  },
  {
    title: 'FLOW ACTION CREDITS',
    search: 'flow_action_credit',
    before: 300, after: 500
  },
  {
    title: 'CASCADE DELETION / TRAJECTORY',
    search: 'cascade_deletions',
    before: 200, after: 600
  },
  {
    title: 'ENABLE MODEL BASED AUTO EXECUTION',
    search: 'enable_model_based_auto_execution',
    before: 200, after: 600
  },
  {
    title: 'AUTO RUN IN PROMPT',
    search: 'SafeToAutoRun',
    before: 300, after: 400
  },
  {
    title: 'UNPRODUCTIVE LOOPS',
    search: 'unproductive loops',
    before: 200, after: 400
  },
  {
    title: 'CONSECUTIVE FAILURES -> SUSPICION',
    search: 'EXTREME SUSPICION REQUIRED',
    before: 200, after: 600
  },
  {
    title: 'CONSECUTIVE FAILURES -> BANNED',
    search: 'BANNED: You have failed %d consecutive times on this file',
    before: 100, after: 400
  },
  {
    title: 'BUG DETECTION CATEGORIES',
    search: 'Bug Categories (Non-Exhaustive)',
    before: 200, after: 1000
  },
  {
    title: 'SENTRY TELEMETRY',
    search: 'sentry_telemetry',
    before: 200, after: 400
  },
  {
    title: 'MCP BANNED EXTENSION',
    search: 'banned-extension',
    before: 200, after: 600
  },
  {
    title: 'USER ALLOWLIST',
    search: 'GetUserAllowlist',
    before: 200, after: 400
  },
];

for (const s of sections) {
  const text = extractAroundText(s.search, s.before || 400, s.after || 800);
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`▎${s.title}`);
  console.log(`${'═'.repeat(70)}`);
  if (text) {
    console.log(text.substring(0, 1500));
  } else {
    console.log('NOT FOUND');
  }
}
