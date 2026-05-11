/// Minimal protobuf wire format encoder/decoder for Connect-RPC calls.
/// Only handles string fields (wire type 2) and varint fields (wire type 0).
/// This avoids needing prost-build and compiled .proto files.

/// Encode a varint
pub fn encode_varint(mut value: u64) -> Vec<u8> {
    let mut bytes = Vec::new();
    loop {
        if value <= 0x7F {
            bytes.push(value as u8);
            break;
        }
        bytes.push(((value & 0x7F) | 0x80) as u8);
        value >>= 7;
    }
    bytes
}

/// Decode a varint from buffer at offset. Returns (value, bytes_read).
pub fn decode_varint(buf: &[u8], offset: usize) -> (u64, usize) {
    let mut value: u64 = 0;
    let mut shift = 0;
    let mut i = offset;
    while i < buf.len() {
        let byte = buf[i];
        value |= ((byte & 0x7F) as u64) << shift;
        i += 1;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    (value, i - offset)
}

/// Encode a protobuf string field (wire type 2 = length-delimited)
pub fn encode_string_field(field_number: u32, value: &str) -> Vec<u8> {
    if value.is_empty() {
        return Vec::new();
    }
    let tag = encode_varint(((field_number as u64) << 3) | 2);
    let str_bytes = value.as_bytes();
    let len = encode_varint(str_bytes.len() as u64);
    let mut result = Vec::with_capacity(tag.len() + len.len() + str_bytes.len());
    result.extend_from_slice(&tag);
    result.extend_from_slice(&len);
    result.extend_from_slice(str_bytes);
    result
}

/// Encode a protobuf uint64 field (wire type 0 = varint)
pub fn encode_varint_field(field_number: u32, value: u64) -> Vec<u8> {
    let tag = encode_varint(((field_number as u64) << 3) | 0);
    let val = encode_varint(value);
    let mut result = Vec::with_capacity(tag.len() + val.len());
    result.extend_from_slice(&tag);
    result.extend_from_slice(&val);
    result
}

/// Encode a protobuf embedded message field (wire type 2)
pub fn encode_message_field(field_number: u32, data: &[u8]) -> Vec<u8> {
    let tag = encode_varint(((field_number as u64) << 3) | 2);
    let len = encode_varint(data.len() as u64);
    let mut result = Vec::with_capacity(tag.len() + len.len() + data.len());
    result.extend_from_slice(&tag);
    result.extend_from_slice(&len);
    result.extend_from_slice(data);
    result
}

/// Decoded protobuf field value
#[derive(Debug, Clone)]
pub enum FieldValue {
    Varint(u64),
    Bytes(Vec<u8>),
}

impl FieldValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            FieldValue::Bytes(b) => std::str::from_utf8(b).ok(),
            _ => None,
        }
    }

    pub fn as_string(&self) -> String {
        self.as_str().unwrap_or("").to_string()
    }

    pub fn as_u64(&self) -> u64 {
        match self {
            FieldValue::Varint(v) => *v,
            _ => 0,
        }
    }
}

/// Decode all protobuf fields from binary buffer
pub fn decode_fields(buf: &[u8]) -> std::collections::HashMap<u32, Vec<FieldValue>> {
    let mut fields: std::collections::HashMap<u32, Vec<FieldValue>> = std::collections::HashMap::new();
    let mut offset = 0;

    while offset < buf.len() {
        let (tag, tag_bytes) = decode_varint(buf, offset);
        offset += tag_bytes;
        let field_number = (tag >> 3) as u32;
        let wire_type = (tag & 0x7) as u8;

        match wire_type {
            0 => {
                // Varint
                let (value, val_bytes) = decode_varint(buf, offset);
                offset += val_bytes;
                fields.entry(field_number).or_default().push(FieldValue::Varint(value));
            }
            1 => {
                // 64-bit (fixed64, double)
                offset += 8;
            }
            2 => {
                // Length-delimited (string, bytes, embedded message)
                let (len, len_bytes) = decode_varint(buf, offset);
                offset += len_bytes;
                let len = len as usize;
                if offset + len <= buf.len() {
                    let data = buf[offset..offset + len].to_vec();
                    offset += len;
                    fields.entry(field_number).or_default().push(FieldValue::Bytes(data));
                } else {
                    break;
                }
            }
            5 => {
                // 32-bit (fixed32, float)
                offset += 4;
            }
            _ => break,
        }
    }
    fields
}

/// Strip Connect-RPC 5-byte envelope (flags:u8 + length:u32BE) if present
pub fn strip_envelope(buf: &[u8]) -> &[u8] {
    if buf.len() > 5 {
        let flags = buf[0];
        let len = u32::from_be_bytes([buf[1], buf[2], buf[3], buf[4]]) as usize;
        if (flags & 0x7E) == 0 && len > 0 && len + 5 <= buf.len() {
            return &buf[5..5 + len];
        }
    }
    buf
}

/// Build a Connect-RPC envelope frame
pub fn build_envelope(flags: u8, data: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(5 + data.len());
    frame.push(flags);
    frame.extend_from_slice(&(data.len() as u32).to_be_bytes());
    frame.extend_from_slice(data);
    frame
}

/// Encode Metadata message for Windsurf API calls
/// message Metadata {
///   string api_key = 2;
///   string ide_name = 4;
///   string ide_version = 7;
///   string session_id = 10;
///   uint64 request_id = 13;
///   string extension_name = 23;
///   string extension_version = 25;
///   string locale = 14;
/// }
pub fn encode_metadata(api_key: &str, ide_name: &str, ide_version: &str, ext_version: &str, session_id: &str, request_id: u64) -> Vec<u8> {
    let mut buf = Vec::new();
    buf.extend(encode_string_field(2, api_key));
    buf.extend(encode_string_field(4, ide_name));
    buf.extend(encode_string_field(7, ide_version));
    buf.extend(encode_string_field(10, session_id));
    buf.extend(encode_varint_field(13, request_id));
    buf.extend(encode_string_field(14, "en_US"));
    buf.extend(encode_string_field(23, "windsurf"));
    buf.extend(encode_string_field(25, ext_version));
    buf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_varint_roundtrip() {
        for v in [0u64, 1, 127, 128, 300, 16384, 1_000_000] {
            let encoded = encode_varint(v);
            let (decoded, _) = decode_varint(&encoded, 0);
            assert_eq!(v, decoded);
        }
    }

    #[test]
    fn test_string_field() {
        let encoded = encode_string_field(1, "hello");
        let fields = decode_fields(&encoded);
        assert_eq!(fields.get(&1).unwrap()[0].as_string(), "hello");
    }

    #[test]
    fn test_strip_envelope() {
        let inner = b"test data";
        let frame = build_envelope(0, inner);
        assert_eq!(strip_envelope(&frame), inner);
    }
}
