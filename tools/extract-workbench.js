#!/usr/bin/env node
/**
 * Extract Windsurf-specific content from workbench and sessions bundles
 */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'out');

function extractFromBundle(filename) {
  const filepath = path.join(BASE, filename);
  const content = fs.readFileSync(filepath, 'utf-8');
  console.log(`\n${'='.repeat(60)}`);
  console.log(`FILE: ${filename} (${(content.length/1024/1024).toFixed(2)} MB)`);
  console.log('='.repeat(60));

  // Windsurf-specific strings
  const wsConfig = [...new Set([...content.matchAll(/"windsurf\.[\w.]+"/g)].map(m => m[0]))];
  console.log(`\n--- windsurf.* config keys (${wsConfig.length}) ---`);
  wsConfig.sort().forEach(s => console.log(`  ${s}`));

  // Cascade-specific  
  const cascadeKeys = [...new Set([...content.matchAll(/"cascade[\w.]*"/g)].map(m => m[0]))].filter(s => s.length > 10 && s.length < 80);
  console.log(`\n--- cascade* keys (${cascadeKeys.length}) ---`);
  cascadeKeys.sort().forEach(s => console.log(`  ${s}`));

  // Windsurf commands
  const wsCmds = [...new Set([...content.matchAll(/"windsurf\.[\w.]+"/g)].map(m => m[0]))];
  console.log(`\n--- windsurf.* identifiers (${wsCmds.length}) ---`);
  
  // Codeium URLs
  const urls = [...new Set([...content.matchAll(/https?:\/\/[a-zA-Z0-9._\/-]+(?:windsurf|codeium|devin)[a-zA-Z0-9._\/-]*/g)].map(m => m[0]))];
  console.log(`\n--- Windsurf/Codeium URLs (${urls.length}) ---`);
  urls.sort().forEach(u => console.log(`  ${u}`));

  // IPC/Service identifiers
  const services = [...new Set([...content.matchAll(/"(?:windsurf|cascade|codeium)[\w.]*(?:Service|Manager|Provider|Handler|Controller)"/g)].map(m => m[0]))];
  console.log(`\n--- Windsurf Services (${services.length}) ---`);
  services.sort().forEach(s => console.log(`  ${s}`));

  // Feature flags / experiment checks
  const experiments = [...new Set([...content.matchAll(/"windsurf[.:]\w+"/g)].map(m => m[0]))];
  console.log(`\n--- Windsurf context/feature keys (${experiments.length}) ---`);
  experiments.sort().forEach(s => console.log(`  ${s}`));

  // Windsurf-specific view containers/panels
  const views = [...new Set([...content.matchAll(/"(?:windsurf|cascade)[\w-]*(?:Panel|View|Editor|Tab|Container)"/g)].map(m => m[0]))];
  console.log(`\n--- Windsurf Views/Panels (${views.length}) ---`);
  views.sort().forEach(s => console.log(`  ${s}`));

  // Context keys (when clauses)
  const ctxKeys = [...new Set([...content.matchAll(/"windsurf:\w+"/g)].map(m => m[0]))];
  console.log(`\n--- windsurf: context keys (${ctxKeys.length}) ---`);
  ctxKeys.sort().forEach(s => console.log(`  ${s}`));
}

extractFromBundle('vs/workbench/workbench.desktop.main.js');
extractFromBundle('vs/sessions/sessions.desktop.main.js');
