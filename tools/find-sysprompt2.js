#!/usr/bin/env node
// Find all system prompt references in extension.js
const fs = require('fs');
const data = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/dist/extension.js', 'utf-8');

const patterns = ['systemPrompt', 'system_prompt', 'tool_definitions', 'toolDefinitions'];
for (const pattern of patterns) {
  let idx = 0;
  let count = 0;
  const locs = [];
  while ((idx = data.indexOf(pattern, idx)) > -1 && count < 5) {
    const start = Math.max(0, idx - 100);
    const end = Math.min(data.length, idx + 200);
    locs.push(data.substring(start, end));
    count++;
    idx += pattern.length;
  }
  console.log(`\n=== "${pattern}" (${count}) ===`);
  locs.forEach((ctx, i) => {
    console.log(`\n--- #${i} ---`);
    console.log(ctx.replace(/\n/g, ' '));
  });
}
