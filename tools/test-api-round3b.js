#!/usr/bin/env node
/**
 * Round 3b: Fix and re-test specific endpoints with correct params.
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
      headers: { 'Content-Type': 'application/proto', 'Connect-Protocol-Version': '1', 'Content-Length': body.length },
    }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c), ct: res.headers['content-type'] }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
    req.write(body);
    req.end();
  });
}

const meta = () => ({
  apiKey, ideName: 'windsurf', ideVersion: '2.5.0',
  extensionVersion: '2.5.0', sessionId: crypto.randomUUID(),
  requestId: Math.floor(Math.random() * 1e9), locale: 'en_US',
});

const S = 'server.self-serve.windsurf.com';
const API = '/exa.api_server_pb.ApiServerService';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Round 3b: Corrected tests ===\n');

  // 1. Ping (no metadata needed)
  console.log('--- 1. Ping ---');
  {
    const body = codec.encodeRequest('Ping', { workDurationMs: 0 });
    const res = await connectUnary(S, `${API}/Ping`, body);
    console.log(`  Status: ${res.status}, CT: ${res.ct}, BodyLen: ${res.body.length}`);
    if (res.status === 200 && res.body.length > 0) {
      try {
        const d = codec.decodeResponse('Ping', res.body);
        console.log(`  ✅ Ping: latency_ms=${d.latencyMs}`);
      } catch(e) {
        console.log(`  Body (raw): ${res.body.toString('hex').substring(0, 40)}`);
      }
    } else if (res.status === 200) {
      console.log(`  ✅ Ping: empty response (success, 0ms latency)`);
    }
  }
  await sleep(500);

  // 2. AssignArenaModel (with arena_id and cascade_ids)
  console.log('\n--- 2. AssignArenaModel ---');
  {
    const cascadeId = crypto.randomUUID();
    const body = codec.encodeRequest('AssignArenaModel', {
      metadata: meta(),
      arenaId: crypto.randomUUID(),
      cascadeIds: [cascadeId],
      arenaTier: 'ARENA_TIER_SMART',
    });
    const res = await connectUnary(S, `${API}/AssignArenaModel`, body);
    console.log(`  Status: ${res.status}`);
    if (res.status === 200 && res.body.length > 0) {
      const d = codec.decodeResponse('AssignArenaModel', res.body);
      console.log(`  ✅ ArenaModel assignments:`, JSON.stringify(d).substring(0, 500));
    } else {
      let err = '';
      try { err = res.body.toString(); } catch(e) {}
      console.log(`  ❌ ${err.substring(0, 200)}`);
    }
  }
  await sleep(500);

  // 3. GetWebSearchRedirect (original_url, not query)
  console.log('\n--- 3. GetWebSearchRedirect ---');
  {
    const body = codec.encodeRequest('GetWebSearchRedirect', {
      originalUrl: 'https://stackoverflow.com/questions/12345',
    });
    const res = await connectUnary(S, `${API}/GetWebSearchRedirect`, body);
    console.log(`  Status: ${res.status}`);
    if (res.status === 200 && res.body.length > 0) {
      const d = codec.decodeResponse('GetWebSearchRedirect', res.body);
      console.log(`  ✅ Redirect URL: ${d.redirectUrl}`);
    } else {
      console.log(`  ❌ ${res.body.toString().substring(0, 200)}`);
    }
  }
  await sleep(500);

  // 4. FetchTrajectoryShare with metadata's apiKey in auth header
  console.log('\n--- 4. FetchTrajectoryShare ---');
  {
    const body = codec.encodeRequest('FetchTrajectoryShare', {
      metadata: meta(),
      shareId: crypto.randomUUID(),
    });
    const res = await connectUnary(S, `${API}/FetchTrajectoryShare`, body);
    console.log(`  Status: ${res.status}`);
    if (res.status === 200) {
      const d = codec.decodeResponse('FetchTrajectoryShare', res.body);
      console.log(`  ✅ Response: ${JSON.stringify(d).substring(0, 300)}`);
    } else {
      console.log(`  ❌ ${res.body.toString().substring(0, 200)}`);
    }
  }
  await sleep(500);

  // 5. GetModelProviders — print full details with enum values
  console.log('\n--- 5. GetModelProviders (full) ---');
  {
    const body = codec.encodeRequest('GetModelProviders', {});
    const res = await connectUnary(S, `${API}/GetModelProviders`, body);
    if (res.status === 200) {
      const d = codec.decodeResponse('GetModelProviders', res.body);
      console.log(`  ✅ ${d.modelProviders.length} providers:`);
      d.modelProviders.forEach(p => {
        console.log(`    provider=${p.provider} (enum), displayName="${p.displayName}"`);
      });
    }
  }
  await sleep(500);

  // 6. GetDeepWiki (try as streaming)
  console.log('\n--- 6. GetDeepWiki (streaming) ---');
  {
    const body = codec.encodeRequest('GetDeepWiki', {
      metadata: meta(),
      repoUrl: 'https://github.com/vercel/next.js',
    });
    // Frame it for streaming
    const hdr = Buffer.alloc(5);
    hdr.writeUInt32BE(body.length, 1);
    const framed = Buffer.concat([hdr, body]);
    const res = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: S, port: 443, path: `${API}/GetDeepWiki`, method: 'POST',
        headers: { 'Content-Type': 'application/connect+proto', 'Connect-Protocol-Version': '1', 'Content-Length': framed.length },
      }, res => {
        const c = [];
        res.on('data', d => c.push(d));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c), ct: res.headers['content-type'] }));
      });
      req.on('error', reject);
      req.setTimeout(30000, () => req.destroy(new Error('Timeout')));
      req.write(framed);
      req.end();
    });
    console.log(`  Status: ${res.status}, CT: ${res.ct}`);
    if (res.status === 200) {
      // Parse frames
      let pos = 0;
      const buf = res.body;
      while (pos + 5 <= buf.length) {
        const flags = buf[pos];
        const len = buf.readUInt32BE(pos + 1);
        pos += 5;
        if (pos + len > buf.length) break;
        const payload = buf.subarray(pos, pos + len);
        if (flags === 0 && payload.length > 0) {
          try {
            const d = codec.decodeResponse('GetDeepWiki', payload);
            console.log(`  Frame (data): ${JSON.stringify(d).substring(0, 200)}`);
          } catch(e) {
            console.log(`  Frame (raw ${payload.length}B): ${payload.toString('hex').substring(0, 40)}`);
          }
        } else if (flags === 2) {
          try { console.log(`  Trailer: ${JSON.parse(payload.toString())}`); } catch(e) { console.log(`  Trailer: ${payload.toString().substring(0, 100)}`); }
        }
        pos += len;
      }
    } else {
      console.log(`  ❌ ${res.body.toString().substring(0, 200)}`);
    }
  }
  await sleep(500);

  // 7. GetCodeMap & GetCodeMapMetadata (shared code maps)
  console.log('\n--- 7. GetCodeMap ---');
  {
    const body = codec.encodeRequest('GetCodeMap', {
      metadata: meta(),
      shareId: 'test-share',
    });
    const res = await connectUnary(S, `${API}/GetCodeMap`, body);
    console.log(`  Status: ${res.status}`);
    if (res.status === 200) {
      const d = codec.decodeResponse('GetCodeMap', res.body);
      console.log(`  ✅ Response: ${JSON.stringify(d).substring(0, 200)}`);
    } else {
      console.log(`  ❌ ${res.body.toString().substring(0, 200)}`);
    }
  }
  await sleep(500);

  // 8. GetMcpRegistryServers
  console.log('\n--- 8. GetMcpRegistryServers ---');
  {
    try {
      const body = codec.encodeRequest('GetMcpRegistryServers', { metadata: meta() });
      const res = await connectUnary(S, `${API}/GetMcpRegistryServers`, body);
      console.log(`  Status: ${res.status}`);
      if (res.status === 200) {
        const d = codec.decodeResponse('GetMcpRegistryServers', res.body);
        console.log(`  ✅ Response: ${JSON.stringify(d).substring(0, 400)}`);
      } else {
        console.log(`  ❌ ${res.body.toString().substring(0, 200)}`);
      }
    } catch(e) {
      console.log(`  ❌ codec error: ${e.message}`);
    }
  }
  await sleep(500);

  // 9. ApplyTrajectoryHeuristics
  console.log('\n--- 9. ApplyTrajectoryHeuristics ---');
  {
    try {
      const body = codec.encodeRequest('ApplyTrajectoryHeuristics', { metadata: meta() });
      const res = await connectUnary(S, `${API}/ApplyTrajectoryHeuristics`, body);
      console.log(`  Status: ${res.status}`);
      if (res.status === 200 && res.body.length > 0) {
        const d = codec.decodeResponse('ApplyTrajectoryHeuristics', res.body);
        console.log(`  ✅ Response: ${JSON.stringify(d).substring(0, 400)}`);
      } else if (res.status === 200) {
        console.log(`  ✅ Empty response (success)`);
      } else {
        console.log(`  ❌ ${res.body.toString().substring(0, 200)}`);
      }
    } catch(e) {
      console.log(`  ❌ codec error: ${e.message}`);
    }
  }

  console.log('\n=== Round 3b complete! ===');
}

main().catch(e => console.error('Fatal:', e));
