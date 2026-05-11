#!/usr/bin/env node
'use strict';

const https = require('https');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const codec = require(path.join(__dirname, '..', 'src', 'language-server', 'proto-codec'));

const apiKey = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf-8')
  .match(/CODEIUM_API_KEY=(.+)/)[1].trim();
const server = 'server.self-serve.windsurf.com';

function check(modelUid) {
  const req = {
    metadata: {
      apiKey,
      ideName: 'windsurf',
      ideVersion: '2.5.0',
      extensionVersion: '2.5.0',
      sessionId: crypto.randomUUID(),
      requestId: 1,
      locale: 'en_US',
    },
    modelUid,
  };
  const body = codec.encodeRequest('CheckUserMessageRateLimit', req);
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: server, port: 443,
      path: '/exa.api_server_pb.ApiServerService/CheckUserMessageRateLimit',
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'Content-Length': body.length,
      },
    }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        try {
          const dec = codec.decodeResponse('CheckUserMessageRateLimit', Buffer.concat(c));
          resolve(dec);
        } catch (e) {
          resolve({ error: e.message });
        }
      });
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}

async function main() {
  const models = [
    'gpt-5-5-low', 'gpt-5-5-none', 'gpt-5-5-medium', 'gpt-5-5-high',
    'gpt-5-4-low', 'gpt-5-4-none',
    'claude-sonnet-4-6', 'claude-sonnet-4-6-thinking',
    'claude-opus-4-6', 'claude-opus-4-6-thinking',
    'claude-opus-4-7-low', 'claude-opus-4-7-medium',
    'MODEL_GOOGLE_GEMINI_2_5_PRO', 'gemini-3-1-pro-low',
    'MODEL_CHAT_O3', 'MODEL_CHAT_O3_HIGH',
    'kimi-k2-5', 'kimi-k2-6',
    'deepseek-v4',
    'swe-1-6', 'swe-1-6-fast',
    'MODEL_CHAT_GPT_4O_2024_08_06',
    'MODEL_GPT_5_2_LOW',
  ];

  console.log('Model'.padEnd(40) + 'Cap  Remain  Max    Reset(s)  Message');
  console.log('-'.repeat(100));

  for (const m of models) {
    const r = await check(m);
    const cap = r.hasCapacity ? 'Y' : 'N';
    const remain = r.messagesRemaining !== undefined ? String(r.messagesRemaining) : '?';
    const max = r.maxMessages !== undefined ? String(r.maxMessages) : '?';
    const reset = r.resetsInSeconds !== undefined ? String(r.resetsInSeconds) : '?';
    const msg = r.message || '';
    console.log(
      m.padEnd(40) +
      cap.padEnd(5) +
      remain.padEnd(8) +
      max.padEnd(7) +
      reset.padEnd(10) +
      msg
    );
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
