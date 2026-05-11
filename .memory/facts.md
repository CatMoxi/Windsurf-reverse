# 已验证事实

## Windsurf Next 下载信息
- **版本**: v2.2.1017+next (windsurfVersion)
- **产品版本**: 1.110.1
- **Commit**: `a65d6c4e1fd335336d7a0b601099811667e184ca`
- **下载 URL**: `https://windsurf-stable.codeiumdata.com/win32-x64-archive/next/a65d6c4e1fd335336d7a0b601099811667e184ca/Windsurf-win32-x64-2.2.1017+next.a65d6c4e1f.zip`
- **SHA256**: `197da6e136fc5d96301af33db1322b7f5db45f5ca6436cc4991a6ab5345e37a0`

## 已知结构
- `resources/app/extensions/windsurf/dist/extension.js` (~9.6MB) — 核心扩展
- `resources/app/extensions/windsurf/bin/language_server_windows_x64.exe` (~170MB) — Go LS
- 协议栈: Protobuf + Connect-RPC (HTTP/1.1), NOT gRPC
- Proto: 6 services, 512 methods, 3071+ messages

## Auth1 认证 (已验证 2025-05-10)
- **PostAuth**: POST windsurf.com/api/auth/auth1 (header: X-Devin-Auth1-Token)
- **GetCurrentUser**: GET windsurf.com/api/user (header: Authorization: Bearer session_token)
- **GetOneTimeAuthToken**: POST register.windsurf.com (Connect-RPC, devin headers)
- **RegisterUser**: POST register.windsurf.com (Connect-RPC, ott → api_key)
- API server (Auth1): `server.self-serve.windsurf.com`
- API server (标准): `server.codeium.com`
- API key 格式: `devin-session-token$<JWT>`
- 19/20 账号验证成功

## Cascade Chat 协议 (已验证)
- 协议: Connect-RPC, Content-Type: application/connect+proto
- 帧格式: 5字节头 (flags=0 + uint32BE length) + protobuf payload
- 必需字段: cascadeId, promptId, sessionId, requestType=5, ideVersion≥2.5.0
- 默认模型: gpt-5-5-low, 115个模型可用
- 流式响应: delta_text + delta_tool_calls

## API Probe 测试结果 (2025-05-10 13:30 验证)
- ✅ JWT 有效 (至少数小时, 待确认精确过期时间)
- ✅ 外部 tools[] 被接受并被 LLM 调用 — 可做 function calling 反代理
- ✅ tools=[] 空数组有效禁用内置工具
- ✅ tool_choice="none" 有效强制纯文本
- ✅ System Prompt 注入已解决:
  - 方法B: prompt字段(field 2) ✅ 生效
  - 方法C: source=SYSTEM(2) ✅ 生效  
  - 方法A: source=SYSTEM_PROMPT(5) ❌ 被服务端覆盖
  - requestType=CHAT ❌ failed_precondition
- ✅ requestType=1(CHAT) 和 5(CASCADE) 均返回 200
- ✅ 5 连续请求无 rate limit (~1.3s/请求)
- 工具调用流式: name 和 arguments 分帧增量到达, 需拼接
  - Frame 1: {id, name, args=""} → Frame 2+: {id="", name="", args=chunk}
- ✅ 自定义工具完整冒烟测试通过 (7/7): read_file, run_command, write_file, search_code
- ✅ Tool result 回传有效 (模型能读取工具返回结果)
- ✅ 模型智能选择工具 vs 纯文本回答
- ❌ configuration (temperature/max_tokens/stop) 传入导致 invalid_argument 被服务端拒绝
- ✅ 并发 3 请求安全 (1.9s 并行, 响应正确)
- ✅ System prompt 完全可覆盖:
  - prompt field 可剥离 Windsurf 原生 "Codeium" 身份
  - 可替换为 Claude Code/任意自定义 prompt
  - 模型在功能任务中无 Codeium/Windsurf 泄露

## 综合测试结果 (2026-05-10)

### #1 API Key 有效期
- JWT 结构: `devin-session-token$<HS256 JWT>`
- JWT payload 仅含 `session_id`，无 `exp`/`iat` 字段
- 有效期由服务端控制，非 JWT 自身过期
- 无效 key 错误: `unauthenticated` / `failed to validate Devin token`
- 需要定期测试有效性，无法从 JWT 本身判断是否过期

