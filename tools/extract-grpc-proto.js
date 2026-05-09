/**
 * Extract COMPLETE protobuf definitions with RESOLVED type references
 * v2: resolves message_ref/enum_ref to actual type names
 */
const fs = require('fs');
const path = require('path');

const sources = [
  path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'dist', 'extension.js'),
  path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'node_modules', '@exa', 'chat-client', 'index.js'),
];

const SCALAR_TYPES = {
  '1': 'double', '2': 'float', '3': 'int64', '4': 'uint64', '5': 'int32',
  '6': 'fixed64', '7': 'fixed32', '8': 'bool', '9': 'string',
  '11': 'message', '12': 'bytes', '13': 'uint32', '14': 'enum',
  '15': 'sfixed32', '16': 'sfixed64', '17': 'sint32', '18': 'sint64',
};

const allMessages = new Map();
const allEnums = new Map();
const allServices = new Map();

for (const srcPath of sources) {
  if (!fs.existsSync(srcPath)) continue;
  const c = fs.readFileSync(srcPath, 'utf-8');
  const name = path.basename(srcPath);
  console.error(`Processing ${name} (${(c.length / 1024 / 1024).toFixed(1)}MB)...`);

  // Build variable-to-typeName map for resolving references
  const typeNameMap = new Map(); // varName -> typeName
  let m;
  
  // Pattern 1: X.typeName="exa...." (chat-client style)
  const assignPat = /(\w+)\.typeName="(exa\.[^"]+)"/g;
  while ((m = assignPat.exec(c)) !== null) {
    typeNameMap.set(m[1], m[2]);
  }
  
  // Pattern 2: class X extends ... { static typeName="exa...." } (extension.js style)
  // The class variable is used in field T: references
  // We need: class VarName extends ... { ... static typeName="exa.foo.Bar" }
  const classTypePat = /class (\w+) extends[^{]*\{[^]*?static typeName="(exa\.[^"]+)"/g;
  while ((m = classTypePat.exec(c)) !== null) {
    typeNameMap.set(m[1], m[2]);
  }
  console.error(`  Found ${typeNameMap.size} type assignments`);

  // Extract message definitions with FULL field info including type references
  // Pattern 1: X.typeName="...";X.fields=... (chat-client)
  // Pattern 2: static typeName="...";static fields=... (extension.js)
  const msgPatterns = [
    /(\w+)\.typeName="([^"]+)";\s*\1\.fields=\w+\.proto3\.util\.newFieldList\(\(\)=>\[([^\]]*)\]\)/g,
    /static typeName="([^"]+)";static fields=\w+\.proto3\.util\.newFieldList\(\(\)=>\[([^\]]*)\]\)/g,
  ];
  
  for (const msgPat of msgPatterns) {
  while ((m = msgPat.exec(c)) !== null) {
    // Adapt to different capture groups
    const typeName = msgPat.source.startsWith('static') ? m[1] : m[2];
    const fieldsStr = msgPat.source.startsWith('static') ? m[2] : m[3];
    if (allMessages.has(typeName) && allMessages.get(typeName).fields.length > 0) continue;
    
    const fields = [];
    // Parse each field object carefully
    // {no:1,name:"field_name",kind:"scalar",T:9} - scalar
    // {no:2,name:"field_name",kind:"message",T:SomeVar} - message ref
    // {no:3,name:"field_name",kind:"enum",T:i.proto3.getEnumType(SomeVar)} - enum ref
    // {no:4,name:"field_name",kind:"map",K:9,V:{kind:"scalar",T:9}} - map
    
    // Use a more careful extraction
    let idx = 0;
    while (idx < fieldsStr.length) {
      const braceStart = fieldsStr.indexOf('{', idx);
      if (braceStart === -1) break;
      
      // Find matching closing brace (handling nested)
      let depth = 1;
      let braceEnd = braceStart + 1;
      while (braceEnd < fieldsStr.length && depth > 0) {
        if (fieldsStr[braceEnd] === '{') depth++;
        if (fieldsStr[braceEnd] === '}') depth--;
        braceEnd++;
      }
      
      const block = fieldsStr.substring(braceStart + 1, braceEnd - 1);
      idx = braceEnd;
      
      const field = {};
      
      // no
      const noMatch = block.match(/no:(\d+)/);
      if (!noMatch) continue;
      field.no = parseInt(noMatch[1]);
      
      // name
      const nameMatch = block.match(/name:"([^"]+)"/);
      if (!nameMatch) continue;
      field.name = nameMatch[1];
      
      // kind
      const kindMatch = block.match(/kind:"([^"]+)"/);
      field.kind = kindMatch ? kindMatch[1] : 'scalar';
      
      // repeated
      if (block.includes('repeated:!0')) field.repeated = true;
      
      // optional
      if (block.includes('opt:!0')) field.optional = true;
      
      // oneof
      const oneofMatch = block.match(/oneof:"([^"]+)"/);
      if (oneofMatch) field.oneof = oneofMatch[1];
      
      // Type resolution
      if (field.kind === 'scalar') {
        const tMatch = block.match(/,T:(\d+)/);
        field.type = tMatch ? (SCALAR_TYPES[tMatch[1]] || `type_${tMatch[1]}`) : 'unknown';
      } else if (field.kind === 'message') {
        // T:VariableName — resolve to typeName
        const tMatch = block.match(/,T:(\w+)/);
        if (tMatch) {
          const ref = tMatch[1];
          field.type = typeNameMap.get(ref) || `<unresolved:${ref}>`;
        } else {
          field.type = '<message>';
        }
      } else if (field.kind === 'enum') {
        // T:i.proto3.getEnumType(VarName) or T:SomeRef
        const enumMatch = block.match(/getEnumType\((\w+)\)/);
        if (enumMatch) {
          const ref = enumMatch[1];
          field.type = typeNameMap.get(ref) || `<enum:${ref}>`;
        } else {
          const tMatch = block.match(/,T:(\w+)/);
          field.type = tMatch ? (typeNameMap.get(tMatch[1]) || `<enum:${tMatch[1]}>`) : '<enum>';
        }
      } else if (field.kind === 'map') {
        // K:keyType, V:{kind:"...",T:...}
        const kMatch = block.match(/K:(\d+)/);
        const keyType = kMatch ? (SCALAR_TYPES[kMatch[1]] || 'int32') : 'string';
        
        // Value type
        const vKindMatch = block.match(/V:\{[^}]*kind:"([^"]+)"/);
        const vTMatch = block.match(/V:\{[^}]*T:(\w+)/);
        let valType = 'string';
        if (vKindMatch && vKindMatch[1] === 'message' && vTMatch) {
          valType = typeNameMap.get(vTMatch[1]) || `<msg:${vTMatch[1]}>`;
        } else if (vTMatch && /^\d+$/.test(vTMatch[1])) {
          valType = SCALAR_TYPES[vTMatch[1]] || 'string';
        }
        field.type = `map<${keyType}, ${valType}>`;
      }
      
      fields.push(field);
    }
    
    allMessages.set(typeName, { fields });
  }
  } // end for msgPatterns
  
  // Extract enum definitions
  // Pattern in extension.js: proto3.util.setEnumType(varName, "exa.pkg.EnumName", [{no:0,name:"..."},...])
  const setEnumPat = /\.setEnumType\(\w+,"([^"]+)",\[([^\]]*)\]\)/g;
  while ((m = setEnumPat.exec(c)) !== null) {
    const enumName = m[1];
    if (allEnums.has(enumName)) continue;
    const valuesStr = m[2];
    const values = [];
    const valPat = /\{no:(\d+),name:"([^"]+)"\}/g;
    let vm;
    while ((vm = valPat.exec(valuesStr)) !== null) {
      values.push({ no: parseInt(vm[1]), name: vm[2] });
    }
    if (values.length > 0) allEnums.set(enumName, values);
  }
  
  // Pattern in chat-client: proto3.makeEnum("name", [...])
  const makeEnumPat = /makeEnum\("([^"]+)",\s*\[([^\]]*)\]/g;
  while ((m = makeEnumPat.exec(c)) !== null) {
    const enumName = m[1];
    if (allEnums.has(enumName)) continue;
    const valuesStr = m[2];
    const values = [];
    const valPat = /\{no:(\d+),name:"([^"]+)"\}/g;
    let vm;
    while ((vm = valPat.exec(valuesStr)) !== null) {
      values.push({ no: parseInt(vm[1]), name: vm[2] });
    }
    if (values.length > 0) allEnums.set(enumName, values);
  }
  
  // Pattern: proto3.makeEnumType(()=>[...])
  const makeEnumTypePat = /(\w+)=\w+\.proto3\.makeEnumType\(\(\)=>\[([^\]]*)\]\)/g;
  while ((m = makeEnumTypePat.exec(c)) !== null) {
    const varName = m[1];
    const valuesStr = m[2];
    const enumName = typeNameMap.get(varName);
    if (!enumName || allEnums.has(enumName)) continue;
    const values = [];
    const valPat = /\{no:(\d+),name:"([^"]+)"\}/g;
    let vm;
    while ((vm = valPat.exec(valuesStr)) !== null) {
      values.push({ no: parseInt(vm[1]), name: vm[2] });
    }
    if (values.length > 0) allEnums.set(enumName, values);
  }

  // Service definitions
  const svcPat = /typeName:"([^"]+Service)",\s*methods:\s*\{/g;
  while ((m = svcPat.exec(c)) !== null) {
    const svcName = m[1];
    if (allServices.has(svcName) && allServices.get(svcName).length > 5) continue;
    
    const startIdx = m.index + m[0].length;
    let depth = 1;
    let end = startIdx;
    for (let i = startIdx; i < c.length && i < startIdx + 50000; i++) {
      if (c[i] === '{') depth++;
      if (c[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    const methodsBlock = c.substring(startIdx, end);
    
    const methods = [];
    // Try to resolve I/O types through variable names
    const methodPat = /(\w+):\{name:"([^"]+)",I:(\w+),O:(\w+),kind:\w+\.(\w+)/g;
    let mm;
    while ((mm = methodPat.exec(methodsBlock)) !== null) {
      methods.push({
        name: mm[2],
        input: typeNameMap.get(mm[3]) || mm[3],
        output: typeNameMap.get(mm[4]) || mm[4],
        kind: mm[5],
      });
    }
    if (methods.length === 0) {
      // Fallback: name-only extraction with I:X.Y pattern
      const methodPat2 = /name:"([^"]+)",I:\w+\.(\w+),O:\w+\.(\w+)/g;
      while ((mm = methodPat2.exec(methodsBlock)) !== null) {
        methods.push({ name: mm[1], input: mm[2], output: mm[3] });
      }
    }
    if (methods.length === 0) {
      const methodPat3 = /name:"([^"]+)"/g;
      while ((mm = methodPat3.exec(methodsBlock)) !== null) {
        methods.push({ name: mm[1] });
      }
    }
    
    if (methods.length > 0) allServices.set(svcName, methods);
  }
}

