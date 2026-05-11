#!/usr/bin/env node
/**
 * Test: temperature / max_tokens / concurrent requests
 * 
 * #35: max_tokens 是否生效 (限制输出长度)
 * #36: temperature 是否生效 (影响随机性)
 * #NEW: 并发请求是否安全
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
  let usage = null;
  let stopReason = '';
  let errors = [];
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
      if (dec.stopReason) stopReason = dec.stopReason;
      if (dec.usage) usage = dec.usage;
    } catch (e) {}
  }
  return { text, usage, stopReason, errors };
}

function buildRequest(apiKey, prompt, opts = {}) {
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
    chatMessagePrompts: [
      { messageId: crypto.randomUUID(), source: 'CHAT_MESSAGE_SOURCE_USER', prompt },
    ],
    chatModelUid: opts.model || 'gpt-5-5-low',
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId: crypto.randomUUID(),
    promptId: crypto.randomUUID(),
    toolChoice: { optionName: 'none' },
  };

  // CompletionConfiguration (field 8 of GetChatMessageRequest)
  if (opts.maxTokens || opts.temperature !== undefined || opts.stop) {
    req.configuration = {};
    if (opts.maxTokens) req.configuration.maxTokens = opts.maxTokens;
    if (opts.temperature !== undefined) req.configuration.temperature = opts.temperature;
    if (opts.stop) req.configuration.stopPatterns = opts.stop;
  }

  return codec.encodeRequest('GetChatMessage', req);
}

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

// ==================== Tests ====================

async function main() {
  const apiKey = resolveApiKey();
  if (!apiKey) { console.error('No API key'); process.exit(1); }
  const server = resolveServer();

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Parameter Control Tests                                ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`  Server: ${server}\n`);

  // ===== TEST: max_tokens =====
  console.log('━━━ TEST #35: max_tokens 限制输出长度 ━━━');
  const longPrompt = 'Write a detailed essay about the history of computers. Be very verbose.';
  
  // No limit
  console.log('  [A] No max_tokens limit:');
  const bodyA = buildRequest(apiKey, longPrompt, {});
  const resA = await connectPost(server, API_PATH, bodyA);
  const pA = extractResponse(resA.body);
  console.log(`    Length: ${pA.text.length} chars, StopReason: ${pA.stopReason}`);
  if (pA.usage) console.log(`    Usage: in=${pA.usage.inputTokens}, out=${pA.usage.outputTokens}`);

  await sleep(1500);

  // max_tokens = 20
  console.log('  [B] max_tokens = 20:');
  const bodyB = buildRequest(apiKey, longPrompt, { maxTokens: 20 });
  const resB = await connectPost(server, API_PATH, bodyB);
  const pB = extractResponse(resB.body);
  console.log(`    Length: ${pB.text.length} chars, StopReason: ${pB.stopReason}`);
  console.log(`    Text: "${pB.text.substring(0, 100)}"`);
  if (pB.usage) console.log(`    Usage: in=${pB.usage.inputTokens}, out=${pB.usage.outputTokens}`);

  await sleep(1500);

  // max_tokens = 5
  console.log('  [C] max_tokens = 5:');
  const bodyC = buildRequest(apiKey, longPrompt, { maxTokens: 5 });
  const resC = await connectPost(server, API_PATH, bodyC);
  const pC = extractResponse(resC.body);
  console.log(`    Length: ${pC.text.length} chars, StopReason: ${pC.stopReason}`);
  console.log(`    Text: "${pC.text.substring(0, 60)}"`);
  if (pC.usage) console.log(`    Usage: in=${pC.usage.inputTokens}, out=${pC.usage.outputTokens}`);

  const maxTokensWorks = pA.text.length > pB.text.length * 2 && pB.text.length > pC.text.length;
  console.log(`\n  → max_tokens 生效: ${maxTokensWorks ? '✓ YES' : '✗ NO'} (${pA.text.length} > ${pB.text.length} > ${pC.text.length})\n`);

  await sleep(1500);

  // ===== TEST: temperature =====
  console.log('━━━ TEST #36: temperature 影响随机性 ━━━');
  const deterministicPrompt = 'Pick a random number between 1 and 1000. Only output the number.';
  
  // temperature = 0 (deterministic)
  console.log('  [A] temperature = 0 (3 runs):');
  const t0results = [];
  for (let i = 0; i < 3; i++) {
    const body = buildRequest(apiKey, deterministicPrompt, { temperature: 0 });
    const res = await connectPost(server, API_PATH, body);
    const p = extractResponse(res.body);
    t0results.push(p.text.trim());
    console.log(`    Run ${i+1}: "${p.text.trim()}"`);
    await sleep(800);
  }

  // temperature = 2.0 (very random)
  console.log('  [B] temperature = 2.0 (3 runs):');
  const t2results = [];
  for (let i = 0; i < 3; i++) {
    const body = buildRequest(apiKey, deterministicPrompt, { temperature: 2.0 });
    const res = await connectPost(server, API_PATH, body);
    const p = extractResponse(res.body);
    t2results.push(p.text.trim());
    console.log(`    Run ${i+1}: "${p.text.trim()}"`);
    await sleep(800);
  }

  const t0allSame = t0results.every(r => r === t0results[0]);
  const t2allSame = t2results.every(r => r === t2results[0]);
  console.log(`\n  → temp=0 一致: ${t0allSame ? '✓ YES (deterministic)' : '✗ NO (still random)'}`);
  console.log(`  → temp=2 分散: ${!t2allSame ? '✓ YES (random)' : '△ all same (may not work)'}`);
  const tempWorks = t0allSame && !t2allSame;
  console.log(`  → temperature 生效: ${tempWorks ? '✓ YES' : t0allSame ? '△ PARTIAL' : '✗ NO'}\n`);

  await sleep(1500);

  // ===== TEST: stop patterns =====
  console.log('━━━ TEST #NEW: stop patterns ━━━');
  const stopPrompt = 'Count from 1 to 20, each on a new line.';
  
  console.log('  [A] No stop:');
  const bodySA = buildRequest(apiKey, stopPrompt, {});
  const resSA = await connectPost(server, API_PATH, bodySA);
  const pSA = extractResponse(resSA.body);
  const linesA = pSA.text.trim().split('\n').length;
  console.log(`    Lines: ${linesA}, StopReason: ${pSA.stopReason}`);

  await sleep(1500);

  console.log('  [B] stop = ["5"]:');
  const bodySB = buildRequest(apiKey, stopPrompt, { stop: ['5'] });
  const resSB = await connectPost(server, API_PATH, bodySB);
  const pSB = extractResponse(resSB.body);
  const linesB = pSB.text.trim().split('\n').length;
  console.log(`    Lines: ${linesB}, StopReason: ${pSB.stopReason}`);
  console.log(`    Text: "${pSB.text.substring(0, 60)}"`);

  const stopWorks = linesB < linesA && pSB.stopReason.includes('STOP_PATTERN');
  console.log(`\n  → stop patterns 生效: ${stopWorks ? '✓ YES' : linesB < linesA ? '△ PARTIAL (stopped but wrong reason)' : '✗ NO'}\n`);

  await sleep(1500);

  // ===== TEST: Concurrent requests =====
  console.log('━━━ TEST #NEW: 并发请求安全性 (3 concurrent) ━━━');
  
  const concurrentPrompts = [
    'Say "AAA" and nothing else.',
    'Say "BBB" and nothing else.',
    'Say "CCC" and nothing else.',
  ];
  
  const start = Date.now();
  const concurrentResults = await Promise.all(concurrentPrompts.map(async (p, i) => {
    const body = buildRequest(apiKey, p, {});
    const res = await connectPost(server, API_PATH, body);
    const parsed = extractResponse(res.body);
    return { index: i, text: parsed.text.trim(), status: res.status };
  }));
  const elapsed = Date.now() - start;
  
  for (const r of concurrentResults) {
    const expected = ['AAA', 'BBB', 'CCC'][r.index];
    const correct = r.text.includes(expected);
    console.log(`  [${r.index}] Expected: ${expected}, Got: "${r.text.substring(0, 30)}" ${correct ? '✓' : '✗'}`);
  }
  console.log(`  Total time: ${elapsed}ms (parallel, not serial ${concurrentResults.length * 1500}ms+)`);
  
  const allCorrect = concurrentResults.every((r, i) => r.text.includes(['AAA', 'BBB', 'CCC'][i]));
  const isParallel = elapsed < 5000; // should be < 5s if truly parallel
  console.log(`  → 并发安全: ${allCorrect ? '✓ 响应正确' : '✗ 响应混乱'}`);
  console.log(`  → 真正并行: ${isParallel ? '✓ YES' : '✗ 可能被串行化'}\n`);

  // ===== SUMMARY =====
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   SUMMARY                                                ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  max_tokens:      ${maxTokensWorks ? '✓ 生效' : '✗ 不生效'}                                 ║`);
  console.log(`║  temperature:     ${tempWorks ? '✓ 生效' : t0allSame ? '△ 部分' : '✗ 不生效'}                                 ║`);
  console.log(`║  stop patterns:   ${stopWorks ? '✓ 生效' : '✗ 不生效'}                                 ║`);
  console.log(`║  并发安全:        ${allCorrect ? '✓ 安全' : '✗ 不安全'}                                 ║`);
  console.log(`║  并行执行:        ${isParallel ? '✓ 是' : '✗ 否'} (${elapsed}ms)                    ║`);
  console.log('╚══════════════════════════════════════════════════════════╝');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
