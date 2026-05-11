mod config;
mod db;
mod account;
mod prompt;
mod upstream;
mod routes;

use account::manager::AccountManager;
use config::Config;
use db::Database;
use upstream::pool::AccountPool;

use axum::{
    routing::{get, post, delete},
    Router,
    http::Method,
    response::{Html, IntoResponse},
};
use rust_embed::Embed;
use std::sync::Arc;
use tower_http::cors::{CorsLayer, Any};
use tracing_subscriber::EnvFilter;

/// Embedded web assets (React build output)
#[derive(Embed)]
#[folder = "web/dist"]
#[prefix = ""]
struct WebAssets;

/// Shared application state
pub struct AppState {
    pub config: Config,
    pub db: Arc<Database>,
    pub pool: Arc<AccountPool>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load config
    let config_path = std::env::args().nth(1).unwrap_or_else(|| "config.toml".to_string());
    let config = Config::load(&config_path)?;

    // Init logging
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(&config.logging.level));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .init();

    tracing::info!("Windsurf Proxy v{}", env!("CARGO_PKG_VERSION"));

    // Init database
    let db = Arc::new(Database::new(&config.database.path)?);
    tracing::info!("Database initialized at {}", config.database.path);

    // Init account manager + pool
    let manager = Arc::new(AccountManager::new(db.clone(), &config.accounts.rotation));
    let pool = Arc::new(AccountPool::new(&config, manager));

    let state = Arc::new(AppState {
        config: config.clone(),
        db: db.clone(),
        pool,
    });

    // CORS
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers(Any);

    // Routes
    let app = Router::new()
        // Anthropic API (Claude Code primary)
        .route("/v1/messages", post(routes::anthropic::messages))
        // OpenAI API
        .route("/v1/chat/completions", post(routes::openai::chat_completions))
        // Gemini API
        .route("/v1beta/models/*path", post(routes::gemini::generate_content))
        // Admin API
        .route("/api/stats", get(routes::admin::get_stats))
        .route("/api/accounts", get(routes::admin::list_accounts))
        .route("/api/accounts", post(routes::admin::add_account))
        .route("/api/accounts", delete(routes::admin::delete_account))
        .route("/api/accounts/import", post(routes::admin::import_accounts))
        .route("/api/health-check", post(routes::admin::health_check))
        .route("/api/models", get(routes::admin::list_models))
        // Web UI (embedded React)
        .fallback(serve_web_ui)
        .layer(cors)
        .with_state(state);

    let bind_addr = format!("{}:{}", config.server.host, config.server.port);
    tracing::info!("Listening on http://{}", bind_addr);
    tracing::info!("Claude Code: set ANTHROPIC_BASE_URL=http://{}/v1", bind_addr);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}

/// Serve embedded React web UI or fallback to index.html
async fn serve_web_ui(uri: axum::http::Uri) -> impl IntoResponse {
    let path = uri.path().trim_start_matches('/');

    // Try exact file match
    if let Some(file) = WebAssets::get(path) {
        let mime = mime_guess::from_path(path).first_or_octet_stream();
        return (
            [("content-type", mime.as_ref())],
            file.data.to_vec(),
        ).into_response();
    }

    // SPA fallback: serve index.html
    if let Some(index) = WebAssets::get("index.html") {
        return Html(String::from_utf8_lossy(&index.data).to_string()).into_response();
    }

    // No web UI built yet — show helpful message
    Html(r#"<!DOCTYPE html>
<html><head><title>Windsurf Proxy</title>
<style>body{font-family:system-ui;max-width:800px;margin:40px auto;padding:0 20px;background:#0a0a0a;color:#e0e0e0}
h1{color:#60a5fa}code{background:#1e293b;padding:2px 6px;border-radius:4px}
pre{background:#1e293b;padding:16px;border-radius:8px;overflow-x:auto}
a{color:#60a5fa}</style></head>
<body>
<h1>🚀 Windsurf Proxy</h1>
<p>API server is running. Web UI not built yet.</p>
<h2>API Endpoints</h2>
<pre>
POST /v1/messages          — Anthropic (Claude Code)
POST /v1/chat/completions  — OpenAI compatible
POST /v1beta/models/*      — Gemini compatible

GET  /api/stats            — Dashboard stats
GET  /api/accounts         — List accounts
POST /api/accounts         — Add account
POST /api/accounts/import  — Bulk import
POST /api/health-check     — Check all accounts
GET  /api/models           — List upstream models
</pre>
<h2>Claude Code Setup</h2>
<pre>
set ANTHROPIC_BASE_URL=http://127.0.0.1:8787/v1
set ANTHROPIC_API_KEY=any
claude
</pre>
</body></html>"#.to_string()).into_response()
}
