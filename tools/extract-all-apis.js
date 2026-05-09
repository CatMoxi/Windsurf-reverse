/**
 * Extract ALL API interfaces from Windsurf extension.js
 * - All gRPC service definitions (typeName, methods)
 * - All proto message definitions (typeName, fields)
 * - All HTTP endpoints / URLs
 * - All interceptors and headers
 */
const fs = require('fs');
const path = require('path');

const EXT_PATH = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'dist', 'extension.js');
const c = fs.readFileSync(EXT_PATH, 'utf-8');

const results = {
  services: [],
  messages: [],
  urls: [],
  headers: [],
};

// ===== 1. Extract ALL service definitions =====
// Pattern: {typeName:"exa.xxx.Service",methods:{...}}
const svcPattern = /\{typeName:"([^"]+Service)"[^}]*methods:\{/g;
let m;
while ((m = svcPattern.exec(c)) !== null) {
  const svcName = m[1];
  const startIdx = m.index + m[0].length;
  
  // Parse methods by finding all name:"..." patterns within this block
  let depth = 1;
  let end = startIdx;
  for (let i = startIdx; i < c.length && i < startIdx + 10000; i++) {
    if (c[i] === '{') depth++;
    if (c[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  
  const methodsBlock = c.substring(startIdx, end);
  const methodPattern = /(\w+):\{name:"([^"]+)",I:(\w+)\.([^,]+),O:(\w+)\.([^,]+),kind:(\w+)\.(\w+)/g;
  const methods = [];
  let mm;
  while ((mm = methodPattern.exec(methodsBlock)) !== null) {
    methods.push({
      jsName: mm[1],
      name: mm[2],
      inputType: mm[4],
      outputType: mm[6],
      kind: mm[8],
    });
  }
  
  // Fallback: simpler pattern
  if (methods.length === 0) {
    const simpleMethodPat = /name:"([^"]+)"/g;
    while ((mm = simpleMethodPat.exec(methodsBlock)) !== null) {
      methods.push({ name: mm[1] });
    }
  }
  
  results.services.push({ typeName: svcName, methods });
}

// ===== 2. Extract ALL proto message definitions =====
// Pattern: static typeName="exa.xxx.MessageName";static fields=...newFieldList(()=>[...])
const msgPattern = /typeName="([^"]+)";\s*static fields=\w+\.proto3\.util\.newFieldList\(\(\)=>\[([^\]]*)\]\)/g;
while ((m = msgPattern.exec(c)) !== null) {
  const typeName = m[1];
  const fieldsStr = m[2];
  
  // Parse fields
  const fieldPattern = /\{no:(\d+),name:"([^"]+)"(?:,jsonName:"([^"]+)")?(?:,kind:"([^"]+)")?(?:,T:(\d+|[^,}]+))?(?:,repeated:(\w+))?/g;
  const fields = [];
  let fm;
  while ((fm = fieldPattern.exec(fieldsStr)) !== null) {
    fields.push({
      no: parseInt(fm[1]),
      name: fm[2],
      jsonName: fm[3] || fm[2],
      kind: fm[4] || 'scalar',
      type: fm[5] || '',
      repeated: fm[6] === '!0' || fm[6] === 'true',
    });
  }
  
  results.messages.push({ typeName, fields });
}

// ===== 3. Extract ALL URLs =====
const urlPattern = /["'](https?:\/\/[a-zA-Z0-9._\-\/]+(?:\.[a-zA-Z]{2,})[a-zA-Z0-9._\-\/]*)["']/g;
const urlSet = new Set();
while ((m = urlPattern.exec(c)) !== null) {
  const url = m[1];
  if (!url.includes('w3.org') && !url.includes('mozilla.org') && 
      !url.includes('json-schema.org') && !url.includes('example.com') &&
      !url.includes('nodejs.org') && !url.includes('creativecommons') &&
      !url.includes('github.com/nicolo') && !url.includes('unpkg.com') &&
      !url.includes('cdn.jsdelivr') && !url.includes('fonts.googleapis')) {
    urlSet.add(url);
  }
}
results.urls = [...urlSet].sort();

// ===== 4. Extract all custom headers =====
const headerPattern = /header\.set\("([^"]+)"/g;
const headerSet = new Set();
while ((m = headerPattern.exec(c)) !== null) {
  headerSet.add(m[1]);
}
// Also find headers in objects
const headerObjPattern = /["']([A-Z][a-zA-Z-]+)["']\s*:\s*["']/g;
while ((m = headerObjPattern.exec(c)) !== null) {
  const h = m[1];
  if (h.includes('-') && h.length > 5 && h.length < 40) {
    headerSet.add(h);
  }
}
results.headers = [...headerSet].sort();

// ===== 5. Extract createConnectTransport calls =====
const transportPattern = /createConnectTransport\(\{([^}]+)\}/g;
const transports = [];
while ((m = transportPattern.exec(c)) !== null) {
  transports.push(m[1].replace(/\s+/g, ' ').trim());
}

// ===== 6. Extract createPromiseClient / createClient calls =====
const clientPattern = /create(?:Promise)?Client\)\((\w+)\.(\w+)/g;
const clients = new Set();
while ((m = clientPattern.exec(c)) !== null) {
  clients.add(m[2]);
}

// ===== Output =====
console.log('='.repeat(80));
console.log('WINDSURF NEXT API COMPLETE EXTRACTION');
console.log('='.repeat(80));

console.log(`\n${'='.repeat(40)}\nSERVICES (${results.services.length})\n${'='.repeat(40)}`);
results.services.forEach(svc => {
  console.log(`\n### ${svc.typeName}`);
  svc.methods.forEach(m => {
    if (m.inputType) {
      console.log(`  ${m.name}(${m.inputType}) → ${m.outputType} [${m.kind}]`);
    } else {
      console.log(`  ${m.name}`);
    }
  });
});

console.log(`\n${'='.repeat(40)}\nPROTO MESSAGES (${results.messages.length})\n${'='.repeat(40)}`);
results.messages.forEach(msg => {
  console.log(`\n### ${msg.typeName}`);
  msg.fields.forEach(f => {
    const typeMap = { '9': 'string', '8': 'bool', '5': 'int32', '13': 'uint32', '4': 'uint64', '3': 'int64', '2': 'float', '1': 'double', '12': 'bytes' };
    const typeName = typeMap[f.type] || f.type || 'unknown';
    console.log(`  ${f.no}: ${f.name} (${f.kind}${f.repeated ? ', repeated' : ''}) ${typeName}`);
  });
});

console.log(`\n${'='.repeat(40)}\nURLS (${results.urls.length})\n${'='.repeat(40)}`);
results.urls.forEach(u => console.log(`  ${u}`));

console.log(`\n${'='.repeat(40)}\nHEADERS (${results.headers.length})\n${'='.repeat(40)}`);
results.headers.forEach(h => console.log(`  ${h}`));

console.log(`\n${'='.repeat(40)}\nCONNECT TRANSPORTS (${transports.length})\n${'='.repeat(40)}`);
transports.forEach(t => console.log(`  ${t}`));

console.log(`\n${'='.repeat(40)}\nCLIENTS CREATED (${clients.size})\n${'='.repeat(40)}`);
[...clients].forEach(c => console.log(`  ${c}`));

// Write structured JSON
const outPath = path.join(__dirname, 'api-extraction.json');
fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nFull results saved to: ${outPath}`);
