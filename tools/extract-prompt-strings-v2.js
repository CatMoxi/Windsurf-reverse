/**
 * Extract ALL system prompt instruction strings from Go LS binary
 * Uses Go string table structure: strings are stored contiguously in .rodata
 */
const fs = require('fs');
const path = require('path');

const BINARY_PATH = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'ghidra-output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const buf = fs.readFileSync(BINARY_PATH);
const text = buf.toString('utf8');
console.log(`Binary: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

// Prompt-like string indicators
const PROMPT_INDICATORS = [
  /You are (?:Cascade|a (?:smart|powerful)|Lifeguard)/,
  /\bUSER\b.*\b(?:request|task|prompt|action|message)\b/,
  /\b(?:NEVER|ALWAYS|MUST|CRITICAL|IMPORTANT)\b.*\b(?:tool|file|code|command|edit)\b/,
  /\b(?:prefer|avoid|ensure|follow|adhere)\b.*\b(?:rule|style|convention|practice)\b/i,
  /\b(?:tool|function|parameter|argument)\b.*\b(?:call|invoke|use|available)\b/i,
  /\b(?:markdown|format|citation|backtick|heading)\b/i,
  /\b(?:workspace|codebase|repository|project)\b.*\b(?:search|explore|navigate)\b/i,
  /\b(?:test|debug|verify|validate)\b.*\b(?:before|after|first|then)\b/i,
  /\b(?:memory|remember|forget|persist)\b.*\b(?:create|update|delete|save)\b/i,
  /\b(?:plan|step|task|todo)\b.*\b(?:update|create|complete|pending)\b/i,
  /\b(?:diff|edit|patch|change)\b.*\b(?:minimal|focused|scoped)\b/i,
  /\b(?:commit|git|branch)\b.*\b(?:message|change|revert)\b/i,
  /(?:communication_style|making_code_changes|tool_calling|task_management)/,
  /(?:running_commands|debugging|calling_external_apis|workflows)/,
  /(?:user_rules|user_information|ide_metadata|memory_system)/,
  /(?:markdown_formatting|citation_guidelines|parallel_tool_calls)/,
  /When (?:making|creating|editing|running|exploring|debugging)/i,
  /Do not (?:acknowledge|overstep|output|create|delete|modify)/i,
  /Be (?:terse|concise|direct|careful|mindful)/i,
  /\bview_file\b|\brun_command\b|\bedit\b|\bmulti_edit\b|\bgrep_search\b/,
  /\bdeploy_web_app\b|\bbrowser_preview\b|\btodo_list\b|\bupdate_plan\b/,
];

// Scan the prompt-dense region more carefully
const REGIONS = [
  [54000000, 57000000], // Main prompt region
  [55500000, 56500000], // Core identity + instructions
];

const allFragments = new Set();

for (const [rStart, rEnd] of REGIONS) {
  const region = text.substring(rStart, Math.min(text.length, rEnd));
  // Split by null bytes or control characters, keeping long strings
  const strings = region.split(/[\x00-\x1f]/).filter(s => s.length >= 50);
  
  for (const s of strings) {
    const trimmed = s.trim();
    if (trimmed.length < 50) continue;
    
    // Check if it looks like a prompt instruction
    const isPrompt = PROMPT_INDICATORS.some(re => re.test(trimmed));
    if (!isPrompt) continue;
    
    // Filter out Go runtime / debug / proto junk
    if (/^(?:proto|func|type|package|import|var|const)\s/.test(trimmed)) continue;
    if (/protobuf:|json:|bytes,\d+/.test(trimmed)) continue;
    if (/goroutine|gc\/heap|memory\/classes|pprof|runtime\./.test(trimmed)) continue;
    if (/^\(?m\)/.test(trimmed)) continue; // regex patterns
    if (/^[A-Z_]+\s*=\s*\d+/.test(trimmed)) continue; // enum definitions
    
    allFragments.add(trimmed);
  }
}

// Sort by length (longest = most complete)
const sorted = [...allFragments].sort((a, b) => b.length - a.length);

console.log(`Found ${sorted.length} prompt-like fragments`);

// Write output
const outFile = path.join(OUTPUT_DIR, 'cascade-system-prompt-extracted.md');
let md = '# Cascade System Prompt - Extracted from Go Binary\n\n';
md += `Source: \`language_server_windows_x64.exe\` (${(buf.length/1024/1024).toFixed(1)} MB)\n`;
md += `Total prompt fragments: **${sorted.length}**\n\n`;
md += '> Note: Go compiles strings contiguously. Adjacent strings in the binary may be\n';
md += '> separate Go string constants that are concatenated at runtime by GetDefaultContent().\n';
md += '> Fragment boundaries are approximate.\n\n---\n\n';

for (let i = 0; i < sorted.length; i++) {
  md += `### Fragment ${i + 1} (${sorted[i].length} chars)\n\n`;
  md += '```\n' + sorted[i] + '\n```\n\n';
}

fs.writeFileSync(outFile, md);
console.log(`Saved: ${outFile}`);

// Also extract Section names from symbols
const sectionNames = [];
const sectionRe = /cortex\/managers\.\(\*(\w+Section)\)\.GetName/g;
let m;
while ((m = sectionRe.exec(text)) !== null) {
  sectionNames.push(m[1]);
}
const uniqueSections = [...new Set(sectionNames)].sort();
console.log(`\nSystem Prompt Sections (${uniqueSections.length}):`);
uniqueSections.forEach(s => console.log(`  - ${s}`));
