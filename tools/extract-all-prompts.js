#!/usr/bin/env node
/**
 * Extract ALL prompt-like strings from LS binary and save to file.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');

const buf = fs.readFileSync(binPath);

// Scan 55M-57M region for prompt strings
const strings = [];
let start = -1;
for (let i = 55000000; i < Math.min(57000000, buf.length); i++) {
  const b = buf[i];
  if ((b >= 32 && b < 127) || b === 10 || b === 13 || b === 9) {
    if (start === -1) start = i;
  } else {
    if (start !== -1) {
      const len = i - start;
      if (len > 80) {
        const text = buf.subarray(start, i).toString('utf-8');
        // Filter for English text (not just code/binary refs)
        if (/[a-z]{3,}/i.test(text) && !/^[\x00-\x1f]+$/.test(text)) {
          strings.push({ offset: start, len, text });
        }
      }
    }
    start = -1;
  }
}

// Filter for prompt/instruction-like content
const keywords = [
  'You are', 'you are', 'you must', 'You must', 'You should', 'you should',
  'IMPORTANT', 'Do not', 'do not', 'Never ', 'never ', 'Always ', 'always ',
  'tool', 'file', 'code', 'user', 'assistant', 'Cascade', 'Windsurf',
  'Markdown', 'format', 'instructions', 'system', 'prompt',
  'planner', 'executor', 'thinking', 'mode', 'section',
  '## ', '# ', '- ', 'Note:', 'Example:',
  'write_to_file', 'read_file', 'run_command', 'grep_search',
  'edit', 'search', 'command', 'terminal',
  'SUMMARY', 'ANSWER', 'Devin', 'CASCADE',
];

const promptStrings = strings.filter(s => {
  const matches = keywords.filter(k => s.text.includes(k));
  return matches.length >= 3 && s.len > 150;
});

// Sort by offset
promptStrings.sort((a, b) => a.offset - b.offset);

let output = `# Windsurf LS Binary - Extracted Prompt Templates\n`;
output += `# Generated: ${new Date().toISOString()}\n`;
output += `# Total strings found: ${strings.length}\n`;
output += `# Prompt-like strings: ${promptStrings.length}\n\n`;

promptStrings.forEach((s, i) => {
  output += `\n${'='.repeat(70)}\n`;
  output += `## [${i}] @offset ${s.offset} (${s.len} bytes)\n`;
  output += `${'='.repeat(70)}\n`;
  output += s.text + '\n';
});

const outPath = path.join(__dirname, '..', 'docs', 'extracted-prompts.md');
fs.writeFileSync(outPath, output, 'utf-8');
console.log(`Saved ${promptStrings.length} prompt strings to ${outPath}`);
console.log(`File size: ${(output.length / 1024).toFixed(1)} KB`);
