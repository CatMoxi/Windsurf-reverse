const fs = require('fs');
const c = fs.readFileSync('windsurf-next/resources/app/extensions/windsurf/dist/extension.js', 'utf-8');

// Full SeatManagementService definition
const seatIdx = c.indexOf('SeatManagementService={typeName');
if (seatIdx >= 0) {
  // Find the closing bracket
  let depth = 0;
  let end = seatIdx;
  for (let i = seatIdx; i < c.length && i < seatIdx + 5000; i++) {
    if (c[i] === '{') depth++;
    if (c[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  console.log('=== SeatManagementService FULL ===');
  console.log(c.substring(seatIdx, end));
}

// Find RegisterUserRequest fields
const regReqPat = /class\s+\w+[^{]*RegisterUserRequest|RegisterUserRequest[^;]*fields/g;
let m;
while ((m = regReqPat.exec(c)) !== null) {
  console.log('\n=== RegisterUserRequest fields ===');
  console.log(c.substring(m.index, m.index + 400));
  break;
}

// Find RegisterUserResponse fields
const regRespPat = /RegisterUserResponse[^;]*fields/g;
while ((m = regRespPat.exec(c)) !== null) {
  console.log('\n=== RegisterUserResponse fields ===');
  console.log(c.substring(m.index, m.index + 500));
  break;
}

// Find Metadata proto message (has api_key field)
const metaIdx = c.indexOf('"exa.codeium_common_pb.Metadata"');
if (metaIdx >= 0) {
  console.log('\n=== Metadata proto ===');
  console.log(c.substring(Math.max(0, metaIdx - 200), metaIdx + 600));
}

// Find all service typeName definitions
const svcPat = /typeName:"exa\.[^"]+Service"/g;
const services = new Set();
while ((m = svcPat.exec(c)) !== null) services.add(m[0]);
console.log('\n=== All exa services ===');
[...services].sort().forEach(s => console.log(s));
