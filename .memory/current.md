# 当前任务

## 状态
**Phase 14 完成: @exa/windsurf-acp 分析 — ACP (Agent Client Protocol) 完整逆向**

## 已完成 (Phase 1-14)
- Phase 1-3: 臃肿分析, 登录协议逆向, API端点文档
- Phase 4: Language Server 实现 (Connect-RPC, 172 RPC, 16 e2e tests)
- Phase 5: Proto 编解码 + API 反代理 (proto-codec.js, 512方法)
- Phase 6: Auth1 认证 + Cascade Chat 端到端验证
- Phase 7: 架构文档 + 三方工作流对比
- Phase 8-9: 深度黑盒逆向 Round 5-7 (128章, ~97%)
- Phase 10: impersonate_tier 注入实现
- Phase 11: Round 8 — Cortex Proto 深度分析 (104 tools, 8 planner, Brain, Hooks)
- Phase 12: Round 9 — Unleash/Feature Flag 系统 (173 ExperimentKeys)
- Phase 13: Go Binary Ghidra 逆向 (pclntab + 反编译 + System Prompt 提取)
- Phase 14: @exa/windsurf-acp 完整分析 (✅ 完成)

## Phase 14 核心成果
- **ACP = Agent Client Protocol** — Cognition AI (Devin) 定义的开放协议
- **SDK**: @agentclientprotocol/sdk@0.20.0, 协议官网 agentclientprotocol.com
- **26 Agent Methods**: initialize, authenticate, session/*, nes/*, document/*, providers/*
- **11 Client Methods**: session/update, fs/*, terminal/*, elicitation/*
- **10 Session Update 事件类型**: message chunks, tool calls, plans, modes, config, usage
- **60+ cognition.ai/ meta keys**: 会话/消息/工具/PR/密钥/用量/Subagent 完整映射
- **Devin Cloud 集成**: `DEVIN_CLOUD_PROVIDER_ID = "devin-cloud"`, WebSocket `wss://app.devin.ai/api/acp/live`
- **传输层**: NDJSON over stdio (本地) + WebSocket (远程)
- **NES** (Next Edit Suggestions): 5个ACP方法 (start/suggest/close/accept/reject)
- **Subagent 递归嵌套**: cognition.ai/subagent_* meta 实现任意深度委托
- **9个 Windsurf ext/method**: revert系统(4), mcp管理(3), elicitation(1), rename(1)
- **Agent Registry**: 4种分发方式 (binary/npx/uvx/websocket), 6平台支持
- **sessions.desktop.main.js** 是主要消费者 (38个 devin-cloud 引用)

## 输出文件
- `docs/deep-interface-analysis.md` — Round 11: 章节 140-150, 共 ~15,300 行

## 下一步选项
1. **反代理功能增强** — 多模型支持 / OpenAI 兼容 API
2. **实验系统利用** — forceEnableExperiments 解锁隐藏功能
3. **MCP 插件系统深入** — 自定义工具注入
4. **ACP 协议利用** — 自定义 Agent 注入 / Devin Cloud 代理
