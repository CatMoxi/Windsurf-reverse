'use strict';

/**
 * Connect-RPC Server for the Language Server
 * 
 * The real language_server uses Connect-RPC (HTTP/1.1 + binary protobuf),
 * NOT standard gRPC (HTTP/2). This module provides a Connect-RPC compatible
 * HTTP/1.1 server that the extension.js can connect to.
 * 
 * Protocol: Connect-RPC binary
 * - POST /{service}/{method}
 * - Content-Type: application/proto
 * - Connect-Protocol-Version: 1
 * - Request body: protobuf binary
 * - Response body: protobuf binary (unary) or SSE chunks (streaming)
 * 
 * For streaming responses:
 * - Content-Type: application/connect+proto
 * - Body: length-prefixed protobuf frames
 *   - Each frame: flags(1 byte) + length(4 bytes big-endian) + data
 *   - flags=0 for data, flags=2 for trailer
 * 
 * This replaces the gRPC server for extension compatibility.
 */
const http = require('http');
const path = require('path');

// Lazy-loaded proto codec (avoids circular deps)
let codec = null;
function getCodec() {
  if (!codec) {
    try { codec = require('./proto-codec'); } catch (e) { codec = null; }
  }
  return codec;
}

/**
 * Create a Connect-RPC HTTP/1.1 server
 * 
 * @param {object} options
 * @param {string} options.csrfToken - Expected CSRF token (validates requests)
 * @param {object} options.handlers - Map of method name → handler function
 * @param {object} options.logger
 * @param {object} [options.protoDecoder] - Proto decoder for request/response parsing
 * @returns {http.Server}
 */
