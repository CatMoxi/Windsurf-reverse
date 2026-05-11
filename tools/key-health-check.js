#!/usr/bin/env node
/**
 * API Key health checker — run periodically to detect expiration.
 * Usage: node tools/key-health-check.js [--loop 300]
 *   --loop N: check every N seconds (default: one-shot)
 */
'use strict';

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const codec = require(path.join(__dirname, '..', 'src', 'language-server', 'proto-codec'));

const envPath = path.join(__dirname, '..', '.env');
function readApiKey() {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const l of lines) {
    const m = l.match(/^CODEIUM_API_KEY=(.+)/);
    if (m) return m[1].trim();
  }
  return null;
}

function check(apiKey) {
  const server = 'server.self-serve.windsurf.com';
  const req = { metadata: { apiKey, ideName: 'windsurf', ideVersion: '2.5.0', extensionVersion: '2.5.0', sessionId: crypto.randomUUID(), requestId: 1, locale: 'en_US' } };
  const body = codec.encodeRequest('GetCascadeModelConfigs', req);
  return new Promise((resolve) => {
    const r = https.request({
      hostname: server, port: 443,
      path: '/exa.api_server_pb.ApiServerService/GetCascadeModelConfigs',
      method: 'POST',
      headers: { 'Content-Type': 'application/proto', 'Connect-Protocol-Version': '1', 'Content-Length': body.length },
    }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          resolve({ ok: false, status: res.statusCode, error: Buffer.concat(c).toString('utf-8').substring(0, 200) });
          return;
        }
        try {
          const dec = codec.decodeResponse('GetCascadeModelConfigs', Buffer.concat(c));
          const count = (dec.clientModelConfigs || []).length;
          resolve({ ok: true, models: count });
        } catch (e) {
          resolve({ ok: false, error: e.message });
        }
      });
    });
    r.on('error', e => resolve({ ok: false, error: e.message }));
    r.setTimeout(10000, () => { r.destroy(); resolve({ ok: false, error: 'timeout' }); });
    r.write(body);
    r.end();
  });
}

async function main() {
  const loopIdx = process.argv.indexOf('--loop');
  const interval = loopIdx >= 0 ? parseInt(process.argv[loopIdx + 1]) || 300 : 0;

  const run = async () => {
    const key = readApiKey();
    if (!key) { console.log(`[${new Date().toISOString()}] No API key`); return; }
    const result = await check(key);
    const ts = new Date().toISOString();
    if (result.ok) {
      console.log(`[${ts}] ✓ Key valid (${result.models} models)`);
    } else {
      console.log(`[${ts}] ✗ Key INVALID: ${result.error || result.status}`);
    }
  };

  await run();
  if (interval > 0) {
    console.log(`Checking every ${interval}s. Ctrl+C to stop.`);
    setInterval(run, interval * 1000);
  }
}

main();
