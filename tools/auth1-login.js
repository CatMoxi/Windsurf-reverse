#!/usr/bin/env node
/**
 * Auth1 Token Login - Convert auth1_xxx token to Windsurf API key.
 * 
 * Flow (reverse-engineered from avw project):
 * 1. WindsurfPostAuth(auth1_token) → session_token + account_id + primary_org_id
 * 2. GetCurrentUser(session_token + devin headers) → api_key + email + plan
 * 
 * Usage:
 *   node tools/auth1-login.js auth1_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
 *   node tools/auth1-login.js --batch accounts.txt
 *   node tools/auth1-login.js --batch accounts.txt --save
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const POST_AUTH_URL = 'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth';
const GET_CURRENT_USER_URL = 'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetCurrentUser';

// ==================== Protobuf helpers ====================

function encodeVarint(value) {
  const buf = [];
  while (value >= 0x80) {
    buf.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  buf.push(value & 0x7F);
  return Buffer.from(buf);
}

function encodeStringField(fieldNum, value) {
  const strBuf = Buffer.from(value, 'utf-8');
  const tag = Buffer.from([(fieldNum << 3) | 2]);
  const len = encodeVarint(strBuf.length);
  return Buffer.concat([tag, len, strBuf]);
}

function encodeBoolField(fieldNum, value) {
  return Buffer.from([(fieldNum << 3) | 0, value ? 1 : 0]);
}

function decodeVarint(buf, offset) {
  let value = 0, shift = 0, pos = offset;
  while (pos < buf.length) {
    const b = buf[pos++];
    value |= (b & 0x7F) << shift;
    if ((b & 0x80) === 0) return { value, consumed: pos - offset };
    shift += 7;
    if (shift > 63) return null;
  }
  return null;
}

function decodeStringField1(data) {
  let pos = 0;
  while (pos < data.length) {
    const tag = data[pos++];
    const wireType = tag & 0x07;
    const fieldNum = tag >> 3;
    if (wireType === 2) {
      const v = decodeVarint(data, pos);
      if (!v) return null;
      pos += v.consumed;
      const end = pos + v.value;
      if (end > data.length) return null;
      if (fieldNum === 1) {
        const str = data.subarray(pos, end).toString('utf-8');
        if (str) return str;
      }
      pos = end;
    } else if (wireType === 0) {
      const v = decodeVarint(data, pos);
      if (!v) return null;
      pos += v.consumed;
    } else if (wireType === 1) { pos += 8; }
    else if (wireType === 5) { pos += 4; }
    else break;
  }
  return null;
}

// Generic protobuf parser — extracts all string/submessage fields
function parseProtoFields(data) {
  const fields = {};
  let pos = 0;
  while (pos < data.length) {
    const vr = decodeVarint(data, pos);
    if (!vr) break;
    pos += vr.consumed;
    const tag = vr.value;
    const fieldNum = tag >> 3;
    const wireType = tag & 0x07;
    
    if (wireType === 2) { // length-delimited
      const lenV = decodeVarint(data, pos);
      if (!lenV) break;
      pos += lenV.consumed;
      const end = pos + lenV.value;
      if (end > data.length) break;
      const payload = data.subarray(pos, end);
      // Try as string
      const str = payload.toString('utf-8');
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push({ raw: Buffer.from(payload), str });
      pos = end;
    } else if (wireType === 0) {
      const v = decodeVarint(data, pos);
      if (!v) break;
      pos += v.consumed;
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push({ varint: v.value });
    } else if (wireType === 1) { pos += 8; }
    else if (wireType === 5) { pos += 4; }
    else break;
  }
  return fields;
}

// ==================== API calls ====================

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'accept': '*/*',
        'connect-protocol-version': '1',
        'content-type': 'application/proto',
        'origin': 'https://windsurf.com',
        'referer': 'https://windsurf.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Length': body.length,
        ...headers,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, headers: res.headers, body: buf });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Timeout')));
    req.write(body);
    req.end();
  });
}

// Strip gRPC-Web 5-byte envelope if present
function stripEnvelope(buf) {
  if (buf.length > 5) {
    const declaredLen = buf.readUInt32BE(1);
    if ((buf[0] & 0x7e) === 0 && declaredLen > 0 && declaredLen + 5 === buf.length) {
      return buf.subarray(5);
    }
  }
  return buf;
}

/**
 * Step 1: WindsurfPostAuth — exchange auth1_token for session_token
 */
