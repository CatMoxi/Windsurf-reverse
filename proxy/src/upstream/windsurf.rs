use anyhow::{anyhow, Result};
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;
use tokio::sync::mpsc;

use crate::auth::proto::*;

/// Connect-RPC frame header: 1 byte flags + 4 bytes big-endian length
const FRAME_HEADER_SIZE: usize = 5;

/// Windsurf upstream client — speaks Connect-RPC (HTTP/1.1 + binary protobuf)
#[derive(Clone)]
pub struct WindsurfClient {
    client: Client,
    timeout: Duration,
    ide_version: String,
    extension_version: String,
}

impl WindsurfClient {
    pub fn new(timeout_secs: u64, _ide_name: &str, ide_version: &str, ext_version: &str) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .expect("failed to build HTTP client");

        Self {
            client,
            timeout: Duration::from_secs(timeout_secs),
            ide_version: ide_version.to_string(),
            extension_version: ext_version.to_string(),
        }
    }

    /// Build protobuf-encoded Metadata for Windsurf API calls
    fn build_metadata_proto(&self, api_key: &str) -> Vec<u8> {
        encode_metadata(
            api_key,
            "windsurf",
            &self.ide_version,
            &self.extension_version,
            &uuid::Uuid::new_v4().to_string(),
            rand::random::<u64>(),
        )
    }

    /// Make a Connect-RPC unary call with binary protobuf
    async fn connect_rpc_unary(&self, url: &str, body: &[u8]) -> Result<Vec<u8>> {
        let body_vec = body.to_vec();
        let resp = self.client.post(url)
            .header("Content-Type", "application/proto")
            .header("Connect-Protocol-Version", "1")
            .header("User-Agent", "connect-es/1.4.0")
            .header("Content-Length", body_vec.len().to_string())
            .body(body_vec)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Connect-RPC unary {} failed: {} - {}", url, status, &text[..text.len().min(200)]));
        }
        let bytes = resp.bytes().await?;
        Ok(strip_envelope(&bytes).to_vec())
    }

    /// Make a Connect-RPC streaming call with binary protobuf envelope
    async fn connect_rpc_stream_raw(&self, url: &str, body: &[u8]) -> Result<reqwest::Response> {
        // Wrap in 5-byte envelope frame (flags=0)
        let envelope = build_envelope(0, body);
        let resp = self.client.post(url)
            .header("Content-Type", "application/connect+proto")
            .header("Connect-Protocol-Version", "1")
            .header("User-Agent", "connect-es/1.4.0")
            .header("Connect-Timeout-Ms", self.timeout.as_millis().to_string())
            .header("Content-Length", envelope.len().to_string())
            .body(envelope)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Connect-RPC stream {} failed: {} - {}", url, status, &text[..text.len().min(200)]));
        }

        Ok(resp)
    }

    /// GetUserStatus — check account health (binary proto)
    pub async fn get_user_status(&self, upstream_url: &str, api_key: &str) -> Result<Value> {
        let url = format!("{}/exa.seat_management_pb.SeatManagementService/GetUserStatus", upstream_url);
        let metadata = self.build_metadata_proto(api_key);
        let body = encode_message_field(1, &metadata);

        let resp_bytes = self.connect_rpc_unary(&url, &body).await?;
        let fields = decode_fields(&resp_bytes);

        Ok(serde_json::json!({
            "status": "ok",
            "fields": fields.len(),
        }))
    }

    /// GetCascadeModelConfigs — list available models (binary proto)
    pub async fn get_model_configs(&self, upstream_url: &str, api_key: &str) -> Result<Value> {
        let url = format!("{}/exa.api_server_pb.ApiServerService/GetCascadeModelConfigs", upstream_url);
        let metadata = self.build_metadata_proto(api_key);
        let body = encode_message_field(1, &metadata);

        let resp_bytes = self.connect_rpc_unary(&url, &body).await?;
        let fields = decode_fields(&resp_bytes);

        // Parse model configs from response
        let mut models = Vec::new();
        // clientModelConfigs is a repeated message field
        if let Some(configs) = fields.get(&1) {
            for config in configs {
                if let FieldValue::Bytes(data) = config {
                    let cf = decode_fields(data);
                    let uid = cf.get(&2).and_then(|v| v.first()).map(|v| v.as_string()).unwrap_or_default();
                    let name = cf.get(&1).and_then(|v| v.first()).map(|v| v.as_string()).unwrap_or_default();
                    if !uid.is_empty() {
                        models.push(serde_json::json!({"model_uid": uid, "model_name": name}));
                    }
                }
            }
        }

        Ok(serde_json::json!({
            "model_count": models.len(),
            "models": models,
        }))
    }

    /// GetChatMessage — streaming chat completion (binary protobuf)
    /// Returns a channel receiver that yields JSON-decoded response chunks
    ///
    /// Proto field numbers (from api_server.proto):
    /// GetChatMessageRequest:
    ///   1: metadata (Metadata msg)
    ///   3: chat_message_prompts (repeated ChatMessagePrompt msg)
    ///   7: request_type (enum, CASCADE=5)
    ///  16: cascade_id (string)
    ///  17: prompt_id (string)
    ///  21: chat_model_uid (string)
    ///
    /// ChatMessagePrompt:
    ///   1: message_id (string)
    ///   2: source (enum, USER=1, SYSTEM=2, TOOL=4)
    ///   3: prompt (string)
    ///
    /// GetChatMessageResponse:
    ///   1: message_id (string)
    ///   3: delta_text (string)
    ///   5: stop_reason (enum)
    ///   9: delta_thinking (string)
    pub async fn get_chat_message_stream(
        &self,
        upstream_url: &str,
        api_key: &str,
        model_uid: &str,
        messages: Vec<Value>,
        cascade_id: &str,
        prompt_id: &str,
    ) -> Result<mpsc::Receiver<Result<Value>>> {
        let url = format!("{}/exa.api_server_pb.ApiServerService/GetChatMessage", upstream_url);

        // Build protobuf request
        let metadata = self.build_metadata_proto(api_key);
        let mut request_buf = Vec::new();

        // field 1: metadata (embedded message)
        request_buf.extend(encode_message_field(1, &metadata));

        // field 3: chat_message_prompts (repeated)
        let mut msg_counter = 0u32;
        for msg in &messages {
            let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");
            let content = msg.get("content").and_then(|c| c.as_str()).unwrap_or("");

            let source: u64 = match role {
                "system" => 2,     // CHAT_MESSAGE_SOURCE_SYSTEM
                "assistant" => 3,  // CHAT_MESSAGE_SOURCE_UNKNOWN (closest to codeium)
                "tool" => 4,       // CHAT_MESSAGE_SOURCE_TOOL
                _ => 1,            // CHAT_MESSAGE_SOURCE_USER
            };

            let mut prompt_buf = Vec::new();
            msg_counter += 1;
            prompt_buf.extend(encode_string_field(1, &format!("msg-{}", msg_counter))); // message_id
            prompt_buf.extend(encode_varint_field(2, source));                           // source enum
            prompt_buf.extend(encode_string_field(3, content));                          // prompt text

            request_buf.extend(encode_message_field(3, &prompt_buf));
        }

        // field 7: request_type = CASCADE (5)
        request_buf.extend(encode_varint_field(7, 5));

        // field 16: cascade_id
        request_buf.extend(encode_string_field(16, cascade_id));

        // field 17: prompt_id
        request_buf.extend(encode_string_field(17, prompt_id));

        // field 21: chat_model_uid
        request_buf.extend(encode_string_field(21, model_uid));

        tracing::debug!("GetChatMessage proto request: {} bytes, model={}", request_buf.len(), model_uid);

        let resp = self.connect_rpc_stream_raw(&url, &request_buf).await?;

        let (tx, rx) = mpsc::channel(64);

        // Spawn task to read streaming response frames
        tokio::spawn(async move {
            let bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    let _ = tx.send(Err(anyhow!("Failed to read response: {}", e))).await;
                    return;
                }
            };

            tracing::debug!("GetChatMessage response: {} bytes total", bytes.len());
            let mut buf = &bytes[..];
            let mut frame_idx = 0u32;

            while buf.len() >= FRAME_HEADER_SIZE {
                let flags = buf[0];
                let length = u32::from_be_bytes([buf[1], buf[2], buf[3], buf[4]]) as usize;
                buf = &buf[FRAME_HEADER_SIZE..];

                if buf.len() < length {
                    tracing::warn!("Frame {} truncated: need {} bytes, have {}", frame_idx, length, buf.len());
                    break;
                }
                let frame_data = &buf[..length];
                buf = &buf[length..];
                frame_idx += 1;

                if flags == 2 {
                    // Trailer frame
                    if let Ok(text) = std::str::from_utf8(frame_data) {
                        tracing::info!("Stream trailer (frame {}): {}", frame_idx, &text[..text.len().min(500)]);
                    }
                    break;
                }

                if flags == 0 && !frame_data.is_empty() {
                    // Data frame — decode GetChatMessageResponse
                    let fields = decode_fields(frame_data);
                    let delta_text = fields.get(&3)
                        .and_then(|v| v.first())
                        .map(|v| v.as_string())
                        .unwrap_or_default();
                    let message_id = fields.get(&1)
                        .and_then(|v| v.first())
                        .map(|v| v.as_string())
                        .unwrap_or_default();
                    let delta_thinking = fields.get(&9)
                        .and_then(|v| v.first())
                        .map(|v| v.as_string())
                        .unwrap_or_default();
                    let stop_reason = fields.get(&5)
                        .and_then(|v| v.first())
                        .map(|v| v.as_u64())
                        .unwrap_or(0);

                    if frame_idx <= 3 {
                        tracing::debug!(
                            "Frame {}: fields={:?}, delta_text_len={}, msg_id={}, stop={}",
                            frame_idx,
                            fields.keys().collect::<Vec<_>>(),
                            delta_text.len(),
                            &message_id[..message_id.len().min(20)],
                            stop_reason
                        );
                    }

                    let chunk = serde_json::json!({
                        "delta_text": delta_text,
                        "message_id": message_id,
                        "delta_thinking": delta_thinking,
                        "stop_reason": stop_reason,
                    });

                    if tx.send(Ok(chunk)).await.is_err() { break; }
                }
            }
            tracing::debug!("Stream done: {} frames parsed", frame_idx);
        });

        Ok(rx)
    }
}
