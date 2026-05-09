/**
 * Windsurf API Proxy
 * Forwards Connect-RPC requests to Windsurf backend servers
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");

const DEFAULT_API_SERVER = "https://server.codeium.com";
const DEFAULT_REGISTER_SERVER = "https://register.windsurf.com";
const DEFAULT_INFERENCE_SERVER = "https://inference.codeium.com";

/**
 * Forward a Connect-RPC request to the upstream server
 * @param {object} options
 * @param {string} options.targetUrl - Full upstream URL
 * @param {string} options.method - HTTP method
 * @param {object} options.headers - Request headers
 * @param {Buffer} options.body - Request body
 * @returns {Promise<{status: number, headers: object, body: Buffer}>}
 */
function forwardRequest({ targetUrl, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;

    const reqHeaders = { ...headers };
    // Remove hop-by-hop headers
    delete reqHeaders["host"];
    delete reqHeaders["connection"];
    delete reqHeaders["transfer-encoding"];
    // Set correct host
    reqHeaders["host"] = url.host;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: reqHeaders,
    };

    const req = transport.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
    });

    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy(new Error("Request timeout"));
    });

    if (body && body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Determine the upstream server based on the request path
 * @param {string} path - Request path (e.g., /exa.seat_management_pb.SeatManagementService/RegisterUser)
 * @param {string} [apiServerUrl] - Custom API server URL
 * @returns {string} Upstream base URL
 */
function resolveUpstream(path, apiServerUrl) {
  if (path.includes("seat_management_pb")) {
    return DEFAULT_REGISTER_SERVER;
  }
  if (path.includes("language_server_pb") || path.includes("dev_pb") || path.includes("extension_server_pb")) {
    return apiServerUrl || DEFAULT_API_SERVER;
  }
  if (path.includes("product_analytics_pb")) {
    return apiServerUrl || DEFAULT_API_SERVER;
  }
  return apiServerUrl || DEFAULT_API_SERVER;
}

module.exports = {
  forwardRequest,
  resolveUpstream,
  DEFAULT_API_SERVER,
  DEFAULT_REGISTER_SERVER,
  DEFAULT_INFERENCE_SERVER,
};
