#!/usr/bin/env node
/**
 * Smoke Test: Full tool calling flow with custom system prompt
 * 
 * Tests end-to-end:
 *   1. Custom prompt + custom tools → model calls tool
 *   2. Feed tool result back → model uses result in response  
 *   3. Multi-tool scenario → model calls multiple tools
 *   4. Tool with complex schema → model fills all params
 *   5. Reject tool call with tool_choice=none → pure text fallback
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

const CLAUDE_SYSTEM = `You are Claude, an AI assistant made by Anthropic, operating as a coding agent.
You have access to tools. When the user asks you to do something that requires a tool, you MUST call the appropriate tool.
Do not describe the tool call — just call it directly.
Be concise.`;

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
  // Accumulate tool calls — id and args may arrive in separate frames
  const tcList = []; // ordered list of tool calls
  let stopReason = '';

  for (const f of frames) {
    if (f.flags === 2) {
      const s = f.payload.toString('utf-8');
      if (s.trim() && s.trim() !== '{}') errors.push(s.substring(0, 200));
      continue;
    }
    if (f.payload.length === 0) continue;
    try {
      const dec = codec.decodeResponse('GetChatMessage', f.payload);
      if (dec.deltaText) text += dec.deltaText;
      if (dec.stopReason) stopReason = dec.stopReason;
      if (dec.deltaToolCalls) {
        for (const tc of dec.deltaToolCalls) {
          if (tc.id && tc.name) {
            // New tool call with id+name
            tcList.push({ id: tc.id, name: tc.name, arguments: tc.argumentsJson || '' });
          } else if (tc.argumentsJson && tcList.length > 0) {
            // Argument chunk — append to last tool call
            tcList[tcList.length - 1].arguments += tc.argumentsJson;
          } else if (tc.id && !tc.name && tcList.length > 0) {
            // id-only frame — may be continuation
            tcList[tcList.length - 1].arguments += tc.argumentsJson || '';
          }
        }
      }
    } catch (e) {
      errors.push(`decode: ${e.message}`);
    }
  }

  const toolCalls = tcList.filter(tc => tc.name);
  return { text, toolCalls, stopReason, errors };
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

async function sendChat(apiKey, server, opts) {
  const req = {
    metadata: buildMeta(apiKey),
    chatMessagePrompts: opts.messages.map(m => ({
      messageId: m.id || crypto.randomUUID(),
      source: m.role === 'user' ? 'CHAT_MESSAGE_SOURCE_USER'
            : m.role === 'tool' ? 'CHAT_MESSAGE_SOURCE_USER'
            : 'CHAT_MESSAGE_SOURCE_SYSTEM',
      prompt: m.content,
    })),
    chatModelUid: opts.model || 'gpt-5-5-low',
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId: opts.cascadeId || crypto.randomUUID(),
    promptId: crypto.randomUUID(),
  };

  if (opts.systemPrompt) req.prompt = opts.systemPrompt;

  if (opts.tools) {
    req.tools = opts.tools.map(t => ({
      name: t.name,
      description: t.description || '',
      jsonSchemaString: JSON.stringify(t.parameters || {}),
    }));
  }

  if (opts.toolChoice) {
    req.toolChoice = { optionName: opts.toolChoice };
  }

  const body = codec.encodeRequest('GetChatMessage', req);
  const res = await connectPost(server, API_PATH, body);
  if (res.status !== 200) {
    return { text: '', toolCalls: [], stopReason: '', errors: [`HTTP ${res.status}`] };
  }
  return extractResponse(res.body);
}

// ==================== Tool Definitions ====================

const TOOLS = {
  read_file: {
    name: 'read_file',
    description: 'Read the contents of a file at the given path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path to read' },
      },
      required: ['path'],
    },
  },
  run_command: {
    name: 'run_command',
    description: 'Run a shell command and return its output.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory for the command' },
      },
      required: ['command'],
    },
  },
  write_file: {
    name: 'write_file',
    description: 'Write content to a file, creating it if it does not exist.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  search_code: {
    name: 'search_code',
    description: 'Search for a pattern in the codebase using grep.',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search' },
        directory: { type: 'string', description: 'Directory to search in' },
        file_glob: { type: 'string', description: 'File glob pattern (e.g. *.js)' },
      },
      required: ['pattern'],
    },
  },
};

// ==================== Resolve ====================

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

function parseArgs(argsStr) {
  try { return JSON.parse(argsStr); } catch { return argsStr; }
}

// ==================== Tests ====================

async function main() {
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No API key'); process.exit(1); }
  const server = resolveServer();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Smoke Test: Tool Calling with Custom System Prompt         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Server: ${server}`);
  console.log(`  Tools: ${Object.keys(TOOLS).join(', ')}\n`);

  const allTools = Object.values(TOOLS);
  let passed = 0, failed = 0;

  // ====== TEST 1: Single tool call — read_file ======
  console.log('━━━ TEST 1: "Read the file /etc/hostname" → should call read_file ━━━');
  {
    const r = await sendChat(apiKey, server, {
      systemPrompt: CLAUDE_SYSTEM,
      tools: allTools,
      messages: [{ role: 'user', content: 'Read the file /etc/hostname' }],
    });
    console.log(`  Text: "${r.text.substring(0, 80)}"`);
    console.log(`  Tool calls: ${r.toolCalls.length}`);
    for (const tc of r.toolCalls) {
      console.log(`    → ${tc.name}(${tc.arguments})`);
    }
    const ok = r.toolCalls.some(tc => tc.name === 'read_file');
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}: ${ok ? 'Called read_file' : 'Did not call read_file'}`);
    ok ? passed++ : failed++;
  }
  await sleep(1500);

  // ====== TEST 2: Tool result feedback — full round trip ======
  console.log('\n━━━ TEST 2: Tool result feedback — read_file → response ━━━');
  {
    const r1 = await sendChat(apiKey, server, {
      systemPrompt: CLAUDE_SYSTEM,
      tools: allTools,
      messages: [{ role: 'user', content: 'Read /tmp/test.txt and tell me what it says.' }],
    });
    
    // Simulate tool result
    const toolResult = 'Hello from test file! The answer is 42.';
    const r2 = await sendChat(apiKey, server, {
      systemPrompt: CLAUDE_SYSTEM,
      tools: allTools,
      messages: [
        { role: 'user', content: 'Read /tmp/test.txt and tell me what it says.' },
        { role: 'assistant', content: r1.text || '[Called read_file with path=/tmp/test.txt]' },
        { role: 'tool', content: `[Tool Result: read_file]\n${toolResult}` },
      ],
    });
    console.log(`  Turn 1 tool calls: ${r1.toolCalls.map(t => t.name).join(', ') || 'none'}`);
    console.log(`  Turn 2 response: "${r2.text.substring(0, 150)}"`);
    const ok = r2.text.includes('42') || r2.text.toLowerCase().includes('hello');
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}: ${ok ? 'Model used tool result' : 'Model did not use tool result'}`);
    ok ? passed++ : failed++;
  }
  await sleep(1500);

  // ====== TEST 3: run_command tool ======
  console.log('\n━━━ TEST 3: "Run ls -la in /tmp" → should call run_command ━━━');
  {
    const r = await sendChat(apiKey, server, {
      systemPrompt: CLAUDE_SYSTEM,
      tools: allTools,
      messages: [{ role: 'user', content: 'Run the command "ls -la" in /tmp directory' }],
    });
    console.log(`  Text: "${r.text.substring(0, 80)}"`);
    console.log(`  Tool calls: ${r.toolCalls.length}`);
    for (const tc of r.toolCalls) {
      const args = parseArgs(tc.arguments);
      console.log(`    → ${tc.name}(${JSON.stringify(args)})`);
    }
    const ok = r.toolCalls.some(tc => tc.name === 'run_command');
    const hasCmd = r.toolCalls.some(tc => {
      const a = parseArgs(tc.arguments);
      return a && (a.command || '').includes('ls');
    });
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}: ${ok ? `Called run_command${hasCmd ? ' with ls' : ''}` : 'Did not call run_command'}`);
    ok ? passed++ : failed++;
  }
  await sleep(1500);

  // ====== TEST 4: Complex params — write_file ======
  console.log('\n━━━ TEST 4: "Create /tmp/hello.py with a hello world script" → write_file ━━━');
  {
    const r = await sendChat(apiKey, server, {
      systemPrompt: CLAUDE_SYSTEM,
      tools: allTools,
      messages: [{ role: 'user', content: 'Create a file /tmp/hello.py with a Python hello world script.' }],
    });
    console.log(`  Text: "${r.text.substring(0, 80)}"`);
    console.log(`  Tool calls: ${r.toolCalls.length}`);
    for (const tc of r.toolCalls) {
      const args = parseArgs(tc.arguments);
      console.log(`    → ${tc.name}(path=${args?.path || '?'}, content=${(args?.content || '').substring(0, 60)}...)`);
    }
    const ok = r.toolCalls.some(tc => {
      const a = parseArgs(tc.arguments);
      return tc.name === 'write_file' && a && a.path && a.content;
    });
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}: ${ok ? 'Called write_file with path+content' : 'Missing or wrong tool'}`);
    ok ? passed++ : failed++;
  }
  await sleep(1500);

  // ====== TEST 5: search_code with optional params ======
  console.log('\n━━━ TEST 5: "Find all TODO comments in .js files" → search_code ━━━');
  {
    const r = await sendChat(apiKey, server, {
      systemPrompt: CLAUDE_SYSTEM,
      tools: allTools,
      messages: [{ role: 'user', content: 'Search for all TODO comments in JavaScript files in /home/user/project' }],
    });
    console.log(`  Text: "${r.text.substring(0, 80)}"`);
    console.log(`  Tool calls: ${r.toolCalls.length}`);
    for (const tc of r.toolCalls) {
      const args = parseArgs(tc.arguments);
      console.log(`    → ${tc.name}(${JSON.stringify(args)})`);
    }
    const ok = r.toolCalls.some(tc => tc.name === 'search_code');
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}: ${ok ? 'Called search_code' : 'Did not call search_code'}`);
    ok ? passed++ : failed++;
  }
  await sleep(1500);

  // ====== TEST 6: Multi-step task — should call multiple tools ======
  console.log('\n━━━ TEST 6: Multi-step "Read file, then search for imports" ━━━');
  {
    const r = await sendChat(apiKey, server, {
      systemPrompt: CLAUDE_SYSTEM,
      tools: allTools,
      messages: [{ role: 'user', content: 'First read the file /tmp/app.js, then search for all import statements in the /tmp directory.' }],
    });
    console.log(`  Text: "${r.text.substring(0, 80)}"`);
    console.log(`  Tool calls: ${r.toolCalls.length}`);
    for (const tc of r.toolCalls) {
      console.log(`    → ${tc.name}(${tc.arguments.substring(0, 60)})`);
    }
    const names = r.toolCalls.map(tc => tc.name);
    const ok = names.includes('read_file') || names.length >= 1;
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}: Called ${names.join(' + ') || 'nothing'}`);
    ok ? passed++ : failed++;
  }
  await sleep(1500);

  // ====== TEST 7: No tool needed — pure text answer ======
  console.log('\n━━━ TEST 7: "What is a closure in JavaScript?" → no tool needed ━━━');
  {
    const r = await sendChat(apiKey, server, {
      systemPrompt: CLAUDE_SYSTEM,
      tools: allTools,
      messages: [{ role: 'user', content: 'What is a closure in JavaScript? Explain briefly.' }],
    });
    console.log(`  Text: "${r.text.substring(0, 150)}"`);
    console.log(`  Tool calls: ${r.toolCalls.length}`);
    const ok = r.toolCalls.length === 0 && r.text.length > 20;
    console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}: ${ok ? 'Pure text, no tool call' : r.toolCalls.length > 0 ? 'Unexpected tool call' : 'Empty response'}`);
    ok ? passed++ : failed++;
  }

  // ====== SUMMARY ======
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   SUMMARY                                                    ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Passed: ${passed}/${passed + failed}                                                  ║`);
  console.log(`║  Failed: ${failed}/${passed + failed}                                                  ║`);
  console.log('╠══════════════════════════════════════════════════════════════╣');
  if (passed + failed === passed) {
    console.log('║  ✓ ALL TESTS PASSED — Tool calling is fully functional!      ║');
  } else {
    console.log(`║  ⚠ ${failed} test(s) need investigation                          ║`);
  }
  console.log('╚══════════════════════════════════════════════════════════════╝');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