### #2 GetChatCompletions / GetStreamingExternalChatCompletions
- GetChatCompletions: HTTP 415 (不支持 Connect-RPC stream content-type)
- GetStreamingExternalChatCompletions: HTTP 200 但返回 invalid_argument
- 这两个端点需要旧式 Model enum + CompletionsRequest 结构
- **结论: 反代理应只使用 GetChatMessage 端点**

### #3 图片/多模态
- ChatMessagePrompt.images (field 10) → ImageData {base64Data, mimeType, caption}
- ✅ 图片输入正常工作！之前 invalid_argument 是因为 base64 PNG 数据损坏
- gpt-5-5-low, gpt-5-4-low, gpt-4o 均能正确识别图片
- **反代理可支持 Vision API (base64 image)**

### #4 Embeddings
- GetEmbeddings 方法未在 proto-codec 中注册
- **反代理暂不支持 embeddings**

### #5 模型切换
- ✅ Trial 账号可使用所有模型（之前 permission_denied 是 UID 写错）
- 正确 UID 示例:
  - GPT: gpt-5-5-low, gpt-5-4-low, MODEL_CHAT_O3
  - Claude: claude-sonnet-4-6, claude-sonnet-4-6-thinking, claude-opus-4-6
  - Gemini: MODEL_GOOGLE_GEMINI_2_5_PRO, gemini-3-1-pro-low
  - 其他: kimi-k2-5, deepseek-v4
- Provider 分布: OpenAI, Anthropic, Anthropic Bedrock, Google Vertex, Fireworks

### #6 非流式响应
- GetChatMessage 是 streaming RPC，不支持 unary 调用 (HTTP 415)
- **反代理必须处理流式响应，非流式需要缓冲全部 chunk 后返回**

### #7 账号额度
- Trial 账号总额: 10,000 credits
- CheckUserMessageRateLimit 的 maxMessages 是静态客户端提示值，非真实限额
  - 发送 15 条后 messagesRemaining 仍为 30，从未减少
  - maxMessages=30 (GPT系列) / -1 (Claude/Gemini/O3) / 5 (Gemini 3.1 Pro)
  - 不影响 API 调用，反代理可忽略
- 模型 credit 成本: gpt-5-4-none=1.5, gpt-5-5-low=8, claude-opus-4-7-medium=40
- 有效消息数 = 10000 ÷ credit_per_msg

### #8 错误码
- 空 model: 正常返回 (服务端选默认)
- 未知 model: `permission_denied`
- 空 prompt: 正常返回
- 10k char prompt: 正常返回

### #9 长对话
- 51 条消息 (60KB request) → 正常返回, 10899 input tokens
- 无截断，模型正确计数 "50 messages"

## 高级端点测试 (2026-05-10)

### GetStreamingModelAPITextCompletion
- ❌ permission_denied (无参数) / invalid_argument (有参数)
- 该端点对外部调用不可用，仅限 LS 内部
- **temperature/max_tokens 确认无任何远端 API 可控制**

### GetEmbeddings
- ❌ invalid_argument — 请求格式复杂或仅限 LS
- 反代理暂不支持 /v1/embeddings

### GetCompletions (autocomplete)
- ❌ invalid_argument — 需要完整 editor_state/document 结构
- 代码补全端点不可远程调用

### delta_thinking (Claude thinking mode)
- ✅ 完美工作！claude-sonnet-4-6-thinking 输出 thinking + text
- deltaThinking = 内部推理 (52ch), deltaText = 最终回答 (150ch)
- 可映射到 OpenAI reasoning_content 字段
- stop_reason = STOP_REASON_MIN_LOG_PROB

### GetDeepWiki
- ❌ unknown error — 需要完整代码库索引 (symbol_uri)

### Credit 追踪
- credit_cost 字段在响应中始终为 0 (服务端不填充)
- 真实消耗需要 usage tokens × 模型单价 手动计算

## 剩余端点测试 (2026-05-10)

### GetDevstralStream
- ✅ 正常工作！返回单帧 output 字符串
- 响应格式: {output: string, toolCalls: []}
- 不支持工具调用（传入 tools_json 但不会调用）
- 支持多轮对话（chatMessagePrompts）
- 模型: Devstral (Mistral 系列)
- 输出带 </s> 结束符
- **可作为轻量级替代端点（无工具/无图片）**

