use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

use crate::prompt::strip::{strip_system_prompt, StripMode};
use crate::AppState;

/// Gemini generateContent request
#[derive(Debug, Deserialize)]
pub struct GeminiRequest {
    pub contents: Vec<GeminiContent>,
    #[serde(default)]
    pub system_instruction: Option<GeminiContent>,
    #[serde(default)]
    pub generation_config: Option<Value>,
    #[serde(default)]
    pub tools: Option<Vec<Value>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GeminiContent {
    #[serde(default)]
    pub role: Option<String>,
    pub parts: Vec<GeminiPart>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct GeminiPart {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(flatten)]
    pub extra: Value,
}

fn map_model(model: &str) -> &str {
    match model {
        m if m.contains("gemini-2.5-pro") => "gemini-2-5-pro-low",
        m if m.contains("gemini-2.5-flash") => "gemini-2-5-flash-low",
        m if m.contains("gemini-2.0-flash") => "gemini-2-0-flash-low",
        m if m.contains("gemini-1.5-pro") => "gemini-1-5-pro-low",
        _ => "gemini-2-5-pro-low",
    }
}

/// POST /v1beta/models/{model}:generateContent
pub async fn generate_content(
    State(state): State<Arc<AppState>>,
    Path(model_path): Path<String>,
    headers: HeaderMap,
    Json(req): Json<GeminiRequest>,
) -> Response {
    // Auth: Gemini uses ?key= query param or x-goog-api-key header
    if !state.config.server.api_key.is_empty() {
        let provided = headers.get("x-goog-api-key")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        if provided != state.config.server.api_key {
            return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({
                "error": {"code": 401, "message": "Invalid API key", "status": "UNAUTHENTICATED"}
            }))).into_response();
        }
    }

    let (account, upstream_url) = match state.pool.next() {
        Ok(v) => v,
        Err(e) => {
            return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({
                "error": {"code": 503, "message": e.to_string(), "status": "UNAVAILABLE"}
            }))).into_response();
        }
    };

    let strip_mode = StripMode::from_str(&state.config.prompt.strip_mode);
    let model_name = model_path.trim_end_matches(":generateContent")
        .trim_end_matches(":streamGenerateContent");
    let model_uid = map_model(model_name);
    let cascade_id = uuid::Uuid::new_v4().to_string();
    let prompt_id = uuid::Uuid::new_v4().to_string();

    // Convert Gemini messages to upstream format
    let mut upstream_messages: Vec<Value> = Vec::new();

    if let Some(ref sys) = req.system_instruction {
        let text = sys.parts.iter()
            .filter_map(|p| p.text.as_ref())
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        let text = strip_system_prompt(&text, strip_mode);
        if !text.is_empty() {
            upstream_messages.push(serde_json::json!({"role": "system", "content": text}));
        }
    }

    for content in &req.contents {
        let role = content.role.as_deref().unwrap_or("user");
        let text: String = content.parts.iter()
            .filter_map(|p| p.text.as_ref())
            .cloned()
            .collect::<Vec<_>>()
            .join("\n");
        let api_role = match role {
            "model" => "assistant",
            _ => role,
        };
        upstream_messages.push(serde_json::json!({"role": api_role, "content": text}));
    }

    let start = std::time::Instant::now();

    let mut rx = match state.pool.client.get_chat_message_stream(
        &upstream_url, &account.api_key, model_uid,
        upstream_messages, &cascade_id, &prompt_id,
    ).await {
        Ok(rx) => rx,
        Err(e) => {
            state.pool.mark_failure(account.id);
            return (StatusCode::BAD_GATEWAY, Json(serde_json::json!({
                "error": {"code": 502, "message": e.to_string(), "status": "INTERNAL"}
            }))).into_response();
        }
    };

    // Collect full response (non-streaming for simplicity; streaming uses SSE)
    let mut full_text = String::new();
    while let Some(result) = rx.recv().await {
        if let Ok(chunk) = result {
            let text = super::anthropic::extract_chat_text_pub(&chunk);
            full_text.push_str(&text);
        }
    }

    state.pool.mark_success(account.id);
    let _ = state.db.log_request(account.id, "generateContent", model_name, "gemini", 0, 0, start.elapsed().as_millis() as i64, "ok", None);

    (StatusCode::OK, Json(serde_json::json!({
        "candidates": [{
            "content": {
                "parts": [{"text": full_text}],
                "role": "model"
            },
            "finishReason": "STOP",
            "index": 0
        }],
        "usageMetadata": {
            "promptTokenCount": 0,
            "candidatesTokenCount": 0,
            "totalTokenCount": 0
        }
    }))).into_response()
}
