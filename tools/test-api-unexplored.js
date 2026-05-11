#!/usr/bin/env node
/**
 * Test unexplored ApiServerService endpoints that may reveal new capabilities.
 * Focus on: WebSearch, CodeMap, WindsurfJS, Trajectories, Models, Lifeguard, etc.
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

async function testU(label, method, req) {
  try {
    const body = codec.encodeRequest(method, req);
    if (!body.length) { console.log(`  [${label}]: ⚠ not in codec`); return null; }
    const res = await connectUnary(S, `${API}/${method}`, body);
    if (res.status === 200 && res.body.length > 0) {
      try {
        const d = codec.decodeResponse(method, res.body);
        const j = JSON.stringify(d);
        console.log(`  [${label}]: ✅ ${j.substring(0, 400)}`);
        return d;
      } catch (e) {
        console.log(`  [${label}]: ✅ ${res.body.length}B`);
        return res.body;
      }
    } else if (res.status === 200) {
      console.log(`  [${label}]: ✅ empty`);
      return {};
    } else {
      console.log(`  [${label}]: ❌ ${res.status} | ${res.body.toString('utf-8').substring(0, 120)}`);
      return null;
    }
  } catch (e) {
    console.log(`  [${label}]: ERROR ${e.message}`);
    return null;
  }
}

async function testS(label, method, req) {
  try {
    const body = codec.encodeRequest(method, req);
    if (!body.length) { console.log(`  [${label}]: ⚠ not in codec`); return null; }
    const res = await connectStream(S, `${API}/${method}`, body);
    const frames = parseFrames(res.body);
    const data = frames.filter(f => f.flags === 0 && f.payload.length > 0);
    const trailer = frames.find(f => f.flags === 2);
    if (data.length > 0) {
      const results = [];
      for (const f of data.slice(0, 5)) {
        try {
          const d = codec.decodeResponse(method, f.payload);
          results.push(JSON.stringify(d).substring(0, 300));
        } catch (e) {
          results.push(`(${f.payload.length}B)`);
        }
      }
      console.log(`  [${label}]: ✅ ${data.length} frames`);
      results.forEach(r => console.log(`    ${r}`));
      return results;
    } else {
      const err = trailer ? trailer.payload.toString('utf-8') : '';
      console.log(`  [${label}]: ❌ ${err.substring(0, 120) || 'empty'}`);
      return null;
    }
  } catch (e) {
    console.log(`  [${label}]: ERROR ${e.message}`);
    return null;
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║   API Server Unexplored Endpoints                         ║');
  console.log('╚═══════════════════════════════════════════════════════════╝\n');

  // ===== 1. GetWebSearchResults =====
  console.log('━━━ 1. GetWebSearchResults ━━━');
  const wsReq = codec.getRequestType('GetWebSearchResults');
  if (wsReq) console.log(`  Fields: ${wsReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('search', 'GetWebSearchResults', {
    metadata: meta(),
    query: 'JavaScript async await tutorial',
  });
  await sleep(500);

  // ===== 2. GetWebSearchRedirect =====
  console.log('\n━━━ 2. GetWebSearchRedirect ━━━');
  const wrReq = codec.getRequestType('GetWebSearchRedirect');
  if (wrReq) console.log(`  Fields: ${wrReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('redirect', 'GetWebSearchRedirect', {
    metadata: meta(),
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript',
  });
  await sleep(500);

  // ===== 3. GetWebDocsOptions =====
  console.log('\n━━━ 3. GetWebDocsOptions ━━━');
  const wdReq = codec.getRequestType('GetWebDocsOptions');
  if (wdReq) console.log(`  Fields: ${wdReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('basic', 'GetWebDocsOptions', { metadata: meta() });
  await sleep(500);

  // ===== 4. GetModelProviders =====
  console.log('\n━━━ 4. GetModelProviders ━━━');
  await testU('basic', 'GetModelProviders', { metadata: meta() });
  await sleep(500);

  // ===== 5. GetExternalModel =====
  console.log('\n━━━ 5. GetExternalModel ━━━');
  const emReq = codec.getRequestType('GetExternalModel');
  if (emReq) console.log(`  Fields: ${emReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('basic', 'GetExternalModel', { metadata: meta() });
  await sleep(500);

  // ===== 6. GetSharedCodeMap =====
  console.log('\n━━━ 6. GetSharedCodeMap ━━━');
  const scReq = codec.getRequestType('GetSharedCodeMap');
  if (scReq) console.log(`  Fields: ${scReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('basic', 'GetSharedCodeMap', { metadata: meta() });
  await sleep(500);

  // ===== 7. GetCodeMap =====
  console.log('\n━━━ 7. GetCodeMap ━━━');
  const cmReq = codec.getRequestType('GetCodeMap');
  if (cmReq) console.log(`  Fields: ${cmReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('basic', 'GetCodeMap', { metadata: meta() });
  await sleep(500);

  // ===== 8. GetCodeMapMetadata =====
  console.log('\n━━━ 8. GetCodeMapMetadata ━━━');
  await testU('basic', 'GetCodeMapMetadata', { metadata: meta() });
  await sleep(500);

  // ===== 9. GetCompletionExamples =====
  console.log('\n━━━ 9. GetCompletionExamples ━━━');
  await testU('basic', 'GetCompletionExamples', { metadata: meta() });
  await sleep(500);

  // ===== 10. GetDefaultWorkflowTemplates =====
  console.log('\n━━━ 10. GetDefaultWorkflowTemplates ━━━');
  await testU('basic', 'GetDefaultWorkflowTemplates', { metadata: meta() });
  await sleep(500);

  // ===== 11. Ping =====
  console.log('\n━━━ 11. Ping ━━━');
  await testU('basic', 'Ping', {});
  await sleep(500);

  // ===== 12. GetSSOProviders =====
  console.log('\n━━━ 12. GetSSOProviders ━━━');
  const ssoReq = codec.getRequestType('GetSSOProviders');
  if (ssoReq) console.log(`  Fields: ${ssoReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('basic', 'GetSSOProviders', { metadata: meta() });
  await sleep(500);

  // ===== 13. FetchTrajectoryShare =====
  console.log('\n━━━ 13. FetchTrajectoryShare ━━━');
  const ftReq = codec.getRequestType('FetchTrajectoryShare');
  if (ftReq) console.log(`  Fields: ${ftReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('basic', 'FetchTrajectoryShare', { metadata: meta() });
  await sleep(500);

  // ===== 14. FetchTrajectoryShareByUser =====
  console.log('\n━━━ 14. FetchTrajectoryShareByUser ━━━');
  await testU('basic', 'FetchTrajectoryShareByUser', { metadata: meta() });
  await sleep(500);

  // ===== 15. GetExtensionStats =====
  console.log('\n━━━ 15. GetExtensionStats ━━━');
  await testU('basic', 'GetExtensionStats', { metadata: meta() });
  await sleep(500);

  // ===== 16. SupportsRemoteIndexing =====
  console.log('\n━━━ 16. SupportsRemoteIndexing ━━━');
  await testU('basic', 'SupportsRemoteIndexing', { metadata: meta() });
  await sleep(500);

  // ===== 17. GetWindsurfJSApps =====
  console.log('\n━━━ 17. GetWindsurfJSApps ━━━');
  await testU('basic', 'GetWindsurfJSApps', { metadata: meta() });
  await sleep(500);

  // ===== 18. GetDeploymentConfig =====
  console.log('\n━━━ 18. GetDeploymentConfig ━━━');
  await testU('basic', 'GetDeploymentConfig', { metadata: meta() });
  await sleep(500);

  // ===== 19. GetWindsurfJSAvailableDeployTargets =====
  console.log('\n━━━ 19. GetWindsurfJSAvailableDeployTargets ━━━');
  await testU('basic', 'GetWindsurfJSAvailableDeployTargets', { metadata: meta() });
  await sleep(500);

  // ===== 20. GenerateSyntheticRule =====
  console.log('\n━━━ 20. GenerateSyntheticRule ━━━');
  const gsrReq = codec.getRequestType('GenerateSyntheticRule');
  if (gsrReq) console.log(`  Fields: ${gsrReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('basic', 'GenerateSyntheticRule', { metadata: meta() });
  await sleep(500);

  // ===== 21. RunCodeAlignment =====
  console.log('\n━━━ 21. RunCodeAlignment ━━━');
  const rcaReq = codec.getRequestType('RunCodeAlignment');
  if (rcaReq) console.log(`  Fields: ${rcaReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('basic', 'RunCodeAlignment', { metadata: meta() });
  await sleep(500);

  // ===== 22. QueryImageForPixel =====
  console.log('\n━━━ 22. QueryImageForPixel ━━━');
  const qipReq = codec.getRequestType('QueryImageForPixel');
  if (qipReq) console.log(`  Fields: ${qipReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('basic', 'QueryImageForPixel', { metadata: meta() });
  await sleep(500);

  // ===== 23. GetDecagonAuthToken =====
  console.log('\n━━━ 23. GetDecagonAuthToken ━━━');
  await testU('basic', 'GetDecagonAuthToken', { metadata: meta() });
  await sleep(500);

  // ===== 24. IsConversationSharingBlocked =====
  console.log('\n━━━ 24. IsConversationSharingBlocked ━━━');
  await testU('basic', 'IsConversationSharingBlocked', { metadata: meta() });
  await sleep(500);

  // ===== 25. GetMQuery =====
  console.log('\n━━━ 25. GetMQuery ━━━');
  const mqReq = codec.getRequestType('GetMQuery');
  if (mqReq) console.log(`  Fields: ${mqReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  await testU('basic', 'GetMQuery', { metadata: meta(), query: 'fibonacci' });
  await sleep(500);

  // ===== 26. CreateTrajectoryShareStream =====
  console.log('\n━━━ 26. CreateTrajectoryShareStream ━━━');
  await testU('basic', 'CreateTrajectoryShareStream', { metadata: meta() });
  await sleep(500);

  // ===== 27. ListUserSharedCodeMaps =====
  console.log('\n━━━ 27. ListUserSharedCodeMaps ━━━');
  await testU('basic', 'ListUserSharedCodeMaps', { metadata: meta() });
  await sleep(500);

  // ===== 28. GetSupabaseSecret =====
  console.log('\n━━━ 28. GetSupabaseSecret ━━━');
  await testU('basic', 'GetSupabaseSecret', { metadata: meta() });

  console.log('\n══════ Done ══════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
