#!/usr/bin/env node
/**
 * Credits Check - Query Windsurf account quota/usage for all accounts.
 * 
 * API: GetPlanStatus (web-backend.windsurf.com/SeatManagementService/GetPlanStatus)
 * 
 * Usage:
 *   node tools/credits-check.js --batch accounts.txt
 *   node tools/credits-check.js auth1_xxxxxxxxx
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const POST_AUTH_URL = 'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth';
const PLAN_STATUS_URL = 'https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetPlanStatus';

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
    if (wireType === 2) {
      const lenV = decodeVarint(data, pos);
      if (!lenV) break;
      pos += lenV.consumed;
      const end = pos + lenV.value;
      if (end > data.length) break;
      const payload = data.subarray(pos, end);
      if (!fields[fieldNum]) fields[fieldNum] = [];
      fields[fieldNum].push({ raw: Buffer.from(payload), str: payload.toString('utf-8') });
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

// ==================== HTTP ====================

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
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Timeout')));
    req.write(body);
    req.end();
  });
}

function stripEnvelope(buf) {
  if (buf.length > 5) {
    const declaredLen = buf.readUInt32BE(1);
    if ((buf[0] & 0x7e) === 0 && declaredLen > 0 && declaredLen + 5 === buf.length) {
      return buf.subarray(5);
    }
  }
  return buf;
}

// ==================== Auth ====================

async function windsurfPostAuth(auth1Token, orgId = '') {
  const body = encodeStringField(1, orgId);
  const res = await httpsPost(POST_AUTH_URL, body, {
    'X-Devin-Auth1-Token': auth1Token,
    'referer': 'https://windsurf.com/account/login',
  });
  if (res.status !== 200) throw new Error(`PostAuth HTTP ${res.status}`);
  const data = stripEnvelope(res.body);
  const fields = parseProtoFields(data);
  return {
    sessionToken: fields[1]?.[0]?.str || '',
    accountId: fields[4]?.[0]?.str || null,
    primaryOrgId: fields[5]?.[0]?.str || null,
    auth1Token: fields[3]?.[0]?.str || null,
  };
}

// ==================== GetPlanStatus ====================

async function getPlanStatus(auth) {
  // Body: field 1 (string) = session_token
  const body = encodeStringField(1, auth.sessionToken);
  
  const headers = { 'x-auth-token': auth.sessionToken };
  if (auth.sessionToken.startsWith('devin-session-token$')) {
    headers['x-devin-session-token'] = auth.sessionToken;
    if (auth.accountId) headers['x-devin-account-id'] = auth.accountId;
    if (auth.auth1Token) headers['x-devin-auth1-token'] = auth.auth1Token;
    if (auth.primaryOrgId) headers['x-devin-primary-org-id'] = auth.primaryOrgId;
  }
  
  const res = await httpsPost(PLAN_STATUS_URL, body, headers);
  if (res.status !== 200) {
    throw new Error(`GetPlanStatus HTTP ${res.status}: ${res.body.toString().substring(0, 100)}`);
  }
  
  const data = stripEnvelope(res.body);
  return parsePlanStatus(data);
}

function parsePlanStatus(data) {
  const topFields = parseProtoFields(data);
  const result = {
    planName: 'Free',
    tier: 'UNSPECIFIED',
    usedPromptCredits: 0,
    availablePromptCredits: 0,
    usedFlowCredits: 0,
    availableFlowCredits: 0,
    usedFlexCredits: 0,
    availableFlexCredits: 0,
    dailyQuotaRemainingPercent: null,
    weeklyQuotaRemainingPercent: null,
    planStartUnix: null,
    planEndUnix: null,
  };
  
  // subMessage_1 = PlanStatus
  if (!topFields[1]?.[0]?.raw) return result;
  const planStatus = parseProtoFields(topFields[1][0].raw);
  
  // PlanInfo = planStatus.subMessage_1
  if (planStatus[1]?.[0]?.raw) {
    const planInfo = parseProtoFields(planStatus[1][0].raw);
    const tierNum = planInfo[1]?.[0]?.varint || 0;
    const TIERS = ['UNSPECIFIED', 'TEAMS', 'PRO', 'ENTERPRISE_SAAS', 'HYBRID',
      'ENTERPRISE_SELF_HOSTED', 'WAITLIST_PRO', 'TEAMS_ULTIMATE', 'PRO_ULTIMATE', 'TRIAL', 'ENTERPRISE_SELF_SERVE'];
    result.tier = TIERS[tierNum] || `UNKNOWN(${tierNum})`;
    result.planName = planInfo[2]?.[0]?.str || result.tier;
    result.monthlyPromptCredits = planInfo[12]?.[0]?.varint;
    result.monthlyFlowCredits = planInfo[13]?.[0]?.varint;
  }
  
  // Credits from PlanStatus
  result.availableFlexCredits = planStatus[4]?.[0]?.varint || 0;
  result.usedFlowCredits = planStatus[5]?.[0]?.varint || 0;
  result.usedPromptCredits = planStatus[6]?.[0]?.varint || 0;
  result.usedFlexCredits = planStatus[7]?.[0]?.varint || 0;
  result.availablePromptCredits = planStatus[8]?.[0]?.varint || 0;
  result.availableFlowCredits = planStatus[9]?.[0]?.varint || 0;
  
  // Quotas
  result.dailyQuotaRemainingPercent = planStatus[14]?.[0]?.varint ?? null;
  result.weeklyQuotaRemainingPercent = planStatus[15]?.[0]?.varint ?? null;
  
  // Timestamps
  if (planStatus[2]?.[0]?.raw) {
    const ts = parseProtoFields(planStatus[2][0].raw);
    result.planStartUnix = ts[1]?.[0]?.varint || null;
  }
  if (planStatus[3]?.[0]?.raw) {
    const ts = parseProtoFields(planStatus[3][0].raw);
    result.planEndUnix = ts[1]?.[0]?.varint || null;
  }
  
  return result;
}

// ==================== Main ====================

function formatCredits(value) {
  if (value === undefined || value === null) return '-';
  return (value / 100).toFixed(0);
}

function formatDate(unix) {
  if (!unix) return '-';
  return new Date(unix * 1000).toISOString().split('T')[0];
}

async function checkAccount(auth1Token) {
  // Step 1: Get session
  const postAuth = await windsurfPostAuth(auth1Token);
  if (!postAuth.sessionToken) throw new Error('No session_token');
  
  // Step 2: Get plan status
  const auth = {
    sessionToken: postAuth.sessionToken,
    accountId: postAuth.accountId,
    auth1Token: postAuth.auth1Token || auth1Token,
    primaryOrgId: postAuth.primaryOrgId,
  };
  const plan = await getPlanStatus(auth);
  
  return { ...plan, accountId: postAuth.accountId };
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node tools/credits-check.js auth1_xxx');
    console.log('  node tools/credits-check.js --batch accounts.txt');
    process.exit(1);
  }
  
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   Windsurf Credits Checker                                     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  const batchIdx = args.indexOf('--batch');
  let tokens = [];
  
  if (batchIdx !== -1) {
    const file = args[batchIdx + 1];
    tokens = fs.readFileSync(file, 'utf-8').split('\n')
      .map(l => l.trim()).filter(l => l.startsWith('auth1_'));
  } else {
    tokens = args.filter(a => a.startsWith('auth1_'));
  }
  
  console.log(`  Checking ${tokens.length} account(s)...\n`);
  
  // Table header
  const COL = { idx: 3, plan: 12, prompt: 18, flow: 18, daily: 8, weekly: 8, expires: 12 };
  console.log(
    '  #'.padEnd(COL.idx) +
    'Plan'.padEnd(COL.plan) +
    'Prompt (used/avail)'.padEnd(COL.prompt) +
    'Flow (used/avail)'.padEnd(COL.flow) +
    'Daily%'.padEnd(COL.daily) +
    'Week%'.padEnd(COL.weekly) +
    'Expires'.padEnd(COL.expires)
  );
  console.log('  ' + '─'.repeat(COL.idx + COL.plan + COL.prompt + COL.flow + COL.daily + COL.weekly + COL.expires));
  
  const results = [];
  for (let i = 0; i < tokens.length; i++) {
    try {
      const plan = await checkAccount(tokens[i]);
      results.push({ token: tokens[i], ...plan, error: null });
      
      const row =
        `  ${(i+1).toString().padEnd(COL.idx)}` +
        `${(plan.planName || plan.tier).substring(0, 10).padEnd(COL.plan)}` +
        `${formatCredits(plan.usedPromptCredits)}/${formatCredits(plan.availablePromptCredits)}`.padEnd(COL.prompt) +
        `${formatCredits(plan.usedFlowCredits)}/${formatCredits(plan.availableFlowCredits)}`.padEnd(COL.flow) +
        `${plan.dailyQuotaRemainingPercent ?? '-'}%`.padEnd(COL.daily) +
        `${plan.weeklyQuotaRemainingPercent ?? '-'}%`.padEnd(COL.weekly) +
        formatDate(plan.planEndUnix);
      console.log(row);
    } catch (err) {
      results.push({ token: tokens[i], error: err.message });
      console.log(`  ${(i+1).toString().padEnd(COL.idx)}ERROR: ${err.message}`);
    }
  }
  
  // Summary
  const ok = results.filter(r => !r.error);
  const hasCredits = ok.filter(r => {
    const avail = (r.availablePromptCredits || 0) + (r.availableFlowCredits || 0);
    const used = (r.usedPromptCredits || 0) + (r.usedFlowCredits || 0);
    return avail > used;
  });
  
  console.log(`\n  ═══════════════════════════════════════`);
  console.log(`  Total: ${tokens.length} | OK: ${ok.length} | With credits: ${hasCredits.length}`);
  
  // Export usable accounts
  if (args.includes('--export') && hasCredits.length > 0) {
    const exportFile = path.join(__dirname, '..', 'usable-accounts.json');
    const exportData = hasCredits.map(r => ({
      auth1Token: r.token,
      plan: r.planName || r.tier,
      availablePrompt: r.availablePromptCredits,
      availableFlow: r.availableFlowCredits,
      usedPrompt: r.usedPromptCredits,
      usedFlow: r.usedFlowCredits,
      expires: r.planEndUnix ? new Date(r.planEndUnix * 1000).toISOString() : null,
    }));
    fs.writeFileSync(exportFile, JSON.stringify(exportData, null, 2));
    console.log(`  Exported ${hasCredits.length} usable accounts to usable-accounts.json`);
  }
}

main();
