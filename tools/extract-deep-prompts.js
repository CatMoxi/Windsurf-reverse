#!/usr/bin/env node
/**
 * Deep extraction: find specific prompt template strings that are stored
 * as Go string literals. Go stores strings in .rodata and references them
 * via (pointer, length) pairs. We search for longer meaningful text chunks.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');

const buf = fs.readFileSync(binPath);

// Search for specific unique phrases and extract context
const queries = [
  // Planning/thinking
  'Skip planning for straightforward tasks',
  'Use a plan when',
  'planning_guidance',
  'thinking_protocol',
  'update_plan',
  'create_plan',
  'PLAN entry update',
  // Communication 
  'Brevity is very important',
  'Refer to the USER in the second person',
  'No acknowledgment phrases',
  'Direct responses: Begin responses',
  'Code style: Do not add',
  'Jump straight into addressing',
  // Memory
  'Global rules: System-wide rules',
  'User-provided memories',
  'System-retrieved memories',
  'persistent database with three types',
  'semantically related memory',
  // Workflows
  'well-defined steps on how to achieve',
  'turbo annotation',
  '// turbo',
  'slash command',
  // Ask mode
  'you cannot make any edits directly',
  'switch to Code mode',
  // Debugging
  'Address the root cause instead',
  'Add descriptive logging',
  // Task management
  'update_plan to manage work',
  'Limit plans to concise steps',
  // Running commands
  'NEVER NEVER run a command automatically',
  'safety protocols if the USER attempts',
  // IDE metadata  
  'state of the user\'s IDE',
  'metadata will not necessarily be relevant',
  // Calling APIs
  'API Key, be sure to point this out',
  'DO NOT hardcode an API key',
  // Making code changes
  'immediately runnable',
  'Add all necessary import statements',
  'beautiful and modern UI',
  // Bug fixing
  'Prefer minimal upstream fixes',
  'regression tests but keep implementation',
  // Long-horizon
  'multi-session work, consider keeping',
  // Verification
  'Prefer available automated verification',
  // Lifeguard
  'EXTREME SUSPICION REQUIRED',
  'consecutive times on this file',
  // Codemap details
  'do not use this tool and do not make a codemap',
  'Traces should tell stories',
  // Frontier
  'summary_mode_trigger',
  'history_generation_trigger',
  'checkpoint_prompt',
  'STARTING POP QUIZ',
  'YOU ARE NO LONGER DEVIN',
  'DEVIN\'S ASSISTANT',
  // Auto cascade / PR
  'Post a Single-Line PR Comment',
  'gh api',
  'gh pr checkout',
  // Misc
  'workspace_layout',
  'frontend_tasks',
  'AGENTS.md spec',
  'Anti-patterns',
  'For code changes:',
  'Aim for interfaces that feel',
  'research_new_info',
  'explore_response',
];

const results = [];

for (const q of queries) {
  let idx = 0;
  while (true) {
    idx = buf.indexOf(q, idx);
    if (idx === -1) break;
    
    // Walk back to find where the string starts
    // In Go, strings are stored contiguously. Look for the start of readable text.
    let start = idx;
    let consecBad = 0;
    while (start > 0 && consecBad < 3) {
      const b = buf[start - 1];
      if (b >= 32 && b <= 126 || b === 10 || b === 13 || b === 9) {
        start--;
        consecBad = 0;
      } else {
        consecBad++;
        start--;
      }
    }
    start += consecBad;
    
    // Walk forward
    let end = idx + q.length;
    consecBad = 0;
    while (end < buf.length && consecBad < 3) {
      const b = buf[end];
      if (b >= 32 && b <= 126 || b === 10 || b === 13 || b === 9) {
        end++;
        consecBad = 0;
      } else {
        consecBad++;
        end++;
      }
    }
    end -= consecBad;
    
    // Extract a window around the query
    const windowStart = Math.max(start, idx - 500);
    const windowEnd = Math.min(end, idx + q.length + 1500);
    const text = buf.subarray(windowStart, windowEnd).toString('utf-8');
    
    // Check if this is clean prompt text (high alpha ratio near query)
    const nearQuery = text.substring(Math.max(0, idx - windowStart - 50), Math.min(text.length, idx - windowStart + q.length + 50));
    const alpha = (nearQuery.match(/[a-zA-Z ]/g) || []).length / Math.max(nearQuery.length, 1);
    
    results.push({
      query: q,
      offset: idx,
      alphaRatio: alpha.toFixed(2),
      text: text,
    });
    
    idx += q.length;
  }
}

// Deduplicate by offset range
const deduped = [];
const seen = new Set();
for (const r of results) {
  const key = Math.floor(r.offset / 100);
  if (seen.has(key)) continue;
  seen.add(key);
  deduped.push(r);
}

// Output
let output = `# Deep Prompt Extraction Results\n`;
output += `# Generated: ${new Date().toISOString()}\n`;
output += `# Queries: ${queries.length}, Hits: ${deduped.length}\n\n`;

for (const r of deduped.sort((a, b) => a.offset - b.offset)) {
  // Only keep entries where the text near the query is mostly readable
  if (parseFloat(r.alphaRatio) < 0.4) continue;
  
  output += `\n${'='.repeat(60)}\n`;
  output += `## Query: "${r.query}" @${r.offset} (alpha=${r.alphaRatio})\n`;
  output += `${'='.repeat(60)}\n`;
  output += r.text + '\n';
}

const outPath = path.join(__dirname, '..', 'docs', 'deep-prompt-extraction.md');
fs.writeFileSync(outPath, output, 'utf-8');
console.log(`Saved ${deduped.length} hits to ${outPath} (${(output.length / 1024).toFixed(1)} KB)`);
