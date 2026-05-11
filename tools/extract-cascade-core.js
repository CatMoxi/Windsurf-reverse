#!/usr/bin/env node
/**
 * Extract the core "You are Cascade" prompt and surrounding prompt sections.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');

const buf = fs.readFileSync(binPath);

// Key sections to extract with their content
const sections = [
  { name: 'YOU_ARE_CASCADE', marker: 'You are Cascade' },
  { name: 'TOOL_CALLING', marker: '</tool_calling>' },
  { name: 'MAKING_CODE_CHANGES', marker: '<making_code_changes>' },
  { name: 'RUNNING_COMMANDS', marker: '<running_commands>' },
  { name: 'DEBUGGING', marker: '<debugging>' },
  { name: 'TASK_MANAGEMENT', marker: '<task_management>' },
  { name: 'CALLING_EXTERNAL_APIS', marker: '<calling_external_apis>' },
  { name: 'MEMORY_SYSTEM', marker: '<memory_system>' },
  { name: 'USER_RULES', marker: '<user_rules>' },
  { name: 'IDE_METADATA', marker: '<ide_metadata>' },
  { name: 'MARKDOWN_FORMATTING', marker: '</markdown_formatting>' },
  { name: 'CITATION_GUIDELINES', marker: '</citation_guidelines>' },
  { name: 'PARALLEL_TOOL_CALLS', marker: '</parallel_tool_calls>' },
  { name: 'COMMUNICATION_STYLE', marker: '</communication_style>' },
  { name: 'LIFEGUARD', marker: 'lifeguard_instructions' },
  { name: 'ASK_MODE', marker: 'You are in Ask mode' },
  { name: 'BUG_DETECTION', marker: 'bug detection assistant' },
  { name: 'ADVISORY_MODE', marker: 'ADVISORY MODE' },
  { name: 'RUN_COMMAND_TOOL', marker: 'PROPOSE a command to run' },
  { name: 'EDIT_TOOL', marker: 'Performs exact string replacements' },
  { name: 'GREP_TOOL', marker: 'A powerful search tool built on ripgrep' },
  { name: 'CODEMAP', marker: 'Entering structured output mode' },
  { name: 'SUMMARY_MODE', marker: 'ENTER SUMMARY MODE' },
  { name: 'HISTORY_MODE', marker: 'ENTER HISTORY GENERATION MODE' },
  { name: 'EXPERT_SW_ENG', marker: 'You are an expert software engineer' },
  { name: 'TOOL_CALLING_AGENT', marker: 'You are a tool calling agent' },
  { name: 'EXTREMELY_INTELLIGENT', marker: 'You are an extremely intelligent' },
  { name: 'READ_URL', marker: 'Read content from a URL' },
  { name: 'SAVE_MEMORY', marker: 'Save important context' },
  { name: 'FIND_FILES', marker: 'Search for files and subdirectories' },
  { name: 'LIST_DIR', marker: 'Lists files and directories' },
  { name: 'WRITE_FILE', marker: 'Use this tool to create new files' },
  { name: 'BREVITY', marker: 'Brevity is very important' },
  { name: 'TRAJECTORY_SEARCH', marker: 'Semantic search or retrieve trajectory' },
  { name: 'BROWSER_PREVIEW', marker: 'Spin up a browser preview' },
  { name: 'COMMAND_STATUS', marker: 'Check the status of a previously started terminal' },
];

let output = `# Windsurf Cascade - Core System Prompt Sections\n`;
output += `# Extracted from language_server_windows_x64.exe\n`;
output += `# Generated: ${new Date().toISOString()}\n\n`;

for (const sec of sections) {
  const idx = buf.indexOf(sec.marker);
  if (idx === -1) {
    output += `\n## ${sec.name}\n**NOT FOUND**\n`;
    continue;
  }
  
  // Find containing ASCII/text block
  let start = idx;
  while (start > 0 && (buf[start - 1] >= 32 && buf[start - 1] < 127 || buf[start-1] === 10 || buf[start-1] === 13 || buf[start-1] === 9)) start--;
  let end = idx + sec.marker.length;
  while (end < buf.length && (buf[end] >= 32 && buf[end] < 127 || buf[end] === 10 || buf[end] === 13 || buf[end] === 9)) end++;
  
  const text = buf.subarray(start, end).toString('utf-8');
  
  // Find just the relevant prompt portion around the marker
  // Look for the prompt text that contains the marker
  const markerIdx = text.indexOf(sec.marker);
  
  // Search backwards for a clean start point (start of instruction text)
  let promptStart = markerIdx;
  const lookback = 2000;
  const searchStart = Math.max(0, markerIdx - lookback);
  const before = text.substring(searchStart, markerIdx);
  
  // Try to find where the prompt template begins
  const startPatterns = [
    /You are /g, /\n#/g, /<[a-z_]+>/g, /IMPORTANT/g,
    /\nNote/g, /\nWhen/g, /\nDo not/g, /\nThe /g,
  ];
  
  let bestStart = searchStart;
  for (const p of startPatterns) {
    let m;
    while ((m = p.exec(before)) !== null) {
      if (m.index + searchStart > bestStart) {
        bestStart = m.index + searchStart;
      }
    }
  }
  
  // Take up to 3000 chars from marker onwards
  const promptEnd = Math.min(text.length, markerIdx + 3000);
  
  // Actually, let's just take the full text but limit to 5000 chars centered on the marker
  const contextStart = Math.max(0, markerIdx - 1500);
  const contextEnd = Math.min(text.length, markerIdx + 3500);
  const context = text.substring(contextStart, contextEnd);
  
  output += `\n${'#'.repeat(70)}\n`;
  output += `## ${sec.name} (@${start + contextStart}, total string ${end - start}B)\n`;
  output += `${'#'.repeat(70)}\n\n`;
  output += context + '\n';
}

const outPath = path.join(__dirname, '..', 'docs', 'cascade-core-prompts.md');
fs.writeFileSync(outPath, output, 'utf-8');
console.log(`Saved to ${outPath} (${(output.length / 1024).toFixed(1)} KB)`);
