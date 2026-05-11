#!/usr/bin/env node
/**
 * API Probe — 验证反代理关键问题
 * 
 * 测试 P0 问题:
 *   #1  JWT 有效期 (重复请求检测过期)
 *   #7  tools[] 外部传入是否被接受
 *   #13 Rate limit (连续请求)
 *   #30 异常使用检测
 *   #34 能否禁用内置工具 (tools=[] 空数组)
 *   #37 tool_choice:"none" 是否有效
 * 
 * Usage:
 *   node tools/api-probe.js                       # 使用 .env 中的 CODEIUM_API_KEY
 *   node tools/api-probe.js --api-key KEY         # 指定 key
 *   node tools/api-probe.js --test 1              # 只跑单个测试
 *   node tools/api-probe.js --server URL          # 指定服务器
 */
'use strict';

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const LS_DIR = path.join(__dirname, '..', 'src', 'language-server');
const codec = require(path.join(LS_DIR, 'proto-codec'));

// ==================== Configuration ====================

const DEFAULT_SERVER = 'server.self-serve.windsurf.com';
const API_PATH = '/exa.api_server_pb.ApiServerService/GetChatMessage';
const RATE_LIMIT_PATH = '/exa.api_server_pb.ApiServerService/CheckUserMessageRateLimit';

// ==================== Request Builders (via proto-codec) ====================

function buildChatRequest(apiKey, prompt, options = {}) {
  const {
    model = 'gpt-5-5-low',
    requestType = 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    tools = null,
    toolChoice = null,
    disableParallelToolCalls = false,
    systemPrompt = null,
  } = options;

  const chatMessagePrompts = [];

  if (systemPrompt) {
    chatMessagePrompts.push({
      messageId: crypto.randomUUID(),
      source: 'CHAT_MESSAGE_SOURCE_SYSTEM_PROMPT',
      prompt: systemPrompt,
    });
  }

  chatMessagePrompts.push({
    messageId: crypto.randomUUID(),
    source: 'CHAT_MESSAGE_SOURCE_USER',
    prompt,
  });

  const req = {
    metadata: {
      apiKey,
      ideName: 'windsurf',
      ideVersion: '2.5.0',
      extensionVersion: '2.5.0',
      sessionId: crypto.randomUUID(),
      requestId: Math.floor(Math.random() * 1e9),
      locale: 'en_US',
    },
    chatMessagePrompts,
    chatModelUid: model,
    requestType,
    cascadeId: crypto.randomUUID(),
    promptId: crypto.randomUUID(),
  };

  if (tools !== null) {
    req.tools = tools.map(t => ({
      name: t.name,
      description: t.description || '',
      jsonSchemaString: JSON.stringify(t.parameters || {}),
    }));
  }

  if (toolChoice !== null) {
    req.toolChoice = { optionName: toolChoice };
  }

  if (disableParallelToolCalls) {
    req.disableParallelToolCalls = true;
  }

  return codec.encodeRequest('GetChatMessage', req);
}

function wrapConnectFrame(payload) {
  const header = Buffer.alloc(5);
  header[0] = 0;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

// ==================== HTTP Client ====================

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
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
          contentType: res.headers['content-type'] || '',
        });
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout 30s')));
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
    const payload = buf.subarray(pos, pos + len);
    frames.push({ flags, payload });
    pos += len;
  }
  return frames;
}

function extractChatResponse(buf) {
  const frames = parseStreamFrames(buf);
  let fullText = '';
  let toolCalls = [];
  let stopReason = '';
  let errors = [];

  for (const frame of frames) {
    if (frame.flags === 2) {
      // Trailer frame — JSON error
      const str = frame.payload.toString('utf-8');
      try {
        const trailer = JSON.parse(str);
        if (trailer.error) errors.push(trailer.error.message || JSON.stringify(trailer.error));
        else if (trailer.code) errors.push(`${trailer.code}: ${trailer.message || ''}`);
      } catch (e) {
        if (str.trim()) errors.push(str.substring(0, 150));
      }
      continue;
    }
    // Data frame — decode with proto-codec
    if (frame.payload.length === 0) continue;
    try {
      const dec = codec.decodeResponse('GetChatMessage', frame.payload);
      if (dec.deltaText) fullText += dec.deltaText;
      if (dec.stopReason) stopReason = dec.stopReason;
      if (dec.deltaToolCalls && dec.deltaToolCalls.length > 0) {
        for (const tc of dec.deltaToolCalls) {
          toolCalls.push({
            id: tc.id || '',
            name: tc.name || '',
            arguments: tc.argumentsJson || '',
          });
        }
      }
    } catch (e) {
      // Fallback: show raw
      errors.push(`decode_err: ${e.message}`);
    }
  }

  return { fullText, toolCalls, stopReason, errors, frameCount: frames.length, rawLen: buf.length };
}

