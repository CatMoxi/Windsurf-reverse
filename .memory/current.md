# 当前任务

## 任务
真实 API Key 端到端验证 — 研究 avw 项目的 Auth 方式获取 Token

## 已完成 (Phase 1-5)
- Phase 1-3: 臃肿分析, 登录协议逆向, API端点文档
- Phase 4: Language Server 实现 (Connect-RPC + gRPC)
  - 172个 RPC handler 注册
  - Connect-RPC HTTP/1.1 服务器 (proto 编解码)
  - 16个 e2e 测试全部通过
- Phase 5: Proto 编解码 + API 反代理
  - proto-codec.js: 512方法, protobufjs 直接编解码
  - GetUserStatus → SeatManagementService (register.windsurf.com)
  - GetCompletions → ApiServerService (server.codeium.com)
  - GetChatMessage: 完整流式实现 (LS→API格式转换)
  - camelCase↔snake_case 自动桥接
  - inference client, 请求统计

## 关键发现
- Auth: OAuth2 Implicit Flow → windsurf.com → access_token → registerUser → api_key
- client_id: `3GUryQ7ldAeKEuD2obYnppsnmj58eP5u`
- Register: `https://register.windsurf.com` (Connect-RPC, protobuf binary)
- API: `https://server.codeium.com` + `X-Api-Key` header
- Inference: `https://inference.codeium.com`
- protobufjs 使用 camelCase, @grpc/proto-loader (keepCase) 使用 snake_case

## 下一动作
1. 研究 https://github.com/liubao-cn/avw 的 Auth 登录方式
2. 用户提供 Auth1 格式账号 → 获取 Token
3. 用 Token 运行 live-api-test.js 端到端验证
