const fs = require('fs');
const c = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/dist/extension.js', 'utf-8');

// Find RegisterUserRequest proto definition with fields
// Look for typeName:"exa.seat_management_pb.RegisterUserRequest"
const regReqTypeIdx = c.indexOf('RegisterUserRequest');
// Search all occurrences for the one with typeName
let idx = 0;
while (true) {
  idx = c.indexOf('RegisterUserRequest', idx);
  if (idx === -1) break;
  const ctx = c.substring(idx, idx + 600);
  if (ctx.includes('typeName') || ctx.includes('fields') || ctx.includes('proto3')) {
    console.log('=== RegisterUserRequest (at ' + idx + ') ===');
    console.log(ctx);
    console.log('---');
  }
  idx += 20;
}

// Same for RegisterUserResponse
idx = 0;
while (true) {
  idx = c.indexOf('RegisterUserResponse', idx);
  if (idx === -1) break;
  const ctx = c.substring(idx, idx + 600);
  if (ctx.includes('typeName') || ctx.includes('fields') || ctx.includes('proto3')) {
    console.log('=== RegisterUserResponse (at ' + idx + ') ===');
    console.log(ctx);
    console.log('---');
  }
  idx += 20;
}

// Find the SeatManagement service methods more carefully
idx = c.indexOf('SeatManagementService');
let found = false;
while (idx >= 0 && !found) {
  const ctx = c.substring(idx, idx + 3000);
  if (ctx.includes('methods:{') || ctx.includes('methods:')) {
    console.log('=== SeatManagementService methods ===');
    // Extract just the methods section
    const methodsStart = ctx.indexOf('methods:');
    if (methodsStart >= 0) {
      let depth = 0;
      let end = methodsStart;
      let started = false;
      for (let i = methodsStart; i < ctx.length; i++) {
        if (ctx[i] === '{') { depth++; started = true; }
        if (ctx[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
      }
      console.log(ctx.substring(methodsStart, end));
    }
    found = true;
  }
  idx = c.indexOf('SeatManagementService', idx + 20);
}

// Find GetAuthTokenRequest
idx = 0;
while (true) {
  idx = c.indexOf('GetAuthTokenRequest', idx);
  if (idx === -1) break;
  const ctx = c.substring(idx, idx + 500);
  if (ctx.includes('typeName') || ctx.includes('fields')) {
    console.log('\n=== GetAuthTokenRequest ===');
    console.log(ctx);
    break;
  }
  idx += 20;
}

// Find GetAuthTokenResponse
idx = 0;
while (true) {
  idx = c.indexOf('GetAuthTokenResponse', idx);
  if (idx === -1) break;
  const ctx = c.substring(idx, idx + 500);
  if (ctx.includes('typeName') || ctx.includes('fields')) {
    console.log('\n=== GetAuthTokenResponse ===');
    console.log(ctx);
    break;
  }
  idx += 20;
}
