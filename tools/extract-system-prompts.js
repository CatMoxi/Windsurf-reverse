/**
 * Extract System Prompt fragments from Go LS binary
 * Searches for known prompt-related string patterns and extracts surrounding context
 */
const fs = require('fs');
const path = require('path');

const BINARY_PATH = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'ghidra-output');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log(`Reading binary: ${BINARY_PATH}`);
const buf = fs.readFileSync(BINARY_PATH);
const ascii = buf.toString('utf8');
console.log(`Binary size: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

// Known prompt fragment patterns to search for
const SEARCH_PATTERNS = [
  // Identity
  'You are Cascade, a powerful agentic AI coding assistant',
  'You are Cascade, a powerful agentic AI coding assistant acting as a senior pair programmer',
  'You are a smart coding assistant',
  'You are Lifeguard',
  // Section tags
  '<communication_style>',
  '<making_code_changes>',
  '<tool_calling>',
  '<task_management>',
  '<running_commands>',
  '<debugging>',
  '<calling_external_apis>',
  '<workflows>',
  '<user_rules>',
  '<user_information>',
  '<ide_metadata>',
  '<markdown_formatting>',
  '<citation_guidelines>',
  '<memory_system>',
  '<parallel_tool_calls>',
  // Prompt instructions
  'Add all necessary import statements',
  'You have not recently viewed any files',
  'ASSISTANT: Let me find foo',
  'Explain the meaning of this code snippet',
  'The USER performed the following action',
  'generation exceeded max tokens limit',
  'Based on the new information since the last plan update',
  'This information may or may not be relevant',
  'Read Knowledge Base Item',
  'Custom MCP servers are user-defined',
  'Follow these rules:',
  'Prefer minimal, focused edits',
  'NEVER output code to the USER',
  'Use only the available tools',
  'Direct responses: Begin responses immediately',
  'Format your messages with Markdown',
  'Be terse and direct',
  'Do not overstep your bounds',
  'Bug fixing discipline',
  'Long-horizon workflow',
  'Planning cadence',
  'Testing discipline',
  'Verification tools',
  'Progress notes',
  // Lifeguard
  'lifeguard_identity',
  'lifeguard_instructions',
  'lifeguard_output_format',
  'lifeguard_read_only',
  // Cascade sections
  'workspace_information',
  'code_research',
  'eval_mode',
  'chat_mode',
  'test_code',
  'mcp_servers',
  'knowledge_base',
  'passive_coder',
];

const results = [];

for (const pattern of SEARCH_PATTERNS) {
  let searchFrom = 0;
  let found = false;
  while (true) {
    const idx = ascii.indexOf(pattern, searchFrom);
    if (idx === -1) break;
    found = true;
    
    // Extract surrounding context (500 chars before, 2000 after)
    const start = Math.max(0, idx - 500);
    const end = Math.min(ascii.length, idx + 2000);
    let chunk = ascii.substring(start, end);
    
    // Clean non-printable chars but preserve newlines
    chunk = chunk.replace(/[^\x20-\x7E\n\r\t]/g, '\x00');
    
    // Find the actual readable string boundaries around the match
    const matchOffset = idx - start;
    
    // Go backward from match to find string start (look for null bytes)
    let strStart = matchOffset;
    while (strStart > 0 && chunk[strStart - 1] !== '\x00') strStart--;
    
    // Go forward from match to find string end
    let strEnd = matchOffset + pattern.length;
    while (strEnd < chunk.length && chunk[strEnd] !== '\x00') strEnd++;
    
    const fullString = chunk.substring(strStart, strEnd);
    
    if (fullString.length > pattern.length + 10) { // Only if we found meaningful context
      results.push({
        pattern,
        offset: idx,
        fullString: fullString.trim(),
        length: fullString.length,
      });
    }
    
    searchFrom = idx + pattern.length;
  }
  if (!found) {
    console.log(`NOT FOUND: "${pattern}"`);
  }
}

// Sort by offset
results.sort((a, b) => a.offset - b.offset);

// Deduplicate overlapping results
const deduped = [];
for (const r of results) {
  const isDup = deduped.some(d => 
    Math.abs(d.offset - r.offset) < 100 && d.fullString === r.fullString
  );
  if (!isDup) deduped.push(r);
}

console.log(`\nFound ${deduped.length} unique prompt fragments\n`);

// Write output
const outFile = path.join(OUTPUT_DIR, 'system-prompt-fragments.md');
let md = '# Windsurf Cascade System Prompt Fragments\n\n';
md += `Extracted from: \`language_server_windows_x64.exe\` (${(buf.length/1024/1024).toFixed(1)} MB)\n\n`;
md += `Total fragments found: **${deduped.length}**\n\n---\n\n`;

for (const r of deduped) {
  md += `## Fragment at offset ${r.offset} (${r.length} chars)\n`;
  md += `**Search pattern**: \`${r.pattern}\`\n\n`;
  md += '```\n' + r.fullString + '\n```\n\n---\n\n';
}

fs.writeFileSync(outFile, md);
console.log(`Saved to: ${outFile}`);

// Also extract long readable strings (>100 chars) from prompt-dense region
const PROMPT_REGION_START = 54000000;
const PROMPT_REGION_END = 56000000;
console.log(`\nScanning prompt-dense region (${PROMPT_REGION_START}-${PROMPT_REGION_END})...`);

const regionChunk = ascii.substring(PROMPT_REGION_START, PROMPT_REGION_END);
const longStrings = regionChunk.split(/[\x00-\x1F]/).filter(s => s.length > 100 && /[a-zA-Z]{3,}/.test(s));

const longStringsFile = path.join(OUTPUT_DIR, 'long-strings-prompt-region.txt');
let longOut = `# Long readable strings from offset ${PROMPT_REGION_START}-${PROMPT_REGION_END}\n`;
longOut += `# Total: ${longStrings.length}\n\n`;
for (const s of longStrings) {
  longOut += '---\n' + s.trim() + '\n\n';
}
fs.writeFileSync(longStringsFile, longOut);
console.log(`Found ${longStrings.length} long strings, saved to: ${longStringsFile}`);
