# 工作日志

### 2025-05-10 06:00 - 项目初始化
- Did: 创建 GitHub 仓库, 初始化项目结构
- Result: 仓库 CatMoxi/Windsurf-reverse, AGENTS.md/README.md/docs/ 就位

### 2025-05-10 06:15 - Phase 2 臃肿分析
- Did: 下载 Windsurf Next v2.2.1017, 统计文件体积分布
- Result: 5大臃肿根因: 原生二进制276MB, Electron税250MB, JS bundle重复60MB+

### 2025-05-10 06:25 - Phase 3 登录协议逆向
- Did: 从 extension.js 提取完整认证流程
- Result: OAuth2 Implicit, client_id=3GUryQ7ldAeKEuD2obYnppsnmj58eP5u, 5个 gRPC services
- Blocker: cdn.windsurf.com SSL 拦截, 无法下载 source maps

### Session 2 - Extension.js + language_server 深度逆向
- Did: 完整 proto 重建 (12898行), language_server.exe Go binary 逆向
- Result: 6 services, 383 methods, 1736 messages, 61 proto files (651KB)

### Session 3 - LS 启动协议 + Connect-RPC 实现
- Did: CLI参数, stdin metadata, 命名管道, 启动回调, Connect-RPC 服务器
- Result: src/language-server/ 全部实现, 172 RPC handler, e2e tests passing

### Session 4 - DevService + 协议修复
- Did: Exit/GetDebugInfo 实现, Connect-RPC 协议修复
- Result: full-flow-test.js 7/7 passing

### Session 5 (2025-05-10 11:00) - Proto编解码 + API反代理
- Did:
  - proto-codec.js: protobufjs 直接编解码 (512方法)
  - connect-server.js 集成 proto-codec (请求解码+响应编码)
  - GetUserStatus → SeatManagement, GetCompletions → ApiServer
  - GetChatMessage: 完整流式 (LS→API格式转换, delta_text累积)
  - camelCase↔snake_case 桥接 (camelToSnake/snakeToCamel)
  - _forwardStream/_forwardUnary 通用转发 + API key 注入
  - inference client (--inference_api_server_url)
  - 请求统计 (stats.total/errors/byMethod)
  - tools: live-api-test.js, cascade-chat-test.js
- Result: 16/16 tests passing, 5 commits pushed

### Session 6 (2025-05-10 ~12:00) - Auth1 认证 + Cascade Chat 实测
- Did:
  - auth1-login.js: 完整4步 Auth1→RegisterUser 流程
  - 19/20 账号批量登录成功, credentials.json + .env 输出
  - auth1-chat-e2e.js: 端到端 Auth1→Chat 流式验证
  - GetPlanStatus 额度查询, API key 池化轮询, 健康检查
  - 发现 Auth1 账号使用 server.self-serve.windsurf.com (非 server.codeium.com)
  - 发现 ideVersion 必须 ≥2.5.0, requestType=5 (CASCADE)
- Result: Cascade Chat 流式调用成功, AI 回复 "Hello from Cascade!"
- Key discovery: Connect-RPC (非 gRPC), 5字节帧头+protobuf

### Session 7 (2025-05-10 ~12:24) - 架构分析文档
- Did:
  - docs/tool-call-architecture.md — Windsurf Tool Call 机制 (70+ 内置工具)
  - docs/prompt-mechanism.md — Prompt 分段组装机制 (31种@引用)
  - 发现 CortexStepType 有 104+ 类型, CascadeToolConfig 40+ 工具配置
  - 发现 Prompt 由 LS 组装(非Extension), 支持 Section Override
- Result: 完整架构文档
- Next: 工作流对比分析 (Codex CLI vs Claude Code vs Windsurf)

### Session 7b (2025-05-10 ~12:53) - 三方工作流对比
- Did: 研究 Codex CLI 开源代码、Claude Code 泄露源码、Windsurf Cascade proto
- Result: docs/workflow-comparison.md 完整对比文档
- Key findings:
  - Codex: 极简(1工具shell, 88行循环), 安全靠OS沙箱
  - Claude Code: 中等(50工具, 88行循环), Messages=State, Sub-agent
  - Windsurf: 最复杂(70+工具, 三层架构), IDE深度集成, Brain自维护记忆
  - 三者循环逻辑相同: send→stream→tool_call→execute→append→loop
  - 差异在harness厚度和IDE集成深度

