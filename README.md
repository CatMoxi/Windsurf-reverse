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
docs/           逆向分析文档
src/            反代理实现代码
tools/          逆向辅助工具/脚本
windsurf-next/  下载的 Windsurf Next (gitignored)
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

### 4. 环境变量
```bash
PORT=3000                              # 监听端口
API_SERVER_URL=https://server.codeium.com  # 上游 API
```

## 约束

- 仅用于学习研究目的
- 不硬编码任何真实凭据
- 详见 [AGENTS.md](./AGENTS.md)

## License

MIT
