'use strict';

/**
 * Proto Codec - Full protobuf encode/decode using protobufjs.
 * 
 * Unlike proto-decoder.js (which uses @grpc/proto-loader and can only decode),
 * this module uses protobufjs directly to provide both encode and decode
 * with proper Type objects.
 * 
 * Used by connect-server.js to:
 * - Decode incoming Connect-RPC request bodies into JS objects
 * - Encode outgoing response objects into protobuf binary
 */
const protobuf = require('protobufjs');
const path = require('path');

const PROTO_DIR = path.join(__dirname, 'protos');

// Protobufjs root with custom resolver
const root = new protobuf.Root();
root.resolvePath = (origin, target) => path.resolve(PROTO_DIR, target);

// Load all service protos
const PROTO_FILES = [
  'exa/language_server_pb/language_server.proto',
  'exa/extension_server_pb/extension_server.proto',
  'exa/api_server_pb/api_server.proto',
  'exa/seat_management_pb/seat_management.proto',
  'exa/dev_pb/dev.proto',
];

let loadError = null;
try {
  for (const f of PROTO_FILES) {
    root.loadSync(path.resolve(PROTO_DIR, f));
  }
} catch (e) {
  loadError = e.message;
}

// Build method → type map from service definitions
const methodTypes = new Map(); // methodName → { requestType, responseType, streaming }

function indexService(servicePath) {
  try {
    const svc = root.lookupService(servicePath);
    for (const method of svc.methodsArray) {
      const reqType = root.lookupType(method.resolvedRequestType.fullName);
      const resType = root.lookupType(method.resolvedResponseType.fullName);
      methodTypes.set(method.name, {
        requestType: reqType,
        responseType: resType,
        streaming: method.responseStream || false,
        service: servicePath,
      });
    }
  } catch (e) {
    // Service may not be fully loaded
  }
}

indexService('exa.language_server_pb.LanguageServerService');
indexService('exa.dev_pb.DevService');
indexService('exa.extension_server_pb.ExtensionServerService');
indexService('exa.api_server_pb.ApiServerService');
indexService('exa.seat_management_pb.SeatManagementService');

const methodCount = methodTypes.size;

/**
 * Decode a protobuf request body into a JS object.
 * @param {string} methodName - RPC method name
 * @param {Buffer} body - Raw protobuf binary
 * @returns {object} Decoded message (camelCase field names)
 */
function decodeRequest(methodName, body) {
  const info = methodTypes.get(methodName);
  if (!info) return { _raw: body };
  
  try {
    const msg = info.requestType.decode(body);
    return info.requestType.toObject(msg, {
      longs: String,
      enums: String,
      bytes: Buffer,
      defaults: false,
    });
  } catch (e) {
    return { _error: e.message, _raw: body };
  }
}

/**
 * Decode a protobuf response body into a JS object.
 * @param {string} methodName - RPC method name
 * @param {Buffer} body - Raw protobuf binary
 * @returns {object} Decoded message
 */
function decodeResponse(methodName, body) {
  const info = methodTypes.get(methodName);
  if (!info) return { _raw: body };
  
  try {
    const msg = info.responseType.decode(body);
    return info.responseType.toObject(msg, {
      longs: String,
      enums: String,
      bytes: Buffer,
      defaults: false,
    });
  } catch (e) {
    return { _error: e.message, _raw: body };
  }
}

/**
 * Encode a response object to protobuf binary.
 * @param {string} methodName - RPC method name
 * @param {object} responseObj - Response data (camelCase fields)
 * @returns {Buffer} Encoded protobuf binary
 */
function encodeResponse(methodName, responseObj) {
  const info = methodTypes.get(methodName);
  if (!info) return Buffer.alloc(0);
  
  try {
    const msg = info.responseType.fromObject(responseObj || {});
    return Buffer.from(info.responseType.encode(msg).finish());
  } catch (e) {
    return Buffer.alloc(0);
  }
}

/**
 * Encode a request object to protobuf binary.
 * @param {string} methodName - RPC method name
 * @param {object} requestObj - Request data (camelCase fields)
 * @returns {Buffer} Encoded protobuf binary
 */
function encodeRequest(methodName, requestObj) {
  const info = methodTypes.get(methodName);
  if (!info) return Buffer.alloc(0);
  
  try {
    const msg = info.requestType.fromObject(requestObj || {});
    return Buffer.from(info.requestType.encode(msg).finish());
  } catch (e) {
    return Buffer.alloc(0);
  }
}

/**
 * Check if a method exists and whether it's streaming.
 * @param {string} methodName
 * @returns {{streaming: boolean, service: string}|null}
 */
function getMethodInfo(methodName) {
  return methodTypes.get(methodName) || null;
}

/**
 * Get all method names.
 * @returns {string[]}
 */
function listMethods() {
  return [...methodTypes.keys()].sort();
}

/**
 * Get the protobufjs Type for a response (useful for stream encoding).
 * @param {string} methodName
 * @returns {protobuf.Type|null}
 */
function getResponseType(methodName) {
  const info = methodTypes.get(methodName);
  return info ? info.responseType : null;
}

/**
 * Get the protobufjs Type for a request.
 * @param {string} methodName
 * @returns {protobuf.Type|null}
 */
function getRequestType(methodName) {
  const info = methodTypes.get(methodName);
  return info ? info.requestType : null;
}

module.exports = {
  decodeRequest,
  decodeResponse,
  encodeRequest,
  encodeResponse,
  getMethodInfo,
  getRequestType,
  getResponseType,
  listMethods,
  methodCount,
  loadError,
  root,
};
