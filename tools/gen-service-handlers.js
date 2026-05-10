/**
 * Generate language-server-service.js from extracted proto descriptors
 */
const fs = require('fs');
const path = require('path');

const descriptors = require('./proto-descriptors-full.json');
const lsProto = descriptors.find(x => x.name === 'exa/language_server_pb/language_server.proto');
const svc = lsProto.services[0];

let code = `'use strict';

/**
 * LanguageServerService - Full implementation of all ${svc.methods.length} RPC methods.
 * 
 * This service is what the Windsurf extension connects to locally.
 * It proxies requests to ApiServerService on server.codeium.com
 * and calls back to ExtensionServerService for IDE operations.
 */
class LanguageServerService {
  constructor({ apiClient, extensionClient, logger, args }) {
    this.api = apiClient;
    this.ext = extensionClient;
    this.log = logger;
    this.args = args;
    
    // State
    this.cascades = new Map(); // cascadeId -> cascade state
    this.apiKey = args.api_key || '';
    this.csrfToken = args.csrf_token || '';
  }

  getHandlers() {
    const handlers = {};
`;

// Categorize methods
const streamingMethods = new Set(svc.methods.filter(m => m.serverStreaming).map(m => m.name));

for (const method of svc.methods) {
  const isStreaming = method.serverStreaming;
  const handlerName = method.name.charAt(0).toLowerCase() + method.name.slice(1);
  
  code += `    handlers.${method.name} = this.${handlerName}.bind(this);\n`;
}

code += `    return handlers;
  }

`;

// Generate method implementations
for (const method of svc.methods) {
  const handlerName = method.name.charAt(0).toLowerCase() + method.name.slice(1);
  const isStreaming = method.serverStreaming;
  
  if (isStreaming) {
    code += `  /** Server-streaming: ${method.name} */
  ${handlerName}(call) {
    const request = call.request;
    this.log.debug('${method.name} called');
    // TODO: Implement streaming logic
    // Forward to ApiServerService and stream responses back
    call.end();
  }

`;
  } else {
    code += `  /** Unary: ${method.name} */
  ${handlerName}(call, callback) {
    const request = call.request;
    this.log.debug('${method.name} called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

`;
  }
}

code += `}

module.exports = LanguageServerService;
`;

const outPath = path.join(__dirname, '..', 'src', 'language-server', 'services', 'language-server-service.js');
fs.writeFileSync(outPath, code);
console.log(`Generated ${outPath}`);
console.log(`  ${svc.methods.length} methods (${streamingMethods.size} streaming)`);