### Session 8-9 (2026-05-11) - 深度黑盒逆向 Round 5-6
- Did:
  - Round 5: Go LS 启动参数 (35 CLI flags), 环境变量 (46), Unleash Feature Flags (10)
  - Round 5: extension.js proto 全景扫描 — 1,736 types, 18 packages, 369 RPC methods
  - Round 5: extension_server_pb 109 IPC 类型, OpenSearch 知识库 76 类型 (GitHub/Slack/Jira/GDrive)
  - Round 5: cortex.proto 完整覆盖 — 91 CortexStep types, Brain 系统, Hook 系统, Memory 5 种 Scope
  - Round 6: product.json 完整逆向 — Zendesk API Key, Trust domains, 文件校验 checksums
  - Round 6: Electron main.js 逆向 — 5 Main Process 服务, 12 自定义图标, 214 URLs
  - Round 6: Native/WASM 模块清单 — 19 .node + 11 .wasm
  - Round 6: 黑盒评估 — 静态分析完成度 ~95%
- Result: docs/deep-interface-analysis.md 扩展到 120 章节, ~11,457 行
- Key discoveries:
  - Unleash 生产 API Key 硬编码: *:production.a902e0c1...
  - Zendesk API Key 硬编码: 1d83db00...
  - staging.itsdev.in — Devin 内部 staging 域名
  - 企业知识库: GitHub/Slack/Jira/Google Drive 4 源 + HybridSearch/GraphSearch
  - CortexStepRunExtensionCode — 可执行任意扩展代码
  - CortexStepProxyWebServer — 内建 Web 代理
  - windsurfpyright — Windsurf Python 类型检查器 fork
- Remaining: ~5% 为编译二进制 (Go LS, .node, .wasm), 需 IDA/Ghidra

### Session 10 (2026-05-11) - 深度黑盒逆向 Round 7
- Did:
  - impersonate_tier 机制完整逆向 (配置→proto→API)
  - API Server 区域分布 (Default/EU/FedStart/Staging/Register)
  - sessions.desktop.main.js (30MB) 深度分析
  - ACP (Agent Compute Platform) / Devin Cloud 集成发现 (38+ state keys, 30+ API methods)
  - Worktree 系统 (12+ proto messages)
  - windsurf.* 命令完整枚举 (231个)
  - Go LS binary 字符串分析 (175 Exafunction packages, 53 Go modules, 14+ URLs)
  - VS Code 贡献模块发现 (37个 Windsurf-specific contributions)
  - NLS keys 分析 (244 Windsurf-related keys)
- Result: docs/deep-interface-analysis.md 扩展到 128 章节, ~12,215 行
- Key discoveries:
  - cascadeplayground.watchdevinwork.com — Devin 内部 Cascade Playground
  - TEAMS_TIER_DEVIN_PRO 确认存在于 Go binary
  - windsurf_pro_trial_end_time — Pro 试用结束时间字段
  - ACP = Agent Compute Platform (Devin Cloud 深度集成)
  - AgentWindow 独立窗口模式 (非标准编辑器)
  - cascade.readClaudeCodeConfig — 竞品兼容功能
  - 3 API Provider: Anthropic/Fireworks/OpenAI (Devin 专用)
  - southcentral-lb.codeium.com — 区域负载均衡
  - unleash.codeium.com/api/experiment — Feature Flag 服务
- 静态分析完成度: ~97% (仅剩 WASM/native 内部逻辑)

### 2026-05-11 07:00 - Phase 10: impersonate_tier 注入实现
- Did: 在 language-server-service.js 实现 _injectMetadata() 中心化注入
- Result: 5个调用点全部注入, 默认 TEAMS_TIER_DEVIN_PRO, CLI/ENV 可配置
- Conclusion: 反代理现在每个请求自动注入 Pro tier

### 2026-05-11 07:30 - Phase 11: Round 8 — Cortex Proto 深度分析
- Did: 完整分析 cortex.proto (3071行), codeium_common.proto, api_server.proto, language_server.proto
- Result: 
  - 104 CortexStepType 工具完整映射
  - 8 Planner 类型, 40 工具配置
  - Brain/Memory/Hook 系统完整映射 (13 Hook 触发点)
  - Rate limit 绕过: Metadata.impersonate_tier (field 29)
  - System prompt 构建确认在 Go LS 内部 (GetSystemPromptAndTools RPC)
- docs/deep-interface-analysis.md: 章节 129-139 (Round 8)

