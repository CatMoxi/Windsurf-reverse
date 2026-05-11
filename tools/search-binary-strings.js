#!/usr/bin/env node
/**
 * Search for system prompt templates in LS binary.
 * The Go binary likely contains hardcoded prompt templates.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');

console.log('Reading binary...');
const buf = fs.readFileSync(binPath);
const str = buf.toString('utf-8');

const searches = [
  'You are Cascade',
  'You are an AI',
  'you are a coding',
  'You are a helpful',
  '<assistant_info>',
  'system_prompt_template',
  'system prompt',
  'CASCADE_SYSTEM',
  'PLANNER_SYSTEM',
  'tool_calling_section',
  'code_changes_section',
  'communication_section',
  'additional_instructions',
  'thinking_protocol',
  '<tools>',
  '## Tool Calling',
  '## Code Changes',
  '# Instructions',
  'You have access to',
  'You can use the following tools',
  'IMPORTANT:',
  'You MUST',
  'When making changes',
  'windsurf_rules',
  'cascade_rules',
  'planner_prompt',
  'executor_prompt',
  'generateSystemPrompt',
  'buildSystemPrompt',
  'system_prompt_builder',
  'promptTemplates',
  'prompt_templates',
];

for (const s of searches) {
  let idx = str.indexOf(s);
  if (idx > -1) {
    // Found! Show context
    const start = Math.max(0, idx - 50);
    const end = Math.min(str.length, idx + 300);
    let ctx = str.substring(start, end).replace(/[\x00-\x08\x0e-\x1f]/g, ' ');
    console.log(`\n✅ "${s}" @${idx}`);
    console.log(`  ...${ctx.substring(0, 350)}...`);
    
    // Check for more occurrences
    let count = 0;
    let i = 0;
    while ((i = str.indexOf(s, i)) > -1 && count < 10) {
      count++;
      i += s.length;
    }
    if (count > 1) console.log(`  (${count} total occurrences)`);
  }
}

// Also search for longer prompt-like strings (contains multiple keywords)
console.log('\n\n=== Searching for long prompt-like strings ===');
const promptIndicators = ['tool', 'file', 'code', 'user', 'assistant'];
// Find strings that look like prompt templates (>100 chars, ASCII, contains keywords)
let longStrings = [];
let start = -1;
for (let i = 0; i < buf.length; i++) {
  const b = buf[i];
  if (b >= 32 && b < 127) {
    if (start === -1) start = i;
  } else {
    if (start !== -1 && (i - start) > 200) {
      const s = buf.subarray(start, i).toString('ascii');
      const lower = s.toLowerCase();
      const matches = promptIndicators.filter(k => lower.includes(k));
      if (matches.length >= 3 && (lower.includes('you ') || lower.includes('must') || lower.includes('instruction'))) {
        longStrings.push({ offset: start, len: i - start, preview: s.substring(0, 500), keywords: matches });
      }
    }
    start = -1;
  }
}
console.log(`Found ${longStrings.length} candidate prompt strings`);
longStrings.slice(0, 10).forEach((s, i) => {
  console.log(`\n--- Candidate #${i} @${s.offset} (${s.len} bytes) keywords: [${s.keywords}] ---`);
  console.log(s.preview);
});
