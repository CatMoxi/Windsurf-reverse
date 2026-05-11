#!/usr/bin/env node
/**
 * Extract the exact system prompt strings from LS binary.
 * Focus on the concatenated block at offset ~55-56M.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');

const buf = fs.readFileSync(binPath);

// The prompt fragments appear around offset 55-56M based on prior search
// Let's extract all long ASCII strings in that range
const REGION_START = 55000000;
const REGION_END = 57000000;

const strings = [];
let start = -1;
for (let i = REGION_START; i < Math.min(REGION_END, buf.length); i++) {
  const b = buf[i];
  // Include common chars: printable ASCII + newlines + tabs
  if ((b >= 32 && b < 127) || b === 10 || b === 13 || b === 9) {
    if (start === -1) start = i;
  } else {
    if (start !== -1) {
      const len = i - start;
      if (len > 100) {
        const text = buf.subarray(start, i).toString('utf-8');
        strings.push({ offset: start, len, text });
      }
    }
    start = -1;
  }
}

console.log(`Found ${strings.length} strings > 100 bytes in 55M-57M region\n`);

// Find the ones that look like prompt templates
const promptLike = strings.filter(s => {
  const t = s.text;
  return (
    t.includes('You are') ||
    t.includes('you are') ||
    t.includes('IMPORTANT') ||
    t.includes('tool') && t.includes('file') && t.includes('code') ||
    t.includes('## ') ||
    t.includes('Do not') ||
    t.includes('instructions') ||
    t.includes('Markdown') ||
    t.includes('Cascade') && t.length > 200 ||
    t.includes('planner') ||
    t.includes('executor') ||
    t.includes('system prompt') ||
    t.includes('thinking') && t.includes('mode')
  );
});

console.log(`${promptLike.length} prompt-like strings found\n`);

promptLike.forEach((s, i) => {
  console.log(`\n${'#'.repeat(70)}`);
  console.log(`## String #${i} @${s.offset} (${s.len} bytes)`);
  console.log('#'.repeat(70));
  // Print full text up to 5000 chars
  const preview = s.text.substring(0, 5000);
  console.log(preview);
  if (s.text.length > 5000) console.log(`\n... (${s.text.length - 5000} more chars)`);
});
