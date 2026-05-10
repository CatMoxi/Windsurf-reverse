'use strict';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_DIR = path.join(__dirname, '..', 'protos');

/**
 * ExtensionServerClient - gRPC client to call back into the IDE extension.
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
    this.client = null;
    this.connected = false;
  }

  connect() {
    if (this.connected) return;
    
    try {
      const packageDef = protoLoader.loadSync('exa/extension_server_pb/extension_server.proto', {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [PROTO_DIR],
      });
      
      const proto = grpc.loadPackageDefinition(packageDef);
      const ExtensionServerService = proto.exa.extension_server_pb.ExtensionServerService;
      
      this.client = new ExtensionServerService(
        `127.0.0.1:${this.port}`,
        grpc.credentials.createInsecure(),
        {
          'grpc.max_receive_message_length': 50 * 1024 * 1024,
          'grpc.max_send_message_length': 50 * 1024 * 1024,
        }
      );
      
      this.connected = true;
      this.log.info(`ExtensionServerClient connected to 127.0.0.1:${this.port}`);
    } catch (err) {
      this.log.error(`ExtensionServerClient connect failed: ${err.message}`);
    }
  }

  getMetadata() {
    const metadata = new grpc.Metadata();
    if (this.csrfToken) {
      metadata.set('x-codeium-csrf-token', this.csrfToken);
    }
    return metadata;
  }

  /**
   * Generic call to ExtensionServerService
   */
  call(method, request = {}) {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        return reject(new Error('ExtensionServerClient not connected'));
      }
      
      const fn = this.client[method];
      if (!fn) {
        return reject(new Error(`Unknown ExtensionServer method: ${method}`));
      }
      
      fn.call(this.client, request, this.getMetadata(), (err, response) => {
        if (err) {
          this.log.error(`ExtServer.${method} error: ${err.message}`);
          return reject(err);
        }
        resolve(response);
      });
    });
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
   */
  async notifyStarted(port) {
    return this.call('LanguageServerStarted', {
      port: port,
    });
  }
}

module.exports = ExtensionServerClient;
