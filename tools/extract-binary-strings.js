#!/usr/bin/env node
/**
 * Extract meaningful strings from Go LS binary
 * Targets: CLI flags, env vars, URLs, gRPC paths, interesting constants
 */
const fs = require('fs');
const path = require('path');

const binPath = path.resolve(__dirname, '../windsurf-next/resources/app/extensions/windsurf/bin/language_server_windows_x64.exe');

console.log(`Reading: ${binPath}`);
console.log(`Size: ${(fs.statSync(binPath).size / 1024 / 1024).toFixed(1)} MB`);

const buf = fs.readFileSync(binPath);
const strings = new Set();

// Extract printable ASCII strings of length >= 6
let start = -1;
for (let i = 0; i < buf.length; i++) {
  const b = buf[i];
  if (b >= 32 && b <= 126) {
    if (start === -1) start = i;
  } else {
    if (start !== -1 && (i - start) >= 6) {
      const s = buf.toString('ascii', start, i);
      strings.add(s);
    }
    start = -1;
  }
}

console.log(`Total strings (>=6 chars): ${strings.size}`);

// Categorize
const flags = [];
const envVars = [];
const urls = [];
const grpcPaths = [];
const goPackages = [];
const interesting = [];

for (const s of strings) {
  if (/^--[a-z][a-z_]{3,60}$/.test(s)) {
    flags.push(s);
  } else if (/^(CODEIUM|WINDSURF|VSCODE|DEVIN|CASCADE)_[A-Z_]+$/.test(s)) {
    envVars.push(s);
  } else if (/^https?:\/\/[a-z]/.test(s) && s.length < 150) {
    urls.push(s);
  } else if (/^\/[a-z]+\.[a-z]+\.[a-z]+\/[A-Z]/.test(s)) {
    grpcPaths.push(s);
  } else if (/^github\.com\//.test(s) && s.length < 100) {
    goPackages.push(s);
  } else if (/windsurf|codeium|cascade|devin|cortex|lifeguard/i.test(s) && s.length < 120 && s.length > 8) {
    interesting.push(s);
  }
}

// Output
console.log(`\n=== CLI Flags (${flags.length}) ===`);
flags.sort().forEach(f => console.log(f));

console.log(`\n=== Env Vars (${envVars.length}) ===`);
envVars.sort().forEach(f => console.log(f));

console.log(`\n=== URLs (${urls.length}) ===`);
urls.sort().forEach(f => console.log(f));

console.log(`\n=== gRPC Paths (${grpcPaths.length}) ===`);
grpcPaths.sort().forEach(f => console.log(f));

console.log(`\n=== Go Packages (first 50 of ${goPackages.length}) ===`);
goPackages.sort().slice(0, 50).forEach(f => console.log(f));

console.log(`\n=== Interesting strings (first 80 of ${interesting.length}) ===`);
interesting.sort().slice(0, 80).forEach(f => console.log(f));
