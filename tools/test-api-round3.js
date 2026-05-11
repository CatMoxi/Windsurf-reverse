#!/usr/bin/env node
/**
 * Round 3: Test remaining high-value API endpoints.
 * Focus: VibeAndReplace, QueryImage, GetModelProviders, ReadUrlContent,
 *        Ping, GetExternalModel, DeepWiki, and more.
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
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c), headers: res.headers }));
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
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c), headers: res.headers }));
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

async function tryUnary(name, hostname, urlPath, req) {
  try {
    const body = codec.encodeRequest(name, req);
    const res = await connectUnary(hostname, urlPath, body);
    if (res.status === 200 && res.body.length > 0) {
      const d = codec.decodeResponse(name, res.body);
      return { ok: true, data: d, status: res.status, size: res.body.length };
    }
    // Try decode error
    let errMsg = '';
    try { errMsg = JSON.parse(res.body.toString()).message || res.body.toString().substring(0, 200); } catch(e) { errMsg = res.body.toString().substring(0, 200); }
    return { ok: false, status: res.status, error: errMsg };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function tryStream(name, hostname, urlPath, req) {
  try {
    const body = codec.encodeRequest(name, req);
    const res = await connectStream(hostname, urlPath, body);
    const frames = parseFrames(res.body);
    const dataFrames = frames.filter(f => f.flags === 0 && f.payload.length > 0);
    const trailerFrames = frames.filter(f => f.flags === 2);
    
    let decoded = [];
    const respName = name; // Response type same method name
    for (const f of dataFrames) {
      try { decoded.push(codec.decodeResponse(name, f.payload)); } catch(e) {}
    }
    
    let trailer = null;
    if (trailerFrames.length > 0) {
      try { trailer = JSON.parse(trailerFrames[0].payload.toString()); } catch(e) {}
    }
    
    return { ok: decoded.length > 0 || (res.status === 200 && !trailer?.error), 
             data: decoded, trailer, status: res.status, 
             frameCount: frames.length, dataCount: dataFrames.length };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function formatResult(label, r) {
  if (r.ok) {
    console.log(`  ✅ ${label}: status=${r.status}, size=${r.size || 'stream'}`);
  } else {
    const errStr = r.error ? (typeof r.error === 'string' ? r.error : JSON.stringify(r.error)) : 'unknown';
    console.log(`  ❌ ${label}: status=${r.status || 'err'}, error=${errStr.substring(0, 120)}`);
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║   API Features Test - Round 3                    ║');
  console.log('╚═══════════════════════════════════════════════════╝\n');

  // ===== 1. GetModelProviders (empty request) =====
  console.log('━━━ 1. GetModelProviders ━━━');
  {
    const r = await tryUnary('GetModelProviders', S, `${API}/GetModelProviders`, {});
    formatResult('GetModelProviders (empty)', r);
    if (r.ok) {
      const providers = r.data.modelProviders || [];
      console.log(`  Providers (${providers.length}):`);
      providers.forEach(p => console.log(`    - ${p.displayName || p.provider}`));
    }
  }
  await sleep(500);

  // ===== 2. Ping (health check) =====
  console.log('\n━━━ 2. Ping ━━━');
  {
    const r = await tryUnary('Ping', S, `${API}/Ping`, { metadata: meta() });
    formatResult('Ping', r);
    if (r.ok) console.log(`  Response: ${JSON.stringify(r.data).substring(0, 200)}`);
  }
  await sleep(500);

  // ===== 3. QueryImageForPixel (with a simple test) =====
  console.log('\n━━━ 3. QueryImageForPixel ━━━');
  {
    const r = await tryUnary('QueryImageForPixel', S, `${API}/QueryImageForPixel`, {
      metadata: meta(),
      query: 'login button',
      imageWidth: 800,
      imageHeight: 600,
    });
    formatResult('QueryImageForPixel (no image)', r);
    if (r.ok) console.log(`  Pixel: x=${r.data.x}, y=${r.data.y}`);
  }
  await sleep(500);

  // ===== 4. ReadUrlContent =====
  console.log('\n━━━ 4. ReadUrlContent ━━━');
  {
    const r = await tryUnary('ReadUrlContent', S, `${API}/ReadUrlContent`, {
      metadata: meta(),
      url: 'https://httpbin.org/json',
    });
    formatResult('ReadUrlContent', r);
    if (r.ok) {
      const content = r.data.content || r.data.text || '';
      console.log(`  Content length: ${content.length}`);
      console.log(`  Preview: ${content.substring(0, 200)}`);
    }
  }
  await sleep(500);

  // ===== 5. GetDeepWiki =====
  console.log('\n━━━ 5. GetDeepWiki ━━━');
  {
    const r = await tryUnary('GetDeepWiki', S, `${API}/GetDeepWiki`, {
      metadata: meta(),
      repoUrl: 'https://github.com/vercel/next.js',
    });
    formatResult('GetDeepWiki', r);
    if (r.ok) console.log(`  Response: ${JSON.stringify(r.data).substring(0, 300)}`);
  }
  await sleep(500);

  // ===== 6. GetExternalModel =====
  console.log('\n━━━ 6. GetExternalModel ━━━');
  {
    const r = await tryUnary('GetExternalModel', S, `${API}/GetExternalModel`, {
      metadata: meta(),
    });
    formatResult('GetExternalModel', r);
    if (r.ok) console.log(`  Response: ${JSON.stringify(r.data).substring(0, 300)}`);
  }
  await sleep(500);

  // ===== 7. VibeAndReplace (streaming with proper fields) =====
  console.log('\n━━━ 7. GenerateVibeAndReplaceStreaming ━━━');
  {
    // Try on LS path (won't work remotely but let's see error)
    const LS = '/exa.language_server_pb.LanguageServerService';
    const r = await tryStream('GenerateVibeAndReplaceStreaming', S, `${LS}/GenerateVibeAndReplaceStreaming`, {
      metadata: meta(),
      prompt: 'Change all console.log to console.info',
      searchQuery: 'console.log',
      cascadeId: crypto.randomUUID(),
      files: [{
        fileUri: 'file:///test/example.js',
        originalContent: 'function hello() {\n  console.log("hello");\n  console.log("world");\n}\n',
        matches: ['console.log("hello")', 'console.log("world")'],
        matchLines: [2, 3],
      }],
    });
    formatResult('VibeAndReplace (LS path)', r);
    if (r.ok || r.data?.length > 0) {
      r.data.forEach((d, i) => console.log(`  Frame ${i}: ${JSON.stringify(d).substring(0, 200)}`));
    }
    if (r.trailer) console.log(`  Trailer: ${JSON.stringify(r.trailer).substring(0, 200)}`);
  }
  await sleep(500);

  // Also try API path
  console.log('\n━━━ 7b. GenerateVibeAndReplaceStreaming (API path) ━━━');
  {
    const r = await tryStream('GenerateVibeAndReplaceStreaming', S, `${API}/GenerateVibeAndReplaceStreaming`, {
      metadata: meta(),
      prompt: 'Change all console.log to console.info',
      searchQuery: 'console.log',
      cascadeId: crypto.randomUUID(),
      files: [{
        fileUri: 'file:///test/example.js',
        originalContent: 'function hello() {\n  console.log("hello");\n  console.log("world");\n}\n',
        matches: ['console.log("hello")', 'console.log("world")'],
        matchLines: [2, 3],
      }],
    });
    formatResult('VibeAndReplace (API path)', r);
    if (r.ok || r.data?.length > 0) {
      r.data.forEach((d, i) => console.log(`  Frame ${i}: ${JSON.stringify(d).substring(0, 200)}`));
    }
    if (r.trailer) console.log(`  Trailer: ${JSON.stringify(r.trailer).substring(0, 200)}`);
  }
  await sleep(500);

  // ===== 8. GetWebSearchRedirect =====
  console.log('\n━━━ 8. GetWebSearchRedirect ━━━');
  {
    const r = await tryUnary('GetWebSearchRedirect', S, `${API}/GetWebSearchRedirect`, {
      metadata: meta(),
      query: 'React hooks tutorial',
    });
    formatResult('GetWebSearchRedirect', r);
    if (r.ok) console.log(`  Response: ${JSON.stringify(r.data).substring(0, 300)}`);
  }
  await sleep(500);

  // ===== 9. GetDecagonAuthToken =====
  console.log('\n━━━ 9. GetDecagonAuthToken ━━━');
  {
    const r = await tryUnary('GetDecagonAuthToken', S, `${API}/GetDecagonAuthToken`, {
      metadata: meta(),
    });
    formatResult('GetDecagonAuthToken', r);
    if (r.ok) console.log(`  Response: ${JSON.stringify(r.data).substring(0, 200)}`);
  }
  await sleep(500);

  // ===== 10. SupportsRemoteIndexing =====
  console.log('\n━━━ 10. SupportsRemoteIndexing ━━━');
  {
    const r = await tryUnary('SupportsRemoteIndexing', S, `${API}/SupportsRemoteIndexing`, {
      metadata: meta(),
    });
    formatResult('SupportsRemoteIndexing', r);
    if (r.ok) console.log(`  Response: ${JSON.stringify(r.data).substring(0, 200)}`);
  }
  await sleep(500);

  // ===== 11. GetTeamOidcProviders =====
  console.log('\n━━━ 11. GetTeamOidcProviders ━━━');
  {
    const r = await tryUnary('GetTeamOidcProviders', S, `${API}/GetTeamOidcProviders`, {
      metadata: meta(),
    });
    formatResult('GetTeamOidcProviders', r);
    if (r.ok) console.log(`  Providers: ${JSON.stringify(r.data).substring(0, 200)}`);
  }
  await sleep(500);

  // ===== 12. FetchTrajectoryShare =====
  console.log('\n━━━ 12. FetchTrajectoryShare ━━━');
  {
    const r = await tryUnary('FetchTrajectoryShare', S, `${API}/FetchTrajectoryShare`, {
      metadata: meta(),
      shareId: 'test-share-id',
    });
    formatResult('FetchTrajectoryShare', r);
    if (r.ok) console.log(`  Response: ${JSON.stringify(r.data).substring(0, 200)}`);
  }
  await sleep(500);

  // ===== 13. ListUserSharedCodeMaps =====
  console.log('\n━━━ 13. ListUserSharedCodeMaps ━━━');
  {
    const r = await tryUnary('ListUserSharedCodeMaps', S, `${API}/ListUserSharedCodeMaps`, {
      metadata: meta(),
    });
    formatResult('ListUserSharedCodeMaps', r);
    if (r.ok) console.log(`  CodeMaps: ${JSON.stringify(r.data).substring(0, 300)}`);
  }
  await sleep(500);

  // ===== 14. GetExternalModels (plural) =====
  console.log('\n━━━ 14. GetExternalModels ━━━');
  {
    const r = await tryUnary('GetExternalModels', S, `${API}/GetExternalModels`, {
      metadata: meta(),
    });
    formatResult('GetExternalModels', r);
    if (r.ok) console.log(`  Response: ${JSON.stringify(r.data).substring(0, 300)}`);
  }
  await sleep(500);

  // ===== 15. GetUserAllowlist =====
  console.log('\n━━━ 15. GetUserAllowlist ━━━');
  {
    const r = await tryUnary('GetUserAllowlist', S, `${API}/GetUserAllowlist`, {
      metadata: meta(),
    });
    formatResult('GetUserAllowlist', r);
    if (r.ok) console.log(`  Allowlist: ${JSON.stringify(r.data).substring(0, 300)}`);
  }
  await sleep(500);

  // ===== 16. AssignArenaModel =====
  console.log('\n━━━ 16. AssignArenaModel ━━━');
  {
    const r = await tryUnary('AssignArenaModel', S, `${API}/AssignArenaModel`, {
      metadata: meta(),
      arenaTier: 'ARENA_TIER_SMART',
    });
    formatResult('AssignArenaModel', r);
    if (r.ok) console.log(`  Response: ${JSON.stringify(r.data).substring(0, 300)}`);
  }
  await sleep(500);

  // ===== 17. GetSharedCodeMap =====
  console.log('\n━━━ 17. GetSharedCodeMap ━━━');
  {
    const r = await tryUnary('GetSharedCodeMap', S, `${API}/GetSharedCodeMap`, {
      metadata: meta(),
      shareId: 'test-share-id',
    });
    formatResult('GetSharedCodeMap', r);
    if (r.ok) console.log(`  Response: ${JSON.stringify(r.data).substring(0, 200)}`);
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Round 3 complete!');
  console.log('═══════════════════════════════════════════════════');
}

main().catch(e => console.error('Fatal:', e));
