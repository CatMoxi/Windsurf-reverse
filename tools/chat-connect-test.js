#!/usr/bin/env node
/**
 * Chat via Connect-RPC - Send GetChatMessage to server.self-serve.windsurf.com
 * using Connect-RPC (HTTP/1.1 + proto) instead of gRPC.
 * 
 * Usage:
 *   node tools/chat-connect-test.js --api-key KEY [--server HOST]
 */
'use strict';

const https = require('https');
const path = require('path');

const LS_DIR = path.join(__dirname, '..', 'src', 'language-server');
const codec = require(path.join(LS_DIR, 'proto-codec'));

const API_KEY = resolveArg('--api-key') || process.env.CODEIUM_API_KEY;
const SERVER = resolveArg('--server') || 'server.self-serve.windsurf.com';
const PROMPT = resolveArg('--prompt') || 'Say "Hello from Cascade!" and nothing else.';

if (!API_KEY) {
  console.error('Usage: node tools/chat-connect-test.js --api-key KEY [--server HOST] [--prompt TEXT]');
  process.exit(1);
}

console.log('╔════════════════════════════════════════════════════╗');
console.log('║   Chat Connect-RPC Test                           ║');
console.log('╚════════════════════════════════════════════════════╝');
console.log(`  Server: ${SERVER}`);
console.log(`  API Key: ${API_KEY.substring(0, 15)}...${API_KEY.slice(-4)}`);
console.log(`  Prompt: "${PROMPT.substring(0, 50)}"\n`);

