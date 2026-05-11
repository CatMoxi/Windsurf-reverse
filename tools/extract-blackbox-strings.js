/**
 * Extract binary strings for unexplored "black box" areas from LS binary.
 * Targets: DevService, ACU billing, Code Tracker, Deep Think, Virtual FS,
 *          Database layer, Supercomplete, TabJump, DeepWiki, Auto Cascade,
 *          Proxy Web Server, Extension Code Execution, trainer/eval internals.
 */
const fs = require('fs');
const path = require('path');

// Find the LS binary
const possiblePaths = [
  path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf-language-server', 'language_server_windows_x64.exe'),
];
let binaryPath = null;
for (const p of possiblePaths) {
  if (fs.existsSync(p)) { binaryPath = p; break; }
}
if (!binaryPath) {
  // Try to find it
  const { execSync } = require('child_process');
  try {
    const result = execSync('where /r "' + path.join(__dirname, '..', 'windsurf-next') + '" language_server_windows_x64.exe', { encoding: 'utf8', timeout: 30000 });
    binaryPath = result.trim().split('\n')[0].trim();
  } catch(e) {}
}
if (!binaryPath) {
  console.error('Cannot find language_server binary. Place windsurf-next/ in project root.');
  process.exit(1);
}

console.log(`Binary: ${binaryPath}`);
const stats = fs.statSync(binaryPath);
console.log(`Size: ${(stats.size / 1024 / 1024).toFixed(1)} MB\n`);

// Read binary as latin1 to preserve bytes as single chars
const binary = fs.readFileSync(binaryPath, 'latin1');

