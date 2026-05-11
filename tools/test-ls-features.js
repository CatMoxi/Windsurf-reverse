#!/usr/bin/env node
/**
 * Test unexplored LS feature endpoints on API server.
 * Focus: SystemPrompt, Memories, Knowledge Base, Workflows, Rules, Skills,
 *        CodeMap, MCP Registry, Arena, Trajectories, VibeAndReplace
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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
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
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(c) }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('Timeout')));
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

const SERVER = 'server.self-serve.windsurf.com';
const API = '/exa.api_server_pb.ApiServerService';
const LS = '/exa.language_server_pb.LanguageServerService';

// Try both API and LS paths
async function testUnary(label, method, reqObj, paths) {
  for (const p of paths) {
    const tag = p.includes('ApiServer') ? 'API' : 'LS';
    try {
      const body = codec.encodeRequest(method, reqObj);
      if (body.length === 0) {
        console.log(`  [${label}|${tag}]: ⚠ method not in codec`);
        continue;
      }
      const res = await connectUnary(SERVER, p, body);
      if (res.status === 200 && res.body.length > 0) {
        try {
          const d = codec.decodeResponse(method, res.body);
          const j = JSON.stringify(d);
          if (j === '{}') {
            console.log(`  [${label}|${tag}]: ✅ empty {}`);
          } else {
            console.log(`  [${label}|${tag}]: ✅ ${j.substring(0, 500)}`);
          }
        } catch (e) {
          console.log(`  [${label}|${tag}]: ✅ ${res.body.length}B (decode err: ${e.message.substring(0, 50)})`);
        }
      } else if (res.status === 200 && res.body.length === 0) {
        console.log(`  [${label}|${tag}]: ✅ empty response`);
      } else {
        const err = res.body.toString('utf-8').substring(0, 150);
        console.log(`  [${label}|${tag}]: ❌ HTTP ${res.status} | ${err}`);
      }
    } catch (e) {
      console.log(`  [${label}|${tag}]: ERROR ${e.message}`);
    }
    await sleep(300);
  }
}

async function testStream(label, method, reqObj, p) {
  try {
    const body = codec.encodeRequest(method, reqObj);
    if (body.length === 0) {
      console.log(`  [${label}]: ⚠ method not in codec`);
      return;
    }
    const tag = p.includes('ApiServer') ? 'API' : 'LS';
    const res = await connectStream(SERVER, p, body);
    const frames = parseStreamFrames(res.body);
    const data = frames.filter(f => f.flags === 0 && f.payload.length > 0);
    const trailer = frames.find(f => f.flags === 2);
    const errText = trailer ? trailer.payload.toString('utf-8') : '';
    
    if (data.length > 0) {
      let combined = '';
      for (const f of data) {
        try {
          const d = codec.decodeResponse(method, f.payload);
          combined += JSON.stringify(d).substring(0, 300) + '\n';
        } catch (e) {
          combined += `(${f.payload.length}B decode err)\n`;
        }
      }
      console.log(`  [${label}|${tag}]: ✅ ${data.length} frames`);
      for (const line of combined.split('\n').filter(l => l).slice(0, 5)) {
        console.log(`    ${line}`);
      }
    } else {
      console.log(`  [${label}|${tag}]: ❌ ${errText.substring(0, 150) || 'empty'}`);
    }
  } catch (e) {
    console.log(`  [${label}]: ERROR ${e.message}`);
  }
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║   LS Feature Endpoints Deep Test                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  const meta = buildMeta();

  // ========== 1. GetSystemPromptAndTools ==========
  console.log('━━━ 1. GetSystemPromptAndTools ━━━');
  await testUnary('basic', 'GetSystemPromptAndTools', {
    metadata: meta,
  }, [`${API}/GetSystemPromptAndTools`, `${LS}/GetSystemPromptAndTools`]);
  
  // With CascadeConfig
  await testUnary('with config', 'GetSystemPromptAndTools', {
    metadata: meta,
    cascadeConfig: {},
  }, [`${API}/GetSystemPromptAndTools`]);
  await sleep(500);

  // ========== 2. GetCascadeMemories ==========
  console.log('\n━━━ 2. GetCascadeMemories ━━━');
  await testUnary('basic', 'GetCascadeMemories', {},
    [`${API}/GetCascadeMemories`, `${LS}/GetCascadeMemories`]);
  await testUnary('with meta', 'GetCascadeMemories', { metadata: meta },
    [`${API}/GetCascadeMemories`]);
  await sleep(500);

  // ========== 3. GetUserMemories ==========
  console.log('\n━━━ 3. GetUserMemories ━━━');
  await testUnary('basic', 'GetUserMemories', {},
    [`${API}/GetUserMemories`, `${LS}/GetUserMemories`]);
  await testUnary('with meta', 'GetUserMemories', { metadata: meta },
    [`${API}/GetUserMemories`]);
  await sleep(500);

  // ========== 4. GetKnowledgeBaseItemsForTeam ==========
  console.log('\n━━━ 4. GetKnowledgeBaseItemsForTeam ━━━');
  await testUnary('basic', 'GetKnowledgeBaseItemsForTeam', {
    metadata: meta,
  }, [`${API}/GetKnowledgeBaseItemsForTeam`, `${LS}/GetKnowledgeBaseItemsForTeam`]);
  await sleep(500);

  // ========== 5. GetAllWorkflows ==========
  console.log('\n━━━ 5. GetAllWorkflows ━━━');
  await testUnary('basic', 'GetAllWorkflows', {},
    [`${API}/GetAllWorkflows`, `${LS}/GetAllWorkflows`]);
  await testUnary('with meta', 'GetAllWorkflows', { metadata: meta },
    [`${API}/GetAllWorkflows`]);
  await sleep(500);

  // ========== 6. GetAllRules ==========
  console.log('\n━━━ 6. GetAllRules ━━━');
  await testUnary('basic', 'GetAllRules', {},
    [`${API}/GetAllRules`, `${LS}/GetAllRules`]);
  await testUnary('with meta', 'GetAllRules', { metadata: meta },
    [`${API}/GetAllRules`]);
  await sleep(500);

  // ========== 7. GetAllSkills ==========
  console.log('\n━━━ 7. GetAllSkills ━━━');
  await testUnary('basic', 'GetAllSkills', {},
    [`${API}/GetAllSkills`, `${LS}/GetAllSkills`]);
  await sleep(500);

  // ========== 8. GetAllPlans ==========
  console.log('\n━━━ 8. GetAllPlans ━━━');
  await testUnary('basic', 'GetAllPlans', {},
    [`${API}/GetAllPlans`, `${LS}/GetAllPlans`]);
  await sleep(500);

  // ========== 9. GetConversationTags ==========
  console.log('\n━━━ 9. GetConversationTags ━━━');
  await testUnary('basic', 'GetConversationTags', {},
    [`${API}/GetConversationTags`, `${LS}/GetConversationTags`]);
  await testUnary('with meta', 'GetConversationTags', { metadata: meta },
    [`${API}/GetConversationTags`]);
  await sleep(500);

  // ========== 10. GenerateVibeAndReplaceStreaming ==========
  console.log('\n━━━ 10. GenerateVibeAndReplaceStreaming ━━━');
  // Check proto fields first
  const vibeReq = codec.getRequestType('GenerateVibeAndReplaceStreaming');
  if (vibeReq) {
    console.log(`  Fields: ${vibeReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  }
  await testStream('basic', 'GenerateVibeAndReplaceStreaming', {
    metadata: meta,
  }, `${API}/GenerateVibeAndReplaceStreaming`);
  await sleep(500);

  // ========== 11. GetCodeMapsForRepos ==========
  console.log('\n━━━ 11. GetCodeMapsForRepos ━━━');
  await testUnary('basic', 'GetCodeMapsForRepos', {
    metadata: meta,
  }, [`${API}/GetCodeMapsForRepos`, `${LS}/GetCodeMapsForRepos`]);
  await sleep(500);

  // ========== 12. GetMcpRegistryServers ==========
  console.log('\n━━━ 12. GetMcpRegistryServers ━━━');
  await testUnary('basic', 'GetMcpRegistryServers', {},
    [`${API}/GetMcpRegistryServers`, `${LS}/GetMcpRegistryServers`]);
  await testUnary('with meta', 'GetMcpRegistryServers', { metadata: meta },
    [`${API}/GetMcpRegistryServers`]);
  await sleep(500);

  // ========== 13. GetAllAcpRegistries ==========
  console.log('\n━━━ 13. GetAllAcpRegistries ━━━');
  await testUnary('basic', 'GetAllAcpRegistries', {},
    [`${API}/GetAllAcpRegistries`, `${LS}/GetAllAcpRegistries`]);
  await testUnary('with meta', 'GetAllAcpRegistries', { metadata: meta },
    [`${API}/GetAllAcpRegistries`]);
  await sleep(500);

  // ========== 14. GetAllCascadeTrajectories ==========
  console.log('\n━━━ 14. GetAllCascadeTrajectories ━━━');
  await testUnary('basic', 'GetAllCascadeTrajectories', {},
    [`${API}/GetAllCascadeTrajectories`, `${LS}/GetAllCascadeTrajectories`]);
  await testUnary('with meta', 'GetAllCascadeTrajectories', { metadata: meta },
    [`${API}/GetAllCascadeTrajectories`]);
  await sleep(500);

  // ========== 15. CreateTrajectoryShare ==========
  console.log('\n━━━ 15. CreateTrajectoryShare ━━━');
  await testUnary('basic', 'CreateTrajectoryShare', {
    metadata: meta,
  }, [`${API}/CreateTrajectoryShare`, `${LS}/CreateTrajectoryShare`]);
  await sleep(500);

  // ========== 16. SpawnArenaModeMidConversation ==========
  console.log('\n━━━ 16. SpawnArenaModeMidConversation ━━━');
  await testUnary('basic', 'SpawnArenaModeMidConversation', {
    metadata: meta,
    cascadeId: crypto.randomUUID(),
  }, [`${API}/SpawnArenaModeMidConversation`, `${LS}/SpawnArenaModeMidConversation`]);
  await sleep(500);

  // ========== 17. GenerateCommitMessage ==========
  console.log('\n━━━ 17. GenerateCommitMessage ━━━');
  const commitReq = codec.getRequestType('GenerateCommitMessage');
  if (commitReq) {
    console.log(`  Fields: ${commitReq.fieldsArray.map(f => `${f.name}(${f.id})`).join(', ')}`);
  }
  await testUnary('basic', 'GenerateCommitMessage', {
    metadata: meta,
    diff: 'diff --git a/test.js b/test.js\n+console.log("hello");',
  }, [`${API}/GenerateCommitMessage`, `${LS}/GenerateCommitMessage`]);
  await sleep(500);

  // ========== 18. GetWebDocsOptions ==========
  console.log('\n━━━ 18. GetWebDocsOptions ━━━');
  await testUnary('basic', 'GetWebDocsOptions', {},
    [`${API}/GetWebDocsOptions`, `${LS}/GetWebDocsOptions`]);
  await sleep(500);

  // ========== 19. CheckBugs ==========
  console.log('\n━━━ 19. CheckBugs ━━━');
  await testUnary('basic', 'CheckBugs', { metadata: meta },
    [`${API}/CheckBugs`, `${LS}/CheckBugs`]);
  await sleep(500);

  // ========== 20. GetLifeguardConfig ==========
  console.log('\n━━━ 20. GetLifeguardConfig ━━━');
  await testUnary('basic', 'GetLifeguardConfig', { metadata: meta },
    [`${API}/GetLifeguardConfig`, `${LS}/GetLifeguardConfig`]);
  await sleep(500);

  // ========== 21. GetChangelog ==========
  console.log('\n━━━ 21. GetChangelog ━━━');
  await testUnary('basic', 'GetChangelog', { metadata: meta },
    [`${API}/GetChangelog`, `${LS}/GetChangelog`]);

  // ========== 22. GetCliModelConfigs (on API) ==========
  console.log('\n━━━ 22. GetCliModelConfigs ━━━');
  await testUnary('basic', 'GetCliModelConfigs', { metadata: meta },
    [`${API}/GetCliModelConfigs`]);

  console.log('\n══════ Done ══════');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
