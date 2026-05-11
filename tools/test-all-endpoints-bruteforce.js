#!/usr/bin/env node
/**
 * Brute-force test ALL unavailable endpoints on BOTH servers with BOTH protocols.
 * Servers: server.self-serve.windsurf.com, server.codeium.com
 * Protocols: Connect-RPC (unary + stream)
 * 
 * Goal: replicate all language_server.exe functionality
 */
'use strict';

const https = require('https');
const http2 = require('http2');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const codec = require(path.join(__dirname, '..', 'src', 'language-server', 'proto-codec'));

const apiKey = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
  .match(/CODEIUM_API_KEY=(.+)/)[1].trim();

const SERVERS = [
  'server.self-serve.windsurf.com',
  'server.codeium.com',
];

function buildMeta() {
  return {
    apiKey, ideName: 'windsurf', ideVersion: '2.5.0',
    extensionVersion: '2.5.0', sessionId: crypto.randomUUID(),
    requestId: Math.floor(Math.random() * 1e9), locale: 'en_US',
  };
}

// Connect-RPC unary
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

// Connect-RPC stream
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

// gRPC (HTTP/2) call
function grpcCall(hostname, urlPath, body) {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${hostname}`);
    client.on('error', err => { reject(err); });
    
    // gRPC frame: 1 byte compress flag (0) + 4 byte length
    const grpcFrame = Buffer.alloc(5 + body.length);
    grpcFrame[0] = 0; // no compression
    grpcFrame.writeUInt32BE(body.length, 1);
    body.copy(grpcFrame, 5);
    
    const req = client.request({
      ':method': 'POST',
      ':path': urlPath,
      'content-type': 'application/grpc',
      'te': 'trailers',
      'grpc-timeout': '30S',
    });
    
    const chunks = [];
    let grpcStatus = null;
    let grpcMessage = null;
    
    req.on('response', (headers) => {
      // nothing
    });
    
    req.on('trailers', (headers) => {
      grpcStatus = headers['grpc-status'];
      grpcMessage = headers['grpc-message'];
    });
    
    req.on('data', (d) => chunks.push(d));
    
    req.on('end', () => {
      client.close();
      const buf = Buffer.concat(chunks);
      resolve({ grpcStatus, grpcMessage, body: buf });
    });
    
    req.on('error', (err) => {
      client.close();
      reject(err);
    });
    
    req.write(grpcFrame);
    req.end();
  });
}

function parseGrpcFrames(buf) {
  const frames = [];
  let pos = 0;
  while (pos + 5 <= buf.length) {
    const compress = buf[pos];
    const len = buf.readUInt32BE(pos + 1);
    pos += 5;
    if (pos + len > buf.length) break;
    frames.push(buf.subarray(pos, pos + len));
    pos += len;
  }
  return frames;
}

function parseConnectFrames(buf) {
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function testAll(method, service, reqObj, isStream) {
  const body = codec.encodeRequest(method, reqObj);
  if (body.length === 0) {
    console.log(`  ⚠ ${method}: encodeRequest empty (not registered)`);
    return;
  }
  
  const urlPath = `/${service}/${method}`;
  
  for (const server of SERVERS) {
    const label = server.includes('self-serve') ? 'self-serve' : 'codeium';
    
    // Connect-RPC
    try {
      let res;
      if (isStream) {
        res = await connectStream(server, urlPath, body);
        const frames = parseConnectFrames(res.body);
        const dataFrames = frames.filter(f => f.flags === 0 && f.payload.length > 0);
        const errFrame = frames.find(f => f.flags === 2);
        const errText = errFrame ? errFrame.payload.toString('utf-8') : '';
        
        if (dataFrames.length > 0) {
          let decoded = null;
          try { decoded = codec.decodeResponse(method, dataFrames[0].payload); } catch(e) {}
          const summary = decoded ? JSON.stringify(decoded).substring(0, 150) : `${dataFrames[0].payload.length}B raw`;
          console.log(`  [${label}|connect-stream] ✅ HTTP ${res.status} | ${dataFrames.length} frames | ${summary}`);
        } else if (errText && errText !== '{}') {
          console.log(`  [${label}|connect-stream] ❌ HTTP ${res.status} | ${errText.substring(0, 120)}`);
        } else {
          console.log(`  [${label}|connect-stream] ❌ HTTP ${res.status} | empty`);
        }
      } else {
        res = await connectUnary(server, urlPath, body);
        if (res.status === 200 && res.body.length > 0) {
          let decoded = null;
          try { decoded = codec.decodeResponse(method, res.body); } catch(e) {}
          const summary = decoded ? JSON.stringify(decoded).substring(0, 150) : `${res.body.length}B raw`;
          console.log(`  [${label}|connect-unary] ✅ HTTP ${res.status} | ${summary}`);
        } else {
          console.log(`  [${label}|connect-unary] ❌ HTTP ${res.status} | ${res.body.toString('utf-8').substring(0, 120)}`);
        }
      }
    } catch (e) {
      console.log(`  [${label}|connect] ❌ ${e.message}`);
    }
    
    // gRPC (HTTP/2)
    try {
      const res = await grpcCall(server, urlPath, body);
      if (res.grpcStatus === '0' || res.grpcStatus === 0) {
        const frames = parseGrpcFrames(res.body);
        if (frames.length > 0) {
          let decoded = null;
          try { decoded = codec.decodeResponse(method, frames[0]); } catch(e) {}
          const summary = decoded ? JSON.stringify(decoded).substring(0, 150) : `${frames[0].length}B raw`;
          console.log(`  [${label}|gRPC] ✅ status=0 | ${frames.length} frames | ${summary}`);
        } else {
          console.log(`  [${label}|gRPC] ✅ status=0 | no data frames`);
        }
      } else {
        const msg = decodeURIComponent(res.grpcMessage || '');
        console.log(`  [${label}|gRPC] ❌ status=${res.grpcStatus} | ${msg.substring(0, 120)}`);
      }
    } catch (e) {
      console.log(`  [${label}|gRPC] ❌ ${e.message}`);
    }
    
    await sleep(500);
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Brute-force Endpoint Test (2 servers × 2 protocols)    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const API = 'exa.api_server_pb.ApiServerService';

  // ===== 1. GetCompletions =====
  console.log('━━━ 1. GetCompletions (code autocomplete) ━━━');
  await testAll('GetCompletions', API, {
    metadata: buildMeta(),
    request: {
      prompt: 'function fibonacci(n) {\n  if (n <= 1) return n;\n  return ',
      editorLanguage: 'javascript',
      language: 17,
      uid: crypto.randomUUID(),
    },
    providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
    promptId: crypto.randomUUID(),
  }, false);
  await sleep(1000);

  // ===== 2. GetStreamingCompletions =====
  console.log('\n━━━ 2. GetStreamingCompletions ━━━');
  await testAll('GetStreamingCompletions', API, {
    metadata: buildMeta(),
    request: {
      prompt: 'def hello():\n    print("Hello',
      editorLanguage: 'python',
      language: 28,
      uid: crypto.randomUUID(),
    },
    providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
  }, true);
  await sleep(1000);

  // ===== 3. GetEmbeddings =====
  console.log('\n━━━ 3. GetEmbeddings ━━━');
  // EmbeddingsRequest has prompts[], not complex texts
  await testAll('GetEmbeddings', API, {
    request: {
      prompts: ['Hello world', 'Machine learning is great'],
    },
    embeddingModel: 91, // MODEL_TEXT_EMBEDDING_OPENAI_ADA
  }, false);
  await sleep(1000);

  // Also try with metadata
  console.log('  (with metadata)');
  await testAll('GetEmbeddings', API, {
    request: {
      prompts: ['Hello world', 'Machine learning is great'],
      model: 163, // MODEL_TEXT_EMBEDDING_OPENAI_3_SMALL
    },
    embeddingModel: 163,
  }, false);
  await sleep(1000);

  // ===== 4. GetStreamingModelAPITextCompletion =====
  console.log('\n━━━ 4. GetStreamingModelAPITextCompletion ━━━');
  await testAll('GetStreamingModelAPITextCompletion', API, {
    metadata: buildMeta(),
    model: 339, // MODEL_CHAT_GPT_5_LOW
    systemPrompt: 'You are helpful.',
    chatMessagePrompts: [{
      messageId: crypto.randomUUID(),
      source: 'CHAT_MESSAGE_SOURCE_USER',
      prompt: 'Say hello',
    }],
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
  }, true);
  await sleep(1000);

  // ===== 5. GetTab =====
  console.log('\n━━━ 5. GetTab ━━━');
  await testAll('GetTab', API, {
    metadata: buildMeta(),
    unifiedPromptComponents: {
      // minimal
    },
    promptId: crypto.randomUUID(),
    language: 17, // LANGUAGE_JAVASCRIPT
    providerSource: 'PROVIDER_SOURCE_TAB_JUMP',
  }, true);
  await sleep(1000);

  // ===== 6. GetChatCompletions =====
  console.log('\n━━━ 6. GetChatCompletions ━━━');
  await testAll('GetChatCompletions', API, {
    metadata: buildMeta(),
    modelId: 339,
    completionsRequest: {
      prompt: 'Hello',
      editorLanguage: 'text',
      language: 0,
    },
  }, false);
  await sleep(1000);

  // ===== 7. GetStreamingExternalChatCompletions =====
  console.log('\n━━━ 7. GetStreamingExternalChatCompletions ━━━');
  await testAll('GetStreamingExternalChatCompletions', API, {
    metadata: buildMeta(),
    modelId: 339,
    completionsRequest: {
      prompt: 'Hello',
      editorLanguage: 'text',
    },
  }, true);
  await sleep(1000);

  // ===== 8. GetDeepWiki =====
  console.log('\n━━━ 8. GetDeepWiki ━━━');
  await testAll('GetDeepWiki', API, {
    metadata: buildMeta(),
    requestType: 'DEEP_WIKI_REQUEST_TYPE_EXPLAIN',
    symbolName: 'fibonacci',
  }, true);
  await sleep(1000);

  // ===== 9. AssignModel =====
  console.log('\n━━━ 9. AssignModel ━━━');
  await testAll('AssignModel', API, {
    metadata: buildMeta(),
    modelRouterUid: 'gpt-5-5-low',
    cascadeId: crypto.randomUUID(),
  }, false);
  await sleep(1000);

  // ===== 10. GetTranscription =====
  console.log('\n━━━ 10. GetTranscription ━━━');
  // Generate minimal valid WAV
  const wavHeader = Buffer.alloc(44);
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + 16000, 4); // file size - 8
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16); // fmt chunk size
  wavHeader.writeUInt16LE(1, 20);  // PCM
  wavHeader.writeUInt16LE(1, 22);  // mono
  wavHeader.writeUInt32LE(16000, 24); // sample rate
  wavHeader.writeUInt32LE(32000, 28); // byte rate
  wavHeader.writeUInt16LE(2, 32);  // block align
  wavHeader.writeUInt16LE(16, 34); // bits per sample
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(16000, 40); // data size
  // 1 second of silence
  const silence = Buffer.alloc(16000);
  const wavData = Buffer.concat([wavHeader, silence]);
  
  await testAll('GetTranscription', API, {
    metadata: buildMeta(),
    audioData: wavData,
  }, false);
  await sleep(1000);

  // ===== 11. HandleStreamingCommand (LanguageServerService) =====
  console.log('\n━━━ 11. HandleStreamingCommand (LS service) ━━━');
  const LS = 'exa.language_server_pb.LanguageServerService';
  await testAll('HandleStreamingCommand', LS, {
    metadata: buildMeta(),
  }, true);
  await sleep(1000);

  // ===== 12. RawGetChatMessage =====
  console.log('\n━━━ 12. RawGetChatMessage ━━━');
  await testAll('RawGetChatMessage', LS, {
    metadata: buildMeta(),
    chatMessagePrompts: [{
      messageId: crypto.randomUUID(),
      source: 'CHAT_MESSAGE_SOURCE_USER',
      prompt: 'Say hi',
    }],
    chatModelUid: 'gpt-5-4-none',
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId: crypto.randomUUID(),
    promptId: crypto.randomUUID(),
  }, true);
  await sleep(1000);

  // ===== 13. GetMessageTokenCount =====
  console.log('\n━━━ 13. GetMessageTokenCount ━━━');
  await testAll('GetMessageTokenCount', LS, {
    metadata: buildMeta(),
  }, false);

  // Also try on API server
  await testAll('GetMessageTokenCount', API, {
    metadata: buildMeta(),
  }, false);
  await sleep(1000);

  // ===== 14. GenerateCommitMessage =====
  console.log('\n━━━ 14. GenerateCommitMessage ━━━');
  await testAll('GenerateCommitMessage', LS, {
    metadata: buildMeta(),
  }, false);

  await testAll('GenerateCommitMessage', API, {
    metadata: buildMeta(),
  }, false);
  await sleep(1000);

  // ===== 15. GetSystemPromptAndTools =====
  console.log('\n━━━ 15. GetSystemPromptAndTools ━━━');
  await testAll('GetSystemPromptAndTools', LS, {
    metadata: buildMeta(),
  }, false);

  await testAll('GetSystemPromptAndTools', API, {
    metadata: buildMeta(),
  }, false);

  console.log('\n══════ Done ══════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
