'use strict';

const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createLogger, format, transports } = require('winston');

// Parse CLI arguments (same as original language_server)
const args = parseArgs(process.argv.slice(2));

const logger = createLogger({
  level: args.debug ? 'debug' : 'info',
  format: format.combine(
    format.timestamp({ format: 'HH:mm:ss.SSS' }),
    format.printf(({ timestamp, level, message }) => `[${timestamp}] ${level}: ${message}`)
  ),
  transports: [new transports.Console()],
});

logger.info('Windsurf Language Server (reverse-engineered)');
logger.info(`API Server: ${args.api_server_url || 'https://server.codeium.com'}`);
logger.info(`Extension Server Port: ${args.extension_server_port || 'not set'}`);

// Proto loading configuration
const PROTO_DIR = path.join(__dirname, 'protos');
const PROTO_LOADER_OPTS = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [PROTO_DIR],
};

// Load proto definitions
const languageServerProto = loadProto('exa/language_server_pb/language_server.proto');
const extensionServerProto = loadProto('exa/extension_server_pb/extension_server.proto');
const apiServerProto = loadProto('exa/api_server_pb/api_server.proto');

// Service implementations
const LanguageServerHandlers = require('./services/language-server-service');
const ApiServerClient = require('./clients/api-server-client');
const ExtensionServerClient = require('./clients/extension-server-client');

// Initialize clients
const apiClient = new ApiServerClient({
  address: args.api_server_url || 'https://server.codeium.com',
  apiKey: args.api_key || '',
  logger,
});

let extensionClient = null;
if (args.extension_server_port) {
  extensionClient = new ExtensionServerClient({
    port: args.extension_server_port,
    csrfToken: args.csrf_token || '',
    logger,
  });
}

// Create gRPC server
const server = new grpc.Server({
  'grpc.max_receive_message_length': 100 * 1024 * 1024,
  'grpc.max_send_message_length': 100 * 1024 * 1024,
});

// Register LanguageServerService
const lsService = languageServerProto.exa.language_server_pb.LanguageServerService.service;
const handlers = new LanguageServerHandlers({ apiClient, extensionClient, logger, args });
server.addService(lsService, handlers.getHandlers());

// Start server
const port = args.port || 0; // 0 = random port (like original)
server.bindAsync(
  `127.0.0.1:${port}`,
  grpc.ServerCredentials.createInsecure(),
  (err, boundPort) => {
    if (err) {
      logger.error(`Failed to bind: ${err.message}`);
      process.exit(1);
    }
    logger.info(`gRPC server listening on 127.0.0.1:${boundPort}`);
    
    // Output port for the extension to connect
    // The original language_server outputs: "Server listening on port XXXXX"
    console.log(`Server listening on port ${boundPort}`);
    
    // Connect to extension server
    if (extensionClient) {
      extensionClient.connect();
    }
  }
);

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  server.tryShutdown(() => process.exit(0));
});

process.on('SIGTERM', () => {
  server.tryShutdown(() => process.exit(0));
});

// === Helpers ===

function loadProto(protoPath) {
  const packageDef = protoLoader.loadSync(protoPath, PROTO_LOADER_OPTS);
  return grpc.loadPackageDefinition(packageDef);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx !== -1) {
        result[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        result[key] = argv[++i];
      } else {
        result[key] = true;
      }
    }
  }
  return result;
}
