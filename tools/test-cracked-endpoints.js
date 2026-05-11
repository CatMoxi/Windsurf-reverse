#!/usr/bin/env node
/**
 * Deep test endpoints that we've now cracked:
 * 1. GetEmbeddings — multiple models, large batches
 * 2. GetTranscription — speech-to-text  
 * 3. GetCompletions — try with uid and proper format
 * 4. GetStreamingModelAPITextCompletion on codeium.com
 * 5. GetCompletions on inference server
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

function buildMeta() {
  return {
    apiKey, ideName: 'windsurf', ideVersion: '2.5.0',
    extensionVersion: '2.5.0', sessionId: crypto.randomUUID(),
    requestId: Math.floor(Math.random() * 1e9), locale: 'en_US',
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const SELF = 'server.self-serve.windsurf.com';
const MAIN = 'server.codeium.com';
const API = '/exa.api_server_pb.ApiServerService';

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Cracked Endpoints Deep Test                            ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ===== 1. GetEmbeddings — multi-model test =====
  console.log('━━━ 1. GetEmbeddings ━━━\n');
  
  const models = [
    { label: 'OpenAI Ada (91)', id: 91 },
    { label: 'OpenAI 3-Small (163)', id: 163 },
    { label: 'OpenAI 3-Large (164)', id: 164 },
    { label: 'TogetherAI M2-BERT (81)', id: 81 },
    { label: 'HuggingFace M2-BERT (82)', id: 82 },
    { label: 'None (0)', id: 0 },
  ];
  
  for (const m of models) {
    try {
      const body = codec.encodeRequest('GetEmbeddings', {
        request: {
          prompts: ['Hello world', 'Machine learning', 'Fibonacci sequence'],
          model: m.id || undefined,
        },
        embeddingModel: m.id,
      });
      const res = await connectUnary(SELF, `${API}/GetEmbeddings`, body);
      if (res.status === 200) {
        const d = codec.decodeResponse('GetEmbeddings', res.body);
        const embs = d.response?.embeddings || [];
        console.log(`  [${m.label}]: ${embs.length} embeddings, dims=${embs[0]?.values?.length || 0}`);
      } else {
        console.log(`  [${m.label}]: HTTP ${res.status} — ${res.body.toString('utf-8').substring(0, 100)}`);
      }
    } catch (e) {
      console.log(`  [${m.label}]: ERROR ${e.message}`);
    }
    await sleep(1000);
  }
  
  // Large batch test
  console.log('\n  Large batch (10 prompts):');
  {
    const prompts = Array.from({length: 10}, (_, i) => `This is test prompt number ${i+1}`);
    const body = codec.encodeRequest('GetEmbeddings', {
      request: { prompts },
      embeddingModel: 163,
    });
    const res = await connectUnary(SELF, `${API}/GetEmbeddings`, body);
    if (res.status === 200) {
      const d = codec.decodeResponse('GetEmbeddings', res.body);
      console.log(`  10 prompts → ${d.response?.embeddings?.length} embeddings`);
    } else {
      console.log(`  Error: ${res.body.toString('utf-8').substring(0, 100)}`);
    }
  }
  await sleep(1500);

  // ===== 2. GetTranscription =====
  console.log('\n━━━ 2. GetTranscription (speech-to-text) ━━━\n');
  
  // Generate WAV with a tone (440Hz sine wave, 1 second) — so it's not silence
  const sampleRate = 16000;
  const duration = 1;
  const numSamples = sampleRate * duration;
  const pcmData = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5 * 32767;
    pcmData.writeInt16LE(Math.round(sample), i * 2);
  }
  
  const wavHeader = Buffer.alloc(44);
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmData.length, 4);
  wavHeader.write('WAVE', 8);
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20); // PCM
  wavHeader.writeUInt16LE(1, 22); // mono
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(sampleRate * 2, 28);
  wavHeader.writeUInt16LE(2, 32);
  wavHeader.writeUInt16LE(16, 34);
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmData.length, 40);
  const wavData = Buffer.concat([wavHeader, pcmData]);
  
  for (const server of [SELF, MAIN]) {
    const label = server.includes('self-serve') ? 'self-serve' : 'codeium';
    const body = codec.encodeRequest('GetTranscription', {
      metadata: buildMeta(),
      audioData: wavData,
    });
    const res = await connectUnary(server, `${API}/GetTranscription`, body);
    if (res.status === 200) {
      try {
        const d = codec.decodeResponse('GetTranscription', res.body);
        console.log(`  [${label}]: ✅ "${d.transcribedText}"`);
      } catch (e) {
        console.log(`  [${label}]: ✅ HTTP 200 but decode failed (${res.body.length}B)`);
      }
    } else {
      console.log(`  [${label}]: ❌ HTTP ${res.status}`);
    }
    await sleep(1000);
  }

  // ===== 3. GetCompletions with full format =====
  console.log('\n━━━ 3. GetCompletions (full format) ━━━\n');
  
  const completionTests = [
    {
      label: 'basic with uid',
      req: {
        metadata: buildMeta(),
        request: {
          prompt: 'function fibonacci(n) {\n  if (n <= 1) return n;\n  return ',
          editorLanguage: 'javascript',
          language: 17,
          uid: crypto.randomUUID(),
          configuration: { numCompletions: 1, maxTokens: 64 },
        },
        providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
        promptId: crypto.randomUUID(),
      }
    },
    {
      label: 'with model enum',
      req: {
        metadata: buildMeta(),
        request: {
          prompt: 'def hello_world():\n    ',
          editorLanguage: 'python',
          language: 28,
          uid: crypto.randomUUID(),
          model: 339, // MODEL_CHAT_GPT_5_LOW
          configuration: { numCompletions: 1, maxTokens: 64, temperature: 0.2 },
        },
        providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
        promptId: crypto.randomUUID(),
      }
    },
    {
      label: 'minimal',
      req: {
        metadata: buildMeta(),
        request: {
          prompt: 'print("Hello',
          uid: crypto.randomUUID(),
        },
      }
    },
  ];
  
  for (const t of completionTests) {
    for (const server of [SELF, MAIN]) {
      const label = server.includes('self-serve') ? 'self-serve' : 'codeium';
      try {
        const body = codec.encodeRequest('GetCompletions', t.req);
        const res = await connectUnary(server, `${API}/GetCompletions`, body);
        if (res.status === 200) {
          try {
            const d = codec.decodeResponse('GetCompletions', res.body);
            const items = d.completionResponse?.completionItems || d.completionItems || [];
            if (items.length > 0) {
              console.log(`  [${t.label}|${label}]: ✅ ${items.length} completions — "${(items[0].completion?.text || items[0].text || '').substring(0, 80)}"`);
            } else {
              console.log(`  [${t.label}|${label}]: ✅ HTTP 200 but 0 completions | ${JSON.stringify(d).substring(0, 150)}`);
            }
          } catch (e) {
            console.log(`  [${t.label}|${label}]: ✅ HTTP 200 but decode failed — ${res.body.length}B`);
          }
        } else {
          console.log(`  [${t.label}|${label}]: ❌ HTTP ${res.status} | ${res.body.toString('utf-8').substring(0, 100)}`);
        }
      } catch (e) {
        console.log(`  [${t.label}|${label}]: ERROR ${e.message}`);
      }
      await sleep(500);
    }
  }
  await sleep(1000);

  // ===== 4. GetStreamingModelAPITextCompletion on codeium.com =====
  console.log('\n━━━ 4. GetStreamingModelAPITextCompletion ━━━\n');
  
  for (const server of [SELF, MAIN]) {
    const label = server.includes('self-serve') ? 'self-serve' : 'codeium';
    try {
      const body = codec.encodeRequest('GetStreamingModelAPITextCompletion', {
        metadata: buildMeta(),
        model: 339,
        systemPrompt: 'You are helpful.',
        chatMessagePrompts: [{
          messageId: crypto.randomUUID(),
          source: 'CHAT_MESSAGE_SOURCE_USER',
          prompt: 'Say OK',
        }],
        requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
      });
      const res = await connectStream(server, `${API}/GetStreamingModelAPITextCompletion`, body);
      const frames = parseStreamFrames(res.body);
      let text = '', err = '';
      for (const f of frames) {
        if (f.flags === 2) {
          const s = f.payload.toString('utf-8');
          if (s && s !== '{}') err = s.substring(0, 150);
        } else if (f.payload.length > 0) {
          try {
            const d = codec.decodeResponse('GetStreamingModelAPITextCompletion', f.payload);
            if (d.deltas) for (const [k,v] of Object.entries(d.deltas)) { if(v.deltaText) text += v.deltaText; }
          } catch(e) {}
        }
      }
      if (text) console.log(`  [${label}]: ✅ "${text.substring(0, 80)}"`);
      else if (err) console.log(`  [${label}]: ❌ ${err}`);
      else console.log(`  [${label}]: ❌ empty`);
    } catch (e) {
      console.log(`  [${label}]: ERROR ${e.message}`);
    }
    await sleep(2000);
  }

  // ===== 5. Try inference server =====
  console.log('\n━━━ 5. Inference server (inference.codeium.com) ━━━\n');
  
  for (const endpoint of ['GetCompletions', 'GetStreamingCompletions']) {
    const isStream = endpoint === 'GetStreamingCompletions';
    try {
      const body = codec.encodeRequest(endpoint === 'GetStreamingCompletions' ? 'GetStreamingCompletions' : 'GetCompletions', {
        metadata: buildMeta(),
        request: {
          prompt: 'function add(a, b) {\n  return ',
          editorLanguage: 'javascript',
          language: 17,
          uid: crypto.randomUUID(),
          configuration: { numCompletions: 1, maxTokens: 32 },
        },
        providerSource: 'PROVIDER_SOURCE_AUTOCOMPLETE',
      });
      
      let res;
      if (isStream) {
        res = await connectStream('inference.codeium.com', `${API}/${endpoint}`, body);
        const frames = parseStreamFrames(res.body);
        const errF = frames.find(f => f.flags === 2);
        console.log(`  [inference|${endpoint}]: HTTP ${res.status} | frames=${frames.length} | ${errF ? errF.payload.toString('utf-8').substring(0, 100) : 'ok'}`);
      } else {
        res = await connectUnary('inference.codeium.com', `${API}/${endpoint}`, body);
        if (res.status === 200) {
          try {
            const d = codec.decodeResponse('GetCompletions', res.body);
            console.log(`  [inference|${endpoint}]: ✅ ${JSON.stringify(d).substring(0, 150)}`);
          } catch (e) {
            console.log(`  [inference|${endpoint}]: ✅ HTTP 200, ${res.body.length}B`);
          }
        } else {
          console.log(`  [inference|${endpoint}]: ❌ HTTP ${res.status} | ${res.body.toString('utf-8').substring(0, 100)}`);
        }
      }
    } catch (e) {
      console.log(`  [inference|${endpoint}]: ❌ ${e.message}`);
    }
    await sleep(1000);
  }

  // ===== 6. GenerateCommitMessage on codeium.com with api_key in metadata =====
  console.log('\n━━━ 6. GenerateCommitMessage ━━━\n');
  {
    // Try on codeium.com — it said "bad Authorization header" — maybe needs auth header
    const body = codec.encodeRequest('GenerateCommitMessage', {
      metadata: buildMeta(),
    });
    if (body.length > 0) {
      // Try with Authorization header
      const req = https.request({
        hostname: MAIN, port: 443,
        path: `${API}/GenerateCommitMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/proto',
          'Connect-Protocol-Version': '1',
          'Content-Length': body.length,
          'Authorization': `Basic ${apiKey}`,
        },
      }, res => {
        const c = [];
        res.on('data', d => c.push(d));
        res.on('end', () => {
          console.log(`  [codeium|Basic auth]: HTTP ${res.statusCode} | ${Buffer.concat(c).toString('utf-8').substring(0, 200)}`);
        });
      });
      req.write(body);
      req.end();
    } else {
      console.log('  Not registered');
    }
  }
  
  await sleep(3000);
  console.log('\n══════ Done ══════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
