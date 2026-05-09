const fs = require('fs');
const content = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/dist/extension.js', 'utf-8');

// Supabase references
const patterns = ['supabase', 'gotrue', 'SUPABASE', 'GoTrueClient', 'GoTrue'];
patterns.forEach(p => {
  const count = (content.match(new RegExp(p, 'gi')) || []).length;
  console.log(`${p}: ${count} matches`);
});

// Find supabase URL pattern
const supaUrlRe = /[a-z]+\.supabase\.co/gi;
let m;
const supaUrls = new Set();
while ((m = supaUrlRe.exec(content)) !== null) supaUrls.add(m[0]);
console.log('\n=== Supabase URLs ===');
[...supaUrls].forEach(u => console.log(u));

// Find GoTrueClient or createClient related to auth
const gotrueIdx = content.indexOf('GoTrueClient');
if (gotrueIdx >= 0) {
  console.log('\n=== GoTrueClient context ===');
  console.log(content.substring(Math.max(0, gotrueIdx - 200), gotrueIdx + 400));
}

// Find firebaseIdToken broader context
const fbIdx = content.indexOf('firebaseIdToken');
if (fbIdx >= 0) {
  console.log('\n=== firebaseIdToken context (wide) ===');
  console.log(content.substring(Math.max(0, fbIdx - 600), fbIdx + 600));
}

// Find SeatManagementService
const seatIdx = content.indexOf('SeatManagementService');
if (seatIdx >= 0) {
  console.log('\n=== SeatManagementService context ===');
  console.log(content.substring(Math.max(0, seatIdx - 300), seatIdx + 600));
}

// Find api_key usage context
const apikeyIdx = content.indexOf('"api_key"');
if (apikeyIdx >= 0) {
  console.log('\n=== api_key context ===');
  console.log(content.substring(Math.max(0, apikeyIdx - 300), apikeyIdx + 400));
}

// Find all proto service paths (/package.Service/Method)
const protoRe = /["']\/exa\.[a-zA-Z._]+\/[A-Z][a-zA-Z]+["']/g;
const protoServices = new Set();
while ((m = protoRe.exec(content)) !== null) protoServices.add(m[0].replace(/["']/g, ''));
console.log('\n=== Exa Proto Service Paths ===');
[...protoServices].sort().forEach(s => console.log(s));

// Find broader proto paths
const protoRe2 = /["']\/[a-zA-Z._]+\/[A-Z][a-zA-Z]+["']/g;
const allProto = new Set();
while ((m = protoRe2.exec(content)) !== null) {
  const p = m[0].replace(/["']/g, '');
  if (p.split('/').length === 3 && !p.includes('http') && !p.includes('\\')) {
    allProto.add(p);
  }
}
console.log('\n=== All Proto-like Paths ===');
[...allProto].sort().forEach(s => console.log(s));
