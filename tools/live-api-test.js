#!/usr/bin/env node
/**
 * Live API Test - Validates real API forwarding with a genuine API key.
 * 
 * Tests the full chain: Client → Connect-RPC → LS → gRPC → server.codeium.com
 * 
 * Usage:
 *   node tools/live-api-test.js --api-key YOUR_API_KEY
 *   
 *   Or set CODEIUM_API_KEY env var:
 *   set CODEIUM_API_KEY=xxx && node tools/live-api-test.js
 *   
 *   Or use saved credentials (from auth-cli.js):
 *   node tools/live-api-test.js --use-saved
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const LS_DIR = path.join(__dirname, '..', 'src', 'language-server');
const CSRF_TOKEN = crypto.randomBytes(16).toString('hex');
const SERVICE = 'exa.language_server_pb.LanguageServerService';

let lsProcess, lsPort, codec;

async function main() {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error('ERROR: No API key provided.\n');
    console.error('Usage:');
    console.error('  node tools/live-api-test.js --api-key YOUR_KEY');
    console.error('  set CODEIUM_API_KEY=xxx && node tools/live-api-test.js');
    console.error('  node tools/live-api-test.js --use-saved');
    process.exit(1);
  }
  
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   Live API Integration Test                ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`  API Key: ${apiKey.substring(0, 8)}...${apiKey.slice(-4)}`);
  console.log();
  
  // Load proto codec
  codec = require(path.join(LS_DIR, 'proto-codec'));
  console.log(`  Proto codec: ${codec.methodCount} methods loaded`);
  
  try {
    // Start LS with real API key
    lsPort = await startLS(apiKey);
    console.log(`  Language Server: port ${lsPort}\n`);
    
    // Give the LS time to initialize API connection
    await sleep(1000);
    
    let passed = 0, failed = 0;
    
    const tests = [
      ['GetUserStatus (real API)', testGetUserStatus],
      ['GetProfileData (real API)', testGetProfileData],
      ['Heartbeat', testHeartbeat],
      ['GetCompletions (simple)', testGetCompletions],
    ];
    
    for (const [name, fn] of tests) {
      try {
        await fn(apiKey);
        passed++;
      } catch (err) {
        console.log(`  ✗ ${name}: ${err.message}`);
        failed++;
      }
    }
    
    console.log(`\n  Results: ${passed}/${tests.length} passed\n`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error(`  Fatal: ${err.message}`);
    process.exit(1);
  } finally {
    if (lsProcess) lsProcess.kill();
  }
}

// === Tests ===

async function testGetUserStatus(apiKey) {
  const reqBody = codec.encodeRequest('GetUserStatus', {
    metadata: { apiKey },
  });
  const res = await connectRPC('GetUserStatus', reqBody);
  assert(res.status === 200, `HTTP ${res.status}`);
  
  if (res.body.length > 0) {
    const decoded = codec.decodeResponse('GetUserStatus', res.body);
    const name = decoded.userStatus?.name || '(no name)';
    const pro = decoded.userStatus?.pro || false;
    const email = decoded.userStatus?.email || '(no email)';
    const plan = decoded.planInfo?.planName || '(no plan)';
    console.log(`  ✓ GetUserStatus: name="${name}", email="${email}", pro=${pro}, plan="${plan}"`);
  } else {
    console.log(`  ✓ GetUserStatus: empty response (API may not have returned data)`);
  }
}

async function testGetProfileData(apiKey) {
  const reqBody = codec.encodeRequest('GetProfileData', {
    apiKey,
  });
  const res = await connectRPC('GetProfileData', reqBody);
  assert(res.status === 200, `HTTP ${res.status}`);
  
  if (res.body.length > 0) {
    const decoded = codec.decodeResponse('GetProfileData', res.body);
    const url = decoded.profilePictureUrl || '(none)';
    console.log(`  ✓ GetProfileData: avatar="${url.substring(0, 60)}..."`);
  } else {
    console.log(`  ✓ GetProfileData: empty response`);
  }
}

async function testHeartbeat(apiKey) {
  const reqBody = codec.encodeRequest('Heartbeat', {
    metadata: { apiKey },
  });
  const res = await connectRPC('Heartbeat', reqBody);
  assert(res.status === 200, `HTTP ${res.status}`);
  console.log(`  ✓ Heartbeat: OK (${res.body.length}b)`);
}

async function testGetCompletions(apiKey) {
  const reqBody = codec.encodeRequest('GetCompletions', {
    metadata: { apiKey },
    document: {
      text: 'function hello() {\n  console.log("Hello, ',
      cursorOffset: 43,
      language: 4, // LANGUAGE_JAVASCRIPT
      editorLanguage: 'javascript',
    },
  });
  const res = await connectRPC('GetCompletions', reqBody);
  assert(res.status === 200, `HTTP ${res.status}`);
  
  if (res.body.length > 0) {
    const decoded = codec.decodeResponse('GetCompletions', res.body);
    const items = decoded.completionItems || [];
    console.log(`  ✓ GetCompletions: ${items.length} completion(s), ${res.body.length}b`);
    if (items.length > 0) {
      const first = items[0];
      const text = first.completion?.text || first.completionParts?.[0]?.text || '(no text)';
      console.log(`    First: "${text.substring(0, 80)}..."`);
    }
  } else {
    console.log(`  ✓ GetCompletions: empty response (may need more context)`);
  }
}

// === Infrastructure ===

function startLS(apiKey) {
  return new Promise((resolve, reject) => {
    const args = [
      'index.js', '--port', '0', '--connect_mode',
      '--csrf_token', CSRF_TOKEN,
      '--api_key', apiKey,
      '--api_server_url', 'https://server.codeium.com',
    ];
    lsProcess = spawn('node', args, { cwd: LS_DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    
    let output = '';
    const timeout = setTimeout(() => reject(new Error('LS startup timeout')), 15000);
    
    lsProcess.stdout.on('data', d => {
      output += d.toString();
      const m = output.match(/Server listening on port (\d+)/);
      if (m) { clearTimeout(timeout); resolve(parseInt(m[1])); }
    });
    lsProcess.stderr.on('data', d => { output += d.toString(); });
    lsProcess.on('error', e => { clearTimeout(timeout); reject(e); });
    lsProcess.on('exit', c => {
      if (!lsPort) { clearTimeout(timeout); reject(new Error(`LS exited ${c}`)); }
    });
  });
}

function connectRPC(method, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1', port: lsPort,
      path: `/${SERVICE}/${method}`, method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': CSRF_TOKEN,
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('Timeout')));
    req.write(body);
    req.end();
  });
}

function resolveApiKey() {
  // 1. --api-key arg
  const idx = process.argv.indexOf('--api-key');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  
  // 2. CODEIUM_API_KEY env
  if (process.env.CODEIUM_API_KEY) return process.env.CODEIUM_API_KEY;
  
  // 3. --use-saved: read from ~/.windsurf-dev/credentials.json
  if (process.argv.includes('--use-saved')) {
    const credPath = path.join(require('os').homedir(), '.windsurf-dev', 'credentials.json');
    try {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'));
      if (creds.apiKey) return creds.apiKey;
    } catch (e) {}
    
    // Also try auth-cli saved credentials
    const authPath = path.join(__dirname, '..', '.env');
    try {
      const env = fs.readFileSync(authPath, 'utf-8');
      const m = env.match(/CODEIUM_API_KEY=(.+)/);
      if (m) return m[1].trim();
    } catch (e) {}
  }
  
  return null;
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main();
