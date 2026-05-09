/**
 * Extract ALL URLs and HTTP headers from extension.js AND @exa/chat-client
 */
const fs = require('fs');
const path = require('path');

const files = [
  path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'dist', 'extension.js'),
  path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'node_modules', '@exa', 'chat-client', 'index.js'),
];

const allUrls = new Set();
const allHeaders = new Set();
const apiKeyPatterns = [];

for (const f of files) {
  const c = fs.readFileSync(f, 'utf-8');
  const name = path.basename(path.dirname(f)) + '/' + path.basename(f);
  
  // URLs - broader pattern
  const urlPat = /["'`](https?:\/\/[a-zA-Z0-9._\/-]+\.[a-zA-Z]{2,}[a-zA-Z0-9._\/-]*)["'`]/g;
  let m;
  while ((m = urlPat.exec(c)) !== null) {
    const url = m[1];
    // Filter out irrelevant URLs
    if (url.includes('w3.org') || url.includes('mozilla.org') || url.includes('json-schema') ||
        url.includes('example.com') || url.includes('nodejs.org') || url.includes('creativecommons') ||
        url.includes('unpkg.com') || url.includes('cdn.jsdelivr') || url.includes('fonts.google') ||
        url.includes('github.com/nicolo') || url.includes('schema.org') || url.includes('xml') ||
        url.includes('microsoft.com/en-us') || url.includes('tc39.es') || url.length > 200) continue;
    allUrls.add(url);
  }
  
  // Custom headers - look for header.set, header.append, and object-style
  const headerSetPat = /(?:header|headers?)\.(?:set|append)\s*\(\s*["']([^"']+)["']/gi;
  while ((m = headerSetPat.exec(c)) !== null) allHeaders.add(m[1]);
  
  // X- prefixed headers
  const xHeaderPat = /["'](X-[A-Za-z-]+)["']/g;
  while ((m = xHeaderPat.exec(c)) !== null) allHeaders.add(m[1]);
  
  // Content-Type values
  const ctPat = /["'](application\/[a-zA-Z.+-]+)["']/g;
  while ((m = ctPat.exec(c)) !== null) allHeaders.add('Content-Type: ' + m[1]);
  
  // API key header patterns
  const akPat = /["']([A-Z][a-z]+-[A-Z][a-z]+(?:-[A-Z][a-z]+)*)["']\s*[,:]/g;
  while ((m = akPat.exec(c)) !== null) {
    if (m[1].length > 5 && m[1].length < 40) allHeaders.add(m[1]);
  }
}

console.log(`=== URLS (${allUrls.size}) ===`);
const categorized = {};
for (const url of [...allUrls].sort()) {
  const domain = new URL(url).hostname;
  if (!categorized[domain]) categorized[domain] = [];
  categorized[domain].push(url);
}
for (const [domain, urls] of Object.entries(categorized).sort()) {
  console.log(`\n  [${domain}]`);
  urls.forEach(u => console.log(`    ${u}`));
}

console.log(`\n=== HEADERS (${allHeaders.size}) ===`);
[...allHeaders].sort().forEach(h => console.log(`  ${h}`));
