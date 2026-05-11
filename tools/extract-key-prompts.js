#!/usr/bin/env node
/**
 * Extract key prompt template strings by finding them around known anchors.
 * The Go binary stores prompt templates as individual string literals.
 * We look for high-quality text blocks near known anchor phrases.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');

const buf = fs.readFileSync(binPath);

// These are high-value anchors where we expect longer prompt text
const anchors = [
  { name: 'BREVITY_PROMPT', text: 'Brevity is very important as a default' },
  { name: 'COMMUNICATION_STYLE', text: 'Refer to the USER in the second person and yourself in the first person' },
  { name: 'MEMORY_SYSTEM', text: 'You have access to a persistent database with three types of entries' },
  { name: 'WORKFLOWS', text: 'well-defined steps on how to achieve a particular thing' },
  { name: 'RUNNING_COMMANDS_SAFETY', text: 'NEVER NEVER run a command automatically if it could be unsafe' },
  { name: 'BEAUTIFUL_UI', text: 'beautiful and modern UI' },
  { name: 'IMMEDIATELY_RUNNABLE', text: 'Your generated code must be immediately runnable' },
  { name: 'PLAN_GUIDANCE', text: 'Skip planning for straightforward tasks' },
  { name: 'PLAN_3_THINGS', text: 'PLAN entry update' },
  { name: 'DEBUGGING', text: 'Address the root cause instead of the symptoms' },
  { name: 'DIRECT_RESPONSE', text: 'Direct responses: Begin responses immediately' },
  { name: 'EXTREME_SUSPICION', text: 'EXTREME SUSPICION REQUIRED' },
  { name: 'BANNED_EDIT', text: 'BANNED: You have failed' },
  { name: 'LINT_FEEDBACK', text: 'As IDE feedback, the following lint errors' },
  { name: 'CODEMAP_CTRL', text: 'do not use this tool and do not make a codemap' },
  { name: 'FUNCTION_COMMENT', text: 'generate a function comment for the given function body' },
  { name: 'PLAN_TOOL', text: 'update_plan` tool which tracks steps and progress' },
  { name: 'ASK_MODE', text: 'you cannot make any edits directly or run commands' },
  { name: 'TURBO_ANNOTATION', text: 'turbo\' annotation above it, you can auto-run' },
  { name: 'COMMIT_MESSAGE', text: 'Output only the commit message itself' },
  { name: 'SUMMARY_MODE_TRIGGER', text: 'STARTING POP QUIZ' },
  { name: 'WORKSPACE_SNAPSHOT', text: 'Below is a snapshot of the current active workspaces' },
  { name: 'NO_ACK_PHRASES', text: 'No acknowledgment phrases: Never start responses' },
  { name: 'AGENTS_MD', text: 'AGENTS.md spec' },
  { name: 'ANTI_PATTERNS', text: 'Anti-patterns' },
  { name: 'FRONTEND_TASKS', text: '<frontend_tasks>' },
  { name: 'CODE_STYLE', text: 'Code style: Do not add or delete' },
  { name: 'API_KEY_SECURITY', text: 'DO NOT hardcode an API key' },
  { name: 'MEMORY_SEMANTICS', text: 'semantically related memory already exists' },
  { name: 'PROPOSE_EDITS', text: 'propose edits for the user to apply' },
];

const output = [];

for (const anchor of anchors) {
  const idx = buf.indexOf(anchor.text);
  if (idx === -1) {
    output.push(`\n## ${anchor.name}\n**NOT FOUND**\n`);
    continue;
  }
  
  // Find the containing text block - walk from anchor in both directions,
  // collecting readable text until we hit binary garbage
  let start = idx;
  let badRun = 0;
  while (start > 0 && badRun < 2) {
    const b = buf[start - 1];
    if (b >= 32 && b <= 126 || b === 10 || b === 13 || b === 9) {
      start--;
      badRun = 0;
    } else {
      badRun++;
      start--;
    }
  }
  start += badRun;
  
  let end = idx + anchor.text.length;
  badRun = 0;
  while (end < buf.length && badRun < 2) {
    const b = buf[end];
    if (b >= 32 && b <= 126 || b === 10 || b === 13 || b === 9) {
      end++;
      badRun = 0;
    } else {
      badRun++;
      end++;
    }
  }
  end -= badRun;
  
  const fullText = buf.subarray(start, end).toString('utf-8');
  const anchorPos = fullText.indexOf(anchor.text);
  
  // Extract ~500 chars before and ~1500 chars after anchor
  const extractStart = Math.max(0, anchorPos - 500);
  const extractEnd = Math.min(fullText.length, anchorPos + anchor.text.length + 1500);
  let extract = fullText.substring(extractStart, extractEnd);
  
  // Clean: remove lines that are clearly binary noise (low alpha ratio)
  const cleanLines = [];
  for (const line of extract.split('\n')) {
    if (line.length === 0) { cleanLines.push(''); continue; }
    const alpha = (line.match(/[a-zA-Z .,;:!?'"()\-_/]/g) || []).length / line.length;
    if (alpha >= 0.6 || line.length < 20) {
      cleanLines.push(line);
    } else {
      // Try to find a clean substring
      const parts = line.split(/[^\x20-\x7E]+/);
      for (const p of parts) {
        if (p.length > 30) {
          const a2 = (p.match(/[a-zA-Z ]/g) || []).length / p.length;
          if (a2 > 0.6) cleanLines.push(p.trim());
        }
      }
    }
  }
  
  extract = cleanLines.join('\n').trim();
  // Trim to just the meaningful area around anchor
  const newAnchorPos = extract.indexOf(anchor.text);
  if (newAnchorPos > 600) {
    extract = '...' + extract.substring(newAnchorPos - 300);
  }
  if (extract.length > 2500) {
    extract = extract.substring(0, 2500) + '...';
  }
  
  output.push(`\n## ${anchor.name} (@${idx})\n\`\`\`\n${extract}\n\`\`\`\n`);
}

const outPath = path.join(__dirname, '..', 'docs', 'key-prompt-templates.md');
const header = `# Windsurf Cascade - Key Prompt Templates\n# Extracted: ${new Date().toISOString()}\n\n`;
fs.writeFileSync(outPath, header + output.join('\n'), 'utf-8');
console.log(`Saved to ${outPath}`);