async function windsurfPostAuth(auth1Token, orgId = '') {
  // Body: only org_id (field 1), auth1_token goes in header
  const body = encodeStringField(1, orgId);
  
  const res = await httpsPost(POST_AUTH_URL, body, {
    'X-Devin-Auth1-Token': auth1Token,
    'referer': 'https://windsurf.com/account/login',
  });
  
  if (res.status !== 200) {
    const errText = res.body.toString('utf-8').substring(0, 200);
    throw new Error(`WindsurfPostAuth HTTP ${res.status}: ${errText}`);
  }
  
  const data = stripEnvelope(res.body);
  const fields = parseProtoFields(data);
  
  // field 1: session_token, 2: orgs (repeated), 3: auth1_token, 4: account_id, 5: primary_org_id
  const result = {
    sessionToken: fields[1]?.[0]?.str || '',
    orgs: (fields[2] || []).map(f => {
      const sub = parseProtoFields(f.raw);
      return { id: sub[1]?.[0]?.str || '', name: sub[2]?.[0]?.str || '' };
    }),
    auth1Token: fields[3]?.[0]?.str || null,
    accountId: fields[4]?.[0]?.str || null,
    primaryOrgId: fields[5]?.[0]?.str || null,
  };
  
  if (!result.sessionToken) {
    throw new Error('WindsurfPostAuth: no session_token in response');
  }
  
  return result;
}

/**
 * Step 2: GetCurrentUser — get api_key, email, plan from session
 */
async function getCurrentUser(auth) {
  // Build GetCurrentUserRequest: auth_token(1) + include flags(2,3,4)
  const parts = [
    encodeStringField(1, auth.sessionToken),
    encodeBoolField(2, true), // include_user
    encodeBoolField(3, true), // include_team 
    encodeBoolField(4, true), // include_role
  ];
  const body = Buffer.concat(parts);
  
  const headers = {
    'x-auth-token': auth.sessionToken,
  };
  // Devin headers
  if (auth.sessionToken.startsWith('devin-session-token$')) {
    headers['x-devin-session-token'] = auth.sessionToken;
    if (auth.accountId) headers['x-devin-account-id'] = auth.accountId;
    if (auth.auth1Token) headers['x-devin-auth1-token'] = auth.auth1Token;
    if (auth.primaryOrgId) headers['x-devin-primary-org-id'] = auth.primaryOrgId;
  }
  
  const res = await httpsPost(GET_CURRENT_USER_URL, body, headers);
  
  if (res.status !== 200) {
    const errText = res.body.toString('utf-8').substring(0, 200);
    throw new Error(`GetCurrentUser HTTP ${res.status}: ${errText}`);
  }
  
  const data = stripEnvelope(res.body);
  return extractUserInfo(data);
}

/**
 * Parse GetCurrentUser response recursively to find api_key and email
 */
function extractUserInfo(data) {
  const result = { apiKey: '', email: '', name: '', planName: '', raw: {} };
  
  const fields = parseProtoFields(data);
  result.raw = simplifyFields(fields);
  
  // Walk through all nested string fields looking for api_key pattern and email
  const allStrings = collectAllStrings(data);
  
  for (const s of allStrings) {
    // API keys are typically UUIDs or long hex strings
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
      if (!result.apiKey) result.apiKey = s;
    }
    // Email detection
    if (/@/.test(s) && /\.\w{2,}$/.test(s) && !result.email) {
      result.email = s;
    }
  }
  
  return result;
}

function simplifyFields(fields) {
  const result = {};
  for (const [k, v] of Object.entries(fields)) {
    result[`field_${k}`] = v.map(f => {
      if (f.varint !== undefined) return f.varint;
      if (f.str && f.str.length < 200 && isPrintable(f.str)) return f.str;
      return `<${f.raw.length}b>`;
    });
  }
  return result;
}

function isPrintable(s) {
  return !/[\x00-\x08\x0e-\x1f]/.test(s);
}

function collectAllStrings(data, depth = 0) {
  if (depth > 10) return [];
  const strings = [];
  const fields = parseProtoFields(data);
  for (const vals of Object.values(fields)) {
    for (const v of vals) {
      if (v.str && isPrintable(v.str) && v.str.length < 500) {
        strings.push(v.str);
      }
      if (v.raw && v.raw.length > 2) {
        // Try parsing as nested message
        try {
          const nested = collectAllStrings(v.raw, depth + 1);
          strings.push(...nested);
        } catch (e) {}
      }
    }
  }
  return strings;
}

// ==================== Main ====================

