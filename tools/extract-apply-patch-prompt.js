#!/usr/bin/env node
const fs = require('fs');
const s = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/bin/language_server_windows_x64.exe');
const t = s.toString('utf-8', 0, s.length);

// Extract apply_patch usage instructions
const patterns = [
  "Don\u0027t use apply_patch",
  "OP and ask the user",
  "## apply_patch",
  "Example add patch",
  "apply_patch call",
  "NEVER use destructive",
];

for (const p of patterns) {
  let i = t.indexOf(p);
  if (i !== -1) {
    const start = Math.max(0, i - 500);
    const end = Math.min(t.length, i + 2000);
    const ctx = t.substring(start, end).replace(/[\x00-\x1f]/g, ' ').trim();
    console.log(`\n=== [${p}] @${i} ===`);
    console.log(ctx.substring(0, 3000));
    console.log('\n---');
  }
}

// Extract ## Personality and ## sections  
const sectionMarkers = [
  '## Personality',
  '## apply_patch',
  '## Reminders',
  '# Reminders',
  'STOP and ask the user',
  'Example usage',
  'file per apply_patch',
  'search-replace',
  'Ask before destructive',
];

console.log('\n\n========== SECTION MARKERS ==========');
for (const p of sectionMarkers) {
  let i = t.indexOf(p);
  if (i !== -1) {
    const start = Math.max(0, i - 100);
    const end = Math.min(t.length, i + 1500);
    const ctx = t.substring(start, end).replace(/[\x00-\x1f]/g, ' ').trim();
    console.log(`\n=== [${p}] @${i} ===`);
    console.log(ctx.substring(0, 2000));
    console.log('\n---');
  }
}

// Extract Go module names (cortex/tools)
console.log('\n\n========== GO CORTEX TOOL CONVERTERS ==========');
const toolPattern = /tools\.(\w+ToolConverter)/g;
const tools = new Set();
let match;
while ((match = toolPattern.exec(t)) !== null) {
  tools.add(match[1]);
}
console.log('Found tool converters:');
for (const tool of [...tools].sort()) {
  console.log(`  - ${tool}`);
}

// Extract Go cortex managers
console.log('\n\n========== GO CORTEX MANAGERS ==========');
const mgrPattern = /managers\.(\w+Manager\w*)/g;
const mgrs = new Set();
while ((match = mgrPattern.exec(t)) !== null) {
  mgrs.add(match[1]);
}
console.log('Found managers:');
for (const m of [...mgrs].sort()) {
  console.log(`  - ${m}`);
}

// Extract planner types
console.log('\n\n========== GO PLANNERS ==========');
const plannerPattern = /planners\.(\w+Planner\w*)/g;
const planners = new Set();
while ((match = plannerPattern.exec(t)) !== null) {
  planners.add(match[1]);
}
console.log('Found planners:');
for (const p of [...planners].sort()) {
  console.log(`  - ${p}`);
}
