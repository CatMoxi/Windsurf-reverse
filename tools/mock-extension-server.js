#!/usr/bin/env node
/**
 * Mock ExtensionServer
 * 
 * Simulates the VS Code extension's ExtensionServerService.
 * The real extension starts this as an HTTP/1.1 Connect-RPC server.
 * The language_server calls back to it for IDE operations.
 * 
 * Usage:
 *   node mock-extension-server.js [--port PORT] [--csrf TOKEN]
 * 
 * This allows testing the full LS startup flow:
 *   1. Start this mock extension server
 *   2. Start the language_server with --extension_server_port
 *   3. LS calls LanguageServerStarted → we log it
 *   4. LS can call other extension methods
 */
const http = require('http');
const crypto = require('crypto');

const args = parseArgs(process.argv.slice(2));
const PORT = parseInt(args.port) || 0;
const CSRF_TOKEN = args.csrf || crypto.randomBytes(16).toString('hex');

// Track callbacks from LS
let lsStarted = false;
let lsPort = 0;

const server = http.createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end();
    return;
  }
  
  // CSRF validation
  if (req.headers['x-codeium-csrf-token'] !== CSRF_TOKEN) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Invalid CSRF token');
    return;
  }
  
  // Parse method from URL
  const parts = req.url.split('/').filter(Boolean);
  const method = parts[parts.length - 1];
  
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    handleMethod(method, body, res);
  });
});

function handleMethod(method, body, res) {
  const timestamp = new Date().toISOString().split('T')[1].slice(0, 12);
  
  switch (method) {
    case 'LanguageServerStarted': {
      // Decode the port from protobuf (field 1 = varint)
      const decoded = decodeFields(body);
      lsPort = decoded.get(1) || 0;
      const lspPort = decoded.get(2) || 0;
      const chatPort = decoded.get(3) || 0;
      lsStarted = true;
      
      console.log(`[${timestamp}] ✓ LanguageServerStarted: port=${lsPort}, lsp=${lspPort}, chat=${chatPort}`);
      console.log(`  → Language Server ready at http://127.0.0.1:${lsPort}`);
      
      // Return empty response
      res.writeHead(200, { 'Content-Type': 'application/proto' });
      res.end(Buffer.alloc(0));
      break;
    }
    
    case 'GetActiveTextEditor': {
      console.log(`[${timestamp}] → GetActiveTextEditor`);
      // Return a mock active editor
      res.writeHead(200, { 'Content-Type': 'application/proto' });
      res.end(Buffer.alloc(0)); // Empty = no active editor
      break;
    }
    
    case 'GetOpenTextDocuments': {
      console.log(`[${timestamp}] → GetOpenTextDocuments`);
      res.writeHead(200, { 'Content-Type': 'application/proto' });
      res.end(Buffer.alloc(0));
      break;
    }
    
    case 'GetWorkspaceFolders': {
      console.log(`[${timestamp}] → GetWorkspaceFolders`);
      res.writeHead(200, { 'Content-Type': 'application/proto' });
      res.end(Buffer.alloc(0));
      break;
    }
    
    case 'LogEvent': {
      console.log(`[${timestamp}] → LogEvent (${body.length}b)`);
      res.writeHead(200, { 'Content-Type': 'application/proto' });
      res.end(Buffer.alloc(0));
      break;
    }
    
    default: {
      console.log(`[${timestamp}] → ${method} (${body.length}b) [stub]`);
      res.writeHead(200, { 'Content-Type': 'application/proto' });
      res.end(Buffer.alloc(0));
      break;
    }
  }
}

server.listen(PORT, '127.0.0.1', () => {
  const boundPort = server.address().port;
  console.log('╔════════════════════════════════════════╗');
  console.log('║     Mock Extension Server              ║');
  console.log('╚════════════════════════════════════════╝');
  console.log();
  console.log(`  Listening:   http://127.0.0.1:${boundPort}`);
  console.log(`  CSRF Token:  ${CSRF_TOKEN}`);
  console.log();
  console.log('  Start the language server with:');
  console.log(`  node src/language-server/index.js \\`);
  console.log(`    --connect_mode --run_child \\`);
  console.log(`    --extension_server_port ${boundPort} \\`);
  console.log(`    --csrf_token ${CSRF_TOKEN}`);
  console.log();
  console.log('  Waiting for LanguageServerStarted callback...');
  console.log();
});

// === Helpers ===

function decodeFields(buf) {
  const fields = new Map();
  let offset = 0;
  while (offset < buf.length) {
    if (offset >= buf.length) break;
    let tag = 0, shift = 0;
    while (offset < buf.length) {
      const byte = buf[offset++];
      tag |= (byte & 0x7f) << shift;
      shift += 7;
      if ((byte & 0x80) === 0) break;
    }
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x7;
    
    if (wireType === 0) { // varint
      let value = 0; shift = 0;
      while (offset < buf.length) {
        const byte = buf[offset++];
        value |= (byte & 0x7f) << shift;
        shift += 7;
        if ((byte & 0x80) === 0) break;
      }
      fields.set(fieldNum, value);
    } else if (wireType === 2) { // length-delimited
      let len = 0; shift = 0;
      while (offset < buf.length) {
        const byte = buf[offset++];
        len |= (byte & 0x7f) << shift;
        shift += 7;
        if ((byte & 0x80) === 0) break;
      }
      fields.set(fieldNum, buf.slice(offset, offset + len).toString('utf-8'));
      offset += len;
    } else {
      break; // Unknown wire type
    }
  }
  return fields;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        result[key] = argv[++i];
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}

process.on('SIGINT', () => {
  console.log('\nShutting down mock extension server...');
  server.close();
  process.exit(0);
});
