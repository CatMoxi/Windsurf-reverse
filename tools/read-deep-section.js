#!/usr/bin/env node
const fs = require('fs');
const d = fs.readFileSync('docs/deep-prompt-extraction.md', 'utf-8').replace(/\x00/g, '');

// Extract sections around key queries
const keys = [
  'Brevity is very important',
  'Refer to the USER in the second person',
  'persistent database with three types',
  'well-defined steps on how to achieve',
  'NEVER NEVER run a command automatically',
  'beautiful and modern UI',
  'immediately runnable',
  'Skip planning for straightforward tasks',
  'PLAN entry update',
  'Address the root cause instead',
  'Direct responses: Begin responses',
  'STARTING POP QUIZ',
  'YOU ARE NO LONGER DEVIN',
  'Add descriptive logging',
  'Aim for interfaces that feel',
  'semantically related memory',
  'slash command',
  '// turbo',
  'you cannot make any edits directly',
  'switch to Code mode',
  'EXTREME SUSPICION REQUIRED',
  'consecutive times on this file',
  'Anti-patterns',
  'AGENTS.md spec',
];

for (const key of keys) {
  const idx = d.indexOf(key);
  if (idx === -1) continue;
  
  // Find the section boundary
  const secStart = d.lastIndexOf('## Query:', idx);
  if (secStart === -1) continue;
  
  // Find next section
  let secEnd = d.indexOf('## Query:', idx + key.length);
  if (secEnd === -1) secEnd = d.length;
  // Cap at 2000 chars
  secEnd = Math.min(secEnd, secStart + 2500);
  
  const section = d.substring(secStart, secEnd);
  console.log('\n' + '='.repeat(60));
  console.log(section.substring(0, 2000));
  console.log('='.repeat(60));
}
