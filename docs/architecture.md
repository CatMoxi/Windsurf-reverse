# Windsurf Next Architecture - 完整逆向分析

## 核心发现：谁与服务器通信？

**答案：`language_server_windows_x64.exe`** 是与 Codeium 云端通信的核心。

Extension.js **不直接**连接 `server.codeium.com`。它通过 Connect-RPC (HTTP/1.1 + protobuf binary) 连接到**本地**的 `language_server` 进程。`language_server` 才是真正与云端建立 gRPC 连接的组件。

**唯一例外：** `SeatManagementService`（认证/注册）由 extension.js **直接**调用 `register.windsurf.com`。

---

## 完整架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Windsurf IDE (Electron App)                       │
│                                                                     │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  extension.js (9.2MB, runs in VS Code Extension Host)          │ │
│  │                                                                │ │
│  │  Components:                                                   │ │
│  │  • LanguageServerClient  → Connect-RPC to localhost:PORT       │ │
│  │  • ExtensionServer       → local gRPC server (callbacks)       │ │
│  │  • WindsurfAuthProvider  → direct HTTP to register.windsurf.com│ │
│  │  • Webview Panel         → Cascade UI (React)                  │ │
│  │  • MetadataProvider      → request metadata injection          │ │
│  │                                                                │ │
│  └────────┬───────────────────────────────────────┬───────────────┘ │
│           │                                       ▲                 │
│           │ Connect-RPC (HTTP/1.1, proto binary)  │ gRPC callbacks  │
│           │ x-codeium-csrf-token header           │                 │
│           ▼                                       │                 │
│  ┌────────────────────────────────────────────────┴───────────────┐ │
│  │  language_server_windows_x64.exe (163.7MB, Go/Rust binary)     │ │
│  │                                                                │ │
│  │  Exposes (local):                                              │ │
│  │  • LanguageServerService (383 RPCs, 15 ServerStreaming)        │ │
│  │  • DevService (2 RPCs)                                         │ │
│  │  • LSP server (for IDE language features)                      │ │
│  │                                                                │ │
│  │  Calls back:                                                   │ │
│  │  • ExtensionServerService (41 methods: IDE operations)         │ │
│  │                                                                │ │
│  │  Internal:                                                     │ │
│  │  • Code indexing & search (uses fd.exe for file discovery)     │ │
│  │  • AI completion orchestration                                 │ │
│  │  • Cascade agent execution & tool use                          │ │
│  │  • Streaming responses back to extension                       │ │
│  └────────────────────────────┬───────────────────────────────────┘ │
│                               │                                     │
│  Also bundled:                │                                     │
│  • devin.exe (112MB) - Cloud sandbox agent CLI                     │
│  • fd.exe (3.4MB) - Fast file finder                               │
└───────────────────────────────┼─────────────────────────────────────┘
                                │ gRPC (HTTP/2, protobuf)
                                │ X-Api-Key header
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Codeium Cloud Infrastructure                                       │
│                                                                     │
│  • server.codeium.com      - API server (completions, Cascade, etc) │
│  • inference.codeium.com   - AI model inference                     │
│  • register.windsurf.com   - Auth & seat management (← direct)      │
│  • unleash.codeium.com     - Feature flags                          │
│  • eu.windsurf.com         - EU region API                          │
│  • windsurf.fedstart.com   - FedStart (gov) API                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## language_server 启动参数

Extension 通过 `child_process` 启动 `language_server` 时传入的 CLI 参数：

```
language_server_windows_x64.exe
  --api_server_url        https://server.codeium.com
  --inference              (inference API server URL)
  --extension_server_port  <ExtensionServer local port>
  --run_child
  --enable_lsp
  --ide_name              windsurf
  --search                (max workspace file count)
  --workspace             (workspace ID)
  --multitenant_mode      (if multi-tenant)
  --portal_url            (website URL)
  --server_port           (if restarting, reuse port)
```

启动后 `language_server` 返回：
- `address` (e.g. `127.0.0.1:PORT`) - gRPC server address
- `languageServerPort` - the gRPC port number
- `lspPort` - LSP protocol port

---

## 通信协议详解

### Extension → language_server (本地)

| 属性 | 值 |
|---|---|
| 协议 | Connect-RPC (HTTP/1.1) |
| 格式 | Protobuf binary (`useBinaryFormat: true`) |
| 认证 | `x-codeium-csrf-token` header (随机 token) |
| 地址 | `http://127.0.0.1:{languageServerPort}` |
| 服务 | LanguageServerService, DevService |

### language_server → ExtensionServer (本地回调)

| 属性 | 值 |
|---|---|
| 协议 | gRPC |
| 方向 | language_server → extension.js |
| 服务 | ExtensionServerService (41 methods) |
| 用途 | IDE 操作（打开文件、执行命令、写编辑、读终端等） |

### language_server → Codeium Cloud (远程)

| 属性 | 值 |
|---|---|
| 协议 | gRPC (HTTP/2, protobuf) |
| 认证 | `X-Api-Key` header |
| 目标 | server.codeium.com, inference.codeium.com |
| 功能 | AI 补全、Cascade 对话、代码搜索、分析 |

### Extension → register.windsurf.com (直连)

| 属性 | 值 |
|---|---|
| 协议 | Connect-RPC (HTTP/1.1) |
| 格式 | Protobuf binary |
| 服务 | SeatManagementService |
| 功能 | OAuth 注册/登录、团队管理、计费、SSO |

---

## Cascade 对话工作流

