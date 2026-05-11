#!/usr/bin/env node
/**
 * Direct Chat Test - Call GetChatMessage directly to server.codeium.com via gRPC
 * Bypasses our LS to diagnose connectivity/auth issues.
 */
'use strict';

const path = require('path');
const https = require('https');
const http2 = require('http2');

const LS_DIR = path.join(__dirname, '..', 'src', 'language-server');
// Load grpc from language-server's node_modules
const grpc = require(path.join(LS_DIR, 'node_modules', '@grpc', 'grpc-js'));
const protoLoader = require(path.join(LS_DIR, 'node_modules', '@grpc', 'proto-loader'));

const PROTO_DIR = path.join(__dirname, '..', 'src', 'language-server', 'protos');
const API_KEY = resolveApiKey();

if (!API_KEY) {
  console.error('Usage: node tools/direct-chat-test.js --api-key YOUR_KEY');
  process.exit(1);
}

console.log('╔════════════════════════════════════════════╗');
console.log('║   Direct API Chat Test                     ║');
console.log('╚════════════════════════════════════════════╝');
console.log(`  API Key: ${API_KEY.substring(0, 15)}...${API_KEY.slice(-4)}\n`);

// Test 1: Try gRPC to target server
async function testGrpc() {
  const server = resolveServer();
  console.log(`  [Test 1] gRPC → ${server}`);
  
  const packageDef = protoLoader.loadSync(
    path.join(PROTO_DIR, 'exa', 'api_server_pb', 'api_server.proto'),
    { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [PROTO_DIR] }
  );
  const proto = grpc.loadPackageDefinition(packageDef);
  const ApiService = proto.exa.api_server_pb.ApiServerService;
  
  const client = new ApiService(
    `${server}:443`,
    grpc.credentials.createSsl()
  );
  
  // GetChatMessageRequest proto:
  //   metadata (field 1): { api_key(3), ide_name(4), ide_version(5) }
  //   chat_message_prompts (field 3): [{ message_id(1), source(2), prompt(3) }]
  //   chat_model_name (field 14): string
  const req = {
    metadata: { api_key: API_KEY, ide_name: 'windsurf', ide_version: '2.2.1017' },
    chat_message_prompts: [
      {
        message_id: 'test-msg-1',
        source: 1, // CHAT_MESSAGE_SOURCE_USER
        prompt: 'Say "Hello from Cascade!" and nothing else.',
      },
    ],
    chat_model_name: 'claude-3-5-sonnet',
  };
  
  console.log('    Sending GetChatMessage (streaming)...');
  
  return new Promise((resolve) => {
    const stream = client.GetChatMessage(req);
    let frames = 0;
    let text = '';
    const timeout = setTimeout(() => {
      console.log(`    Timeout after 15s. Frames: ${frames}`);
      stream.cancel();
      resolve(false);
    }, 15000);
    
    stream.on('data', (chunk) => {
      frames++;
      if (chunk.delta_text) text += chunk.delta_text;
      if (frames <= 3) {
        console.log(`    Frame ${frames}: ${JSON.stringify(chunk).substring(0, 120)}`);
      }
    });
    
    stream.on('end', () => {
      clearTimeout(timeout);
      console.log(`    Received ${frames} frames. Text: "${text.substring(0, 100)}"`);
      resolve(frames > 0);
    });
    
    stream.on('error', (err) => {
      clearTimeout(timeout);
      console.log(`    ERROR: ${err.code} ${err.message}`);
      resolve(false);
    });
  });
}

