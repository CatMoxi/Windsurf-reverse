#!/usr/bin/env node
/**
 * Extract the Cascade system prompt sections from LS binary.
 * These are the template strings used to build the system prompt.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');

const buf = fs.readFileSync(binPath);

// Search for known prompt section markers
const markers = [
  // Cascade prompt sections
  'lifeguard_instructions',
  '</parallel_tool_calls>',
  '</markdown_formatting>',
  '</citation_guidelines>',
  '</tool_calling>',
  '</code_changes>',
  '</communication_style>',
  '<making_code_changes>',
  '<running_commands>',
  '<debugging>',
  '<task_management>',
  '<calling_external_apis>',
  '<user_rules>',
  '<user_information>',
  '<ide_metadata>',
  '<memory_system>',
  '<workflows>',
  // Windsurf-specific
  'You are Cascade',
  'ENTER SUMMARY MODE',
  'ENTER HISTORY GENERATION MODE',
  'You are an extremely intelligent',
  'bug detection assistant',
  'You are a tool calling agent',
  'You are an expert software engineer',
  'You are provided a set of tools',
  'Entering structured output mode',
  'codemap suggestion',
  'ADVISORY MODE',
  'Ask mode',
  // Tool descriptions
  'Performs exact string replacements',
  'Read the contents of a file',
  'PROPOSE a command to run',
  'Spin up a browser preview',
  'deploy_web_app',
  'Check the status of a previously started terminal',
  'Search for files and subdirectories',
  'A powerful search tool built on ripgrep',
  'Lists files and directories',
  'Save important context',
  'Semantic search or retrieve trajectory',
  'Read content from a URL',
  'edit_notebook',
  'multi_edit',
  'Use this tool to create new files',
];

const results = new Map();

for (const marker of markers) {
  let idx = buf.indexOf(marker);
  if (idx === -1) {
    // Try as buffer
    idx = buf.indexOf(Buffer.from(marker, 'utf-8'));
  }
  if (idx === -1) continue;
  
  // Find containing string boundaries
  let start = idx;
  while (start > 0 && buf[start - 1] >= 32 && buf[start - 1] < 127) start--;
  let end = idx + marker.length;
  while (end < buf.length && ((buf[end] >= 32 && buf[end] < 127) || buf[end] === 10 || buf[end] === 13 || buf[end] === 9)) end++;
  
  const key = `${start}`;
  if (results.has(key)) {
    results.get(key).markers.push(marker);
    continue;
  }
  
  const text = buf.subarray(start, end).toString('utf-8');
  results.set(key, { offset: start, end, len: end - start, text, markers: [marker] });
}

// Sort by offset
const sorted = [...results.values()].sort((a, b) => a.offset - b.offset);

let output = `# Windsurf Cascade System Prompt - Extracted from LS Binary\n`;
output += `# Generated: ${new Date().toISOString()}\n`;
output += `# Sections found: ${sorted.length}\n\n`;

sorted.forEach((s, i) => {
  output += `\n${'='.repeat(70)}\n`;
  output += `## Section ${i}: @${s.offset} (${s.len} bytes)\n`;
  output += `Markers: ${s.markers.join(', ')}\n`;
  output += `${'='.repeat(70)}\n`;
  output += s.text + '\n';
});

const outPath = path.join(__dirname, '..', 'docs', 'cascade-system-prompt.md');
fs.writeFileSync(outPath, output, 'utf-8');
console.log(`Saved ${sorted.length} sections to ${outPath}`);
console.log(`File size: ${(output.length / 1024).toFixed(1)} KB`);

// Also show a summary
sorted.forEach((s, i) => {
  const preview = s.text.substring(0, 120).replace(/[\n\r\t]/g, ' ');
  console.log(`  [${i}] @${s.offset} ${s.len}B markers=[${s.markers.join(',')}] "${preview}..."`);
});
