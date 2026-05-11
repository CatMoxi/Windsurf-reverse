#!/usr/bin/env node
/**
 * Extract clean prompt template strings by searching for known prompt text patterns.
 * Go binaries store string literals in the .rodata section. The prompt templates
 * are individual string literals that get concatenated at runtime.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 
  'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');

const buf = fs.readFileSync(binPath);

// These are exact prompt template fragments we've seen in previous analysis
const exactPhrases = [
  'You are Cascade, a powerful agentic AI coding assistant.',
  '<workspace_layout workspace="%s">',
  'ENTER SUMMARY MODE',
  'ENTER HISTORY GENERATION MODE',
  'Entering structured output mode.',
  'You are in Ask mode',
  'You are a pre-commit bug detection assistant.',
  'You are an extremely intelligent and helpful friend',
  'You are a tool calling agent.',
  'You are provided a set of tools below',
  'You are an expert software engineer',
  'PROPOSE a command to run on behalf of the user.',
  'Performs exact string replacements in files.',
  'A powerful search tool built on ripgrep',
  'Search for files and subdirectories within a specified directory',
  'Lists files and directories in a given path.',
  'Save important context relevant to the USER',
  'Semantic search or retrieve trajectory.',
  'Read content from a URL.',
  'Spin up a browser preview for a web server.',
  'Check the status of a previously started terminal command',
  'Use this tool to create new files.',
  'Brevity is very important as a default.',
  'Note that you will automatically have your work summarized',
  'IMPORTANT: Format your messages with Markdown.',
  'Refer to the USER in the second person',
  'Do not add inline comments within code unless',
  'EXTREME SUSPICION REQUIRED',
  'Report only clear, severe, and provable bugs',
  'The following is a friendly conversation',
  'The ASSISTANT was built by the Codeium engineering team',
  'The ASSISTANT is an AI that is responsible for generating code',
  'Aim for interfaces that feel intentional',
  'You have access to a persistent database',
  'Each operation starts with one of three headers',
  'Format as a simple string, not as markdown',
  'Always respond in the user\'s language.',
  'Output only the commit message itself.',
  'Create a codemap from a prompt.',
  'This is a tool for making multiple edits',
  'Read and parse a Jupyter notebook file',
  'Deploy a JavaScript web application',
  'do not use this tool and do not make a codemap',
  'As IDE feedback, the following lint errors',
  'Below is a snapshot of the current active workspaces',
  'A codemap is an interactive code artifact',
  'Only use this guide when you are asked to address a pull request',
  'Only use this guide if you are reviewing a PR.',
  'Post a Single-Line PR Comment',
];

let output = '# Windsurf Cascade - Clean Prompt Templates\n';
output += `# Extracted: ${new Date().toISOString()}\n\n`;

let found = 0;
for (const phrase of exactPhrases) {
  const idx = buf.indexOf(phrase);
  if (idx === -1) continue;
  found++;
  
  // Extract the surrounding clean text block
  // Walk backwards to find start of this string literal
  let start = idx;
  while (start > 0) {
    const b = buf[start - 1];
    if (b >= 32 && b <= 126 || b === 10 || b === 13 || b === 9) {
      start--;
    } else {
      break;
    }
  }
  
  // Walk forwards to find end
  let end = idx;
  while (end < buf.length) {
    const b = buf[end];
    if (b >= 32 && b <= 126 || b === 10 || b === 13 || b === 9) {
      end++;
    } else {
      break;
    }
  }
  
  // Now extract JUST the portion around our phrase that looks like a prompt
  // (not mixed with binary garbage)
  const fullText = buf.subarray(start, end).toString('utf-8');
  const phrasePos = fullText.indexOf(phrase);
  
  // Try to isolate the prompt portion - look for boundaries
  // Prompt templates are usually separated from binary garbage by clear boundaries
  let promptStart = phrasePos;
  let promptEnd = phrasePos + phrase.length;
  
  // Walk back to find where "clean" text starts
  for (let i = phrasePos - 1; i >= 0; i--) {
    const ch = fullText[i];
    // If we hit a line that's clearly not prompt text (contains lots of special chars), stop
    if (ch === '\n' || ch === '\r') {
      // Check if the line before this is clean text
      const lineStart = fullText.lastIndexOf('\n', i - 1) + 1;
      const line = fullText.substring(lineStart, i);
      // Skip if line looks like binary garbage (lots of non-alpha chars)
      const alphaRatio = (line.match(/[a-zA-Z ]/g) || []).length / Math.max(line.length, 1);
      if (alphaRatio < 0.5 && line.length > 20) {
        promptStart = i + 1;
        break;
      }
    }
    promptStart = i;
  }
  
  // Walk forward similarly
  for (let i = phrasePos + phrase.length; i < fullText.length; i++) {
    const ch = fullText[i];
    if (ch === '\n' || ch === '\r') {
      const lineEnd = fullText.indexOf('\n', i + 1);
      if (lineEnd === -1) { promptEnd = fullText.length; break; }
      const line = fullText.substring(i + 1, lineEnd);
      const alphaRatio = (line.match(/[a-zA-Z ]/g) || []).length / Math.max(line.length, 1);
      if (alphaRatio < 0.3 && line.length > 30) {
        promptEnd = i;
        break;
      }
    }
    promptEnd = i + 1;
  }
  
  const cleanText = fullText.substring(promptStart, promptEnd).trim();
  
  if (cleanText.length < 30) continue;
  
  output += `\n${'='.repeat(70)}\n`;
  output += `## "${phrase.substring(0, 50)}..." (@${start + promptStart})\n`;
  output += `${'='.repeat(70)}\n\n`;
  output += cleanText + '\n';
}

output += `\n\n# Total: ${found} prompt fragments found\n`;

const outPath = path.join(__dirname, '..', 'docs', 'cascade-clean-prompts.md');
fs.writeFileSync(outPath, output, 'utf-8');
console.log(`Saved ${found} clean prompt fragments to ${outPath}`);
console.log(`File size: ${(output.length / 1024).toFixed(1)} KB`);