### 2026-05-11 08:30 - Phase 12: Round 9 — Unleash Feature Flag 系统
- Did: 完整逆向 Unleash 系统 (sessions.desktop.main.js + extension.js + protos)
- Result:
  - 3套 Unleash 客户端 (Extension/Chat Panel/Sessions Host)
  - 4个 API Key (2 production + 2 staging)
  - Unleash URL: https://unleash.codeium.com/api/ (Extension) | /api/frontend/ (Chat)
  - 173个 ExperimentKey (proto enum), 21个 Unleash Flag (远程)
  - 双层实验系统: Layer1=Unleash远程 + Layer2=Proto ExperimentConfig
  - 优先级链: forceEnable > Unleash Remote > Enterprise > Default
  - CascadeConfig 构造: Conversational planner, Vibe-and-Replace 硬编码 Claude 4 Sonnet
  - VS Code 覆盖: codeiumDev.forceEnableExperiments (逗号分隔)
- docs/deep-interface-analysis.md: 章节 140-150 (Round 9), 总计 ~13,575 行
- **静态分析完成度: ~99%**
- 剩余 ~1%: Go LS binary, 11 WASM, 19 .node (需 IDA/Ghidra)

### 2026-05-11 ~13:00-20:00 - Phase 13: Go Binary Ghidra 深度逆向
- Did:
  - PowerShell 解析 Go pclntab (raw offset 0x3D002E0, magic 0xFFFFFFF1)
  - 恢复 116,443 个函数符号, 导出 63,001 个 Exafunction 符号
  - 编写 Ghidra headless 反编译脚本 (ghidra-decompile-targets.py)
  - 成功反编译 13/18 个关键函数 (GetSystemPromptAndTools, PromptBuilder.Build, etc.)
  - 从 binary 直接提取 40+ System Prompt 片段
  - 解码 DefaultCascadeConfigForCumulativePrompt 的 IEEE 754 float32 token budget
  - 提取完整工具描述 (edit, run_command, write_file, grep, find, etc.)
- Result:
  - docs/go-binary-analysis.md: 490行完整分析文档 (11个章节)
  - Token Budget: Default(sys=25%,ctx=65%,tool=10%), Research(sys=33%,ctx=60%,tool=7%), Agent_v2(sys=25%,ctx=50%,tool=25%)
  - 核心身份: "You are Cascade, a powerful agentic AI coding assistant."
  - 新模型发现: gemini-3.0-pro, gemini-3.1-pro, GPT-5.1, claude-opus-4-7-xhigh, o4-mini-2025
  - 安全规则: "You must NEVER NEVER run a command automatically if it could be unsafe"
  - Go 包结构: cortex/ (核心引擎), managers/ (Planner/Executor), prompt/ (构建器), nodes/ (执行图)
- Key discoveries:
  - 3种 planner 类型不同 token 分配比例
  - System prompt 由 XML section tags 结构化
  - 模式切换: "switch to implementation mode" tool
  - 12个 XML section tags 完整映射
- **客户端分析完成度: ~99.5%**

### 2026-05-11 20:26 - Phase 14: 剩余黑盒盘点
- Did: 系统性盘点所有剩余未分析组件
- Result:
  - @exa/windsurf-acp (710KB): 完全未知，高优先级 ⚠️
  - @exa/chat-client (14MB): React webview UI，低优先级
  - 20+ .node: 标准 VS Code 绑定，非 Windsurf 特有
  - 8 tree-sitter .wasm: 标准语法解析器
  - 服务器端: 不可分析

### 2026-05-11 20:42 - Phase 14: @exa/windsurf-acp 完整逆向 ✅
- Did: 静态分析 index.js (20,557行), 提取 ACP 协议全貌
- Result:
  - **ACP = Agent Client Protocol** by Cognition AI (Devin)
  - SDK: @agentclientprotocol/sdk@0.20.0, 官网 agentclientprotocol.com
  - 26 Agent Methods (Client→Agent): initialize, session/*, nes/*, document/*, providers/*
  - 11 Client Methods (Agent→Client): session/update, fs/*, terminal/*, elicitation/*
  - 10 Session Update 事件: message chunks, tool_call, plan, mode, config, usage
  - 60+ cognition.ai/ meta keys: 完整分类 (会话/消息/工具/PR/密钥/用量/Subagent)
  - Devin Cloud: DEVIN_CLOUD_PROVIDER_ID="devin-cloud", wss://app.devin.ai/api/acp/live
  - 传输: NDJSON/stdio (本地) + WebSocket (远程)
  - NES: 5个方法 (start/suggest/close/accept/reject)
  - Subagent 递归嵌套: cognition.ai/subagent_started/completed/context
  - 9个 ext/method: revert(4), mcp(3), elicitation(1), rename(1)
  - Registry: 4分发方式 (binary/npx/uvx/websocket), 6平台
  - sessions.desktop.main.js 是主要消费者 (38个 devin-cloud 引用)
- Output: docs/deep-interface-analysis.md 章节 140-150 (~15,300行)
- **@exa/windsurf-acp 黑盒消除，剩余黑盒 ~0.3%**
