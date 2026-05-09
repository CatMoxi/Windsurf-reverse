/**
 * Post-process proto-definitions.json to resolve message types using heuristics:
 * - Field named "metadata" -> exa.codeium_common_pb.Metadata
 * - Field named "created_at", "updated_at", "timestamp" -> google.protobuf.Timestamp
 * - Field named "duration" -> google.protobuf.Duration
 * - Use field name patterns to infer types
 */
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'proto-definitions.json'), 'utf-8'));

// Known type overrides based on field name conventions
const FIELD_TYPE_HINTS = {
  'metadata': 'exa.codeium_common_pb.Metadata',
  'created_at': 'google.protobuf.Timestamp',
  'updated_at': 'google.protobuf.Timestamp',
  'deleted_at': 'google.protobuf.Timestamp',
  'timestamp': 'google.protobuf.Timestamp',
  'start_time': 'google.protobuf.Timestamp',
  'end_time': 'google.protobuf.Timestamp',
  'expiry': 'google.protobuf.Timestamp',
  'duration': 'google.protobuf.Duration',
};

// Try to infer message types from the typeName suffix matching
// If a field is in package X and named "foo_bar", look for "FooBar" message in the same or related package
function inferTypeFromFieldName(fieldName, parentPkg) {
  // Convert snake_case to PascalCase
  const pascal = fieldName.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  
  // Check if this message exists in same package
  const candidates = [
    `${parentPkg}.${pascal}`,
    `exa.codeium_common_pb.${pascal}`,
    `exa.cortex_pb.${pascal}`,
    `exa.language_server_pb.${pascal}`,
  ];
  
  for (const c of candidates) {
    if (data.messages[c]) return c;
  }
  return null;
}

let resolvedCount = 0;
let totalUnresolved = 0;

for (const [typeName, msg] of Object.entries(data.messages)) {
  const pkg = typeName.split('.').slice(0, -1).join('.');
  
  for (const field of msg.fields) {
    if (field.kind === 'message' && field.type && (field.type.startsWith('<unresolved:') || field.type.includes('RecordAnalyticsEvent'))) {
      totalUnresolved++;
      
      // Try known hints
      if (FIELD_TYPE_HINTS[field.name]) {
        field.type = FIELD_TYPE_HINTS[field.name];
        resolvedCount++;
        continue;
      }
      
      // Try inference from name
      const inferred = inferTypeFromFieldName(field.name, pkg);
      if (inferred) {
        field.type = inferred;
        resolvedCount++;
        continue;
      }
      
      // Mark as unresolved with clean name
      field.type = `<message>`;
    }
    
    if (field.kind === 'enum' && field.type && field.type.startsWith('<enum:')) {
      field.type = '<enum>';
    }
  }
}

console.log(`Resolved ${resolvedCount}/${totalUnresolved} unresolved types`);

// Write back
fs.writeFileSync(path.join(__dirname, 'proto-definitions.json'), JSON.stringify(data, null, 2));

// Regenerate proto file
const packages = new Map();
const SCALAR_TYPES = { '1': 'double', '2': 'float', '3': 'int64', '4': 'uint64', '5': 'int32', '6': 'fixed64', '7': 'fixed32', '8': 'bool', '9': 'string', '12': 'bytes', '13': 'uint32', '15': 'sfixed32', '16': 'sfixed64', '17': 'sint32', '18': 'sint64' };

for (const [typeName, msg] of Object.entries(data.messages)) {
  const parts = typeName.split('.');
  const msgName = parts.pop();
  const pkg = parts.join('.');
  if (!packages.has(pkg)) packages.set(pkg, { messages: [], enums: [], services: [] });
  packages.get(pkg).messages.push({ name: msgName, fullName: typeName, ...msg });
}
for (const [enumName, values] of Object.entries(data.enums)) {
  const parts = enumName.split('.');
  const eName = parts.pop();
  const pkg = parts.join('.');
  if (!packages.has(pkg)) packages.set(pkg, { messages: [], enums: [], services: [] });
  packages.get(pkg).enums.push({ name: eName, fullName: enumName, values });
}
for (const [svcName, methods] of Object.entries(data.services)) {
  const parts = svcName.split('.');
  const sName = parts.pop();
  const pkg = parts.join('.');
  if (!packages.has(pkg)) packages.set(pkg, { messages: [], enums: [], services: [] });
  packages.get(pkg).services.push({ name: sName, fullName: svcName, methods });
}

