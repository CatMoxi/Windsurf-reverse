#!/usr/bin/env node
const fs = require('fs');
const s = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/bin/language_server_windows_x64.exe');
const t = s.toString('utf-8', 0, s.length);

function extractGoModules(prefix, label) {
  const p = new RegExp(prefix.replace(/\//g, '\\/') + '(\\w+)', 'g');
  const files = new Set();
  let m;
  while ((m = p.exec(t)) !== null) files.add(m[1]);
  const sorted = [...files].sort();
  console.log(`\n${label} (${sorted.length}):`);
  for (const f of sorted) console.log(`  - ${f}`);
}

extractGoModules('exa/cortex/tools\\.', 'Cortex Tool Go Types');
extractGoModules('exa/cortex/managers\\.', 'Cortex Manager Go Types');
extractGoModules('exa/cortex/planners\\.', 'Cortex Planner Go Types');
extractGoModules('exa/cortex/handlers\\.', 'Cortex Handler Go Types');
extractGoModules('exa/language_server\\.', 'Language Server Go Types');
extractGoModules('exa/context_module\\.', 'Context Module Go Types');
extractGoModules('exa/code_edit\\.', 'Code Edit Go Types');
extractGoModules('exa/vibe_and_replace\\.', 'Vibe And Replace Go Types');

// Extract all Go package paths
console.log('\n\n========== ALL EXAFUNCTION GO PACKAGES ==========');
const pkgPattern = /github\.com\/Exafunction\/Exafunction\/exa\/([a-z_\/]+)/g;
const pkgs = new Set();
while ((m = pkgPattern.exec(t)) !== null) {
  const pkg = m[1].replace(/\/[A-Z].*/, '').replace(/\.[a-z].*/, '');
  pkgs.add(pkg);
}
const sortedPkgs = [...pkgs].sort();
console.log(`Total Go packages (${sortedPkgs.length}):`);
for (const p of sortedPkgs) console.log(`  exa/${p}`);

// Extract prompt section names
console.log('\n\n========== PROMPT SECTION NAMES ==========');
const sectionPattern = /section_(\w+)/g;
const sections = new Set();
while ((m = sectionPattern.exec(t)) !== null) {
  if (m[1].length > 3 && m[1].length < 50) sections.add(m[1]);
}
for (const s of [...sections].sort()) console.log(`  - ${s}`);

// Extract tool names used in system prompt
console.log('\n\n========== TOOL NAMES (from tool definitions) ==========');
const toolNamePattern = /"name":"(\w+)"/g;
const toolNames = new Set();
while ((m = toolNamePattern.exec(t)) !== null) {
  if (m[1].length > 4 && m[1].length < 40 && !m[1].startsWith('get') && !m[1].startsWith('set')) {
    toolNames.add(m[1]);
  }
}
for (const tn of [...toolNames].sort().slice(0, 80)) console.log(`  - ${tn}`);
