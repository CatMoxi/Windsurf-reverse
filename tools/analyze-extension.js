/**
 * Analyze Windsurf extension.js webpack bundle
 * Extract module list, auth-related code, API endpoints
 */
const fs = require('fs');
const path = require('path');

const EXT_PATH = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'dist', 'extension.js');

const content = fs.readFileSync(EXT_PATH, 'utf-8');
console.log(`extension.js size: ${(content.length / 1024 / 1024).toFixed(1)}MB`);

// Extract webpack module IDs
const modulePattern = /(\d+)\s*\(\s*[A-Za-z_$]+\s*,\s*[A-Za-z_$]+(?:\s*,\s*[A-Za-z_$]+)*\s*\)\s*\{/g;
const modules = [];
let match;
while ((match = modulePattern.exec(content)) !== null) {
  modules.push({ id: match[1], offset: match.index });
}
console.log(`\nWebpack modules found: ${modules.length}`);

// Extract URLs (API endpoints)
const urlPattern = /https?:\/\/[a-zA-Z0-9._\-\/]+(?:\.[a-zA-Z]{2,})[a-zA-Z0-9._\-\/]*/g;
const urls = new Set();
let urlMatch;
while ((urlMatch = urlPattern.exec(content)) !== null) {
  const url = urlMatch[0];
  if (!url.includes('github.com/nicolo') && 
      !url.includes('creativecommons') &&
      !url.includes('w3.org') &&
      !url.includes('json-schema.org') &&
      !url.includes('nodejs.org/api') &&
      !url.includes('mozilla.org') &&
      !url.includes('example.com')) {
    urls.add(url);
  }
}

// Categorize URLs
const windsurf_urls = [...urls].filter(u => u.includes('windsurf') || u.includes('codeium') || u.includes('exafunction'));
const auth_urls = [...urls].filter(u => u.includes('auth') || u.includes('login') || u.includes('token') || u.includes('oauth') || u.includes('firebase') || u.includes('identitytoolkit') || u.includes('securetoken'));
const api_urls = [...urls].filter(u => u.includes('api.') || u.includes('/api/') || u.includes('grpc'));

console.log(`\n=== WINDSURF/CODEIUM URLs (${windsurf_urls.length}) ===`);
windsurf_urls.forEach(u => console.log(`  ${u}`));

console.log(`\n=== AUTH-RELATED URLs (${auth_urls.length}) ===`);
auth_urls.forEach(u => console.log(`  ${u}`));

console.log(`\n=== API URLs (${api_urls.length}) ===`);
api_urls.forEach(u => console.log(`  ${u}`));

// Extract auth-related string patterns
const authPatterns = [
  /["']windsurf[_.]auth["']/g,
  /["']api_key["']/g,
  /["']session_id["']/g,
  /["']firebase["']/g,
  /register_user/g,
  /GetProcesses/g,
  /LoginIntent/g,
  /["']Authorization["']/g,
  /Bearer\s/g,
];

console.log(`\n=== AUTH STRING PATTERNS ===`);
authPatterns.forEach(p => {
  const matches = content.match(p);
  console.log(`  ${p.source}: ${matches ? matches.length : 0} matches`);
});

// Extract function/class names containing 'auth' or 'login'
const authFnPattern = /(?:function|class|const|let|var)\s+([a-zA-Z_$]*(?:auth|login|Auth|Login|SESSION|Session|Token|token)[a-zA-Z_$]*)/gi;
const authFns = new Set();
while ((match = authFnPattern.exec(content)) !== null) {
  authFns.add(match[1]);
}
console.log(`\n=== AUTH-RELATED IDENTIFIERS (${authFns.size}) ===`);
[...authFns].sort().forEach(fn => console.log(`  ${fn}`));

// Look for protobuf service definitions
const protoPattern = /["'](?:\/[a-zA-Z.]+\/[A-Z][a-zA-Z]+)["']/g;
const protoServices = new Set();
while ((match = protoPattern.exec(content)) !== null) {
  const svc = match[0].replace(/["']/g, '');
  if (svc.includes('.') && !svc.includes('//') && svc.split('/').length >= 3) {
    protoServices.add(svc);
  }
}
console.log(`\n=== PROTO SERVICE PATHS (${protoServices.size}) ===`);
[...protoServices].sort().forEach(s => console.log(`  ${s}`));

// Look for gRPC connect-rpc service definitions
const connectPattern = /createPromiseClient|createConnectTransport|Transport.*baseUrl|ConnectRouter/g;
const connectMatches = content.match(connectPattern);
console.log(`\n=== Connect-RPC patterns: ${connectMatches ? connectMatches.length : 0} ===`);
if (connectMatches) {
  [...new Set(connectMatches)].forEach(m => console.log(`  ${m}`));
}

console.log('\nDone.');