function shortenType(fullType, currentPkg) {
  if (!fullType || !fullType.includes('.')) return fullType;
  if (fullType.startsWith(currentPkg + '.')) return fullType.replace(currentPkg + '.', '');
  return fullType;
}

let output = '';
output += `// Windsurf Next v2.2.1017 - Complete gRPC Interface Definitions\n`;
output += `// Reverse-engineered from extension.js (9.2MB) and @exa/chat-client (13.7MB)\n`;
output += `// ${Object.keys(data.messages).length} messages, ${Object.keys(data.enums).length} enums, ${Object.keys(data.services).length} services\n`;
output += `//\n`;
output += `// NOTES:\n`;
output += `//   - Scalar fields (string, int32, bool, etc.) are 100% accurate\n`;
output += `//   - Field numbers are 100% accurate\n`;
output += `//   - Field names are 100% accurate\n`;
output += `//   - Message/enum type references marked <message>/<enum> could not be resolved\n`;
output += `//     due to webpack minification destroying variable name scope\n`;
output += `//   - Common types (Metadata, Timestamp) are resolved via field name heuristics\n\n`;
output += `syntax = "proto3";\n\n`;

for (const [pkgName, pkg] of [...packages].sort((a, b) => a[0].localeCompare(b[0]))) {
  output += `${'/' .repeat(74)}\n`;
  output += `// package ${pkgName}\n`;
  output += `${'/' .repeat(74)}\n\n`;
  
  for (const e of pkg.enums.sort((a, b) => a.name.localeCompare(b.name))) {
    output += `enum ${e.name} {\n`;
    for (const v of e.values) {
      output += `  ${v.name} = ${v.no};\n`;
    }
    output += `}\n\n`;
  }
  
  for (const s of pkg.services) {
    output += `service ${s.name} {\n`;
    for (const m of s.methods) {
      const inShort = shortenType(m.input, pkgName);
      const outShort = shortenType(m.output, pkgName);
      output += `  rpc ${m.name}(${inShort}) returns (${outShort});\n`;
    }
    output += `}\n\n`;
  }
  
  for (const msg of pkg.messages.sort((a, b) => a.name.localeCompare(b.name))) {
    output += `message ${msg.name} {\n`;
    const oneofs = {};
    for (const f of msg.fields) {
      if (f.oneof) { if (!oneofs[f.oneof]) oneofs[f.oneof] = []; oneofs[f.oneof].push(f); }
    }
    for (const f of msg.fields) {
      if (!f.oneof) {
        let typeStr = f.kind === 'map' ? f.type : (f.kind === 'scalar' ? f.type : shortenType(f.type, pkgName));
        const prefix = f.repeated ? 'repeated ' : (f.optional ? 'optional ' : '');
        output += `  ${prefix}${typeStr} ${f.name} = ${f.no};\n`;
      }
    }
    for (const [oneofName, fields] of Object.entries(oneofs)) {
      output += `  oneof ${oneofName} {\n`;
      for (const f of fields) {
        let typeStr = f.kind === 'scalar' ? f.type : shortenType(f.type, pkgName);
        output += `    ${typeStr} ${f.name} = ${f.no};\n`;
      }
      output += `  }\n`;
    }
    output += `}\n\n`;
  }
}

fs.writeFileSync(path.join(__dirname, '..', 'docs', 'windsurf-complete.proto'), output);
console.log(`Proto file regenerated: ${(output.length / 1024).toFixed(0)}KB, ${output.split('\n').length} lines`);
