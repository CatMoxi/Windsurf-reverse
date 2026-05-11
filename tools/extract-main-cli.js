#!/usr/bin/env node
/**
 * Extract key information from main.js and cli.js
 * - Product config (embedded product.json)
 * - Devin CLI install paths
 * - Update mechanism
 * - LS Groups / Window management
 * - IPC channels
 * - All URLs
 */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'out');

function analyze(filename) {
  const filepath = path.join(BASE, filename);
  const content = fs.readFileSync(filepath, 'utf-8');
  console.log(`\n${'='.repeat(60)}`);
  console.log(`FILE: ${filename} (${(content.length/1024/1024).toFixed(2)} MB)`);
  console.log('='.repeat(60));

  // 1. URLs
  const urls = [...new Set([...content.matchAll(/https?:\/\/[a-zA-Z0-9._\/\-?&=:%]+/g)].map(m => m[0]))];
  const windsurfUrls = urls.filter(u => /windsurf|codeium|devin|itsdev|exafunction/i.test(u));
  console.log(`\n--- WINDSURF/DEVIN URLs (${windsurfUrls.length}) ---`);
  windsurfUrls.sort().forEach(u => console.log(`  ${u}`));

  // 2. Windsurf-specific strings
  const wsStrings = [...new Set([...content.matchAll(/"windsurf[\w.:\/-]*"/g)].map(m => m[0]))];
  console.log(`\n--- Windsurf Strings (${wsStrings.length}) ---`);
  wsStrings.sort().forEach(s => console.log(`  ${s}`));

  // 3. Devin references
  const devinRefs = [...new Set([...content.matchAll(/"[^"]*devin[^"]*"/gi)].map(m => m[0]))].filter(s => s.length < 200);
  console.log(`\n--- Devin References (${devinRefs.length}) ---`);
  devinRefs.sort().forEach(s => console.log(`  ${s}`));

  // 4. Product config extraction (between WINDSURF_KEYS and the next large block)
  const keyIdx = content.indexOf('WINDSURF_KEYS_START_HERE');
  if (keyIdx > -1) {
    // extract the config object
    const configStart = keyIdx;
    const configEnd = content.indexOf('Object.keys(ln).length===0', configStart);
    if (configEnd > -1) {
      const configStr = content.substring(configStart, configEnd);
      console.log(`\n--- Product Config (${configStr.length} chars) ---`);
      
      // Extract key fields
      const fields = {};
      const fieldMatches = configStr.matchAll(/(\w+):/g);
      const fieldNames = [...new Set([...fieldMatches].map(m => m[1]))];
      console.log(`  Config fields (${fieldNames.length}): ${fieldNames.join(', ')}`);
      
      // Key values
      const version = configStr.match(/version:"([^"]+)"/);
      const commit = configStr.match(/commit:"([^"]+)"/);
      const date = configStr.match(/date:"([^"]+)"/);
      const quality = configStr.match(/quality:"([^"]+)"/);
      const codeiumVersion = configStr.match(/codeiumVersion:"([^"]+)"/);
      const windsurfVersion = configStr.match(/windsurfVersion:"([^"]+)"/);
      const updateUrl = configStr.match(/updateUrl:"([^"]+)"/);
      const zendeskKey = configStr.match(/zendeskTicketApiKey:"([^"]+)"/);
      
      console.log(`  version: ${version?.[1]}`);
      console.log(`  commit: ${commit?.[1]}`);
      console.log(`  date: ${date?.[1]}`);
      console.log(`  quality: ${quality?.[1]}`);
      console.log(`  codeiumVersion: ${codeiumVersion?.[1]}`);
      console.log(`  windsurfVersion: ${windsurfVersion?.[1]}`);
      console.log(`  updateUrl: ${updateUrl?.[1]}`);
      console.log(`  zendeskTicketApiKey: ${zendeskKey?.[1]}`);

      // Tunnel server qualities
      const tunnel = configStr.match(/tunnelServerQualities:\{([^}]+\}[^}]+\}[^}]+)\}/);
      if (tunnel) console.log(`  tunnelServerQualities: ${tunnel[0].substring(0,200)}`);
      
      // Trusted domains
      const domains = [...configStr.matchAll(/"https?:\/\/[^"]+"/g)].map(m => m[0]);
      console.log(`\n  Trusted domains (${domains.length}):`);
      domains.filter(d => /windsurf|codeium|devin|itsdev/i.test(d)).forEach(d => console.log(`    ${d}`));
    }
  }

  // 5. IPC channels  
  const vscodeChannels = [...new Set([...content.matchAll(/"vscode:[\w.-]+"/g)].map(m => m[0]))];
  console.log(`\n--- VSCode IPC Channels (${vscodeChannels.length}) ---`);
  vscodeChannels.sort().forEach(s => console.log(`  ${s}`));

  // 6. Service identifiers
  const services = [...new Set([...content.matchAll(/windsurf\w*(?:Service|Manager|Server|Client|Handler)/g)].map(m => m[0]))];
  console.log(`\n--- Windsurf Services (${services.length}) ---`);
  services.sort().forEach(s => console.log(`  ${s}`));

  // 7. Key logic patterns
  const patterns = [
    { name: 'installDevinCli', regex: /installDevinCli/ },
    { name: 'multi_tenant_mode', regex: /multi_tenant_mode/ },
    { name: 'languageServerMainService', regex: /languageServerMainService/ },
    { name: 'WindowGroupsState', regex: /windowGroupsState|WINDOW_GROUPS_STATE/ },
    { name: 'lsGroupsState', regex: /lsGroupsState|LS_GROUPS_STATE/ },
    { name: 'cascade-browser', regex: /"cascade-browser"/ },
    { name: 'portalUrl', regex: /portalUrl/ },
    { name: 'serviceUrl', regex: /"windsurf\.serviceUrl"/ },
    { name: 'marketplace', regex: /marketplace\.windsurf/ },
  ];
  console.log(`\n--- Key Patterns ---`);
  patterns.forEach(p => {
    const count = (content.match(new RegExp(p.regex, 'g')) || []).length;
    console.log(`  ${p.name}: ${count} occurrences`);
  });

  // 8. Marketplace extension IDs
  const extIds = [...new Set([...content.matchAll(/"codeium\.[\w.-]+"/g)].map(m => m[0]))];
  console.log(`\n--- Codeium Extension IDs (${extIds.length}) ---`);
  extIds.sort().forEach(s => console.log(`  ${s}`));

  // 9. Extract Devin CLI install code snippet
  const devinIdx = content.indexOf('installDevinCli');
  if (devinIdx > -1) {
    const snippet = content.substring(devinIdx, devinIdx + 800);
    console.log(`\n--- installDevinCli Code ---`);
    console.log(snippet.replace(/;/g, ';\n').substring(0, 1000));
  }

  // 10. Win32 context menu CLSIDs
  const clsids = [...content.matchAll(/clsid:"([^"]+)"/g)].map(m => m[1]);
  if (clsids.length) {
    console.log(`\n--- Win32 CLSIDs ---`);
    clsids.forEach(c => console.log(`  ${c}`));
  }
}

// Also check nls.messages for hidden features
function analyzeNls() {
  const filepath = path.join(BASE, 'nls.messages.json');
  const content = fs.readFileSync(filepath, 'utf-8');
  const arr = JSON.parse(content);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`NLS MESSAGES: ${arr.length} total strings`);
  console.log('='.repeat(60));
  
  const keywords = ['Cascade', 'Devin', 'Windsurf', 'Arena', 'Vibe', 'Forge', 'Codemap', 'Browser Preview', 'Worktree', 'Deploy'];
  keywords.forEach(kw => {
    const matches = arr.filter(s => s && s.includes(kw));
    if (matches.length) {
      console.log(`\n--- "${kw}" (${matches.length}) ---`);
      matches.filter(m => m.length < 150).slice(0, 15).forEach(m => console.log(`  ${m}`));
    }
  });
}

analyze('main.js');
analyze('cli.js');
analyzeNls();
