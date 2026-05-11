#!/usr/bin/env node
/**
 * Test remaining API endpoints:
 * #1: GetDevstralStream
 * #2: AssignModel
 * #3: SeatManagement (GetUserStatus, GetProfileData, GetCurrentUser)
 * #4: GetCompletions (proper format)
 * #5: GetStreamingCompletions
 * #6: GetTranscription (speech-to-text)
 * #7: GetConfig / GetStatus
 * #8: UserAnalytics
 * #9: CascadePlugins
 */
'use strict';

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const codec = require(path.join(__dirname, '..', 'src', 'language-server', 'proto-codec'));

const apiKey = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
  .match(/CODEIUM_API_KEY=(.+)/)[1].trim();
const apiServer = 'server.self-serve.windsurf.com';
const regServer = 'register.windsurf.com';

function wrapFrame(payload) {
  const h = Buffer.alloc(5);
  h.writeUInt32BE(payload.length, 1);
  return Buffer.concat([h, payload]);
}

function connectStream(hostname, urlPath, body, timeout = 30000) {
  const framed = wrapFrame(body);
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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('Timeout')));
    req.write(framed);
    req.end();
  });
}

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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    req.write(body);
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

function buildMeta() {
  return {
    apiKey, ideName: 'windsurf', ideVersion: '2.5.0',
    extensionVersion: '2.5.0', sessionId: crypto.randomUUID(),
    requestId: Math.floor(Math.random() * 1e9), locale: 'en_US',
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tryDecode(method, buf) {
  try { return codec.decodeResponse(method, buf); }
  catch (e) { return null; }
}

function getError(frames) {
  for (const f of frames) {
    if (f.flags === 2) {
      const s = f.payload.toString('utf-8');
      if (s.trim() && s.trim() !== '{}') return s.substring(0, 200);
    }
  }
  return null;
}

async function testEndpoint(label, hostname, urlPath, method, reqObj, isStream = false) {
  process.stdout.write(`  [${label}]: `);
  try {
    const body = codec.encodeRequest(method, reqObj);
    if (body.length === 0) {
      console.log('⚠ encodeRequest empty (method not registered)');
      return null;
    }

    let res;
    if (isStream) {
      res = await connectStream(hostname, urlPath, body);
    } else {
      res = await connectUnary(hostname, urlPath, body);
    }

    if (isStream) {
      const frames = parseStreamFrames(res.body);
      const err = getError(frames);
      const dataFrames = frames.filter(f => f.flags === 0 && f.payload.length > 0);
      
      if (err) {
        console.log(`HTTP ${res.status} | ${dataFrames.length} data frames | ⚠ ${err}`);
      } else {
        let decoded = null;
        let text = '';
        for (const df of dataFrames) {
          const d = tryDecode(method, df.payload);
          if (d) {
            decoded = d;
            // Try to extract text from various response formats
            if (d.deltaText) text += d.deltaText;
            if (d.output) text += d.output;
            if (d.deltas) {
              for (const [k, v] of Object.entries(d.deltas)) {
                if (v.deltaText) text += v.deltaText;
              }
            }
            if (d.response && d.response.deltaText) text += d.response.deltaText;
          }
        }
        console.log(`HTTP ${res.status} | ${dataFrames.length} data frames | text="${text.substring(0, 80)}"`);
        return decoded;
      }
    } else {
      if (res.status !== 200) {
        const errText = res.body.toString('utf-8').substring(0, 200);
        console.log(`HTTP ${res.status} | ${errText}`);
        return null;
      }
      const dec = tryDecode(method, res.body);
      if (dec) {
        const summary = JSON.stringify(dec).substring(0, 250);
        console.log(`HTTP 200 | ${summary}`);
        return dec;
      } else {
        console.log(`HTTP 200 | ${res.body.length}B (decode failed)`);
        return null;
      }
    }
  } catch (e) {
    console.log(`ERROR: ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║   Remaining Endpoint Tests                           ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ===== #1: GetDevstralStream =====
  console.log('━━━ #1: GetDevstralStream ━━━');
  await testEndpoint('basic', apiServer,
    '/exa.api_server_pb.ApiServerService/GetDevstralStream',
    'GetDevstralStream', {
      metadata: buildMeta(),
      chatMessagePrompts: [{
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: 'Say hello',
      }],
    }, true);

  // With tools_json
  await testEndpoint('with tools', apiServer,
    '/exa.api_server_pb.ApiServerService/GetDevstralStream',
    'GetDevstralStream', {
      metadata: buildMeta(),
      chatMessagePrompts: [{
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: 'Read file /tmp/test.txt',
      }],
      toolsJson: JSON.stringify([{
        type: 'function',
        function: { name: 'read_file', description: 'Read a file', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }
      }]),
    }, true);
  await sleep(2000);

  // ===== #2: AssignModel =====
  console.log('\n━━━ #2: AssignModel / AssignArenaModel ━━━');
  const cascadeId = crypto.randomUUID();
  
  await testEndpoint('AssignModel gpt-5-5-low', apiServer,
    '/exa.api_server_pb.ApiServerService/AssignModel',
    'AssignModel', {
      metadata: buildMeta(),
      modelRouterUid: 'gpt-5-5-low',
      cascadeId,
      chatMessagePrompt: {
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: 'Hello',
      },
    }, false);

  await testEndpoint('AssignArenaModel', apiServer,
    '/exa.api_server_pb.ApiServerService/AssignArenaModel',
    'AssignArenaModel', {
      metadata: buildMeta(),
      arenaId: crypto.randomUUID(),
      cascadeIds: [cascadeId],
      modelRouterUid: 'gpt-5-5-low',
    }, false);
  await sleep(1500);

  // ===== #3: SeatManagement =====
  console.log('\n━━━ #3: SeatManagement (register.windsurf.com) ━━━');
  
  // GetUserStatus - try Connect-RPC on register.windsurf.com
  await testEndpoint('GetUserStatus', regServer,
    '/exa.seat_management_pb.SeatManagementService/GetUserStatus',
    'GetUserStatus', {
      metadata: buildMeta(),
    }, false);

  // GetProfileData
  await testEndpoint('GetProfileData', regServer,
    '/exa.seat_management_pb.SeatManagementService/GetProfileData',
    'GetProfileData', {
      apiKey,
    }, false);

  // GetCurrentUser (uses auth_token, not metadata)
  await testEndpoint('GetCurrentUser', regServer,
    '/exa.seat_management_pb.SeatManagementService/GetCurrentUser',
    'GetCurrentUser', {
      authToken: apiKey,
      generateProfilePictureUrl: true,
    }, false);
  await sleep(1500);

  // ===== #4: GetCompletions (proper format) =====
  console.log('\n━━━ #4: GetCompletions (code autocomplete) ━━━');
  
  await testEndpoint('GetCompletions', apiServer,
    '/exa.api_server_pb.ApiServerService/GetCompletions',
    'GetCompletions', {
      metadata: buildMeta(),
      request: {
        configuration: {
          numCompletions: 1,
          maxTokens: 50,
          temperature: 0.2,
        },
        prompt: 'function fibonacci(n) {\n  if (n <= 1) return n;\n  return ',
        editorLanguage: 'javascript',
        language: 17, // LANGUAGE_JAVASCRIPT
        model: 339, // MODEL_CHAT_GPT_5_LOW
      },
    }, false);

  // Also try GetStreamingCompletions
  await testEndpoint('GetStreamingCompletions', apiServer,
    '/exa.api_server_pb.ApiServerService/GetStreamingCompletions',
    'GetStreamingCompletions', {
      metadata: buildMeta(),
      request: {
        configuration: {
          numCompletions: 1,
          maxTokens: 50,
          temperature: 0.2,
        },
        prompt: 'def hello():\n    print("Hello',
        editorLanguage: 'python',
        language: 28, // LANGUAGE_PYTHON
      },
    }, true);
  await sleep(1500);

  // ===== #5: GetConfig / GetStatus =====
  console.log('\n━━━ #5: GetConfig / GetStatus ━━━');
  
  await testEndpoint('GetConfig', apiServer,
    '/exa.api_server_pb.ApiServerService/GetConfig',
    'GetConfig', {
      metadata: buildMeta(),
    }, false);

  await testEndpoint('GetStatus', apiServer,
    '/exa.api_server_pb.ApiServerService/GetStatus',
    'GetStatus', {
      metadata: buildMeta(),
    }, false);
  await sleep(1000);

  // ===== #6: GetTranscription (speech-to-text) =====
  console.log('\n━━━ #6: GetTranscription ━━━');
  
  // Send empty audio to see error
  await testEndpoint('empty audio', apiServer,
    '/exa.api_server_pb.ApiServerService/GetTranscription',
    'GetTranscription', {
      metadata: buildMeta(),
      audioData: Buffer.from('RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00'),
    }, false);
  await sleep(1000);

  // ===== #7: CascadePluginsService =====
  console.log('\n━━━ #7: CascadePlugins ━━━');

  // Note: CascadePluginsService may be on a different server
  await testEndpoint('GetAvailableCascadePlugins', apiServer,
    '/exa.cascade_plugins_pb.CascadePluginsService/GetAvailableCascadePlugins',
    'GetAvailableCascadePlugins', {
      metadata: buildMeta(),
    }, false);
  await sleep(1000);

  // ===== #8: UserAnalyticsService =====
  console.log('\n━━━ #8: UserAnalytics ━━━');

  await testEndpoint('Analytics', apiServer,
    '/exa.user_analytics_pb.UserAnalyticsService/Analytics',
    'Analytics', {
      metadata: buildMeta(),
    }, false);
  await sleep(1000);

  // ===== #9: GetCascadeModelConfigs for CLI =====
  console.log('\n━━━ #9: GetCliModelConfigs ━━━');

  await testEndpoint('GetCliModelConfigs', apiServer,
    '/exa.api_server_pb.ApiServerService/GetCliModelConfigs',
    'GetCliModelConfigs', {
      metadata: buildMeta(),
    }, false);
  await sleep(1000);

  // ===== #10: GetCommandModelConfigs =====
  console.log('\n━━━ #10: GetCommandModelConfigs ━━━');

  await testEndpoint('GetCommandModelConfigs', apiServer,
    '/exa.api_server_pb.ApiServerService/GetCommandModelConfigs',
    'GetCommandModelConfigs', {
      metadata: buildMeta(),
    }, false);
  await sleep(1000);

  // ===== #11: ProvideFeedback =====
  console.log('\n━━━ #11: ProvideFeedback ━━━');

  await testEndpoint('ProvideFeedback', apiServer,
    '/exa.api_server_pb.ApiServerService/ProvideFeedback',
    'ProvideFeedback', {
      metadata: buildMeta(),
    }, false);
  await sleep(500);

  // ===== #12: Test all SeatManagement on api server too =====
  console.log('\n━━━ #12: SeatManagement on api server ━━━');

  await testEndpoint('GetUserStatus (api server)', apiServer,
    '/exa.seat_management_pb.SeatManagementService/GetUserStatus',
    'GetUserStatus', {
      metadata: buildMeta(),
    }, false);

  await testEndpoint('GetProfileData (api server)', apiServer,
    '/exa.seat_management_pb.SeatManagementService/GetProfileData',
    'GetProfileData', {
      apiKey,
    }, false);

  console.log('\n══════ Done ══════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
