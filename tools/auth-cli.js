#!/usr/bin/env node
/**
 * Windsurf Auth CLI
 * 
 * Standalone tool to authenticate with Windsurf and obtain an API key.
 * Useful for testing and development without running the full IDE.
 * 
 * Usage:
 *   node auth-cli.js login              # Opens browser for OAuth login
 *   node auth-cli.js login --show-token # Shows token on web page instead of redirect
 *   node auth-cli.js register <token>   # Exchange token for API key
 *   node auth-cli.js status             # Show current saved credentials
 *   node auth-cli.js dev-creds          # Read ~/.windsurf-dev/credentials.json
 */
const https = require('https');
const { URL } = require('url');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');

const AUTH0_CLIENT_ID = '3GUryQ7ldAeKEuD2obYnppsnmj58eP5u';
const REGISTER_URL = 'https://register.windsurf.com';
const REGISTER_PATH = '/exa.seat_management_pb.SeatManagementService/RegisterUser';
const WEBSITE = 'https://windsurf.com';

const command = process.argv[2];
const args = process.argv.slice(3);

function main() {
  switch (command) {
    case 'login':
      return cmdLogin();
    case 'register':
      return cmdRegister(args[0]);
    case 'status':
      return cmdStatus();
    case 'dev-creds':
      return cmdDevCreds();
    default:
      printUsage();
  }
}

function printUsage() {
  console.log(`
Windsurf Auth CLI

Commands:
  login [--show-token] [--signup]  Open OAuth login URL in browser
  register <access_token>          Exchange access token for API key
  status                           Show saved credentials
  dev-creds                        Read dev credentials file

Examples:
  node auth-cli.js login --show-token
  node auth-cli.js register eyJhbGciOiJSUzI1NiI...
`);
}

function cmdLogin() {
  const showToken = args.includes('--show-token');
  const signup = args.includes('--signup');
  
  const state = crypto.randomUUID();
  const redirectUri = showToken ? 'show-auth-token' : 'windsurf://codeium.windsurf';
  const redirectParamsType = showToken ? 'query' : 'fragment';
  const authPath = signup ? 'windsurf/signup' : 'windsurf/signin';
  
  const params = new URLSearchParams([
    ['response_type', 'token'],
    ['client_id', AUTH0_CLIENT_ID],
    ['redirect_uri', redirectUri],
    ['state', state],
    ['prompt', 'login'],
    ['redirect_parameters_type', redirectParamsType],
    ['workflow', ''],
  ]);
  
  const url = `${WEBSITE}/${authPath}?${params.toString()}`;
  
  console.log('\n=== Windsurf OAuth Login ===\n');
  console.log('Open this URL in your browser:\n');
  console.log(`  ${url}\n`);
  
  if (showToken) {
    console.log('After login, the access_token will be displayed on the page.');
    console.log('Copy it and run:\n');
    console.log('  node auth-cli.js register <access_token>\n');
  } else {
    console.log('After login, the app will redirect back to Windsurf IDE.');
    console.log('Use --show-token to get the token on the web page instead.\n');
  }
  
  console.log(`State: ${state}`);
}

