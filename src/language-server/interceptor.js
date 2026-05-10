'use strict';

/**
 * gRPC Traffic Interceptor
 * 
 * Sits between Windsurf extension.js and the real language_server,
 * capturing all Connect-RPC traffic for analysis.
 * 
 * Architecture:
 *   extension.js → [THIS PROXY :3100] → [real language_server :PORT]
 * 
 * Features:
 * - Logs all RPC method calls with request/response sizes
 * - Decodes protobuf payloads using our extracted proto definitions
 * - Saves traffic captures to JSON files for offline analysis
 * - Supports server-streaming RPCs (SSE format)
 * 
 * Usage:
 *   node interceptor.js --target-port 42100 --listen-port 3100 --log-dir ./captures
 *   
 *   Then configure Windsurf to connect to port 3100 instead of the real LS port.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// Parse args
const args = parseArgs(process.argv.slice(2));
const TARGET_PORT = parseInt(args.target_port || args.t || '0');
const LISTEN_PORT = parseInt(args.listen_port || args.l || '3100');
const LOG_DIR = args.log_dir || args.d || path.join(__dirname, 'captures');
const VERBOSE = args.verbose || args.v || false;
const DECODE = args.decode !== 'false'; // decode proto by default

if (!TARGET_PORT) {
  console.error('Usage: node interceptor.js --target-port <PORT> [--listen-port 3100] [--log-dir ./captures]');
  console.error('  --target-port  Port of the real language_server to proxy to');
  console.error('  --listen-port  Port to listen on (default: 3100)');
  console.error('  --log-dir      Directory for traffic captures (default: ./captures)');
  console.error('  --verbose      Log full request/response bodies');
  console.error('  --decode false Skip proto decoding');
  process.exit(1);
}

// Create log directory
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Proto decoder (lazy loaded)
let protoDecoder = null;
if (DECODE) {
  try {
    protoDecoder = require('./proto-decoder');
  } catch (e) {
    console.warn('[interceptor] Proto decoder not available, logging raw bytes');
  }
}

// Session log
const sessionId = new Date().toISOString().replace(/[:.]/g, '-');
const sessionLog = path.join(LOG_DIR, `session-${sessionId}.jsonl`);
const sessionStream = fs.createWriteStream(sessionLog, { flags: 'a' });

let requestCounter = 0;

// Stats tracking
const stats = {
  totalRequests: 0,
  methodCounts: {},
  totalBytesIn: 0,
  totalBytesOut: 0,
  errors: 0,
  startTime: Date.now(),
};

// Create proxy server
const server = http.createServer(async (req, res) => {
  const reqId = ++requestCounter;
  const startTime = Date.now();
  
  // Extract RPC method from path
  // Connect-RPC format: POST /exa.language_server_pb.LanguageServerService/MethodName
  const rpcMethod = extractRpcMethod(req.url);
  const contentType = req.headers['content-type'] || '';
  const isStreaming = contentType.includes('connect+streaming');
  const isBinary = contentType.includes('proto');
  
  stats.totalRequests++;
  stats.methodCounts[rpcMethod] = (stats.methodCounts[rpcMethod] || 0) + 1;

  // Collect request body
  const reqChunks = [];
  req.on('data', chunk => reqChunks.push(chunk));
  
  req.on('end', () => {
    const reqBody = Buffer.concat(reqChunks);
    stats.totalBytesIn += reqBody.length;
    
    // Log request
    const logEntry = {
      id: reqId,
      timestamp: new Date().toISOString(),
      method: rpcMethod,
      httpMethod: req.method,
      path: req.url,
      contentType,
      isStreaming,
      requestSize: reqBody.length,
      headers: filterHeaders(req.headers),
    };
    
    // Try to decode request proto
    if (DECODE && protoDecoder && isBinary && reqBody.length > 0) {
      try {
        logEntry.requestDecoded = protoDecoder.decodeRequest(rpcMethod, reqBody);
      } catch (e) {
        logEntry.requestDecodeError = e.message;
      }
    }
    
    if (VERBOSE) {
      logEntry.requestHex = reqBody.toString('hex').substring(0, 2000);
    }
    
    console.log(`[${reqId}] → ${rpcMethod} (${reqBody.length}b)${isStreaming ? ' [STREAM]' : ''}`);
    
    // Forward to real language_server
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: TARGET_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${TARGET_PORT}`,
      },
    }, (proxyRes) => {
      const isStreamingResponse = (proxyRes.headers['content-type'] || '').includes('connect+streaming');
      
      // Forward response headers
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      
      if (isStreamingResponse) {
        // For streaming responses, collect and log chunks in real-time
        let totalResponseSize = 0;
        let chunkCount = 0;
        
        proxyRes.on('data', (chunk) => {
          totalResponseSize += chunk.length;
          chunkCount++;
          res.write(chunk);
          
          // Log each streaming chunk
          if (VERBOSE) {
            const chunkEntry = {
              id: reqId,
              type: 'stream_chunk',
              chunkIndex: chunkCount,
              chunkSize: chunk.length,
              hex: chunk.toString('hex').substring(0, 500),
            };
            sessionStream.write(JSON.stringify(chunkEntry) + '\n');
          }
        });
        
        proxyRes.on('end', () => {
          res.end();
          const elapsed = Date.now() - startTime;
          stats.totalBytesOut += totalResponseSize;
          
          logEntry.responseSize = totalResponseSize;
          logEntry.streamChunks = chunkCount;
          logEntry.elapsed = elapsed;
          logEntry.status = proxyRes.statusCode;
          
          sessionStream.write(JSON.stringify(logEntry) + '\n');
          console.log(`[${reqId}] ← ${rpcMethod} ${proxyRes.statusCode} (${totalResponseSize}b, ${chunkCount} chunks, ${elapsed}ms)`);
        });
      } else {
        // For unary responses, collect full body
        const resChunks = [];
        proxyRes.on('data', chunk => resChunks.push(chunk));
        proxyRes.on('end', () => {
          const resBody = Buffer.concat(resChunks);
          stats.totalBytesOut += resBody.length;
          res.end(resBody);
          
          const elapsed = Date.now() - startTime;
          logEntry.responseSize = resBody.length;
          logEntry.elapsed = elapsed;
          logEntry.status = proxyRes.statusCode;
          
          // Try to decode response proto
          if (DECODE && protoDecoder && isBinary && resBody.length > 0) {
            try {
              logEntry.responseDecoded = protoDecoder.decodeResponse(rpcMethod, resBody);
            } catch (e) {
              logEntry.responseDecodeError = e.message;
            }
          }
          
          if (VERBOSE) {
            logEntry.responseHex = resBody.toString('hex').substring(0, 2000);
          }
          
          sessionStream.write(JSON.stringify(logEntry) + '\n');
          console.log(`[${reqId}] ← ${rpcMethod} ${proxyRes.statusCode} (${resBody.length}b, ${elapsed}ms)`);
        });
      }
    });
    
    proxyReq.on('error', (err) => {
      stats.errors++;
      logEntry.error = err.message;
      sessionStream.write(JSON.stringify(logEntry) + '\n');
      console.error(`[${reqId}] ✗ ${rpcMethod}: ${err.message}`);
      res.writeHead(502);
      res.end(JSON.stringify({ error: err.message }));
    });
    
    proxyReq.write(reqBody);
    proxyReq.end();
  });
});

server.listen(LISTEN_PORT, '127.0.0.1', () => {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  Windsurf gRPC Traffic Interceptor                   ║`);
  console.log(`╠══════════════════════════════════════════════════════╣`);
  console.log(`║  Listen:  127.0.0.1:${LISTEN_PORT}                          ║`);
  console.log(`║  Target:  127.0.0.1:${TARGET_PORT}                          ║`);
  console.log(`║  Log:     ${sessionLog.substring(0, 42).padEnd(42)}║`);
  console.log(`║  Decode:  ${DECODE ? 'ON ' : 'OFF'}                                        ║`);
  console.log(`║  Verbose: ${VERBOSE ? 'ON ' : 'OFF'}                                        ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);
});

// Print stats on exit
process.on('SIGINT', () => {
  const elapsed = ((Date.now() - stats.startTime) / 1000).toFixed(1);
  console.log(`\n=== Session Stats (${elapsed}s) ===`);
  console.log(`Total requests: ${stats.totalRequests}`);
  console.log(`Total bytes: ${(stats.totalBytesIn / 1024).toFixed(1)}KB in, ${(stats.totalBytesOut / 1024).toFixed(1)}KB out`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`\nTop methods:`);
  Object.entries(stats.methodCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .forEach(([method, count]) => console.log(`  ${count}x ${method}`));
  
  // Save final stats
  const statsPath = path.join(LOG_DIR, `stats-${sessionId}.json`);
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));
  console.log(`\nStats saved to ${statsPath}`);
  console.log(`Traffic log: ${sessionLog}`);
  
  sessionStream.end();
  process.exit(0);
});

// === Helpers ===

function extractRpcMethod(url) {
  // /exa.language_server_pb.LanguageServerService/GetCompletions → GetCompletions
  const parts = url.split('/');
  if (parts.length >= 3) {
    return parts[parts.length - 1];
  }
  return url;
}

function filterHeaders(headers) {
  const filtered = {};
  const keep = ['content-type', 'connect-protocol-version', 'x-codeium-csrf-token', 
                'x-api-key', 'connect-content-encoding', 'connect-accept-encoding'];
  for (const k of keep) {
    if (headers[k]) filtered[k] = headers[k];
  }
  return filtered;
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2).replace(/-/g, '_');
      const eqIdx = key.indexOf('=');
      if (eqIdx !== -1) {
        result[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        result[key] = argv[++i];
      } else {
        result[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      result[arg.slice(1)] = argv[++i] || true;
    }
  }
  return result;
}
