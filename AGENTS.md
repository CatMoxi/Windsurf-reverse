# AGENTS.md - Windsurf Reverse Engineering 项目约束

## 项目目标
逆向 Windsurf Next IDE，分析其臃肿原因，提取登录协议，实现 API 反代理。

## 强制约束

### 1. 代码来源
- **禁止** 借鉴、复制、引用本地其他项目的现成代码（包括 `com.chao.windsurf-account-manager` 等）
- 所有逆向结果必须从下载的 Windsurf Next 包直接分析获得
- 第三方开源库可以正常引用，但实现逻辑必须原创

### 2. 操作范围
- **禁止** 修改或操作本地已安装的 `D:\Windsurf\`
- 分析目标仅限于项目目录下的 `windsurf-next/` 解压文件
- 不得影响正在运行的 Windsurf IDE 进程

### 3. 逆向工程规范
- 所有发现必须记录在 `docs/` 目录下
- API 端点、请求格式、协议结构必须有完整文档
- 逆向代码分析过程中发现的关键函数/模块需记录文件路径和偏移
- 使用 `.memory/` (auto-sync-agent-memory) 管理项目记忆，防止上下文丢失

### 4. 安全与合规
- 不硬编码任何真实账号凭据
- API key / token 等敏感信息使用环境变量或 `.env` 文件（已 gitignore）
- 逆向结果仅用于学习研究目的

### 5. 代码质量
- 实现代码必须可直接运行
- 必须有清晰的 README 说明使用方法
- 反代理服务必须有错误处理和日志

## 项目结构
```
Windsurf-reverse/
├── AGENTS.md              # 本文件 - 项目约束
├── README.md              # 项目说明
├── docs/                  # 逆向分析文档
│   ├── bloat-analysis.md  # 臃肿原因分析
│   ├── auth-protocol.md   # 登录协议文档
│   └── api-endpoints.md   # API 端点文档
├── windsurf-next/         # 下载的 Windsurf Next 解压目录 (gitignored)
├── src/                   # 反代理实现代码
├── tools/                 # 逆向辅助工具/脚本
└── .memory/               # agent memory (auto-sync)
```

## 记忆管理
使用 `auto-sync-agent-memory` skill 维护 `.memory/` 目录，确保：
- 每次重要发现后同步记忆
- 跨会话时能快速恢复上下文
- 记录已完成的分析步骤和待办事项
