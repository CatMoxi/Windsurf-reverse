#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app',
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const buf = fs.readFileSync(binPath);

function findAndExtract(searchText, contextBefore, contextAfter) {
  let pos = 0;
  const results = [];
  while (true) {
    pos = buf.indexOf(searchText, pos);
    if (pos === -1) break;
    
    // Walk back to find start of readable block
    let s = pos - contextBefore;
    if (s < 0) s = 0;
    let e = pos + searchText.length + contextAfter;
    if (e > buf.length) e = buf.length;
    
    const raw = buf.subarray(s, e).toString('utf-8')
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
    results.push({ offset: pos, text: raw });
    pos += searchText.length;
  }
  return results;
}

console.log('=== 1. LIFEGUARD SYSTEM PROMPT ===\n');
const lg1 = findAndExtract('lifeguard_v2_system_prompt', 100, 2000);
for (const r of lg1) {
  console.log(`@${r.offset}:`);
  // Find the prompt text nearby
  const cleaned = r.text.split('\n').filter(l => l.length > 10).join('\n');
  console.log(cleaned.substring(0, 1500));
}

console.log('\n=== 2. LIFEGUARD INSTRUCTIONS FIELD ===\n');
const lg2 = findAndExtract('lifeguard_instructions', 100, 500);
for (const r of lg2) {
  console.log(`@${r.offset}: ${r.text.substring(0, 400)}\n`);
}

console.log('\n=== 3. MODEL_COGNITION_LIFEGUARD PROMPT ===\n');
const lg3 = findAndExtract('MODEL_COGNITION_LIFEGUARD', 200, 800);
for (const r of lg3) {
  console.log(`@${r.offset}: ${r.text.substring(0, 600)}\n`);
}

console.log('\n=== 4. MAX WORKTREES / ENFORCE ===\n');
const mw = findAndExtract('enforce max worktrees', 100, 800);
for (const r of mw) {
  console.log(`@${r.offset}: ${r.text.substring(0, 600)}\n`);
}

console.log('\n=== 5. CASCADE CONFIG KEYS (from binary strings) ===\n');
const cfgKeys = [
  'cascade_tools_enabled', 'cascade_read_only_mode', 'enable_model_based_auto_execution',
  'cascade_run_extension_code', 'cascade_run_extension_code_auto_run',
  'cascade_input_autocomplete', 'claude_code_max_turns', 'claude_code_system_prompt',
  'disable_superflow', 'last_arena_mode_category',
  'cascade_user_allowed_web_origins', 'cascade_web_requests_auto_execution_policy',
];
for (const key of cfgKeys) {
  const idx = buf.indexOf(key);
  if (idx !== -1) {
    console.log(`  ${key} @${idx}`);
  }
}

console.log('\n=== 6. PLAN MODE BEHAVIOR ===\n');
const pm = findAndExtract('Adding exit plan mode tool', 50, 600);
for (const r of pm) {
  console.log(`@${r.offset}: ${r.text.substring(0, 500)}\n`);
}

console.log('\n=== 7. COMMAND TIMEOUT / TIMED OUT ===\n');
const ct = findAndExtract('command timed out', 200, 600);
for (const r of ct) {
  const cleaned = r.text.split('\n').filter(l => l.length > 10).join('\n');
  console.log(`@${r.offset}:\n${cleaned.substring(0, 600)}\n`);
}

console.log('\n=== 8. EPHEMERAL MESSAGES ===\n');
const em = findAndExtract('ephemeral_message', 100, 400);
for (const r of em) {
  console.log(`@${r.offset}: ${r.text.substring(0, 400)}\n`);
}

console.log('\n=== 9. ARENA CONVERGENCE DETAILS ===\n');
const ac = findAndExtract('ConvergeArenaCascades', 100, 600);
for (const r of ac) {
  const cleaned = r.text.split('\n').filter(l => l.length > 10).join('\n');
  console.log(`@${r.offset}:\n${cleaned.substring(0, 600)}\n`);
}

console.log('\n=== 10. DEVIN PLAN INFO DETAILS ===\n');
const dp = findAndExtract('can_use_cascade', 200, 400);
for (const r of dp.slice(0, 3)) {
  console.log(`@${r.offset}: ${r.text.substring(0, 400)}\n`);
}

console.log('\n=== 11. TOOL CALL PRICING NUX ===\n');
const tp = findAndExtract('CASCADE_TOOL_CALL_PRICING', 100, 600);
for (const r of tp) {
  console.log(`@${r.offset}: ${r.text.substring(0, 500)}\n`);
}

console.log('\n=== 12. SERVER-SIDE PRICING ===\n');
const sp = findAndExtract('server-side-pricing', 200, 400);
for (const r of sp) {
  console.log(`@${r.offset}: ${r.text.substring(0, 400)}\n`);
}

console.log('\n=== 13. GRACE PERIOD LOGIC ===\n');
const gp = findAndExtract('grace_period', 200, 400);
for (const r of gp.slice(0, 3)) {
  console.log(`@${r.offset}: ${r.text.substring(0, 400)}\n`);
}

console.log('\n=== 14. CONTEXT DELETION WARNING ===\n');
const cd = findAndExtract('CONTEXT, INCLUDING checkpoint summaries, will be deleted', 300, 500);
for (const r of cd) {
  console.log(`@${r.offset}: ${r.text.substring(0, 600)}\n`);
}

console.log('\n=== 15. CAPACITY LIMITED HANDLING ===\n');
const cl = findAndExtract('Model provider unreachable', 200, 400);
for (const r of cl) {
  console.log(`@${r.offset}: ${r.text.substring(0, 400)}\n`);
}

console.log('\n=== 16. CYBER VERIFICATION ===\n');
const cv = findAndExtract('CYBER_VERIFICATION', 100, 400);
for (const r of cv) {
  console.log(`@${r.offset}: ${r.text.substring(0, 400)}\n`);
}