// ==================== Tests ====================

const results = {};

async function test1_JwtValidity(apiKey, server) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST #1: JWT 有效性验证');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const body = buildChatRequest(apiKey, 'Say "pong" and nothing else.');
  const res = await connectPost(server, API_PATH, body);
  
  console.log(`  HTTP ${res.status} | Content-Type: ${res.contentType}`);
  
  if (res.status === 200 && res.contentType.includes('connect+proto')) {
    const parsed = extractChatResponse(res.body);
    console.log(`  ✓ API Key 有效! 响应 (${parsed.rawLen}bytes, ${parsed.frameCount} frames)`);
    console.log(`  Text: "${parsed.fullText.substring(0, 80)}"`);
    console.log(`  StopReason: ${parsed.stopReason}`);
    if (parsed.errors.length > 0) console.log(`  Errors: ${parsed.errors.join('; ')}`);
    if (parsed.toolCalls.length > 0) {
      console.log(`  ⚠ 意外 tool_calls: ${JSON.stringify(parsed.toolCalls)}`);
    }
    // Hex dump first 100 bytes for debugging
    console.log(`  Hex[0:100]: ${res.body.subarray(0, 100).toString('hex')}`);
    results['#1_jwt'] = parsed.fullText ? 'VALID_WITH_TEXT' : 'VALID_EMPTY_TEXT';
    return true;
  } else {
    const errText = res.body.toString('utf-8').substring(0, 200);
    console.log(`  ✗ API Key 无效或过期: ${errText}`);
    results['#1_jwt'] = 'INVALID/EXPIRED';
    return false;
  }
}

async function test7_ExternalTools(apiKey, server) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST #7: 外部传入 tools[] 是否被接受');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const customTools = [
    {
      name: 'get_weather',
      description: 'Get weather for a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string', description: 'City name' } },
        required: ['city'],
      },
    },
  ];
  
  const body = buildChatRequest(apiKey, 'What is the weather in Tokyo? Use the get_weather tool.', {
    tools: customTools,
  });
  const res = await connectPost(server, API_PATH, body);
  
  console.log(`  HTTP ${res.status} | Content-Type: ${res.contentType}`);
  
  if (res.status === 200 && res.contentType.includes('connect+proto')) {
    const parsed = extractChatResponse(res.body);
    console.log(`  响应文本: "${parsed.fullText.substring(0, 100)}"`);
    if (parsed.toolCalls.length > 0) {
      console.log(`  ✓ 模型调用了自定义工具!`);
      for (const tc of parsed.toolCalls) {
        console.log(`    tool_call: ${tc.name}(${tc.arguments})`);
      }
      results['#7_tools'] = 'ACCEPTED_AND_CALLED';
    } else {
      console.log(`  △ 请求成功但模型未调用工具 (可能工具被忽略)`);
      results['#7_tools'] = 'ACCEPTED_NOT_CALLED';
    }
  } else {
    const errText = res.body.toString('utf-8').substring(0, 200);
    console.log(`  ✗ 请求被拒绝: ${errText}`);
    results['#7_tools'] = 'REJECTED';
  }
}

async function test34_EmptyTools(apiKey, server) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST #34: tools=[] 空数组 — 禁用内置工具');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const body = buildChatRequest(apiKey, 'List the files in the current directory.', {
    tools: [], // 空数组
  });
  const res = await connectPost(server, API_PATH, body);
  
  console.log(`  HTTP ${res.status} | Content-Type: ${res.contentType}`);
  
  if (res.status === 200 && res.contentType.includes('connect+proto')) {
    const parsed = extractChatResponse(res.body);
    console.log(`  响应文本: "${parsed.fullText.substring(0, 100)}"`);
    if (parsed.toolCalls.length === 0) {
      console.log(`  ✓ 无 tool_call — tools=[] 有效禁用了工具`);
      results['#34_empty_tools'] = 'NO_TOOLS_CALLED';
    } else {
      console.log(`  ✗ 仍有 tool_call — 内置工具无法禁用`);
      for (const tc of parsed.toolCalls) {
        console.log(`    tool_call: ${tc.name}`);
      }
      results['#34_empty_tools'] = 'TOOLS_STILL_CALLED';
    }
  } else {
    const errText = res.body.toString('utf-8').substring(0, 200);
    console.log(`  △ 请求失败: ${errText}`);
    results['#34_empty_tools'] = 'ERROR';
  }
}

