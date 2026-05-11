// Extract Deploy, Browser, Forge, Arena, and Model Router system strings from LS binary
const fs = require('fs');
const path = require('path');

const binaryPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const buf = fs.readFileSync(binaryPath);
const text = buf.toString('latin1');

const searches = [
  // Deploy system
  { name: 'Deploy/Windsurf.build', patterns: ['windsurf.build', 'deploy_web_app', 'deployment_provider', 'netlify', 'WindsurfProject', 'claimed_at', 'sandbox_app'] },
  // Browser preview system
  { name: 'Browser Preview', patterns: ['browser_preview', 'BrowserPage', 'DOMTree', 'DOMElement', 'screenshot', 'chromium', 'playwright', 'puppeteer', 'browser_install'] },
  // Arena/Battle system
  { name: 'Arena System', patterns: ['arena_mode', 'arena_spawn', 'arena_converge', 'battle_group', 'arena_tier', 'MODEL_ROUTER'] },
  // Forge/CLI system
  { name: 'Forge/CLI', patterns: ['forge', 'cli_model', 'cli_access', 'devin_cli', 'bundling_devin', 'cli_permissions'] },
  // Vibe and Replace
  { name: 'Vibe and Replace', patterns: ['vibe_and_replace', 'VibeAndReplace', 'vibe_replace'] },
  // CodeMap system
  { name: 'CodeMap', patterns: ['code_map', 'CodeMap', 'codemap', 'CODEMAP'] },
  // Worktree system
  { name: 'Worktree', patterns: ['worktree', 'Worktree', 'git_worktree'] },
  // Quick Review
  { name: 'Quick Review', patterns: ['quick_review', 'QuickReview', 'pull_request_review'] },
  // Model routing/harness
  { name: 'Model Harness/Routing', patterns: ['harness_uid', 'model_harness', 'model_router', 'inference_config', 'reasoning_effort'] },
  // Instant Context
  { name: 'Instant Context', patterns: ['instant_context', 'InstantContext', 'INSTANT_CONTEXT'] },
];

for (const search of searches) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`## ${search.name}`);
  console.log('='.repeat(80));
  
  for (const pattern of search.patterns) {
    const regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let match;
    let count = 0;
    const contexts = [];
    
    while ((match = regex.exec(text)) !== null && count < 5) {
      const start = Math.max(0, match.index - 100);
      const end = Math.min(text.length, match.index + pattern.length + 150);
      let ctx = text.slice(start, end).replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').trim();
      // Deduplicate
      if (!contexts.some(c => c.includes(ctx.slice(0, 50)))) {
        contexts.push(ctx);
        count++;
      }
    }
    
    // Count total occurrences
    let total = 0;
    const countRegex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    while (countRegex.exec(text) !== null) total++;
    
    if (total > 0) {
      console.log(`\n### "${pattern}" (${total} occurrences)`);
      contexts.forEach((ctx, i) => {
        console.log(`  [${i+1}] ...${ctx}...`);
      });
    }
  }
}

// Also extract Go function names related to these systems
console.log(`\n${'='.repeat(80)}`);
console.log('## Go Functions - Deploy/Browser/Arena/Forge');
console.log('='.repeat(80));

const goFuncPatterns = [
  /exa\/language_server\/[a-z_]+\/[a-z_]+/g,
  /exa\/cortex\/[a-z_]+\/[a-z_]+\/[a-z_]+/g,
  /Deploy[A-Z][a-zA-Z]+/g,
  /Browser[A-Z][a-zA-Z]+/g,
  /Arena[A-Z][a-zA-Z]+/g,
  /Forge[A-Z][a-zA-Z]+/g,
  /Worktree[A-Z][a-zA-Z]+/g,
  /CodeMap[A-Z][a-zA-Z]+/g,
];

for (const pat of goFuncPatterns) {
  const found = new Set();
  let m;
  while ((m = pat.exec(text)) !== null) {
    const val = m[0];
    if (val.length > 8 && val.length < 80) found.add(val);
  }
  if (found.size > 0) {
    console.log(`\nPattern: ${pat.source} (${found.size} unique)`);
    [...found].sort().slice(0, 40).forEach(v => console.log(`  ${v}`));
    if (found.size > 40) console.log(`  ... and ${found.size - 40} more`);
  }
}
