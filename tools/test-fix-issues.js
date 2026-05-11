#!/usr/bin/env node
/**
 * Fix & re-test:
 * 1. Model UIDs — use correct UIDs from model list
 * 2. Image encoding — debug proto-codec image handling
 * 3. Rate limit — understand 30 msg cap
 */
'use strict';

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const LS_DIR = path.join(__dirname, '..', 'src', 'language-server');
const codec = require(path.join(LS_DIR, 'proto-codec'));

const DEFAULT_SERVER = 'server.self-serve.windsurf.com';

function resolveApiKey() {
  const envPath = path.join(__dirname, '..', '.env');
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^CODEIUM_API_KEY=(.+)/);
    if (m) return m[1].trim();
  }
  return process.env.CODEIUM_API_KEY;
}

function resolveServer() {
  const envPath = path.join(__dirname, '..', '.env');
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const m = line.match(/^CODEIUM_API_SERVER=https?:\/\/(.+)/);
    if (m) return m[1].trim();
  }
  return DEFAULT_SERVER;
}

function wrapFrame(payload) {
  const h = Buffer.alloc(5);
  h.writeUInt32BE(payload.length, 1);
  return Buffer.concat([h, payload]);
}

function connectStream(server, urlPath, body, timeout = 30000) {
  const framed = wrapFrame(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: server, port: 443, path: urlPath, method: 'POST',
      headers: {
        'Content-Type': 'application/connect+proto',
        'Connect-Protocol-Version': '1',
        'Content-Length': framed.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('Timeout')));
    req.write(framed);
    req.end();
  });
}

function connectUnary(server, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: server, port: 443, path: urlPath, method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    req.write(body);
    req.end();
  });
}

function extractChat(buf) {
  let text = '', usage = null, stopReason = '', errors = [], actualModel = '';
  let pos = 0;
  while (pos + 5 <= buf.length) {
    const f = buf[pos];
    const l = buf.readUInt32BE(pos + 1);
    pos += 5;
    if (pos + l > buf.length) break;
    const payload = buf.subarray(pos, pos + l);
    if (f === 2) {
      const s = payload.toString('utf-8');
      if (s.trim() && s.trim() !== '{}') errors.push(s.substring(0, 300));
    } else if (f === 0 && payload.length > 0) {
      try {
        const dec = codec.decodeResponse('GetChatMessage', payload);
        if (dec.deltaText) text += dec.deltaText;
        if (dec.stopReason) stopReason = dec.stopReason;
        if (dec.usage && dec.usage.inputTokens) usage = dec.usage;
        if (dec.actualModelUid) actualModel = dec.actualModelUid;
      } catch (e) {}
    }
    pos += l;
  }
  return { text, usage, stopReason, errors, actualModel };
}

