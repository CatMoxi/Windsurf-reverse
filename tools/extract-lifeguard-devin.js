#!/usr/bin/env node
/**
 * Deep extraction: Lifeguard, Devin integration, Annoyance Manager,
 * and detailed behavior detection strings.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app',
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const buf = fs.readFileSync(binPath);

function extractBlock(searchText, beforeBytes, afterBytes) {
  const results = [];
  let pos = 0;
  while (true) {
    pos = buf.indexOf(searchText, pos);
    if (pos === -1) break;
    
    let start = Math.max(0, pos - beforeBytes);
    let end = Math.min(buf.length, pos + searchText.length + afterBytes);
    const raw = buf.subarray(start, end).toString('utf-8');
    
    // Clean to readable text
    const lines = raw.split('\n');
    const clean = [];
    for (const l of lines) {
      if (l.length < 3) continue;
      const a = (l.match(/[a-zA-Z0-9_ .,;:!?'"()\-/{}\[\]<>=+*@#$%&|~`%\\\t]/g) || []).length / l.length;
      if (a > 0.5 && l.length > 5 && l.length < 800) clean.push(l);
    }
    results.push({ offset: pos, text: clean.join('\n') });
    pos += searchText.length;
  }
  return results;
}

const sections = [
  // Lifeguard detailed
  { name: 'LIFEGUARD_MANAGER', search: 'lifeguard_agent_manager', before: 100, after: 2000 },
  { name: 'LIFEGUARD_CHECK', search: 'lifeguard check', before: 200, after: 600 },
  { name: 'LIFEGUARD_RESPONSE', search: 'lifeguard_response', before: 200, after: 400 },
  { name: 'LIFEGUARD_RESULT', search: 'lifeguard_result', before: 200, after: 400 },
  { name: 'LIFEGUARD_V2', search: 'lifeguard_v2', before: 200, after: 400 },
  { name: 'COGNITION_LIFEGUARD_MODEL', search: 'cognition-lifeguard', before: 400, after: 400 },
  { name: 'LIFEGUARD_SKIP', search: 'skip lifeguard', before: 200, after: 400 },
  { name: 'LIFEGUARD_BYPASS', search: 'bypass lifeguard', before: 200, after: 400 },
  { name: 'LIFEGUARD_TIMEOUT', search: 'lifeguard timeout', before: 200, after: 400 },
  { name: 'LIFEGUARD_ERROR', search: 'lifeguard error', before: 200, after: 400 },
  { name: 'LIFEGUARD_BLOCK', search: 'lifeguard block', before: 200, after: 400 },
  { name: 'LIFEGUARD_ALLOW', search: 'lifeguard allow', before: 200, after: 400 },

  // Devin integration
  { name: 'DEVIN_USER_ID', search: 'devin_user_id', before: 200, after: 400 },
  { name: 'DEVIN_ACCOUNT', search: 'devin_account_id', before: 200, after: 400 },
  { name: 'DEVIN_SESSION', search: 'devin-session-token', before: 200, after: 600 },
  { name: 'DEVIN_AUTH1', search: 'X-Devin-Auth1-Token', before: 200, after: 400 },
  { name: 'DEVIN_PLAN', search: 'DevinPlanInfo', before: 200, after: 600 },
  { name: 'DEVIN_CODE', search: 'ExchangeDevinCode', before: 200, after: 400 },
  { name: 'DEVIN_ASSISTANT', search: "DEVIN'S ASSISTANT", before: 200, after: 400 },
  { name: 'IS_DEVIN', search: 'is_devin', before: 200, after: 400 },

  // Annoyance Manager
  { name: 'ANNOYANCE_MANAGER', search: 'AnnoyanceManager', before: 200, after: 600 },
  { name: 'ANNOYANCE_INLINE', search: 'annoyance_inline', before: 200, after: 400 },
  { name: 'INTENTIONAL_REJECTION', search: 'intentional_rejection', before: 200, after: 400 },
  { name: 'AUTO_REJECTION', search: 'auto_rejection', before: 200, after: 400 },
  { name: 'REJECTION_COUNT', search: 'rejection_count', before: 200, after: 400 },

  // Command safety/auto-run
  { name: 'AUTO_EXECUTE', search: 'auto_execute', before: 300, after: 400 },
  { name: 'SAFE_TO_AUTO_RUN', search: 'safe_to_auto_run', before: 200, after: 400 },
  { name: 'COMMAND_ALLOWLIST', search: 'command_allowlist', before: 200, after: 400 },
  { name: 'COMMAND_BLOCKLIST', search: 'command_blocklist', before: 200, after: 400 },
  { name: 'AUTO_RUN_POLICY', search: 'auto_run_policy', before: 200, after: 400 },
  { name: 'WEB_AUTO_EXECUTION', search: 'web_requests_auto_execution', before: 200, after: 600 },
  
  // Cascade step/turn tracking
  { name: 'STEP_COMPLETED', search: 'CASCADE_STEP_COMPLETED', before: 200, after: 400 },
  { name: 'STEP_INDEX', search: 'step_index', before: 200, after: 600 },
  { name: 'STEP_LIMIT', search: 'step limit', before: 200, after: 400 },
  { name: 'PLANNER_MODE', search: 'ConversationalPlannerMode', before: 200, after: 600 },
  { name: 'READ_ONLY_ACTIONS', search: 'read_only_actions', before: 200, after: 400 },
  
  // Model capacity/fallback
  { name: 'CAPACITY_FALLBACK', search: 'CAPACITY_FALLBACK', before: 200, after: 400 },
  { name: 'CAPACITY_LIMITED', search: 'is_capacity_limited', before: 200, after: 400 },
  { name: 'MODEL_STATUS', search: 'GetModelStatuses', before: 200, after: 400 },
  { name: 'FAST_STATUS', search: 'FastStatus', before: 200, after: 400 },

  // Cascade deletion/cleanup
  { name: 'CASCADE_DELETIONS', search: 'cascade_deletions', before: 200, after: 400 },
  { name: 'OVERALL_DELETIONS', search: 'overall_deletions', before: 200, after: 400 },
  { name: 'MAX_WORKTREES', search: 'max worktrees', before: 200, after: 400 },
  
  // Fingerprint
  { name: 'DEVICE_FINGERPRINT', search: 'device_fingerprint', before: 200, after: 400 },
  { name: 'FINGERPRINT_SET', search: 'has_fingerprint_set', before: 200, after: 400 },
  
  // Proxy detection
  { name: 'DETECT_PROXY', search: '--detect_proxy', before: 100, after: 600 },
  { name: 'PROXY_WEB_SERVER', search: 'proxy_web_server', before: 200, after: 400 },
  { name: 'MITM_DETECT', search: 'MitM attack', before: 200, after: 400 },
  
  // Session controls
  { name: 'MAX_SESSION_DURATION', search: 'max_session_duration', before: 200, after: 400 },
  { name: 'SESSION_TIMEOUT', search: 'session timeout', before: 200, after: 400 },
  
  // Kill switches
  { name: 'KILL_SWITCH', search: 'KILL_SWITCH', before: 100, after: 200 },
  { name: 'API_CUTOFF', search: 'API_SERVER_CUTOFF', before: 100, after: 200 },
];

for (const s of sections) {
  const results = extractBlock(s.search, s.before, s.after);
  if (results.length === 0) continue;
  
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`▎${s.name} (${results.length} hit${results.length > 1 ? 's' : ''})`);
  console.log(`${'═'.repeat(65)}`);
  
  // Show first occurrence, trimmed
  const text = results[0].text;
  console.log(`@offset ${results[0].offset}`);
  console.log(text.substring(0, 1200));
  
  if (results.length > 1) {
    console.log(`\n  ... +${results.length - 1} more occurrences`);
  }
}