### GetUserStatus (完整账号信息)
- ✅ 服务器: server.self-serve.windsurf.com (NOT register.windsurf.com)
- userStatus:
  - name, email, teamId, teamStatus, teamsTier
  - ignoreChatTelemetrySetting: true
  - isDevin: true (Trial 账号标记)
  - billingStrategy: BILLING_STRATEGY_QUOTA
- planInfo (重要!):
  - teamsTier: TEAMS_TIER_DEVIN_TRIAL
  - planName: "Trial"
  - **monthlyPromptCredits: 10000** (确认!)
  - **monthlyFlowCredits: 20000**
  - maxNumChatInputTokens: 16384
  - maxCustomChatInstructionCharacters: 600
  - maxNumPinnedContextItems: -1 (无限)
  - maxLocalIndexSize: -1 (无限)
  - cascadeWebSearchEnabled: true
  - cascadeCanAutoRunCommands: true
  - hasTabToJump: true
  - browserEnabled: true
  - hasPaidFeatures: true
  - knowledgeBaseEnabled: true
  - cascadeAllowedModelsConfig: 完整 model+credit 列表
- defaultTeamConfig:
  - allowMcpServers: true
  - allowAutoRunCommands: true
  - maxUnclaimedSites: 1
  - maxNewSitesPerDay: 5
  - allowArenaMode: true
  - maxCascadeAutoExecutionLevel: EAGER

### 模型配置端点对比
- GetCascadeModelConfigs: 115 模型 (主聊天)
- GetCliModelConfigs: 66 模型 (CLI 专用)
- GetCommandModelConfigs: 8 模型 (命令专用)

### CascadePlugins (MCP)
- ✅ GetAvailableCascadePlugins 返回完整插件列表
- 包含: sequential-thinking, github, postgres, supabase, exa, etc.
- 可用于反代理的 MCP 服务器发现

### GetEmbeddings ✅ 已破解!
- 请求格式: {request: {prompts: string[]}, embeddingModel: int}
- **OpenAI Ada (91)**: 1536 维
- **OpenAI 3-Small (163)**: 1536 维
- **OpenAI 3-Large (164)**: 3072 维
- **默认 (0)**: 1024 维
- TogetherAI/HuggingFace: 404 不可用
- 批量: 10 prompts 一次调用正常
- 两个服务器都可用 (self-serve + codeium.com)

### GetTranscription ✅ 已破解!
- 请求: {metadata, audioData: bytes (WAV format)}
- 返回: {transcribedText: string}
- 两个服务器都可用
- 需要真实 PCM 16-bit mono 16kHz WAV

### GetTeamOrganizationalControls ✅
- 返回团队模型限制和功能开关
- extensionModelLabels: ["Base Model ⚡️", "Claude 3.7 Sonnet"]

### GetModelStatuses
- API server: ✅ HTTP 200 空响应
- LS service: 404

## 暴力测试结论 (2026-05-10)

### 完全不可用端点 (两服务器 × 两协议全试)
- **GetCompletions**: invalid_argument — LS 本地构建 FIM prompt 后才转发
- **GetStreamingCompletions**: invalid_argument — 同上
- **GetTab**: invalid_argument — 需要 LS 本地 UnifiedPromptComponents
- **GetChatCompletions**: invalid_argument — 需要特定字段组合
- **GetStreamingExternalChatCompletions**: invalid_argument
- **GetStreamingModelAPITextCompletion**: permission_denied (两个服务器)
- **AssignModel**: invalid_argument (需要活跃 cascade 上下文)
- **AssignArenaModel**: invalid_argument
- **GetDeepWiki**: unknown (需要代码库索引 symbolUri)
- **ProvideFeedback**: invalid_argument

### LanguageServerService 端点 — 仅限本地
- HandleStreamingCommand: unimplemented on codeium.com, 404 on self-serve
- HandleStreamingTab/V2: 同上
- RawGetChatMessage: 404
- GetMessageTokenCount: proto-codec 未注册
- GenerateCommitMessage: 404 on self-serve, unauthenticated on codeium

