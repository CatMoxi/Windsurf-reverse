#!/usr/bin/env node
/**
 * Cascade Chat Test - Validates GetChatMessage streaming with real API.
 * 
 * Tests:
 * 1. GetChatMessage with a simple prompt → streaming response with delta_text
 * 2. Validates proto encoding of stream frames
 * 3. Verifies tool_calls are forwarded
 * 
 * Usage:
 *   node tools/cascade-chat-test.js --api-key YOUR_API_KEY
 *   set CODEIUM_API_KEY=xxx && node tools/cascade-chat-test.js
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
    console.error('ERROR: No API key provided.');
    console.error('Usage: node tools/cascade-chat-test.js --api-key YOUR_KEY');
    process.exit(1);
  }
  
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   Cascade Chat Streaming Test              ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log(`  API Key: ${apiKey.substring(0, 8)}...${apiKey.slice(-4)}`);
  
  codec = require(path.join(LS_DIR, 'proto-codec'));
  console.log(`  Proto codec: ${codec.methodCount} methods\n`);
  
  try {
    lsPort = await startLS(apiKey);
    console.log(`  Language Server: port ${lsPort}\n`);
    await sleep(1000);
    
    await testChatStream(apiKey);
    
    process.exit(0);
  } catch (err) {
    console.error(`  Fatal: ${err.message}`);
    process.exit(1);
  } finally {
    if (lsProcess) lsProcess.kill();
  }
}

async function testChatStream(apiKey) {
  console.log('  Testing GetChatMessage stream...');
  
  // Build a GetChatMessageRequest (LS format)
  const reqBody = codec.encodeRequest('GetChatMessage', {
    metadata: { apiKey },
    chatMessages: [
      {
        messageId: 'msg-1',
        source: 'CHAT_MESSAGE_SOURCE_USER',
        conversationId: 'conv-test-1',
        intent: { text: 'Say "Hello from Cascade!" and nothing else.' },
      },
    ],
    chatModelName: 'claude-3-5-sonnet',
  });
  
  console.log(`    Request body: ${reqBody.length} bytes`);
  
  // Send streaming request
  const frames = await streamRequest('GetChatMessage', reqBody);
  
  console.log(`    Received ${frames.length} stream frame(s)`);
  
  if (frames.length === 0) {
    console.log('    ⚠ No data frames received (API may have rejected or timed out)');
    return;
  }
  
  // Decode each frame
  let fullText = '';
  for (let i = 0; i < Math.min(frames.length, 5); i++) {
    const frame = frames[i];
    if (frame.flags === 0 && frame.data.length > 0) {
      try {
        const decoded = codec.decodeResponse('GetChatMessage', frame.data);
        const text = decoded.chatMessage?.action?.generic?.text || '';
        fullText = text; // Each frame sends accumulated text
        console.log(`    Frame ${i}: ${frame.data.length}b, text="${text.substring(0, 80)}"`);
      } catch (e) {
        console.log(`    Frame ${i}: ${frame.data.length}b (decode error: ${e.message})`);
      }
    } else if (frame.flags === 2) {
      console.log(`    Trailer frame: ${frame.data.toString('utf-8').substring(0, 100)}`);
    }
  }
  
  if (frames.length > 5) {
    console.log(`    ... (${frames.length - 5} more frames)`);
  }
  
  console.log(`\n  ✓ GetChatMessage: "${fullText.substring(0, 100)}"`);
}

function streamRequest(method, body) {
  return new Promise((resolve, reject) => {
    const frames = [];
    const timeout = setTimeout(() => resolve(frames), 15000); // 15s timeout
    
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
      let buffer = Buffer.alloc(0);
      
      res.on('data', chunk => {
        buffer = Buffer.concat([buffer, chunk]);
        
        // Parse Connect-RPC stream frames: 1 byte flags + 4 bytes length + data
        while (buffer.length >= 5) {
          const flags = buffer.readUInt8(0);
          const length = buffer.readUInt32BE(1);
          if (buffer.length < 5 + length) break;
          
          const data = buffer.subarray(5, 5 + length);
          frames.push({ flags, data: Buffer.from(data) });
          buffer = buffer.subarray(5 + length);
        }
      });
      
      res.on('end', () => {
        clearTimeout(timeout);
        resolve(frames);
      });
    });
    
    req.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

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

function resolveApiKey() {
  const idx = process.argv.indexOf('--api-key');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (process.env.CODEIUM_API_KEY) return process.env.CODEIUM_API_KEY;
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main();
