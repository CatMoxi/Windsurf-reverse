# Cascade Chat Protocol - 完整调用文档

## 概述

成功实现了 Auth1 token → 流式 AI 聊天的完整链路。

## 认证流程 (4步)

```
auth1_token 
  → [1] WindsurfPostAuth → session_token + account_id + org_id
  → [2] GetOneTimeAuthToken → ott$xxx (一次性token)
  → [3] RegisterUser → api_key (JWT) + api_server_url
  → [4] 使用 api_key 调用 API
```

### Step 1: WindsurfPostAuth
- URL: `https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/WindsurfPostAuth`
- Header: `X-Devin-Auth1-Token: auth1_xxx`
- Body: `encodeStringField(1, org_id)` (可为空字符串)
- Response: session_token(1), orgs(2), auth1_token(3), account_id(4), primary_org_id(5)

### Step 2: GetOneTimeAuthToken
- URL: `https://web-backend.windsurf.com/exa.seat_management_pb.SeatManagementService/GetOneTimeAuthToken`
- Headers: x-auth-token, x-devin-session-token, x-devin-account-id, x-devin-auth1-token, x-devin-primary-org-id
- Body: `encodeStringField(1, session_token)`
- Response: auth_token(1) → `ott$xxxx`

### Step 3: RegisterUser
- URL: `https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser`
- Body: `encodeStringField(1, one_time_token)`
- Response: api_key(1), name(2), api_server_url(3)
- api_key 格式: `devin-session-token$<JWT>`
- api_server_url: `https://server.self-serve.windsurf.com`

## API 调用

### 服务器
| 账号类型 | 服务器 |
|---------|--------|
| Auth1/Devin | `server.self-serve.windsurf.com` |
| 标准 (推测) | `server.codeium.com` |

### 协议
- **Connect-RPC** (HTTP/1.1 + protobuf)
- NOT gRPC! (gRPC 对这些 key 返回 INVALID_ARGUMENT)
- Content-Type: `application/proto` (unary) / `application/connect+proto` (stream)
- Connect-Protocol-Version: `1`

### 流式请求格式
```
Request = 5-byte envelope + protobuf payload
  envelope[0] = 0x00 (flags: data frame)
  envelope[1:5] = uint32BE(payload.length)
  envelope[5:] = payload
```

### 流式响应格式
```
Response = sequence of frames
  frame[0] = flags (0x00=data, 0x02=trailer)
  frame[1:5] = uint32BE(data.length)
  frame[5:] = data (protobuf if data, JSON if trailer)
```

## GetChatMessage

### 必要字段
```protobuf
message GetChatMessageRequest {
  Metadata metadata = 1;           // api_key, ide_name, ide_version, session_id, request_id
  repeated ChatMessagePrompt chat_message_prompts = 3;
  string chat_model_uid = 21;      // e.g. "gpt-5-5-low"
  ChatMessageRequestType request_type = 7;  // CASCADE = 5
  string cascade_id = 16;          // UUID per conversation
  string prompt_id = 17;           // UUID per request
}
```

### 关键约束
- `ideVersion` >= "2.5.0" (旧版本会触发 "please update your editor" 错误)
- `requestType` 必须设置为 CASCADE (5)
- `cascadeId` 和 `promptId` 必须为有效 UUID
- `chatModelUid` 需从 GetCascadeModelConfigs 获取的有效值

### 成功响应
```protobuf
message GetChatMessageResponse {
  string message_id = 1;
  string delta_text = 3;           // 流式增量文本
  uint32 delta_tokens = 4;
  StopReason stop_reason = 5;
  repeated ChatToolCall delta_tool_calls = 6;
}
```

## GetCascadeModelConfigs

### 请求
- URL: `/exa.api_server_pb.ApiServerService/GetCascadeModelConfigs`
- 无需流式封装（unary）
- Content-Type: application/proto

### 响应字段
```javascript
{
  clientModelConfigs: [...],      // 115 models
  clientModelSorts: [...],        // 5 sort options
  defaultOverrideModelConfig: {   // default model
    versionId: "gpt-5.5-low-04302026",
    modelUid: "gpt-5-5-low"
  }
}
```

## 验证结果
- ✅ GetCascadeModelConfigs: 200 OK, 115 模型
- ✅ GetChatMessage: 200 OK, 流式响应 "Hello from Cascade!"
- ❌ gRPC (server.codeium.com): INVALID_ARGUMENT (不支持 devin-session-token key)
- ❌ ideVersion < 2.5.0: failed_precondition