async function test37_ToolChoiceNone(apiKey, server) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST #37: tool_choice="none" 强制纯文本');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const body = buildChatRequest(apiKey, 'List the files in /tmp directory. You must use the run_command tool.', {
    toolChoice: 'none',
  });
  const res = await connectPost(server, API_PATH, body);
  
  console.log(`  HTTP ${res.status} | Content-Type: ${res.contentType}`);
  
  if (res.status === 200 && res.contentType.includes('connect+proto')) {
    const parsed = extractChatResponse(res.body);
    console.log(`  响应文本: "${parsed.fullText.substring(0, 100)}"`);
    if (parsed.toolCalls.length === 0) {
      console.log(`  ✓ 无 tool_call — tool_choice=none 有效`);
      results['#37_tool_choice_none'] = 'EFFECTIVE';
    } else {
      console.log(`  ✗ 仍有 tool_call — tool_choice=none 无效`);
      results['#37_tool_choice_none'] = 'INEFFECTIVE';
    }
  } else {
    const errText = res.body.toString('utf-8').substring(0, 200);
    console.log(`  △ 请求失败: ${errText}`);
    results['#37_tool_choice_none'] = 'ERROR';
  }
}

async function test13_RateLimit(apiKey, server) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST #13: Rate Limit (5 连续请求)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const successes = [];
  for (let i = 0; i < 5; i++) {
    const body = buildChatRequest(apiKey, `Say "${i}" and nothing else.`);
    const start = Date.now();
    const res = await connectPost(server, API_PATH, body);
    const ms = Date.now() - start;
    
    if (res.status === 200 && res.contentType.includes('connect+proto')) {
      const parsed = extractChatResponse(res.body);
      console.log(`  [${i+1}/5] ✓ ${ms}ms "${parsed.fullText.substring(0, 20)}"`);
      successes.push({ ms, text: parsed.fullText.substring(0, 20) });
    } else {
      const errText = res.body.toString('utf-8').substring(0, 100);
      console.log(`  [${i+1}/5] ✗ HTTP ${res.status} ${ms}ms: ${errText}`);
      successes.push({ ms, error: res.status });
    }
    // Small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }
  
  const errors = successes.filter(s => s.error);
  if (errors.length === 0) {
    console.log(`  ✓ 5/5 成功 — 无明显 rate limit`);
    results['#13_rate_limit'] = 'NO_LIMIT_IN_5';
  } else {
    console.log(`  △ ${errors.length}/5 失败 — 可能有 rate limit`);
    results['#13_rate_limit'] = `${errors.length}/5_FAILED`;
  }
}

async function test12_RequestType(apiKey, server) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST #12: requestType 差异 (CASCADE vs CHAT)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const prompt = 'Say "hello" and nothing else.';
  
  // requestType = 5 (CASCADE)
  const body5 = buildChatRequest(apiKey, prompt, { requestType: 5 });
  const res5 = await connectPost(server, API_PATH, body5);
  
  // requestType = 1 (CHAT)
  const body1 = buildChatRequest(apiKey, prompt, { requestType: 1 });
  const res1 = await connectPost(server, API_PATH, body1);
  
  console.log(`  CASCADE (5): HTTP ${res5.status}`);
  console.log(`  CHAT    (1): HTTP ${res1.status}`);
  
  if (res5.status === 200) {
    const p5 = extractChatResponse(res5.body);
    console.log(`    CASCADE 响应: "${p5.fullText.substring(0, 50)}" (tools: ${p5.toolCalls.length})`);
  }
  if (res1.status === 200) {
    const p1 = extractChatResponse(res1.body);
    console.log(`    CHAT 响应: "${p1.fullText.substring(0, 50)}" (tools: ${p1.toolCalls.length})`);
  } else {
    console.log(`    CHAT 失败: ${res1.body.toString('utf-8').substring(0, 100)}`);
  }
  
  results['#12_request_type'] = `CASCADE=${res5.status} CHAT=${res1.status}`;
}

async function test_SystemPrompt(apiKey, server) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST #9: System Prompt 注入');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const body = buildChatRequest(apiKey, 'What is your name?', {
    systemPrompt: 'You are a pirate named Captain Blackbeard. Always speak like a pirate.',
  });
  const res = await connectPost(server, API_PATH, body);
  
  console.log(`  HTTP ${res.status}`);
  
  if (res.status === 200 && res.contentType.includes('connect+proto')) {
    const parsed = extractChatResponse(res.body);
    console.log(`  响应: "${parsed.fullText.substring(0, 150)}"`);
    const isPirate = parsed.fullText.toLowerCase().includes('arr') || 
                     parsed.fullText.toLowerCase().includes('pirate') ||
                     parsed.fullText.toLowerCase().includes('blackbeard') ||
                     parsed.fullText.toLowerCase().includes('captain') ||
                     parsed.fullText.toLowerCase().includes('matey');
    if (isPirate) {
      console.log(`  ✓ System prompt 生效 (检测到海盗风格)`);
      results['#9_system_prompt'] = 'EFFECTIVE';
    } else {
      console.log(`  △ System prompt 可能未生效 (未检测到海盗风格)`);
      results['#9_system_prompt'] = 'UNCERTAIN';
    }
  } else {
    results['#9_system_prompt'] = 'ERROR';
  }
}

