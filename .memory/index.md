# Windsurf-Reverse 项目记忆索引

## 项目目标
逆向 Windsurf Next IDE，分析臃肿原因，提取登录协议，实现 API 反代理。

## 当前阶段
**Phase 14: @exa/windsurf-acp 分析完成 (ACP = Agent Client Protocol)**

## 已完成
- [x] Phase 1: 项目基建 (GitHub仓库, AGENTS.md, memory)
- [x] Phase 2: 臃肿分析 → docs/bloat-analysis.md
- [x] Phase 3: 登录协议逆向 → docs/auth-protocol.md, docs/api-endpoints.md
- [x] Phase 4: Language Server 实现 (Connect-RPC, 172 RPC, 16 e2e tests)
- [x] Phase 5: Proto 编解码 + API 反代理 (proto-codec.js, 512方法)
- [x] Phase 6: Auth1 认证 + Cascade Chat 实测 (19/20 账号)
- [x] Phase 7: 架构文档 + 三方工作流对比
- [x] Phase 8: 深度黑盒逆向 Round 5-6 (120章, ~95%)
- [x] Phase 9: 深度黑盒逆向 Round 7
  - impersonate_tier 机制逆向 (codeiumDev.impersonateTier → proto field 29)
  - ACP/Devin Cloud 集成 (38+ state keys, 30+ API methods)
  - sessions.desktop.main.js (30MB, 231 commands)
  - Go LS binary 字符串分析 (175 packages, 53 modules, 14+ URLs)
  - VS Code 贡献模块 (37个 Windsurf-specific)
- [x] Phase 10: impersonate_tier 注入实现
  - `_injectMetadata()` 中心化注入 (5个调用点)
  - 默认 TEAMS_TIER_DEVIN_PRO, CLI/ENV 可配置
- [x] Phase 11: 深度逆向 Round 8 — Cortex Proto 深度分析
  - 104 CortexStepType 工具, 8 Planner, 40 ToolConfig
  - Brain/Memory/Hook 系统完整映射
  - Rate limit / quota 绕过机制 (Metadata.impersonate_tier field 29)
  - System prompt 构建 → 确认在 Go LS 内部 (GetSystemPromptAndTools RPC)
- [x] Phase 12: 深度逆向 Round 9 — Unleash / Feature Flag 系统
  - 3套 Unleash 客户端 (Extension/Chat/Sessions)
  - 4个 API Key (2 prod + 2 staging)
  - 173个 ExperimentKey, 21个 Unleash Flag
  - 双层实验系统 + 优先级覆盖链
  - docs/deep-interface-analysis.md: **150 章节, ~13,575 行**
  - **静态分析完成度: ~99%**
- [x] Phase 13: Go Binary Ghidra 逆向 (pclntab 符号恢复 + 反编译)
  - Go pclntab 解析: 116,443 函数符号恢复, 63,001 Exafunction 符号
  - Ghidra headless 反编译: 13 关键函数 C 伪代码
  - System Prompt 完整提取: 40+ 片段从 binary 直接提取
  - Token budget 配置: 3 种 planner 的 IEEE 754 浮点比例解码
  - 工具描述 (Tool descriptions) 完整提取
  - docs/go-binary-analysis.md: 490 行完整文档
- [x] Phase 14: @exa/windsurf-acp 完整分析 (ACP 协议逆向)
  - ACP = Agent Client Protocol (Cognition AI/Devin 定义的开放协议)
  - SDK: @agentclientprotocol/sdk@0.20.0 + zod@3.25.76
  - 26 Agent Methods + 11 Client Methods + 10 Session Update 事件
  - 60+ cognition.ai/ meta keys 完整映射
  - Devin Cloud 集成: wss://app.devin.ai/api/acp/live
  - NES (Next Edit Suggestions) 通过 ACP 实现
  - Subagent 递归嵌套支持
  - docs/deep-interface-analysis.md: **150 章节, ~15,300 行**
- [ ] Phase 15 (待定): 剩余黑盒
  - @exa/chat-client (14MB, webview UI, 低优先级)

## 剩余黑盒 (~0.3%)
1. ~~**@exa/windsurf-acp** (710KB)~~ — ✅ 已完成 (ACP 协议, Devin Cloud 集成)
2. **@exa/chat-client** (14MB) — React Chat Panel webview (UI渲染, 低优先级)
3. **Go LS 复杂函数内部** — 已有符号但反编译难读 (CodeMap/Lifeguard/VirtualFS 细节)
4. **服务器端** — server.codeium.com, inference.codeium.com 等 (不可分析)

## 下一步选项
1. **反代理功能增强** — 多模型支持 / OpenAI 兼容 API
2. **实验系统利用** — 通过 forceEnableExperiments 解锁隐藏功能
3. **MCP 插件系统深入** — 自定义工具注入
4. **ACP 协议利用** — 自定义 Agent 注入 / Devin Cloud 代理

## 关键文件
- [current.md](./current.md) — 当前任务详情
- [facts.md](./facts.md) — 已验证事实
- [decisions.md](./decisions.md) — 决策记录
- [worklog.md](./worklog.md) — 工作日志
- [handoff.md](./handoff.md) — 交接摘要
