/**
 * Minimal Protobuf encoding/decoding for Windsurf Connect-RPC calls
 * 
 * We use raw protobuf wire format encoding instead of the full @bufbuild/protobuf library
 * to avoid version compatibility issues. The messages are simple enough for manual encoding.
 * 
 * Wire format reference:
 * - Field tag: (field_number << 3) | wire_type
 * - Wire type 2 (length-delimited) for strings
 * - Varint encoding for lengths
 */

/**
 * Encode a varint
 */
function encodeVarint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value & 0x7f);
  return Buffer.from(bytes);
}

/**
 * Decode a varint from buffer at offset
 * @returns {{value: number, bytesRead: number}}
 */
function decodeVarint(buf, offset) {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset < buf.length) {
    const byte = buf[offset];
    value |= (byte & 0x7f) << shift;
    shift += 7;
    offset++;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
  }
  return { value, bytesRead };
}

/**
 * Encode a protobuf string field
 * @param {number} fieldNumber
 * @param {string} value
 * @returns {Buffer}
 */
function encodeStringField(fieldNumber, value) {
  if (!value) return Buffer.alloc(0);
  const tag = encodeVarint((fieldNumber << 3) | 2); // wire type 2 = length-delimited
  const strBuf = Buffer.from(value, "utf-8");
  const len = encodeVarint(strBuf.length);
  return Buffer.concat([tag, len, strBuf]);
}

/**
 * Decode protobuf fields from binary
 * @param {Buffer} buf
 * @returns {Map<number, string[]>} fieldNumber -> values
 */
function decodeFields(buf) {
  const fields = new Map();
  let offset = 0;
  while (offset < buf.length) {
    const { value: tag, bytesRead: tagBytes } = decodeVarint(buf, offset);
    offset += tagBytes;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 0x7;

    if (wireType === 2) { // length-delimited (string, bytes, embedded message)
      const { value: len, bytesRead: lenBytes } = decodeVarint(buf, offset);
      offset += lenBytes;
      const data = buf.slice(offset, offset + len);
      offset += len;
      if (!fields.has(fieldNumber)) fields.set(fieldNumber, []);
      fields.get(fieldNumber).push(data.toString("utf-8"));
    } else if (wireType === 0) { // varint
      const { value, bytesRead } = decodeVarint(buf, offset);
      offset += bytesRead;
      if (!fields.has(fieldNumber)) fields.set(fieldNumber, []);
      fields.get(fieldNumber).push(String(value));
    } else {
      // Skip unknown wire types
      break;
    }
  }
  return fields;
}

/**
 * Encode RegisterUserRequest
 * message RegisterUserRequest { string firebase_id_token = 1; }
 */
function encodeRegisterUserRequest(firebaseIdToken) {
  return encodeStringField(1, firebaseIdToken);
}

/**
 * Decode RegisterUserResponse
 * message RegisterUserResponse {
 *   string api_key = 1;
 *   string name = 2;
 *   string api_server_url = 3;
 *   string redirect_url = 4;
 * }
 */
function decodeRegisterUserResponse(buf) {
  const fields = decodeFields(buf);
  return {
    apiKey: fields.get(1)?.[0] || "",
    name: fields.get(2)?.[0] || "",
    apiServerUrl: fields.get(3)?.[0] || "",
    redirectUrl: fields.get(4)?.[0] || "",
  };
}

module.exports = {
  encodeVarint,
  decodeVarint,
  encodeStringField,
  decodeFields,
  encodeRegisterUserRequest,
  decodeRegisterUserResponse,
};
