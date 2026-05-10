const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const path = require('path');

const port = process.argv[2] || '50052';
const PROTO_DIR = path.join(__dirname, 'protos');
const pd = protoLoader.loadSync('exa/language_server_pb/language_server.proto', {
  keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
  includeDirs: [PROTO_DIR],
});
const proto = grpc.loadPackageDefinition(pd);
const client = new proto.exa.language_server_pb.LanguageServerService(
  `127.0.0.1:${port}`, grpc.credentials.createInsecure()
);

async function runTests() {
  console.log(`Testing language server on port ${port}...\n`);
  
  // Test 1: Heartbeat
  await test('Heartbeat', cb => client.Heartbeat({}, cb));
  
  // Test 2: GetStatus
  await test('GetStatus', cb => client.GetStatus({}, cb));
  
  // Test 3: StartCascade
  await test('StartCascade', cb => client.StartCascade({
    metadata: {},
    source: 'CORTEX_TRAJECTORY_SOURCE_CHAT',
    trajectory_type: 'CORTEX_TRAJECTORY_TYPE_CASCADE',
  }, cb));
  
  // Test 4: SendUserCascadeMessage (needs cascade_id from above)
  
  // Test 5: GetCascadeModelConfigs
  await test('GetCascadeModelConfigs', cb => client.GetCascadeModelConfigs({ metadata: {} }, cb));
  
  // Test 6: GetUserSettings
  await test('GetUserSettings', cb => client.GetUserSettings({ metadata: {} }, cb));
  
  // Test 7: GetUserStatus
  await test('GetUserStatus', cb => client.GetUserStatus({ metadata: {} }, cb));
  
  console.log('\nAll tests done.');
  process.exit(0);
}

function test(name, fn) {
  return new Promise((resolve) => {
    fn((err, response) => {
      if (err) {
        console.log(`  [FAIL] ${name}: ${err.message}`);
      } else {
        const summary = JSON.stringify(response).substring(0, 120);
        console.log(`  [OK]   ${name}: ${summary}`);
      }
      resolve();
    });
  });
}

runTests();
