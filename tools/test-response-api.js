#!/usr/bin/env node
/**
 * Test Response API style (stateful via trajectory_reference / cascadeId)
 * 
 * Question: Can we use trajectory_reference or message_id to make the API
 * remember previous turns without resending full history?
 * 
 * Tests:
 *   1. Pass trajectory_reference with cascadeId from previous response
 *   2. Reuse message_id from response in next request
 *   3. Check if response contains any ID we can reference back
 */
'use strict';

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const LS_DIR = path.join(__dirname, '..', 'src', 'language-server');
const codec = require(path.join(LS_DIR, 'proto-codec'));

const DEFAULT_SERVER = 'server.self-serve.windsurf.com';
const API_PATH = '/exa.api_server_pb.ApiServerService/GetChatMessage';

// ==================== HTTP ====================

function wrapConnectFrame(payload) {
  const header = Buffer.alloc(5);
  header[0] = 0;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function connectPost(server, urlPath, body) {
  const framedBody = wrapConnectFrame(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: server,
      port: 443,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/connect+proto',
        'Connect-Protocol-Version': '1',
        'Connect-Content-Encoding': 'identity',
        'Connect-Accept-Encoding': 'identity',
        'User-Agent': 'connect-es/2.0.0-rc.3',
        'Content-Length': framedBody.length,
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
    req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    req.write(framedBody);
    req.end();
  });
}

function parseStreamFrames(buf) {
  const frames = [];
  let pos = 0;
  while (pos + 5 <= buf.length) {
    const flags = buf[pos];
    const len = buf.readUInt32BE(pos + 1);
    pos += 5;
    if (pos + len > buf.length) break;
    frames.push({ flags, payload: buf.subarray(pos, pos + len) });
    pos += len;
  }
  return frames;
}

function extractFullResponse(buf) {
  const frames = parseStreamFrames(buf);
  let text = '';
  let messageId = '';
  let allFields = {};
  let errors = [];
  
  for (const f of frames) {
    if (f.flags === 2) {
      const s = f.payload.toString('utf-8');
      if (s.trim()) errors.push(s.substring(0, 200));
      continue;
    }
    if (f.payload.length === 0) continue;
    try {
      const dec = codec.decodeResponse('GetChatMessage', f.payload);
      if (dec.deltaText) text += dec.deltaText;
      if (dec.messageId) messageId = dec.messageId;
      // Collect all fields for inspection
      for (const [k, v] of Object.entries(dec)) {
        if (v && v !== '' && v !== 0 && !(Array.isArray(v) && v.length === 0)) {
          if (!allFields[k]) allFields[k] = [];
          allFields[k].push(typeof v === 'string' ? v.substring(0, 80) : v);
        }
      }
    } catch (e) {
      errors.push(`decode: ${e.message}`);
    }
  }
  return { text, messageId, allFields, errors, frameCount: frames.length };
}

// ==================== Main ====================

function resolveApiKey() {
  const idx = process.argv.indexOf('--api-key');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^CODEIUM_API_KEY=(.+)/);
      if (m) return m[1].trim();
    }
  }
  return process.env.CODEIUM_API_KEY || null;
}