async function cmdRegister(token) {
  if (!token) {
    console.error('Error: access_token is required');
    console.error('Usage: node auth-cli.js register <access_token>');
    process.exit(1);
  }
  
  console.log('\n=== Registering with Windsurf ===\n');
  console.log(`Token: ${token.substring(0, 20)}...`);
  console.log(`Server: ${REGISTER_URL}`);
  console.log();
  
  try {
    const reqBody = encodeRegisterUserRequest(token);
    const resBody = await connectRpcCall(REGISTER_URL, REGISTER_PATH, reqBody);
    const result = decodeRegisterUserResponse(resBody);
    
    console.log('✓ Registration successful!\n');
    console.log(`  Name:           ${result.name}`);
    console.log(`  API Key:        ${result.apiKey.substring(0, 20)}...`);
    console.log(`  API Server:     ${result.apiServerUrl || 'https://server.codeium.com'}`);
    console.log(`  Redirect URL:   ${result.redirectUrl || '(none)'}`);
    
    // Save to file
    const credsDir = path.join(os.homedir(), '.windsurf-dev');
    if (!fs.existsSync(credsDir)) fs.mkdirSync(credsDir, { recursive: true });
    const credsPath = path.join(credsDir, 'credentials.json');
    
    const creds = {
      apiKey: result.apiKey,
      name: result.name,
      apiServerUrl: result.apiServerUrl || 'https://server.codeium.com',
      registeredAt: new Date().toISOString(),
    };
    
    fs.writeFileSync(credsPath, JSON.stringify(creds, null, 2));
    console.log(`\n  Saved to: ${credsPath}`);
    console.log('\n  You can now use this API key with:');
    console.log(`  node index.js --api_key ${result.apiKey.substring(0, 10)}...`);
    
  } catch (err) {
    console.error(`✗ Registration failed: ${err.message}`);
    process.exit(1);
  }
}

function cmdStatus() {
  const credsPath = path.join(os.homedir(), '.windsurf-dev', 'credentials.json');
  
  if (!fs.existsSync(credsPath)) {
    console.log('No saved credentials found.');
    console.log(`Expected at: ${credsPath}`);
    return;
  }
  
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
  console.log('\n=== Saved Credentials ===\n');
  console.log(`  Name:       ${creds.name}`);
  console.log(`  API Key:    ${creds.apiKey?.substring(0, 20)}...`);
  console.log(`  Server:     ${creds.apiServerUrl}`);
  console.log(`  Saved at:   ${creds.registeredAt}`);
  console.log(`  File:       ${credsPath}`);
}

function cmdDevCreds() {
  const credsPath = path.join(os.homedir(), '.windsurf-dev', 'credentials.json');
  
  if (!fs.existsSync(credsPath)) {
    console.log('No dev credentials file found.');
    console.log(`Create ${credsPath} with: { "apiKey": "...", "name": "dev" }`);
    return;
  }
  
  const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
  console.log(JSON.stringify(creds, null, 2));
}

// === Proto encoding/decoding ===

function encodeVarint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return Buffer.from(bytes);
}

function decodeVarint(buf, offset) {
  let value = 0, shift = 0, bytesRead = 0;
  while (offset < buf.length) {
    const byte = buf[offset++];
    value |= (byte & 0x7f) << shift;
    shift += 7;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
  }
  return { value, bytesRead };
}

function encodeStringField(fieldNumber, value) {
  if (!value) return Buffer.alloc(0);
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const strBuf = Buffer.from(value, 'utf-8');
  const len = encodeVarint(strBuf.length);
  return Buffer.concat([tag, len, strBuf]);
}

function encodeRegisterUserRequest(firebaseIdToken) {
  // message RegisterUserRequest { string firebase_id_token = 1; }
  return encodeStringField(1, firebaseIdToken);
}

function decodeRegisterUserResponse(buf) {
  const fields = new Map();
  let offset = 0;
  while (offset < buf.length) {
    const { value: tag, bytesRead: tb } = decodeVarint(buf, offset);
    offset += tb;
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x7;
    if (wireType === 2) {
      const { value: len, bytesRead: lb } = decodeVarint(buf, offset);
      offset += lb;
      fields.set(fieldNum, buf.slice(offset, offset + len).toString('utf-8'));
      offset += len;
    } else if (wireType === 0) {
      const { bytesRead } = decodeVarint(buf, offset);
      offset += bytesRead;
    } else break;
  }
  return {
    apiKey: fields.get(1) || '',
    name: fields.get(2) || '',
    apiServerUrl: fields.get(3) || '',
    redirectUrl: fields.get(4) || '',
  };
}

function connectRpcCall(baseUrl, rpcPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(rpcPath, baseUrl);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/proto',
        'Connect-Protocol-Version': '1',
        'Content-Length': body.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks);
        if (res.statusCode === 200) {
          resolve(responseBody);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseBody.toString('utf-8').substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
    req.write(body);
    req.end();
  });
}

main();