function createConnectServer({ csrfToken, handlers, logger, protoDecoder }) {
  const server = http.createServer();
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port already in use: ${err.address}:${err.port}`);
    } else {
      logger.error(`Server error: ${err.message}`);
    }
    process.exit(1);
  });
  
  server.on('request', (req, res) => {
    // Only POST is used in Connect-RPC
    if (req.method !== 'POST') {
      res.writeHead(405);
      res.end();
      return;
    }
    
    // CSRF validation (matches real ExtensionServer behavior)
    if (csrfToken && req.headers['x-codeium-csrf-token'] !== csrfToken) {
      logger.warn(`CSRF validation failed from ${req.socket.remoteAddress}`);
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Invalid CSRF token');
      return;
    }
    
    // Parse service/method from path
    // Path: /exa.language_server_pb.LanguageServerService/GetCompletions
    const parts = req.url.split('/').filter(Boolean);
    if (parts.length < 2) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'not_found', message: 'Invalid path' }));
      return;
    }
    
    const serviceName = parts[parts.length - 2];
    const methodName = parts[parts.length - 1];
    
    // Find handler
    const handler = handlers[methodName];
    if (!handler) {
      logger.debug(`Unknown method: ${serviceName}/${methodName}`);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: 'unimplemented', message: `Method ${methodName} not found` }));
      return;
    }
    
    const contentType = req.headers['content-type'] || '';
    const isBinary = contentType.includes('proto');
    const isStreaming = handler._streaming === true;
    
    // Collect request body
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      
      // Decode request body from protobuf binary
      let request = {};
      if (isBinary && body.length > 0) {
        const c = getCodec();
        if (c) {
          try {
            request = c.decodeRequest(methodName, body);
          } catch (e) {
            request = { _raw: body };
          }
        } else if (protoDecoder) {
          try {
            request = protoDecoder.decodeRequest(methodName, body);
          } catch (e) {
            request = { _raw: body };
          }
        } else {
          request = { _raw: body };
        }
      } else if (body.length > 0) {
        request = { _raw: body };
      }
      
      const startTime = Date.now();
      
      if (isStreaming) {
        handleStreamingRequest(req, res, methodName, request, handler, logger);
      } else {
        handleUnaryRequest(req, res, methodName, request, handler, logger, startTime);
      }
    });
  });
  
  return server;
}

/**
 * Handle a unary Connect-RPC request
 */
function handleUnaryRequest(req, res, methodName, request, handler, logger, startTime) {
  // Create a mock call object compatible with gRPC-style handlers
  const call = {
    request,
    metadata: parseMetadata(req.headers),
    getPeer: () => req.socket.remoteAddress || 'unknown',
  };
  
  const callback = (err, response) => {
    const elapsed = Date.now() - startTime;
    
    if (err) {
      logger.debug(`← ${methodName} ERROR ${elapsed}ms: ${err.message}`);
      const code = err.code || 'internal';
      res.writeHead(err.httpStatus || 500, {
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ code, message: err.message }));
      return;
    }
    
    // Encode response object to protobuf binary
    let responseBody = Buffer.alloc(0);
    const c = getCodec();
    if (c && response) {
      responseBody = c.encodeResponse(methodName, response);
    }
    
    res.writeHead(200, {
      'Content-Type': 'application/proto',
      'Connect-Protocol-Version': '1',
    });
    res.end(responseBody);
    logger.debug(`← ${methodName} ${elapsed}ms OK`);
  };
  
  try {
    handler(call, callback);
  } catch (e) {
    logger.error(`${methodName} EXCEPTION: ${e.message}`);
    callback({ code: 'internal', message: e.message, httpStatus: 500 });
  }
}

/**
 * Handle a streaming Connect-RPC request
 * Uses the Connect-RPC streaming binary framing:
 * - flags (1 byte): 0=data, 2=trailer
 * - length (4 bytes, big-endian)
 * - payload (protobuf binary)
 */
function handleStreamingRequest(req, res, methodName, request, handler, logger) {
  res.writeHead(200, {
    'Content-Type': 'application/connect+proto',
    'Connect-Protocol-Version': '1',
    'Transfer-Encoding': 'chunked',
  });
  
  // Create a mock streaming call object
  let ended = false;
  const call = {
    request,
    metadata: parseMetadata(req.headers),
    getPeer: () => req.socket.remoteAddress || 'unknown',
    write(message) {
      if (ended) return;
      // Encode response message as protobuf binary, then wrap in streaming frame
      let payload = Buffer.alloc(0);
      if (message && typeof message === 'object') {
        const c = getCodec();
        if (c) {
          payload = c.encodeResponse(methodName, message);
        }
      } else if (Buffer.isBuffer(message)) {
        payload = message;
      }
      const frame = encodeStreamFrame(0, payload);
      try { res.write(frame); } catch (e) {}
    },
    end() {
      if (ended) return;
      ended = true;
      try {
        // Write trailer frame
        const trailer = Buffer.from(JSON.stringify({}), 'utf-8');
        const frame = encodeStreamFrame(2, trailer);
        res.write(frame);
        res.end();
      } catch (e) {}
    },
    on(event, cb) {
      if (event === 'cancelled') {
        req.on('close', () => { ended = true; cb(); });
        req.on('aborted', () => { ended = true; cb(); });
      }
    },
    destroy(err) {
      if (!ended) { ended = true; try { res.end(); } catch(e) {} }
    },
  };
  
  try {
    handler(call);
  } catch (e) {
    logger.error(`${methodName} [STREAM] EXCEPTION: ${e.message}`);
    res.end();
  }
}

/**
 * Encode a Connect-RPC stream frame
 * @param {number} flags - 0 for data, 2 for trailer
 * @param {Buffer} payload - Frame payload
 * @returns {Buffer}
 */
function encodeStreamFrame(flags, payload) {
  const header = Buffer.alloc(5);
  header.writeUInt8(flags, 0);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

/**
 * Parse request headers into a metadata-like object
 */
function parseMetadata(headers) {
  return {
    get(key) { return headers[key.toLowerCase()]; },
    set(key, value) { headers[key.toLowerCase()] = value; },
    getMap() { return headers; },
  };
}

/**
 * Mark a handler as streaming
 */
function streaming(handler) {
  handler._streaming = true;
  return handler;
}

module.exports = { createConnectServer, streaming, encodeStreamFrame };