### 其他
- GetStatus: ✅ 空响应 {status:{}}
- GetDefaultWorkflowTemplates: ✅ 空响应 {}
- SeatManagement on register.windsurf.com: 404 (所有端点)
- SeatManagement on api server: ✅ GetUserStatus 正常

## 第二轮深度测试 (2026-05-10 Round 2)

### GetWebSearchResults ✅ 已破解!
- 请求: {metadata, query: string}
- 返回: {results: [{documentId, url, title, summary}], webSearchUrl}
- 底层 API: `api.ydc-index.io` (You.com Data API)
- 每次返回 5 条结果
- 支持中文查询
- **可做 web search 反代理!**

### GetWebDocsOptions ✅
- 返回 149 个文档库选项
- 格式: [{label, docsUrl, docsSearchDomain}]
- docsUrl 都是 llms.txt / llms-full.txt 格式
- 知名库: cloudflare, bun, duckdb, upstash, raycast, zapier, sourcegraph 等
- **这是 Windsurf @docs 功能的数据源**

### GetLifeguardConfig ✅
- 返回 AI 安全检测配置
- modes.agent: {enabled:true, model:"MODEL_COGNITION_LIFEGUARD", agentVersion:"v2"}
- Lifeguard = Windsurf 的 AI 行为安全审查模型

### GenerateSyntheticRule ✅
- 请求: {metadata, commentBody, fileContent, lineNumber}
- 返回: {rule: {prompt: string}}
- AI 从代码注释自动生成规则/约束
- 用于 "Add as Rule" 功能

### GetWindsurfJSAvailableDeployTargets ✅
- 返回: {deployTargets: [{deploymentProvider:"NETLIFY", isSandbox:true, providerTeamSlug:"windsurf", domain:"windsurf.build"}]}
- Windsurf 内置部署 = Netlify sandbox on windsurf.build

### CLI 模型列表详情 (66个)
- claude-opus-4-7-medium: 40 credits, 1M tokens, img+tools+think
- claude-opus-4-7-low: 20 credits
- claude-opus-4-7-high: 60 credits
- gpt-5-5-low: 8 credits, 272K tokens
- deepseek-v4: 3 credits, 1M tokens
- kimi-k2-6: credits=undefined, 262K tokens
- swe-1-6/swe-1-6-fast: 0.5 credits

### Command 模型列表 (8个)
- Claude 4.5 Opus, SWE-1.5, Windsurf Fast, GPT-4.1
- Claude 4 Sonnet, Claude 4.5 Sonnet, GPT 5.1, Claude Haiku 4.5

### 其他测试结果
- GetCascadeModelConfigsForSite: 401 (需要 site auth)
- GetTeamOrganizationalControlsForSite: 401 (需要 site auth)  
- RunCodeAlignment: 200 空 (需要具体规则)
- GenerateVibeAndReplaceStreaming: 空 (需要更完整请求)
- CheckBugs: 403 permission_denied (存在但被限制)
- GetSharedCodeMap: 400 invalid_argument (需要 codeMapId)
- QueryImageForPixel: 400 invalid_argument (需要图片)
- GetMQuery: 500 unknown (内部错误)

## LS 功能复刻可行性矩阵

### 可远程调用 (反代理可实现) — 19+
| 端点 | 功能 | 难度 |
|------|------|------|
| GetChatMessage | 流式聊天+工具+图片+thinking | 已实现 |
| GetDevstralStream | Devstral 轻量聊天 | 简单 |
| GetEmbeddings | 向量嵌入 (3种模型) | 简单 |
| GetTranscription | 语音转文字 | 简单 |
| **GetWebSearchResults** | **Web 搜索 (You.com)** | **简单** |
| **GetWebDocsOptions** | **149个文档库列表** | **简单** |
| **GenerateSyntheticRule** | **AI 生成规则** | **简单** |
| **GetLifeguardConfig** | **AI 安全配置** | **简单** |
| GetCascadeModelConfigs | 115 模型列表 | 已实现 |
| GetCliModelConfigs | 66 CLI 模型 | 简单 |
| GetCommandModelConfigs | 8 命令模型 | 简单 |
| GetUserStatus | 账号+额度+planInfo | 已实现 |
| CheckUserMessageRateLimit | 限速信息 | 已实现 |
| CheckChatCapacity | 容量检查 | 简单 |
| GetTeamOrganizationalControls | 团队控制 | 简单 |
| GetAvailableCascadePlugins | MCP 插件 | 简单 |
| **GetWindsurfJSAvailableDeployTargets** | **部署目标** | **简单** |
| GetDefaultWorkflowTemplates | 工作流模板 | 简单 |
| GetModelStatuses | 模型状态 | 简单 |
| **GetModelProviders** | **8 AI 提供商列表** | **简单** |
| **Ping** | **健康检查** | **简单** |
| **SupportsRemoteIndexing** | **远程索引支持** | **简单** |

