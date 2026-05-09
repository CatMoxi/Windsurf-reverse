/**
 * Deep extraction of ALL service methods including LanguageServerService and SeatManagementService
 * These services may use a different pattern in the bundle
 */
const fs = require('fs');
const path = require('path');

const EXT_PATH = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'dist', 'extension.js');
const c = fs.readFileSync(EXT_PATH, 'utf-8');

// Find LanguageServerService - look for all methods patterns
console.log('=== LanguageServerService methods ===');
// Pattern: methodName:{name:"MethodName",I:X.RequestType,O:X.ResponseType,kind:...}
// Find the service definition block
let lsIdx = c.indexOf('"exa.language_server_pb.LanguageServerService"');
if (lsIdx === -1) lsIdx = c.indexOf("'exa.language_server_pb.LanguageServerService'");
console.log(`Found at index: ${lsIdx}`);

if (lsIdx >= 0) {
  // Search forward for methods block
  const searchRegion = c.substring(lsIdx, lsIdx + 20000);
  const methodNamePat = /(\w+):\{name:"([^"]+)",I:\w+\.(\w+),O:\w+\.(\w+),kind:\w+\.(\w+)\}/g;
  let m;
  while ((m = methodNamePat.exec(searchRegion)) !== null) {
    console.log(`  ${m[2]}(${m[3]}) → ${m[4]} [${m[5]}]`);
  }
}

// Try alternative pattern for LanguageServerService
console.log('\n=== LanguageServerService (alternative search) ===');
const lsPats = [
  /LanguageServerService[^}]*methods:\{([^]*?)\}\s*\}/,
  /typeName:"exa\.language_server_pb\.LanguageServerService"[^]*?methods:\{/,
];

// Search for all Request types in language_server_pb
const lsReqPat = /typeName="exa\.language_server_pb\.(\w+Request)"/g;
let m;
const lsRequests = [];
while ((m = lsReqPat.exec(c)) !== null) {
  lsRequests.push(m[1]);
}
console.log(`\nLanguageServer Request types (${lsRequests.length}):`);
lsRequests.forEach(r => console.log(`  ${r}`));

// Search for all Response types
const lsRespPat = /typeName="exa\.language_server_pb\.(\w+Response)"/g;
const lsResponses = [];
while ((m = lsRespPat.exec(c)) !== null) {
  lsResponses.push(m[1]);
}
console.log(`\nLanguageServer Response types (${lsResponses.length}):`);
lsResponses.forEach(r => console.log(`  ${r}`));

// SeatManagementService
console.log('\n=== SeatManagementService Request/Response types ===');
const smReqPat = /typeName="exa\.seat_management_pb\.(\w+)"/g;
const smTypes = new Set();
while ((m = smReqPat.exec(c)) !== null) {
  smTypes.add(m[1]);
}
[...smTypes].sort().forEach(t => console.log(`  ${t}`));

// Find ALL proto packages
console.log('\n=== ALL Proto Packages ===');
const pkgPat = /typeName="(exa\.[^"]+)"/g;
const packages = new Set();
while ((m = pkgPat.exec(c)) !== null) {
  const pkg = m[1].split('.').slice(0, -1).join('.');
  packages.add(pkg);
}
[...packages].sort().forEach(p => console.log(`  ${p}`));

// Find chat_client_server methods
console.log('\n=== chat_client_server_pb types ===');
const chatPat = /typeName="exa\.chat_client_server_pb\.(\w+)"/g;
const chatTypes = [];
while ((m = chatPat.exec(c)) !== null) {
  chatTypes.push(m[1]);
}
chatTypes.forEach(t => console.log(`  ${t}`));

// Find windsurf_pb types
console.log('\n=== windsurf_pb types ===');
const wsPat = /typeName="exa\.windsurf_pb\.(\w+)"/g;
const wsTypes = [];
while ((m = wsPat.exec(c)) !== null) {
  wsTypes.push(m[1]);
}
wsTypes.forEach(t => console.log(`  ${t}`));

// Look for Cascade/completion related services in @exa/chat-client
const chatClientPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'node_modules', '@exa', 'chat-client');
if (fs.existsSync(chatClientPath)) {
  console.log('\n=== @exa/chat-client package ===');
  const chatPkg = JSON.parse(fs.readFileSync(path.join(chatClientPath, 'package.json'), 'utf-8'));
  console.log(`  version: ${chatPkg.version}`);
  console.log(`  main: ${chatPkg.main}`);
  
  // Find all .js files
  const walkSync = (dir, files = []) => {
    fs.readdirSync(dir).forEach(f => {
      const fp = path.join(dir, f);
      if (fs.statSync(fp).isDirectory()) walkSync(fp, files);
      else if (f.endsWith('.js') && fs.statSync(fp).size > 1000) files.push(fp);
    });
    return files;
  };
  const chatFiles = walkSync(chatClientPath);
  console.log(`  JS files: ${chatFiles.length}`);
  
  // Search for service definitions in chat-client
  for (const file of chatFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const svcPat2 = /typeName:\s*"([^"]+Service)"/g;
    while ((m = svcPat2.exec(content)) !== null) {
      console.log(`  Service in ${path.basename(file)}: ${m[1]}`);
    }
  }
}