async function test_CheckRateLimit(apiKey, server) {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  TEST #14: CheckUserMessageRateLimit 响应结构');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const body = codec.encodeRequest('CheckUserMessageRateLimit', {
    metadata: {
      apiKey,
      ideName: 'windsurf',
      ideVersion: '2.5.0',
      extensionVersion: '2.5.0',
      sessionId: crypto.randomUUID(),
      requestId: 1,
    },
  });
  
  const res = await connectPost(server, RATE_LIMIT_PATH, body);
  
  console.log(`  HTTP ${res.status} | Content-Type: ${res.contentType}`);
  
  if (res.status === 200) {
    const frames = parseStreamFrames(res.body);
    for (const f of frames) {
      if (f.flags === 0 && f.payload.length > 0) {
        try {
          const dec = codec.decodeResponse('CheckUserMessageRateLimit', f.payload);
          console.log(`  ✓ 响应: ${JSON.stringify(dec, null, 2).substring(0, 300)}`);
        } catch (e) {
          console.log(`  Decode err: ${e.message}`);
          console.log(`  Hex: ${f.payload.subarray(0, 50).toString('hex')}`);
        }
      } else if (f.flags === 2) {
        console.log(`  Trailer: ${f.payload.toString('utf-8').substring(0, 100)}`);
      }
    }
    results['#14_rate_limit_api'] = 'OK';
  } else {
    console.log(`  ${res.body.toString('utf-8').substring(0, 150)}`);
    results['#14_rate_limit_api'] = `HTTP_${res.status}`;
  }
}

// ==================== Main ====================

function resolveApiKey() {
  const idx = process.argv.indexOf('--api-key');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  
  // Try .env file
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^CODEIUM_API_KEY=(.+)/);
      if (m) return m[1].trim();
    }
  }
  
  if (process.env.CODEIUM_API_KEY) return process.env.CODEIUM_API_KEY;
  return null;
}

function resolveServer() {
  const idx = process.argv.indexOf('--server');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  
  // Try .env for server
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

function resolveTestFilter() {
  const idx = process.argv.indexOf('--test');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1].split(',');
  return null;
}

async function main() {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    console.error('ERROR: No API key found.');
    console.error('  Set CODEIUM_API_KEY in .env or pass --api-key KEY');
    console.error('  Run: node tools/auth1-login.js --batch accounts.txt --save');
    process.exit(1);
  }
  
  const server = resolveServer();
  const filter = resolveTestFilter();
  
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Windsurf API Probe — 反代理可行性验证           ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  Server:  ${server}`);
  console.log(`  API Key: ${apiKey.substring(0, 20)}...${apiKey.slice(-4)}`);
  console.log(`  Filter:  ${filter ? filter.join(',') : 'ALL'}`);

  const tests = [
    ['1',  test1_JwtValidity],
    ['34', test34_EmptyTools],
    ['37', test37_ToolChoiceNone],
    ['7',  test7_ExternalTools],
    ['9',  test_SystemPrompt],
    ['12', test12_RequestType],
    ['14', test_CheckRateLimit],
    ['13', test13_RateLimit],
  ];

  for (const [id, fn] of tests) {
    if (filter && !filter.includes(id)) continue;
    try {
      await fn(apiKey, server);
    } catch (err) {
      console.log(`  ✗ 异常: ${err.message}`);
      results[`#${id}`] = `EXCEPTION: ${err.message}`;
    }
  }

  // Summary
  console.log('\n\n╔══════════════════════════════════════════════════╗');
  console.log('║   RESULTS SUMMARY                                 ║');
  console.log('╠══════════════════════════════════════════════════╣');
  for (const [k, v] of Object.entries(results)) {
    const status = v.includes('✓') || v === 'VALID' || v === 'EFFECTIVE' || v.includes('NO_LIMIT') || v.includes('ACCEPTED') || v === 'OK'
      ? '✓' : v.includes('ERROR') || v.includes('INVALID') || v.includes('REJECTED') ? '✗' : '△';
    console.log(`║  ${status} ${k.padEnd(25)} ${v.padEnd(22)} ║`);
  }
  console.log('╚══════════════════════════════════════════════════╝');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
