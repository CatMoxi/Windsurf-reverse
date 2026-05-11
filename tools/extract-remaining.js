#!/usr/bin/env node
/**
 * Extract Windsurf-specific content from remaining unexplored JS bundles
 */
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'out');

function extract(filename) {
  const filepath = path.join(BASE, filename);
  if (!fs.existsSync(filepath)) { console.log('SKIP:', filename); return; }
  const content = fs.readFileSync(filepath, 'utf-8');
  console.log(`\n${'='.repeat(60)}`);
  console.log(`FILE: ${filename} (${(content.length/1024/1024).toFixed(2)} MB)`);

  // Windsurf proposed API declarations
  const proposedAPIs = [...new Set([...content.matchAll(/vscode\.proposed\.(windsurf\w+)/g)].map(m => m[1]))];
  if (proposedAPIs.length) { console.log(`\n--- Proposed APIs (${proposedAPIs.length}) ---`); proposedAPIs.sort().forEach(s => console.log('  ' + s)); }

  // Windsurf-specific classes/interfaces
  const wsClasses = [...new Set([...content.matchAll(/(?:class|interface)\s+(Windsurf\w+|Cascade\w+|Codeium\w+)/g)].map(m => m[1]))];
  if (wsClasses.length) { console.log(`\n--- Windsurf Classes/Interfaces (${wsClasses.length}) ---`); wsClasses.sort().forEach(s => console.log('  ' + s)); }

  // IPC channels unique to this file
  const ipcChannels = [...new Set([...content.matchAll(/"(windsurf[:/]\w[\w/:.-]*)"/g)].map(m => m[1]))];
  if (ipcChannels.length) { console.log(`\n--- windsurf: IPC/identifiers (${ipcChannels.length}) ---`); ipcChannels.sort().forEach(s => console.log('  ' + s)); }

  // Specific URLs
  const urls = [...new Set([...content.matchAll(/https?:\/\/[\w./-]+(?:windsurf|codeium|devin)[\w./-]*/g)].map(m => m[0]))];
  if (urls.length) { console.log(`\n--- URLs (${urls.length}) ---`); urls.sort().forEach(u => console.log('  ' + u)); }

  // Extension host API registrations
  const extHostAPIs = [...new Set([...content.matchAll(/registerWindsurf\w+|windsurfApi\.\w+|createWindsurf\w+/g)].map(m => m[0]))];
  if (extHostAPIs.length) { console.log(`\n--- Extension Host APIs (${extHostAPIs.length}) ---`); extHostAPIs.sort().forEach(s => console.log('  ' + s)); }

  // Services
  const services = [...new Set([...content.matchAll(/"(windsurf\w*(?:Service|Provider|Manager|Handler|Controller))"/g)].map(m => m[1]))];
  if (services.length) { console.log(`\n--- Services (${services.length}) ---`); services.sort().forEach(s => console.log('  ' + s)); }

  // SharedProcess specific registrations
  const sharedRegs = [...new Set([...content.matchAll(/register(?:Shared|Channel).*?windsurf/gi)].map(m => m[0]))];
  if (sharedRegs.length) { console.log(`\n--- Shared Process Registrations (${sharedRegs.length}) ---`); sharedRegs.sort().forEach(s => console.log('  ' + s)); }
}

// Unexplored bundles
extract('vs/workbench/api/node/extensionHostProcess.js');
extract('vs/workbench/api/worker/extensionHostWorkerMain.js');
extract('vs/code/electron-utility/sharedProcess/sharedProcessMain.js');
extract('vs/code/node/cliProcessMain.js');
extract('vs/platform/terminal/node/ptyHostMain.js');

// Also check vscode.d.ts for windsurf proposed APIs
const dtsPath = path.join(BASE, 'vscode-dts', 'vscode.d.ts');
if (fs.existsSync(dtsPath)) {
  const dts = fs.readFileSync(dtsPath, 'utf-8');
  console.log(`\n${'='.repeat(60)}`);
  console.log('FILE: vscode-dts/vscode.d.ts');
  // Look for windsurf namespace declarations
  const wsNamespaces = [...new Set([...dts.matchAll(/namespace\s+(windsurf\w*)/g)].map(m => m[1]))];
  if (wsNamespaces.length) { console.log(`\n--- windsurf namespaces (${wsNamespaces.length}) ---`); wsNamespaces.sort().forEach(s => console.log('  ' + s)); }
  // Any windsurf references
  const wsRefs = [...new Set([...dts.matchAll(/windsurf\w+/gi)].map(m => m[0]))];
  console.log(`\n--- windsurf references (${wsRefs.length}) ---`);
  wsRefs.sort().forEach(s => console.log('  ' + s));
}

// Check proposed DTS files
const dtsDir = path.join(BASE, 'vscode-dts');
if (fs.existsSync(dtsDir)) {
  const proposedFiles = fs.readdirSync(dtsDir).filter(f => f.includes('windsurf'));
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Proposed DTS files with 'windsurf': ${proposedFiles.length}`);
  proposedFiles.forEach(f => {
    const content = fs.readFileSync(path.join(dtsDir, f), 'utf-8');
    console.log(`\n--- ${f} (${content.length} bytes) ---`);
    // Print first 80 lines
    content.split('\n').slice(0, 80).forEach(l => console.log('  ' + l));
    if (content.split('\n').length > 80) console.log('  ... (' + (content.split('\n').length - 80) + ' more lines)');
  });
}