async function loginWithAuth1(auth1Token, orgId) {
  console.log(`  [1/2] WindsurfPostAuth...`);
  const postAuth = await windsurfPostAuth(auth1Token, orgId || '');
  console.log(`    session_token: ${postAuth.sessionToken.substring(0, 30)}...`);
  console.log(`    account_id: ${postAuth.accountId || '(none)'}`);
  console.log(`    primary_org_id: ${postAuth.primaryOrgId || '(none)'}`);
  if (postAuth.orgs.length > 0) {
    console.log(`    orgs: ${postAuth.orgs.map(o => `${o.name}(${o.id})`).join(', ')}`);
  }
  if (postAuth.auth1Token && postAuth.auth1Token !== auth1Token) {
    console.log(`    ⚠ auth1_token rotated to: ${postAuth.auth1Token.substring(0, 20)}...`);
  }
  
  console.log(`  [2/2] GetCurrentUser...`);
  const auth = {
    sessionToken: postAuth.sessionToken,
    accountId: postAuth.accountId,
    auth1Token: postAuth.auth1Token || auth1Token,
    primaryOrgId: postAuth.primaryOrgId,
  };
  const user = await getCurrentUser(auth);
  
  console.log(`    api_key: ${user.apiKey || '(not found)'}`);
  console.log(`    email: ${user.email || '(not found)'}`);
  
  return {
    auth1Token: postAuth.auth1Token || auth1Token,
    sessionToken: postAuth.sessionToken,
    accountId: postAuth.accountId,
    primaryOrgId: postAuth.primaryOrgId,
    apiKey: user.apiKey,
    email: user.email,
    raw: user.raw,
  };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node tools/auth1-login.js auth1_xxxxxxxxx');
    console.log('  node tools/auth1-login.js --batch accounts.txt [--save]');
    console.log('');
    console.log('accounts.txt format: one auth1_token per line');
    process.exit(1);
  }
  
  const batchIdx = args.indexOf('--batch');
  const save = args.includes('--save');
  
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   Auth1 Token → API Key                    ║');
  console.log('╚════════════════════════════════════════════╝\n');
  
  if (batchIdx !== -1) {
    // Batch mode
    const file = args[batchIdx + 1];
    if (!file) { console.error('Missing file path'); process.exit(1); }
    const lines = fs.readFileSync(file, 'utf-8').split('\n')
      .map(l => l.trim()).filter(l => l.startsWith('auth1_'));
    
    console.log(`  Batch: ${lines.length} auth1 token(s) from ${file}\n`);
    
    const results = [];
    for (let i = 0; i < lines.length; i++) {
      console.log(`  --- Account ${i + 1}/${lines.length} ---`);
      console.log(`  Token: ${lines[i].substring(0, 15)}...${lines[i].slice(-4)}`);
      try {
        const result = await loginWithAuth1(lines[i]);
        results.push(result);
        console.log(`  ✓ Success\n`);
      } catch (err) {
        console.log(`  ✗ Failed: ${err.message}\n`);
        results.push({ auth1Token: lines[i], error: err.message });
      }
    }
    
    // Summary
    const ok = results.filter(r => r.apiKey);
    console.log(`\n  Results: ${ok.length}/${results.length} successful`);
    if (ok.length > 0) {
      console.log('\n  API Keys:');
      for (const r of ok) {
        console.log(`    ${r.email || '?'}: ${r.apiKey}`);
      }
    }
    
    if (save && ok.length > 0) {
      const envPath = path.join(__dirname, '..', '.env');
      const envContent = `CODEIUM_API_KEY=${ok[0].apiKey}\n`;
      fs.writeFileSync(envPath, envContent);
      console.log(`\n  Saved first API key to .env`);
    }
    
  } else {
    // Single token mode
    const token = args.find(a => a.startsWith('auth1_'));
    if (!token) { console.error('Token must start with auth1_'); process.exit(1); }
    
    console.log(`  Token: ${token.substring(0, 15)}...${token.slice(-4)}\n`);
    
    try {
      const result = await loginWithAuth1(token);
      
      if (result.apiKey && save) {
        const envPath = path.join(__dirname, '..', '.env');
        fs.writeFileSync(envPath, `CODEIUM_API_KEY=${result.apiKey}\n`);
        console.log(`\n  Saved to .env`);
      }
      
      console.log('\n  ✓ Done');
    } catch (err) {
      console.error(`\n  ✗ Failed: ${err.message}`);
      process.exit(1);
    }
  }
}

main();
