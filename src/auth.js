/**
 * Windsurf Authentication Module
 * Implements OAuth2 login flow and token-based auth
 */
const https = require("https");
const { URL } = require("url");
const { v4: uuidv4 } = require("uuid");
const { encodeRegisterUserRequest, decodeRegisterUserResponse } = require("./proto");

const DEFAULT_REGISTER_URL = "https://register.windsurf.com";
const DEFAULT_API_SERVER_URL = "https://server.codeium.com";
const AUTH0_CLIENT_ID = "3GUryQ7ldAeKEuD2obYnppsnmj58eP5u";
const DEFAULT_WEBSITE = "https://windsurf.com";

// Connect-RPC path for RegisterUser
const REGISTER_USER_PATH = "/exa.seat_management_pb.SeatManagementService/RegisterUser";

/**
 * Build the OAuth2 login URL for browser-based authentication
 * @param {object} options
 * @param {boolean} [options.signup] - Whether this is a signup flow
 * @param {boolean} [options.showAuthToken] - Whether to show auth token (for manual copy)
 * @param {string} [options.loginHint] - Email hint for returning users
 * @param {string} [options.website] - Custom website URL
 * @returns {{url: string, state: string}} Login URL and state for CSRF
 */
function buildLoginUrl(options = {}) {
  const {
    signup = false,
    showAuthToken = false,
    loginHint,
    website = DEFAULT_WEBSITE,
  } = options;

  const state = uuidv4();
  const redirectUri = showAuthToken ? "show-auth-token" : "windsurf://codeium.windsurf";
  const redirectParamsType = showAuthToken ? "query" : "fragment";
  const path = signup ? "windsurf/signup" : "windsurf/signin";

  const params = new URLSearchParams([
    ["response_type", "token"],
    ["client_id", AUTH0_CLIENT_ID],
    ["redirect_uri", redirectUri],
    ["state", state],
    ["prompt", "login"],
    ["redirect_parameters_type", redirectParamsType],
    ["workflow", ""],
  ]);

  if (loginHint) {
    params.append("login_hint", loginHint);
  }

  return {
    url: `${website}/${path}?${params.toString()}`,
    state,
  };
}

/**
 * Make a Connect-RPC unary call (binary format, HTTP/1.1)
 * @param {string} baseUrl - Server base URL
 * @param {string} path - RPC method path
 * @param {Buffer} body - Protobuf-encoded request body
 * @returns {Promise<Buffer>} Response body
 */
function connectRpcCall(baseUrl, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);

    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/proto",
        "Connect-Protocol-Version": "1",
        "Content-Length": body.length,
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const responseBody = Buffer.concat(chunks);
        if (res.statusCode === 200) {
          resolve(responseBody);
        } else {
          const errMsg = responseBody.toString("utf-8");
          reject(new Error(`HTTP ${res.statusCode}: ${errMsg}`));
        }
      });
    });

    req.on("error", reject);
    req.setTimeout(15000, () => req.destroy(new Error("Request timeout")));
    req.write(body);
    req.end();
  });
}

/**
 * Exchange an access token for a Windsurf API key
 * Calls SeatManagementService.RegisterUser via Connect-RPC (binary)
 * @param {string} accessToken - OAuth access_token from browser auth
 * @param {string} [registerUrl] - Register server URL
 * @returns {Promise<{apiKey: string, name: string, apiServerUrl: string, redirectUrl: string}>}
 */
async function registerUser(accessToken, registerUrl = DEFAULT_REGISTER_URL) {
  const requestBody = encodeRegisterUserRequest(accessToken);
  const responseBody = await connectRpcCall(registerUrl, REGISTER_USER_PATH, requestBody);
  const result = decodeRegisterUserResponse(responseBody);

  if (!result.apiKey) {
    throw new Error("Registration failed: empty api_key in response");
  }

  return {
    apiKey: result.apiKey,
    name: result.name,
    apiServerUrl: result.apiServerUrl || DEFAULT_API_SERVER_URL,
    redirectUrl: result.redirectUrl || "",
  };
}

/**
 * Login with auth token (backup method)
 * The user manually provides the access_token copied from the web page
 * @param {string} authToken - The auth token copied from windsurf.com
 * @param {string} [registerUrl] - Register server URL
 * @returns {Promise<{apiKey: string, name: string, apiServerUrl: string}>}
 */
async function loginWithAuthToken(authToken, registerUrl = DEFAULT_REGISTER_URL) {
  return registerUser(authToken, registerUrl);
}

module.exports = {
  buildLoginUrl,
  registerUser,
  loginWithAuthToken,
  connectRpcCall,
  AUTH0_CLIENT_ID,
  DEFAULT_REGISTER_URL,
  DEFAULT_API_SERVER_URL,
  DEFAULT_WEBSITE,
};
