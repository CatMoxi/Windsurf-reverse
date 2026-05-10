# Windsurf-Reverse

逆向分析 Windsurf Next IDE，研究其代码臃肿原因，提取登录协议，实现 API 反代理。

## 目标

1. **臃肿分析** — 为什么 Windsurf 体积和内存占用如此大？
2. **登录协议** — 逆向账号密码登录和 Auth Token 登录流程
3. **API 反代理** — 提取并代理 Windsurf 后端 API

## 目标版本

- **Windsurf Next v2.2.1017** (commit `a65d6c4e1f`)
- 支持 subagent 的最新 Next 版本

## 项目结构

```
docs/                      逆向分析文档
  protos/                  61 个完整 .proto 文件（从 Go 二进制提取）
  architecture.md          完整架构分析
  auth-protocol.md         登录协议文档
  api-endpoints.md         API 端点文档
src/
  index.js                 API 反代理服务器（Connect-RPC）
  auth.js                  OAuth + RegisterUser 认证模块
  proxy.js                 请求转发模块
  language-server/         ★ 完整 language_server 复刻
    index.js               gRPC 服务器入口
    services/              172 RPC 方法实现
    clients/               API Server + Extension Server 客户端
    core/                  Cascade 引擎 + 中间件
    interceptor.js         gRPC 流量拦截代理
    proto-decoder.js       Proto 解码器（512 methods）
    protos/                完整 proto 目录结构
tools/                     逆向辅助工具/脚本
  extract-proto-final.js   Proto 二进制提取器
  proto-descriptors-full.json  结构化描述符数据
windsurf-next/             下载的 Windsurf Next (gitignored)
```

## 使用方法

### 1. 运行 API 反代理
```bash
cd src
npm install
npm start
# Server starts on http://localhost:3000
```

### 2. 获取登录 URL
```bash
# 生成 OAuth 登录 URL (在浏览器中打开)
curl http://localhost:3000/api/auth/login-url?show_token=true

# 获取 token 后，交换为 API Key
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"access_token": "YOUR_TOKEN_HERE"}'

# 或使用 auth token 备用登录
curl -X POST http://localhost:3000/api/auth/token-login \
  -H "Content-Type: application/json" \
  -d '{"auth_token": "YOUR_AUTH_TOKEN"}'
```

### 3. 代理 API 请求
```bash
# 转发 Connect-RPC 请求到 Windsurf 后端
curl -X POST http://localhost:3000/api/proxy/exa.language_server_pb.LanguageServerService/GetProcesses \
  -H "Content-Type: application/proto" \
  -H "X-Api-Key: YOUR_API_KEY" \
  --data-binary @request.bin
```

### 4. 运行 Language Server 复刻
```bash
cd src/language-server
npm install
node index.js --port 50051 --api_server_url https://server.codeium.com --api_key YOUR_KEY
```

### 5. 拦截真实流量
```bash
# 启动拦截代理（需要知道真实 LS 端口）
cd src/language-server
node interceptor.js --target-port 42100 --listen-port 3100 --verbose
# 然后配置 extension 连接到 3100 端口
```

### 6. 环境变量
```bash
PORT=3000                              # 反代理监听端口
API_SERVER_URL=https://server.codeium.com  # 上游 API
```

## 逆向成果

| 模块 | 提取数据 |
|---|---|
| Extension.js | 6 Services, 383 RPCs, 1736 Messages, 226 Enums |
| Language Server 二进制 | 20 Services, 646 RPCs, 2746 Messages, 287 Enums |
| 完整 Proto 还原 | 61 .proto 文件, 651KB |
| Language Server 复刻 | 172 RPC handlers, 全部可用 |

## 约束

- 仅用于学习研究目的
- 不硬编码任何真实凭据
- 详见 [AGENTS.md](./AGENTS.md)

## License

MIT