function buildMeta(apiKey) {
  return {
    apiKey, ideName: 'windsurf', ideVersion: '2.5.0',
    extensionVersion: '2.5.0', sessionId: crypto.randomUUID(),
    requestId: Math.floor(Math.random() * 1e9), locale: 'en_US',
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendChat(apiKey, server, prompt, model) {
  const req = {
    metadata: buildMeta(apiKey),
    chatMessagePrompts: [{
      messageId: crypto.randomUUID(),
      source: 'CHAT_MESSAGE_SOURCE_USER',
      prompt,
    }],
    chatModelUid: model,
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId: crypto.randomUUID(),
    promptId: crypto.randomUUID(),
    toolChoice: { optionName: 'none' },
  };
  const body = codec.encodeRequest('GetChatMessage', req);
  const res = await connectStream(server, '/exa.api_server_pb.ApiServerService/GetChatMessage', body);
  return extractChat(res.body);
}

async function main() {
  const apiKey = resolveApiKey();
  const server = resolveServer();
  if (!apiKey) { console.error('No API key'); process.exit(1); }

  console.log('=== FIX #1: 模型 UID 修正测试 ===\n');
  
  // First, get actual model UIDs from API
  const configReq = { metadata: buildMeta(apiKey) };
  const configBody = codec.encodeRequest('GetCascadeModelConfigs', configReq);
  const configRes = await connectUnary(server,
    '/exa.api_server_pb.ApiServerService/GetCascadeModelConfigs', configBody);
  
  let allModels = [];
  try {
    const dec = codec.decodeResponse('GetCascadeModelConfigs', configRes.body);
    allModels = dec.clientModelConfigs || [];
    
    // Find Claude, Gemini, O3 models
    const targets = ['claude', 'gemini', 'o3', 'o4'];
    console.log('Available non-GPT models:');
    for (const m of allModels) {
      const uid = m.modelUid || '';
      const label = m.label || '';
      const combined = (uid + label).toLowerCase();
      if (targets.some(t => combined.includes(t)) && !m.disabled) {
        console.log(`  uid="${uid}" label="${label}" img=${m.supportsImages} credits=${m.creditMultiplier}`);
      }
    }
  } catch (e) {
    console.log('Error getting model configs:', e.message);
  }

  // Test with CORRECT UIDs
  const testModels = [
    'gpt-5-5-low',
    'claude-sonnet-4-6',
    'claude-sonnet-4-6-thinking',
    'claude-opus-4-6',
    'MODEL_GOOGLE_GEMINI_2_5_PRO',
    'MODEL_CHAT_O3',
    'gemini-3-1-pro-low',
    'kimi-k2-5',
    'deepseek-v4',
  ];

  console.log('\nModel chat tests:');
  for (const model of testModels) {
    try {
      const r = await sendChat(apiKey, server, 'Say your model name in 5 words max.', model);
      const snippet = r.text.substring(0, 80).replace(/\n/g, ' ');
      const err = r.errors.length ? r.errors[0].substring(0, 80) : '';
      console.log(`  [${model}]: "${snippet}" actual=${r.actualModel || '?'} ${err ? '⚠ ' + err : ''}`);
      if (r.usage) {
        console.log(`    provider=${r.usage.apiProvider || '?'} in=${r.usage.inputTokens} out=${r.usage.outputTokens}`);
      }
    } catch (e) {
      console.log(`  [${model}]: ERROR ${e.message}`);
    }
    await sleep(1500);
  }

  console.log('\n=== FIX #2: 图片编码诊断 ===\n');
  
  // Check how proto-codec encodes images field
  // Create a minimal valid 1x1 PNG
  const PNG_1x1_RED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  
  // Method 1: images in ChatMessagePrompt
  console.log('Method 1: images in ChatMessagePrompt');
  {
    const req = {
      metadata: buildMeta(apiKey),
      chatMessagePrompts: [{
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: 'Describe this image.',
        images: [{ base64Data: PNG_1x1_RED, mimeType: 'image/png' }],
      }],
      chatModelUid: 'gpt-5-5-low',
      requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
      cascadeId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
    };
    
    // Encode and inspect the binary
    const body = codec.encodeRequest('GetChatMessage', req);
    console.log(`  Encoded size: ${body.length} bytes`);
    
    // Check if base64Data is actually in the encoded buffer
    const b64Needle = Buffer.from('iVBORw0KGgo');
    const found = body.indexOf(b64Needle);
    console.log(`  base64Data present in encoded payload: ${found >= 0 ? 'YES at ' + found : 'NO!'}`);
    
    // Try decode to verify round-trip
    try {
      const decoded = codec.decodeRequest('GetChatMessage', body);
      const msg0 = decoded.chatMessagePrompts && decoded.chatMessagePrompts[0];
      console.log(`  Round-trip images field: ${msg0 && msg0.images ? JSON.stringify(msg0.images).substring(0, 100) : 'MISSING'}`);
    } catch (e) {
      console.log(`  Round-trip decode error: ${e.message}`);
    }
    
    // Send to API
    const res = await connectStream(server, '/exa.api_server_pb.ApiServerService/GetChatMessage', body);
    const r = extractChat(res.body);
    console.log(`  Response: text="${r.text.substring(0, 100)}" err=${r.errors[0] || 'none'}`);
  }
  await sleep(1500);

  // Method 2: Try without prompt text (only image)
  console.log('\nMethod 2: image only, no text prompt');
  {
    const req = {
      metadata: buildMeta(apiKey),
      chatMessagePrompts: [{
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: '',
        images: [{ base64Data: PNG_1x1_RED, mimeType: 'image/png' }],
      }],
      chatModelUid: 'gpt-5-5-low',
      requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
      cascadeId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
    };
    const body = codec.encodeRequest('GetChatMessage', req);
    const res = await connectStream(server, '/exa.api_server_pb.ApiServerService/GetChatMessage', body);
    const r = extractChat(res.body);
    console.log(`  Response: text="${r.text.substring(0, 100)}" err=${r.errors[0] || 'none'}`);
  }
  await sleep(1500);

  // Method 3: Try with GPT-4o which is known for vision
  console.log('\nMethod 3: image + gpt-4o model');
  {
    const req = {
      metadata: buildMeta(apiKey),
      chatMessagePrompts: [{
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: 'What is in this image?',
        images: [{ base64Data: PNG_1x1_RED, mimeType: 'image/png' }],
      }],
      chatModelUid: 'MODEL_CHAT_GPT_4O_2024_08_06',
      requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
      cascadeId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
    };
    const body = codec.encodeRequest('GetChatMessage', req);
    const res = await connectStream(server, '/exa.api_server_pb.ApiServerService/GetChatMessage', body);
    const r = extractChat(res.body);
    console.log(`  Response: text="${r.text.substring(0, 100)}" err=${r.errors[0] || 'none'}`);
  }
  await sleep(1500);

  // Method 4: Try with a bigger real image
  console.log('\nMethod 4: larger test image (100x100 gradient)');
  {
    // Create a larger valid PNG-like base64 (just use repeated data)
    // Actually, let's use a proper small PNG with more pixels
    const req = {
      metadata: buildMeta(apiKey),
      chatMessagePrompts: [{
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: 'What color is this image? Answer in one word.',
        images: [{ 
          base64Data: PNG_1x1_RED, 
          mimeType: 'image/png',
          caption: 'A red pixel image',
        }],
      }],
      chatModelUid: 'gpt-5-4-low',
      requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
      cascadeId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
    };
    const body = codec.encodeRequest('GetChatMessage', req);
    const res = await connectStream(server, '/exa.api_server_pb.ApiServerService/GetChatMessage', body);
    const r = extractChat(res.body);
    console.log(`  Response: text="${r.text.substring(0, 100)}" err=${r.errors[0] || 'none'}`);
  }
  await sleep(1500);

  console.log('\n=== FIX #3: Rate Limit 详细分析 ===\n');
  
  // Check rate limit details
  const rlModels = ['gpt-5-5-low', 'claude-sonnet-4-6', 'gpt-5-4-low'];
  for (const model of rlModels) {
    try {
      const req = { metadata: buildMeta(apiKey), modelUid: model };
      const body = codec.encodeRequest('CheckUserMessageRateLimit', req);
      const res = await connectUnary(server,
        '/exa.api_server_pb.ApiServerService/CheckUserMessageRateLimit', body);
      if (res.status === 200) {
        try {
          const dec = codec.decodeResponse('CheckUserMessageRateLimit', res.body);
          console.log(`  [${model}]: ${JSON.stringify(dec)}`);
        } catch (e) {
          console.log(`  [${model}]: decode error: ${e.message}`);
        }
      }
    } catch (e) {
      console.log(`  [${model}]: ${e.message}`);
    }
  }

  // Check CheckChatCapacity
  console.log('\n  CheckChatCapacity:');
  try {
    const req = { metadata: buildMeta(apiKey) };
    const body = codec.encodeRequest('CheckChatCapacity', req);
    if (body.length > 0) {
      const res = await connectUnary(server,
        '/exa.api_server_pb.ApiServerService/CheckChatCapacity', body);
      console.log(`  Status: ${res.status}`);
      if (res.status === 200) {
        try {
          const dec = codec.decodeResponse('CheckChatCapacity', res.body);
          console.log(`  Response: ${JSON.stringify(dec)}`);
        } catch (e) {
          console.log(`  Raw: ${res.body.toString('utf-8').substring(0, 200)}`);
        }
      }
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  // Check GetUserStatus on the correct server (register.windsurf.com)
  console.log('\n  GetUserStatus (register.windsurf.com):');
  try {
    const req = { metadata: buildMeta(apiKey) };
    const body = codec.encodeRequest('GetUserStatus', req);
    const res = await connectUnary('register.windsurf.com',
      '/exa.seat_management_pb.SeatManagementService/GetUserStatus', body);
    console.log(`  Status: ${res.status}`);
    if (res.status === 200) {
      try {
        const dec = codec.decodeResponse('GetUserStatus', res.body);
        console.log(`  Response: ${JSON.stringify(dec).substring(0, 400)}`);
      } catch (e) {
        console.log(`  Raw: ${res.body.toString('utf-8').substring(0, 300)}`);
      }
    } else {
      console.log(`  Error: ${res.body.toString('utf-8').substring(0, 200)}`);
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }

  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
