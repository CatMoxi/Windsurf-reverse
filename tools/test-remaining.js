#!/usr/bin/env node
/**
 * Comprehensive remaining tests:
 * #1: API Key validity / expiration
 * #2: GetChatCompletions endpoint  
 * #3: Image/multimodal input
 * #4: Embeddings endpoint
 * #5: Model switching (claude/gemini)
 * #6: Non-streaming response
 * #7: Account quota/limits
 * #8: Error code catalog
 * #9: Long conversation truncation
 */
'use strict';

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const LS_DIR = path.join(__dirname, '..', 'src', 'language-server');
const codec = require(path.join(LS_DIR, 'proto-codec'));

const DEFAULT_SERVER = 'server.self-serve.windsurf.com';

function wrapConnectFrame(payload) {
  const header = Buffer.alloc(5);
  header[0] = 0;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

function connectPost(server, urlPath, body, timeout = 30000) {
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
        'User-Agent': 'connect-es/2.0.0-rc.3',
        'Content-Length': framedBody.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => req.destroy(new Error('Timeout')));
    req.write(framedBody);
    req.end();
  });
}

function connectPostUnary(server, urlPath, body) {
  const framedBody = wrapConnectFrame(body);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: server,
      port: 443,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'User-Agent': 'connect-es/2.0.0-rc.3',
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    req.write(body);
    req.end();
  });
}

function extractText(buf) {
  let text = '', usage = null, stopReason = '', errors = [];
  let pos = 0;
  while (pos + 5 <= buf.length) {
    const flags = buf[pos];
    const len = buf.readUInt32BE(pos + 1);
    pos += 5;
    if (pos + len > buf.length) break;
    const payload = buf.subarray(pos, pos + len);
    if (flags === 2) {
      const s = payload.toString('utf-8');
      if (s.trim() && s.trim() !== '{}') errors.push(s.substring(0, 300));
    } else if (payload.length > 0) {
      try {
        const dec = codec.decodeResponse('GetChatMessage', payload);
        if (dec.deltaText) text += dec.deltaText;
        if (dec.stopReason) stopReason = dec.stopReason;
        if (dec.usage && dec.usage.inputTokens) usage = dec.usage;
      } catch (e) {}
    }
    pos += len;
  }
  return { text, usage, stopReason, errors };
}

function buildMeta(apiKey) {
  return {
    apiKey,
    ideName: 'windsurf',
    ideVersion: '2.5.0',
    extensionVersion: '2.5.0',
    sessionId: crypto.randomUUID(),
    requestId: Math.floor(Math.random() * 1e9),
    locale: 'en_US',
  };
}

function buildChatReq(apiKey, userPrompt, opts = {}) {
  return {
    metadata: buildMeta(apiKey),
    prompt: opts.systemPrompt || '',
    chatMessagePrompts: [
      { messageId: crypto.randomUUID(), source: 'CHAT_MESSAGE_SOURCE_USER', prompt: userPrompt },
    ],
    chatModelUid: opts.model || 'gpt-5-5-low',
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId: crypto.randomUUID(),
    promptId: crypto.randomUUID(),
    tools: opts.tools || [],
    toolChoice: { optionName: opts.toolChoice || 'none' },
  };
}

