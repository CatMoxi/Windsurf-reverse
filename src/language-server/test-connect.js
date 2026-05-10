/**
 * Test the Connect-RPC server mode
 * Tests unary and streaming methods via HTTP/1.1
 */
const http = require('http');

const PORT = process.argv[2] || '50055';
const CSRF = process.argv[3] || 'test123';
const BASE = `http://127.0.0.1:${PORT}`;
const SERVICE = 'exa.language_server_pb.LanguageServerService';

async function main() {
  console.log(`Testing Connect-RPC server on port ${PORT}...\n`);
  
  // Test unary methods
  await testUnary('Heartbeat');
  await testUnary('GetStatus');
  await testUnary('StartCascade');
  await testUnary('GetCompletions');
  await testUnary('GetCascadeModelConfigs');
  await testUnary('GetUserStatus');
  
  // Test CSRF rejection
  await testCsrfReject();
  
  // Test streaming
  await testStream('GetChatMessage');
  
  // Test unknown method
  await testUnary('NonExistentMethod', 404);
  
  console.log('\nAll Connect-RPC tests done.');
}

function testUnary(method, expectedStatus = 200) {
  return new Promise(resolve => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/${SERVICE}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': CSRF,
      },
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const ok = res.statusCode === expectedStatus;
        const status = ok ? '[OK]' : '[FAIL]';
        console.log(`  ${status} ${method}: HTTP ${res.statusCode} (${body.length}b)` +
          (res.headers['content-type'] ? ` [${res.headers['content-type']}]` : ''));
        resolve();
      });
    });
    req.on('error', err => {
      console.log(`  [ERR] ${method}: ${err.message}`);
      resolve();
    });
    req.end();
  });
}

function testCsrfReject() {
  return new Promise(resolve => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/${SERVICE}/Heartbeat`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'x-codeium-csrf-token': 'INVALID_TOKEN',
      },
    }, res => {
      const ok = res.statusCode === 403;
      console.log(`  ${ok ? '[OK]' : '[FAIL]'} CSRF rejection: HTTP ${res.statusCode}`);
      res.resume();
      res.on('end', resolve);
    });
    req.end();
  });
}

function testStream(method) {
  return new Promise(resolve => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/${SERVICE}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'x-codeium-csrf-token': CSRF,
      },
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const ct = res.headers['content-type'] || '';
        const isStream = ct.includes('connect+proto');
        console.log(`  ${res.statusCode === 200 ? '[OK]' : '[FAIL]'} ${method} [STREAM]: HTTP ${res.statusCode}` +
          ` (${body.length}b, type=${ct.split(';')[0]})`);
        resolve();
      });
    });
    req.end();
  });
}

main().catch(console.error);
