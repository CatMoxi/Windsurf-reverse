/**
 * Extract complete tool descriptions from Go LS binary
 * Each Cascade tool has a description string embedded in the binary
 */
const fs = require('fs');
const path = require('path');

const BINARY_PATH = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const OUTPUT_DIR = path.join(__dirname, '..', 'docs', 'ghidra-output');

const buf = fs.readFileSync(BINARY_PATH);
const text = buf.toString('utf8');

// Tool description anchors - these are the start of each tool description
const TOOL_DESCRIPTIONS = [
  { name: 'edit', anchor: 'Performs exact string replacements in files.' },
  { name: 'multi_edit', anchor: 'This is a tool for making multiple edits to a single file in one operation' },
  { name: 'view_file / read_file', anchor: 'Reads a file at the specified' },
  { name: 'write_to_file', anchor: 'Use this tool to create new files' },
  { name: 'run_command', anchor: 'PROPOSE a command to run on behalf of the user' },
  { name: 'command_status', anchor: 'Check the status of a previously started terminal command by its ID' },
  { name: 'grep_search', anchor: 'A powerful search tool built on ripgrep' },
  { name: 'find_by_name', anchor: 'Search for files and subdirectories within a specified directory using fd' },
  { name: 'code_search (Fast Context)', anchor: 'search subagent the user refers to as \'Fast Context\'' },
  { name: 'browser_preview', anchor: 'Spin up a browser preview for a web server' },
  { name: 'deploy_web_app', anchor: 'Deploy a JavaScript web application' },
  { name: 'read_deployment_config', anchor: 'Read the deployment configuration for a web application' },
  { name: 'check_deploy_status', anchor: 'Check the status of the deployment using' },
  { name: 'todo_list / update_plan', anchor: 'Updates the task plan. Provide an optional explanation' },
  { name: 'create_memory', anchor: 'Save important context relevant to the USER' },
  { name: 'ask_user_question', anchor: 'Ask the user a question with predefined options' },
  { name: 'search_web', anchor: 'Performs a web search to get a list of relevant web documents' },
  { name: 'read_url_content', anchor: 'Read content from a URL' },
  { name: 'view_content_chunk', anchor: 'View a specific chunk of a web' },
  { name: 'trajectory_search', anchor: 'Semantic search or retrieve trajectory' },
  { name: 'read_notebook', anchor: 'Read and parse a Jupyter notebook' },
  { name: 'edit_notebook', anchor: 'Completely replaces the contents of a specific cell' },
  { name: 'list_dir', anchor: 'Lists files and directories in a given path' },
  { name: 'list_resources (MCP)', anchor: 'Lists the available resources from an MCP server' },
  { name: 'read_resource (MCP)', anchor: 'Retrieves a specified resource\'s contents' },
  { name: 'propose_code', anchor: 'Propose Code`: Propose code changes to an existing file' },
  { name: 'bash', anchor: 'Bash`: Execute a shell command with specified arguments' },
  { name: 'apply_patch', anchor: 'Apply a freeform patch to edit files' },
  { name: 'skill', anchor: 'Invoke a skill to get detailed instructions' },
  { name: 'report_bugs', anchor: 'Report bugs found in the code diff' },
  { name: 'restricted_exec (subagent)', anchor: '{"type": "function", "function": {"name": "restricted_exec"' },
  { name: 'cluster_query', anchor: 'Identify clusters of functionality in the codebase' },
  { name: 'code_search_v2', anchor: 'Returns code snippets in the specified file that are most relevant' },
];

const results = [];

for (const { name, anchor } of TOOL_DESCRIPTIONS) {
  const idx = text.indexOf(anchor);
  if (idx === -1) {
    console.log(`NOT FOUND: ${name}`);
    continue;
  }
  
  // Extract a generous chunk
  const start = Math.max(0, idx);
  const end = Math.min(text.length, idx + 2000);
  let chunk = text.substring(start, end);
  
  // Clean non-printable chars
  chunk = chunk.replace(/[^\x20-\x7E\n\r\t]/g, '\x00');
  
  // Find end of the meaningful string (where non-printable noise begins consistently)
  const lines = chunk.split('\x00').filter(s => s.length > 0);
  let desc = lines[0]; // First contiguous printable string
  
  results.push({ name, offset: idx, description: desc.trim() });
  console.log(`[${name}] ${desc.length} chars at offset ${idx}`);
}

// Write output
const outFile = path.join(OUTPUT_DIR, 'cascade-tool-descriptions.md');
let md = '# Cascade Tool Descriptions - Extracted from Go Binary\n\n';
md += `Total tools found: **${results.length}**\n\n`;

for (const r of results) {
  md += `## ${r.name}\n`;
  md += `*Offset: ${r.offset}*\n\n`;
  md += '```\n' + r.description + '\n```\n\n---\n\n';
}

fs.writeFileSync(outFile, md);
console.log(`\nSaved: ${outFile}`);
