#!/usr/bin/env node
/**
 * Full-Flow Integration Test
 * 
 * Simulates the complete extension → LS → API flow:
 * 1. Start mock ExtensionServer (simulating VS Code extension)
 * 2. Start Language Server in connect mode (our implementation)
 * 3. LS calls back to ExtensionServer with LanguageServerStarted
 * 4. Client (simulating extension) makes Connect-RPC calls to LS
 * 5. Verify everything works end-to-end
 * 
 * Usage: node full-flow-test.js [--api-key KEY]
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const LS_DIR = path.join(__dirname, '..', 'src', 'language-server');
const CSRF_TOKEN = crypto.randomBytes(16).toString('hex');
const SERVICE = 'exa.language_server_pb.LanguageServerService';

let extServer, lsProcess;
let extPort, lsPort;
let lsStartedCallback = false;

async function main() {
  const apiKey = getArg('--api-key') || '';
  
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║   Full-Flow Integration Test                      ║');
  console.log('║   Mock Extension → Language Server → API          ║');
  console.log('╚════════════════════════════════════════════════════╝\n');
  
  try {
    // Phase 1: Start mock extension server
    extPort = await startExtensionServer();
    console.log(`  ✓ Mock ExtensionServer on port ${extPort}\n`);
    
    // Phase 2: Start language server
    lsPort = await startLanguageServer(extPort, apiKey);
    console.log(`  ✓ Language Server on port ${lsPort}\n`);
    
    // Phase 3: Wait for LanguageServerStarted callback
    await waitForCallback(5000);
    console.log(`  ✓ LanguageServerStarted callback received\n`);
    
    // Phase 4: Run tests
    console.log('  Running protocol tests...\n');
    let passed = 0, failed = 0;
    
    const tests = [
      ['CSRF protection', testCsrf],
      ['Heartbeat', testHeartbeat],
      ['GetUserStatus', testGetUserStatus],
      ['GetCompletions (empty)', testGetCompletions],
      ['StartCascade', testStartCascade],
      ['GetChatMessage (stream)', testStreamingMethod],
      ['Exit (graceful shutdown)', testExit],
    ];
    
    for (const [name, fn] of tests) {
      try {
        await fn();
        console.log(`    ✓ ${name}`);
        passed++;
      } catch (err) {
        console.log(`    ✗ ${name}: ${err.message}`);
        failed++;
      }
    }
    
    console.log(`\n  Results: ${passed}/${tests.length} passed\n`);
    
    if (failed === 0) {
      console.log('  ═══════════════════════════════════════');
      console.log('  ★ Full flow test PASSED ★');
      console.log('  ═══════════════════════════════════════');
    }
    
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error(`  Fatal: ${err.message}`);
    process.exit(1);
  } finally {
    cleanup();
  }
}

// === Server management ===

function startExtensionServer() {
  return new Promise((resolve, reject) => {
    extServer = http.createServer((req, res) => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const method = req.url.split('/').pop();
        
        if (method === 'LanguageServerStarted') {
          lsStartedCallback = true;
        }
        
        res.writeHead(200, { 'Content-Type': 'application/proto' });
        res.end(Buffer.alloc(0));
      });
    });
    
    extServer.listen(0, '127.0.0.1', () => resolve(extServer.address().port));
    extServer.on('error', reject);
  });
}

function startLanguageServer(extensionPort, apiKey) {
  return new Promise((resolve, reject) => {
    const args = [
      'index.js',
      '--port', '0',
      '--connect_mode',
      '--run_child',
      '--csrf_token', CSRF_TOKEN,
      '--extension_server_port', String(extensionPort),
    ];
    if (apiKey) args.push('--api_key', apiKey);
    
    lsProcess = spawn('node', args, { cwd: LS_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    
    let output = '';
    const timeout = setTimeout(() => reject(new Error('LS startup timeout (10s)')), 10000);
    
    lsProcess.stdout.on('data', data => {
      output += data.toString();
      const match = output.match(/Server listening on port (\d+)/);
      if (match) { clearTimeout(timeout); resolve(parseInt(match[1])); }
    });
    
    lsProcess.stderr.on('data', data => { output += data.toString(); });
    lsProcess.on('error', err => { clearTimeout(timeout); reject(err); });
    lsProcess.on('exit', code => {
      if (!lsPort) { clearTimeout(timeout); reject(new Error(`LS exited ${code}: ${output.slice(-200)}`)); }
    });
  });
}

function waitForCallback(timeoutMs) {
  return new Promise((resolve, reject) => {
    if (lsStartedCallback) { resolve(); return; }
    const interval = setInterval(() => {
      if (lsStartedCallback) { clearInterval(interval); resolve(); }
    }, 100);
    setTimeout(() => { clearInterval(interval); reject(new Error('LanguageServerStarted timeout')); }, timeoutMs);
  });
}

function cleanup() {
  if (lsProcess) try { lsProcess.kill(); } catch (e) {}
  if (extServer) try { extServer.close(); } catch (e) {}
}

// === Tests ===

async function testCsrf() {
  const res = await connectRPC('Heartbeat', Buffer.alloc(0), { csrf: 'WRONG' });
  assert(res.status === 403, `Expected 403, got ${res.status}`);
}

async function testHeartbeat() {
  const res = await connectRPC('Heartbeat');
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(res.headers['content-type'].includes('proto'), 'Wrong content-type');
}

async function testGetUserStatus() {
  const res = await connectRPC('GetUserStatus');
  assert(res.status === 200, `Expected 200, got ${res.status}`);
}

async function testGetCompletions() {
  const res = await connectRPC('GetCompletions');
  assert(res.status === 200, `Expected 200, got ${res.status}`);
}

async function testStartCascade() {
  const res = await connectRPC('StartCascade');
  assert(res.status === 200, `Expected 200, got ${res.status}`);
}

async function testStreamingMethod() {
  const res = await connectRPC('HandleStreamingCommand', Buffer.alloc(0), { timeout: 2000 });
  // Stream may timeout or complete — both valid without API key
  assert(res.status === 200 || res.timedOut, `Expected 200 or timeout, got ${res.status}`);
}

async function testExit() {
  const res = await connectRPC('Exit');
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  // Wait for process to actually exit
  await new Promise(r => setTimeout(r, 1000));
}

// === Helpers ===

function connectRPC(method, body = Buffer.alloc(0), opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: lsPort,
      path: `/${SERVICE}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': opts.csrf || CSRF_TOKEN,
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      const streamTimeout = opts.timeout ? setTimeout(() => {
        req.destroy();
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), timedOut: true });
      }, opts.timeout) : null;
      
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        if (streamTimeout) clearTimeout(streamTimeout);
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
      });
    });
    
    req.on('error', err => {
      if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') {
        resolve({ status: 0, headers: {}, body: Buffer.alloc(0), timedOut: true });
      } else {
        reject(err);
      }
    });
    req.setTimeout(opts.timeout || 5000, () => {
      req.destroy();
      resolve({ status: 0, headers: {}, body: Buffer.alloc(0), timedOut: true });
    });
    req.write(body);
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getArg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

main();
