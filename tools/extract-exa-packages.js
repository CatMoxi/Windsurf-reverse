#!/usr/bin/env node
/**
 * Deep extraction of @exa private packages (chat-client + windsurf-acp)
 */
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'node_modules', '@exa');

function analyzeBundle(name) {
  const filepath = path.join(BASE, name, 'index.js');
  if (!fs.existsSync(filepath)) { console.log('SKIP:', name); return; }
  const content = fs.readFileSync(filepath, 'utf-8');
  console.log(`\n${'='.repeat(70)}`);
  console.log(`PACKAGE: @exa/${name} (${(content.length/1024/1024).toFixed(2)} MB, ${content.split('\n').length} lines)`);

  // Export names
  const exports = [...new Set([...content.matchAll(/export\s+(?:const|let|var|function|class|type|interface|enum)\s+(\w+)/g)].map(m => m[1]))];
  if (exports.length) {
    console.log(`\n--- Exports (${exports.length}) ---`);
    exports.sort().forEach(e => console.log('  ' + e));
  }

  // Service/Client class names
  const classes = [...new Set([...content.matchAll(/(?:class|const)\s+(\w*(?:Service|Client|Provider|Handler|Manager|Controller|Factory|Registry|Codec|Transport|Channel)\w*)\b/g)].map(m => m[1]))];
  if (classes.length) {
    console.log(`\n--- Service/Client Classes (${classes.length}) ---`);
    classes.sort().forEach(c => console.log('  ' + c));
  }

  // RPC method names
  const rpcMethods = [...new Set([...content.matchAll(/["'](\w+)["']\s*:\s*\{[^}]*(?:kind|requestStream|responseStream|requestType|responseType)/g)].map(m => m[1]))];
  if (rpcMethods.length) {
    console.log(`\n--- RPC Methods (${rpcMethods.length}) ---`);
    rpcMethods.sort().forEach(m => console.log('  ' + m));
  }

  // Connect-RPC service definitions
  const connectServices = [...new Set([...content.matchAll(/typeName:\s*["']([^"']+)["']/g)].map(m => m[1]))];
  if (connectServices.length) {
    console.log(`\n--- Connect-RPC Service TypeNames (${connectServices.length}) ---`);
    connectServices.sort().forEach(s => console.log('  ' + s));
  }

  // Proto message types
  const protoTypes = [...new Set([...content.matchAll(/(?:typeName|messageType|requestType|responseType):\s*["']([^"']+)["']/g)].map(m => m[1]))];
  if (protoTypes.length) {
    console.log(`\n--- Proto Message Types (${protoTypes.length}) ---`);
    protoTypes.sort().forEach(t => console.log('  ' + t));
  }

  // URLs
  const urls = [...new Set([...content.matchAll(/["'](https?:\/\/[^"'\s]+)["']/g)].map(m => m[1]))];
  if (urls.length) {
    console.log(`\n--- URLs (${urls.length}) ---`);
    urls.sort().forEach(u => console.log('  ' + u));
  }

  // String constants that look like service/method paths
  const servicePaths = [...new Set([...content.matchAll(/["']((?:exa|codeium|windsurf|cognition)\.[a-z_]+\.[A-Z]\w+)["']/g)].map(m => m[1]))];
  if (servicePaths.length) {
    console.log(`\n--- Service Paths (${servicePaths.length}) ---`);
    servicePaths.sort().forEach(p => console.log('  ' + p));
  }

  // API/method path patterns
  const apiPaths = [...new Set([...content.matchAll(/["'](\/(?:exa|codeium|windsurf|Exa|Codeium)[\w./]+)["']/g)].map(m => m[1]))];
  if (apiPaths.length) {
    console.log(`\n--- API Paths (${apiPaths.length}) ---`);
    apiPaths.sort().forEach(p => console.log('  ' + p));
  }

  // Protobuf field definitions (looking for field number assignments)
  const protoFields = [...new Set([...content.matchAll(/(?:proto3\.field|proto\.Field|fieldNo|field_number).*?["'](\w+)["']/g)].map(m => m[1]))];
  
  // Event/message types
  const eventTypes = [...new Set([...content.matchAll(/["']((?:CHAT_MESSAGE|CASCADE|CORTEX|TRAJECTORY|STEP|TOOL|PLANNER|BRAIN|HOOK|MCP|ACP|ARENA|WORKFLOW|SKILL|MEMORY|RULE)\w*)["']/g)].map(m => m[1]))];
  if (eventTypes.length) {
    console.log(`\n--- Event/Message Type Constants (${eventTypes.length}) ---`);
    eventTypes.sort().forEach(e => console.log('  ' + e));
  }

  // Enum-like constants
  const enumValues = [...new Set([...content.matchAll(/(\w+)\s*=\s*(\d+)\s*[,;]/g)].map(m => `${m[1]} = ${m[2]}`))];
  const wsEnums = enumValues.filter(e => /CASCADE|CORTEX|CHAT|TRAJECTORY|WINDSURF|ACP|MCP|TOOL|PLANNER|BRAIN|ARENA/i.test(e));
  if (wsEnums.length) {
    console.log(`\n--- Windsurf-related Enum Values (${wsEnums.length}) ---`);
    wsEnums.sort().forEach(e => console.log('  ' + e));
  }

  // ACP specific patterns
  const acpPatterns = [...new Set([...content.matchAll(/["'](cognition\.ai\/[^"']+)["']/g)].map(m => m[1]))];
  if (acpPatterns.length) {
    console.log(`\n--- ACP Capability Patterns (${acpPatterns.length}) ---`);
    acpPatterns.sort().forEach(p => console.log('  ' + p));
  }

  // MCP related
  const mcpPatterns = [...new Set([...content.matchAll(/["']((?:mcp|tools|resources|prompts|sampling|logging|roots|initialize|notifications)\/[^"']+)["']/g)].map(m => m[1]))];
  if (mcpPatterns.length) {
    console.log(`\n--- MCP Protocol Paths (${mcpPatterns.length}) ---`);
    mcpPatterns.sort().forEach(p => console.log('  ' + p));
  }

  // Function definitions containing windsurf/cascade/cortex/acp
  const wsFunctions = [...new Set([...content.matchAll(/(?:function|const|let|var)\s+((?:windsurf|cascade|cortex|acp|devin|codeium)\w*)/gi)].map(m => m[1]))];
  if (wsFunctions.length) {
    console.log(`\n--- Windsurf Functions/Variables (${wsFunctions.length}) ---`);
    wsFunctions.sort().forEach(f => console.log('  ' + f));
  }

  // Header/metadata keys
  const headers = [...new Set([...content.matchAll(/["']((?:x-|X-|authorization|content-type|accept|windsurf|codeium|devin)[\w-]*)["']/gi)].map(m => m[1]))];
  if (headers.length) {
    console.log(`\n--- HTTP Headers (${headers.length}) ---`);
    headers.sort().forEach(h => console.log('  ' + h));
  }

  // Streaming patterns
  const streamPatterns = [...new Set([...content.matchAll(/(ServerStream|ClientStream|BidiStream|stream\w+|Stream\w+Response|Stream\w+Request)/g)].map(m => m[0]))];
  if (streamPatterns.length) {
    console.log(`\n--- Streaming Patterns (${streamPatterns.length}) ---`);
    streamPatterns.sort().forEach(p => console.log('  ' + p));
  }

  return content;
}

const chatContent = analyzeBundle('chat-client');
const acpContent = analyzeBundle('windsurf-acp');

// Cross-reference: find shared types between packages
if (chatContent && acpContent) {
  const chatTypes = new Set([...chatContent.matchAll(/typeName:\s*["']([^"']+)["']/g)].map(m => m[1]));
  const acpTypes = new Set([...acpContent.matchAll(/typeName:\s*["']([^"']+)["']/g)].map(m => m[1]));
  const shared = [...chatTypes].filter(t => acpTypes.has(t));
  if (shared.length) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`SHARED TYPES between chat-client and windsurf-acp (${shared.length})`);
    shared.sort().forEach(t => console.log('  ' + t));
  }
}
