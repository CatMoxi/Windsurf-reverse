#!/usr/bin/env node
// Find how getSystemPromptAndTools is used in extension.js
const fs = require('fs');
const data = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/dist/extension.js', 'utf-8');

const pattern = 'getSystemPromptAndTools';
let idx = 0;
const results = [];
while ((idx = data.indexOf(pattern, idx)) > -1 && results.length < 10) {
  const start = Math.max(0, idx - 200);
  const end = Math.min(data.length, idx + 300);
  const ctx = data.substring(start, end);
  results.push({ pos: idx, ctx });
  idx += pattern.length;
}

console.log(`Found ${results.length} occurrences of "${pattern}":\n`);
results.forEach((r, i) => {
  console.log(`=== #${i} @${r.pos} ===`);
  console.log(r.ctx);
  console.log('');
});