// Test 2: Try Connect-RPC (HTTP) to web-backend.windsurf.com
async function testConnectRpc() {
  console.log('\n  [Test 2] Connect-RPC → web-backend.windsurf.com');
  console.log('    Sending GetChatMessage via HTTP...');
  
  // Minimal protobuf for GetChatMessage request
  // We need to construct the request manually since web-backend uses Connect-RPC
  // This is more complex - let's first try the simpler GetPlanStatus to verify connectivity
  
  return new Promise((resolve, reject) => {
    const body = buildSimpleChatRequest(API_KEY);
    
    const parsed = new URL('https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage');
    const req = https.request({
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/grpc-web+proto',
        'X-Grpc-Web': '1',
        'X-Api-Key': API_KEY,
        'Content-Length': body.length,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        console.log(`    HTTP ${res.statusCode}, ${buf.length} bytes`);
        console.log(`    Content-Type: ${res.headers['content-type']}`);
        if (buf.length > 0 && buf.length < 500) {
          console.log(`    Body: ${buf.toString('utf-8').substring(0, 200)}`);
        } else if (buf.length > 0) {
          console.log(`    Body (hex): ${buf.subarray(0, 50).toString('hex')}`);
        }
        resolve(res.statusCode === 200);
      });
    });
    req.on('error', e => { console.log(`    ERROR: ${e.message}`); resolve(false); });
    req.setTimeout(15000, () => { req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

// Test 3: Verify the API key works at all (GetCompletions unary)
async function testGetCompletions() {
  const server = resolveServer();
  console.log(`\n  [Test 3] gRPC GetCompletions (unary) → ${server}`);
  
  const packageDef = protoLoader.loadSync(
    path.join(PROTO_DIR, 'exa', 'api_server_pb', 'api_server.proto'),
    { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true, includeDirs: [PROTO_DIR] }
  );
  const proto = grpc.loadPackageDefinition(packageDef);
  const ApiService = proto.exa.api_server_pb.ApiServerService;
  
  const client = new ApiService(
    `${server}:443`,
    grpc.credentials.createSsl()
  );
  
  const req = {
    metadata: { api_key: API_KEY, ide_name: 'windsurf', ide_version: '2.2.1017' },
    document: {
      text: 'function hello() {\n  console.log("',
      cursor_offset: { row: 1, col: 14 },
      language: 'LANGUAGE_JAVASCRIPT',
      editor_language: 'javascript',
    },
  };
  
  return new Promise(resolve => {
    client.GetCompletions(req, (err, response) => {
      if (err) {
        console.log(`    ERROR: ${err.code} ${err.message}`);
        resolve(false);
      } else {
        const items = response?.completion_items || [];
        console.log(`    OK: ${items.length} completion(s)`);
        if (items.length > 0) {
          console.log(`    First: "${(items[0].completion?.text || '').substring(0, 80)}"`);
        }
        resolve(true);
      }
    });
  });
}

function buildSimpleChatRequest(apiKey) {
  // Minimal protobuf for a chat request
  const enc = (fieldNum, wireType, value) => {
    const tag = (fieldNum << 3) | wireType;
    if (wireType === 2) { // length-delimited
      const buf = Buffer.from(value, 'utf-8');
      const len = encodeVarint(buf.length);
      return Buffer.concat([Buffer.from([tag]), len, buf]);
    }
    return Buffer.from([tag, value]);
  };
  
  // metadata.api_key (field 3 in Metadata)
  const apiKeyField = enc(3, 2, apiKey);
  const ideNameField = enc(1, 2, 'windsurf');
  const metadataPayload = Buffer.concat([ideNameField, apiKeyField]);
  const metadataField = Buffer.concat([
    Buffer.from([0x0A]), // field 1, wire 2
    encodeVarint(metadataPayload.length),
    metadataPayload,
  ]);
  
  // A simple chat prompt
  const promptText = enc(1, 2, 'Say hello');
  const chatPrompt = Buffer.concat([
    Buffer.from([0x12]), // field 2 repeated, wire 2
    encodeVarint(promptText.length),
    promptText,
  ]);
  
  return Buffer.concat([metadataField, chatPrompt]);
}

function encodeVarint(value) {
  const buf = [];
  while (value >= 0x80) {
    buf.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
  buf.push(value & 0x7F);
  return Buffer.from(buf);
}

function resolveApiKey() {
  const idx = process.argv.indexOf('--api-key');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (process.env.CODEIUM_API_KEY) return process.env.CODEIUM_API_KEY;
  return null;
}

function resolveServer() {
  const idx = process.argv.indexOf('--server');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return 'server.codeium.com';
}

async function main() {
  const r1 = await testGrpc();
  const r2 = await testConnectRpc();
  const r3 = await testGetCompletions();
  
  console.log('\n  ════════════════════════');
  console.log(`  gRPC Chat:       ${r1 ? '✓' : '✗'}`);
  console.log(`  HTTP Chat:       ${r2 ? '✓' : '✗'}`);
  console.log(`  gRPC Completions: ${r3 ? '✓' : '✗'}`);
  
  process.exit(r1 || r2 || r3 ? 0 : 1);
}

main();
