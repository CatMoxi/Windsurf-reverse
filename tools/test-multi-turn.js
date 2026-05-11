#!/usr/bin/env node
/**
 * Test Multi-Turn Conversation
 * 
 * Tests whether Windsurf API maintains conversation context across multiple turns.
 * Key questions:
 *   - Does cascadeId preserve history (stateful)?
 *   - Do we need to pass full message history each time (stateless)?
 *   - What happens with same cascadeId but only incremental messages?
 *   - What happens with same cascadeId and full history?
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

function extractResponse(buf) {
  const frames = parseStreamFrames(buf);
  let text = '';
  let errors = [];
  let toolCalls = [];
  for (const f of frames) {
    if (f.flags === 2) {
      const s = f.payload.toString('utf-8');
      if (s.trim()) errors.push(s.substring(0, 150));
      continue;
    }
    if (f.payload.length === 0) continue;
    try {
      const dec = codec.decodeResponse('GetChatMessage', f.payload);
      if (dec.deltaText) text += dec.deltaText;
      if (dec.deltaToolCalls) {
        for (const tc of dec.deltaToolCalls) {
          toolCalls.push({ name: tc.name || '', args: tc.argumentsJson || '' });
        }
      }
    } catch (e) {}
  }
  return { text, errors, toolCalls };
}

// ==================== Request Builder ====================

function buildRequest(apiKey, messages, options = {}) {
  const {
    model = 'gpt-5-5-low',
    cascadeId = crypto.randomUUID(),
    promptId = crypto.randomUUID(),
    sessionId = crypto.randomUUID(),
  } = options;

  const chatMessagePrompts = messages.map(m => ({
    messageId: m.id || crypto.randomUUID(),
    source: m.role === 'user' ? 'CHAT_MESSAGE_SOURCE_USER' 
           : m.role === 'assistant' ? 'CHAT_MESSAGE_SOURCE_SYSTEM'
           : 'CHAT_MESSAGE_SOURCE_USER',
    prompt: m.content,
  }));

  const req = {
    metadata: {
      apiKey,
      ideName: 'windsurf',
      ideVersion: '2.5.0',
      extensionVersion: '2.5.0',
      sessionId,
      requestId: Math.floor(Math.random() * 1e9),
      locale: 'en_US',
    },
    chatMessagePrompts,
    chatModelUid: model,
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId,
    promptId,
    toolChoice: { optionName: 'none' }, // force text-only for clean test
  };

  return codec.encodeRequest('GetChatMessage', req);
}

// ==================== Tests ====================

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

async function sendAndLog(label, apiKey, server, messages, options) {
  const body = buildRequest(apiKey, messages, options);
  const res = await connectPost(server, API_PATH, body);
  const parsed = extractResponse(res.body);
  
  console.log(`  [${label}] HTTP ${res.status}`);
  if (parsed.errors.length > 0) {
    console.log(`    Error: ${parsed.errors[0].substring(0, 100)}`);
  }
  console.log(`    Response: "${parsed.text.substring(0, 150)}"`);
  return parsed.text;
}

async function main() {
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No API key'); process.exit(1); }
  const server = resolveServer();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Multi-Turn Conversation Test                           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Server: ${server}\n`);

  // ============================================================
  // TEST 1: Stateless — send full history every time, new cascadeId each turn
  // ============================================================
  console.log('━━━ TEST 1: Stateless (full history, new cascadeId each turn) ━━━');
  
  const history1 = [];
  
  history1.push({ role: 'user', content: 'My secret code is "TIGER-42". Remember it. Just say OK.' });
  let r1 = await sendAndLog('Turn 1', apiKey, server, history1, {});
  history1.push({ role: 'assistant', content: r1 });
  
  await sleep(1000);
  
  history1.push({ role: 'user', content: 'What color is the sky? Answer briefly.' });
  r1 = await sendAndLog('Turn 2', apiKey, server, history1, {});
  history1.push({ role: 'assistant', content: r1 });
  
  await sleep(1000);
  
  history1.push({ role: 'user', content: 'What was my secret code? Just tell me the code, nothing else.' });
  r1 = await sendAndLog('Turn 3 (recall)', apiKey, server, history1, {});
  
  const test1Pass = r1.toLowerCase().includes('tiger') || r1.includes('42');
  console.log(`  → Context preserved: ${test1Pass ? '✓ YES' : '✗ NO'}\n`);

  // ============================================================
  // TEST 2: Same cascadeId — incremental (only new message each turn)
  // ============================================================
  console.log('━━━ TEST 2: Same cascadeId, incremental messages (only latest) ━━━');
  
  const cascadeId2 = crypto.randomUUID();
  const sessionId2 = crypto.randomUUID();
  const opts2 = { cascadeId: cascadeId2, sessionId: sessionId2 };
  
  let r2 = await sendAndLog('Turn 1', apiKey, server, 
    [{ role: 'user', content: 'My favorite animal is a PENGUIN. Just say OK.' }], opts2);
  
  await sleep(1000);
  
  r2 = await sendAndLog('Turn 2', apiKey, server,
    [{ role: 'user', content: 'What is 2+2? Answer briefly.' }], opts2);
  
  await sleep(1000);
  
  r2 = await sendAndLog('Turn 3 (recall)', apiKey, server,
    [{ role: 'user', content: 'What is my favorite animal? Just the animal name.' }], opts2);
  
  const test2Pass = r2.toLowerCase().includes('penguin');
  console.log(`  → Server remembers via cascadeId: ${test2Pass ? '✓ YES (stateful!)' : '✗ NO (stateless)'}\n`);

  // ============================================================
  // TEST 3: Same cascadeId — full history every time
  // ============================================================
  console.log('━━━ TEST 3: Same cascadeId + full history ━━━');
  
  const cascadeId3 = crypto.randomUUID();
  const sessionId3 = crypto.randomUUID();
  const history3 = [];
  
  history3.push({ role: 'user', content: 'The password is "OCEAN-99". Remember it. Say OK.' });
  let r3 = await sendAndLog('Turn 1', apiKey, server, history3, 
    { cascadeId: cascadeId3, sessionId: sessionId3 });
  history3.push({ role: 'assistant', content: r3 });
  
  await sleep(1000);
  
  history3.push({ role: 'user', content: 'Tell me a fun fact about cats. Be brief.' });
  r3 = await sendAndLog('Turn 2', apiKey, server, history3,
    { cascadeId: cascadeId3, sessionId: sessionId3 });
  history3.push({ role: 'assistant', content: r3 });
  
  await sleep(1000);
  
  history3.push({ role: 'user', content: 'What was the password I told you? Only the password.' });
  r3 = await sendAndLog('Turn 3 (recall)', apiKey, server, history3,
    { cascadeId: cascadeId3, sessionId: sessionId3 });
  
  const test3Pass = r3.toLowerCase().includes('ocean') || r3.includes('99');
  console.log(`  → Context preserved: ${test3Pass ? '✓ YES' : '✗ NO'}\n`);

  // ============================================================
  // TEST 4: Longer conversation (5 turns) — stress test context window
  // ============================================================
  console.log('━━━ TEST 4: 5-turn conversation (full history, stateless) ━━━');
  
  const history4 = [];
  const facts = [
    ['My name is Alice.', 'alice'],
    ['I live in Tokyo.', 'tokyo'],
    ['My favorite number is 7.', '7'],
    ['I have 3 cats named Whiskers, Shadow, and Luna.', 'luna'],
  ];
  
  for (let i = 0; i < facts.length; i++) {
    history4.push({ role: 'user', content: `Remember this fact: ${facts[i][0]} Just say OK.` });
    const r = await sendAndLog(`Turn ${i+1}`, apiKey, server, history4, {});
    history4.push({ role: 'assistant', content: r });
    await sleep(800);
  }
  
  // Final recall
  history4.push({ role: 'user', content: 'Tell me: What is my name, where do I live, what is my favorite number, and what are my cats named? Answer briefly.' });
  const r4 = await sendAndLog('Turn 5 (recall all)', apiKey, server, history4, {});
  
  const recallCount = facts.filter(f => r4.toLowerCase().includes(f[1])).length;
  console.log(`  → Recalled ${recallCount}/${facts.length} facts: ${recallCount === facts.length ? '✓ FULL' : recallCount > 0 ? '△ PARTIAL' : '✗ NONE'}\n`);

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   SUMMARY                                                ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Test 1 (stateless, full history):    ${test1Pass ? '✓ Context OK' : '✗ Context LOST'}       ║`);
  console.log(`║  Test 2 (same cascadeId, incremental): ${test2Pass ? '✓ Stateful' : '✗ Stateless'}          ║`);
  console.log(`║  Test 3 (same cascadeId + full hist):  ${test3Pass ? '✓ Context OK' : '✗ Context LOST'}       ║`);
  console.log(`║  Test 4 (5 turns, full history):       ${recallCount}/${facts.length} facts recalled     ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  if (test1Pass && !test2Pass) {
    console.log('║  结论: API 无状态 — 必须每次发送完整历史           ║');
  } else if (test2Pass) {
    console.log('║  结论: API 有状态 — cascadeId 保持上下文           ║');
  } else {
    console.log('║  结论: 需要进一步调查                               ║');
  }
  console.log('╚══════════════════════════════════════════════════════════╝');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
