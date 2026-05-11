use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

use crate::account::import::auto_import;
use crate::AppState;

/// GET /api/stats
pub async fn get_stats(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.db.get_stats() {
        Ok(stats) => (StatusCode::OK, Json(stats)),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))),
    }
}

/// GET /api/accounts
pub async fn list_accounts(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.pool.manager.get_all() {
        Ok(accounts) => {
            // Mask API keys in response
            let masked: Vec<Value> = accounts.iter().map(|a| {
                let key = &a.api_key;
                let masked_key = if key.len() > 12 {
                    format!("{}...{}", &key[..6], &key[key.len()-4..])
                } else {
                    "***".to_string()
                };
                serde_json::json!({
                    "id": a.id,
                    "api_key_masked": masked_key,
                    "email": a.email,
                    "plan": a.plan,
                    "credits_remaining": a.credits_remaining,
                    "status": a.status,
                    "upstream_url": a.upstream_url,
                    "request_count": a.request_count,
                    "error_count": a.error_count,
                    "last_used": a.last_used,
                    "created_at": a.created_at,
                })
            }).collect();
            (StatusCode::OK, Json(serde_json::json!({"accounts": masked})))
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": e.to_string()}))),
    }
}

#[derive(Deserialize)]
pub struct AddAccountReq {
    pub api_key: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub upstream_url: String,
}

/// POST /api/accounts
pub async fn add_account(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AddAccountReq>,
) -> impl IntoResponse {
    match state.pool.manager.add(&req.api_key, &req.email, &req.upstream_url) {
        Ok(id) => (StatusCode::CREATED, Json(serde_json::json!({"id": id, "status": "added"}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e.to_string()}))),
    }
}

#[derive(Deserialize)]
pub struct DeleteAccountReq {
    pub id: i64,
}

/// DELETE /api/accounts
pub async fn delete_account(
    State(state): State<Arc<AppState>>,
    Json(req): Json<DeleteAccountReq>,
) -> impl IntoResponse {
    match state.pool.manager.remove(req.id) {
        Ok(_) => (StatusCode::OK, Json(serde_json::json!({"status": "deleted"}))),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e.to_string()}))),
    }
}

#[derive(Deserialize)]
pub struct ImportReq {
    pub data: String,
}

/// POST /api/accounts/import — auto-detect format and import
pub async fn import_accounts(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImportReq>,
) -> impl IntoResponse {
    match auto_import(&req.data) {
        Ok(accounts) => {
            let mut added = 0;
            let mut skipped = 0;
            for acc in &accounts {
                match state.pool.manager.add(&acc.api_key, &acc.email, &acc.upstream_url) {
                    Ok(_) => added += 1,
                    Err(_) => skipped += 1,
                }
            }
            (StatusCode::OK, Json(serde_json::json!({
                "parsed": accounts.len(),
                "added": added,
                "skipped": skipped,
            })))
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e.to_string()}))),
    }
}

/// POST /api/health-check — trigger health check for all accounts
pub async fn health_check(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let results = state.pool.health_check_all().await;
    let mut checked = 0;
    let mut healthy = 0;
    for (id, ok, info) in &results {
        checked += 1;
        if *ok {
            healthy += 1;
            let _ = state.pool.manager.set_status(*id, "active");
        } else {
            tracing::warn!("Account {} health check failed: {}", id, info);
            let _ = state.pool.manager.set_status(*id, "error");
        }
    }
    (StatusCode::OK, Json(serde_json::json!({
        "checked": checked,
        "healthy": healthy,
        "unhealthy": checked - healthy,
    })))
}

/// GET /api/models — list available models from upstream
pub async fn list_models(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let (account, upstream_url) = match state.pool.next() {
        Ok(v) => v,
        Err(e) => return (StatusCode::SERVICE_UNAVAILABLE, Json(serde_json::json!({"error": e.to_string()}))),
    };

    match state.pool.client.get_model_configs(&upstream_url, &account.api_key).await {
        Ok(configs) => (StatusCode::OK, Json(configs)),
        Err(e) => (StatusCode::BAD_GATEWAY, Json(serde_json::json!({"error": e.to_string()}))),
    }
}