async function main() {
  // Test 1a: Connect-RPC with api_key in proto body
  console.log('  [Test 1a] GetCascadeModelConfigs (api_key in body)...');
  try {
    const body1 = codec.encodeRequest('GetCascadeModelConfigs', {
      metadata: { apiKey: API_KEY, ideName: 'windsurf', ideVersion: '2.2.1017', extensionVersion: '2.2.1017' },
    });
    const r1 = await connectRpcPost(SERVER, 'exa.api_server_pb.ApiServerService/GetCascadeModelConfigs', body1, {});
    console.log(`    HTTP ${r1.status}, ${r1.body.length} bytes`);
    if (r1.status === 200 && r1.body.length > 0) {
      try {
        const decoded = codec.decodeResponse('GetCascadeModelConfigs', stripEnvelope(r1.body));
        const models = decoded.modelConfigs || [];
        console.log(`    ${models.length} model(s): ${models.slice(0, 3).map(m => m.modelName || '?').join(', ')}`);
      } catch (e) { console.log(`    Decode: ${e.message}`); }
    } else if (r1.body.length > 0) {
      console.log(`    Body: ${r1.body.toString('utf-8').substring(0, 200)}`);
    }
  } catch (e) { console.log(`    ERROR: ${e.message}`); }

  // Test 1b: With Authorization Bearer header
  console.log('  [Test 1b] GetCascadeModelConfigs (Authorization header)...');
  try {
    const body1 = codec.encodeRequest('GetCascadeModelConfigs', {
      metadata: { apiKey: API_KEY, ideName: 'windsurf', ideVersion: '2.2.1017', extensionVersion: '2.2.1017' },
    });
    const r1 = await connectRpcPost(SERVER, 'exa.api_server_pb.ApiServerService/GetCascadeModelConfigs', body1, {
      'Authorization': `Bearer ${API_KEY}`,
    });
    console.log(`    HTTP ${r1.status}, ${r1.body.length} bytes`);
    if (r1.status === 200 && r1.body.length > 0) {
      try {
        const decoded = codec.decodeResponse('GetCascadeModelConfigs', stripEnvelope(r1.body));
        const models = decoded.modelConfigs || [];
        console.log(`    ${models.length} model(s): ${models.slice(0, 3).map(m => m.modelName || '?').join(', ')}`);
      } catch (e) { console.log(`    Decode: ${e.message}`); }
    } else if (r1.body.length > 0) {
      console.log(`    Body: ${r1.body.toString('utf-8').substring(0, 200)}`);
    }
  } catch (e) { console.log(`    ERROR: ${e.message}`); }

  // Test 1c: With x-auth-token header
  console.log('  [Test 1c] GetCascadeModelConfigs (x-auth-token header)...');
  try {
    const body1 = codec.encodeRequest('GetCascadeModelConfigs', {
      metadata: { apiKey: API_KEY, ideName: 'windsurf', ideVersion: '2.2.1017', extensionVersion: '2.2.1017' },
    });
    const r1 = await connectRpcPost(SERVER, 'exa.api_server_pb.ApiServerService/GetCascadeModelConfigs', body1, {
      'x-auth-token': API_KEY,
    });
    console.log(`    HTTP ${r1.status}, ${r1.body.length} bytes`);
    if (r1.status === 200 && r1.body.length > 0) {
      try {
        const decoded = codec.decodeResponse('GetCascadeModelConfigs', stripEnvelope(r1.body));
        const models = decoded.modelConfigs || [];
        console.log(`    ${models.length} model(s): ${models.slice(0, 3).map(m => m.modelName || '?').join(', ')}`);
      } catch (e) { console.log(`    Decode: ${e.message}`); }
    } else if (r1.body.length > 0) {
      console.log(`    Body: ${r1.body.toString('utf-8').substring(0, 200)}`);
    }
  } catch (e) { console.log(`    ERROR: ${e.message}`); }

  // Test 2: Connect-RPC streaming (GetChatMessage)
  console.log('\n  [Test 2] GetChatMessage (stream)...');
  try {
    // Use api_server_pb format: chat_message_prompts + chat_model_name
    const body2 = codec.encodeRequest('GetChatMessage', {
      metadata: { apiKey: API_KEY, ideName: 'windsurf', ideVersion: '2.2.1017', extensionVersion: '2.2.1017' },
      chatMessagePrompts: [
        { messageId: 'msg-1', source: 'CHAT_MESSAGE_SOURCE_USER', prompt: PROMPT },
      ],
      chatModelName: 'claude-3-5-sonnet',
    });
    console.log(`    Request: ${body2.length} bytes`);
    
    const r2 = await connectRpcStream(SERVER, 'exa.api_server_pb.ApiServerService/GetChatMessage', body2);
    console.log(`    HTTP ${r2.status}, ${r2.frames.length} frame(s), type: ${r2.contentType}`);
    
    let fullText = '';
    for (let i = 0; i < Math.min(r2.frames.length, 5); i++) {
      const frame = r2.frames[i];
      if (frame.flags === 0 && frame.data.length > 0) {
        try {
          const decoded = codec.decodeResponse('GetChatMessage', frame.data);
          const dt = decoded.deltaText || '';
          fullText += dt;
          console.log(`    Frame ${i}: ${frame.data.length}b, delta="${dt.substring(0, 60)}"`);
        } catch (e) {
          // Try raw parse
          console.log(`    Frame ${i}: ${frame.data.length}b (decode err: ${e.message})`);
          console.log(`      hex: ${frame.data.subarray(0, 40).toString('hex')}`);
        }
      } else if (frame.flags === 2) {
        const trailerText = frame.data.toString('utf-8');
        console.log(`    Trailer: ${trailerText.substring(0, 200)}`);
      }
    }
    
    if (r2.frames.length > 5) console.log(`    ... (${r2.frames.length - 5} more frames)`);
    
    if (fullText) {
      console.log(`\n  ✓ AI Response: "${fullText.substring(0, 200)}"`);
    } else if (r2.body && r2.body.length > 0) {
      console.log(`\n    Raw body (${r2.body.length}b): ${r2.body.toString('utf-8').substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`    ERROR: ${e.message}`);
  }

  // Test 3: Try LanguageServerService format (in case server is actually LS-compatible)
  console.log('\n  [Test 3] LanguageServerService/GetChatMessage...');
  try {
    const body3 = codec.encodeRequest('GetChatMessage', {
      metadata: { apiKey: API_KEY },
      chatMessages: [
        {
          messageId: 'msg-1',
          source: 'CHAT_MESSAGE_SOURCE_USER',
          conversationId: 'conv-1',
          intent: { text: PROMPT },
        },
      ],
      chatModelName: 'claude-3-5-sonnet',
    });
    
    const r3 = await connectRpcStream(SERVER, 'exa.language_server_pb.LanguageServerService/GetChatMessage', body3);
    console.log(`    HTTP ${r3.status}, ${r3.frames.length} frame(s)`);
    if (r3.body.length > 0 && r3.status !== 200) {
      console.log(`    Body: ${r3.body.toString('utf-8').substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`    ERROR: ${e.message}`);
  }
}

function connectRpcPost(host, method, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      port: 443,
      path: `/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'User-Agent': 'connect-es/1.4.0',
        'Content-Length': body.length,
        ...extraHeaders,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks),
        contentType: res.headers['content-type'] || '',
      }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Timeout')));
    req.write(body);
    req.end();
  });
}

function connectRpcStream(host, method, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      port: 443,
      path: `/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'Connect-Content-Encoding': 'identity',
        'User-Agent': 'connect-es/1.4.0',
        'Content-Length': body.length,
      },
    }, res => {
      const frames = [];
      let buffer = Buffer.alloc(0);
      const rawChunks = [];
      const timeout = setTimeout(() => resolve({
        status: res.statusCode,
        frames,
        body: Buffer.concat(rawChunks),
        contentType: res.headers['content-type'] || '',
      }), 30000);
      
      res.on('data', chunk => {
        rawChunks.push(chunk);
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= 5) {
          const flags = buffer.readUInt8(0);
          const length = buffer.readUInt32BE(1);
          if (buffer.length < 5 + length) break;
          frames.push({ flags, data: Buffer.from(buffer.subarray(5, 5 + length)) });
          buffer = buffer.subarray(5 + length);
        }
      });
      
      res.on('end', () => {
        clearTimeout(timeout);
        resolve({
          status: res.statusCode,
          frames,
          body: Buffer.concat(rawChunks),
          contentType: res.headers['content-type'] || '',
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    req.write(body);
    req.end();
  });
}

function stripEnvelope(buf) {
  if (buf.length > 5) {
    const len = buf.readUInt32BE(1);
    if ((buf[0] & 0x7e) === 0 && len > 0 && len + 5 === buf.length) return buf.subarray(5);
  }
  return buf;
}

function resolveArg(name) {
  const idx = process.argv.indexOf(name);
  return (idx !== -1 && process.argv[idx + 1]) ? process.argv[idx + 1] : null;
}

main().catch(e => { console.error(e); process.exit(1); });
