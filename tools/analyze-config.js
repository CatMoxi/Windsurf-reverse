const fs = require('fs');
const c = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/dist/extension.js', 'utf-8');

// Find the Config enum definition - look for WEBSITE, API_SERVER_URL etc
// Pattern: something like C.WEBSITE="..." or Config={WEBSITE:...}
const configAssignPat = /C\.(\w+)\s*=\s*["']([^"']+)["']/g;
let m;
const configValues = {};
while ((m = configAssignPat.exec(c)) !== null) {
  if (m[1].match(/^[A-Z_]+$/) && m[2].length > 2) {
    configValues[m[1]] = m[2];
  }
}
console.log('=== Config C.KEY = "value" ===');
Object.entries(configValues).forEach(([k,v]) => console.log(`  ${k} = ${v}`));

// Find the getConfig function definition
const getConfigIdx = c.indexOf('e.getConfig=u');
if (getConfigIdx >= 0) {
  // Find function u near it
  const region = c.substring(Math.max(0, getConfigIdx - 2000), getConfigIdx + 200);
  // Find function u definition
  const uFnIdx = region.lastIndexOf('function u(');
  if (uFnIdx >= 0) {
    console.log('\n=== function u (getConfig) ===');
    console.log(region.substring(uFnIdx, uFnIdx + 500));
  }
}

// Find WINDSURF_EXT and CODEIUM_DEV_EXT values
const extPat = /(?:WINDSURF_EXT|CODEIUM_DEV_EXT|CODEIUM_EXT)\s*=\s*["']([^"']+)["']/g;
while ((m = extPat.exec(c)) !== null) {
  console.log('EXT: ' + m[0]);
}

// Find Config object definition near WEBSITE
const websiteConfigIdx = c.indexOf('WEBSITE');
if (websiteConfigIdx >= 0) {
  const region = c.substring(Math.max(0, websiteConfigIdx - 500), websiteConfigIdx + 500);
  // Find the nearest { before WEBSITE
  console.log('\n=== WEBSITE context ===');
  console.log(region);
}

// Find DEFAULT_API_SERVER_URL value
const defApiIdx = c.indexOf('DEFAULT_API_SERVER_URL');
if (defApiIdx >= 0) {
  console.log('\n=== DEFAULT_API_SERVER_URL context ===');
  console.log(c.substring(defApiIdx, defApiIdx + 200));
}

// Find windsurf.com references for website
const wsComPat = /["']https:\/\/windsurf\.com[^"']*["']/g;
const wsComUrls = new Set();
while ((m = wsComPat.exec(c)) !== null) wsComUrls.add(m[0]);
console.log('\n=== windsurf.com URLs ===');
[...wsComUrls].forEach(u => console.log(u));

// Find codeium-staging reference
const stagingPat = /["']https:\/\/[^"']*staging[^"']*["']/g;
const stagingUrls = new Set();
while ((m = stagingPat.exec(c)) !== null) stagingUrls.add(m[0]);
console.log('\n=== Staging URLs ===');
[...stagingUrls].forEach(u => console.log(u));
