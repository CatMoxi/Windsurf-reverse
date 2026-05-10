'use strict';

/**
 * gRPC Server Middleware
 * 
 * Wraps all service handlers with logging, timing, and error handling.
 * Produces structured logs for debugging and traffic analysis.
 */

/**
 * Wrap all handlers in a service definition with middleware
 * @param {object} handlers - Map of method name → handler function
 * @param {object} options
 * @param {object} options.logger - Winston logger instance
 * @param {boolean} [options.logPayloads=false] - Log request/response payloads
 * @param {function} [options.onRequest] - Hook called on every request
 * @param {function} [options.onResponse] - Hook called on every response
 * @returns {object} Wrapped handlers
 */
function wrapWithMiddleware(handlers, options = {}) {
  const { logger, logPayloads = false, onRequest, onResponse } = options;
  const wrapped = {};
  
  for (const [name, handler] of Object.entries(handlers)) {
    // Detect if it's a streaming handler (takes only `call`) or unary (takes `call, callback`)
    const isStreaming = handler.length === 1;
    
    if (isStreaming) {
      wrapped[name] = createStreamingWrapper(name, handler, options);
    } else {
      wrapped[name] = createUnaryWrapper(name, handler, options);
    }
  }
  
  return wrapped;
}

function createUnaryWrapper(name, handler, { logger, logPayloads, onRequest, onResponse }) {
  return function(call, callback) {
    const startTime = Date.now();
    const peer = call.getPeer();
    
    // Log request
    if (logPayloads) {
      logger.debug(`→ ${name} from ${peer}`, { request: summarize(call.request) });
    } else {
      logger.debug(`→ ${name} from ${peer}`);
    }
    
    if (onRequest) {
      try { onRequest(name, call.request, call.metadata); } catch(e) {}
    }
    
    // Wrap callback to intercept response
    const wrappedCallback = (err, response) => {
      const elapsed = Date.now() - startTime;
      
      if (err) {
        logger.warn(`✗ ${name} ${elapsed}ms error: ${err.message || err.code}`);
      } else {
        if (logPayloads) {
          logger.debug(`← ${name} ${elapsed}ms`, { response: summarize(response) });
        } else {
          logger.debug(`← ${name} ${elapsed}ms OK`);
        }
      }
      
      if (onResponse) {
        try { onResponse(name, err, response, elapsed); } catch(e) {}
      }
      
      callback(err, response);
    };
    
    try {
      handler(call, wrappedCallback);
    } catch (e) {
      logger.error(`✗ ${name} EXCEPTION: ${e.message}`);
      callback({ code: 13, message: e.message });
    }
  };
}

function createStreamingWrapper(name, handler, { logger, logPayloads, onRequest, onResponse }) {
  return function(call) {
    const startTime = Date.now();
    const peer = call.getPeer();
    let chunkCount = 0;
    
    logger.debug(`→ ${name} [STREAM] from ${peer}`);
    
    if (onRequest) {
      try { onRequest(name, call.request, call.metadata); } catch(e) {}
    }
    
    // Wrap call.write to count chunks
    const origWrite = call.write.bind(call);
    call.write = function(chunk) {
      chunkCount++;
      return origWrite(chunk);
    };
    
    // Wrap call.end to log completion
    const origEnd = call.end.bind(call);
    call.end = function() {
      const elapsed = Date.now() - startTime;
      logger.debug(`← ${name} [STREAM] ${elapsed}ms (${chunkCount} chunks)`);
      if (onResponse) {
        try { onResponse(name, null, { chunks: chunkCount }, elapsed); } catch(e) {}
      }
      return origEnd();
    };
    
    // Handle cancellation
    call.on('cancelled', () => {
      const elapsed = Date.now() - startTime;
      logger.debug(`← ${name} [STREAM] CANCELLED ${elapsed}ms (${chunkCount} chunks)`);
    });
    
    try {
      handler(call);
    } catch (e) {
      logger.error(`✗ ${name} [STREAM] EXCEPTION: ${e.message}`);
      call.destroy(e);
    }
  };
}

/**
 * Create a compact summary of a protobuf message for logging
 */
function summarize(obj, maxDepth = 2, currentDepth = 0) {
  if (obj === null || obj === undefined) return null;
  if (currentDepth >= maxDepth) return '{...}';
  if (Buffer.isBuffer(obj)) return `[Buffer ${obj.length}b]`;
  if (typeof obj === 'string') return obj.length > 100 ? obj.substring(0, 100) + '...' : obj;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return [];
    return `[${obj.length} items]`;
  }
  if (typeof obj === 'object') {
    const result = {};
    const keys = Object.keys(obj);
    for (const k of keys.slice(0, 10)) {
      result[k] = summarize(obj[k], maxDepth, currentDepth + 1);
    }
    if (keys.length > 10) result['...'] = `+${keys.length - 10} more`;
    return result;
  }
  return obj;
}

module.exports = { wrapWithMiddleware, summarize };