function searchPatterns(label, patterns) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${'='.repeat(70)}`);
  let totalMatches = 0;
  for (const pat of patterns) {
    const regex = new RegExp(pat, 'gi');
    const matches = new Set();
    let m;
    while ((m = regex.exec(binary)) !== null) {
      // Extract readable context around match
      const start = Math.max(0, m.index - 20);
      const end = Math.min(binary.length, m.index + m[0].length + 40);
      let ctx = binary.slice(start, end).replace(/[^\x20-\x7E]/g, '.');
      matches.add(ctx);
      if (matches.size > 50) break;
    }
    if (matches.size > 0) {
      console.log(`\n  [${pat}] → ${matches.size} unique matches:`);
      let i = 0;
      for (const ctx of matches) {
        if (i++ >= 25) { console.log(`    ... (${matches.size - 25} more)`); break; }
        console.log(`    ${ctx}`);
      }
      totalMatches += matches.size;
    }
  }
  if (totalMatches === 0) console.log('  (no matches)');
  return totalMatches;
}

function searchGoFuncs(label, patterns) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`  Go Functions: ${label}`);
  console.log(`${'='.repeat(70)}`);
  const funcRegex = /github\.com\/Exafunction\/Exafunction\/exa\/language_server\/[a-z_\/]+\.[A-Z][A-Za-z0-9_]*/g;
  const all = new Set();
  let m;
  while ((m = funcRegex.exec(binary)) !== null) {
    for (const pat of patterns) {
      if (m[0].toLowerCase().includes(pat.toLowerCase())) {
        all.add(m[0]);
      }
    }
  }
  const sorted = [...all].sort();
  console.log(`  Found ${sorted.length} Go functions:`);
  for (const f of sorted) {
    console.log(`    ${f}`);
  }
  return sorted.length;
}

// ===================== EXTRACTION TARGETS =====================

// 1. DevService - Debug backdoor
searchPatterns('1. DevService / Debug Commands', [
  'DevService', 'DevRequest', 'DevResponse',
  '/dev_pb\\.Dev', 'GetLSPCompletionItems',
  'dev_command', 'dev_mode',
]);
searchGoFuncs('DevService', ['dev']);

// 2. ACU Billing System
searchPatterns('2. ACU (Active Compute Units) Billing', [
  'acu_billing', 'AcuConfig', 'AcuBilling',
  'cycle_acu', 'acu_multiplier', 'acu_limit',
  'ActiveComputeUnit', 'SelfHostedAcu',
  'billing_strategy', 'BillingStrategy',
  'usage_micros', 'daily_usage', 'weekly_usage',
  'quota_usage', 'QuotaUsage',
]);
searchGoFuncs('ACU/Billing', ['acu', 'billing', 'quota']);

// 3. Code Tracker / ByteDelta
searchPatterns('3. Code Tracker / ByteDelta', [
  'ByteDelta', 'CodeTracker', 'code_tracker',
  'bytes_added', 'bytes_deleted',
  'CodeSource', 'code_source',
  'RecordCodeTracker',
]);
searchGoFuncs('CodeTracker', ['code_tracker', 'byte_delta']);

// 4. Deep Think
searchPatterns('4. Deep Think System', [
  'DeepThink', 'deep_think', 'exploration_document',
  'last_planner_response',
  'CortexStepDeepThink',
]);
searchGoFuncs('DeepThink', ['deep_think', 'exploration']);

// 5. Virtual FS
searchPatterns('5. Virtual Filesystem', [
  'virtual_fs', 'VirtualFs', 'serialized_overlay',
  'fs_overlay', 'file_state_override',
]);
searchGoFuncs('VirtualFS', ['virtual_fs', 'overlay']);

// 6. Database Layer
searchPatterns('6. Database Layer (local storage)', [
  'database_dir', 'bolt\\.db', 'sqlite',
  'bbolt', 'boltdb', 'badger',
  'leveldb', 'pebble',
  '\\.db"', 'OpenDatabase', 'CloseDatabase',
]);
searchGoFuncs('Database', ['database', 'db_', 'storage', 'persist']);

// 7. Supercomplete
searchPatterns('7. Supercomplete Internal', [
  'SuperComplete', 'supercomplete',
  'SupercompleteTrigger', 'SupercompleteFilter',
  'SUPERCOMPLETE', 'super_complete',
]);
searchGoFuncs('Supercomplete', ['supercomplete', 'super_complete']);

// 8. TabJump / Tab prediction
searchPatterns('8. TabJump / Tab Prediction', [
  'TabJump', 'tab_jump', 'TabToJump',
  'tab_to_jump', 'GetTab',
  'JumpTarget', 'jump_target',
  'tab_model', 'TAB_MODEL',
]);
searchGoFuncs('TabJump', ['tab_jump', 'tab_to_jump', 'tab']);

// 9. DeepWiki
searchPatterns('9. DeepWiki System', [
  'DeepWiki', 'deep_wiki', 'deepwiki',
  'GetDeepWiki', 'DeepWikiModel',
]);
searchGoFuncs('DeepWiki', ['deep_wiki', 'deepwiki']);

// 10. Auto Cascade
searchPatterns('10. Auto Cascade (Async PR/CF)', [
  'AutoCascade', 'auto_cascade',
  'ASYNC_PRR', 'ASYNC_CF',
  'async_pr_review', 'async_code_fix',
  'auto_cascade_mode',
]);
searchGoFuncs('AutoCascade', ['auto_cascade', 'async_pr', 'async_cf']);

// 11. Proxy Web Server
searchPatterns('11. Proxy Web Server', [
  'ProxyWebServer', 'proxy_web_server',
  'proxy_url', 'target_url.*proxy',
]);
searchGoFuncs('ProxyWebServer', ['proxy_web', 'proxy_server']);

// 12. Extension Code Execution
searchPatterns('12. Extension Code Execution', [
  'RunExtensionCode', 'run_extension_code',
  'extension_code', 'auto_run_decision',
]);
searchGoFuncs('ExtensionCode', ['extension_code', 'run_extension']);

// 13. Trainer internal
searchPatterns('13. Trainer Internals', [
  'TrainerConfig', 'trainer_pb',
  'GRPO', 'DPO.*config', 'KTO.*config',
  'knowledge_distillation',
  'train_objective', 'TrainObjective',
  'MixtureOfExperts', 'MultiTokenPrediction',
  'SglangInference', 'sglang',
  'megatron', 'speculative_copy',
  'weight_update',
]);

// 14. Checkpoint system
searchPatterns('14. Checkpoint System', [
  'CHECKPOINT', 'checkpoint_summary',
  'checkpoint_cache', 'TrajectoryPrefix',
  'num_skipped', 'num_truncated',
]);

// 15. Overage / Valkey
searchPatterns('15. Overage & Valkey (Redis)', [
  'overage_balance', 'valkey',
  'OverageBalance', 'exists_in_valkey',
  'postgres_balance',
]);

// 16. Lifeguard
searchPatterns('16. Lifeguard (AI Safety)', [
  'Lifeguard', 'lifeguard',
  'LifeguardBug', 'ReportBugs',
  'cognition-lifeguard',
]);
searchGoFuncs('Lifeguard', ['lifeguard']);

// 17. Recipe / Custom Tool
searchPatterns('17. Recipe / Custom Tool System', [
  'CustomTool', 'custom_tool',
  'recipe_id', 'CreateRecipe',
  'CortexStepCustomTool',
]);
searchGoFuncs('Recipe', ['recipe', 'custom_tool']);

// 18. Heuristic Prompts / Ephemeral Messages
searchPatterns('18. Heuristic Prompts & Ephemeral Messages', [
  'EphemeralMessage', 'ephemeral_message',
  'HeuristicPrompt', 'heuristic_prompt',
]);

// 19. Proposal Feedback / Replacement Chunks
searchPatterns('19. Proposal Feedback System', [
  'ProposalFeedback', 'proposal_feedback',
  'ReplacementChunk', 'replacement_chunk',
  'AcknowledgementType',
]);

// 20. Manager Feedback / Multi-agent
searchPatterns('20. Manager Feedback / Multi-Agent', [
  'ManagerFeedback', 'manager_feedback',
  'ToolCallChoice', 'TrajectoryChoice',
  'ToolCallProposal',
]);

console.log('\n\nDone. Extraction complete.');
