# Windsurf 登录协议文档

> 分析目标: Windsurf Next v2.2.1017 (commit a65d6c4e1f)
> 分析日期: 2025-05-10

## 认证架构概览

```
用户 → windsurf.com/windsurf/signin (OAuth 2.0 Implicit Flow)
      → 获取 access_token (fragment)
      → registerUser({firebaseIdToken: access_token})
         via Connect-RPC to register.windsurf.com
      → 获取 {apiKey, name, apiServerUrl}
      → 所有后续 API 使用 X-Api-Key header
```

## 1. 登录流程

### Step 1: 构造登录 URL

**函数**: `WindsurfAuthProvider.getLoginUrl()`

```
GET https://windsurf.com/windsurf/signin?{params}
```

| 参数 | 值 | 说明 |
|---|---|---|
| `response_type` | `token` | OAuth 2.0 Implicit Grant |
| `client_id` | `3GUryQ7ldAeKEuD2obYnppsnmj58eP5u` | Auth0 Client ID |
| `redirect_uri` | `windsurf://codeium.windsurf` 或 `show-auth-token` | 回调 URI |
| `state` | `{uuid}` | CSRF 防护 |
| `prompt` | `login` | 强制显示登录页 |
| `redirect_parameters_type` | `fragment` 或 `query` | token 返回方式 |
| `workflow` | `onboarding` (可选) | 新用户引导流程 |
| `login_hint` | `{email}` (可选) | 上次登录邮箱 |

**注册 URL**: 将路径改为 `windsurf/signup`

**多租户模式** (EU/FedStart):
- 额外参数: `scope=openid profile email`
- 路径改为: `profile`

### Step 2: 浏览器认证

用户在浏览器中通过 `windsurf.com` 完成认证，支持：
- **邮箱/密码** (`signInWithPassword`)
- **OAuth** (`signInWithOAuth`) — Google, GitHub 等
- **SSO** (`signInWithSSO`)
- **OTP** (`signInWithOtp`)
- **ID Token** (`signInWithIdToken`)

### Step 3: 获取 Access Token

认证成功后，`windsurf.com` 重定向到:
```
windsurf://codeium.windsurf#access_token={TOKEN}&...
```

**解析方式**: `WindsurfAuthProvider.handleUri()`
```javascript
const token = new URLSearchParams(uri.fragment).get("access_token");
```

### Step 4: 注册用户 (Token → API Key)

**函数**: `registerUser(firebaseIdToken)`

```
POST https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser
Content-Type: application/proto
```

**协议**: Connect-RPC (gRPC-Web), Binary Format, HTTP/1.1

**请求 Proto** (`exa.seat_management_pb.RegisterUserRequest`):
```protobuf
message RegisterUserRequest {
  string firebase_id_token = 1; // 实际上是 OAuth access_token
}
```

**响应 Proto** (`exa.seat_management_pb.RegisterUserResponse`):
```protobuf
message RegisterUserResponse {
  string api_key = 1;           // 用于后续所有 API 调用
  string name = 2;              // 用户名
  string api_server_url = 3;    // API 服务器地址 (可能重定向)
  string redirect_url = 4;      // 重定向 URL
  repeated TeamOption team_options = 5; // 团队选项
}
```

### Step 5: 存储凭据

- `apiKey` → 存储在 VS Code SecretStorage (`windsurf_auth.sessions`)
- `apiServerUrl` → 存储在 globalState (`apiServerUrl`)
- Session 格式: `{id, accessToken: apiKey, account: {label: name, id: name}, scopes: []}`

## 2. 备用登录: Auth Token

**命令**: `windsurf.loginWithAuthToken`

1. 打开浏览器: `windsurf.com/windsurf/signin?redirect_uri=show-auth-token&redirect_parameters_type=query`
2. 用户手动复制 token
3. 粘贴到 VS Code InputBox
4. 调用同样的 `registerUser()` 流程

## 3. API Key 使用

所有后续 API 请求通过 `X-Api-Key` header 传递:

```
POST https://server.codeium.com/...
X-Api-Key: {api_key}
Content-Type: application/proto
```

**Metadata Proto** (`exa.codeium_common_pb.Metadata`):
```protobuf
message Metadata {
  string ide_name = 1;
  string ide_version = 7;
  string ide_type = 28;
  string extension_name = 12;
  string extension_version = 2;
  string api_key = 3;            // API Key
  string locale = 4;
  string os = 5;
  string hardware = 8;
  bool disable_telemetry = 6;
  string session_id = 10;
  Timestamp ls_timestamp = 16;
  uint64 request_id = 9;
  string source_address = 11;
}
```

## 4. 语言服务器认证

Language Server 通过 JSON-RPC `authenticate` 方法传递 API Key:

```json
{
  "method": "authenticate",
  "params": {
    "methodId": "windsurf-api-key",
    "_meta": {
      "api_key": "{api_key}",
      "api_server_url": "{api_server_url}"
    }
  }
}
```

## 5. Devin Session Token

`fetchSelfDevinSessionToken(apiKey)`:
- 调用 `SeatManagementService/GetSelfDevinSessionToken`
- 使用 `X-Api-Key` header
- 返回 Devin session token 用于 Devin 集成

## 6. 服务器地址

| 配置 | 默认值 | 说明 |
|---|---|---|
| `API_SERVER_URL` | `https://server.codeium.com` | 主 API 服务器 |
| `REGISTER_API_SERVER_URL` | `https://register.windsurf.com` | 注册服务器 |
| `INFERENCE_API_SERVER_URL` | `https://inference.codeium.com` | 推理服务器 |
| `WEBSITE` | `https://windsurf.com` | 网站 (登录页面) |

**EU 区域**:
- API: `https://eu.windsurf.com/_route/api_server`
- Website: `https://eu.windsurf.com`

**FedStart**:
- API: `https://windsurf.fedstart.com/_route/api_server`

**Staging**:
- API: `https://server-staging.codeium.com`
- Website: `https://codeium-staging-exafunction.vercel.app`

## 7. 关键发现

- `client_id=3GUryQ7ldAeKEuD2obYnppsnmj58eP5u` — 这是固定的 Auth0 客户端 ID
- 虽然字段名为 `firebaseIdToken`，实际传递的是 OAuth access_token
- Connect-RPC 使用 Binary Format (protobuf)，HTTP/1.1
- Feature flags 通过 `https://unleash.codeium.com/api/` (Unleash) 管理
