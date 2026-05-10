'use strict';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_DIR = path.join(__dirname, '..', 'protos');

/**
 * ApiServerClient - gRPC client for server.codeium.com
 * 
 * This is what the original language_server uses to communicate
 * with the Codeium cloud. It implements 171 RPC methods covering:
 * - AI completions (GetChatCompletions, GetStreamingCompletions)
 * - Model management (GetCascadeModelConfigs, AssignModel)
 * - Code review (CheckBugs, RunCodeAlignment)
 * - Telemetry (Record* methods)
 * - App deployment (CreateWindsurfJSApp, DeployWindsurfJSApp)
 * - Search (GetWebSearchResults)
 */
class ApiServerClient {
  constructor({ address, apiKey, logger }) {
    this.address = address;
    this.apiKey = apiKey;
    this.log = logger;
    this.client = null;
    this.connected = false;
  }

  connect() {
    if (this.connected) return;
    
    try {
      const packageDef = protoLoader.loadSync('exa/api_server_pb/api_server.proto', {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
        includeDirs: [PROTO_DIR],
      });
      
      const proto = grpc.loadPackageDefinition(packageDef);
      const ApiServerService = proto.exa.api_server_pb.ApiServerService;
      
      // Parse address
      let target = this.address;
      let credentials;
      
      if (target.startsWith('https://')) {
        target = target.replace('https://', '');
        credentials = grpc.credentials.createSsl();
      } else if (target.startsWith('http://')) {
        target = target.replace('http://', '');
        credentials = grpc.credentials.createInsecure();
      } else {
        credentials = grpc.credentials.createSsl();
      }
      
      // Add port if not present
      if (!target.includes(':')) {
        target += ':443';
      }
      
      this.client = new ApiServerService(target, credentials, {
        'grpc.max_receive_message_length': 100 * 1024 * 1024,
        'grpc.max_send_message_length': 100 * 1024 * 1024,
      });
      
      this.connected = true;
      this.log.info(`ApiServerClient connected to ${target}`);
    } catch (err) {
      this.log.error(`ApiServerClient connect failed: ${err.message}`);
    }
  }

  /**
   * Get gRPC metadata with authentication headers
   */
  getMetadata() {
    const metadata = new grpc.Metadata();
    if (this.apiKey) {
      metadata.set('authorization', `Basic ${this.apiKey}-user`);
      metadata.set('x-api-key', this.apiKey);
    }
    return metadata;
  }

  /**
   * Make a unary RPC call to ApiServerService
   */
  call(method, request) {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        this.connect();
      }
      if (!this.client) {
        return reject(new Error('ApiServerClient not connected'));
      }
      
      const fn = this.client[method];
      if (!fn) {
        return reject(new Error(`Unknown method: ${method}`));
      }
      
      fn.call(this.client, request, this.getMetadata(), (err, response) => {
        if (err) {
          this.log.error(`API.${method} error: ${err.message}`);
          return reject(err);
        }
        resolve(response);
      });
    });
  }

  /**
   * Make a server-streaming RPC call to ApiServerService
   * Returns an async generator of response messages
   */
  stream(method, request) {
    if (!this.client) {
      this.connect();
    }
    if (!this.client) {
      throw new Error('ApiServerClient not connected');
    }
    
    const fn = this.client[method];
    if (!fn) {
      throw new Error(`Unknown method: ${method}`);
    }
    
    return fn.call(this.client, request, this.getMetadata());
  }

  /**
   * Convenience methods for frequently-used API calls
   */
  
  async getCompletions(request) {
    return this.call('GetCompletions', request);
  }

  async getChatCompletions(request) {
    return this.call('GetChatCompletions', request);
  }

  streamChatCompletions(request) {
    return this.stream('GetStreamingCompletions', request);
  }

  async getCascadeModelConfigs(request) {
    return this.call('GetCascadeModelConfigs', request);
  }

  async recordEvent(request) {
    return this.call('RecordEvent', request);
  }

  async getWebSearchResults(request) {
    return this.call('GetWebSearchResults', request);
  }
}

module.exports = ApiServerClient;
