/**
 * Extract ALL protobuf FileDescriptorProto from Go binary.
 * 
 * Key insight: In this Go binary, all FileDescriptorProto are serialized
 * back-to-back in a single contiguous blob in the .rodata section.
 * We find the blob by locating a known proto filename, then parse
 * ALL descriptors sequentially.
 */
const fs = require('fs');
const path = require('path');

const binPath = path.join(__dirname, '..', 'windsurf-next', 'resources', 'app', 'extensions', 'windsurf', 'bin', 'language_server_windows_x64.exe');
const data = fs.readFileSync(binPath);
console.log(`Binary: ${(data.length / 1024 / 1024).toFixed(1)}MB`);

// ========================
// ProtoReader class (must be defined before use)
// ========================

class ProtoReader {
  constructor(buf) { this.buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf); this.pos = 0; }
  readVarint() {
    let result = 0, shift = 0;
    while (this.pos < this.buf.length) {
      const b = this.buf[this.pos++];
      if (shift < 28) result |= (b & 0x7f) << shift;
      else result += (b & 0x7f) * Math.pow(2, shift);
      if ((b & 0x80) === 0) return result;
      shift += 7;
      if (shift > 63) return null;
    }
    return null;
  }
  readString() {
    const len = this.readVarint();
    if (len === null || len > 500000 || this.pos + len > this.buf.length) throw new Error('OOB');
    const s = this.buf.slice(this.pos, this.pos + len).toString('utf-8');
    this.pos += len;
    return s;
  }
  readBytesRaw() {
    const len = this.readVarint();
    if (len === null || len > 2000000 || this.pos + len > this.buf.length) throw new Error('OOB');
    const b = this.buf.slice(this.pos, this.pos + len);
    this.pos += len;
    return b;
  }
  skipBytes() {
    const len = this.readVarint();
    if (len === null || this.pos + len > this.buf.length) throw new Error('OOB');
    this.pos += len;
  }
  skipField(wt) {
    switch (wt) {
      case 0: this.readVarint(); break;
      case 1: this.pos += 8; break;
      case 2: this.skipBytes(); break;
      case 3: while(true) { const t=this.readVarint(); if(!t||(t&7)===4)break; this.skipField(t&7); } break;
      case 4: break;
      case 5: this.pos += 4; break;
      default: throw new Error(`wire ${wt}`);
    }
  }
}

// Find the blob start using a known anchor
const anchor = 'exa/language_server_pb/language_server.proto';
const anchorBytes = Buffer.from(anchor, 'utf-8');
const needle = Buffer.concat([Buffer.from([0x0a]), encodeVarint(anchorBytes.length), anchorBytes]);

// There may be multiple occurrences - we want the one that has field 2 (package) right after
let blobStart = -1;
let idx = data.indexOf(needle);
while (idx !== -1) {
  const afterName = idx + needle.length;
  if (data[afterName] === 0x12) { // field 2 = package
    blobStart = idx;
    break;
  }
  idx = data.indexOf(needle, idx + 1);
}

if (blobStart === -1) {
  console.error('Could not find proto descriptor blob');
  process.exit(1);
}

console.log(`Found proto blob at offset ${blobStart} (0x${blobStart.toString(16)})`);

// The blob likely starts earlier (with other proto files before language_server.proto)
// Scan backwards to find the true start
let trueStart = blobStart;
for (let scanBack = blobStart - 1; scanBack > blobStart - 2000000 && scanBack >= 0; scanBack--) {
  // Check if this looks like a FileDescriptorProto start: tag 0x0a + varint + printable string ending in .proto
  if (data[scanBack] === 0x0a) {
    const lenByte = data[scanBack + 1];
    if (lenByte > 10 && lenByte < 128 && scanBack + 2 + lenByte <= data.length) {
      const candidateStr = data.slice(scanBack + 2, scanBack + 2 + lenByte).toString('utf-8');
      if (candidateStr.endsWith('.proto') && /^[\w./]+$/.test(candidateStr)) {
        // Verify: next field after name should be field 2 (0x12) or field 3 (0x1a)
        const afterStr = data[scanBack + 2 + lenByte];
        if (afterStr === 0x12 || afterStr === 0x1a) {
          trueStart = scanBack;
        }
      }
    }
  }
}

