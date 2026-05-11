use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{sse::{Event, Sse}, IntoResponse, Response},
    Json,
};
use futures::stream::Stream;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;

use crate::prompt::strip::{strip_system_prompt, StripMode};
use crate::AppState;

/// Anthropic /v1/messages request (Claude Code format)
#[derive(Debug, Deserialize)]
pub struct AnthropicRequest {
    pub model: String,
    pub messages: Vec<AnthropicMessage>,
    #[serde(default)]
    pub system: Option<String>,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default)]
    pub stream: bool,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub top_p: Option<f64>,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub tools: Option<Vec<Value>>,
    #[serde(default)]
    pub tool_choice: Option<Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct AnthropicMessage {
    pub role: String,
    pub content: AnthropicContent,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(untagged)]
pub enum AnthropicContent {
    Text(String),
    Blocks(Vec<Value>),
}

impl AnthropicContent {
    pub fn to_text(&self) -> String {
        match self {
            AnthropicContent::Text(s) => s.clone(),
            AnthropicContent::Blocks(blocks) => {
                blocks.iter().filter_map(|b| {
                    if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                        b.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                    } else {
                        None
                    }
                }).collect::<Vec<_>>().join("\n")
            }
        }
    }
}

fn default_max_tokens() -> u32 { 8192 }

/// Map Anthropic model names to Windsurf model UIDs
fn map_model(model: &str) -> &str {
    match model {
        m if m.contains("claude-sonnet-4") => "claude-sonnet-4-0520-low",
        m if m.contains("claude-opus-4") => "claude-opus-4-0-low",
        m if m.contains("claude-3-5-sonnet") | m.contains("claude-3.5-sonnet") => "claude-3-5-sonnet-low",
        m if m.contains("claude-3-opus") => "claude-3-opus-low",
        m if m.contains("gpt-4o") => "gpt-4o-low",
        m if m.contains("gpt-4") => "gpt-4-turbo-low",
        m if m.contains("gemini-2.5") => "gemini-2-5-pro-low",
        m if m.contains("gemini-2.0") => "gemini-2-0-flash-low",
        _ => "claude-sonnet-4-0520-low", // default
    }
}

