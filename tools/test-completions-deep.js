#!/usr/bin/env node
/**
 * Deep test GetCompletions with proper Document/PromptComponents structure.
 * The LS builds the prompt from Document + context, we need to replicate this.
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

const SELF = 'server.self-serve.windsurf.com';
const MAIN = 'server.codeium.com';
const INFER = 'inference.codeium.com';
const API = '/exa.api_server_pb.ApiServerService';

async function testCompletion(label, req, servers = [SELF, MAIN]) {
  for (const server of servers) {
    const sLabel = server.includes('self-serve') ? 'self-serve' : server.includes('inference') ? 'inference' : 'codeium';
    try {
      const body = codec.encodeRequest('GetCompletions', req);
      const res = await connectUnary(server, `${API}/GetCompletions`, body);
      if (res.status === 200 && res.body.length > 2) {
        try {
          const d = codec.decodeResponse('GetCompletions', res.body);
          const items = d.completionResponse?.completionItems || [];
          if (items.length > 0) {
            const text = items[0].completion?.text || items[0].text || '';
            console.log(`  [${label}|${sLabel}]: ✅ ${items.length} items — "${text.substring(0, 100)}"`);
          } else {
            const keys = Object.keys(d);
            console.log(`  [${label}|${sLabel}]: ✅ HTTP 200, 0 items | keys=${keys.join(',')}`);
          }
        } catch (e) {
          console.log(`  [${label}|${sLabel}]: ✅ HTTP 200, decode error: ${e.message}`);
        }
      } else {
        const errText = res.body.toString('utf-8').substring(0, 120);
        console.log(`  [${label}|${sLabel}]: ❌ HTTP ${res.status} | ${errText}`);
      }
    } catch (e) {
      console.log(`  [${label}|${sLabel}]: ERROR ${e.message}`);
    }
    await sleep(500);
  }
}

async function testStreamCompletion(label, req, servers = [SELF, MAIN]) {
  for (const server of servers) {
    const sLabel = server.includes('self-serve') ? 'self-serve' : server.includes('inference') ? 'inference' : 'codeium';
    try {
      const body = codec.encodeRequest('GetStreamingCompletions', req);
      const res = await connectStream(server, `${API}/GetStreamingCompletions`, body);
      const frames = parseStreamFrames(res.body);
      const dataFrames = frames.filter(f => f.flags === 0 && f.payload.length > 0);
      const errFrame = frames.find(f => f.flags === 2);
      const errText = errFrame ? errFrame.payload.toString('utf-8') : '';
      
      if (dataFrames.length > 0) {
        try {
          const d = codec.decodeResponse('GetStreamingCompletions', dataFrames[0].payload);
          console.log(`  [${label}|${sLabel}]: ✅ ${dataFrames.length} frames | ${JSON.stringify(d).substring(0, 150)}`);
        } catch (e) {
          console.log(`  [${label}|${sLabel}]: ✅ ${dataFrames.length} frames (decode err)`);
        }
      } else if (errText && errText !== '{}') {
        console.log(`  [${label}|${sLabel}]: ❌ ${errText.substring(0, 120)}`);
      } else {
        console.log(`  [${label}|${sLabel}]: ❌ empty`);
      }
    } catch (e) {
      console.log(`  [${label}|${sLabel}]: ERROR ${e.message}`);
    }
    await sleep(500);
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   GetCompletions Deep Test                                ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const codeText = 'function fibonacci(n) {\n  if (n <= 1) return n;\n  return ';
  const cursorOffset = codeText.length;

  // Test 1: With PromptComponents.document
  console.log('━━━ 1. With PromptComponents.document ━━━');
  await testCompletion('promptComponents', {
    metadata: buildMeta(),
    request: {
      prompt: codeText,
      editorLanguage: 'javascript',
      language: 17,
      uid: crypto.randomUUID(),
      configuration: { numCompletions: 1, maxTokens: 64 },
    },
    promptComponents: {
      document: {
        text: codeText,
        cursorOffset: cursorOffset,
        editorLanguage: 'javascript',
        language: 17,
        absoluteUri: 'file:///tmp/test.js',
        workspaceUri: 'file:///tmp',
        lineEnding: '\n',
      },
    },
    providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
    promptId: crypto.randomUUID(),
  });
  await sleep(1000);

  // Test 2: Minimal with only Document (no CompletionsRequest.prompt)
  console.log('\n━━━ 2. PromptComponents only (no prompt field) ━━━');
  await testCompletion('docOnly', {
    metadata: buildMeta(),
    request: {
      editorLanguage: 'javascript',
      language: 17,
      uid: crypto.randomUUID(),
      configuration: { numCompletions: 1, maxTokens: 64 },
    },
    promptComponents: {
      document: {
        text: codeText,
        cursorOffset: cursorOffset,
        editorLanguage: 'javascript',
        language: 17,
        absoluteUri: 'file:///tmp/test.js',
        lineEnding: '\n',
      },
    },
    providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
    promptId: crypto.randomUUID(),
  });
  await sleep(1000);

  // Test 3: With auth_source in metadata
  console.log('\n━━━ 3. With auth_source in metadata ━━━');
  await testCompletion('authSource', {
    metadata: buildMeta({ authSource: 'AUTH_SOURCE_CODEIUM_TOKEN' }),
    request: {
      prompt: codeText,
      editorLanguage: 'javascript',
      language: 17,
      uid: crypto.randomUUID(),
      configuration: { numCompletions: 1, maxTokens: 64 },
    },
    promptComponents: {
      document: {
        text: codeText,
        cursorOffset: cursorOffset,
        editorLanguage: 'javascript',
        language: 17,
        absoluteUri: 'file:///tmp/test.js',
        lineEnding: '\n',
      },
    },
    providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
    promptId: crypto.randomUUID(),
  });
  await sleep(1000);

  // Test 4: Absolutly minimal — just metadata + empty request
  console.log('\n━━━ 4. Absolute minimal ━━━');
  await testCompletion('minimal', {
    metadata: buildMeta(),
    request: {},
  });
  await sleep(1000);

  // Test 5: Try with absolutePathMigrateMeToUri (old field)
  console.log('\n━━━ 5. Old-style path fields ━━━');
  await testCompletion('oldPath', {
    metadata: buildMeta(),
    request: {
      prompt: codeText,
      editorLanguage: 'javascript',
      language: 17,
      uid: crypto.randomUUID(),
      absolutePathUriForTelemetry: 'file:///tmp/test.js',
      relativePathForTelemetry: 'test.js',
      configuration: { numCompletions: 1, maxTokens: 64 },
    },
    providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
  });
  await sleep(1000);

  // Test 6: GetStreamingCompletions with full format
  console.log('\n━━━ 6. GetStreamingCompletions ━━━');
  await testStreamCompletion('streaming', {
    metadata: buildMeta(),
    request: {
      prompt: codeText,
      editorLanguage: 'javascript',
      language: 17,
      uid: crypto.randomUUID(),
      configuration: { numCompletions: 1, maxTokens: 64 },
    },
    promptComponents: {
      document: {
        text: codeText,
        cursorOffset: cursorOffset,
        editorLanguage: 'javascript',
        language: 17,
        absoluteUri: 'file:///tmp/test.js',
        lineEnding: '\n',
      },
    },
    providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
    promptId: crypto.randomUUID(),
  });
  await sleep(1000);

  // Test 7: Try all 3 servers including inference
  console.log('\n━━━ 7. All 3 servers (incl. inference) ━━━');
  await testCompletion('allServers', {
    metadata: buildMeta(),
    request: {
      prompt: codeText,
      editorLanguage: 'javascript',
      language: 17,
      uid: crypto.randomUUID(),
      configuration: { numCompletions: 1, maxTokens: 64 },
    },
    promptComponents: {
      document: {
        text: codeText,
        cursorOffset: cursorOffset,
        editorLanguage: 'javascript',
        language: 17,
        absoluteUri: 'file:///tmp/test.js',
        lineEnding: '\n',
      },
    },
    providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
    promptId: crypto.randomUUID(),
  }, [SELF, MAIN, INFER]);
  await sleep(1000);

  // Test 8: With model specified
  console.log('\n━━━ 8. With explicit model ━━━');
  // MODEL_CHAT_GPT_5_LOW = 339, but for autocomplete might need different model
  // Let's try a few
  for (const model of [0, 1, 339, 287]) { // 0=unset, 1=basic, 339=GPT5, 287=CODEX_MINI
    await testCompletion(`model=${model}`, {
      metadata: buildMeta(),
      request: {
        prompt: codeText,
        editorLanguage: 'javascript',
        language: 17,
        uid: crypto.randomUUID(),
        model: model || undefined,
        configuration: { numCompletions: 1, maxTokens: 64 },
      },
      promptComponents: {
        document: {
          text: codeText,
          cursorOffset: cursorOffset,
          editorLanguage: 'javascript',
          language: 17,
          absoluteUri: 'file:///tmp/test.js',
          lineEnding: '\n',
        },
      },
      providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
      promptId: crypto.randomUUID(),
    }, [SELF]);
    await sleep(500);
  }

  // Test 9: Using experimentConfig
  console.log('\n━━━ 9. With experimentConfig ━━━');
  await testCompletion('experiment', {
    metadata: buildMeta(),
    request: {
      prompt: codeText,
      editorLanguage: 'javascript',
      language: 17,
      uid: crypto.randomUUID(),
      configuration: { numCompletions: 1, maxTokens: 64 },
    },
    promptComponents: {
      document: {
        text: codeText,
        cursorOffset: cursorOffset,
        editorLanguage: 'javascript',
        language: 17,
        absoluteUri: 'file:///tmp/test.js',
        lineEnding: '\n',
      },
    },
    providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
    promptId: crypto.randomUUID(),
    experimentConfig: {},
  }, [SELF, MAIN]);

  console.log('\n══════ Done ══════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