```
User types message in Cascade Panel (Webview)
       │
       ▼
[1] extension.js: StartCascade()
    → LanguageServerClient.client.startCascade({
        metadata: MetadataProvider.getMetadata(),
        source: CortexTrajectorySource.CASCADE_CLIENT,
      })
    ← Returns: { cascadeId: "uuid" }
       │
       ▼
[2] extension.js: SendUserCascadeMessage()
    → LanguageServerClient.client.sendUserCascadeMessage({
        metadata: ...,
        cascadeId: cascadeId,
        items: [{ chunk: { case: "text", value: "user message" } }],
        cascadeConfig: CascadeConfig({
          plannerConfig: CascadePlannerConfig({
            plannerTypeConfig: { case: "conversational", value: ... }
          }),
          requestedModelUid: "model-uid"
        })
      })
       │
       ▼
[3] language_server.exe 内部:
    • 接收用户消息
    • 构建 prompt (含 context, rules, memories)
    • 调用 server.codeium.com / inference.codeium.com
    • 执行 AI planning (CortexSteps)
    • 需要 IDE 操作时回调 ExtensionServer
       │
       ▼
[4] Streaming: StreamCascadeReactiveUpdates
    → ServerStreaming RPC, language_server 持续推送更新
    → 更新内容: CortexSteps (编辑、命令、搜索结果等)
    → extension.js 接收后更新 Webview UI
       │
       ▼
[5] ExtensionServer 回调 (tool execution):
    • WriteCascadeEdit     → 写文件编辑
    • ExecuteCommand       → 执行终端命令
    • ReadTerminal         → 读终端输出
    • OpenFilePointer      → 打开文件
    • GetLintErrors        → 获取 lint 错误
    • FindAllReferences    → LSP 查找引用
    • GetLSPCompletionItems → LSP 补全
       │
       ▼
[6] 用户交互:
    • HandleCascadeUserInteraction → 用户确认/拒绝操作
    • AcknowledgeCascadeCodeEdit   → accept/reject 代码编辑
    • CancelCascadeInvocation      → 取消当前操作
    • BranchCascade                → 从某步骤分支
    • RevertToCascadeStep          → 回退到某步骤
```

---

## 15 个 ServerStreaming RPCs

这些是 language_server 向 extension 推送实时数据的通道：

| RPC | 用途 |
|---|---|
| `StreamCascadeReactiveUpdates` | Cascade 对话实时更新（主通道） |
| `StreamCascadePanelReactiveUpdates` | Cascade Panel UI 状态更新 |
| `StreamCascadeSummariesReactiveUpdates` | 对话摘要实时更新 |
| `StreamUserTrajectoryReactiveUpdates` | 用户轨迹更新 |
| `HandleStreamingCommand` | 流式命令执行结果 |
| `HandleStreamingTab` | Tab 补全流式响应 |
| `HandleStreamingTerminalCommand` | 终端命令流式输出 |
| `GetChatMessage` | 聊天消息流式获取 |
| `RawGetChatMessage` | 原始聊天消息流 |
| `GetDeepWiki` | DeepWiki 文档生成流 |
| `GenerateVibeAndReplaceStreaming` | Vibe & Replace 流式生成 |
| `GenerateCodeMap` | CodeMap 生成流 |
| `ExecuteCommand` | 命令执行流 (ExtensionServer) |
| `SubscribeNativeValues` | Native 值订阅 |
| `HandleStreamingTabV2` | Tab V2 流式补全 |

---

## ExtensionServerService 回调方法 (41个)

language_server 执行 Cascade 工具时需要回调 IDE 的操作：

| 类别 | 方法 |
|---|---|
| **文件操作** | OpenFilePointer, SaveDocument, OpenDiffZones, OpenMultiDiff, WriteCascadeEdit |
| **终端** | CheckTerminalShellSupport, ShowTerminal, ReadTerminal, OpenTerminal |
| **代码智能** | FindAllReferences, GetLSPCompletionItems, GetLintErrors, WatchForLints |
| **编辑** | InsertCodeAtCursor, OpenVirtualFile |
| **命令** | ExecuteCommand |
| **UI** | OpenSetting, OpenExternalUrl, OpenConfigurePluginsPage |
| **事件** | LogEvent, LanguageServerStarted, HandleAsyncPostMessage |
| **Rules/Workflows** | OpenWindsurfRulesFile, DeleteWindsurfRulesFile, DeleteWindsurfWorkflow |
| **音频** | StartAudioRecording, EndAudioRecording, GetCurrentAudioRecording |
| **CodeMap** | LoadCodeMap, AddAnnotation, RemoveAnnotation, ShowAnnotation |
| **MCP** | NotifyMcpStateChanged |
| **Secret** | GetSecretValue, StoreSecretValue, GetRedirectUri |
| **其他** | RefreshURIs, CheckExperiment, UpdateCascadeTrajectorySummaries |

---

## 遗漏组件补充

### @exa/windsurf-acp (711KB)
ACP (Agent Communication Protocol) - Windsurf 插件系统，用于 Cascade 与第三方工具的集成。

### devin.exe (112MB)
集成的 Devin CLI 工具，支持：
- Cloud sandbox 创建与管理
- MCP server 管理
- Rules/Skills 管理
- Shell 集成
- 通过 `X-Devin-Session-Token` 认证

---

## 关键安全机制

1. **CSRF Token**: extension.js 生成随机 csrfToken，通过 `--csrf_token` 传给 language_server，之后每次 RPC 调用都在 header 中带上 `x-codeium-csrf-token`
2. **API Key**: 通过 OAuth 登录获取，存储在 VS Code SecretStorage 中
3. **Session Isolation**: 每个 workspace 独立的 language_server 进程
4. **Port Randomization**: language_server 监听随机端口
