'use strict';

/**
 * Proto Decoder - decodes captured Connect-RPC traffic using extracted proto definitions.
 * 
 * Uses @grpc/proto-loader to load our extracted .proto files and
 * provides request/response decoding for any LanguageServerService method.
 */
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const PROTO_DIR = path.join(__dirname, 'protos');
const PROTO_OPTS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: false,
  oneofs: true,
  includeDirs: [PROTO_DIR],
};

// Load all service protos
const protos = {};
const serviceMethodMap = {}; // method name → { requestType, responseType }

function loadServiceProto(protoFile, servicePath) {
  try {
    const packageDef = protoLoader.loadSync(protoFile, PROTO_OPTS);
    const proto = grpc.loadPackageDefinition(packageDef);
    
    // Navigate to the service
    const parts = servicePath.split('.');
    let svc = proto;
    for (const p of parts) {
      svc = svc[p];
      if (!svc) return;
    }
    
    if (!svc.service) return;
    
    // Map method names to their types
    for (const [methodName, methodDef] of Object.entries(svc.service)) {
      serviceMethodMap[methodName] = {
        requestType: methodDef.requestType,
        responseType: methodDef.responseType,
        requestStream: methodDef.requestStream,
        responseStream: methodDef.responseStream,
        fullPath: `${servicePath}/${methodName}`,
      };
    }
    
    protos[servicePath] = svc;
  } catch (e) {
    // Some protos may have unresolvable deps, skip silently
  }
}

// Load core services
loadServiceProto('exa/language_server_pb/language_server.proto', 'exa.language_server_pb.LanguageServerService');
loadServiceProto('exa/extension_server_pb/extension_server.proto', 'exa.extension_server_pb.ExtensionServerService');
loadServiceProto('exa/api_server_pb/api_server.proto', 'exa.api_server_pb.ApiServerService');
loadServiceProto('exa/seat_management_pb/seat_management.proto', 'exa.seat_management_pb.SeatManagementService');
loadServiceProto('exa/dev_pb/dev.proto', 'exa.dev_pb.DevService');

console.log(`[proto-decoder] Loaded ${Object.keys(serviceMethodMap).length} RPC methods from ${Object.keys(protos).length} services`);

/**
 * Decode a Connect-RPC request body
 * @param {string} methodName - RPC method name (e.g., "GetCompletions")
 * @param {Buffer} body - Raw protobuf-encoded request body
 * @returns {object} Decoded message
 */
function decodeRequest(methodName, body) {
  const methodInfo = serviceMethodMap[methodName];
  if (!methodInfo) {
    return { _error: `Unknown method: ${methodName}`, _size: body.length };
  }
  
  try {
    const RequestType = methodInfo.requestType;
    const decoded = RequestType.decode(body);
    return sanitizeForJson(decoded);
  } catch (e) {
    return { _error: e.message, _size: body.length, _hex: body.toString('hex').substring(0, 200) };
  }
}

/**
 * Decode a Connect-RPC response body
 * @param {string} methodName - RPC method name
 * @param {Buffer} body - Raw protobuf-encoded response body
 * @returns {object} Decoded message
 */
function decodeResponse(methodName, body) {
  const methodInfo = serviceMethodMap[methodName];
  if (!methodInfo) {
    return { _error: `Unknown method: ${methodName}`, _size: body.length };
  }
  
  try {
    const ResponseType = methodInfo.responseType;
    const decoded = ResponseType.decode(body);
    return sanitizeForJson(decoded);
  } catch (e) {
    return { _error: e.message, _size: body.length, _hex: body.toString('hex').substring(0, 200) };
  }
}

/**
 * Get method info
 */
function getMethodInfo(methodName) {
  return serviceMethodMap[methodName] || null;
}

/**
 * List all known methods
 */
function listMethods() {
  return Object.keys(serviceMethodMap).sort();
}

/**
 * Clean decoded protobuf for JSON serialization
 * (handles Buffers, Longs, etc.)
 */
function sanitizeForJson(obj, depth = 0) {
  if (depth > 15) return '[max depth]';
  if (obj === null || obj === undefined) return obj;
  if (Buffer.isBuffer(obj)) return `[Buffer ${obj.length}b]`;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(v => sanitizeForJson(v, depth + 1));
  if (typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_')) continue; // skip internal fields
      result[k] = sanitizeForJson(v, depth + 1);
    }
    return result;
  }
  return obj;
}

module.exports = {
  decodeRequest,
  decodeResponse,
  getMethodInfo,
  listMethods,
  serviceMethodMap,
};
