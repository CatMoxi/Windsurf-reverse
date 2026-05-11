#!/usr/bin/env node
/**
 * Extract embedded system prompt fragments from LS binary.
 * Focus on long ASCII strings that look like prompt templates.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');

console.log('Reading binary...');
const buf = fs.readFileSync(binPath);

// Extract all ASCII strings > 80 chars that contain prompt-like content
const promptPatterns = [
  /you are/i, /you have access/i, /you must/i, /you should/i, /you will/i,
  /important:/i, /instructions?:/i, /## /i, /\n- /,
  /do not/i, /never /i, /always /i, /when making/i,
  /tool call/i, /function call/i, /code change/i,
  /markdown/i, /format/i, /respond/i,
  /cascade/i, /windsurf/i, /planner/i, /executor/i,
  /system prompt/i, /assistant/i,
];

let results = [];
let start = -1;
for (let i = 0; i < buf.length; i++) {
  const b = buf[i];
  if (b >= 32 && b < 127) {
    if (start === -1) start = i;
  } else {
    if (start !== -1) {
      const len = i - start;
      if (len > 80) {
        const s = buf.subarray(start, i).toString('ascii');
        const matches = promptPatterns.filter(p => p.test(s));
        if (matches.length >= 2) {
          results.push({ offset: start, len, text: s, matchCount: matches.length });
        }
      }
    }
    start = -1;
  }
}

// Sort by match count (most prompt-like first)
results.sort((a, b) => b.matchCount - a.matchCount);

console.log(`Found ${results.length} prompt-like strings\n`);

// Show top 30
results.slice(0, 30).forEach((r, i) => {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`#${i} @${r.offset} (${r.len} bytes, ${r.matchCount} pattern matches)`);
  console.log('='.repeat(60));
  console.log(r.text.substring(0, 2000));
  if (r.text.length > 2000) console.log(`\n... (${r.text.length - 2000} more chars)`);
});
