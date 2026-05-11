#!/usr/bin/env node
/**
 * Extract specific system prompt sections from LS binary.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');

const buf = fs.readFileSync(binPath);
const str = buf.toString('utf-8');

// Key prompt markers to search around
const markers = [
  'You are in Ask mode',
  'EXTREME SUSPICION',
  'Do not include confirmation messages',
  'pre-commit bug detection',
  'tool_calling_section',
  'code_changes_section',
  'communication_section',
  'additional_instructions_section',
  'lifeguard_instructions',
  'parallel_tool_calls',
  'markdown_formatting',
  'citation_guidelines',
  'thinking_protocol',
  'Report only clear, severe',
  'You have failed %d consecutive',
  'Check the status of a previously started terminal command',
  'run out of tokens',
  'format your messages',
  'Format your messages with Markdown',
  '</tools>',
  '<tool_calling>',
  '## Tool Calling',
  'windsurf_rules',
  'cascade_rules',
  'You are Cascade',
  'You are a',
  'IMPORTANT: Format',
  'do not use this tool',
  'codemap',
  'IDE feedback',
  'lint errors',
  'As IDE feedback',
  'planner_prompt',
  'executor_prompt',
  'thinking mode',
  'You have access to a persistent',
  'Aim for interfaces',
  'Delete File',
  'Do not add inline comments',
  'Line/column',
  'Each operation starts',
  'stand alone path',
  'Don\'t nest bullets',
  'CascadeConfig Default',
  'write_to_file',
  'read_file',
  'run_command',
  'grep_search',
  'list_directory',
  'search_web',
  'read_url_content',
  'edit_file',
];

const seen = new Set();
for (const marker of markers) {
  let idx = str.indexOf(marker);
  if (idx === -1) continue;
  
  // Find the start and end of the containing string
  let start = idx;
  while (start > 0 && buf[start - 1] >= 32 && buf[start - 1] < 127) start--;
  let end = idx + marker.length;
  while (end < buf.length && buf[end] >= 32 && buf[end] < 127) end++;
  
  const key = `${start}-${end}`;
  if (seen.has(key)) continue;
  seen.add(key);
  
  const text = buf.subarray(start, end).toString('utf-8');
  if (text.length < 50) continue;
  
  console.log(`\n${'='.repeat(70)}`);
  console.log(`"${marker}" found @${idx} (string ${start}-${end}, ${end-start} bytes)`);
  console.log('='.repeat(70));
  // Show up to 3000 chars
  console.log(text.substring(0, 3000));
  if (text.length > 3000) console.log(`\n... (${text.length - 3000} more chars)`);
}
