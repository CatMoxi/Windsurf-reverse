#!/usr/bin/env node
/**
 * Advanced endpoint tests:
 * #1: GetStreamingModelAPITextCompletion (temperature/max_tokens)
 * #2: GetEmbeddings
 * #3: GetCompletions / GetTab (code completion)
 * #4: delta_thinking (Claude thinking mode)
 * #5: GetDeepWiki
 * #6: Credit tracking (credit_cost field)
 */
'use strict';

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const codec = require(path.join(__dirname, '..', 'src', 'language-server', 'proto-codec'));

const apiKey = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
  .match(/CODEIUM_API_KEY=(.+)/)[1].trim();
const server = 'server.self-serve.windsurf.com';

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
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
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
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c) }));
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

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Advanced Endpoint Tests                                ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ========================================
  // #1: GetStreamingModelAPITextCompletion
  // ========================================
  console.log('━━━ #1: GetStreamingModelAPITextCompletion ━━━\n');
  
  // Test A: Basic call with Model enum
  const testConfigs = [
    { label: 'GPT-5 low (339)', model: 339, temp: undefined, maxTok: undefined },
    { label: 'GPT-5 low + temp=0.1', model: 339, temp: 0.1, maxTok: undefined },
    { label: 'GPT-5 low + temp=1.5', model: 339, temp: 1.5, maxTok: undefined },
    { label: 'GPT-5 low + max_tokens=20', model: 339, temp: undefined, maxTok: 20 },
    { label: 'GPT-5 low + max_tokens=5', model: 339, temp: undefined, maxTok: 5 },
    { label: 'GPT-5 low + stop=["world"]', model: 339, temp: undefined, maxTok: undefined, stop: ['world'] },
    { label: 'Claude 4 Sonnet (281)', model: 281, temp: undefined, maxTok: undefined },
    { label: 'Claude 4.5 Sonnet Thinking (354)', model: 354, temp: undefined, maxTok: undefined },
    { label: 'Gemini 2.5 Pro (253)', model: 253, temp: undefined, maxTok: undefined },
  ];

  for (const cfg of testConfigs) {
    const req = {
      metadata: buildMeta(),
      model: cfg.model,
      systemPrompt: 'You are a helpful assistant. Be concise.',
      chatMessagePrompts: [{
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: cfg.stop ? 'Say "hello world" exactly.' : 'Write a 3-line poem about coding.',
      }],
      requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    };

    if (cfg.temp !== undefined || cfg.maxTok || cfg.stop) {
      req.completionConfiguration = {};
      if (cfg.temp !== undefined) req.completionConfiguration.temperature = cfg.temp;
      if (cfg.maxTok) req.completionConfiguration.maxTokens = cfg.maxTok;
      if (cfg.stop) req.completionConfiguration.stopPatterns = cfg.stop;
    }

    try {
      const body = codec.encodeRequest('GetStreamingModelAPITextCompletion', req);
      if (body.length === 0) {
        console.log(`  [${cfg.label}]: encodeRequest empty - method not registered`);
        break;
      }
      const res = await connectStream(server,
        '/exa.api_server_pb.ApiServerService/GetStreamingModelAPITextCompletion', body);
      
      let text = '', thinking = '', stopReason = '', usage = null, errors = [];
      for (const f of parseStreamFrames(res.body)) {
        if (f.flags === 2) {
          const s = f.payload.toString('utf-8');
          if (s.trim() && s.trim() !== '{}') errors.push(s.substring(0, 200));
        } else if (f.payload.length > 0) {
          try {
            const dec = codec.decodeResponse('GetStreamingModelAPITextCompletion', f.payload);
            // CompletionDeltaMap has deltas map
            if (dec.deltas) {
              for (const [key, delta] of Object.entries(dec.deltas)) {
                if (delta.deltaText) text += delta.deltaText;
                if (delta.deltaThinking) thinking += delta.deltaThinking;
                if (delta.stopReason) stopReason = delta.stopReason;
                if (delta.usage && delta.usage.inputTokens) usage = delta.usage;
              }
            }
          } catch (e) {
            errors.push(`decode: ${e.message}`);
          }
        }
      }

      const snippet = text.substring(0, 120).replace(/\n/g, '\\n');
      const thinkSnip = thinking ? ` thinking=${thinking.length}ch` : '';
      console.log(`  [${cfg.label}]:`);
      console.log(`    text="${snippet}" (${text.length}ch)${thinkSnip}`);
      console.log(`    stop=${stopReason} ${usage ? `in=${usage.inputTokens} out=${usage.outputTokens} provider=${usage.apiProvider}` : ''}`);
      if (errors.length) console.log(`    ⚠ ${errors[0]}`);
    } catch (e) {
      console.log(`  [${cfg.label}]: ERROR ${e.message}`);
    }
    await sleep(2000);
  }

  // ========================================
  // #2: GetEmbeddings
  // ========================================
  console.log('\n━━━ #2: GetEmbeddings ━━━\n');
  
  // Look at EmbeddingsRequest structure
  try {
    // Try encoding directly
    const req = {
      request: {
        metadata: buildMeta(),
        texts: [{ text: 'Hello world' }, { text: 'Machine learning' }],
      },
      embeddingModel: 91, // MODEL_TEXT_EMBEDDING_OPENAI_ADA
    };
    
    let body;
    try {
      body = codec.encodeRequest('GetEmbeddings', req);
    } catch (e) {
      console.log(`  Encode error: ${e.message}`);
      // Try alternative structure
      body = null;
    }

    if (!body || body.length === 0) {
      console.log('  Method not registered in proto-codec. Checking proto definition...');
      
      // Try raw protobuf construction
      // GetEmbeddingsRequest { request: EmbeddingsRequest, embedding_model: Model }
      // Let's check what EmbeddingsRequest looks like
      console.log('  Skipping — need to register method first');
    } else {
      const res = await connectUnary(server,
        '/exa.api_server_pb.ApiServerService/GetEmbeddings', body);
      console.log(`  Status: ${res.status}`);
      if (res.status === 200) {
        try {
          const dec = codec.decodeResponse('GetEmbeddings', res.body);
          console.log(`  Response: ${JSON.stringify(dec).substring(0, 300)}`);
        } catch (e) {
          console.log(`  Decode error: ${e.message}`);
          console.log(`  Raw size: ${res.body.length} bytes`);
        }
      } else {
        console.log(`  Error: ${res.body.toString('utf-8').substring(0, 200)}`);
      }
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
  await sleep(1500);

  // ========================================
  // #3: GetCompletions (code autocomplete)
  // ========================================
  console.log('\n━━━ #3: GetCompletions (autocomplete) ━━━\n');
  
  try {
    // GetCompletionsRequest needs editor_state with document info
    const req = {
      metadata: buildMeta(),
      document: {
        text: 'function fibonacci(n) {\n  if (n <= 1) return n;\n  return ',
        cursorOffset: 58,
        editorLanguage: 'javascript',
        absolutePath: '/tmp/test.js',
        relativePath: 'test.js',
        lineEnding: '\n',
      },
    };
    const body = codec.encodeRequest('GetCompletions', req);
    if (body.length > 0) {
      const res = await connectUnary(server,
        '/exa.api_server_pb.ApiServerService/GetCompletions', body);
      console.log(`  Status: ${res.status}`);
      if (res.status === 200) {
        try {
          const dec = codec.decodeResponse('GetCompletions', res.body);
          console.log(`  Response: ${JSON.stringify(dec).substring(0, 300)}`);
        } catch (e) {
          console.log(`  Raw: ${res.body.toString('utf-8').substring(0, 200)}`);
        }
      } else {
        console.log(`  Error: ${res.body.toString('utf-8').substring(0, 200)}`);
      }
    } else {
      console.log('  Method not registered');
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
  await sleep(1500);

  // ========================================
  // #4: delta_thinking (Claude thinking mode)
  // ========================================
  console.log('\n━━━ #4: delta_thinking (Claude thinking) ━━━\n');
  
  // Use GetChatMessage with claude-sonnet-4-6-thinking
  {
    const req = {
      metadata: buildMeta(),
      chatMessagePrompts: [{
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: 'What is 127 * 83? Think step by step.',
      }],
      chatModelUid: 'claude-sonnet-4-6-thinking',
      requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
      cascadeId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
      toolChoice: { optionName: 'none' },
    };
    const body = codec.encodeRequest('GetChatMessage', req);
    const res = await connectStream(server,
      '/exa.api_server_pb.ApiServerService/GetChatMessage', body);
    
    let text = '', thinking = '', stopReason = '', usage = null, errors = [];
    let creditCost = 0;
    for (const f of parseStreamFrames(res.body)) {
      if (f.flags === 2) {
        const s = f.payload.toString('utf-8');
        if (s.trim() && s.trim() !== '{}') errors.push(s.substring(0, 200));
      } else if (f.payload.length > 0) {
        try {
          const dec = codec.decodeResponse('GetChatMessage', f.payload);
          if (dec.deltaText) text += dec.deltaText;
          if (dec.deltaThinking) thinking += dec.deltaThinking;
          if (dec.stopReason) stopReason = dec.stopReason;
          if (dec.usage && dec.usage.inputTokens) usage = dec.usage;
          if (dec.creditCost) creditCost = dec.creditCost;
        } catch (e) {}
      }
    }

    console.log(`  text: "${text.substring(0, 150)}" (${text.length}ch)`);
    console.log(`  thinking: "${thinking.substring(0, 150)}" (${thinking.length}ch)`);
    console.log(`  stop=${stopReason} credit_cost=${creditCost}`);
    if (usage) console.log(`  usage: in=${usage.inputTokens} out=${usage.outputTokens} cache_w=${usage.cacheWriteTokens} cache_r=${usage.cacheReadTokens} provider=${usage.apiProvider}`);
    if (errors.length) console.log(`  ⚠ ${errors[0]}`);
  }
  await sleep(2000);

  // ========================================
  // #5: GetDeepWiki
  // ========================================
  console.log('\n━━━ #5: GetDeepWiki ━━━\n');
  
  try {
    const req = {
      metadata: buildMeta(),
      requestType: 'DEEP_WIKI_REQUEST_TYPE_EXPLAIN',
      symbolName: 'GetChatMessage',
      context: 'Windsurf API endpoint for streaming chat completions',
    };
    const body = codec.encodeRequest('GetDeepWiki', req);
    if (body.length > 0) {
      const res = await connectStream(server,
        '/exa.api_server_pb.ApiServerService/GetDeepWiki', body, 30000);
      
      let text = '', errors = [];
      for (const f of parseStreamFrames(res.body)) {
        if (f.flags === 2) {
          const s = f.payload.toString('utf-8');
          if (s.trim() && s.trim() !== '{}') errors.push(s.substring(0, 200));
        } else if (f.payload.length > 0) {
          try {
            const dec = codec.decodeResponse('GetDeepWiki', f.payload);
            if (dec.response && dec.response.deltaText) text += dec.response.deltaText;
          } catch (e) {}
        }
      }
      console.log(`  text: "${text.substring(0, 200)}" (${text.length}ch)`);
      if (errors.length) console.log(`  ⚠ ${errors[0]}`);
    } else {
      console.log('  Method not registered');
    }
  } catch (e) {
    console.log(`  Error: ${e.message}`);
  }
  await sleep(1500);

  // ========================================
  // #6: Credit cost tracking
  // ========================================
  console.log('\n━━━ #6: Credit cost tracking ━━━\n');
  
  const creditModels = ['gpt-5-4-none', 'gpt-5-5-low', 'claude-sonnet-4-6', 'MODEL_CHAT_O3'];
  for (const m of creditModels) {
    const req = {
      metadata: buildMeta(),
      chatMessagePrompts: [{
        messageId: crypto.randomUUID(),
        source: 'CHAT_MESSAGE_SOURCE_USER',
        prompt: 'Say OK',
      }],
      chatModelUid: m,
      requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
      cascadeId: crypto.randomUUID(),
      promptId: crypto.randomUUID(),
      toolChoice: { optionName: 'none' },
    };
    const body = codec.encodeRequest('GetChatMessage', req);
    const res = await connectStream(server,
      '/exa.api_server_pb.ApiServerService/GetChatMessage', body);
    
    let creditCost = 0, usage = null;
    for (const f of parseStreamFrames(res.body)) {
      if (f.flags === 0 && f.payload.length > 0) {
        try {
          const dec = codec.decodeResponse('GetChatMessage', f.payload);
          if (dec.creditCost) creditCost = dec.creditCost;
          if (dec.usage && dec.usage.inputTokens) usage = dec.usage;
        } catch (e) {}
      }
    }
    console.log(`  [${m}]: credit_cost=${creditCost} ${usage ? `in=${usage.inputTokens} out=${usage.outputTokens}` : ''}`);
    await sleep(1000);
  }

  console.log('\n══════ Done ══════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
