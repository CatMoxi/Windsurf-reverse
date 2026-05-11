#!/usr/bin/env node
/**
 * Final attempt to crack GetCompletions:
 * 1. Try GetTab (the new unified completion endpoint)
 * 2. Try GetChatCompletions with correct format
 * 3. Try GetStreamingExternalChatCompletions
 * 4. Try GenerateVibeAndReplaceStreaming 
 * 5. Try GetCompletions with random binary to see if it's a format validation
 */
'use strict';

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const codec = require(path.join(__dirname, '..', 'src', 'language-server', 'proto-codec'));

const apiKey = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
  .match(/CODEIUM_API_KEY=(.+)/)[1].trim();

function connectUnary(hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, port: 443, path: urlPath, method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'Content-Length': body.length,
      },
    }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    req.write(body);
    req.end();
  });
}

function connectStream(hostname, urlPath, body) {
  const hdr = Buffer.alloc(5);
  hdr.writeUInt32BE(body.length, 1);
  const framed = Buffer.concat([hdr, body]);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, port: 443, path: urlPath, method: 'POST',
      headers: {
        'Content-Type': 'application/connect+proto',
        'Connect-Protocol-Version': '1',
        'Content-Length': framed.length,
      },
    }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    req.write(framed);
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

function buildMeta(extra = {}) {
  return {
    apiKey, ideName: 'windsurf', ideVersion: '2.5.0',
    extensionVersion: '2.5.0', sessionId: crypto.randomUUID(),
    requestId: Math.floor(Math.random() * 1e9), locale: 'en_US',
    ...extra,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const SERVER = 'server.self-serve.windsurf.com';
const API = '/exa.api_server_pb.ApiServerService';

async function test(label, method, path_, reqObj, isStream = false) {
  process.stdout.write(`  [${label}]: `);
  try {
    const body = codec.encodeRequest(method, reqObj);
    if (body.length === 0) { console.log('⚠ not registered'); return; }
    
    let res;
    if (isStream) {
      res = await connectStream(SERVER, path_, body);
      const frames = parseStreamFrames(res.body);
      const data = frames.filter(f => f.flags === 0 && f.payload.length > 0);
      const trailer = frames.find(f => f.flags === 2);
      if (data.length > 0) {
        try {
          const d = codec.decodeResponse(method, data[0].payload);
          console.log(`✅ ${data.length} frames | ${JSON.stringify(d).substring(0, 200)}`);
        } catch (e) {
          console.log(`✅ ${data.length} frames (decode err: ${e.message.substring(0, 50)})`);
        }
      } else {
        const err = trailer ? trailer.payload.toString('utf-8') : '';
        console.log(`❌ HTTP ${res.status} | ${err.substring(0, 150)}`);
      }
    } else {
      res = await connectUnary(SERVER, path_, body);
      if (res.status === 200 && res.body.length > 0) {
        try {
          const d = codec.decodeResponse(method, res.body);
          console.log(`✅ ${JSON.stringify(d).substring(0, 200)}`);
        } catch (e) {
          console.log(`✅ ${res.body.length}B (decode err)`);
        }
      } else {
        console.log(`❌ HTTP ${res.status} | ${res.body.toString('utf-8').substring(0, 150)}`);
      }
    }
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Final Completions Research                              ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const codeText = 'function fibonacci(n) {\n  if (n <= 1) return n;\n  return ';

  // ===== 1. GetChatCompletions — check proto format =====
  console.log('━━━ 1. GetChatCompletions ━━━');
  // Look at the request proto
  const chatCompReq = codec.getRequestType('GetChatCompletions');
  if (chatCompReq) {
    console.log('  Fields:', chatCompReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', '));
  }
  
  await test('minimal', 'GetChatCompletions', `${API}/GetChatCompletions`, {
    metadata: buildMeta(),
  });

  await test('with model', 'GetChatCompletions', `${API}/GetChatCompletions`, {
    metadata: buildMeta(),
    completionsRequest: {
      prompt: 'Hello, say hi',
      configuration: { numCompletions: 1, maxTokens: 64 },
    },
  });
  await sleep(1000);

  // ===== 2. GetStreamingExternalChatCompletions =====
  console.log('\n━━━ 2. GetStreamingExternalChatCompletions ━━━');
  const extChatReq = codec.getRequestType('GetStreamingExternalChatCompletions');
  if (extChatReq) {
    console.log('  Fields:', extChatReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', '));
  }
  
  await test('basic', 'GetStreamingExternalChatCompletions',
    `${API}/GetStreamingExternalChatCompletions`, {
      metadata: buildMeta(),
      completionsRequest: {
        prompt: 'Hello, say hi',
        configuration: { numCompletions: 1, maxTokens: 64 },
      },
    }, true);
  await sleep(1000);

  // ===== 3. GetTab — the unified completion endpoint =====
  console.log('\n━━━ 3. GetTab ━━━');
  const tabReq = codec.getRequestType('GetTab');
  if (tabReq) {
    console.log('  Fields:', tabReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', '));
  }
  
  // Minimal
  await test('minimal', 'GetTab', `${API}/GetTab`, {
    metadata: buildMeta(),
    promptId: crypto.randomUUID(),
    language: 17,
  }, true);

  // With unified prompt components
  await test('with UPC', 'GetTab', `${API}/GetTab`, {
    metadata: buildMeta(),
    unifiedPromptComponents: {
      chatMessages: [{
        messageId: crypto.randomUUID(),
        prompt: codeText,
        source: 'CHAT_MESSAGE_SOURCE_USER',
      }],
    },
    promptId: crypto.randomUUID(),
    language: 17,
  }, true);
  await sleep(1000);

  // ===== 4. CheckChatCapacity (verify key works) =====
  console.log('\n━━━ 4. CheckChatCapacity (key verification) ━━━');
  await test('verify', 'CheckChatCapacity', `${API}/CheckChatCapacity`, {
    metadata: buildMeta(),
    modelUid: 'gpt-5-5-low',
  });
  await sleep(1000);

  // ===== 5. AssignModel — more complete request =====
  console.log('\n━━━ 5. AssignModel (better request) ━━━');
  const assignReq = codec.getRequestType('AssignModel');
  if (assignReq) {
    console.log('  Fields:', assignReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', '));
  }
  
  const cascadeId = crypto.randomUUID();
  await test('with prompt', 'AssignModel', `${API}/AssignModel`, {
    metadata: buildMeta(),
    modelRouterUid: 'gpt-5-5-low',
    cascadeId,
    chatMessagePrompt: {
      messageId: crypto.randomUUID(),
      source: 'CHAT_MESSAGE_SOURCE_USER',
      prompt: 'Hello',
    },
  });
  await sleep(1000);

  // ===== 6. GetDeepWiki with better request =====
  console.log('\n━━━ 6. GetDeepWiki ━━━');
  const dwReq = codec.getRequestType('GetDeepWiki');
  if (dwReq) {
    console.log('  Fields:', dwReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', '));
  }
  
  await test('explain', 'GetDeepWiki', `${API}/GetDeepWiki`, {
    metadata: buildMeta(),
    cascadeId: crypto.randomUUID(),
  }, true);
  await sleep(1000);

  // ===== 7. GetTeamOrganizationalControls =====
  console.log('\n━━━ 7. GetTeamOrganizationalControls ━━━');
  await test('basic', 'GetTeamOrganizationalControls',
    `${API}/GetTeamOrganizationalControls`, {
      metadata: buildMeta(),
    });
  await sleep(1000);

  // ===== 8. GetModelStatuses =====
  console.log('\n━━━ 8. GetModelStatuses ━━━');
  await test('basic', 'GetModelStatuses',
    '/exa.language_server_pb.LanguageServerService/GetModelStatuses', {
      metadata: buildMeta(),
    });
  
  // Try on API server  
  await test('on api', 'GetModelStatuses',
    `${API}/GetModelStatuses`, {
      metadata: buildMeta(),
    });
  await sleep(1000);

  // ===== 9. ShouldEnableUnleash =====
  console.log('\n━━━ 9. ShouldEnableUnleash ━━━');
  await test('basic', 'ShouldEnableUnleash',
    '/exa.language_server_pb.LanguageServerService/ShouldEnableUnleash', {
      metadata: buildMeta(),
    });

  await test('on api', 'ShouldEnableUnleash',
    `${API}/ShouldEnableUnleash`, {
      metadata: buildMeta(),
    });

  console.log('\n══════ Done ══════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
