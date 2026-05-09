# Windsurf API 端点文档

> 分析目标: Windsurf Next v2.2.1017 (commit a65d6c4e1f)
> 分析日期: 2025-05-10

## 服务器地址

| 服务 | URL |
|---|---|
| API Server | `https://server.codeium.com` |
| Register Server | `https://register.windsurf.com` |
| Inference Server | `https://inference.codeium.com` |
| Website (Auth) | `https://windsurf.com` |
| Feature Flags | `https://unleash.codeium.com/api/` |
| EU API | `https://eu.windsurf.com/_route/api_server` |
| FedStart API | `https://windsurf.fedstart.com/_route/api_server` |

## 协议

- **Connect-RPC** (gRPC-Web compatible)
- **Binary Format** (Protobuf wire format)
- **HTTP/1.1**

## gRPC Services

### 1. SeatManagementService
- **Package**: `exa.seat_management_pb`
- **Server**: `https://register.windsurf.com`

| Method | Request | Response | 说明 |
|---|---|---|---|
| `RegisterUser` | `RegisterUserRequest` | `RegisterUserResponse` | 用 token 注册/登录，获取 api_key |
| `GetUserStatus` | `GetUserStatusRequest` | `GetUserStatusResponse` | 获取用户状态 |
| `GetUsers` | `GetUsersRequest` | `GetUsersResponse` | 获取用户列表 |
| `GetRolesForUser` | `GetRolesForUserRequest` | `GetRolesForUserResponse` | 获取用户角色 |
| `AddUserRole` | `AddUserRoleRequest` | `AddUserRoleResponse` | 添加用户角色 |
| `MigrateApiKey` | `MigrateApiKeyRequest` | — | API Key 迁移 |
| `GetSelfDevinSessionToken` | — | — | 获取 Devin session token |

### 2. LanguageServerService
- **Package**: `exa.language_server_pb`
- **Server**: `https://server.codeium.com`

| Method | 说明 |
|---|---|
| `RegisterUser` | 注册用户 (旧版) |
| `MigrateApiKey` | API Key 迁移 |
| `GetAuthToken` | 获取认证 token |
| `GetProcesses` | 获取进程列表 |
| `RecordEvent` | 记录事件 |
| `RecordSystemMetrics` | 记录系统指标 |
| `CancelRequest` | 取消请求 |
| `GetTranscription` | 获取转录 |
| `GenerateCommitMessage` | 生成 commit 消息 |

### 3. ProductAnalyticsService
- **Package**: `exa.product_analytics_pb`

### 4. ExtensionServerService
- **Package**: `exa.extension_server_pb`

### 5. DevService
- **Package**: `exa.dev_pb`

## 关键 Proto 消息

### RegisterUserRequest
```protobuf
message RegisterUserRequest {
  string firebase_id_token = 1;
}
```

### RegisterUserResponse
```protobuf
message RegisterUserResponse {
  string api_key = 1;
  string name = 2;
  string api_server_url = 3;
  string redirect_url = 4;
  repeated TeamOption team_options = 5;
}
```

### Metadata (通用请求头)
```protobuf
message Metadata {
  string ide_name = 1;
  string ide_version = 7;
  string ide_type = 28;
  string extension_name = 12;
  string extension_version = 2;
  string api_key = 3;
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

### GetAuthTokenResponse
```protobuf
message GetAuthTokenResponse {
  string auth_token = 1;
  string uuid = 2;
}
```

### MigrateApiKeyRequest
```protobuf
message MigrateApiKeyRequest {
  string api_key = 1;
}
```

## API 调用示例

### Connect-RPC 请求格式

```
POST /{package}.{Service}/{Method}
Content-Type: application/proto
Connect-Protocol-Version: 1

[protobuf binary body]
```

### 注册用户示例
```
POST https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser
Content-Type: application/proto
Connect-Protocol-Version: 1

[RegisterUserRequest protobuf binary]
```

### 带认证的 API 调用
```
POST https://server.codeium.com/exa.language_server_pb.LanguageServerService/...
Content-Type: application/proto
Connect-Protocol-Version: 1
X-Api-Key: {api_key}

[protobuf binary body with Metadata]
```
