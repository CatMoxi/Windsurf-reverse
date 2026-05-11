#!/usr/bin/env node
const fs = require('fs');
const data = fs.readFileSync('docs/extracted-prompts.md', 'utf-8');
const sections = data.split(/^={70}$/m).filter(s => s.trim());

const parsed = [];
for (let i = 0; i < sections.length; i++) {
  const s = sections[i];
  const hdr = s.match(/## \[(\d+)\] @offset (\d+) \((\d+) bytes\)/);
  if (hdr) {
    // The content is the rest after the header line and the next separator
    const headerEnd = s.indexOf('\n', s.indexOf(hdr[0]) + hdr[0].length);
    const content = s.substring(headerEnd + 1).trim();
    parsed.push({ idx: +hdr[1], offset: +hdr[2], bytes: +hdr[3], content });
  }
}

console.log(`Parsed ${parsed.length} sections\n`);

// Sort by size
parsed.sort((a, b) => b.bytes - a.bytes);

console.log('Top 20 by size:');
parsed.slice(0, 20).forEach(p => {
  const preview = p.content.substring(0, 120).replace(/\n/g, ' ');
  console.log(`  [${p.idx}] ${p.bytes}B: ${preview}...`);
});

// Find sections containing key prompt patterns
console.log('\n\n=== SECTIONS CONTAINING "You are" ===');
parsed.filter(p => p.content.includes('You are ')).forEach(p => {
  const idx = p.content.indexOf('You are ');
  const ctx = p.content.substring(idx, idx + 200).replace(/\n/g, ' ');
  console.log(`  [${p.idx}] ${p.bytes}B: ${ctx}`);
});

console.log('\n=== SECTIONS CONTAINING "system prompt" ===');
parsed.filter(p => p.content.toLowerCase().includes('system prompt')).forEach(p => {
  const idx = p.content.toLowerCase().indexOf('system prompt');
  const ctx = p.content.substring(Math.max(0, idx - 30), idx + 200).replace(/\n/g, ' ');
  console.log(`  [${p.idx}] ${p.bytes}B: ...${ctx.substring(0, 250)}`);
});

console.log('\n=== SECTIONS CONTAINING "tool_calling" or "code_changes" ===');
parsed.filter(p => p.content.includes('tool_calling') || p.content.includes('code_changes')).forEach(p => {
  console.log(`  [${p.idx}] ${p.bytes}B: ${p.content.substring(0, 150).replace(/\n/g, ' ')}...`);
});