// Supplement LS and SM services from Request/Response pairs
for (const prefix of ['exa.language_server_pb', 'exa.seat_management_pb']) {
  const svcName = prefix + '.' + (prefix.includes('language') ? 'LanguageServerService' : 'SeatManagementService');
  const methods = [];
  for (const [typeName] of allMessages) {
    if (typeName.startsWith(prefix + '.') && typeName.endsWith('Request')) {
      const methodName = typeName.replace(prefix + '.', '').replace('Request', '');
      const respType = `${prefix}.${methodName}Response`;
      methods.push({
        name: methodName,
        input: typeName,
        output: allMessages.has(respType) ? respType : 'unknown',
        kind: 'Unary',
      });
    }
  }
  if (methods.length > (allServices.get(svcName)?.length || 0)) {
    allServices.set(svcName, methods);
  }
}

// === Output .proto files per package ===
const packages = new Map();
for (const [typeName, msg] of allMessages) {
  const parts = typeName.split('.');
  const msgName = parts.pop();
  const pkg = parts.join('.');
  if (!packages.has(pkg)) packages.set(pkg, { messages: [], enums: [], services: [] });
  packages.get(pkg).messages.push({ name: msgName, fullName: typeName, ...msg });
}
for (const [enumName, values] of allEnums) {
  const parts = enumName.split('.');
  const eName = parts.pop();
  const pkg = parts.join('.');
  if (!packages.has(pkg)) packages.set(pkg, { messages: [], enums: [], services: [] });
  packages.get(pkg).enums.push({ name: eName, fullName: enumName, values });
}
for (const [svcName, methods] of allServices) {
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

function formatField(f, pkg) {
  let typeStr;
  if (f.kind === 'map') {
    typeStr = f.type;
  } else if (f.kind === 'scalar') {
    typeStr = f.type;
  } else {
    typeStr = shortenType(f.type, pkg);
  }
  
  const prefix = f.repeated ? 'repeated ' : (f.optional ? 'optional ' : '');
  const oneof = f.oneof ? ` // oneof ${f.oneof}` : '';
  return `  ${prefix}${typeStr} ${f.name} = ${f.no};${oneof}`;
}

// Write combined proto file
let output = '';
output += `// Windsurf Next v2.2.1017 - Complete Proto Definitions (Reverse Engineered)\n`;
output += `// Auto-extracted from extension.js (9.2MB) and @exa/chat-client (13.7MB)\n`;
output += `// ${allMessages.size} messages, ${allEnums.size} enums, ${allServices.size} services, ${packages.size} packages\n`;
output += `//\n`;
output += `// NOTE: message_ref types that couldn't be resolved show as <unresolved:varName>\n`;
output += `//       These are minified variable names from the webpack bundle\n\n`;
output += `syntax = "proto3";\n\n`;

for (const [pkgName, pkg] of [...packages].sort((a, b) => a[0].localeCompare(b[0]))) {
  output += `${'/' .repeat(74)}\n`;
  output += `// package ${pkgName}\n`;
  output += `${'/' .repeat(74)}\n\n`;
  
  // Enums
  for (const e of pkg.enums.sort((a, b) => a.name.localeCompare(b.name))) {
    output += `enum ${e.name} {\n`;
    for (const v of e.values) {
      output += `  ${v.name} = ${v.no};\n`;
    }
    output += `}\n\n`;
  }
  
  // Services
  for (const s of pkg.services) {
    output += `service ${s.name} {\n`;
    for (const m of s.methods) {
      const inShort = shortenType(m.input, pkgName);
      const outShort = shortenType(m.output, pkgName);
      output += `  rpc ${m.name}(${inShort}) returns (${outShort});\n`;
    }
    output += `}\n\n`;
  }
  
  // Messages
  for (const msg of pkg.messages.sort((a, b) => a.name.localeCompare(b.name))) {
    output += `message ${msg.name} {\n`;
    
    // Group oneofs
    const oneofs = {};
    for (const f of msg.fields) {
      if (f.oneof) {
        if (!oneofs[f.oneof]) oneofs[f.oneof] = [];
        oneofs[f.oneof].push(f);
      }
    }
    
    // Regular fields (non-oneof)
    for (const f of msg.fields) {
      if (!f.oneof) {
        output += formatField(f, pkgName) + '\n';
      }
    }
    
    // Oneofs
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

const outPath = path.join(__dirname, '..', 'docs', 'windsurf-complete.proto');
fs.writeFileSync(outPath, output);

// JSON output
const jsonOut = {
  stats: { messages: allMessages.size, enums: allEnums.size, services: allServices.size, packages: packages.size },
  services: Object.fromEntries([...allServices].map(([k, v]) => [k, v])),
  enums: Object.fromEntries(allEnums),
  messages: Object.fromEntries(allMessages),
};
fs.writeFileSync(path.join(__dirname, 'proto-definitions.json'), JSON.stringify(jsonOut, null, 2));

console.log(`Done!`);
console.log(`  Messages: ${allMessages.size}`);
console.log(`  Enums: ${allEnums.size}`);
console.log(`  Services: ${allServices.size}`);
console.log(`  Packages: ${packages.size}`);
console.log(`  Proto file: ${outPath} (${(output.length / 1024).toFixed(0)}KB)`);
console.log(`  JSON file: tools/proto-definitions.json`);