### 需要 LS 本地逻辑 (需要在反代理中重新实现)
| 功能 | 原 LS 逻辑 | 反代理方案 |
|------|-----------|-----------|
| 代码补全 | Document→FIM prompt→GetCompletions | 需实现 FIM 构建器 |
| Tab 补全 | Document→GetTab/GetStreamingCompletions | 需实现 prompt 构建器 |
| Command | Document+intent→HandleStreamingCommand | 用 GetChatMessage 替代 |
| 终端命令 | HandleStreamingTerminalCommand | 用 GetChatMessage 替代 |
| Commit 消息 | GenerateCommitMessage (local) | 用 GetChatMessage 替代 |

### 不可复刻 (仅限 IDE 环境)
| 功能 | 原因 |
|------|------|
| ExtensionServer 回调 | 需要 IDE 进程 (文件操作/终端/diff) |
| 代码索引 (Brain) | 需要本地代码库 |
| DeepWiki | 需要代码库索引 |
| MCP Server 运行 | 需要本地进程管理 |
| 代码验证/Linting | 需要 IDE 上下文 |

## 第三轮 API 测试 (Round 3)

### GetModelProviders ✅ 新发现!
- 无需认证，空请求即可
- 返回 8 个 AI 提供商:
  - MODEL_PROVIDER_OPENAI → "OpenAI"
  - MODEL_PROVIDER_ANTHROPIC → "Anthropic"
  - MODEL_PROVIDER_GOOGLE → "Google"
  - MODEL_PROVIDER_XAI → "xAI"
  - MODEL_PROVIDER_DEEPSEEK → "DeepSeek"
  - MODEL_PROVIDER_MOONSHOT → "Moonshot"
  - MODEL_PROVIDER_QWEN → "Qwen"
  - MODEL_PROVIDER_WINDSURF → "Windsurf"

### Ping ✅
- 返回 200 空响应（0ms latency）
- 可用作健康检查

### SupportsRemoteIndexing ✅
- 返回 {supportsRemoteIndexing: true}
- 表示账号支持远程代码索引

### 其他测试
- ReadUrlContent: 404 (仅 LS 本地)
- GetDeepWiki: 200 streaming + 空 trailer（需真实 repo index）
- GetExternalModel: 501 未实现
- VibeAndReplace: 404 (仅 LS 本地)
- GetWebSearchRedirect: 200 空（需要 You.com 原始 URL）
- GetDecagonAuthToken: 401（需要特殊认证，可能是 Decagon 客服集成）
- GetTeamOidcProviders: 501 未实现
- FetchTrajectoryShare: 401 需要 auth token（非 API key）
- ListUserSharedCodeMaps: 401 需要 auth token
- GetExternalModels: 404 不存在
- AssignArenaModel: 400（需要 arena_id + cascade_ids + 正规流程）
- GetMcpRegistryServers: 404 不存在
- ApplyTrajectoryHeuristics: 400 invalid_argument

## System Prompt 逆向 (2026-05-10)

### 核心发现
- **身份声明**: "You are Cascade, a powerful agentic AI coding assistant."
- 完全在 LS 本地 (Go binary) 构建，不从 API server 获取
- Prompt 模板在 Go 源码: `exa/language_server/mquery/prompt/prompt_templates.go`

### Prompt 结构 (XML sections)
```xml
<tool_calling>...</tool_calling>
<making_code_changes>...</making_code_changes>
<running_commands>...</running_commands>
<debugging>...</debugging>
<task_management>...</task_management>
<calling_external_apis>...</calling_external_apis>
<user_rules>...</user_rules>
<user_information>...</user_information>
<ide_metadata>...</ide_metadata>
<memory_system>...</memory_system>
<workflows>...</workflows>
<communication_style>
  <markdown_formatting>...</markdown_formatting>
  <citation_guidelines>...</citation_guidelines>
</communication_style>
<parallel_tool_calls>...</parallel_tool_calls>
```

