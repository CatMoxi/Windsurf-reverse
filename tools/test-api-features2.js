#!/usr/bin/env node
/**
 * Deep test newly discovered working API endpoints.
 * Focus: WebSearch advanced, QueryImage, ReadUrlContent, VibeAndReplace, etc.
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
    req.setTimeout(60000, () => req.destroy(new Error('Timeout')));
    req.write(framed);
    req.end();
  });
}

function parseFrames(buf) {
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

const meta = () => ({
  apiKey, ideName: 'windsurf', ideVersion: '2.5.0',
  extensionVersion: '2.5.0', sessionId: crypto.randomUUID(),
  requestId: Math.floor(Math.random() * 1e9), locale: 'en_US',
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const S = 'server.self-serve.windsurf.com';
const API = '/exa.api_server_pb.ApiServerService';

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   API Features Deep Test Round 2                           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // ===== 1. WebSearch — Chinese query =====
  console.log('━━━ 1. WebSearch (Chinese) ━━━');
  {
    const body = codec.encodeRequest('GetWebSearchResults', {
      metadata: meta(), query: 'React useState hook 教程',
    });
    const res = await connectUnary(S, `${API}/GetWebSearchResults`, body);
    const d = codec.decodeResponse('GetWebSearchResults', res.body);
    console.log(`  Results: ${d.results?.length || 0}`);
    (d.results || []).forEach((r, i) => {
      console.log(`  [${i}] ${r.title} — ${r.url}`);
    });
  }
  await sleep(1000);

  // ===== 2. WebSearch — code search =====
  console.log('\n━━━ 2. WebSearch (code search) ━━━');
  {
    const body = codec.encodeRequest('GetWebSearchResults', {
      metadata: meta(), query: 'grpc-web connect-rpc protobuf typescript',
    });
    const res = await connectUnary(S, `${API}/GetWebSearchResults`, body);
    const d = codec.decodeResponse('GetWebSearchResults', res.body);
    console.log(`  Results: ${d.results?.length || 0}, webSearchUrl: ${d.webSearchUrl}`);
    (d.results || []).forEach((r, i) => {
      console.log(`  [${i}] ${r.title?.substring(0, 60)} — ${r.url}`);
    });
  }
  await sleep(1000);

  // ===== 3. GetLifeguardConfig — detailed =====
  console.log('\n━━━ 3. GetLifeguardConfig ━━━');
  {
    const body = codec.encodeRequest('GetLifeguardConfig', { metadata: meta() });
    const res = await connectUnary(S, `${API}/GetLifeguardConfig`, body);
    const d = codec.decodeResponse('GetLifeguardConfig', res.body);
    console.log(`  Full:`, JSON.stringify(d, null, 2));
  }
  await sleep(500);

  // ===== 4. GenerateSyntheticRule =====
  console.log('\n━━━ 4. GenerateSyntheticRule ━━━');
  {
    const body = codec.encodeRequest('GenerateSyntheticRule', {
      metadata: meta(),
      commentBody: 'Always use TypeScript strict mode',
      fileContent: 'const x = 5;\nfunction foo(a) { return a; }',
      lineNumber: 1,
    });
    const res = await connectUnary(S, `${API}/GenerateSyntheticRule`, body);
    if (res.status === 200 && res.body.length > 0) {
      const d = codec.decodeResponse('GenerateSyntheticRule', res.body);
      console.log(`  Result:`, JSON.stringify(d, null, 2).substring(0, 500));
    } else {
      console.log(`  ${res.status}: ${res.body.toString('utf-8').substring(0, 200)}`);
    }
  }
  await sleep(500);

  // ===== 5. RunCodeAlignment =====
  console.log('\n━━━ 5. RunCodeAlignment ━━━');
  {
    const body = codec.encodeRequest('RunCodeAlignment', {
      metadata: meta(),
      fileContent: 'function add(a, b) {\n  return a + b\n}',
      offset: 10,
    });
    const res = await connectUnary(S, `${API}/RunCodeAlignment`, body);
    if (res.status === 200 && res.body.length > 0) {
      const d = codec.decodeResponse('RunCodeAlignment', res.body);
      console.log(`  Result:`, JSON.stringify(d, null, 2).substring(0, 500));
    } else {
      console.log(`  ${res.status}: ${res.body.toString('utf-8').substring(0, 200)}`);
    }
  }
  await sleep(500);

  // ===== 6. GetCascadeModelConfigsForSite =====
  console.log('\n━━━ 6. GetCascadeModelConfigsForSite ━━━');
  {
    const body = codec.encodeRequest('GetCascadeModelConfigsForSite', { metadata: meta() });
    const res = await connectUnary(S, `${API}/GetCascadeModelConfigsForSite`, body);
    if (res.status === 200 && res.body.length > 0) {
      const d = codec.decodeResponse('GetCascadeModelConfigsForSite', res.body);
      const count = d.clientModelConfigs?.length || 0;
      console.log(`  Models: ${count}`);
      if (count > 0) {
        (d.clientModelConfigs || []).slice(0, 5).forEach(m => {
          console.log(`    ${m.modelUid}: ${m.label} (${m.provider})`);
        });
      }
    } else {
      console.log(`  ${res.status}: ${res.body.toString('utf-8').substring(0, 200)}`);
    }
  }
  await sleep(500);

  // ===== 7. GetCliModelConfigs — detailed parse =====
  console.log('\n━━━ 7. GetCliModelConfigs (detailed) ━━━');
  {
    const body = codec.encodeRequest('GetCliModelConfigs', { metadata: meta() });
    const res = await connectUnary(S, `${API}/GetCliModelConfigs`, body);
    const d = codec.decodeResponse('GetCliModelConfigs', res.body);
    const models = d.clientModelConfigs || [];
    console.log(`  CLI Models: ${models.length}`);
    models.slice(0, 10).forEach(m => {
      const features = [];
      if (m.supportsImages) features.push('img');
      if (m.modelInfo?.modelFeatures?.supportsToolCalls) features.push('tools');
      if (m.modelInfo?.modelFeatures?.supportsThinking) features.push('think');
      console.log(`    ${m.modelUid}: ${m.label} | credit=${m.creditMultiplier} | ${features.join(',')} | max=${m.maxTokens}`);
    });
  }
  await sleep(500);

  // ===== 8. GetCommandModelConfigs — detailed =====
  console.log('\n━━━ 8. GetCommandModelConfigs (detailed) ━━━');
  {
    const body = codec.encodeRequest('GetCommandModelConfigs', { metadata: meta() });
    const res = await connectUnary(S, `${API}/GetCommandModelConfigs`, body);
    const d = codec.decodeResponse('GetCommandModelConfigs', res.body);
    const models = d.clientModelConfigs || [];
    console.log(`  Command Models: ${models.length}`);
    models.forEach(m => {
      console.log(`    ${m.modelUid}: ${m.label} | credit=${m.creditMultiplier} | provider=${m.provider}`);
    });
  }
  await sleep(500);

  // ===== 9. VibeAndReplace with actual content =====
  console.log('\n━━━ 9. GenerateVibeAndReplaceStreaming ━━━');
  {
    const body = codec.encodeRequest('GenerateVibeAndReplaceStreaming', {
      metadata: meta(),
      prompt: 'Make this a dark theme landing page',
      cascadeId: crypto.randomUUID(),
      modelUidForGeneration: 'gpt-5-5-low',
      files: [{
        path: 'index.html',
        content: '<html><body><h1>Hello</h1></body></html>',
      }],
    });
    const res = await connectStream(S, `${API}/GenerateVibeAndReplaceStreaming`, body);
    const frames = parseFrames(res.body);
    const data = frames.filter(f => f.flags === 0 && f.payload.length > 0);
    const trailer = frames.find(f => f.flags === 2);
    if (data.length > 0) {
      console.log(`  ✅ ${data.length} frames`);
      for (const f of data.slice(0, 3)) {
        try {
          const d = codec.decodeResponse('GenerateVibeAndReplaceStreaming', f.payload);
          console.log(`    ${JSON.stringify(d).substring(0, 200)}`);
        } catch (e) {
          console.log(`    (${f.payload.length}B decode err)`);
        }
      }
    } else {
      const err = trailer ? trailer.payload.toString('utf-8') : 'empty';
      console.log(`  ❌ ${err.substring(0, 200)}`);
    }
  }
  await sleep(500);

  // ===== 10. GetTeamOrganizationalControlsForSite =====
  console.log('\n━━━ 10. GetTeamOrganizationalControlsForSite ━━━');
  {
    const body = codec.encodeRequest('GetTeamOrganizationalControlsForSite', { metadata: meta() });
    const res = await connectUnary(S, `${API}/GetTeamOrganizationalControlsForSite`, body);
    if (res.status === 200 && res.body.length > 0) {
      const d = codec.decodeResponse('GetTeamOrganizationalControlsForSite', res.body);
      console.log(`  ✅`, JSON.stringify(d, null, 2).substring(0, 500));
    } else {
      console.log(`  ❌ ${res.status}: ${res.body.toString('utf-8').substring(0, 200)}`);
    }
  }

  console.log('\n══════ Done ══════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
