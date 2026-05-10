'use strict';

const http = require('http');

const SERVICE_PATH = '/exa.extension_server_pb.ExtensionServerService';

/**
 * ExtensionServerClient - Connect-RPC client to call back into the IDE extension.
 * 
 * CRITICAL: The real extension server uses Connect-RPC (HTTP/1.1 + proto binary),
 * NOT standard gRPC (HTTP/2). This client matches that protocol.
 * 
 * The Windsurf extension runs an ExtensionServerService that the language
 * server calls for IDE operations like:
 * - GetActiveDocument, GetOpenDocuments
 * - ApplyDiff, ShowDiff, AcceptDiff
 * - RunTerminalCommand
 * - ShowNotification, ShowProgress
 * - GetWorkspaceFolders, StatFile, ReadFile
 * - OpenUrl, RevealRange
 * 
 * 49 methods total (all unary).
 */
class ExtensionServerClient {
  constructor({ port, csrfToken, logger }) {
    this.port = port;
    this.csrfToken = csrfToken;
    this.log = logger;
    this.connected = false;
  }

  connect() {
    if (this.connected) return;
    this.connected = true;
    this.log.info(`ExtensionServerClient ready (Connect-RPC → 127.0.0.1:${this.port})`);
  }

  /**
   * Generic Connect-RPC call to ExtensionServerService
   * Uses HTTP/1.1 POST with binary protobuf body
   */
  call(method, request = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        return reject(new Error('ExtensionServerClient not connected'));
      }
      
      // Minimal protobuf encoding for known field types
      const body = this._encodeRequest(method, request);
      
      const req = http.request({
        hostname: '127.0.0.1',
        port: this.port,
        path: `${SERVICE_PATH}/${method}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/proto',
          'Connect-Protocol-Version': '1',
          'x-codeium-csrf-token': this.csrfToken || '',
          'Content-Length': body.length,
        },
      }, (res) => {
        const chunks = [];
        res.on('data', d => chunks.push(d));
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve(Buffer.concat(chunks));
          } else {
            const errBody = Buffer.concat(chunks).toString('utf-8').substring(0, 200);
            this.log.error(`ExtServer.${method} HTTP ${res.statusCode}: ${errBody}`);
            reject(new Error(`ExtServer.${method} failed: HTTP ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', (err) => {
        this.log.error(`ExtServer.${method} error: ${err.message}`);
        reject(err);
      });
      
      req.setTimeout(10000, () => {
        req.destroy(new Error('ExtServer request timeout'));
      });
      
      req.write(body);
      req.end();
    });
  }
  
  /**
   * Encode a request object to minimal protobuf binary.
   * Handles common field types: int32 (varint), string (length-delimited).
   */
  _encodeRequest(method, request) {
    const parts = [];
    // Simple field encoding based on known message schemas
    for (const [key, value] of Object.entries(request)) {
      if (value === undefined || value === null) continue;
      const fieldNum = this._getFieldNumber(method, key);
      if (fieldNum === 0) continue;
      
      if (typeof value === 'number') {
        // Varint encoding (wire type 0)
        parts.push(this._encodeVarintField(fieldNum, value));
      } else if (typeof value === 'string') {
        // Length-delimited (wire type 2)
        parts.push(this._encodeStringField(fieldNum, value));
      }
    }
    return parts.length > 0 ? Buffer.concat(parts) : Buffer.alloc(0);
  }
  
  /**
   * Get field number for known message types.
   * Based on proto definitions in docs/protos/exa_extension_server_pb_extension_server.proto
   */
  _getFieldNumber(method, key) {
    const FIELD_MAP = {
      'LanguageServerStarted': {
        'language_server_port': 1,
        'lsp_port': 2,
        'chat_client_port': 3,
        'csrf_token': 4,
      },
      'OpenSetting': { 'setting_id': 1 },
      'OpenUrl': { 'url': 1 },
      'ReadTextDocument': { 'uri': 1 },
      'StatFile': { 'uri': 1 },
      'GetConfiguration': { 'section': 1 },
    };
    return FIELD_MAP[method]?.[key] || 0;
  }
  
  _encodeVarint(value) {
    const bytes = [];
    value = value >>> 0; // Ensure unsigned
    while (value > 0x7f) {
      bytes.push((value & 0x7f) | 0x80);
      value >>>= 7;
    }
    bytes.push(value & 0x7f);
    return Buffer.from(bytes);
  }
  
  _encodeVarintField(fieldNum, value) {
    const tag = this._encodeVarint((fieldNum << 3) | 0);
    const val = this._encodeVarint(value);
    return Buffer.concat([tag, val]);
  }
  
  _encodeStringField(fieldNum, value) {
    const tag = this._encodeVarint((fieldNum << 3) | 2);
    const strBuf = Buffer.from(value, 'utf-8');
    const len = this._encodeVarint(strBuf.length);
    return Buffer.concat([tag, len, strBuf]);
  }

  // Frequently-used IDE callback methods

  async getActiveDocument() {
    return this.call('GetActiveTextEditor');
  }

  async getOpenDocuments() {
    return this.call('GetOpenTextDocuments');
  }

  async getWorkspaceFolders() {
    return this.call('GetWorkspaceFolders');
  }

  async readFile(uri) {
    return this.call('ReadTextDocument', { uri });
  }

  async applyDiff(request) {
    return this.call('ApplyDiff', request);
  }

  async showDiff(request) {
    return this.call('ShowDiff', request);
  }

  async acceptDiff(request) {
    return this.call('AcceptDiff', request);
  }

  async rejectDiff(request) {
    return this.call('RejectDiff', request);
  }

  async runTerminalCommand(request) {
    return this.call('RunTerminalCommand', request);
  }

  async showNotification(request) {
    return this.call('ShowNotification', request);
  }

  async openUrl(url) {
    return this.call('OpenUrl', { url });
  }

  async statFile(uri) {
    return this.call('StatFile', { uri });
  }

  async getConfiguration(section) {
    return this.call('GetConfiguration', { section });
  }

  /**
   * Notify ExtensionServer that the Language Server has started.
   * This is the callback the extension waits for (60s timeout).
   * The real LS sends this after binding its gRPC port.
   * 
   * LanguageServerStartedRequest:
   *   language_server_port: int32 (field 1)
   *   lsp_port: int32 (field 2)
   *   chat_client_port: int32 (field 3)
   *   csrf_token: string (field 4)
   */
  async notifyStarted({ languageServerPort, lspPort, chatClientPort, csrfToken }) {
    return this.call('LanguageServerStarted', {
      language_server_port: languageServerPort,
      lsp_port: lspPort || 0,
      chat_client_port: chatClientPort || 0,
      csrf_token: csrfToken || '',
    });
  }
}

module.exports = ExtensionServerClient;