console.log(`True blob start at offset ${trueStart} (0x${trueStart.toString(16)})`);
console.log(`Scanned back ${blobStart - trueStart} bytes`);

// Strategy: Find ALL proto file descriptor starts by scanning for
// 0x0a + varint(len) + "...proto" + 0x12 (package field)
// Each descriptor is self-contained, parse them individually.

const allDescriptors = [];
const foundNames = new Set();

// Scan entire binary for FileDescriptorProto starts
let scanPos = 0;
while (scanPos < data.length - 20) {
  // Look for tag 0x0a (field 1, wire type 2)
  if (data[scanPos] !== 0x0a) { scanPos++; continue; }
  
  // Read varint length
  let lenPos = scanPos + 1;
  let nameLen = 0, shift = 0;
  while (lenPos < data.length && (data[lenPos] & 0x80)) {
    nameLen |= (data[lenPos] & 0x7f) << shift;
    shift += 7;
    lenPos++;
  }
  if (lenPos >= data.length) { scanPos++; continue; }
  nameLen |= (data[lenPos] & 0x7f) << shift;
  lenPos++;
  
  // Validate length (proto filenames are 10-100 chars)
  if (nameLen < 10 || nameLen > 200) { scanPos++; continue; }
  
  // Read the string
  if (lenPos + nameLen > data.length) { scanPos++; continue; }
  const nameStr = data.slice(lenPos, lenPos + nameLen).toString('utf-8');
  
  // Must end with .proto and contain only valid chars
  if (!nameStr.endsWith('.proto') || !/^[\w./]+$/.test(nameStr)) { scanPos++; continue; }
  
  // Next byte after name should be 0x12 (package) or 0x1a (dependency) or 0x22 (message)
  const afterName = lenPos + nameLen;
  if (afterName >= data.length) { scanPos++; continue; }
  const nextByte = data[afterName];
  if (nextByte !== 0x12 && nextByte !== 0x1a && nextByte !== 0x22) { scanPos++; continue; }
  
  // Skip if already found
  if (foundNames.has(nameStr)) { scanPos = afterName; continue; }
  
  // Try to parse as FileDescriptorProto
  const maxSize = Math.min(3000000, data.length - scanPos);
  const chunk = data.slice(scanPos, scanPos + maxSize);
  const chunkReader = new ProtoReader(chunk);
  const desc = parseOneFileDescriptor(chunkReader);
  
  if (desc && desc.name === nameStr && (desc.messages.length > 0 || desc.enums.length > 0 || desc.services.length > 0 || desc.dependencies.length > 0)) {
    allDescriptors.push(desc);
    foundNames.add(nameStr);
    scanPos = scanPos + chunkReader.pos; // Skip past this descriptor
  } else {
    scanPos = afterName; // Skip this false positive
  }
}

console.log(`\n=== Extracted ${allDescriptors.length} FileDescriptorProto ===\n`);

// Print summary
let totalMsgs = 0, totalEnums = 0, totalSvcs = 0, totalMethods = 0;
for (const d of allDescriptors) {
  const msgCount = countMessages(d.messages);
  const enumCount = countEnums(d.enums, d.messages);
  const svcMethods = d.services.reduce((s, svc) => s + svc.methods.length, 0);
  totalMsgs += msgCount;
  totalEnums += enumCount;
  totalSvcs += d.services.length;
  totalMethods += svcMethods;
  
  let line = `  ${d.name} (pkg: ${d.package || 'none'})`;
  line += ` | msgs=${msgCount} enums=${enumCount}`;
  if (d.services.length) line += ` svcs=${d.services.map(s => s.name + '(' + s.methods.length + ')').join(',')}`;
  console.log(line);
}

console.log(`\n  TOTAL: ${totalMsgs} messages, ${totalEnums} enums, ${totalSvcs} services, ${totalMethods} RPC methods`);

