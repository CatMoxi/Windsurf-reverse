#!/usr/bin/env node
/**
 * Deep dive into promising endpoints:
 * 1. GetUserStatus — full account info
 * 2. GetDevstralStream — tool calls, capabilities
 * 3. CascadePlugins — full plugin list
 * 4. GetCliModelConfigs — CLI model differences
 * 5. SeatManagement on register.windsurf.com with correct path
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
    req.setTimeout(15000, () => req.destroy(new Error('Timeout')));
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

function parseFrames(buf) {
  const frames = [];
  let pos = 0;
  while (pos + 5 <= buf.length) {
    const f = buf[pos]; const l = buf.readUInt32BE(pos + 1);
    pos += 5;
    if (pos + l > buf.length) break;
    frames.push({ flags: f, payload: buf.subarray(pos, pos + l) });
    pos += l;
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

async function main() {
  // ===== 1. GetUserStatus — full account info =====
  console.log('━━━ 1. GetUserStatus (full account info) ━━━\n');
  {
    const body = codec.encodeRequest('GetUserStatus', { metadata: buildMeta() });
    const res = await connectUnary(apiServer,
      '/exa.seat_management_pb.SeatManagementService/GetUserStatus', body);
    if (res.status === 200) {
      const dec = codec.decodeResponse('GetUserStatus', res.body);
      console.log('userStatus:');
      const us = dec.userStatus || {};
      for (const [k, v] of Object.entries(us)) {
        if (typeof v === 'object' && v !== null) {
          console.log(`  ${k}: ${JSON.stringify(v).substring(0, 200)}`);
        } else {
          console.log(`  ${k}: ${v}`);
        }
      }
      console.log('\nplanInfo:');
      const pi = dec.planInfo || {};
      for (const [k, v] of Object.entries(pi)) {
        console.log(`  ${k}: ${JSON.stringify(v).substring(0, 200)}`);
      }
    } else {
      console.log('Error:', res.body.toString('utf-8').substring(0, 200));
    }
  }
  await sleep(1500);

  // ===== 2. GetDevstralStream — deeper test =====
  console.log('\n━━━ 2. GetDevstralStream deep test ━━━\n');
  
  // Test with tool call
  {
    const tools = [{
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather for a location',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string', description: 'City name' } },
          required: ['city'],
        },
      },
    }];
    
    const body = codec.encodeRequest('GetDevstralStream', {
      metadata: buildMeta(),
      chatMessagePrompts: [{
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: 'What is the weather in Tokyo?',
      }],
      toolsJson: JSON.stringify(tools),
    });
    
    const res = await connectStream(apiServer,
      '/exa.api_server_pb.ApiServerService/GetDevstralStream', body);
    
    const frames = parseFrames(res.body);
    let text = '', toolCalls = [];
    for (const f of frames) {
      if (f.flags === 0 && f.payload.length > 0) {
        try {
          const d = codec.decodeResponse('GetDevstralStream', f.payload);
          if (d.output) text += d.output;
          if (d.toolCalls && d.toolCalls.length > 0) {
            toolCalls.push(...d.toolCalls);
          }
        } catch (e) {}
      } else if (f.flags === 2) {
        const s = f.payload.toString('utf-8');
        if (s.trim() && s.trim() !== '{}') console.log('  trailer:', s.substring(0, 200));
      }
    }
    console.log(`  text: "${text.substring(0, 150)}"`);
    console.log(`  toolCalls: ${toolCalls.length}`);
    for (const tc of toolCalls) {
      console.log(`    ${JSON.stringify(tc).substring(0, 200)}`);
    }
  }
  await sleep(2000);

  // Devstral multi-turn
  console.log('\n  Multi-turn:');
  {
    const body = codec.encodeRequest('GetDevstralStream', {
      metadata: buildMeta(),
      chatMessagePrompts: [
        { messageId: crypto.randomUUID(), source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'My name is Alice' },
        { messageId: crypto.randomUUID(), source: 'CHAT_MESSAGE_SOURCE_ASSISTANT', prompt: 'Nice to meet you Alice!' },
        { messageId: crypto.randomUUID(), source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'What is my name?' },
      ],
    });
    const res = await connectStream(apiServer,
      '/exa.api_server_pb.ApiServerService/GetDevstralStream', body);
    const frames = parseFrames(res.body);
    let text = '';
    for (const f of frames) {
      if (f.flags === 0 && f.payload.length > 0) {
        try { const d = codec.decodeResponse('GetDevstralStream', f.payload); if (d.output) text += d.output; } catch (e) {}
      }
    }
    console.log(`  text: "${text.substring(0, 150)}"`);
  }
  await sleep(2000);

  // ===== 3. CascadePlugins full list =====
  console.log('\n━━━ 3. CascadePlugins full list ━━━\n');
  {
    const body = codec.encodeRequest('GetAvailableCascadePlugins', { metadata: buildMeta() });
    const res = await connectUnary(apiServer,
      '/exa.cascade_plugins_pb.CascadePluginsService/GetAvailableCascadePlugins', body);
    if (res.status === 200) {
      const dec = codec.decodeResponse('GetAvailableCascadePlugins', res.body);
      const plugins = dec.plugins || [];
      console.log(`  Total plugins: ${plugins.length}\n`);
      for (const p of plugins) {
        console.log(`  [${p.id}] "${p.title}" — ${(p.description || '').substring(0, 80)}`);
      }
    }
  }
  await sleep(1000);

  // ===== 4. CLI vs Cascade vs Command model configs comparison =====
  console.log('\n━━━ 4. CLI vs Cascade vs Command Model Configs ━━━\n');
  {
    const methods = ['GetCascadeModelConfigs', 'GetCliModelConfigs', 'GetCommandModelConfigs'];
    for (const m of methods) {
      const body = codec.encodeRequest(m, { metadata: buildMeta() });
      const res = await connectUnary(apiServer,
        `/exa.api_server_pb.ApiServerService/${m}`, body);
      if (res.status === 200) {
        const dec = codec.decodeResponse(m, res.body);
        const configs = dec.clientModelConfigs || [];
        const uids = configs.map(c => c.modelUid).filter(Boolean);
        console.log(`  ${m}: ${configs.length} models`);
        console.log(`    UIDs: ${uids.slice(0, 10).join(', ')}${uids.length > 10 ? '...' : ''}`);
      }
    }
  }
  await sleep(1000);

  // ===== 5. Try SeatManagement on register.windsurf.com with Devin headers =====
  console.log('\n━━━ 5. SeatManagement with Devin headers ━━━\n');
  {
    // The register.windsurf.com may need custom headers like X-Devin-*
    const body = codec.encodeRequest('GetUserStatus', { metadata: buildMeta() });
    
    const req = https.request({
      hostname: 'register.windsurf.com', port: 443,
      path: '/exa.seat_management_pb.SeatManagementService/GetUserStatus',
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'Content-Length': body.length,
        'x-devin-api-key': apiKey,
        'x-devin-client-id': crypto.randomUUID(),
      },
    }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        console.log(`  Status: ${res.status}`);
        if (res.status === 200) {
          try {
            const dec = codec.decodeResponse('GetUserStatus', Buffer.concat(c));
            console.log(`  Response: ${JSON.stringify(dec).substring(0, 300)}`);
          } catch (e) {
            console.log(`  Decode: ${e.message}`);
          }
        } else {
          console.log(`  Error: ${Buffer.concat(c).toString('utf-8').substring(0, 200)}`);
        }
      });
    });
    req.write(body);
    req.end();
    await sleep(3000);
  }

  // ===== 6. GetDefaultWorkflowTemplates =====
  console.log('\n━━━ 6. GetDefaultWorkflowTemplates ━━━\n');
  {
    const body = codec.encodeRequest('GetDefaultWorkflowTemplates', { metadata: buildMeta() });
    if (body.length > 0) {
      const res = await connectUnary(apiServer,
        '/exa.api_server_pb.ApiServerService/GetDefaultWorkflowTemplates', body);
      if (res.status === 200) {
        try {
          const dec = codec.decodeResponse('GetDefaultWorkflowTemplates', res.body);
          console.log(`  Response: ${JSON.stringify(dec).substring(0, 500)}`);
        } catch (e) {
          console.log(`  Decode: ${e.message} | ${res.body.length}B`);
        }
      } else {
        console.log(`  Error: ${res.body.toString('utf-8').substring(0, 200)}`);
      }
    } else {
      console.log('  Method not registered');
    }
  }

  console.log('\n══════ Done ══════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