/// POST /v1/messages — Anthropic Messages API (used by Claude Code)
pub async fn messages(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<AnthropicRequest>,
) -> Response {
    // Auth check
    if !state.config.server.api_key.is_empty() {
        let provided = headers.get("x-api-key")
            .or_else(|| headers.get("authorization"))
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .trim_start_matches("Bearer ");
        if provided != state.config.server.api_key {
            return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
                "type": "error",
                "error": {"type": "authentication_error", "message": "Invalid API key"}
            }))).into_response();
        }
    }

    // Pick account
    let (account, upstream_url) = match state.pool.next() {
        Ok(v) => v,
        Err(e) => {
            return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
                "type": "error",
                "error": {"type": "overloaded_error", "message": e.to_string()}
            }))).into_response();
        }
    };

    let strip_mode = StripMode::from_str(&state.config.prompt.strip_mode);
    let model_uid = map_model(&req.model);
    let cascade_id = uuid::Uuid::new_v4().to_string();
    let prompt_id = uuid::Uuid::new_v4().to_string();

    // Build messages for upstream
    let mut upstream_messages: Vec<Value> = Vec::new();

    // System message (stripped if configured)
    if let Some(ref sys) = req.system {
        let sys_content = strip_system_prompt(sys, strip_mode);
        if !sys_content.is_empty() {
            upstream_messages.push(serde_json::json!({"role": "system", "content": sys_content}));
        }
    }

    // User/assistant messages
    for msg in &req.messages {
        let content = msg.content.to_text();
        let content = if msg.role == "system" {
            strip_system_prompt(&content, strip_mode)
        } else {
            content
        };
        upstream_messages.push(serde_json::json!({"role": msg.role, "content": content}));
    }

    let start = std::time::Instant::now();

    // Call Windsurf upstream
    let mut rx = match state.pool.client.get_chat_message_stream(
        &upstream_url,
        &account.api_key,
        model_uid,
        upstream_messages,
        &cascade_id,
        &prompt_id,
    ).await {
        Ok(rx) => rx,
        Err(e) => {
            state.pool.mark_failure(account.id);
            tracing::error!("Upstream error for account {}: {}", account.id, e);
            return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({
                "type": "error",
                "error": {"type": "api_error", "message": e.to_string()}
            }))).into_response();
        }
    };

    if req.stream {
        // SSE streaming response
        let msg_id = format!("msg_{}", uuid::Uuid::new_v4().simple());
        let model = req.model.clone();
        let account_id = account.id;
        let db = state.db.clone();
        let pool = state.pool.clone();

        let stream = async_stream::stream! {
            // Send message_start
            let start_event = serde_json::json!({
                "type": "message_start",
                "message": {
                    "id": &msg_id,
                    "type": "message",
                    "role": "assistant",
                    "model": &model,
                    "content": [],
                    "stop_reason": null,
                    "usage": {"input_tokens": 0, "output_tokens": 0}
                }
            });
            yield Ok::<_, Infallible>(Event::default().event("message_start").json_data(start_event).unwrap());

            // Send content_block_start
            yield Ok(Event::default().event("content_block_start").json_data(serde_json::json!({
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""}
            })).unwrap());

            let mut full_text = String::new();
            let mut chunk_count = 0u64;

            while let Some(result) = rx.recv().await {
                match result {
                    Ok(chunk) => {
                        // Extract text from Windsurf response
                        let text = extract_chat_text(&chunk);
                        if !text.is_empty() {
                            full_text.push_str(&text);
                            chunk_count += 1;
                            yield Ok(Event::default().event("content_block_delta").json_data(serde_json::json!({
                                "type": "content_block_delta",
                                "index": 0,
                                "delta": {"type": "text_delta", "text": text}
                            })).unwrap());
                        }
                    }
                    Err(e) => {
                        tracing::warn!("Stream chunk error: {}", e);
                        break;
                    }
                }
            }

            // Send content_block_stop
            yield Ok(Event::default().event("content_block_stop").json_data(serde_json::json!({
                "type": "content_block_stop",
                "index": 0
            })).unwrap());

            // Send message_delta (stop)
            yield Ok(Event::default().event("message_delta").json_data(serde_json::json!({
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn"},
                "usage": {"output_tokens": chunk_count}
            })).unwrap());

            // Send message_stop
            yield Ok(Event::default().event("message_stop").json_data(serde_json::json!({
                "type": "message_stop"
            })).unwrap());

            // Log
            pool.mark_success(account_id);
            let _ = db.log_request(account_id, "messages", &model, "anthropic", 0, chunk_count as i64, start.elapsed().as_millis() as i64, "ok", None);
        };

        Sse::new(stream).into_response()
    } else {
        // Non-streaming: collect all chunks
        let mut full_text = String::new();
        while let Some(result) = rx.recv().await {
            if let Ok(chunk) = result {
                full_text.push_str(&extract_chat_text(&chunk));
            }
        }

        state.pool.mark_success(account.id);
        let _ = state.db.log_request(account.id, "messages", &req.model, "anthropic", 0, 0, start.elapsed().as_millis() as i64, "ok", None);

        let msg_id = format!("msg_{}", uuid::Uuid::new_v4().simple());
        (StatusCode::OK, Json(serde_json::json!({
            "id": msg_id,
            "type": "message",
            "role": "assistant",
            "model": req.model,
            "content": [{"type": "text", "text": full_text}],
            "stop_reason": "end_turn",
            "usage": {"input_tokens": 0, "output_tokens": 0}
        }))).into_response()
    }
}

/// Public wrapper for other route modules
pub fn extract_chat_text_pub(chunk: &Value) -> String {
    extract_chat_text(chunk)
}

/// Extract text content from a Windsurf chat response chunk
fn extract_chat_text(chunk: &Value) -> String {
    // Try various Windsurf response formats
    // Format 1: action.generic.text (delta_text)
    if let Some(text) = chunk.pointer("/chat_message/action/generic/text") {
        return text.as_str().unwrap_or("").to_string();
    }
    // Format 2: delta_text field
    if let Some(text) = chunk.get("delta_text") {
        return text.as_str().unwrap_or("").to_string();
    }
    // Format 3: text at top level
    if let Some(text) = chunk.get("text") {
        return text.as_str().unwrap_or("").to_string();
    }
    // Format 4: message content
    if let Some(text) = chunk.pointer("/message/content") {
        return text.as_str().unwrap_or("").to_string();
    }
    String::new()
}