### 已识别模式 (6种)
1. **Agent Mode** (默认) — 完整工具+代码编辑
2. **Ask Mode** — 只分析不修改
3. **Bug Detection** — 预提交 bug 检测
4. **Advisory Mode** (Smart Friend) — 纯建议模式
5. **Summary Mode** (DEVIN'S ASSISTANT) — 上下文压缩
6. **History Generation Mode** — 交互历史生成

### 工具调用格式 (3种)
1. JSON `<tool_call>{"name":"...", "arguments":{...}}</tool_call>`
2. XML `<function=tool_name><parameter=key>value</parameter></function>`
3. restricted_exec `[TOOL_CALLS]restricted_exec[ARGS]{...}`

### 安全系统
- EXTREME SUSPICION: 连续失败后的自我检查机制
- Lifeguard: AI 安全审查层 (MODEL_COGNITION_LIFEGUARD)
- Lint Feedback: IDE 反馈注入

### Codemap 系统
- 交互式代码导航 artifact
- Traces 回答 "what happens when" 问题
- 建议在 Q&A 后，不在 ACT 后
- 每小时有限额

## 深度黑盒逆向统计 (Round 5-6, 2026-05-11)

### Proto 全景 (extension.js)
- 总计 1,736 proto types, 18 packages, 369 RPC methods
- 最大包: language_server_pb(389), cortex_pb(316), codeium_common_pb(231), seat_management_pb(398)
- extension_server_pb: 109 IPC types (Extension↔LS 通信)
- opensearch_clients_pb: 76 types (知识库系统)
- 91 CortexStep types (cortex.proto 完整覆盖)

### product.json 关键信息
- windsurfVersion: 2.2.1017+next.a65d6c4e1f
- codeiumVersion: 1.48.2
- quality: next
- updateUrl: https://windsurf-next.codeium.com
- Marketplace: https://marketplace.windsurf.com/vscode/gallery
- darwinBundleIdentifier: com.exafunction.windsurfNext

### 硬编码 API Keys
- Zendesk: 1d83db0009861157cacd3279a927855f53279e48c84bd26d2ba48d241699773d
- Unleash: *:production.a902e0c159994fded827db0c074d3040b534458b13a8398d745df7d2
- Sentry workbench: 564eba05...@o4507463137361920/4507737596690432
- Sentry extension: 8265dd07...@o4507463137361920/4508180955267072

### Trust Domains
- *.codeium.com, *.windsurf.com, windsurf.com
- codeium-staging-exafunction.vercel.app
- staging.itsdev.in (Devin internal staging!)
- app.devin.ai, app.beta.devin.ai
- *.devinenterprise.com, beta.devinenterprise.com

### Go LS 启动参数 (35 flags)
- --api_server_url, --run_child, --enable_lsp, --stdin_initial_metadata
- --server_port, --lsp_port, --random_port, --database_dir
- --workspace_id, --sentry_environment, --prerelease_mode

### LS 环境变量 (46)
- WINDSURF_CSRF_TOKEN, CODEIUM_LANGUAGE_SERVER_BIN
- GORACE=halt_on_error=1 (Insiders)
- WINDSURF_IDE_TYPE, CODEIUM_EDITOR_APP_ROOT

### Feature Flags (Unleash, 10个)
- chat-panel-message, concurrent-cascade, windsurf-js, etc.

### Native Modules (19 .node)
- @vscode/: deviceid, sqlite3, spdlog, windows-ca-certs, windows-registry, etc.
- kerberos, msal-node-runtime, node-pty, native-keymap

### WASM Modules (11)
- tree-sitter (7种语言), onig.wasm, chromehash_bg.wasm

### Knowledge Base 系统
- 4 数据源: GitHub, Slack, Jira, Google Drive
- 搜索: HybridSearch, GraphSearch, KnowledgeBaseSearch
- 76 proto types (opensearch_clients_pb)

## GitHub
- 账号: CatMoxi
- 仓库: https://github.com/CatMoxi/Windsurf-reverse
