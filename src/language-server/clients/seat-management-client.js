'use strict';

/**
 * SeatManagementService Client
 * 
 * Connect-RPC client for register.windsurf.com.
 * This is the only service the extension calls directly to the cloud
 * (bypassing the language_server).
 * 
 * Key methods:
 * - RegisterUser: Exchange firebase_id_token → api_key
 * - GetProfileData: Get user profile info
 * - GetOneTimeAuthToken: For CLI/device auth flows
 * - CreatePKCEAuthorizationCode / ExchangePKCEAuthorizationCode
 * 
 * Protocol: Connect-RPC (HTTP/1.1, binary protobuf)
 */
const https = require('https');
const { URL } = require('url');

const DEFAULT_BASE_URL = 'https://register.windsurf.com';
const SERVICE_PATH = '/exa.seat_management_pb.SeatManagementService';

class SeatManagementClient {
  constructor({ baseUrl, logger }) {
    this.baseUrl = baseUrl || DEFAULT_BASE_URL;
    this.log = logger;
  }

  /**
   * Make a Connect-RPC call to SeatManagementService
   * @param {string} method - RPC method name
   * @param {Buffer} body - Serialized protobuf request
   * @returns {Promise<Buffer>} - Serialized protobuf response
   */
  async callRaw(method, body) {
    const url = new URL(`${SERVICE_PATH}/${method}`, this.baseUrl);
    
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/proto',
          'Connect-Protocol-Version': '1',
          'Content-Length': body.length,
          'User-Agent': 'connect-es/1.4.0',
        },
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks);
          if (res.statusCode === 200) {
            resolve(responseBody);
          } else {
            const errMsg = responseBody.toString('utf-8').substring(0, 200);
            reject(new Error(`SeatManagement.${method} HTTP ${res.statusCode}: ${errMsg}`));
          }
        });
      });
      
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
      req.write(body);
      req.end();
    });
  }

  /**
   * RegisterUser - Exchange OAuth token for API key
   * @param {string} firebaseIdToken - OAuth access token from login
   * @returns {Promise<{apiKey: string, name: string, apiServerUrl: string, redirectUrl: string, teamOptions: Array}>}
   */
  async registerUser(firebaseIdToken) {
    const reqBody = encodeStringField(1, firebaseIdToken);
    const resBody = await this.callRaw('RegisterUser', reqBody);
    return decodeRegisterUserResponse(resBody);
  }

  /**
   * GetOneTimeAuthToken - Get a one-time token for device auth
   * @param {string} apiKey
   * @returns {Promise<Buffer>}
   */
  async getOneTimeAuthToken(apiKey) {
    const reqBody = encodeStringField(1, apiKey);
    return this.callRaw('GetOneTimeAuthToken', reqBody);
  }

  /**
   * GetProfileData - Get user profile information
   * @param {string} apiKey
   * @returns {Promise<Buffer>}
   */
  async getProfileData(apiKey) {
    const reqBody = encodeStringField(1, apiKey);
    return this.callRaw('GetProfileData', reqBody);
  }

  /**
   * Forward a raw Connect-RPC request to the upstream service.
   * Used by the API proxy to transparently forward requests.
   * @param {string} method - RPC method name
   * @param {Buffer} body - Raw request body
   * @param {object} headers - Original request headers to forward
   * @returns {Promise<{statusCode: number, headers: object, body: Buffer}>}
   */
  async forward(method, body, headers = {}) {
    const url = new URL(`${SERVICE_PATH}/${method}`, this.baseUrl);
    
    return new Promise((resolve, reject) => {
      const reqHeaders = {
        'Content-Type': headers['content-type'] || 'application/proto',
        'Connect-Protocol-Version': '1',
        'Content-Length': body.length,
      };
      
      // Forward auth headers if present
      if (headers['authorization']) reqHeaders['authorization'] = headers['authorization'];
      if (headers['x-api-key']) reqHeaders['x-api-key'] = headers['x-api-key'];
      
      const req = https.request({
        hostname: url.hostname,
        port: 443,
        path: url.pathname,
        method: 'POST',
        headers: reqHeaders,
      }, (res) => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      });
      
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('Request timeout')));
      req.write(body);
      req.end();
    });
  }
}

// === Proto helpers ===

function encodeVarint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return Buffer.from(bytes);
}

function decodeVarint(buf, offset) {
  let value = 0, shift = 0;
  while (offset < buf.length) {
    const byte = buf[offset++];
    value |= (byte & 0x7f) << shift;
    shift += 7;
    if ((byte & 0x80) === 0) break;
  }
  return { value, offset };
}

function encodeStringField(fieldNumber, value) {
  if (!value) return Buffer.alloc(0);
  const tag = encodeVarint((fieldNumber << 3) | 2);
  const strBuf = Buffer.from(value, 'utf-8');
  const len = encodeVarint(strBuf.length);
  return Buffer.concat([tag, len, strBuf]);
}

function decodeRegisterUserResponse(buf) {
  const fields = new Map();
  let offset = 0;
  while (offset < buf.length) {
    const tagResult = decodeVarint(buf, offset);
    offset = tagResult.offset;
    const fieldNum = tagResult.value >>> 3;
    const wireType = tagResult.value & 0x7;
    
    if (wireType === 2) { // length-delimited
      const lenResult = decodeVarint(buf, offset);
      offset = lenResult.offset;
      fields.set(fieldNum, buf.slice(offset, offset + lenResult.value).toString('utf-8'));
      offset += lenResult.value;
    } else if (wireType === 0) { // varint
      const varResult = decodeVarint(buf, offset);
      offset = varResult.offset;
    } else {
      break;
    }
  }
  
  return {
    apiKey: fields.get(1) || '',
    name: fields.get(2) || '',
    apiServerUrl: fields.get(3) || '',
    redirectUrl: fields.get(4) || '',
  };
}

module.exports = SeatManagementClient;
