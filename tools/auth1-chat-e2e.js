#!/usr/bin/env node
/**
 * End-to-end: Auth1 → RegisterUser → Chat test.
 * Performs full 4-step login, immediately uses the fresh api_key to chat.
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const LS_DIR = path.join(__dirname, '..', 'src', 'language-server');
const codec = require(path.join(LS_DIR, 'proto-codec'));

// Import auth1-login functions by running inline
const POST_AUTH_URL = 'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth';
const GET_CURRENT_USER_URL = 'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetCurrentUser';
const GET_ONE_TIME_AUTH_TOKEN_URL = 'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken';
const REGISTER_USER_URL = 'https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser';

const TOKEN = process.argv[2];
if (!TOKEN || !TOKEN.startsWith('auth1_')) {
  console.error('Usage: node tools/auth1-chat-e2e.js auth1_xxxxxxxx');
  process.exit(1);
}

console.log('╔════════════════════════════════════════════════════╗');
console.log('║   Auth1 → Chat End-to-End Test                    ║');
console.log('╚════════════════════════════════════════════════════╝');
console.log(`  Token: ${TOKEN.substring(0, 15)}...${TOKEN.slice(-4)}\n`);

async function main() {
  // Step 1: PostAuth
  console.log('  [1/5] WindsurfPostAuth...');
  const postAuth = await postAuthCall(TOKEN);
  console.log(`    ✓ session: ${postAuth.sessionToken.substring(0, 25)}...`);
  
  // Step 2: GetOneTimeAuthToken  
  console.log('  [2/5] GetOneTimeAuthToken...');
  const auth = {
    sessionToken: postAuth.sessionToken,
    accountId: postAuth.accountId,
    auth1Token: postAuth.auth1Token || TOKEN,
    primaryOrgId: postAuth.primaryOrgId,
  };
  const ott = await getOneTimeAuthToken(auth);
  console.log(`    ✓ ott: ${ott.substring(0, 20)}...`);
  
  // Step 3: RegisterUser
  console.log('  [3/5] RegisterUser...');
  const reg = await registerUser(ott);
  console.log(`    ✓ api_key: ${reg.apiKey.substring(0, 25)}...`);
  console.log(`    api_server: ${reg.apiServerUrl}`);
  
  const apiKey = reg.apiKey;
  const apiServer = new URL(reg.apiServerUrl).hostname;
  
  // Step 4: Test GetCascadeModelConfigs with fresh key
  console.log(`\n  [4/5] GetCascadeModelConfigs → ${apiServer}...`);
  const modelsReq = codec.encodeRequest('GetCascadeModelConfigs', {
    metadata: { apiKey, ideName: 'windsurf', ideVersion: '2.2.1017', extensionVersion: '2.2.1017' },
  });
  const r1 = await httpsPostRaw(apiServer, '/exa.api_server_pb.ApiServerService/GetCascadeModelConfigs', modelsReq, {});
  console.log(`    HTTP ${r1.status}, ${r1.body.length}b, type: ${r1.contentType}`);
  if (r1.status === 200 && r1.body.length > 0) {
    // Try both with and without envelope strip
    let decoded;
    try {
      decoded = codec.decodeResponse('GetCascadeModelConfigs', stripEnvelope(r1.body));
    } catch (e1) {
      try { decoded = codec.decodeResponse('GetCascadeModelConfigs', r1.body); } catch (e2) {
        console.log(`    Decode err: ${e1.message}`);
        console.log(`    Hex[0:40]: ${r1.body.subarray(0, 40).toString('hex')}`);
      }
    }
    if (decoded) {
      const models = decoded.modelConfigs || decoded.model_configs || [];
      console.log(`    ✓ ${models.length} model(s), keys: ${Object.keys(decoded).slice(0, 6).join(',')}`);
      if (models.length > 0) {
        for (const m of models.slice(0, 5)) {
          console.log(`      - ${m.modelName || m.model || JSON.stringify(m).substring(0, 80)}`);
        }
      } else {
        // Show first-level keys and sample values
        for (const [k, v] of Object.entries(decoded).slice(0, 5)) {
          const vs = Array.isArray(v) ? `[${v.length}]` : typeof v === 'string' ? v.substring(0,40) : JSON.stringify(v).substring(0,60);
          console.log(`      ${k}: ${vs}`);
        }
      }
    }
  } else {
    console.log(`    Body: ${r1.body.toString('utf-8').substring(0, 300)}`);
  }
  
  // Step 5: Chat - GetChatMessage (streaming via Connect-RPC)
  console.log(`\n  [5/5] GetChatMessage → ${apiServer}...`);
  const crypto = require('crypto');
  const cascadeId = crypto.randomUUID();
  const promptId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  
  // Try multiple model/version/requestType combinations
  const attempts = [
    { chatModelUid: 'gpt-5-5-low', requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE', ideVer: '2.5.0', extVer: '2.5.0' },
    { chatModelUid: 'gpt-5-5-low', requestType: 'CHAT_MESSAGE_REQUEST_TYPE_UNSPECIFIED', ideVer: '2.5.0', extVer: '2.5.0' },
    { chatModelUid: 'gpt-5-5-low', requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE', ideVer: '1.100.2', extVer: '1.100.2' },
  ];
  
  for (const attempt of attempts) {
    const chatPayloadInner = codec.encodeRequest('GetChatMessage', {
      metadata: {
        apiKey,
        ideName: 'windsurf',
        ideVersion: attempt.ideVer,
        extensionVersion: attempt.extVer,
        sessionId,
        locale: 'en_US',
        requestId: 1,
      },
      chatMessagePrompts: [
        { messageId: 'msg-1', source: 'CHAT_MESSAGE_SOURCE_USER', prompt: 'Say "Hello from Cascade!" and nothing else.' },
      ],
      chatModelName: attempt.chatModelName || '',
      chatModelUid: attempt.chatModelUid || '',
      requestType: attempt.requestType || 'CHAT_MESSAGE_REQUEST_TYPE_UNSPECIFIED',
      cascadeId,
      promptId,
    });
    
    const desc = attempt.chatModelUid || attempt.chatModelName || '(default)';
    console.log(`\n    [model=${desc}, ver=${attempt.ideVer}]`);
    
    // Wrap in envelope
    const env = Buffer.alloc(5 + chatPayloadInner.length);
    env.writeUInt8(0, 0);
    env.writeUInt32BE(chatPayloadInner.length, 1);
    chatPayloadInner.copy(env, 5);
    
    const r2 = await httpsPostStream(apiServer, '/exa.api_server_pb.ApiServerService/GetChatMessage', env, { 'Content-Type': 'application/connect+proto' });
    console.log(`    HTTP ${r2.status}, ${r2.frames.length} frame(s)`);
    
    let fullText = '';
    for (const f of r2.frames) {
      if (f.flags === 0 && f.data.length > 0) {
        try {
          const dec = codec.decodeResponse('GetChatMessage', f.data);
          if (dec.deltaText) fullText += dec.deltaText;
        } catch (e) {}
      } else if (f.flags === 2) {
        const t = f.data.toString('utf-8');
        if (t.includes('"code"')) console.log(`    Error: ${t.substring(0, 150)}`);
      }
    }
    
    if (fullText) {
      console.log(`\n    ★ AI: "${fullText.substring(0, 200)}"`);
      break;
    }
  }
}

// ================= Protobuf helpers =================
function encodeVarint(v) { const b=[]; while(v>=0x80){b.push((v&0x7F)|0x80);v>>>=7;} b.push(v&0x7F); return Buffer.from(b); }
function encodeStringField(fn, s) { const b=Buffer.from(s,'utf-8'); return Buffer.concat([Buffer.from([(fn<<3)|2]),encodeVarint(b.length),b]); }
function encodeBoolField(fn, v) { return Buffer.from([(fn<<3)|0, v?1:0]); }

function parseProtoFields(buf) {
  const fields = {};
  let i = 0;
  while (i < buf.length) {
    const [tag, c1] = decodeVarint(buf, i); i += c1;
    const fn = tag >>> 3, wt = tag & 7;
    if (wt === 0) { const [_v, c2] = decodeVarint(buf, i); i += c2; }
    else if (wt === 1) { i += 8; }
    else if (wt === 5) { i += 4; }
    else if (wt === 2) {
      const [len, c3] = decodeVarint(buf, i); i += c3;
      const raw = buf.subarray(i, i + len); i += len;
      if (!fields[fn]) fields[fn] = [];
      let str; try { str = raw.toString('utf-8'); if (!/[\x00-\x08\x0e-\x1f]/.test(str.substring(0,50))) {} else str=null; } catch(e) { str=null; }
      fields[fn].push({ str, raw: Buffer.from(raw) });
    } else break;
  }
  return fields;
}
function decodeVarint(buf, off) { let v=0,s=0,i=off; while(i<buf.length){const b=buf[i++];v|=(b&0x7F)<<s;if(!(b&0x80))return[v,i-off];s+=7;} return[v,i-off]; }
function stripEnvelope(buf) { if(buf.length>5){const l=buf.readUInt32BE(1);if((buf[0]&0x7e)===0&&l>0&&l+5<=buf.length)return buf.subarray(5,5+l);} return buf; }

// ================= HTTP helpers =================
function httpsPostBody(url, body, extraHeaders={}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, port: 443, path: u.pathname, method: 'POST',
      headers: { 'Content-Type':'application/proto','Connect-Protocol-Version':'1','Content-Length':body.length, ...extraHeaders },
    }, res => { const c=[]; res.on('data',d=>c.push(d)); res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(c)})); });
    req.on('error', reject); req.write(body); req.end();
  });
}

function httpsPostRaw(host, path, body, extraHeaders={}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, port: 443, path, method: 'POST',
      headers: { 'Content-Type':'application/proto','Connect-Protocol-Version':'1','User-Agent':'connect-es/1.4.0','Content-Length':body.length, ...extraHeaders },
    }, res => { const c=[]; res.on('data',d=>c.push(d)); res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(c),contentType:res.headers['content-type']||''})); });
    req.on('error', reject); req.setTimeout(15000, ()=>req.destroy(new Error('timeout'))); req.write(body); req.end();
  });
}

function httpsPostStream(host, path, body, extraHeaders={}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, port: 443, path, method: 'POST',
      headers: { 'Content-Type':'application/proto','Connect-Protocol-Version':'1','User-Agent':'connect-es/1.4.0','Content-Length':body.length, ...extraHeaders },
    }, res => {
      const frames=[]; let buffer=Buffer.alloc(0); const raw=[];
      const timeout = setTimeout(()=>resolve({status:res.statusCode,frames,rawBody:Buffer.concat(raw),contentType:res.headers['content-type']||''}), 30000);
      res.on('data', chunk => {
        raw.push(chunk); buffer=Buffer.concat([buffer,chunk]);
        while(buffer.length>=5){ const flags=buffer.readUInt8(0),len=buffer.readUInt32BE(1); if(buffer.length<5+len)break; frames.push({flags,data:Buffer.from(buffer.subarray(5,5+len))}); buffer=buffer.subarray(5+len); }
      });
      res.on('end', ()=>{ clearTimeout(timeout); resolve({status:res.statusCode,frames,rawBody:Buffer.concat(raw),contentType:res.headers['content-type']||''}); });
    });
    req.on('error', reject); req.setTimeout(30000, ()=>req.destroy(new Error('timeout'))); req.write(body); req.end();
  });
}

// ================= Auth steps =================
async function postAuthCall(token) {
  // Body: org_id (field 1, empty string). Auth1 token goes in header.
  const body = encodeStringField(1, '');
  const res = await httpsPostBody(POST_AUTH_URL, body, {
    'X-Devin-Auth1-Token': token,
    'referer': 'https://windsurf.com/account/login',
  });
  if (res.status !== 200) throw new Error(`PostAuth ${res.status}: ${res.body.toString('utf-8').substring(0,100)}`);
  const data = stripEnvelope(res.body);
  const f = parseProtoFields(data);
  return {
    sessionToken: f[1]?.[0]?.str || '',
    auth1Token: f[3]?.[0]?.str || null,
    accountId: f[4]?.[0]?.str || null,
    primaryOrgId: f[5]?.[0]?.str || null,
  };
}

async function getOneTimeAuthToken(auth) {
  const body = encodeStringField(1, auth.sessionToken);
  const headers = {};
  headers['x-auth-token'] = auth.sessionToken;
  if (auth.sessionToken.startsWith('devin-session-token$')) {
    headers['x-devin-session-token'] = auth.sessionToken;
    if (auth.accountId) headers['x-devin-account-id'] = auth.accountId;
    if (auth.auth1Token) headers['x-devin-auth1-token'] = auth.auth1Token;
    if (auth.primaryOrgId) headers['x-devin-primary-org-id'] = auth.primaryOrgId;
  }
  const res = await httpsPostBody(GET_ONE_TIME_AUTH_TOKEN_URL, body, headers);
  if (res.status !== 200) throw new Error(`GetOneTimeAuthToken ${res.status}: ${res.body.toString('utf-8').substring(0,100)}`);
  const data = stripEnvelope(res.body);
  const f = parseProtoFields(data);
  return f[1]?.[0]?.str || '';
}

async function registerUser(ott) {
  const body = encodeStringField(1, ott);
  const res = await httpsPostBody(REGISTER_USER_URL, body);
  if (res.status !== 200) throw new Error(`RegisterUser ${res.status}: ${res.body.toString('utf-8').substring(0,100)}`);
  const data = stripEnvelope(res.body);
  const f = parseProtoFields(data);
  return {
    apiKey: f[1]?.[0]?.str || '',
    name: f[2]?.[0]?.str || '',
    apiServerUrl: f[3]?.[0]?.str || '',
  };
}

main().catch(e => { console.error(`  FATAL: ${e.message}`); process.exit(1); });
