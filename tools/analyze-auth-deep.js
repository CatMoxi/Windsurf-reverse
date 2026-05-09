const fs = require('fs');
const c = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/dist/extension.js', 'utf-8');

// Find getWebsite definition
const gwPat = /getWebsite[=\s]*(?:function|\()/g;
let m;
while ((m = gwPat.exec(c)) !== null) {
  const ctx = c.substring(Math.max(0, m.index - 50), m.index + 300);
  if (ctx.includes('http') || ctx.includes('windsurf') || ctx.includes('return')) {
    console.log('=== getWebsite def ===');
    console.log(ctx);
    console.log('---');
  }
}

// Find Config enum/object values
const configPat = /Config\.\w+\s*=\s*["'][^"']+["']/g;
while ((m = configPat.exec(c)) !== null) {
  console.log('CONFIG: ' + m[0]);
}

// Find handleAuthToken
const hatIdx = c.indexOf('handleAuthToken(A)');
if (hatIdx >= 0) {
  console.log('\n=== handleAuthToken ===');
  console.log(c.substring(hatIdx, hatIdx + 800));
}

// Find registerUser response handling - apiKey extraction
const apiKeyIdx = c.indexOf('{apiKey:');
if (apiKeyIdx < 0) {
  // try destructured
  const ak2 = c.indexOf('apiKey');
  if (ak2 >= 0) {
    const ctx = c.substring(Math.max(0, ak2 - 200), ak2 + 300);
    if (ctx.includes('registerUser') || ctx.includes('handleAuth')) {
      console.log('\n=== apiKey near registerUser ===');
      console.log(ctx);
    }
  }
}

// Find X-Api-Key header usage
const xApiPat = /X-Api-Key/g;
const xApiMatches = [];
while ((m = xApiPat.exec(c)) !== null) {
  xApiMatches.push(c.substring(Math.max(0, m.index - 80), m.index + 120));
}
console.log('\n=== X-Api-Key usage (' + xApiMatches.length + ') ===');
xApiMatches.slice(0, 5).forEach((ctx, i) => {
  console.log(`[${i}] ${ctx}`);
  console.log('---');
});

// Find all Config string values
const configDefPat = /e\.Config\s*=\s*\{[^}]+\}/g;
while ((m = configDefPat.exec(c)) !== null) {
  console.log('\n=== Config enum ===');
  console.log(m[0]);
}

// Alternative: find Config object
const configObjPat = /Config\s*=\s*\{[^}]*API_SERVER[^}]*\}/g;
while ((m = configObjPat.exec(c)) !== null) {
  console.log('\n=== Config obj ===');
  console.log(m[0]);
}

// Find isStaging
const isStagingPat = /isStaging[=\s]*function|function isStaging|isStaging\s*=/g;
while ((m = isStagingPat.exec(c)) !== null) {
  console.log('\n=== isStaging ===');
  console.log(c.substring(m.index, m.index + 300));
  break;
}
