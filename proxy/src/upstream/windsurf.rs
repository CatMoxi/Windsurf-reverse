use anyhow::{anyhow, Result};
use bytes::{Buf, BufMut, BytesMut};
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;
use tokio::sync::mpsc;

/// Connect-RPC frame: 1 byte flags + 4 bytes big-endian length + payload
const FRAME_HEADER_SIZE: usize = 5;

/// Windsurf upstream client — speaks Connect-RPC (HTTP/1.1 + binary protobuf)
/// For this proxy we use JSON encoding to avoid needing compiled protobuf.
/// Windsurf servers also accept `application/json` content type.
#[derive(Clone)]
pub struct WindsurfClient {
    client: Client,
    timeout: Duration,
    ide_name: String,
    ide_version: String,
    extension_version: String,
}

impl WindsurfClient {
    pub fn new(timeout_secs: u64, ide_name: &str, ide_version: &str, ext_version: &str) -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(timeout_secs))
            .build()
            .expect("failed to build HTTP client");

        Self {
            client,
            timeout: Duration::from_secs(timeout_secs),
            ide_name: ide_name.to_string(),
            ide_version: ide_version.to_string(),
            extension_version: ext_version.to_string(),
        }
    }

    /// Build metadata block for Windsurf API requests
    fn build_metadata(&self, api_key: &str) -> Value {
        serde_json::json!({
            "api_key": api_key,
            "ide_name": self.ide_name,
            "ide_version": self.ide_version,
            "extension_name": "windsurf",
            "extension_version": self.extension_version,
            "session_id": uuid::Uuid::new_v4().to_string(),
            "request_id": rand::random::<u64>()
        })
    }

    /// Make a Connect-RPC unary call with JSON encoding
    async fn connect_rpc_json(&self, url: &str, body: &Value) -> Result<Value> {
        let resp = self.client.post(url)
            .header("Content-Type", "application/json")
            .header("Connect-Protocol-Version", "1")
            .json(body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Connect-RPC call failed: {} - {}", status, text));
        }
        Ok(resp.json().await?)
    }

    /// Make a Connect-RPC streaming call, returns receiver of JSON chunks
    async fn connect_rpc_stream(&self, url: &str, body: &Value) -> Result<(reqwest::Response, String)> {
        let resp = self.client.post(url)
            .header("Content-Type", "application/json")
            .header("Connect-Protocol-Version", "1")
            .header("Connect-Timeout-Ms", self.timeout.as_millis().to_string())
            .json(body)
            .send()
            .await?;

        let ct = resp.headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("Connect-RPC stream failed: {} - {}", status, text));
        }

        Ok((resp, ct))
    }

    /// GetUserStatus — check account health
    pub async fn get_user_status(&self, upstream_url: &str, api_key: &str) -> Result<Value> {
        let url = format!(
            "{}/exa.seat_management_pb.SeatManagementService/GetUserStatus",
            upstream_url
        );
        let body = serde_json::json!({
            "metadata": self.build_metadata(api_key)
        });
        self.connect_rpc_json(&url, &body).await
    }

    /// GetCascadeModelConfigs — list available models
    pub async fn get_model_configs(&self, upstream_url: &str, api_key: &str) -> Result<Value> {
        let url = format!(
            "{}/exa.api_server_pb.ApiServerService/GetCascadeModelConfigs",
            upstream_url
        );
        let body = serde_json::json!({
            "metadata": self.build_metadata(api_key)
        });
        self.connect_rpc_json(&url, &body).await
    }

    /// GetChatMessage — streaming chat completion
    /// Returns a channel receiver that yields JSON chunks
    pub async fn get_chat_message_stream(
        &self,
        upstream_url: &str,
        api_key: &str,
        model_uid: &str,
        messages: Vec<Value>,
        cascade_id: &str,
        prompt_id: &str,
    ) -> Result<mpsc::Receiver<Result<Value>>> {
        let url = format!(
            "{}/exa.api_server_pb.ApiServerService/GetChatMessage",
            upstream_url
        );

        // Convert messages to Windsurf chatMessagePrompts format
        let chat_prompts: Vec<Value> = messages.iter().map(|msg| {
            let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("user");
            let content = msg.get("content").and_then(|c| c.as_str()).unwrap_or("");
            let source = match role {
                "system" => "CHAT_MESSAGE_SOURCE_SYSTEM",
                "assistant" => "CHAT_MESSAGE_SOURCE_CODEIUM",
                _ => "CHAT_MESSAGE_SOURCE_USER",
            };
            serde_json::json!({
                "prompt": content,
                "source": source
            })
        }).collect();

        let body = serde_json::json!({
            "metadata": self.build_metadata(api_key),
            "chatMessagePrompts": chat_prompts,
            "chatModelUid": model_uid,
            "requestType": "CHAT_MESSAGE_REQUEST_TYPE_CASCADE",
            "cascadeId": cascade_id,
            "promptId": prompt_id
        });

        let (resp, content_type) = self.connect_rpc_stream(&url, &body).await?;

        let (tx, rx) = mpsc::channel(64);

        if content_type.contains("application/connect+proto") {
            // Binary Connect-RPC streaming — parse 5-byte framed protobuf
            // For now we return raw bytes as error since we need proto decoding
            let bytes = resp.bytes().await?;
            tokio::spawn(async move {
                let _ = parse_connect_proto_frames(&bytes, &tx).await;
            });
        } else if content_type.contains("application/json") || content_type.contains("text/") {
            // JSON streaming or single JSON response
            let text = resp.text().await?;
            tokio::spawn(async move {
                // Try parsing as newline-delimited JSON
                for line in text.lines() {
                    let line = line.trim();
                    if line.is_empty() { continue; }
                    if let Ok(v) = serde_json::from_str::<Value>(line) {
                        if tx.send(Ok(v)).await.is_err() { break; }
                    }
                }
            });
        } else {
            // Try as single JSON
            let bytes = resp.bytes().await?;
            if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
                let _ = tx.send(Ok(v)).await;
            }
        }

        Ok(rx)
    }
}

/// Parse Connect-RPC binary frames (flags + length + data)
async fn parse_connect_proto_frames(
    data: &[u8],
    tx: &mpsc::Sender<Result<Value>>,
) -> Result<()> {
    let mut buf = &data[..];

    while buf.len() >= FRAME_HEADER_SIZE {
        let flags = buf[0];
        let length = u32::from_be_bytes([buf[1], buf[2], buf[3], buf[4]]) as usize;
        buf = &buf[FRAME_HEADER_SIZE..];

        if buf.len() < length {
            break;
        }

        let frame_data = &buf[..length];
        buf = &buf[length..];

        if flags == 2 {
            // Trailer frame — end of stream
            break;
        }

        // flags == 0: data frame
        // The payload is protobuf binary; we store it as base64 for downstream
        // processing. In production we'd decode with prost.
        let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, frame_data);
        let _ = tx.send(Ok(serde_json::json!({
            "_proto_frame": true,
            "_data_base64": encoded,
            "_length": length
        }))).await;
    }

    Ok(())
}

/// Encode a Connect-RPC frame (for sending requests in binary mode)
pub fn encode_connect_frame(data: &[u8], flags: u8) -> Vec<u8> {
    let mut frame = Vec::with_capacity(FRAME_HEADER_SIZE + data.len());
    frame.push(flags);
    frame.extend_from_slice(&(data.len() as u32).to_be_bytes());
    frame.extend_from_slice(data);
    frame
}