function resolveServer() {
  const idx = process.argv.indexOf('--server');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^CODEIUM_API_SERVER=https?:\/\/(.+)/);
      if (m) return m[1].trim();
    }
  }
  return DEFAULT_SERVER;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No API key'); process.exit(1); }
  const server = resolveServer();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Response API Style Test (Stateful via IDs)             ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Server: ${server}\n`);

  const cascadeId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  // ============ Step 1: Send first message and capture all response IDs ============
  console.log('━━━ Step 1: First message — capture response IDs ━━━');
  
  const req1 = {
    metadata: {
      apiKey,
      ideName: 'windsurf',
      ideVersion: '2.5.0',
      extensionVersion: '2.5.0',
      sessionId,
      requestId: 1,
      locale: 'en_US',
    },
    chatMessagePrompts: [
      { messageId: 'user-msg-001', source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'My secret word is "FLAMINGO". Just say OK and nothing else.' },
    ],
    chatModelUid: 'gpt-5-5-low',
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId,
    promptId: crypto.randomUUID(),
    toolChoice: { optionName: 'none' },
  };
  
  const body1 = codec.encodeRequest('GetChatMessage', req1);
  const res1 = await connectPost(server, API_PATH, body1);
  const parsed1 = extractFullResponse(res1.body);
  
  console.log(`  Text: "${parsed1.text}"`);
  console.log(`  MessageId: "${parsed1.messageId}"`);
  console.log(`  All response fields:`);
  for (const [k, v] of Object.entries(parsed1.allFields)) {
    const display = JSON.stringify(v.length === 1 ? v[0] : v);
    console.log(`    ${k}: ${display.substring(0, 100)}`);
  }
  if (parsed1.errors.length > 0) console.log(`  Errors: ${parsed1.errors[0]}`);

  await sleep(1500);

  // ============ Step 2: Try with trajectory_reference ============
  console.log('\n━━━ Step 2: trajectory_reference (cascadeId as trajectory_id) ━━━');
  
  const req2a = {
    metadata: {
      apiKey,
      ideName: 'windsurf',
      ideVersion: '2.5.0',
      extensionVersion: '2.5.0',
      sessionId,
      requestId: 2,
      locale: 'en_US',
    },
    chatMessagePrompts: [
      { messageId: 'user-msg-002', source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'What is my secret word? Just the word.' },
    ],
    chatModelUid: 'gpt-5-5-low',
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId,  // same cascadeId
    promptId: crypto.randomUUID(),
    trajectoryReference: {
      trajectoryId: cascadeId,
      stepIndex: 0,
    },
    toolChoice: { optionName: 'none' },
  };
  
  const body2a = codec.encodeRequest('GetChatMessage', req2a);
  const res2a = await connectPost(server, API_PATH, body2a);
  const parsed2a = extractFullResponse(res2a.body);
  
  console.log(`  Text: "${parsed2a.text}"`);
  const test2a = parsed2a.text.toLowerCase().includes('flamingo');
  console.log(`  Recalls secret: ${test2a ? '✓ YES' : '✗ NO'}`);
  if (parsed2a.errors.length > 0) console.log(`  Errors: ${parsed2a.errors[0]}`);

  await sleep(1500);

  // ============ Step 3: Try with messageId reference in assistant message ============
  console.log('\n━━━ Step 3: Include assistant response as history (message_id ref) ━━━');
  
  const req2b = {
    metadata: {
      apiKey,
      ideName: 'windsurf',
      ideVersion: '2.5.0',
      extensionVersion: '2.5.0',
      sessionId,
      requestId: 3,
      locale: 'en_US',
    },
    chatMessagePrompts: [
      { messageId: 'user-msg-001', source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'My secret word is "FLAMINGO". Just say OK and nothing else.' },
      { messageId: parsed1.messageId || 'bot-msg-001', source: 'CHAT_MESSAGE_SOURCE_SYSTEM', prompt: parsed1.text },
      { messageId: 'user-msg-003', source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'What is my secret word? Just the word.' },
    ],
    chatModelUid: 'gpt-5-5-low',
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId,
    promptId: crypto.randomUUID(),
    toolChoice: { optionName: 'none' },
  };
  
  const body2b = codec.encodeRequest('GetChatMessage', req2b);
  const res2b = await connectPost(server, API_PATH, body2b);
  const parsed2b = extractFullResponse(res2b.body);
  
  console.log(`  Text: "${parsed2b.text}"`);
  const test2b = parsed2b.text.toLowerCase().includes('flamingo');
  console.log(`  Recalls secret: ${test2b ? '✓ YES' : '✗ NO'} (full history baseline)`);

  await sleep(1500);

  // ============ Step 4: Try execution_id field ============
  console.log('\n━━━ Step 4: Use executionId field ━━━');
  
  const executionId = crypto.randomUUID();
  const req4a = {
    metadata: {
      apiKey,
      ideName: 'windsurf',
      ideVersion: '2.5.0',
      extensionVersion: '2.5.0',
      sessionId,
      requestId: 4,
      locale: 'en_US',
    },
    chatMessagePrompts: [
      { messageId: 'user-msg-004', source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'My code name is "DOLPHIN-77". Say OK.' },
    ],
    chatModelUid: 'gpt-5-5-low',
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId: crypto.randomUUID(),
    promptId: crypto.randomUUID(),
    executionId,
    toolChoice: { optionName: 'none' },
  };
  
  const body4a = codec.encodeRequest('GetChatMessage', req4a);
  const res4a = await connectPost(server, API_PATH, body4a);
  const parsed4a = extractFullResponse(res4a.body);
  console.log(`  Turn 1: "${parsed4a.text}"`);

  await sleep(1500);

  // Same executionId, new message only
  const req4b = {
    metadata: {
      apiKey,
      ideName: 'windsurf',
      ideVersion: '2.5.0',
      extensionVersion: '2.5.0',
      sessionId,
      requestId: 5,
      locale: 'en_US',
    },
    chatMessagePrompts: [
      { messageId: 'user-msg-005', source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'What is my code name? Just the name.' },
    ],
    chatModelUid: 'gpt-5-5-low',
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId: crypto.randomUUID(),
    promptId: crypto.randomUUID(),
    executionId,  // same executionId
    toolChoice: { optionName: 'none' },
  };
  
  const body4b = codec.encodeRequest('GetChatMessage', req4b);
  const res4b = await connectPost(server, API_PATH, body4b);
  const parsed4b = extractFullResponse(res4b.body);
  console.log(`  Turn 2: "${parsed4b.text}"`);
  const test4 = parsed4b.text.toLowerCase().includes('dolphin');
  console.log(`  Recalls via executionId: ${test4 ? '✓ YES' : '✗ NO'}`);

  // ============ Summary ============
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   SUMMARY                                                ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  trajectory_reference:  ${test2a ? '✓ Stateful' : '✗ No state'}                         ║`);
  console.log(`║  full history (baseline): ${test2b ? '✓ Works' : '✗ Failed'}                          ║`);
  console.log(`║  executionId:            ${test4 ? '✓ Stateful' : '✗ No state'}                         ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
  
  if (!test2a && !test4 && test2b) {
    console.log('\n  结论: API 无任何 Response-API 风格的有状态机制');
    console.log('  必须每次传完整历史 (与 OpenAI Chat Completions API 行为一致)');
  } else if (test2a) {
    console.log('\n  结论: trajectory_reference 可实现有状态!');
  } else if (test4) {
    console.log('\n  结论: executionId 可实现有状态!');
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
