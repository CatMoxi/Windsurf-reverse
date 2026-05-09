/**
 * Windsurf API Reverse Proxy Server
 * 
 * Provides:
 * 1. Login endpoints (OAuth URL generation + token exchange)
 * 2. API proxy (forwards Connect-RPC requests to Windsurf backend)
 * 
 * Usage:
 *   node index.js
 *   # Server starts on port 3000 (or PORT env var)
 */
require("dotenv").config();
const express = require("express");
const { buildLoginUrl, registerUser, loginWithAuthToken } = require("./auth");
const { forwardRequest, resolveUpstream } = require("./proxy");

const app = express();
const PORT = process.env.PORT || 3000;
const API_SERVER_URL = process.env.API_SERVER_URL || "https://server.codeium.com";

// Parse raw body for protobuf forwarding
app.use("/api/proxy", express.raw({ type: () => true, limit: "50mb" }));
// Parse JSON for auth endpoints
app.use("/api/auth", express.json());

// ===== Health Check =====
app.get("/", (req, res) => {
  res.json({
    service: "windsurf-api-proxy",
    version: "1.0.0",
    endpoints: {
      "GET /api/auth/login-url": "Get OAuth login URL",
      "POST /api/auth/register": "Exchange access_token for api_key",
      "POST /api/auth/token-login": "Login with auth token (backup)",
      "POST /api/proxy/{*path}": "Forward Connect-RPC requests to Windsurf backend",
    },
  });
});

// ===== Auth Endpoints =====

/**
 * GET /api/auth/login-url
 * Generate OAuth2 login URL for browser authentication
 * Query params: signup (bool), login_hint (email), show_token (bool)
 */
app.get("/api/auth/login-url", (req, res) => {
  try {
    const { signup, login_hint, show_token } = req.query;
    const result = buildLoginUrl({
      signup: signup === "true",
      showAuthToken: show_token === "true",
      loginHint: login_hint || undefined,
    });
    res.json({
      success: true,
      loginUrl: result.url,
      state: result.state,
      instructions: "Open loginUrl in browser, authenticate, then use the access_token from the redirect",
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/auth/register
 * Exchange OAuth access_token for Windsurf API key
 * Body: { "access_token": "..." }
 */
app.post("/api/auth/register", async (req, res) => {
  try {
    const { access_token } = req.body;
    if (!access_token) {
      return res.status(400).json({ success: false, error: "access_token is required" });
    }

    console.log(`[auth] Registering user with token (${access_token.substring(0, 10)}...)`);
    const result = await registerUser(access_token);
    console.log(`[auth] Registration successful: ${result.name}`);

    res.json({
      success: true,
      apiKey: result.apiKey,
      name: result.name,
      apiServerUrl: result.apiServerUrl,
    });
  } catch (err) {
    console.error(`[auth] Registration failed: ${err.message}`);
    res.status(401).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/auth/token-login
 * Login with manually provided auth token (backup method)
 * Body: { "auth_token": "..." }
 */
app.post("/api/auth/token-login", async (req, res) => {
  try {
    const { auth_token } = req.body;
    if (!auth_token) {
      return res.status(400).json({ success: false, error: "auth_token is required" });
    }

    console.log(`[auth] Token login with (${auth_token.substring(0, 10)}...)`);
    const result = await loginWithAuthToken(auth_token);
    console.log(`[auth] Token login successful: ${result.name}`);

    res.json({
      success: true,
      apiKey: result.apiKey,
      name: result.name,
      apiServerUrl: result.apiServerUrl,
    });
  } catch (err) {
    console.error(`[auth] Token login failed: ${err.message}`);
    res.status(401).json({ success: false, error: err.message });
  }
});

// ===== API Proxy =====

/**
 * POST /api/proxy/{*path}
 * Forward Connect-RPC requests to Windsurf backend
 * The path after /api/proxy/ maps to the upstream path
 * Headers are forwarded (including X-Api-Key)
 * 
 * Example:
 *   POST /api/proxy/exa.language_server_pb.LanguageServerService/GetProcesses
 *   → forwards to https://server.codeium.com/exa.language_server_pb.LanguageServerService/GetProcesses
 */
app.post("/api/proxy/{*path}", async (req, res) => {
  try {
    const upstreamPath = req.params.path;
    const upstream = resolveUpstream(upstreamPath, API_SERVER_URL);
    const targetUrl = upstream + upstreamPath;

    console.log(`[proxy] ${req.method} ${upstreamPath} → ${targetUrl}`);

    const result = await forwardRequest({
      targetUrl,
      method: "POST",
      headers: req.headers,
      body: req.body,
    });

    // Forward response headers
    const responseHeaders = { ...result.headers };
    delete responseHeaders["transfer-encoding"];
    delete responseHeaders["connection"];

    res.status(result.status);
    Object.entries(responseHeaders).forEach(([key, value]) => {
      if (value) res.setHeader(key, value);
    });
    res.send(result.body);
  } catch (err) {
    console.error(`[proxy] Error: ${err.message}`);
    res.status(502).json({ success: false, error: `Proxy error: ${err.message}` });
  }
});

// ===== Start Server =====
app.listen(PORT, () => {
  console.log(`\n🚀 Windsurf API Proxy running on http://localhost:${PORT}`);
  console.log(`\n📋 Endpoints:`);
  console.log(`   GET  /                         - Service info`);
  console.log(`   GET  /api/auth/login-url       - Get OAuth login URL`);
  console.log(`   POST /api/auth/register        - Exchange token for API key`);
  console.log(`   POST /api/auth/token-login     - Login with auth token`);
  console.log(`   POST /api/proxy/{*path}        - Forward to Windsurf backend`);
  console.log(`\n⚙️  Config:`);
  console.log(`   API Server: ${API_SERVER_URL}`);
  console.log(`   Port: ${PORT}`);
  console.log();
});
