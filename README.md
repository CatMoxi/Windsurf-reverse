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
Windsurf-Reverse/
docs/                        逆向分析文档
  protos/                    61 个完整 .proto 文件（从 Go 二进制提取）
  architecture.md            完整架构分析
  auth-protocol.md           登录协议文档
  api-endpoints.md           API 端点文档
  ls-launch-protocol.md      ★ LS 启动协议（CLI 参数/stdin/CSRF/命名管道）
  cascade-tools.md           Cascade 37 种工具步骤文档
src/
  index.js                   API 反代理服务器（Connect-RPC）
  auth.js                    OAuth + RegisterUser 认证模块
  proxy.js                   请求转发模块
  language-server/           ★ 完整 language_server 复刻
    index.js                 双模式入口（Connect-RPC + gRPC）
    connect-server.js        Connect-RPC HTTP/1.1 服务器
    services/                172 RPC 方法实现
    clients/                 API / Extension / SeatManagement 客户端
    core/                    Cascade 引擎 + 中间件 + 工具执行器
    interceptor.js           gRPC 流量拦截代理
    proto-decoder.js         Proto 解码器（512 methods）
    protos/                  完整 proto 目录结构
tools/                       逆向辅助工具/脚本
  auth-cli.js                ★ 独立认证 CLI（login/register/status）
  e2e-test.js                ★ 端到端测试套件（9 tests）
  extract-proto-final.js     Proto 二进制提取器
  analyze-capture.js         流量捕获分析工具
windsurf-next/               下载的 Windsurf Next (gitignored)
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

# Connect-RPC 模式（真实 extension 兼容）
node index.js --connect_mode --run_child --csrf_token YOUR_TOKEN \
  --api_server_url https://server.codeium.com --api_key YOUR_KEY

# 标准 gRPC 模式（测试用）
node index.js --port 50051 --api_key YOUR_KEY

# 使用 impersonate_tier 绕过 Trial 限速
node index.js --connect_mode --api_key YOUR_KEY \
  --impersonate_tier TEAMS_TIER_DEVIN_PRO
# 或通过环境变量:
IMPERSONATE_TIER=TEAMS_TIER_DEVIN_PRO node index.js --connect_mode --api_key YOUR_KEY
```

### 5. 独立认证工具
```bash
# 生成 OAuth 登录 URL
node tools/auth-cli.js login --show-token

# 用 token 换取 API key
node tools/auth-cli.js register YOUR_ACCESS_TOKEN

# 查看已保存的凭据
node tools/auth-cli.js status
```

### 6. 运行端到端测试
```bash
# 完整 E2E 测试（自动启动 LS + 9 项测试）
node tools/e2e-test.js

# 带 API key 测试（验证真实 API 转发）
node tools/e2e-test.js --api-key YOUR_KEY
```

### 7. 拦截真实流量
```bash
cd src/language-server
node interceptor.js --target-port 42100 --listen-port 3100 --verbose
```

### 8. 环境变量
```bash
PORT=3000                              # 反代理监听端口
API_SERVER_URL=https://server.codeium.com  # 上游 API
WINDSURF_CSRF_TOKEN=xxx                # CSRF token
IMPERSONATE_TIER=TEAMS_TIER_DEVIN_PRO  # 伪装 Pro 层级 (绕过限速)
```

### 有效的 TeamsTier 值
| 枚举值 | 数值 | 说明 |
|--------|------|------|
| `TEAMS_TIER_DEVIN_FREE` | - | 免费 |
| `TEAMS_TIER_DEVIN_TRIAL` | 20 | 试用 (默认) |
| `TEAMS_TIER_DEVIN_PRO` | 16 | **Pro (推荐)** |
| `TEAMS_TIER_DEVIN_MAX` | 17 | Max |
| `TEAMS_TIER_DEVIN_TEAMS` | - | 团队 |
| `TEAMS_TIER_DEVIN_ENTERPRISE` | 12 | 企业 |

## 逆向成果

| 模块 | 提取数据 |
|---|---|
| Extension.js | 6 Services, 383 RPCs, 1736 Messages, 226 Enums |
| Language Server 二进制 | 20 Services, 646 RPCs, 2746 Messages, 287 Enums |
| 完整 Proto 还原 | 61 .proto 文件, 651KB |
| Language Server 复刻 | 172 RPC handlers, Connect-RPC + gRPC 双模式 |
| 启动协议 | 完整 CLI 参数、stdin metadata、CSRF、命名管道 |
| 端到端测试 | 9 tests all passing (CSRF/unary/streaming) |
| 深度接口分析 | 128 章节, 12,215 行, 静态分析 ~97% |
| Go 二进制分析 | 175 内部包, 53 Go 模块, 14+ URLs |
| Pro 伪装 | impersonate_tier 注入, TEAMS_TIER_DEVIN_PRO |

## 约束

- 仅用于学习研究目的
- 不硬编码任何真实凭据
- 详见 [AGENTS.md](./AGENTS.md)

## License

MIT
