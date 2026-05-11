use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{sse::{Event, Sse}, IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::convert::Infallible;
use std::sync::Arc;

use crate::prompt::strip::{strip_system_prompt, StripMode};
use crate::AppState;

/// OpenAI /v1/chat/completions request
#[derive(Debug, Deserialize)]
pub struct OpenAIRequest {
    pub model: String,
    pub messages: Vec<OpenAIMessage>,
    #[serde(default)]
    pub stream: bool,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub top_p: Option<f64>,
    #[serde(default)]
    pub tools: Option<Vec<Value>>,
    #[serde(default)]
    pub tool_choice: Option<Value>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct OpenAIMessage {
    pub role: String,
    #[serde(default)]
    pub content: Option<Value>,
    #[serde(default)]
    pub tool_calls: Option<Vec<Value>>,
    #[serde(default)]
    pub tool_call_id: Option<String>,
}

fn map_model(model: &str) -> &str {
    match model {
        m if m.contains("gpt-4o") => "gpt-4o-low",
        m if m.contains("gpt-4-turbo") => "gpt-4-turbo-low",
        m if m.contains("gpt-4") => "gpt-4o-low",
        m if m.contains("gpt-3.5") => "gpt-3-5-turbo-low",
        m if m.contains("claude") => "claude-sonnet-4-0520-low",
        m if m.contains("gemini") => "gemini-2-5-pro-low",
        _ => "gpt-4o-low",
    }
}

/// POST /v1/chat/completions — OpenAI compatible endpoint
pub async fn chat_completions(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<OpenAIRequest>,
) -> Response {
    // Auth check
    if !state.config.server.api_key.is_empty() {
        let provided = headers.get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .trim_start_matches("Bearer ");
        if provided != state.config.server.api_key {
            return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
                "error": {"message": "Invalid API key", "type": "invalid_request_error"}
            }))).into_response();
        }
    }

    let (account, upstream_url) = match state.pool.next() {
        Ok(v) => v,
        Err(e) => {
            return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
                "error": {"message": e.to_string(), "type": "server_error"}
            }))).into_response();
        }
    };

    let strip_mode = StripMode::from_str(&state.config.prompt.strip_mode);
    let model_uid = map_model(&req.model);
    let cascade_id = uuid::Uuid::new_v4().to_string();
    let prompt_id = uuid::Uuid::new_v4().to_string();

    // Convert OpenAI messages to upstream format
    let upstream_messages: Vec<Value> = req.messages.iter().map(|msg| {
        let content = msg.content.as_ref()
            .map(|c| match c {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default();
        let content = if msg.role == "system" {
            strip_system_prompt(&content, strip_mode)
        } else {
            content
        };
        serde_json::json!({"role": msg.role, "content": content})
    }).collect();

    let start = std::time::Instant::now();

    let mut rx = match state.pool.client.get_chat_message_stream(
        &upstream_url, &account.api_key, model_uid,
        upstream_messages, &cascade_id, &prompt_id,
    ).await {
        Ok(rx) => rx,
        Err(e) => {
            state.pool.mark_failure(account.id);
            return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({
                "error": {"message": e.to_string(), "type": "server_error"}
            }))).into_response();
        }
    };

    let chat_id = format!("chatcmpl-{}", uuid::Uuid::new_v4().simple());

    if req.stream {
        let model = req.model.clone();
        let account_id = account.id;
        let db = state.db.clone();
        let pool = state.pool.clone();

        let stream = async_stream::stream! {
            while let Some(result) = rx.recv().await {
                if let Ok(chunk) = result {
                    let text = super::anthropic::extract_chat_text_pub(&chunk);
                    if !text.is_empty() {
                        let data = serde_json::json!({
                            "id": &chat_id,
                            "object": "chat.completion.chunk",
                            "model": &model,
                            "choices": [{
                                "index": 0,
                                "delta": {"content": text},
                                "finish_reason": null
                            }]
                        });
                        yield Ok::<_, Infallible>(Event::default().data(serde_json::to_string(&data).unwrap()));
                    }
                }
            }

            // Final chunk
            let final_data = serde_json::json!({
                "id": &chat_id,
                "object": "chat.completion.chunk",
                "model": &model,
                "choices": [{
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop"
                }]
            });
            yield Ok(Event::default().data(serde_json::to_string(&final_data).unwrap()));
            yield Ok(Event::default().data("[DONE]".to_string()));

            pool.mark_success(account_id);
            let _ = db.log_request(account_id, "chat/completions", &model, "openai", 0, 0, start.elapsed().as_millis() as i64, "ok", None);
        };

        Sse::new(stream).into_response()
    } else {
        let mut full_text = String::new();
        while let Some(result) = rx.recv().await {
            if let Ok(chunk) = result {
                let text = super::anthropic::extract_chat_text_pub(&chunk);
                full_text.push_str(&text);
            }
        }

        state.pool.mark_success(account.id);
        let _ = state.db.log_request(account.id, "chat/completions", &req.model, "openai", 0, 0, start.elapsed().as_millis() as i64, "ok", None);

        (StatusCode::OK, Json(serde_json::json!({
            "id": chat_id,
            "object": "chat.completion",
            "model": req.model,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": full_text},
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        }))).into_response()
    }
}