// Generate .proto files
const protoOutDir = path.join(__dirname, '..', 'docs', 'protos');
if (!fs.existsSync(protoOutDir)) fs.mkdirSync(protoOutDir, { recursive: true });

for (const desc of allDescriptors) {
  const protoContent = generateProtoFile(desc);
  const filename = desc.name.replace(/\//g, '_');
  fs.writeFileSync(path.join(protoOutDir, filename), protoContent);
}

// Save structured JSON (without rawBytes to save space)
const jsonPath = path.join(__dirname, 'proto-descriptors-full.json');
fs.writeFileSync(jsonPath, JSON.stringify(allDescriptors, null, 2));

console.log(`\nProto files written to docs/protos/ (${allDescriptors.length} files)`);
console.log(`JSON saved to ${jsonPath}`);

// Count helpers
function countMessages(msgs) {
  let count = msgs.length;
  for (const m of msgs) {
    if (m.nestedMessages) count += countMessages(m.nestedMessages);
  }
  return count;
}

function countEnums(enums, msgs) {
  let count = enums.length;
  for (const m of msgs) {
    if (m.enums) count += m.enums.length;
    if (m.nestedMessages) count += countEnums([], m.nestedMessages);
  }
  return count;
}

// ========================
// FileDescriptorProto Parser
// ========================

function parseOneFileDescriptor(reader) {
  const result = {
    name: '', package: '', dependencies: [],
    messages: [], enums: [], services: [], options: null,
  };
  
  let fieldCount = 0;
  let hasName = false;
  
  while (reader.pos < reader.buf.length && fieldCount < 5000) {
    const savedPos = reader.pos;
    
    let tag;
    try { tag = reader.readVarint(); } catch(e) { break; }
    if (tag === null || tag === 0) break;
    
    const fieldNum = tag >> 3;
    const wireType = tag & 0x7;
    
    // FileDescriptorProto fields are 1-14
    if (fieldNum < 1 || fieldNum > 14 || wireType > 5) {
      reader.pos = savedPos; // Rewind
      break;
    }
    
    // If we see field 1 again after already having a name, it's a new FileDescriptor
    if (fieldNum === 1 && hasName) {
      reader.pos = savedPos; // Rewind
      break;
    }
    
    try {
      switch (fieldNum) {
        case 1: // name (string)
          if (wireType !== 2) { reader.pos = savedPos; return result.name ? result : null; }
          result.name = reader.readString();
          hasName = true;
          break;
        case 2: // package (string)
          if (wireType !== 2) { reader.pos = savedPos; return result.name ? result : null; }
          result.package = reader.readString();
          break;
        case 3: // dependency (string)
          if (wireType !== 2) { reader.pos = savedPos; return result.name ? result : null; }
          result.dependencies.push(reader.readString());
          break;
        case 4: // message_type (DescriptorProto)
          if (wireType !== 2) { reader.pos = savedPos; return result.name ? result : null; }
          result.messages.push(parseMessageDescriptor(reader.readBytesRaw()));
          break;
        case 5: // enum_type (EnumDescriptorProto)
          if (wireType !== 2) { reader.pos = savedPos; return result.name ? result : null; }
          result.enums.push(parseEnumDescriptor(reader.readBytesRaw()));
          break;
        case 6: // service (ServiceDescriptorProto)
          if (wireType !== 2) { reader.pos = savedPos; return result.name ? result : null; }
          result.services.push(parseServiceDescriptor(reader.readBytesRaw()));
          break;
        case 7: // extension
          reader.skipField(wireType);
          break;
        case 8: // options (FileOptions)
          if (wireType === 2) {
            const optBytes = reader.readBytesRaw();
            result.options = parseFileOptions(optBytes);
          } else reader.skipField(wireType);
          break;
        case 9: // source_code_info
          if (wireType === 2) reader.skipBytes();
          else reader.skipField(wireType);
          break;
        case 10: // public_dependency (int32)
        case 11: // weak_dependency (int32)
          if (wireType === 0) reader.readVarint();
          else reader.skipField(wireType);
          break;
        case 12: // syntax (string)
          if (wireType === 2) reader.readString();
          else reader.skipField(wireType);
          break;
        case 13: // edition (enum as varint)
          if (wireType === 0) reader.readVarint();
          else if (wireType === 2) reader.readString();
          else reader.skipField(wireType);
          break;
        case 14: // edition_defaults
          reader.skipField(wireType);
          break;
        default:
          reader.skipField(wireType);
      }
    } catch (e) {
      break;
    }
    
    fieldCount++;
  }
  
  if (!result.name || !result.name.endsWith('.proto')) return null;
  return result;
}

function parseMessageDescriptor(buf) {
  const reader = new ProtoReader(buf);
  const msg = { name: '', fields: [], enums: [], nestedMessages: [], oneofNames: [], isMapEntry: false };
  
  try {
    while (reader.pos < buf.length) {
      const tag = reader.readVarint();
      if (tag === null || tag === 0) break;
      const fieldNum = tag >> 3;
      const wireType = tag & 0x7;
      if (wireType > 5 || fieldNum > 20) break;
      
      switch (fieldNum) {
        case 1: if (wireType === 2) msg.name = reader.readString(); else reader.skipField(wireType); break;
        case 2: if (wireType === 2) { const f = parseFieldDescriptor(reader.readBytesRaw()); if (f) msg.fields.push(f); } else reader.skipField(wireType); break;
        case 3: if (wireType === 2) { const n = parseMessageDescriptor(reader.readBytesRaw()); if (n) msg.nestedMessages.push(n); } else reader.skipField(wireType); break;
        case 4: if (wireType === 2) { const e = parseEnumDescriptor(reader.readBytesRaw()); if (e) msg.enums.push(e); } else reader.skipField(wireType); break;
        case 7: { // options
          if (wireType === 2) {
            const optBytes = reader.readBytesRaw();
            try {
              const or = new ProtoReader(optBytes);
              while (or.pos < optBytes.length) {
                const ot = or.readVarint(); if (!ot) break;
                if ((ot >> 3) === 7 && (ot & 7) === 0) msg.isMapEntry = or.readVarint() !== 0;
                else or.skipField(ot & 7);
              }
            } catch(e) {}
          } else reader.skipField(wireType);
          break;
        }
        case 8: { // oneof_decl
          if (wireType === 2) {
            const ob = reader.readBytesRaw();
            try {
              const or = new ProtoReader(ob);
              let name = '';
              while (or.pos < ob.length) {
                const ot = or.readVarint(); if (!ot) break;
                if ((ot >> 3) === 1 && (ot & 7) === 2) name = or.readString();
                else or.skipField(ot & 7);
              }
              msg.oneofNames.push(name);
            } catch(e) { msg.oneofNames.push(''); }
          } else reader.skipField(wireType);
          break;
        }
        default: reader.skipField(wireType);
      }
    }
  } catch (e) {}
  return msg.name ? msg : null;
}

function parseFieldDescriptor(buf) {
  const reader = new ProtoReader(buf);
  const field = { name: '', number: 0, type: 0, typeName: '', repeated: false, oneofIndex: null, proto3Optional: false, jsonName: '' };
  try {
    while (reader.pos < buf.length) {
      const tag = reader.readVarint();
      if (tag === null || tag === 0) break;
      const fn = tag >> 3;
      const wt = tag & 7;
      switch (fn) {
        case 1: if (wt === 2) field.name = reader.readString(); else reader.skipField(wt); break;
        case 3: if (wt === 0) field.number = reader.readVarint(); else reader.skipField(wt); break;
        case 4: if (wt === 0) { const l = reader.readVarint(); if (l === 3) field.repeated = true; } else reader.skipField(wt); break;
        case 5: if (wt === 0) field.type = reader.readVarint(); else reader.skipField(wt); break;
        case 6: if (wt === 2) field.typeName = reader.readString(); else reader.skipField(wt); break;
        case 9: if (wt === 0) field.oneofIndex = reader.readVarint(); else reader.skipField(wt); break;
        case 10: if (wt === 2) field.jsonName = reader.readString(); else reader.skipField(wt); break;
        case 17: if (wt === 0) field.proto3Optional = reader.readVarint() !== 0; else reader.skipField(wt); break;
        default: reader.skipField(wt);
      }
    }
  } catch (e) {}
  return field.name ? field : null;
}

function parseEnumDescriptor(buf) {
  const reader = new ProtoReader(buf);
  const enm = { name: '', values: [] };
  try {
    while (reader.pos < buf.length) {
      const tag = reader.readVarint();
      if (tag === null || tag === 0) break;
      const fn = tag >> 3;
      const wt = tag & 7;
      if (fn === 1 && wt === 2) enm.name = reader.readString();
      else if (fn === 2 && wt === 2) {
        const vb = reader.readBytesRaw();
        const vr = new ProtoReader(vb);
        const val = { name: '', number: 0 };
        while (vr.pos < vb.length) {
          const vt = vr.readVarint(); if (!vt) break;
          if ((vt >> 3) === 1 && (vt & 7) === 2) val.name = vr.readString();
          else if ((vt >> 3) === 2 && (vt & 7) === 0) val.number = vr.readVarint() | 0;
          else vr.skipField(vt & 7);
        }
        if (val.name) enm.values.push(val);
      }
      else reader.skipField(wt);
    }
  } catch (e) {}
  return enm.name ? enm : null;
}

function parseServiceDescriptor(buf) {
  const reader = new ProtoReader(buf);
  const svc = { name: '', methods: [] };
  try {
    while (reader.pos < buf.length) {
      const tag = reader.readVarint();
      if (tag === null || tag === 0) break;
      const fn = tag >> 3;
      const wt = tag & 7;
      if (fn === 1 && wt === 2) svc.name = reader.readString();
      else if (fn === 2 && wt === 2) {
        const mb = reader.readBytesRaw();
        const mr = new ProtoReader(mb);
        const method = { name: '', inputType: '', outputType: '', clientStreaming: false, serverStreaming: false };
        while (mr.pos < mb.length) {
          const mt = mr.readVarint(); if (!mt) break;
          const mf = mt >> 3; const mw = mt & 7;
          if (mf === 1 && mw === 2) method.name = mr.readString();
          else if (mf === 2 && mw === 2) method.inputType = mr.readString();
          else if (mf === 3 && mw === 2) method.outputType = mr.readString();
          else if (mf === 5 && mw === 0) method.clientStreaming = mr.readVarint() !== 0;
          else if (mf === 6 && mw === 0) method.serverStreaming = mr.readVarint() !== 0;
          else mr.skipField(mw);
        }
        if (method.name) svc.methods.push(method);
      }
      else reader.skipField(wt);
    }
  } catch (e) {}
  return svc.name ? svc : null;
}

function parseFileOptions(buf) {
  const reader = new ProtoReader(buf);
  const opts = {};
  try {
    while (reader.pos < buf.length) {
      const tag = reader.readVarint(); if (!tag) break;
      if ((tag >> 3) === 11 && (tag & 7) === 2) opts.goPackage = reader.readString();
      else reader.skipField(tag & 7);
    }
  } catch (e) {}
  return opts;
}

// ========================
// Proto File Generator
// ========================

function generateProtoFile(desc) {
  let out = `syntax = "proto3";\n\n`;
  if (desc.package) out += `package ${desc.package};\n\n`;
  for (const dep of desc.dependencies) out += `import "${dep}";\n`;
  if (desc.dependencies.length) out += '\n';
  if (desc.options?.goPackage) out += `option go_package = "${desc.options.goPackage}";\n\n`;
  
  for (const enm of desc.enums) out += formatEnum(enm, 0);
  for (const msg of desc.messages) out += formatMessage(msg, 0);
  for (const svc of desc.services) out += formatService(svc);
  
  return out;
}

function formatEnum(enm, indent) {
  const pad = '  '.repeat(indent);
  let out = `${pad}enum ${enm.name} {\n`;
  for (const v of enm.values) out += `${pad}  ${v.name} = ${v.number};\n`;
  out += `${pad}}\n\n`;
  return out;
}

function formatMessage(msg, indent) {
  const pad = '  '.repeat(indent);
  let out = `${pad}message ${msg.name} {\n`;
  
  for (const enm of msg.enums || []) out += formatEnum(enm, indent + 1);
  for (const nested of msg.nestedMessages || []) {
    if (nested.isMapEntry) continue;
    out += formatMessage(nested, indent + 1);
  }
  
  // Map entry detection
  const mapEntries = {};
  for (const nested of msg.nestedMessages || []) {
    if (nested.isMapEntry && nested.fields?.length === 2) {
      mapEntries[`.${msg.name}.${nested.name}`] = nested;
    }
  }
  
  // Oneofs
  const oneofFields = {};
  for (const f of msg.fields || []) {
    if (f.oneofIndex !== null && f.oneofIndex !== undefined) {
      if (!oneofFields[f.oneofIndex]) oneofFields[f.oneofIndex] = [];
      oneofFields[f.oneofIndex].push(f);
    }
  }
  const fieldsInOneof = new Set();
  
  for (const [idx, fields] of Object.entries(oneofFields)) {
    if (fields.length === 1 && fields[0].proto3Optional) {
      fieldsInOneof.add(fields[0].number);
      continue; // synthetic oneof for proto3 optional
    }
    const oneofName = msg.oneofNames?.[idx] || `choice_${idx}`;
    out += `${pad}  oneof ${oneofName} {\n`;
    for (const f of fields) {
      fieldsInOneof.add(f.number);
      out += `${pad}    ${formatFieldType(f)} ${f.name} = ${f.number};\n`;
    }
    out += `${pad}  }\n`;
  }
  
  // Regular fields
  for (const f of msg.fields || []) {
    if (fieldsInOneof.has(f.number)) {
      if (f.proto3Optional) out += `${pad}  optional ${formatFieldType(f)} ${f.name} = ${f.number};\n`;
      continue;
    }
    // Check for map type
    if (f.typeName) {
      const shortType = f.typeName.split('.').pop();
      const mapKey = `.${msg.name}.${shortType}`;
      const mapNested = mapEntries[mapKey];
      if (mapNested) {
        const keyField = mapNested.fields.find(mf => mf.number === 1);
        const valField = mapNested.fields.find(mf => mf.number === 2);
        if (keyField && valField) {
          out += `${pad}  map<${formatFieldType(keyField)}, ${formatFieldType(valField)}> ${f.name} = ${f.number};\n`;
          continue;
        }
      }
    }
    const prefix = f.repeated ? 'repeated ' : '';
    out += `${pad}  ${prefix}${formatFieldType(f)} ${f.name} = ${f.number};\n`;
  }
  
  out += `${pad}}\n\n`;
  return out;
}

function formatFieldType(f) {
  if (f.typeName) {
    let t = f.typeName;
    if (t.startsWith('.')) t = t.slice(1);
    return t;
  }
  const names = {
    1:'double', 2:'float', 3:'int64', 4:'uint64', 5:'int32',
    6:'fixed64', 7:'fixed32', 8:'bool', 9:'string', 10:'group',
    11:'message', 12:'bytes', 13:'uint32', 14:'enum', 15:'sfixed32',
    16:'sfixed64', 17:'sint32', 18:'sint64',
  };
  return names[f.type] || `unknown_type_${f.type}`;
}

function formatService(svc) {
  let out = `service ${svc.name} {\n`;
  for (const m of svc.methods) {
    const cs = m.clientStreaming ? 'stream ' : '';
    const ss = m.serverStreaming ? 'stream ' : '';
    const input = m.inputType.startsWith('.') ? m.inputType.slice(1) : m.inputType;
    const output = m.outputType.startsWith('.') ? m.outputType.slice(1) : m.outputType;
    out += `  rpc ${m.name} (${cs}${input}) returns (${ss}${output});\n`;
  }
  out += `}\n\n`;
  return out;
}

// ========================
// Utilities
// ========================

function encodeVarint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return Buffer.from(bytes);
}
