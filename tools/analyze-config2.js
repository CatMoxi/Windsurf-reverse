const fs = require('fs');
const c = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/dist/extension.js', 'utf-8');

// Find the full Config enum with all defaults
const defApiIdx = c.indexOf('DEFAULT_API_SERVER_URL],[');
if (defApiIdx >= 0) {
  const start = Math.max(0, defApiIdx - 400);
  console.log('=== Config defaults table ===');
  console.log(c.substring(start, defApiIdx + 800));
}

// Find C enum definition (the Config enum)
// Look for: C = { API_SERVER_URL: "...", WEBSITE: "...", ... }
// Or: (function(C) { C["API_SERVER_URL"] = ... })
const cEnumPat = /C\["(\w+)"\]\s*=\s*["']([^"']+)["']/g;
let m;
console.log('\n=== C enum values ===');
while ((m = cEnumPat.exec(c)) !== null) {
  if (m[1].match(/^[A-Z_]+$/)) {
    console.log(`  ${m[1]} = ${m[2]}`);
  }
}

// Find SeatManagementService proto definition
const seatMgmtPat = /SeatManagementService[^;]*typeName[^;]*/g;
while ((m = seatMgmtPat.exec(c)) !== null) {
  console.log('\n=== SeatManagementService def ===');
  console.log(m[0].substring(0, 500));
  break;
}

// Find registerUser RPC method definition
const regUserPat = /registerUser[^;]*method[^;]*/g;
while ((m = regUserPat.exec(c)) !== null) {
  const ctx = m[0];
  if (ctx.includes('proto') || ctx.includes('field') || ctx.includes('kind')) {
    console.log('\n=== registerUser RPC ===');
    console.log(ctx.substring(0, 500));
    break;
  }
}

// Find RegisterUserRequest / RegisterUserResponse proto
const regReqPat = /RegisterUser(?:Request|Response)/g;
const regTypes = new Set();
while ((m = regReqPat.exec(c)) !== null) regTypes.add(m[0]);
console.log('\n=== RegisterUser types: ' + [...regTypes].join(', '));

// Find proto message for RegisterUser
const firstRegIdx = c.indexOf('RegisterUserRequest');
if (firstRegIdx >= 0) {
  console.log('\n=== RegisterUserRequest context ===');
  console.log(c.substring(Math.max(0, firstRegIdx - 200), firstRegIdx + 600));
}
