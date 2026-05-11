/**
 * Precisely extract Cascade system prompt instructions from Go LS binary
 * Uses exact known anchor strings to find and extract prompt text
 */
const fs = require('fs');
const path = require('path');

const BINARY_PATH = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'ghidra-output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const buf = fs.readFileSync(BINARY_PATH);
const text = buf.toString('utf8');
console.log(`Binary: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);

/**
 * Extract a readable string around an offset.
 * Go strings don't have null terminators, but in the rodata section
 * adjacent strings are packed. We look for transitions between
 * human-readable text and binary/non-printable data.
 */
function extractStringAt(offset, maxBefore = 2000, maxAfter = 5000) {
  const start = Math.max(0, offset - maxBefore);
  const end = Math.min(text.length, offset + maxAfter);
  const chunk = text.substring(start, end);
  const matchOff = offset - start;

  // Scan backward to find start of readable region
  let sStart = matchOff;
  let nonPrintCount = 0;
  while (sStart > 0) {
    const c = chunk.charCodeAt(sStart - 1);
    if (c >= 0x20 && c <= 0x7E || c === 0x0A || c === 0x0D || c === 0x09) {
      nonPrintCount = 0;
      sStart--;
    } else {
      nonPrintCount++;
      if (nonPrintCount > 3) break;
      sStart--;
    }
  }

  // Scan forward to find end of readable region  
  let sEnd = matchOff;
  nonPrintCount = 0;
  while (sEnd < chunk.length) {
    const c = chunk.charCodeAt(sEnd);
    if (c >= 0x20 && c <= 0x7E || c === 0x0A || c === 0x0D || c === 0x09) {
      nonPrintCount = 0;
      sEnd++;
    } else {
      nonPrintCount++;
      if (nonPrintCount > 3) break;
      sEnd++;
    }
  }

  return chunk.substring(sStart, sEnd).replace(/[^\x20-\x7E\n\r\t]/g, '');
}

// Known exact anchor strings that are part of system prompt sections
const ANCHORS = [
  // Identity Section
  { name: 'IdentitySection (Agent)', anchor: 'You are Cascade, a powerful agentic AI coding assistant acting as a senior pair programmer' },
  { name: 'IdentitySection (Basic)', anchor: 'You are Cascade, a powerful agentic AI coding assistant.' },
  { name: 'IdentitySection (Smart)', anchor: 'You are a smart coding assistant.' },
  { name: 'IdentitySection (IDE)', anchor: 'You are an agentic AI coding assistant working in the user\'s IDE to pair program' },
  
  // Communication Section
  { name: 'CommunicationSection (terse)', anchor: 'Be terse and direct' },
  { name: 'CommunicationSection (direct)', anchor: 'Direct responses: Begin responses immediately with the substantive content' },
  { name: 'CommunicationSection (no-ack)', anchor: 'Do not acknowledge, validate, or express agreement' },
  { name: 'CommunicationSection (markdown)', anchor: 'Format your messages with Markdown' },
  { name: 'CommunicationSection (overstep)', anchor: 'Do not overstep your bounds' },
  { name: 'CommunicationSection (concise)', anchor: 'Be concise and avoid unnecessary verbosity' },
  
  // MakingCodeChanges Section
  { name: 'MakingCodeChangesSection (edits)', anchor: 'Prefer minimal, focused edits using the' },
  { name: 'MakingCodeChangesSection (never)', anchor: 'NEVER output code to the USER' },
  { name: 'MakingCodeChangesSection (imports)', anchor: 'Add all necessary import statements, dependencies, and endpoints' },
  { name: 'MakingCodeChangesSection (runnable)', anchor: 'Your generated code must be immediately runnable' },
  
  // ToolCalling Section
  { name: 'ToolCallingSection (use)', anchor: 'Use only the available tools' },
  { name: 'ToolCallingSection (prefer)', anchor: 'prefer to use the tool instead of shell commands' },
  { name: 'ToolCallingSection (parallel)', anchor: 'You have the ability to call tools in parallel' },
  
  // RunningCommands Section
  { name: 'RunningCommandsSection (cd)', anchor: 'NEVER include `cd` as part of the command' },
  { name: 'RunningCommandsSection (unsafe)', anchor: 'You must NEVER NEVER run a command automatically if it could be unsafe' },
  { name: 'RunningCommandsSection (cwd)', anchor: 'Always set the `cwd` param when using run_command' },
  
  // TaskManagement Section
  { name: 'TaskManagementSection (plan)', anchor: 'To create a new plan, call `update_plan`' },
  { name: 'TaskManagementSection (todo)', anchor: 'TODO list has not been updated' },
  
  // Debugging Section
  { name: 'DebuggingSection (bug)', anchor: 'Bug fixing discipline' },
  { name: 'DebuggingSection (root)', anchor: 'Address the root cause instead of the symptoms' },
  
  // CallingExternalAPIs Section
  { name: 'CallingExternalAPIsSection (api)', anchor: 'If an external API requires an API Key' },
  
  // Workflows Section
  { name: 'WorkflowsSection (workflows)', anchor: 'You have the ability to use and create workflows' },
  { name: 'WorkflowsSection (turbo)', anchor: 'turbo' },
  
  // Memory Section
  { name: 'MemorySection (create)', anchor: 'Before creating a new memory, first check to see if a semantically related memory' },
  { name: 'MemorySection (aggressive)', anchor: 'You DO NOT need to be conservative about creating memories' },
  
  // UserRules Section
  { name: 'UserRulesSection (rules)', anchor: 'The following are user-defined rules that you MUST ALWAYS FOLLOW' },
  { name: 'UserRulesSection (conditional)', anchor: 'user-defined conditional rules' },
  
  // UserInformation Section
  { name: 'UserInformationSection (os)', anchor: 'The USER\'s OS version is' },
  
  // IdeMetadata Section
  { name: 'IdeMetadataSection (cursor)', anchor: 'Cursor is on line:' },
  { name: 'IdeMetadataSection (active)', anchor: 'Active Document:' },
  
  // Citation Section
  { name: 'CitationSection (valid)', anchor: 'Valid (multi-line):' },
  { name: 'CitationSection (format)', anchor: 'ALWAYS use citation format when mentioning any file path' },
  
  // CodeResearch Section
  { name: 'CodeResearchSection (explore)', anchor: 'When exploring a new or unfamiliar area of the codebase' },
  { name: 'CodeResearchSection (identify)', anchor: 'Identify likely call sites or consumers' },
  
  // TestCode Section
  { name: 'TestCodeSection (test)', anchor: 'When working on test-related tasks' },
  { name: 'TestCodeSection (bugs)', anchor: 'Do not attempt to fix unrelated bugs or broken tests' },
  
  // EvalMode / Planning
  { name: 'PlanningSection (quality)', anchor: 'If you need to write a plan, only write high quality plans' },
  { name: 'PlanningSection (cadence)', anchor: 'Planning cadence' },
  { name: 'PlanningSection (testing)', anchor: 'Testing discipline' },
  { name: 'PlanningSection (verification)', anchor: 'Verification tools: Prefer available automated verification' },
  { name: 'PlanningSection (progress)', anchor: 'Progress notes' },
  { name: 'PlanningSection (long-horizon)', anchor: 'Long-horizon workflow' },
  
  // Review mode
  { name: 'ReviewSection', anchor: 'When user asks for \'review\', default to a code review mindset' },
  { name: 'ReviewSection (prioritize)', anchor: 'prioritize identifying bugs, risks, behavioural regressions' },
  
  // PR Review
  { name: 'PRReviewSection', anchor: 'The USER will give you a pull request link' },
  
  // Misc instructions
  { name: 'ViewFile instruction', anchor: 'You have not recently viewed any files. You cannot edit any files until you view them first' },
  { name: 'FewShot example', anchor: 'ASSISTANT: Let me find foo and view its contents' },
  { name: 'TokenLimit', anchor: 'generation exceeded max tokens limit' },
  { name: 'GitAuth', anchor: 'Your git authentication has been set up correctly' },
  { name: 'UnexpectedChanges', anchor: 'While you are working, you might notice unexpected changes' },
  { name: 'ExplainFirst', anchor: 'Always explain what you\'re doing in a commentary message FIRST' },
  { name: 'Ambitious', anchor: 'For tasks that have no prior context' },
  { name: 'CommitRevert', anchor: 'If asked to make a commit or code edits and there are unrelated changes' },
  
  // Subagent tool description
  { name: 'SubagentTool (FastContext)', anchor: 'A search subagent the user refers to as \'Fast Context\'' },
  { name: 'SubagentTool (restricted_exec)', anchor: 'restricted_exec' },
  
  // Lifeguard
  { name: 'LifeguardIdentitySection', anchor: 'You are Lifeguard' },
  
  // KnowledgeBase
  { name: 'KnowledgeBaseSection', anchor: 'This tool looks up specific knowledge base items by ID' },
  
  // Deploy
  { name: 'DeploySection', anchor: 'Do not immediately check the status of the deployment' },
];

const results = [];

for (const { name, anchor } of ANCHORS) {
  let searchFrom = 0;
  while (true) {
    const idx = text.indexOf(anchor, searchFrom);
    if (idx === -1) break;
    
    const fullStr = extractStringAt(idx, 500, 2000);
    
    // Only keep if meaningful length
    if (fullStr.length > anchor.length + 20) {
      results.push({
        name,
        anchor,
        offset: idx,
        text: fullStr,
      });
    }
    searchFrom = idx + anchor.length;
    break; // Only first match per anchor
  }
}

console.log(`Extracted ${results.length} prompt sections\n`);

// Write comprehensive output
const outFile = path.join(OUTPUT_DIR, 'cascade-system-prompt-reconstructed.md');
let md = '# Cascade System Prompt - Reconstructed from Go Binary\n\n';
md += `Source: \`language_server_windows_x64.exe\` (${(buf.length/1024/1024).toFixed(1)} MB)\n`;
md += `Sections extracted: **${results.length}**\n\n`;
md += '## Section Architecture (31 sections from Go symbols)\n\n';
md += '| # | Section Type | Description |\n';
md += '|---|-------------|-------------|\n';
const sections = [
  ['IdentitySection', 'Agent identity and role definition'],
  ['CommunicationSection', 'Response style and formatting rules'],
  ['MakingCodeChangesSection', 'Code editing discipline'],
  ['ToolCallingSection', 'Tool usage rules and parallel calling'],
  ['RunningCommandsSection', 'Terminal command safety rules'],
  ['TaskManagementSection', 'Plan/todo management'],
  ['DebuggingSection', 'Bug fixing discipline'],
  ['CallingExternalAPIsSection', 'External API usage rules'],
  ['WorkflowsSection', 'Workflow system (.md files)'],
  ['MemorySystemSection', 'Memory create/update/delete'],
  ['UserRulesSection', 'User-defined rules (AGENTS.md etc)'],
  ['UserInformationSection', 'OS, workspace, corpus info'],
  ['IdeMetadataSection', 'Active document, cursor, open files'],
  ['WorkspaceInformationSection', 'Workspace layout and structure'],
  ['CodeResearchSection', 'Codebase exploration strategy'],
  ['TestCodeSection', 'Test-related task handling'],
  ['ChatModeSection', 'Chat-specific behavior'],
  ['EvalModeSection', 'Evaluation mode behavior'],
  ['EphemeralMessageSection', 'Ephemeral status messages'],
  ['McpServersSection', 'MCP server configuration'],
  ['KnowledgeBaseSection', 'Knowledge base item lookup'],
  ['AdditionalInstructionsSection', 'Dynamic additional instructions'],
  ['CodemapsAboutCodemapsSection', 'Codemap explanation'],
  ['CodemapsReadOnlySection', 'Codemap read-only mode'],
  ['LifeguardIdentitySection', 'Lifeguard agent identity'],
  ['LifeguardInstructionsSection', 'Lifeguard behavior rules'],
  ['LifeguardOutputFormatSection', 'Lifeguard output format'],
  ['LifeguardReadOnlySection', 'Lifeguard read-only mode'],
  ['LifeguardV2SystemPromptSection', 'Lifeguard v2 system prompt'],
  ['PassiveCoderIdentitySection', 'Passive coder identity'],
  ['PassiveCoderCommunicationSection', 'Passive coder communication'],
];
sections.forEach(([name, desc], i) => {
  md += `| ${i+1} | \`${name}\` | ${desc} |\n`;
});

md += '\n---\n\n## Extracted Prompt Text\n\n';
md += '> Strings are extracted from the Go binary\'s rodata section.\n';
md += '> Adjacent strings may be concatenated at runtime. Fragment boundaries are approximate.\n\n';

for (const r of results) {
  md += `### ${r.name}\n`;
  md += `*Offset: ${r.offset} | Anchor: \`${r.anchor.substring(0, 60)}...\`*\n\n`;
  md += '```\n' + r.text + '\n```\n\n---\n\n';
}

fs.writeFileSync(outFile, md);
console.log(`Saved: ${outFile}`);

// Also print key findings
console.log('\n=== KEY PROMPT FINDINGS ===\n');
for (const r of results) {
  if (r.text.length > 100) {
    console.log(`[${r.name}] (${r.text.length} chars)`);
    console.log(r.text.substring(0, 200) + '...\n');
  }
}
