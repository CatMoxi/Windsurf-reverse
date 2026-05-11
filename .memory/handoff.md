# 交接摘要 (2026-05-11 20:30 更新)

## 当前状态
Phase 1-13 完成。静态+二进制逆向 **~99.5%**。
- Go Binary: pclntab 116,443符号恢复 + Ghidra 13函数反编译 + System Prompt完整提取
- 剩余: @exa/windsurf-acp (710KB, 未知), @exa/chat-client (14MB, UI), 服务器端

## GitHub
https://github.com/CatMoxi/Windsurf-reverse

## 项目结构
```
src/language-server/
  index.js              — 入口, 双模式(Connect-RPC + gRPC)
  connect-server.js     — Connect-RPC HTTP/1.1 服务器
  proto-codec.js        — protobufjs 编解码 (512方法, camelCase)
  proto-decoder.js      — @grpc/proto-loader 解码 (snake_case)
  services/
    language-server-service.js — 172个 RPC handler
  clients/
    api-server-client.js       — gRPC → server.codeium.com
    seat-management-client.js  — Connect-RPC → register.windsurf.com
    extension-server-client.js — Connect-RPC → extension
  core/
    cascade-engine.js    — Cascade 会话管理
    grpc-middleware.js   — gRPC 中间件
  protos/                — 61个 proto 文件
tools/
  e2e-test.js           — 9 tests
  full-flow-test.js     — 7 tests (mock extension→LS→API)
  live-api-test.js      — 真实 API key 验证
  cascade-chat-test.js  — 流式聊天测试
  auth-cli.js           — OAuth 认证 CLI
```

## 关键架构
- extension.js → Connect-RPC(HTTP/1.1 + proto) → language_server(localhost)
- language_server → gRPC(HTTP/2) → server.codeium.com (ApiServerService)
- language_server → Connect-RPC → register.windsurf.com (SeatManagementService)
- camelCase (protobufjs) ↔ snake_case (@grpc/proto-loader) 自动桥接

## API 转发实现
- GetUserStatus → SeatManagement.GetUserStatus
- GetProfileData → SeatManagement.GetProfileData
- GetCompletions → ApiServer.GetCompletions
- GetChatMessage → ApiServer.GetChatMessage (streaming, 格式转换)
- GetCascadeModelConfigs → ApiServer
- CheckUserMessageRateLimit → ApiServer

## Auth 逆向
- OAuth2 Implicit Flow
- client_id: `3GUryQ7ldAeKEuD2obYnppsnmj58eP5u`
- Login → access_token → RegisterUser(firebaseIdToken) → api_key

## 不要重复
- 不要操作本地 D:\Windsurf\
- 不要借鉴 com.chao.windsurf-account-manager
- 不要尝试从 cdn.windsurf.com 下载 source maps
- protobufjs 必须用 camelCase 字段名
