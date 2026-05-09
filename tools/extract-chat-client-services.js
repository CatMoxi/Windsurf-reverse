/**
 * Extract complete service definitions from @exa/chat-client
 * This package has the full LanguageServerService and SeatManagementService
 */
const fs = require('fs');
const path = require('path');

const CHAT_CLIENT_PATH = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'node_modules', '@exa', 'chat-client', 'index.js');
const c = fs.readFileSync(CHAT_CLIENT_PATH, 'utf-8');

console.log(`@exa/chat-client size: ${(c.length / 1024 / 1024).toFixed(1)}MB`);

// Extract ALL service definitions with their methods
const svcPattern = /typeName:\s*"([^"]+Service)",\s*methods:\s*\{/g;
let m;

while ((m = svcPattern.exec(c)) !== null) {
  const svcName = m[1];
  const startIdx = m.index + m[0].length;
  
  // Find the end of the methods block
  let depth = 1;
  let end = startIdx;
  for (let i = startIdx; i < c.length && i < startIdx + 50000; i++) {
    if (c[i] === '{') depth++;
    if (c[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  
  const methodsBlock = c.substring(startIdx, end);
  
  // Extract methods - multiple patterns
  const methods = [];
  
  // Pattern 1: name:"MethodName",I:X.TypeName,O:X.TypeName,kind:X.Kind
  const methodPat1 = /name:\s*"([^"]+)",\s*I:\s*\w+\.(\w+),\s*O:\s*\w+\.(\w+),\s*kind:\s*\w+\.(\w+)/g;
  let mm;
  while ((mm = methodPat1.exec(methodsBlock)) !== null) {
    methods.push({
      name: mm[1],
      input: mm[2],
      output: mm[3],
      kind: mm[4],
    });
  }
  
  // Pattern 2: name:"MethodName",I:X,O:X,kind:X
  if (methods.length === 0) {
    const methodPat2 = /name:"([^"]+)"/g;
    while ((mm = methodPat2.exec(methodsBlock)) !== null) {
      methods.push({ name: mm[1] });
    }
  }
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SERVICE: ${svcName} (${methods.length} methods)`);
  console.log('='.repeat(60));
  methods.forEach(m => {
    if (m.input) {
      console.log(`  rpc ${m.name}(${m.input}) returns (${m.output}) // ${m.kind}`);
    } else {
      console.log(`  rpc ${m.name}(...)`);
    }
  });
}

// Also extract from extension.js for comparison
console.log('\n\n' + '='.repeat(80));
console.log('ADDITIONAL: Searching extension.js for LanguageServerService methods');
console.log('='.repeat(80));

const extPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'dist', 'extension.js');
const ext = fs.readFileSync(extPath, 'utf-8');

// Find LanguageServerService by searching for all callers
const lsCallPat = /LanguageServerService[),]\s*(\w+)/g;
while ((m = lsCallPat.exec(ext)) !== null) {
  // nothing specific
}

// Find all RPC paths that look like service methods
const rpcPathPat = /["']\/exa\.\w+_pb\.\w+\/(\w+)["']/g;
const rpcPaths = new Set();
while ((m = rpcPathPat.exec(ext)) !== null) {
  rpcPaths.add(m[0].replace(/["']/g, ''));
}
console.log(`\nRPC Paths found in extension.js (${rpcPaths.size}):`);
[...rpcPaths].sort().forEach(p => console.log(`  ${p}`));

// Also search chat-client for RPC paths
const rpcPathPat2 = /["']\/exa\.\w+_pb\.\w+\/(\w+)["']/g;
const rpcPaths2 = new Set();
while ((m = rpcPathPat2.exec(c)) !== null) {
  rpcPaths2.add(m[0].replace(/["']/g, ''));
}
console.log(`\nRPC Paths found in @exa/chat-client (${rpcPaths2.size}):`);
[...rpcPaths2].sort().forEach(p => console.log(`  ${p}`));
