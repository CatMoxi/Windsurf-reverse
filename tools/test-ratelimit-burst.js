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

function check(model) {
  const req = {
    metadata: {
      apiKey, ideName: 'windsurf', ideVersion: '2.5.0',
      extensionVersion: '2.5.0', sessionId: crypto.randomUUID(),
      requestId: 1, locale: 'en_US',
    },
    modelUid: model,
  };
  const body = codec.encodeRequest('CheckUserMessageRateLimit', req);
  return new Promise((resolve) => {
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
          resolve(codec.decodeResponse('CheckUserMessageRateLimit', Buffer.concat(c)));
        } catch (e) {
          resolve({ error: e.message });
        }
      });
    });
    r.write(body);
    r.end();
  });
}

function sendChat(prompt, model) {
  const req = {
    metadata: {
      apiKey, ideName: 'windsurf', ideVersion: '2.5.0',
      extensionVersion: '2.5.0', sessionId: crypto.randomUUID(),
      requestId: Math.floor(Math.random() * 1e9), locale: 'en_US',
    },
    chatMessagePrompts: [{
      messageId: crypto.randomUUID(),
      source: 'CHAT_MESSAGE_SOURCE_USER',
      prompt,
    }],
    chatModelUid: model,
    requestType: 'CHAT_MESSAGE_REQUEST_TYPE_CASCADE',
    cascadeId: crypto.randomUUID(),
    promptId: crypto.randomUUID(),
    toolChoice: { optionName: 'none' },
  };
  const body = codec.encodeRequest('GetChatMessage', req);
  const hdr = Buffer.alloc(5);
  hdr.writeUInt32BE(body.length, 1);
  const framed = Buffer.concat([hdr, body]);
  return new Promise((resolve) => {
    const r = https.request({
      hostname: server, port: 443,
      path: '/exa.api_server_pb.ApiServerService/GetChatMessage',
      method: 'POST',
      headers: {
        'Content-Type': 'application/connect+proto',
        'Connect-Protocol-Version': '1',
        'Content-Length': framed.length,
      },
    }, res => {
      const c = [];
      res.on('data', d => c.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(c);
        let text = '', errors = [];
        let pos = 0;
        while (pos + 5 <= buf.length) {
          const f = buf[pos];
          const l = buf.readUInt32BE(pos + 1);
          pos += 5;
          const pl = buf.subarray(pos, pos + l);
          if (f === 2) {
            const s = pl.toString('utf-8');
            if (s.trim() && s.trim() !== '{}') errors.push(s.substring(0, 200));
          } else if (f === 0 && pl.length > 0) {
            try {
              const d = codec.decodeResponse('GetChatMessage', pl);
              if (d.deltaText) text += d.deltaText;
            } catch (e) {}
          }
          pos += l;
        }
        resolve({ text: text.substring(0, 50), errors });
      });
    });
    r.write(framed);
    r.end();
  });
}

async function main() {
  const model = 'gpt-5-4-none'; // cheap: 1.5 credits

  console.log('=== Burst test: send 5 rapid parallel requests ===\n');

  // Check before
  let rl = await check(model);
  console.log(`Before: remain=${rl.messagesRemaining} max=${rl.maxMessages} reset=${rl.resetsInSeconds || '?'}s msg="${rl.message || ''}"`);

  // Send 5 in parallel
  console.log('\nSending 5 parallel requests...');
  const t0 = Date.now();
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(sendChat(`Say "${i}"`, model));
  }

  // Check during (while requests in flight)
  const rlDuring = await check(model);
  console.log(`During: remain=${rlDuring.messagesRemaining} max=${rlDuring.maxMessages} reset=${rlDuring.resetsInSeconds || '?'}s`);

  const results = await Promise.all(promises);
  const elapsed = Date.now() - t0;
  console.log(`\n5 requests completed in ${elapsed}ms`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const status = r.errors.length ? `ERR: ${r.errors[0].substring(0, 80)}` : `OK: "${r.text}"`;
    console.log(`  [${i}]: ${status}`);
  }

  // Check after
  rl = await check(model);
  console.log(`\nAfter 5: remain=${rl.messagesRemaining} max=${rl.maxMessages} reset=${rl.resetsInSeconds || '?'}s msg="${rl.message || ''}"`);

  // Wait 5 seconds and check again
  console.log('\nWaiting 5 seconds...');
  await new Promise(r => setTimeout(r, 5000));
  rl = await check(model);
  console.log(`After wait: remain=${rl.messagesRemaining} max=${rl.maxMessages} reset=${rl.resetsInSeconds || '?'}s`);

  // Now try sequential burst of 10 more
  console.log('\n=== Sequential burst: 10 requests ===');
  for (let i = 0; i < 10; i++) {
    const r = await sendChat(`Say ${i}`, model);
    const rl2 = await check(model);
    const status = r.errors.length ? 'ERR' : 'OK';
    console.log(`  [${i}] ${status} remain=${rl2.messagesRemaining} max=${rl2.maxMessages} reset=${rl2.resetsInSeconds || '?'}s msg="${rl2.message || ''}"`);
  }

  console.log('\nDone. Total messages sent: ~15');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