function resolveApiKey() {
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

async function sendChat(apiKey, server, userPrompt, opts = {}) {
  const req = buildChatReq(apiKey, userPrompt, opts);
  const body = codec.encodeRequest('GetChatMessage', req);
  const res = await connectPost(server, '/exa.api_server_pb.ApiServerService/GetChatMessage', body, opts.timeout || 30000);
  return extractText(res.body);
}

// ==================== TESTS ====================

async function main() {
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No API key'); process.exit(1); }
  const server = resolveServer();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Comprehensive Remaining Tests                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Server: ${server}\n`);

  const results = {};

  // ==================== #1: API Key 有效期 ====================
  console.log('━━━ #1: API Key 有效期/刷新 ━━━');
  {
    // Parse JWT
    const jwtPart = apiKey.split('$')[1];
    const parts = jwtPart ? jwtPart.split('.') : [];
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      console.log(`  JWT payload: ${JSON.stringify(payload)}`);
      console.log(`  Has exp: ${!!payload.exp}`);
      console.log(`  Has iat: ${!!payload.iat}`);
      if (!payload.exp) {
        console.log('  ⚠ JWT 无 exp 字段 — 可能永不过期或由服务端控制');
      }
    }

    // Test with corrupted key
    console.log('\n  Testing invalid keys:');
    const badKeys = [
      { label: 'empty', key: '' },
      { label: 'garbage', key: 'not-a-real-key-12345' },
      { label: 'expired-format', key: 'devin-session-token$eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXNzaW9uX2lkIjoiZmFrZS1zZXNzaW9uLTAwMCJ9.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    ];
    for (const { label, key } of badKeys) {
      try {
        const r = await sendChat(key || 'x', server, 'test');
        console.log(`  [${label}]: text=${r.text.length}ch, errors=${r.errors[0] || 'none'}`);
      } catch (e) {
        console.log(`  [${label}]: ${e.message}`);
      }
      await sleep(500);
    }

    // Test current key still works
    const r = await sendChat(apiKey, server, 'Say OK');
    const ok = r.text.includes('OK') || r.text.length > 0;
    console.log(`  Current key: ${ok ? '✓ valid' : '✗ invalid'}`);
    results['#1 API Key'] = ok ? 'JWT无exp(服务端控制), 当前有效' : 'INVALID';
  }
  await sleep(1500);

  // ==================== #2: GetChatCompletions ====================
  console.log('\n━━━ #2: GetChatCompletions 端点 ━━━');
  {
    // This endpoint has system_prompt field directly
    const req = {
      metadata: buildMeta(apiKey),
      systemPrompt: 'You are a helpful assistant named TestBot.',
      chatMessagePrompts: [
        { messageId: crypto.randomUUID(), source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'Who are you? One sentence.' },
      ],
      completionConfiguration: {},
      requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    };
    try {
      const body = codec.encodeRequest('GetChatCompletions', req);
      const res = await connectPost(server, '/exa.api_server_pb.ApiServerService/GetChatCompletions', body);
      if (res.status === 200) {
        // Try decode
        let text = '';
        try {
          const dec = codec.decodeResponse('GetChatCompletions', res.body);
          text = JSON.stringify(dec).substring(0, 200);
        } catch (e) {
          text = res.body.toString('utf-8').substring(0, 200);
        }
        console.log(`  Status: ${res.status}`);
        console.log(`  Response: ${text}`);
        results['#2 GetChatCompletions'] = 'WORKS';
      } else {
        const errBody = res.body.toString('utf-8').substring(0, 200);
        console.log(`  Status: ${res.status}`);
        console.log(`  Error: ${errBody}`);
        results['#2 GetChatCompletions'] = `HTTP ${res.status}`;
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
      results['#2 GetChatCompletions'] = e.message;
    }

    // Also try GetStreamingExternalChatCompletions
    console.log('\n  GetStreamingExternalChatCompletions:');
    try {
      const body = codec.encodeRequest('GetChatCompletions', {
        metadata: buildMeta(apiKey),
        systemPrompt: 'You are TestBot.',
        chatMessagePrompts: [
          { messageId: crypto.randomUUID(), source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'Say hello' },
        ],
      });
      const res = await connectPost(server, '/exa.api_server_pb.ApiServerService/GetStreamingExternalChatCompletions', body);
      console.log(`  Status: ${res.status}`);
      if (res.status === 200) {
        // Parse streaming frames
        let text = '';
        let pos = 0;
        while (pos + 5 <= res.body.length) {
          const f = res.body[pos];
          const l = res.body.readUInt32BE(pos + 1);
          pos += 5;
          if (pos + l > res.body.length) break;
          const payload = res.body.subarray(pos, pos + l);
          if (f === 0 && payload.length > 0) {
            try {
              const dec = codec.decodeResponse('GetStreamingExternalChatCompletions', payload);
              if (dec.deltaText) text += dec.deltaText;
            } catch (e) {
              // Try raw
              text += payload.toString('utf-8').substring(0, 50);
            }
          }
          pos += l;
        }
        console.log(`  Text: "${text.substring(0, 100)}"`);
      } else {
        console.log(`  Error: ${res.body.toString('utf-8').substring(0, 200)}`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }
  await sleep(1500);

  // ==================== #3: 图片/多模态 ====================
  console.log('\n━━━ #3: 图片/多模态输入 ━━━');
  {
    // Check if chatMessagePrompts supports image content
    // Look at proto: ChatMessagePrompt has 'prompt' (string) and 'images' field?
    const r = await sendChat(apiKey, server, 'Can you process images? What image formats do you support? Answer briefly.');
    console.log(`  Model says: "${r.text.substring(0, 200)}"`);

    // Try sending with image_url style content (check proto for image fields)
    // Let's check proto structure
    const methodInfo = codec.getMethodInfo ? codec.getMethodInfo('GetChatMessage') : null;
    if (methodInfo) {
      const reqType = methodInfo.requestType;
      console.log(`  Request fields: ${reqType ? Object.keys(reqType.fields || {}).join(', ') : 'N/A'}`);
    }
    results['#3 Image/multimodal'] = 'See proto fields above';
  }
  await sleep(1500);

  // ==================== #4: Embeddings ====================
  console.log('\n━━━ #4: Embeddings 端点 ━━━');
  {
    try {
      const req = {
        metadata: buildMeta(apiKey),
        texts: ['Hello world', 'How are you?'],
      };
      const body = codec.encodeRequest('GetEmbeddings', req);
      if (body.length === 0) {
        console.log('  encodeRequest returned empty — method may not be registered');
        results['#4 Embeddings'] = 'Not registered in proto-codec';
      } else {
        const res = await connectPostUnary(server, '/exa.api_server_pb.ApiServerService/GetEmbeddings', body);
        console.log(`  Status: ${res.status}`);
        if (res.status === 200) {
          try {
            const dec = codec.decodeResponse('GetEmbeddings', res.body);
            console.log(`  Response keys: ${Object.keys(dec || {}).join(', ')}`);
            console.log(`  Response: ${JSON.stringify(dec).substring(0, 200)}`);
          } catch (e) {
            console.log(`  Decode error: ${e.message}`);
            console.log(`  Raw: ${res.body.toString('utf-8').substring(0, 100)}`);
          }
          results['#4 Embeddings'] = 'WORKS';
        } else {
          console.log(`  Error: ${res.body.toString('utf-8').substring(0, 200)}`);
          results['#4 Embeddings'] = `HTTP ${res.status}`;
        }
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
      results['#4 Embeddings'] = e.message;
    }
  }
  await sleep(1500);

  // ==================== #5: 模型切换 ====================
  console.log('\n━━━ #5: 模型切换 (claude/gemini) ━━━');
  {
    const models = [
      'gpt-5-5-low',
      'claude-3-5-sonnet-v2',
      'claude-sonnet-4',
      'gemini-2-5-pro',
      'o3',
    ];
    for (const m of models) {
      try {
        const r = await sendChat(apiKey, server, 'Who are you? One word answer.', { model: m });
        console.log(`  [${m}]: "${r.text.substring(0, 80)}" ${r.errors.length ? '⚠ ' + r.errors[0].substring(0, 80) : ''}`);
        if (r.usage) {
          console.log(`    provider: ${r.usage.apiProvider || '?'}, model: ${r.usage.modelUid || '?'}`);
        }
      } catch (e) {
        console.log(`  [${m}]: ERROR ${e.message}`);
      }
      await sleep(1000);
    }
    results['#5 Model switch'] = 'See above';
  }
  await sleep(1500);

  // ==================== #6: 非流式响应 ====================
  console.log('\n━━━ #6: 非流式响应 (unary) ━━━');
  {
    // GetChatMessage is stream, try unary endpoint GetChatCompletions
    try {
      const req = buildChatReq(apiKey, 'Say hi', {});
      const body = codec.encodeRequest('GetChatMessage', req);
      // Try with application/proto (unary) instead of connect+proto (stream)
      const res = await connectPostUnary(server, '/exa.api_server_pb.ApiServerService/GetChatMessage', body);
      console.log(`  Unary GetChatMessage status: ${res.status}`);
      if (res.status === 200) {
        try {
          const dec = codec.decodeResponse('GetChatMessage', res.body);
          console.log(`  Response: ${JSON.stringify(dec).substring(0, 200)}`);
        } catch (e) {
          console.log(`  Body: ${res.body.toString('utf-8').substring(0, 100)}`);
        }
        results['#6 Non-streaming'] = 'WORKS (unary)';
      } else {
        console.log(`  Error: ${res.body.toString('utf-8').substring(0, 200)}`);
        results['#6 Non-streaming'] = `HTTP ${res.status}`;
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
      results['#6 Non-streaming'] = e.message;
    }
  }
  await sleep(1500);

  // ==================== #7: 账号额度 ====================
  console.log('\n━━━ #7: 账号额度/限制 ━━━');
  {
    // CheckUserMessageRateLimit
    try {
      const req = {
        metadata: buildMeta(apiKey),
        modelUid: 'gpt-5-5-low',
      };
      const body = codec.encodeRequest('CheckUserMessageRateLimit', req);
      if (body.length > 0) {
        const res = await connectPostUnary(server, '/exa.api_server_pb.ApiServerService/CheckUserMessageRateLimit', body);
        console.log(`  RateLimit status: ${res.status}`);
        if (res.status === 200) {
          try {
            const dec = codec.decodeResponse('CheckUserMessageRateLimit', res.body);
            console.log(`  Response: ${JSON.stringify(dec)}`);
          } catch (e) {
            console.log(`  Raw: ${res.body.toString('utf-8').substring(0, 100)}`);
          }
        } else {
          console.log(`  Error: ${res.body.toString('utf-8').substring(0, 200)}`);
        }
      }
    } catch (e) {
      console.log(`  RateLimit error: ${e.message}`);
    }

    // GetUserStatus
    try {
      const req = { metadata: buildMeta(apiKey) };
      const body = codec.encodeRequest('GetUserStatus', req);
      if (body.length > 0) {
        const res = await connectPostUnary(server, '/exa.api_server_pb.ApiServerService/GetUserStatus', body);
        console.log(`  UserStatus status: ${res.status}`);
        if (res.status === 200) {
          try {
            const dec = codec.decodeResponse('GetUserStatus', res.body);
            console.log(`  Response: ${JSON.stringify(dec).substring(0, 300)}`);
          } catch (e) {}
        }
      }
    } catch (e) {}

    results['#7 Account quota'] = 'See above';
  }
  await sleep(1500);

  // ==================== #8: 错误码分类 ====================
  console.log('\n━━━ #8: 错误码分类 ━━━');
  {
    const errTests = [
      { label: 'Missing model', opts: { model: '' }, prompt: 'test' },
      { label: 'Unknown model', opts: { model: 'nonexistent-model-xyz' }, prompt: 'test' },
      { label: 'Empty prompt', opts: {}, prompt: '' },
      { label: 'Very large prompt (10k chars)', opts: {}, prompt: 'A'.repeat(10000) },
    ];
    for (const t of errTests) {
      try {
        const r = await sendChat(apiKey, server, t.prompt, t.opts);
        console.log(`  [${t.label}]: text=${r.text.length}ch, stop=${r.stopReason}, err=${r.errors[0] || 'none'}`);
      } catch (e) {
        console.log(`  [${t.label}]: EXCEPTION ${e.message}`);
      }
      await sleep(800);
    }
    results['#8 Error codes'] = 'See above';
  }
  await sleep(1500);

  // ==================== #9: 长对话截断 ====================
  console.log('\n━━━ #9: 长对话截断测试 ━━━');
  {
    // Build a conversation with many messages
    const messages = [];
    for (let i = 0; i < 50; i++) {
      messages.push({
        messageId: crypto.randomUUID(),
        source: i % 2 === 0 ? 'CHAT_MESSAGE_SOURCE_USER' : 'CHAT_MESSAGE_SOURCE_SYSTEM',
        prompt: `Message ${i}: ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20)}`,
      });
    }
    messages.push({
      messageId: crypto.randomUUID(),
      source: 'CHAT_MESSAGE_SOURCE_USER',
      prompt: 'How many messages are in our conversation history? Just give a number.',
    });

    const req = {
      metadata: buildMeta(apiKey),
      chatMessagePrompts: messages,
      chatModelUid: 'gpt-5-5-low',
      requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
      cascadeId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
      toolChoice: { optionName: 'none' },
    };

    try {
      const body = codec.encodeRequest('GetChatMessage', req);
      console.log(`  Request size: ${body.length} bytes (${messages.length} messages)`);
      const res = await connectPost(server, '/exa.api_server_pb.ApiServerService/GetChatMessage', body, 60000);
      const p = extractText(res.body);
      console.log(`  Response: "${p.text.substring(0, 150)}"`);
      console.log(`  Errors: ${p.errors[0] || 'none'}`);
      if (p.usage) console.log(`  Usage: in=${p.usage.inputTokens}, out=${p.usage.outputTokens}`);
      results['#9 Long conversation'] = p.text.length > 0 ? `OK (${p.usage?.inputTokens || '?'} tokens)` : `FAILED: ${p.errors[0] || 'empty'}`;
    } catch (e) {
      console.log(`  Error: ${e.message}`);
      results['#9 Long conversation'] = e.message;
    }
  }

  // ==================== SUMMARY ====================
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   SUMMARY                                                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  for (const [k, v] of Object.entries(results)) {
    console.log(`║  ${k}: ${v}`);
  }
  console.log('╚══════════════════════════════════════════════════════════════╝');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
