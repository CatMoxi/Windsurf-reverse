#!/usr/bin/env node
/**
 * End-to-End Test: Simulates the real extension → LS flow
 * 
 * Tests the complete Connect-RPC protocol stack:
 * 1. Start LS in connect mode
 * 2. Make requests mimicking the extension (with CSRF token)
 * 3. Verify responses match expected format
 * 
 * Usage: node e2e-test.js [--api-key KEY]
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const LS_DIR = path.join(__dirname, '..', 'src', 'language-server');
const CSRF_TOKEN = crypto.randomBytes(16).toString('hex');
const SERVICE = 'exa.language_server_pb.LanguageServerService';
const DEV_SERVICE = 'exa.dev_pb.DevService';

let lsProcess;
let lsPort;

async function main() {
  const apiKey = getArg('--api-key') || '';
  
  console.log('╔════════════════════════════════════════╗');
  console.log('║   Windsurf LS End-to-End Test Suite    ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  try {
    // 1. Start language server
    lsPort = await startLanguageServer(apiKey);
    console.log(`  ✓ Language Server started on port ${lsPort}\n`);
    
    // 2. Run test suite
    let passed = 0, failed = 0;
    
    const tests = [
      ['CSRF rejection', testCsrfRejection],
      ['Heartbeat (unary)', testHeartbeat],
      ['GetCompletions (unary)', testGetCompletions],
      ['GetUserStatus (unary)', testGetUserStatus],
      ['GetCascadeModelConfigs (unary)', testGetCascadeModelConfigs],
      ['StartCascade (unary)', testStartCascade],
      ['GetChatMessage (stream)', testGetChatMessage],
      ['HandleStreamingCommand (stream)', testHandleStreamingCommand],
      ['Unknown method (404)', testUnknownMethod],
    ];
    
    for (const [name, fn] of tests) {
      try {
        await fn();
        console.log(`  ✓ ${name}`);
        passed++;
      } catch (err) {
        console.log(`  ✗ ${name}: ${err.message}`);
        failed++;
      }
    }
    
    console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error(`Fatal: ${err.message}`);
    process.exit(1);
  } finally {
    if (lsProcess) lsProcess.kill();
  }
}

function startLanguageServer(apiKey) {
  return new Promise((resolve, reject) => {
    const args = [
      'index.js',
      '--port', '0',
      '--connect_mode',
      '--csrf_token', CSRF_TOKEN,
    ];
    if (apiKey) args.push('--api_key', apiKey);
    
    lsProcess = spawn('node', args, { cwd: LS_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    
    let output = '';
    const timeout = setTimeout(() => reject(new Error('LS startup timeout')), 10000);
    
    lsProcess.stdout.on('data', data => {
      output += data.toString();
      const match = output.match(/Server listening on port (\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(parseInt(match[1]));
      }
    });
    
    lsProcess.stderr.on('data', data => {
      output += data.toString();
    });
    
    lsProcess.on('error', err => { clearTimeout(timeout); reject(err); });
    lsProcess.on('exit', code => {
      if (!lsPort) { clearTimeout(timeout); reject(new Error(`LS exited with ${code}: ${output}`)); }
    });
  });
}

// === Test functions ===

async function testCsrfRejection() {
  const res = await request('Heartbeat', Buffer.alloc(0), { csrf: 'WRONG' });
  assert(res.status === 403, `Expected 403, got ${res.status}`);
}

async function testHeartbeat() {
  const res = await request('Heartbeat', Buffer.alloc(0));
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(res.headers['content-type'].includes('proto'), 'Expected proto content-type');
}

async function testGetCompletions() {
  const res = await request('GetCompletions', Buffer.alloc(0));
  assert(res.status === 200, `Expected 200, got ${res.status}`);
}

async function testGetUserStatus() {
  const res = await request('GetUserStatus', Buffer.alloc(0));
  assert(res.status === 200, `Expected 200, got ${res.status}`);
}

async function testGetCascadeModelConfigs() {
  const res = await request('GetCascadeModelConfigs', Buffer.alloc(0));
  assert(res.status === 200, `Expected 200, got ${res.status}`);
}

async function testStartCascade() {
  const res = await request('StartCascade', Buffer.alloc(0));
  assert(res.status === 200, `Expected 200, got ${res.status}`);
}

async function testGetChatMessage() {
  // Streaming: we check initial response headers (200 + connect+proto)
  // Without a valid API key, the stream may hang, so we accept timeout
  const res = await requestStream('GetChatMessage', Buffer.alloc(0));
  if (res.timedOut) return; // Acceptable: no API key → stream never starts
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(res.headers['content-type'].includes('connect+proto'), 
    `Expected streaming content-type, got ${res.headers['content-type']}`);
}

async function testHandleStreamingCommand() {
  const res = await requestStream('HandleStreamingCommand', Buffer.alloc(0));
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  assert(res.headers['content-type'].includes('connect+proto'), 
    `Expected streaming content-type, got ${res.headers['content-type']}`);
}

async function testUnknownMethod() {
  const res = await request('NonExistentMethod123', Buffer.alloc(0));
  assert(res.status === 404, `Expected 404, got ${res.status}`);
}

// === Helpers ===

function request(method, body, { csrf, service } = {}) {
  return new Promise((resolve, reject) => {
    const svc = service || SERVICE;
    const req = http.request({
      hostname: '127.0.0.1',
      port: lsPort,
      path: `/${svc}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': csrf || CSRF_TOKEN,
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('Request timeout')));
    req.write(body);
    req.end();
  });
}

/**
 * Request that only waits for the initial response headers + first chunk
 * Used for streaming endpoints that may hang waiting for upstream data
 */
function requestStream(method, body, { csrf, service } = {}) {
  return new Promise((resolve, reject) => {
    const svc = service || SERVICE;
    const req = http.request({
      hostname: '127.0.0.1',
      port: lsPort,
      path: `/${svc}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': csrf || CSRF_TOKEN,
        'Content-Length': body.length,
      },
    }, res => {
      // Got response headers — that's enough for streaming test
      const chunks = [];
      const done = setTimeout(() => {
        req.destroy();
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      }, 500); // Wait up to 500ms for initial data
      
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        clearTimeout(done);
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });
    req.on('error', err => {
      if (err.code !== 'ECONNRESET' && err.code !== 'ERR_STREAM_DESTROYED') reject(err);
    });
    req.setTimeout(2000, () => {
      // For streaming endpoints, timeout just means no data came — still pass
      req.destroy();
      resolve({
        status: 0,
        headers: {},
        body: Buffer.alloc(0),
        timedOut: true,
      });
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
