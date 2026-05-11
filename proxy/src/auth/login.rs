use anyhow::{anyhow, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

use super::proto::*;

// Server URLs
const WEB_BACKEND: &str = "https://web-backend.windsurf.com";
const REGISTER_URL: &str = "https://register.windsurf.com";
const DEFAULT_API_SERVER: &str = "https://server.codeium.com";

// OAuth2
const AUTH0_CLIENT_ID: &str = "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u";
const WEBSITE: &str = "https://windsurf.com";

// RPC paths
const POST_AUTH_PATH: &str = "/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth";
const GET_OTT_PATH: &str = "/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken";
const REGISTER_USER_PATH: &str = "/exa.seat_management_pb.SeatManagementService/RegisterUser";
const GET_USER_STATUS_PATH: &str = "/exa.seat_management_pb.SeatManagementService/GetUserStatus";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginResult {
    pub api_key: String,
    pub name: String,
    pub api_server_url: String,
    pub email: String,
}

#[derive(Debug, Clone)]
struct PostAuthResult {
    session_token: String,
    auth1_token: Option<String>,
    account_id: Option<String>,
    primary_org_id: Option<String>,
}

/// HTTP client for Connect-RPC binary calls
fn build_client() -> Client {
    Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("failed to build HTTP client")
}

/// Make a Connect-RPC call with binary protobuf encoding
async fn connect_rpc_proto(
    client: &Client,
    url: &str,
    body: &[u8],
    extra_headers: &[(&str, &str)],
) -> Result<Vec<u8>> {
    let body_vec = body.to_vec();
    let body_len = body_vec.len();
    let mut req = client.post(url)
        .header("Content-Type", "application/proto")
        .header("Connect-Protocol-Version", "1")
        .header("User-Agent", "connect-es/1.4.0")
        .header("Content-Length", body_len.to_string())
        .body(body_vec);

    for (k, v) in extra_headers {
        req = req.header(*k, *v);
    }

    let resp = req.send().await?;
    let status = resp.status();
    let bytes = resp.bytes().await?;

    if !status.is_success() {
        let text = String::from_utf8_lossy(&bytes);
        return Err(anyhow!("Connect-RPC {} failed: {} - {}", url, status, &text[..text.len().min(200)]));
    }

    Ok(bytes.to_vec())
}

// ==================== Auth1 Login Flow ====================
// Step 1: WindsurfPostAuth(auth1_token) → session_token
// Step 2: GetOneTimeAuthToken(session_token) → ott
// Step 3: RegisterUser(ott) → api_key

/// Full Auth1 login: auth1_token → api_key
pub async fn login_auth1(auth1_token: &str) -> Result<LoginResult> {
    let client = build_client();

    // Step 1: PostAuth
    tracing::info!("Auth1 Step 1/3: WindsurfPostAuth...");
    let post_auth = windsurf_post_auth(&client, auth1_token).await?;
    tracing::info!("Auth1 Step 1/3: Got session token");

    // Step 2: GetOneTimeAuthToken
    tracing::info!("Auth1 Step 2/3: GetOneTimeAuthToken...");
    let ott = get_one_time_auth_token(&client, &post_auth).await?;
    tracing::info!("Auth1 Step 2/3: Got OTT: {}...", &ott[..ott.len().min(20)]);

    // Step 3: RegisterUser
    tracing::info!("Auth1 Step 3/3: RegisterUser...");
    let result = register_user(&client, &ott).await?;
    tracing::info!("Auth1 Step 3/3: Got api_key, server: {}", result.api_server_url);

    Ok(result)
}

/// Step 1: WindsurfPostAuth — exchange auth1 token for session token
async fn windsurf_post_auth(client: &Client, auth1_token: &str) -> Result<PostAuthResult> {
    let url = format!("{}{}", WEB_BACKEND, POST_AUTH_PATH);

    // Body: org_id = field 1 (can be empty)
    // The auth1 token goes in the header
    // Even for empty body, send valid protobuf (empty message = zero bytes)
    let body: Vec<u8> = Vec::new();

    let resp_bytes = connect_rpc_proto(
        client,
        &url,
        &body,
        &[
            ("X-Devin-Auth1-Token", auth1_token),
            ("referer", "https://windsurf.com/account/login"),
        ],
    ).await?;

    let data = strip_envelope(&resp_bytes);
    let fields = decode_fields(data);

    let session_token = fields.get(&1)
        .and_then(|v| v.first())
        .map(|v| v.as_string())
        .unwrap_or_default();

    if session_token.is_empty() {
        return Err(anyhow!("PostAuth returned empty session_token"));
    }

    Ok(PostAuthResult {
        session_token,
        auth1_token: fields.get(&3).and_then(|v| v.first()).map(|v| v.as_string()),
        account_id: fields.get(&4).and_then(|v| v.first()).map(|v| v.as_string()),
        primary_org_id: fields.get(&5).and_then(|v| v.first()).map(|v| v.as_string()),
    })
}

/// Step 2: GetOneTimeAuthToken — exchange session token for OTT
async fn get_one_time_auth_token(client: &Client, auth: &PostAuthResult) -> Result<String> {
    let url = format!("{}{}", WEB_BACKEND, GET_OTT_PATH);

    let body = encode_string_field(1, &auth.session_token);

    let mut headers: Vec<(&str, &str)> = vec![
        ("x-auth-token", &auth.session_token),
    ];

    // Devin session tokens need extra headers
    let session_token_owned;
    let account_id_owned;
    let auth1_token_owned;
    let org_id_owned;

    if auth.session_token.starts_with("devin-session-token$") {
        session_token_owned = auth.session_token.clone();
        headers.push(("x-devin-session-token", &session_token_owned));

        if let Some(ref id) = auth.account_id {
            account_id_owned = id.clone();
            headers.push(("x-devin-account-id", &account_id_owned));
        }
        if let Some(ref t) = auth.auth1_token {
            auth1_token_owned = t.clone();
            headers.push(("x-devin-auth1-token", &auth1_token_owned));
        }
        if let Some(ref org) = auth.primary_org_id {
            org_id_owned = org.clone();
            headers.push(("x-devin-primary-org-id", &org_id_owned));
        }
    }

    let resp_bytes = connect_rpc_proto(client, &url, &body, &headers).await?;
    let data = strip_envelope(&resp_bytes);
    let fields = decode_fields(data);

    let ott = fields.get(&1)
        .and_then(|v| v.first())
        .map(|v| v.as_string())
        .unwrap_or_default();

    if ott.is_empty() {
        return Err(anyhow!("GetOneTimeAuthToken returned empty OTT"));
    }

    Ok(ott)
}

// ==================== OAuth2 Browser Login ====================

/// Build OAuth2 login URL for browser-based authentication
pub fn build_login_url(signup: bool) -> (String, String) {
    let state = uuid::Uuid::new_v4().to_string();
    let path = if signup { "windsurf/signup" } else { "windsurf/signin" };

    let url = format!(
        "{}/{}?response_type=token&client_id={}&redirect_uri=show-auth-token&state={}&prompt=login&redirect_parameters_type=query&workflow=",
        WEBSITE, path, AUTH0_CLIENT_ID, state
    );

    (url, state)
}

/// Login with OAuth2 access_token (obtained from browser redirect)
pub async fn login_oauth(access_token: &str) -> Result<LoginResult> {
    let client = build_client();
    register_user(&client, access_token).await
}

// ==================== Shared: RegisterUser ====================

/// RegisterUser: exchange token (OTT or access_token) for api_key
/// message RegisterUserRequest { string firebase_id_token = 1; }
/// message RegisterUserResponse { string api_key = 1; string name = 2; string api_server_url = 3; }
async fn register_user(client: &Client, token: &str) -> Result<LoginResult> {
    let url = format!("{}{}", REGISTER_URL, REGISTER_USER_PATH);
    let body = encode_string_field(1, token);

    let resp_bytes = connect_rpc_proto(client, &url, &body, &[]).await?;
    let data = strip_envelope(&resp_bytes);
    let fields = decode_fields(data);

    let api_key = fields.get(&1)
        .and_then(|v| v.first())
        .map(|v| v.as_string())
        .unwrap_or_default();

    if api_key.is_empty() {
        return Err(anyhow!("RegisterUser returned empty api_key"));
    }

    Ok(LoginResult {
        api_key,
        name: fields.get(&2).and_then(|v| v.first()).map(|v| v.as_string()).unwrap_or_default(),
        api_server_url: fields.get(&3).and_then(|v| v.first()).map(|v| v.as_string())
            .unwrap_or_else(|| DEFAULT_API_SERVER.to_string()),
        email: String::new(),
    })
}

// ==================== Account Health Check (proto) ====================

/// Check account health using binary protobuf encoding
/// This is the proper Connect-RPC call that avoids the 415 error
pub async fn check_account_proto(api_key: &str, upstream_url: &str) -> Result<serde_json::Value> {
    let client = build_client();
    let url = format!("{}{}", upstream_url, GET_USER_STATUS_PATH);

    let metadata = encode_metadata(
        api_key, "windsurf", "2.5.0", "2.5.0",
        &uuid::Uuid::new_v4().to_string(), 1,
    );
    let body = encode_message_field(1, &metadata);

    let resp_bytes = connect_rpc_proto(&client, &url, &body, &[]).await?;
    let data = strip_envelope(&resp_bytes);
    let fields = decode_fields(data);

    // Parse UserStatus response fields
    Ok(serde_json::json!({
        "status": "ok",
        "has_data": !fields.is_empty(),
        "field_count": fields.len(),
    }))
}
