# Windsurf 深度接口逆向分析

> 基于 LS binary (language_server_windows_x64.exe) + 61个 proto 文件 + extension.js 的深度逆向

---

## 1. 全局架构: 14个 gRPC Service

| Service | 方法数 | 方向 | 传输 |
|---------|--------|------|------|
| **LanguageServerService** | 172 | Extension→LS | Connect-RPC (localhost) |
| **ExtensionServerService** | 50 | LS→Extension | Connect-RPC (localhost) |
| **ApiServerService** | 171 | LS→Cloud | gRPC (server.codeium.com) |
| **SeatManagementService** | 151 | LS→Cloud | Connect-RPC (register.windsurf.com) |
| **CascadePluginsService** | 5 | LS→Cloud | Connect-RPC |
| **KnowledgeBaseService** | 11 | LS→Cloud | Connect-RPC |
| **BrowserPreviewService** | 3 | Browser→LS | Connect-RPC |
| **ChatClientServerService** | 1 (streaming) | LS→ChatPanel | Connect-RPC |
| **FileSystemProviderService** | 3 | LS→Extension | Connect-RPC |
| **ReactiveComponent** | 4 streams | LS→Extension | Connect-RPC (streaming) |
| **ModelManagementService** | — | Internal | gRPC |
| **IndexService** | — | Internal | gRPC |
| **AnalyticsService** | — | Internal | gRPC |
| **AuthService** | — | LS→Cloud | Connect-RPC |

---

## 2. ExtensionServerService (LS→Extension 回调) — 50个方法

LS binary 通过此服务**反向调用**IDE:

### 2.1 文件操作回调

| 方法 | 功能 | 关键字段 |
|------|------|---------|
| `OpenFilePointer` | 打开文件+跳转行列 | file_uri, start_line/col, end_line/col, is_cascade_diff, is_directory, pinned |
| `InsertCodeAtCursor` | 在光标处插入代码 | text, editor_type (TEXT_EDITOR/TERMINAL) |
| `SaveDocument` | 保存文件 | uri |
| `OpenVirtualFile` | 打开虚拟文件/Markdown预览 | text, show_markdown_preview |
| `WriteCascadeEdit` | 写入Cascade编辑 | uri, target_content, cascade_id, git_worktree_path, notebook_cell |
| `RefreshURIs` | 刷新文件状态 | uris[] |
| `OpenDiffZones` | 打开diff区域 | cascade_id, validation_states[], git_worktree_path |
| `OpenMultiDiff` | 打开多文件diff | cascade_id, title |
| `UnmountChanges` | 卸载文件系统更改 | → success, error_message |

### 2.2 终端操作回调

| 方法 | 功能 | 关键字段 |
|------|------|---------|
| `ExecuteCommand` | 执行终端命令 (streaming!) | command_line, cwd, terminal_id → stream TerminalShellCommandStreamChunk |
| `ReadTerminal` | 读取终端内容 | terminal_id → contents |
| `OpenTerminal` | 打开终端 | terminal_id |
| `ShowTerminal` | 显示终端 | terminal_id |
| `CheckTerminalShellSupport` | 检查shell集成 | → has_shell_integration, shell_name, shell_path, failure_reason, shell_args |

### 2.3 Lint/诊断回调

| 方法 | 功能 | 关键字段 |
|------|------|---------|
| `GetLintErrors` | 获取lint错误 | await_new_lints_config(acknowledger_id, timeout_ms, grace_period_ms) → lint_errors[], persistent_lint_errors[] |
| `WatchForLints` | 监视lint变化 | acknowledger_id, duration_ms |
| `GetLintsForAcknowledger` | 获取特定确认者的lint | acknowledger_id → lint_errors[] |

### 2.4 MCP/插件回调

| 方法 | 功能 |
|------|------|
| `NotifyMcpStateChanged` | MCP服务器状态变更通知 → states[] |
| `OpenConfigurePluginsPage` | 打开插件配置页 → server_name |

### 2.5 安全/认证回调

| 方法 | 功能 | 关键字段 |
|------|------|---------|
| `GetSecretValue` | 从IDE安全存储获取secret | key → value |
| `StoreSecretValue` | 存储secret到IDE安全存储 | key, value |
| `GetRedirectUri` | 获取OAuth重定向URI | → uri |
| `LogoutWindsurf` | 登出 | api_key |
| `CheckExperiment` | 检查feature flag | experiment_key, context_overrides → enabled, variant(name,payload) |

### 2.6 音频/语音回调

| 方法 | 功能 |
|------|------|
| `StartAudioRecording` | 开始录音 |
| `EndAudioRecording` | 结束录音 → transcription |
| `GetCurrentAudioRecording` | 获取当前录音 → average_volume |

### 2.7 UI操作回调

| 方法 | 功能 |
|------|------|
| `OpenSetting` | 打开设置 (setting_id) |
| `OpenExternalUrl` | 打开外部URL (url, use_ide_browser) |
| `LogEvent` | 记录事件 (ProductEventType, metadata[]) |
| `HandleAsyncPostMessage` | 异步消息 (message_type, message_content → response_content) |
| `OpenConversationWorkspaceQuickPick` | 打开会话工作区选择器 |
| `SearchQuery` | 搜索文件 (query, max_results, cache_key, include_ignored_files) |

### 2.8 代码分析回调

| 方法 | 功能 |
|------|------|
| `FindAllReferences` | 查找所有引用 (file_uri, symbol, line, occurrence_index → references[]) |
| `GetLSPCompletionItems` | 获取LSP补全项 (document_uri, position → completion_items_json) |

### 2.9 NativeValue 状态桥接

```protobuf
// LS ↔ Extension 之间的配置/状态同步机制
message NativeStorageTarget {
  oneof target {
    SettingTarget setting = 1;  // VS Code settings (user/workspace)
    StateTarget state = 2;      // Extension state
  }
}

message NativeValue {
  oneof value {
    string string_value = 1;
    int32 int_value = 2;
    bool bool_value = 3;
    double double_value = 4;
    NativeValueList list_value = 5;
    NativeValueMap map_value = 6;
  }
}

// SetNativeValue 带乐观并发控制:
message SetNativeValueRequest {
  NativeStorageTarget target = 1;
  string key = 2;
  NativeValue value = 3;
  NativeValue expected_previous_value = 4;  // CAS 操作!
}
message SetNativeValueResponse {
  bool concurrency_conflict = 1;  // CAS 失败标志
  NativeValueEntry current_value = 2;
}

// 实时订阅:
rpc SubscribeNativeValues → stream NativeValuesResponse
```

---

## 3. Cortex/Trajectory 系统 (Cascade 核心引擎)

### 3.1 Trajectory 类型 (19种)

```
USER_MAINLINE(1)          — 用户主线 (文件编辑历史)
USER_GRANULAR(2)          — 用户细粒度
SUPERCOMPLETE(3)          — 超级补全
CASCADE(4)                — Cascade对话核心
BACKGROUND_RESEARCH(5)    — 后台研究
CHECKPOINT(6)             — 检查点
RETRIEVE_MEMORY(7)        — 记忆检索
CUSTOM_TOOL(8)            — 自定义工具
AUTO_CASCADE(9)           — 自动Cascade (GitHub CI/PR review)
AUTO_CASCADE_MANAGER(10)  — 自动Cascade管理器
APPLIER(11)               — 应用器
TOOL_CALL_PROPOSAL(12)    — 工具调用提案
TRAJECTORY_CHOICE(13)     — 轨迹选择
LLM_JUDGE(14)             — LLM评判
PASSIVE_CODER(15)         — 被动编码器
BRAIN_UPDATE(16)          — Brain更新
INTERACTIVE_CASCADE(17)   — 交互式Cascade
ARTIFACT_SUMMARY(19)      — 制品摘要
```

### 3.2 Trajectory 来源 (15种)

```
CASCADE_CLIENT(1)    — 用户Cascade
EXPLAIN_PROBLEM(2)   — 解释问题
REFACTOR_FUNCTION(3) — 重构函数
EVAL(4)              — 评估
EVAL_TASK(5)         — 评估任务
ASYNC_PRR(6)         — 异步PR Review
ASYNC_CF(7)          — 异步Code Fix
ASYNC_SL(8)          — 异步SmartLint
ASYNC_PRD(9)         — 异步PR Description
ASYNC_CM(10)         — 异步CodeMap
PASSIVE_CODER(11)    — 被动编码器
CODE_MAP(13)         — CodeMap
LIFEGUARD(15)        — Lifeguard安全
```

### 3.3 Step 类型 (93种工具调用)

核心工具:

| Step Type | 功能 | 关键字段 |
|-----------|------|---------|
| `USER_INPUT(14)` | 用户输入 | text, images, scope_items |
| `PLANNER_RESPONSE(15)` | AI回复 | text (markdown) |
| `CODE_ACTION(5)` | 代码编辑 | diffs, uri, replacements |
| `WRITE_TO_FILE(16)` | 写入文件 | uri, content |
| `RUN_COMMAND(21)` | 执行命令 | command_line, cwd, output, exit_code |
| `COMMAND_STATUS(28)` | 命令状态 | command_id, output |
| `VIEW_FILE(8)` | 查看文件 | path, line_range, content |
| `GREP_SEARCH(7)` | 搜索代码 | query, results |
| `GREP_SEARCH_V2(91)` | 搜索代码v2 | 改进版 |
| `LIST_DIRECTORY(9)` | 列目录 | path, entries |
| `FIND(25)` | 查找文件 | pattern, results |
| `MQUERY(4)` | 语义代码搜索 | query, code_items |
| `SEARCH_WEB(33)` | 网页搜索 | query, results |
| `READ_URL_CONTENT(31)` | 读取URL | url, content |
| `VIEW_CONTENT_CHUNK(32)` | 查看内容块 | document_id, chunk |

记忆/知识:

| Step Type | 功能 |
|-----------|------|
| `MEMORY(29)` | 创建/更新/删除记忆 |
| `RETRIEVE_MEMORY(34)` | 检索相关记忆 |
| `SEARCH_KNOWLEDGE_BASE(26)` | 搜索知识库 |
| `LOOKUP_KNOWLEDGE_BASE(30)` | 查找知识库 |
| `READ_KNOWLEDGE_BASE_ITEM(50)` | 读取知识库条目 |
| `BRAIN_UPDATE(55)` | Brain动态更新 |

MCP/插件:

| Step Type | 功能 |
|-----------|------|
| `MCP_TOOL(38)` | MCP工具调用 |
| `LIST_RESOURCES(51)` | 列出MCP资源 |
| `READ_RESOURCE(52)` | 读取MCP资源 |
| `CUSTOM_TOOL(36)` | 自定义工具 |
| `SKILL(101)` | 调用Skill |

部署/预览:

| Step Type | 功能 |
|-----------|------|
| `PROXY_WEB_SERVER(43)` | 代理Web服务器 |
| `DEPLOY_WEB_APP(44)` | 部署Web应用 |
| `READ_DEPLOYMENT_CONFIG(46)` | 读取部署配置 |
| `CHECK_DEPLOY_STATUS(48)` | 检查部署状态 |

高级:

| Step Type | 功能 |
|-----------|------|
| `CHECKPOINT(23)` | 创建检查点 |
| `SUGGEST_CODEMAP(93)` | 建议CodeMap |
| `UPSERT_CODEMAP(92)` | 创建/更新CodeMap |
| `TODO_LIST(73)` | 待办列表 |
| `ASK_USER_QUESTION(100)` | 向用户提问 |
| `TRAJECTORY_SEARCH(60)` | 搜索其他轨迹 |
| `ARENA_TRAJECTORY_CONVERGE(103)` | Arena模式合并 |
| `TASK_SUBAGENT(104)` | 任务子代理 |
| `REPORT_BUGS(97)` | Lifeguard报告bug |
| `EXIT_PLAN_MODE(99)` | 退出计划模式 |
| `BLOCKING(74)` | 阻塞等待 |

### 3.4 CortexTrajectory 完整结构

```protobuf
message CortexTrajectory {
  string trajectory_id = 1;
  string cascade_id = 6;
  CortexTrajectoryType trajectory_type = 4;
  repeated CortexTrajectoryStep steps = 2;           // 所有步骤
  repeated CortexTrajectoryReference parent_refs = 5; // 父轨迹引用
  repeated CortexStepGeneratorMetadata generators = 3; // 生成器元数据
  repeated ExecutorMetadata executor_metadatas = 9;
  CortexTrajectorySource source = 8;
  CortexTrajectoryMetadata metadata = 7;
  optional string renamed_title = 10;
  optional bytes virtual_fs_serialized_overlay = 13;  // 虚拟文件系统!
  uint32 diff_lines_added = 14;
  uint32 diff_lines_removed = 15;
  optional string arena_id = 16;                      // Arena模式ID
  repeated QueuedMessage message_queue = 17;           // 消息队列
  optional string git_worktree_path = 18;             // Git worktree
  repeated string git_worktree_paths = 22;
  optional ArenaModeInfo arena_mode_info = 20;
  optional ConversationalPlannerMode conversational_mode = 21;
  repeated WorktreeMergeSnapshot worktree_merges = 23;
  optional ModelAssignmentInfo model_assignment_info = 24; // 模型分配
}
```

### 3.5 步骤状态机

```
GENERATING → PENDING → RUNNING → DONE
                    ↘ WAITING (需要用户交互)
                    ↘ HALTED (被钩子阻止)
                    ↘ CANCELED
                    ↘ ERROR
                    ↘ INVALID
                    ↘ CLEARED
                    ↘ SKIPPING
```

### 3.6 Executor 终止原因

```
ERROR(1)                — 错误
USER_CANCELED(2)        — 用户取消
MAX_INVOCATIONS(3)      — 达到最大调用次数
NO_TOOL_CALL(4)         — 模型未调用工具
HALTED_STEP(5)          — 步骤被暂停
HOOK_BLOCKED(6)         — 被钩子阻止
ARENA_INVOCATION_CAP(7) — Arena模式调用上限
```

---

## 4. CascadeConfig — 完整运行时配置

### 4.1 顶层结构

```protobuf
message CascadeConfig {
  CascadePlannerConfig planner_config = 1;   // 规划器
  CheckpointConfig checkpoint_config = 2;     // 检查点
  CascadeExecutorConfig executor_config = 3;  // 执行器
  TrajectoryConversionConfig trajectory_conversion_config = 4;
  MemoryConfig memory_config = 5;             // 记忆系统
  BrainConfig brain_config = 7;              // Brain系统
  ParallelRolloutConfig parallel_rollout_config = 8;
  repeated CascadeHook hooks = 9;             // 钩子系统
  optional string override_harness_uid = 10;
}
```

### 4.2 规划器类型 (8种)

| 规划器 | 用途 |
|--------|------|
| `conversational` | 对话模式 (默认) |
| `conversational_v2` | 对话模式v2 |
| `agentic` | Agentic模式 (管理器+执行器+反馈循环) |
| `research` | 研究模式 |
| `passive` | 被动模式 (只读) |
| `agent_v2` | Agent v2 + Summarizer |
| `codemap` | CodeMap规划器 |
| `lifeguard` | Lifeguard安全规划器 |

### 4.3 CascadeToolConfig (30种工具配置)

```protobuf
message CascadeToolConfig {
  MqueryToolConfig mquery = 1;        // 语义搜索
  CodeToolConfig code = 2;            // 代码编辑 (含replace变体, auto-fix-lints)
  IntentToolConfig intent = 3;        // 意图分析
  GrepToolConfig grep = 4;            // grep搜索
  FindToolConfig find = 5;            // 文件查找
  RunCommandToolConfig run_command = 8;// 命令执行 (含5层安全)
  ViewFileToolConfig view_file = 10;  // 文件查看
  SearchWebToolConfig search_web = 13;// Web搜索
  ReadUrlContentToolConfig read_url = 37;// URL读取
  MemoryToolConfig memory = 14;       // 记忆系统
  McpToolConfig mcp = 16;            // MCP工具
  ProxyWebServerToolConfig proxy = 17;// Web代理
  DeployWebAppToolConfig deploy = 18; // 部署
  TrajectorySearchToolConfig traj = 28;// 轨迹搜索
  NotebookToolConfig notebook = 31;   // Notebook
  SmartFriendToolConfig smart = 35;   // SmartFriend
  ExitPlanModeToolConfig exit_plan = 38;
  AskUserQuestionToolConfig ask = 39;
  TaskSubagentToolConfig subagent = 40;
  repeated string tool_allowlist = 32; // 工具白名单
  // ... 更多
}
```

### 4.4 ExecutorConfig

```protobuf
message CascadeExecutorConfig {
  optional bool disable_async = 1;            // 禁用异步
  int32 max_generator_invocations = 2;        // 最大生成调用次数
  repeated CortexStepType terminal_types = 3;  // 终止步骤类型
  optional bool run_pending_steps = 4;
  optional bool hold_for_valid_checkpoint = 5;
  int32 hold_timeout = 6;
  bool research_only = 7;
  optional bool use_aggressive_snapshotting = 8;
  bool enable_background_linting = 9;         // 后台lint
  int32 max_lint_injection_count = 10;         // 最大lint注入次数
}
```

### 4.5 BrainConfig (动态任务管理)

```protobuf
message BrainConfig {
  optional bool enabled = 1;
  string brain_model_uid = 14;                // Brain专用模型
  optional bool use_main_model_as_brain = 13;
  optional bool force_no_explanation = 4;
  BrainFilterStrategy filter_strategy = 5;    // 过滤策略
  BrainUpdateStrategy update_strategy = 6;    // 更新策略
  optional bool condense_trajectory_messages = 8;
  optional uint32 recent_update_tool_threshold = 9;
  optional uint32 stale_update_tool_threshold = 10;
  string additional_ephemeral_prompt = 11;
  optional bool use_rules_in_subagent = 12;
}

// Brain 更新触发器
enum BrainUpdateTrigger {
  SYSTEM_FORCED(1)      — 系统强制
  USER_REQUESTED(2)     — 用户请求
  USER_NEW_INFO(3)      — 用户新信息
  RESEARCH_NEW_INFO(4)  — 研究新信息
}

// Brain 条目类型
enum BrainEntryType {
  PLAN(1)  — 计划
  TASK(2)  — 任务 (可跟踪状态: TODO/IN_PROGRESS/DONE)
}
```

---

## 5. MCP 插件系统

### 5.1 MCP Server 生命周期

```
配置 → 启动 → 就绪/错误/需OAuth
  ↕
McpServerSpec → McpServerState → tools[], prompts[], resources[]
```

### 5.2 McpServerSpec (服务器定义)

```protobuf
message McpServerSpec {
  string server_name = 1;
  string command = 2;           // 启动命令
  repeated string args = 3;
  map<string, string> env = 4;  // 环境变量
  uint32 server_index = 5;
  string server_url = 6;        // 远程服务器URL
  bool disabled = 7;
  repeated string disabled_tools = 8; // 禁用的工具
  map<string, string> headers = 9;
  McpOAuthConfig oauth = 10;    // OAuth配置
  string registry = 11;         // 注册表来源
}
```

### 5.3 McpServerState (运行时状态)

```protobuf
message McpServerState {
  McpServerSpec spec = 1;
  McpServerStatus status = 2;      // PENDING/READY/ERROR/NEEDS_OAUTH
  string error = 3;
  repeated ChatToolDefinition tools = 4; // 暴露的工具
  repeated string tool_errors = 7;
  McpServerInfo server_info = 5;    // name, version
  string instructions = 6;          // 服务器指令
  repeated McpPrompt prompts = 8;   // 提示模板
}
```

### 5.4 MCP 管理方法 (LanguageServerService)

| 方法 | 功能 |
|------|------|
| `RefreshMcpServers` | 重新加载所有MCP服务器 |
| `GetMcpServerStates` | 获取所有服务器状态 |
| `SaveMcpServerToConfigFile` | 保存服务器配置 |
| `UpdateMcpServerInConfigFile` | 更新服务器配置 |
| `ToggleMcpTool` | 启用/禁用特定MCP工具 |
| `GetMcpPrompt` | 获取MCP提示 (server_name, prompt_name, args) |
| `GetMcpRegistryServers` | 搜索MCP注册表 (search, limit, cursor, pagination) |
| `GetAllAcpRegistries` | 获取所有ACP注册表 |

### 5.5 Cascade Plugins (托管MCP)

```protobuf
message CascadePluginTemplate {
  oneof configuration {
    CascadePluginLocalConfig local = 9;   // 本地命令
    CascadePluginRemoteConfig remote = 10; // 远程服务器
  }
  string title = 1;
  string id = 2;
  string link = 3;
  string description = 4;
  map<string, CascadePluginCommand> commands = 5;
  int64 installation_count = 6;
  string trust_level = 7;     // 信任级别!
  string readme = 8;
}

// 远程插件: server_url + headers (直接连接)
// 本地插件: 命令模板 + 变量替换

// CascadePluginsService (云端):
// - GetAvailableCascadePlugins: 搜索可用插件
// - InstallCascadePlugin: 安装 → 返回 installation_count
// - GetCascadePluginById: 获取插件详情
// - GetMcpClientInfos: 获取MCP OAuth客户端信息
```

### 5.6 MCP Registry Server 结构

```protobuf
message McpRegistryServer {
  string name = 1;
  string title = 2;
  string description = 3;
  string version = 4;
  string website_url = 5;
  McpRegistryRepository repository = 6;     // GitHub等
  repeated McpRegistryPackage packages = 7;  // npm/pip等包
  repeated McpRegistryRemote remotes = 8;    // 远程传输
  repeated McpRegistryIcon icons = 9;
  bool is_latest = 10;
  string status = 11;                        // 审核状态
  string schema = 12;
}

message McpRegistryPackage {
  string registry_type = 1;   // "npm", "pip", etc.
  string identifier = 2;      // 包名
  string version = 3;
  string runtime_hint = 4;    // "node", "python", etc.
  repeated McpRegistryEnvironmentVariable env = 5;
  McpRegistryTransport transport = 6;
  string file_sha256 = 10;    // 完整性校验
}
```

---

## 6. CodeMap 系统

### 6.1 方法列表

| 方法 | 功能 |
|------|------|
| `GetCodeMapsForRepos` | 获取仓库的所有CodeMap |
| `GetCodeMapsForFile` | 获取文件的CodeMap |
| `GenerateCodeMap` | AI生成CodeMap (streaming!) — prompt, mode, source |
| `BranchCascadeAndGenerateCodeMap` | 从Cascade分支+生成CodeMap |
| `ShareCodeMap` | 分享CodeMap |
| `GetSharedCodeMap` | 获取分享的CodeMap |
| `GetCodeMapSuggestions` | 获取CodeMap建议 — navigation_history → suggestions[] |
| `UpdateCodeMapMetadata` | 更新CodeMap元数据 |
| `SaveCodeMapFromJson` | 从JSON保存CodeMap |
| `DismissCodeMapSuggestion` | 关闭CodeMap建议 |
| `LoadCodeMap` (Extension) | 加载CodeMap到IDE |

### 6.2 CodeMap 数据结构

```protobuf
message CortexStepCodeMap {
  string code_map_json_content = 1;  // JSON格式的代码图
}

message CodeMapSuggestion {
  string id = 1;
  string prompt = 2;
  repeated string starting_points = 3;  // 起始文件
  bool dismissed = 4;
  optional string subtitle = 5;
}

message UpsertCodemapOutput {
  string id = 1;
  string title = 2;
  string codemap_json = 3;
  optional string description = 4;
}
```

---

## 7. Workflows / Skills / Rules 系统

### 7.1 WorkflowSpec

```protobuf
message WorkflowSpec {
  string path = 1;
  string name = 2;
  string description = 3;
  string content = 4;                          // Markdown内容
  CascadeCommandsAutoExecution execution_mode = 9; // 自动执行模式
  bool is_builtin = 6;                        // 内置vs用户
  CortexMemoryScope scope = 7;                // 作用域
  string base_dir = 8;
  bool is_overridden = 10;                    // 是否被覆盖
  optional string parse_error = 11;
  string uri = 12;
}
```

### 7.2 CortexSkill

```protobuf
message CortexSkill {
  string name = 1;
  string description = 2;
  string path = 3;
  int32 resource_count = 4;     // 关联资源数
  string base_dir = 5;
  string content = 6;           // Skill内容
  bool is_global = 7;
  optional string parse_error = 8;
  SkillSource skill_source = 9; // WORKSPACE/GLOBAL/SYSTEM
}
```

### 7.3 CortexMemory (Rules)

```protobuf
message CortexMemory {
  oneof memory {
    CortexMemoryText text_memory = 5;
  }
  CortexMemoryScope scope = 2;
  CortexMemoryMetadata metadata = 3;
  CortexMemorySource source = 4;  // USER/CASCADE/AUTO_CASCADE
  optional string parse_error = 7;
}

// 作用域层次:
message CortexMemoryScope {
  oneof scope {
    CortexMemoryGlobalScope global = 1;   // 全局
    CortexMemoryLocalScope local = 2;      // 本地(repo)
    CortexMemoryAllScope all = 3;          // 所有
    CortexMemorySystemScope system = 4;    // 系统级
  }
}

// 触发模式:
enum CortexMemoryTrigger {
  ALWAYS_ON(1)       — 始终激活
  MODEL_DECISION(2)  — 模型决策
  MANUAL(3)          — 手动
  GLOB(4)            — 文件模式匹配
}

// ProjectScope (Rules文件):
message CortexMemoryProjectScope {
  string file_path = 1;
  string absolute_file_path = 7;
  repeated string base_dir_uris = 2;
  repeated string corpus_names = 3;
  CortexMemoryTrigger trigger = 4;
  string description = 5;
  repeated string globs = 6;           // 文件匹配模式
  RuleSource rule_source = 8;          // WORKSPACE/SYSTEM
}
```

### 7.4 管理方法

| 方法 | 功能 |
|------|------|
| `GetAllWorkflows` | 获取所有Workflow |
| `CopyBuiltinWorkflowToWorkspace` | 复制内置Workflow到工作区 |
| `DeleteWindsurfWorkflow` (Extension) | 删除Workflow |
| `GetAllRules` | 获取所有Rules → memories[] + skills[] |
| `GetAllSkills` | 获取所有Skills |
| `GetAllPlans` | 获取所有Plans |
| `GetCascadeMemories` | 获取Cascade记忆 |
| `DeleteCascadeMemory` | 删除记忆 |
| `UpdateCascadeMemory` | 更新记忆 |
| `GetUserMemories` | 获取用户记忆 |
| `RefreshCustomization` | 刷新自定义配置 |
| `CreateCustomizationFile` | 创建自定义文件 |
| `ImportFromCursor` | 从Cursor导入 → copied_files[], duplicate_files[], problem_files[] |

---

## 8. Cascade Hooks 系统

### 8.1 Hook 触发时机 (12种)

```
PRE_READ_CODE(1)   — 读代码前
POST_READ_CODE(2)  — 读代码后
PRE_WRITE_CODE(3)  — 写代码前
POST_WRITE_CODE(4) — 写代码后
PRE_MCP_TOOL_USE(5)  — MCP工具使用前
POST_MCP_TOOL_USE(6) — MCP工具使用后
PRE_RUN_COMMAND(7)    — 运行命令前
POST_RUN_COMMAND(8)   — 运行命令后
PRE_USER_PROMPT(9)    — 用户提示前
POST_CASCADE_RESPONSE(10) — Cascade回复后
POST_SETUP_WORKTREE(11)   — 设置Worktree后
POST_CASCADE_RESPONSE_WITH_TRANSCRIPT(12) — 带转录的回复后
```

### 8.2 Hook 结构

```protobuf
message CascadeHook {
  HookExecutionSpec hook_spec = 5;    // 执行规格
  HookCondition condition = 6;        // 触发条件
  repeated string workspace_dirs = 7; // 工作区范围
}

message CommandHookSpec {
  string command = 1;
  string working_directory = 2;
  bool show_output = 3;
  string powershell_command = 4;      // Windows特殊!
}

// 结果:
message CommandHookResult {
  int32 exit_code = 1;
  string stdout = 2;
  string stderr = 3;
}
```

### 8.3 Hook 拦截能力

- 每个 CortexTrajectoryStep 有 `pre_tool_use_hooks[]` 和 `post_tool_use_hooks[]`
- Hook 执行失败可导致 `EXECUTOR_TERMINATION_REASON_HOOK_BLOCKED`
- 步骤可设置 `shield_from_cancellation = true` 保护

---

## 9. Reactive 更新系统 (实时推送)

### 9.1 四个 Streaming 端点

| 方法 | 推送内容 |
|------|---------|
| `StreamCascadePanelReactiveUpdates` | Cascade面板状态变化 |
| `StreamCascadeReactiveUpdates` | 单个Cascade轨迹变化 |
| `StreamCascadeSummariesReactiveUpdates` | Cascade摘要列表变化 |
| `StreamUserTrajectoryReactiveUpdates` | 用户轨迹变化 |

### 9.2 增量更新协议

```protobuf
message StreamReactiveUpdatesResponse {
  uint64 version = 1;          // 单调递增版本号
  MessageDiff diff = 2;        // 增量diff
  bytes full_state = 3;        // 完整状态 (初始/重置时)
}

message MessageDiff {
  repeated FieldDiff field_diffs = 1;
}

message FieldDiff {
  oneof diff {
    SingularValue update_singular = 2;   // 标量更新
    RepeatedDiff update_repeated = 3;     // 数组部分更新
    MapDiff update_map = 4;              // Map部分更新
    bool clear = 5;                      // 清除字段
  }
  uint32 field_number = 1;  // 按proto字段号定位
}
```

**关键设计**: 使用 proto field_number 进行结构化增量推送，避免全量传输。支持标量/数组/Map的细粒度更新。

---

## 10. BrowserPreview 系统

### 10.1 工作流

```
Cascade → proxy_web_server → browser preview
  ↕
BrowserPreviewService:
  SendDOMElement   → DOM结构 (DOMElementScopeItem)
  SendScreenshot   → 截图 (ImageData)
  SendConsoleOutput → 控制台日志 (ConsoleLogScopeItem)
```

Cascade 可通过 `GET_DOM_TREE(68)` 步骤类型获取DOM树。

---

## 11. ChatClientServer (Chat Panel 通信)

### 11.1 双向流

```protobuf
service ChatClientServerService {
  // LS → ChatPanel 的请求流
  rpc StartChatClientRequestStream → stream ChatClientRequest
}

message ChatClientRequest {
  oneof request {
    AddCascadeInputRequest add_cascade_input = 1;
    SendActionToChatPanelRequest send_action = 2;
    InitialAckRequest initial_ack = 3;
    RefreshCustomizationRequest refresh_customization = 4;
    SendCascadeInputRequest send_cascade_input = 5;
    ImplementPlanRequest implement_plan = 6;     // 实施Plan!
  }
}

message ImplementPlanRequest {
  string plan_path = 1;
  string plan_title = 2;
}
```

---

## 12. Knowledge Base 系统

### 12.1 数据模型

```protobuf
message KnowledgeBaseItem {
  string identifier = 1;
  ConnectorType connector_type = 2;  // 连接器类型
  string url = 3;
  string title = 4;
  string description = 5;
  string content = 6;
  Timestamp last_crawled_at = 7;
  string user_name = 8;
}
```

### 12.2 方法

| 方法 | 功能 |
|------|------|
| `CreateKnowledgeBaseItem` | 创建条目 (connector_type, urls[]) |
| `EditKnowledgeBaseItem` | 编辑描述 |
| `DeleteKnowledgeBaseItem` | 删除 |
| `ReadKnowledgeBaseItem` | 读取详情 |
| `GetKnowledgeBaseItems` | 获取个人条目 |
| `GetKnowledgeBaseItemsForTeam` | 获取团队条目 |
| `GetGithubPullRequestSearchInfo` | 搜索GitHub PR |
| `CreateConnection` | 创建外部连接 (OAuth tokens) |
| `RemoveConnection` | 移除连接 |
| `GetConnection` | 获取连接状态 |
| `GetGithubIntegrationStatus` | GitHub集成状态 |

---

## 13. FileSystemProvider (虚拟文件系统)

### 13.1 方法

```protobuf
service FileSystemProviderService {
  rpc Stat → FileStat[]          // 文件信息
  rpc ReadDirectory → DirEntries[] // 目录内容
  rpc ReadFile → FileData[]       // 文件内容
}
```

关联: `MountCascadeFilesystem` / `UnmountCascadeFilesystem` 用于将Cascade的虚拟文件系统挂载为VS Code可访问的文件系统。

---

## 14. Arena 模式系统

### 14.1 方法

| 方法 | 功能 |
|------|------|
| `SpawnArenaModeMidConversation` | 在对话中生成Arena分支 (cascade_id, count) |
| `ConvergeArenaCascades` | 合并Arena结果 → converged_cascade_ids[] |

### 14.2 Arena 数据

```protobuf
message ArenaModeInfo {
  optional bool is_random_mode = 1;
  optional string agent_name = 3;
  optional string arena_assignment_jwt = 4;  // Arena分配JWT
  optional string arena_model_uid = 5;
  optional string harness_uid = 6;
  optional string assigned_model_uid = 7;
}

message ModelAssignmentInfo {
  string assignment_jwt = 1;        // 模型分配JWT
  string assigned_model_uid = 2;
  string harness_uid = 3;
  string model_router_uid = 4;
  Timestamp assigned_at = 5;
}
```

---

## 15. Cascade 生命周期 (完整流程)

```
1. StartCascade
   ├─ metadata, base_trajectory, source
   ├─ override_config, arena_mode_info
   └─ → cascade_id, arena_cascade_ids[]

2. SendUserCascadeMessage / QueueCascadeMessage
   ├─ items[] (text + scope), images[]
   ├─ override_config
   └─ → 触发 executor

3. StreamCascadeReactiveUpdates (实时推送)
   ├─ 增量diff (step状态变化)
   └─ 新step添加

4. HandleCascadeUserInteraction (用户响应)
   ├─ RunCommandAction (confirm/reject/skip)
   ├─ ReadUrlContentAction (allow/reject/always_allow)
   ├─ CascadeDeployInteraction
   └─ AcknowledgementType (accept/reject)

5. BranchCascade (分支对话)
   ├─ base_cascade_id
   ├─ items[], images[]
   └─ → new_cascade_id

6. RevertToCascadeStep (回退)
   ├─ cascade_id, step_index
   └─ 恢复到某步骤状态

7. CancelCascadeInvocation / CancelCascadeSteps

8. RecordUserStepSnapshot (记录快照)

9. 完成后:
   ├─ GetCascadeTrajectory: 获取完整轨迹
   ├─ GetCascadeTranscriptForTrajectoryId: 获取转录
   ├─ GetPatchAndCodeChange: 获取代码变更
   ├─ CreateTrajectoryShare: 分享轨迹
   └─ ArchiveCascadeTrajectory / DeleteCascadeTrajectory
```

---

## 16. Auto-Run 决策链

### 16.1 命令自动执行决策 (9种)

```
USER_ALLOW(1)     → 用户允许列表命中
USER_DENY(2)      → 用户拒绝列表命中
SYSTEM_ALLOW(3)   → 系统允许列表命中
SYSTEM_DENY(4)    → 系统拒绝列表命中
MODEL_ALLOW(5)    → 模型判断安全
MODEL_DENY(6)     → 模型判断不安全
DEFAULT_ALLOW(7)  → 默认允许
DEFAULT_DENY(8)   → 默认拒绝
USER_SKIP(9)      → 用户跳过
```

### 16.2 Extension 代码执行决策

```
ALLOWED(1)       → 允许
DENIED(2)        → 拒绝
MODEL_ALLOWED(3) → 模型允许
MODEL_DENIED(4)  → 模型拒绝
```

---

## 17. 接口统计汇总

| 维度 | 数量 |
|------|------|
| gRPC Services | 14 |
| LanguageServerService 方法 | 172 |
| ExtensionServerService 方法 | 50 |
| ApiServerService 方法 | 171 |
| SeatManagementService 方法 | 151 |
| CortexTrajectoryStep 工具类型 | 93 |
| CortexTrajectoryType | 19 |
| CortexTrajectorySource | 15 |
| CascadePlannerType | 8 |
| CascadeToolConfig 工具 | 30 |
| Hook 触发点 | 12 |
| Reactive 流端点 | 4 |
| AutoRunDecision 类型 | 9 |
| Proto 文件 | 61 |
| Proto Messages | 1736+ |
| Proto Enums | 226+ |
| Go Tool Converters | 64 |
| Go Cortex Sub-packages | 189 |
| Go Total Packages | 215 |
| Go Step Handlers | 40+ |
| Go Prompt Mixins | 16 |
| Code Retrievers | 11 |
| Vector Index Modes | 5 |
| Chat Intent Types | 12 |
| Context Change Events | 8 |
| Context Use Cases | 9 |
| Model Enum 总数 | 340+ |
| API Provider 总数 | 51 |
| ExperimentKey 总数 | 165+ |
| ContextScopeType 总数 | 31 |
| Deploy Provider | 3 (Vercel/Netlify/Cloudflare) |
| Browser 功能类 | 36 |
| Arena 功能类 | 68 |
| CodeMap 功能类 | 72 |
| Worktree 功能类 | 47 |
| LS Go 子模块 | 152 |
| Netlify SDK 函数 | 4257+ 引用 |
| ProductEventType | 230+ |
| Language 支持 | 93 |
| codeium_common.proto 行数 | 3859 |

---

## 18. Go Binary 内部架构 (215 Go Packages)

### 18.1 核心 Cortex 子包 (189个)

#### 18.1.1 Brain 系统 (动态任务管理)

```
exa/cortex/brain/
├── brain_manager      — Brain主管理器
├── brain_utils        — Brain工具函数
└── task_utils         — 任务状态处理
```

#### 18.1.2 执行器 (Executor, 8种)

```
exa/cortex/executors/
├── cascade_executor          — Cascade主执行器
├── cascade_wrapper           — Cascade包装器
├── execution_cascade_wrapper — 执行包装器
├── hooks                     — Hook执行器
├── parallel_executor         — 并行执行器 (多rollout)
├── reflection_steps          — 反思步骤
├── replay_executor           — 回放执行器 (eval)
├── revert_executor           — 回退执行器
└── subagent_executor         — 子代理执行器
```

#### 18.1.3 Step 处理器 (Handler, 40+种)

每种CortexStepType都有对应的Handler:

```
exa/cortex/handlers/
├── base_handler                    — 基础处理器
├── code_action_handler             — 代码编辑
├── run_command_handler             — 命令执行
├── view_file_handler               — 文件查看
├── grep_handler / grep_v2_handler  — 搜索
├── find_handler                    — 文件查找
├── list_dir_handler                — 目录列表
├── search_web_handler              — Web搜索
├── read_url_content_handler        — URL读取
├── memory_handler                  — 记忆操作
├── retrieve_memory_handler         — 记忆检索
├── mcp_handler                     — MCP工具
├── list_resources_handler          — MCP资源列表
├── read_resource_handler           — MCP资源读取
├── proxy_web_server_handler        — Web代理
├── deploy_web_app_handler          — Web部署
├── read_deployment_config_handler  — 部署配置
├── check_deploy_status_handler     — 部署状态
├── checkpoint_handler              — 检查点
├── notebook_handlers               — Notebook操作
├── read_terminal_handler           — 终端读取
├── command_status_handler          — 命令状态
├── brain_update_handler            — Brain更新
├── todo_list_handler               — 待办列表
├── ask_user_question_handler       — 向用户提问
├── exit_plan_mode_handler          — 退出Plan模式
├── trajectory_search_handler       — 轨迹搜索
├── smart_friend_handler            — SmartFriend
├── task_subagent_handler           — 任务子代理
├── report_bugs_handler             — Bug报告(Lifeguard)
├── find_all_references_handler     — 查找引用
├── find_code_context_handler       — 查找代码上下文
├── view_code_item_handler          — 查看代码项
├── view_content_chunk_handler      — 查看内容块
├── add_annotation_handler          — 添加注释
├── blocking_handler                — 阻塞等待
├── codemap_handler                 — CodeMap
├── cluster_query_handler           — 集群查询
├── inspect_cluster_handler         — 检查集群
├── compile_handler                 — 编译
├── custom_tool_handler             — 自定义工具
├── file_breakdown_handler          — 文件分解
├── intent_handler                  — 意图分析
├── no_op_handler                   — 空操作
├── propose_code_handler            — 代码提案
├── post_pr_review_handler          — PR Review
├── related_files_handler           — 相关文件
├── resolve_task_handler            — 解决任务
├── semantic_codebase_search_handler — 语义搜索
├── supercomplete_feedback_handler  — 超级补全反馈
└── instant_context_agent           — 即时上下文代理
```

#### 18.1.4 Prompt 管理器 (Manager, 16种Mixin)

```
exa/cortex/managers/
├── base_mixin                      — 基础Mixin
├── cascade_agent_mixin             — Agent模式
├── cascade_codemap_mixin           — CodeMap模式
├── cascade_conversational_mixin    — 对话模式
├── cascade_lifeguard_mixin         — Lifeguard模式
├── cascade_pr_review_mixin         — PR Review模式
├── cascade_smart_lint_mixin        — SmartLint模式
├── passive_planner_mixin           — 被动模式
├── retrieve_memory_mixin           — 记忆检索Mixin
├── single_entry_updater_mixin      — 单条更新Mixin
├── task_subagent_mixin             — 子代理Mixin
├── trajectory_judge_subagent_mixin — 评判子代理Mixin
│
├── prompt_builder                  — Prompt构建器
├── tool_converter_factory          — 工具转换器工厂
├── tool_profiles                   — 工具配置文件
├── planner_generator               — 规划器生成器
├── judge_converter                 — 评判转换器
├── image_captioner                 — 图片描述器
├── ephemeral                       — 临时消息管理
├── no_tool_context                 — 无工具上下文
│
├── conversational_prompt_sections  — 对话prompt分区
├── codemap_prompt_sections         — CodeMap prompt分区
├── passive_prompt_sections         — 被动prompt分区
├── lifeguard_prompt_sections       — Lifeguard prompt分区
├── lifeguard_v2_prompt_sections    — Lifeguard v2 prompt分区
├── lifeguard_string_converters     — Lifeguard字符串转换
└── step_string_converters          — 步骤字符串转换
```

#### 18.1.5 工具转换器 (64种 ToolConverter)

```go
// 从Go binary提取的完整工具转换器列表:
AddAnnotationToolConverter          FindCodeContextToolConverter
ApplyPatchToolConverter             FindReferencesToolConverter
AskUserQuestionToolConverter        FindToolConverter
AutoCascadeBroadcastToolConverter   FinishToolConverter
BashToolConverter                   FixBugsToolConverter
CheckDeployStatusToolConverter      FreeformApplyPatchToolConverter
ClusterQueryToolConverter           GotoDefinitionToolConverter
CodebaseSearchToolConverter         Gpt5UpdatePlanToolConverter
CommandStatusToolConverter          GrepSearchToolConverter
CreateCodemapToolConverter          GrepSearchV2ToolConverter
DeployWebAppToolConverter           InspectClusterToolConverter
DiffSearchReplaceToolConverter      ListClustersToolConverter
EditCodemapToolConverter            ListDirToolConverter
EditFileToolConverter               ListResourcesToolConverter
EditNotebookToolConverter           McpToolConverter
ExitPlanModeToolConverter           MemoryToolConverter
FindAllReferencesToolConverter      MultiReplaceFileContentToolConverter

NewMcpToolConverter                 RunCommandToolConverter
NewPostPrReviewToolConverter        SearchInFileToolConverter
OpenAIApplyPatchToolConverter       SearchWebToolConverter
PostPrReviewToolConverter           SingleReplaceFileContentToolConverter
ProxyWebServerToolConverter         SkillToolConverter
ReadDeploymentConfigToolConverter   SmartFriendToolConverter
ReadFileToolConverter               SuggestedResponsesToolConverter
ReadKnowledgeBaseItemToolConverter  TaskSubagentToolConverter
ReadNotebookToolConverter           TodoListToolConverter
ReadResourceToolConverter           TrajectorySearchToolConverter
ReadTerminalToolConverter           UpdatePlanToolConverter
ReadUrlContentToolConverter         ViewFileToolConverter
RelatedFilesToolConverter           WriteToFileToolConverter
ReplaceFileContentToolConverter
ReportBugsToolConverter
ResolveTaskToolConverter
```

**关键发现**:
- `ApplyPatchToolConverter` + `OpenAIApplyPatchToolConverter` + `FreeformApplyPatchToolConverter` — 3种 apply_patch 变体
- `DiffSearchReplaceToolConverter` — Cursor风格搜索替换
- `SingleReplaceFileContentToolConverter` + `MultiReplaceFileContentToolConverter` — 替换变体
- `BashToolConverter` — Bash工具 (独立于RunCommand)
- `Gpt5UpdatePlanToolConverter` — GPT-5 专用计划更新
- `GotoDefinitionToolConverter` — LSP定义跳转
- `CodebaseSearchToolConverter` — 代码库语义搜索

#### 18.1.6 MCP 子系统

```
exa/cortex/utils/mcp/
├── mcp_manager                — MCP管理器
├── mcp_server_client_instance — 服务器客户端实例
├── oauth                      — OAuth认证
├── policy                     — MCP策略控制
├── registry                   — 注册表管理
├── roots                      — Root资源管理
└── utils                      — MCP工具函数
```

#### 18.1.7 状态追踪 (State)

```
exa/cortex/state/
├── clipboard_tracker    — 剪贴板追踪
├── code_action          — 代码操作状态
├── editor_state_tracker — 编辑器状态追踪
├── file_view_tracker    — 文件查看追踪
├── lint_tracker         — Lint追踪
├── memory               — 记忆状态
├── options              — 选项管理
└── user_grep_tracker    — 用户搜索追踪
```

#### 18.1.8 模型配置线束 (Harness)

```
exa/cortex/config/
├── anthropic_harnesses   — Claude系列模型配置
├── cognition_harnesses   — Cognition内部模型配置
├── google_harnesses      — Gemini系列模型配置
├── openai_harnesses      — GPT系列模型配置
├── harness_map           — 线束映射表
├── model_defaults        — 模型默认参数
├── defaults              — 全局默认值
├── experiments           — 实验配置
└── utils                 — 配置工具
```

### 18.2 Language Server 核心子包

```
exa/language_server/
├── api_server_client/client_manager  — API服务器客户端管理
├── chat                              — 聊天处理
├── chat_client_server_client         — Chat面板客户端
├── code_tracker                      — 代码追踪
├── commit_graph                      — 提交图谱
├── commit_messages                   — 提交消息生成
├── completion_provider               — 补全提供器
├── completion_store                  — 补全存储
├── completion_type/multiline_model   — 多行补全模型
├── completion_utils                  — 补全工具
├── completions_state                 — 补全状态
├── context_module/                   — 上下文模块 (7子包)
│   ├── change_event                  — 变更事件
│   ├── context_index                 — 上下文索引
│   ├── context_module_guideline      — 指导方针
│   ├── context_provider              — 上下文提供器
│   ├── data_scopes                   — 数据作用域
│   ├── interfaces                    — 接口定义
│   ├── llm                           — LLM集成
│   ├── relevance                     — 相关性评分
│   └── shared                        — 共享定义
├── cortex/                           — Cortex集成
│   ├── nodes                         — 节点系统
│   └── types                         — 类型定义
├── diff_action                       — Diff操作
├── directory_utils                   — 目录工具
├── documentindex/                    — 文档索引
│   ├── datastorage                   — 数据存储
│   └── indexdata                     — 索引数据
├── documentmanager                   — 文档管理器
├── edit_distance                     — 编辑距离
├── extension_server_client           — ExtensionServer客户端
├── git_log_utils                     — Git日志工具
├── indexed_repos_cache               — 索引仓库缓存
├── interceptor                       — 拦截器
├── interfaces                        — 接口
├── language_server_defaults          — 默认配置
├── language_utils                    — 语言工具
├── ls_unleash                        — Unleash集成
├── lsp                               — LSP协议
├── metadata_provider                 — 元数据提供器
├── mquery/prompt                     — MQuery Prompt
├── native_storage_migrations         — NativeStorage迁移
├── onboarding                        — 引导
├── other_docs                        — 其他文档
├── performance                       — 性能监控
├── pipe_watcher                      — 管道监视器
├── prompt                            — Prompt管理
├── session                           — 会话管理
├── state                             — 状态管理
├── streaming                         — 流式处理
├── supercomplete                     — 超级补全
├── tab                               — Tab补全
├── types/                            — 类型
│   ├── completion_types              — 补全类型
│   └── doc_pos_types                 — 文档位置类型
├── user_settings                     — 用户设置
├── user_status                       — 用户状态
└── vibe_and_replace                  — Vibe And Replace
```

---

## 19. apply_patch 系统 (代码编辑核心)

### 19.1 三种 apply_patch 变体

| 变体 | 用途 |
|------|------|
| `ApplyPatchToolConverter` | 标准apply_patch |
| `OpenAIApplyPatchToolConverter` | OpenAI格式的apply_patch |
| `FreeformApplyPatchToolConverter` | 自由格式apply_patch |

### 19.2 嵌入在Binary中的apply_patch约束

```
- Only one file per apply_patch call. Use separate calls for each file.
- NEVER add copyright or license headers unless specifically requested.
- NEVER use destructive commands like `git reset --hard` unless approved.
- Don't rerun the same broad query without changing wording or scope.
- Don't use `grep_search` to answer conceptual "how/where" questions.
- Don't use apply_patch for auto-generated changes or mass search-replace.
- Ask before destructive actions, elevated permissions, or network access.
- Don't cram unrelated keywords into a single bullet; split for clarity.
```

### 19.3 FastApply 系统

```protobuf
message FastApplyFallbackConfig {
  bool enabled = 1;
  uint32 prompt_unchanged_threshold = 2;
  uint32 content_view_radius_lines = 3;
  uint32 content_edit_radius_lines = 4;
}

message ReplaceContentToolConfig {
  float max_fuzzy_edit_distance_fraction = 1;  // 模糊匹配距离
  bool allow_partial_replacement_success = 2;
  uint32 view_file_recency_max_distance = 3;
  bool enable_fuzzy_sandwich_match = 4;         // 模糊夹心匹配!
  FastApplyFallbackConfig fast_apply_fallback_config = 5;
  ReplaceToolVariant tool_variant = 6;
  SectionOverrideConfig override_description = 7;
}
```

**关键**: `fuzzy_sandwich_match` — 当精确匹配失败时, 使用"三明治"策略(匹配前后上下文)来定位替换位置。

---

## 20. Context Module (上下文引擎)

### 20.1 上下文变更事件 (8种)

```
ACTIVE_DOCUMENT(1)         — 活动文档变更
CURSOR_POSITION(2)         — 光标位置变更
CHAT_MESSAGE_RECEIVED(3)   — 收到聊天消息
OPEN_DOCUMENTS(4)          — 打开文档变更
ORACLE_ITEMS(5)            — Oracle项变更
PINNED_CONTEXT(6)          — 固定上下文变更
PINNED_GUIDELINE(7)        — 固定指导变更
ACTIVE_NODE(9)             — 活动节点变更
```

### 20.2 上下文使用场景 (9种)

```
AUTOCOMPLETE(1)            — 自动补全
CHAT(2)                    — 聊天
CHAT_COMPLETION(3)         — 聊天补全
CORTEX_RESEARCH(4)         — Cortex研究
EVAL(5)                    — 评估
CHAT_COMPLETION_GENERATE(6) — 聊天补全生成
SUPERCOMPLETE(7)           — 超级补全
FAST_APPLY(8)              — 快速应用
COMMAND_TERMINAL(9)        — 终端命令
```

### 20.3 CumulativePromptConfig (Prompt 预算分配)

```protobuf
message CumulativePromptConfig {
  float persistent_context_multiplier = 7;         // 持久上下文预算乘数
  float persistent_active_document_multiplier = 10; // 活动文档预算乘数
  float persistent_open_docs_multiplier = 11;       // 打开文档预算乘数
  int64 persistent_max_tokens_per_open_doc = 17;
  int64 persistent_max_ccis_considered = 12;        // 最大CCI考虑数
  float persistent_document_suffix_frac = 20;
  float trajectory_context_multiplier = 2;          // 轨迹上下文预算
  float trajectory_refresh_threshold_multiplier = 15;
  float trajectory_truncation_multiplier = 16;
  float ephemeral_context_multiplier = 9;           // 临时上下文预算
  int64 intent_reservation_tokens = 6;              // 意图保留token数
  float ephemeral_active_document_multiplier = 13;
  int64 ephemeral_max_ccis_considered = 14;
  float ephemeral_document_suffix_frac = 21;
  repeated CortexStepType allowed_cascade_step_types = 18;
  map<string, bool> allowed_implicit_step_types = 22;
}
```

**三层上下文预算**: persistent (持久) + trajectory (轨迹) + ephemeral (临时)

### 20.4 代码检索器 (11种)

```
CONTEXT_MODULE_LOCAL(1)           — 本地上下文模块
CONTEXT_MODULE_SEARCH(2)          — 搜索上下文模块
SEARCH(3)                         — 通用搜索
MQUERY_OPENAI(4)                  — MQuery OpenAI
MQUERY_CODEIUM(5)                 — MQuery Codeium
CONTEXT_MODULE_SEARCH_MQUERY(6)   — 混合搜索
COMMIT_GRAPH(7)                   — 提交图谱检索
MORPH_NORMAL(8)                   — Morph普通
MORPH_ADVANCED(9)                 — Morph高级
GRAPH_CLUSTERS(10)                — 图集群
OPENSEARCH(11)                    — OpenSearch
```

### 20.5 向量索引模式 (5种)

```
HALFVEC(1)           — 半精度向量
BINARY(2)            — 二值化
BINARY_WITH_RERANK(3) — 二值化+重排
BRUTE_FORCE(4)        — 暴力搜索
RANDOM_SEARCH(5)      — 随机搜索
```

---

## 21. Chat 系统 (对话引擎)

### 21.1 ChatMessagePrompt (发送到API的消息)

```protobuf
message ChatMessagePrompt {
  string message_id = 1;
  ChatMessageSource source = 2;      // USER/SYSTEM/ASSISTANT/TOOL
  string prompt = 3;                  // 消息内容
  uint32 num_tokens = 4;
  bool safe_for_code_telemetry = 5;
  repeated ChatToolCall tool_calls = 6;
  string tool_call_id = 7;
  PromptCacheOptions prompt_cache_options = 8; // ephemeral缓存
  bool tool_result_is_error = 9;
  repeated ImageData images = 10;       // 图片
  string thinking = 11;                 // 思考过程 (Claude)
  string signature = 12;               // 签名
  bool thinking_redacted = 13;         // 思考已编辑
  repeated PromptAnnotationRange prompt_annotation_ranges = 14;
  string output_id = 15;
  string thinking_id = 16;
  bytes gemini_thought_signature = 17;  // Gemini思考签名
  string signature_type = 18;
  string phase = 19;                    // 阶段
}
```

### 21.2 ChatToolDefinition (工具定义)

```protobuf
message ChatToolDefinition {
  string name = 1;
  string description = 2;
  string json_schema_string = 3;        // JSON Schema
  bool strict = 4;
  repeated string attribution_field_names = 5;
  string server_name = 6;              // MCP服务器名
  optional bool read_only_hint = 7;
  optional ComputerUseToolConfig computer_use_config = 8; // Computer Use!
  optional bool is_custom_tool = 9;
  optional string custom_tool_grammar = 10;
  optional string custom_tool_grammar_syntax = 11;
}
```

**发现**: `ComputerUseToolConfig` — 支持 Anthropic Computer Use API!

### 21.3 12种 Chat Intent

```
GENERIC(1)              — 通用
FUNCTION_EXPLAIN(2)     — 函数解释
FUNCTION_DOCSTRING(3)   — 函数文档
FUNCTION_REFACTOR(4)    — 函数重构
CODE_BLOCK_EXPLAIN(5)   — 代码块解释
CODE_BLOCK_REFACTOR(6)  — 代码块重构
FUNCTION_UNIT_TESTS(7)  — 单元测试
PROBLEM_EXPLAIN(8)      — 问题解释
GENERATE_CODE(9)        — 生成代码
CLASS_EXPLAIN(10)       — 类解释
SEARCH(11)              — 搜索
FAST_APPLY(12)          — 快速应用
```

### 21.4 DeepWiki 系统

```protobuf
message GetDeepWikiRequest {
  Metadata metadata = 1;
  DeepWikiRequestType request_type = 2; // SUMMARY(1), ARTICLE(2)
  string symbol_name = 3;
  string symbol_uri = 4;
  string context = 5;
  DeepWikiSymbolType symbol_type = 6;  // 26种符号类型
  string language = 7;
}

// DeepWiki上下文包括:
// - symbol_context: 符号+引用+调用链
// - hover_context: hover信息
// - function_call_info: 函数调用签名
// - quick_grep_context: 快速grep结果
```

---

## 22. Diff 系统 (代码变更表示)

### 22.1 三种 Diff 类型

| 类型 | 用途 |
|------|------|
| `UnifiedDiff` | 行级统一diff (INSERT/DELETE/UNCHANGED) |
| `CharacterDiff` | 字符级diff |
| `ComboDiff` | 组合diff (行级+字符级) |

```protobuf
message DiffBlock {
  int32 start_line = 1;
  int32 end_line = 2;
  UnifiedDiff unified_diff = 3;
  Language from_language = 4;   // 支持跨语言diff!
  Language to_language = 5;
}
```

---

## 23. 索引系统 (Code Index)

### 23.1 IndexManagementService (18个方法)

远程代码索引管理:

| 方法 | 功能 |
|------|------|
| `AddRepository` | 添加仓库 |
| `DeleteRepository` | 删除仓库 |
| `GetRepositories` | 获取仓库列表 |
| `AddIndex` | 添加索引 |
| `DeleteIndex` | 删除索引 |
| `GetIndexes` | 获取索引列表 |
| `CancelIndexing` / `RetryIndexing` | 取消/重试索引 |
| `PruneDatabase` | 清理数据库 |
| `GetDatabaseStats` | 数据库统计 |

### 23.2 IndexService (4个方法)

| 方法 | 功能 |
|------|------|
| `GetIndexedRepositories` | 获取已索引仓库 |
| `GetNearestCCIsFromEmbedding` | 向量最近邻搜索 |
| `GetEmbeddingsForCodeContextItems` | 代码项嵌入 |
| `GetMatchingFilePaths` | 文件路径匹配 |

### 23.3 本地索引引擎

```
exa/language_server/documentindex/
├── datastorage   — 数据存储层
└── indexdata      — 索引数据

exa/language_server/context_module/
├── context_index     — 上下文索引 (term frequency, CCI tracking)
├── context_provider  — 上下文提供器
├── relevance         — 相关性评分
└── data_scopes       — 数据作用域

统计:
- cci_per_source_bytes    — 每来源CCI字节数
- term_frequency_map_bytes — 词频映射字节数
- num_ccis_tracked        — 追踪的CCI数量
- num_terms_tracked       — 追踪的词条数量
- num_files_tracked       — 追踪的文件数量
```

---

## 24. Deploy / Windsurf.build 系统

### 24.1 部署提供商

```protobuf
enum DeploymentProvider {
  DEPLOYMENT_PROVIDER_UNSPECIFIED = 0;
  DEPLOYMENT_PROVIDER_VERCEL = 1;
  DEPLOYMENT_PROVIDER_NETLIFY = 2;    // 主要使用 (4257+ SDK引用)
  DEPLOYMENT_PROVIDER_CLOUDFLARE = 3;
}

enum DeploymentBuildStatus {
  QUEUED = 1;
  INITIALIZING = 2;
  BUILDING = 3;
  ERROR = 4;
  READY = 5;
  CANCELED = 6;
}

enum ValidationStatus {
  AVAILABLE = 1;    // 子域名可用
  IN_USE = 2;       // 已在使用
  TAKEN = 3;        // 已被占用
  INVALID = 4;      // 无效
}
```

### 24.2 WindsurfProject 与 WindsurfDeployment

```protobuf
message WindsurfProject {
  string windsurf_project_id = 1;
  string auth_uid = 2;
  DeploymentProvider deployment_provider = 3;
  string provider_project_id = 4;     // Netlify 侧项目ID
  string project_name = 5;
  Timestamp created_at = 6;
  Timestamp updated_at = 7;
  string domain = 8;                  // windsurf.build 域名
  string subdomain_name = 9;
  Timestamp expires_at = 10;          // 过期时间
  Timestamp claimed_at = 11;          // 用户认领时间
  Timestamp deprovisioned_at = 12;    // 取消配置时间
  string provider_team_id = 14;
  string project_url = 13;
}

message WindsurfDeployment {
  string windsurf_deployment_id = 1;
  DeploymentProvider deployment_provider = 3;
  string provider_deployment_id = 14;
  string windsurf_project_id = 19;
  string workspace_path = 6;          // 本地工作区路径
  string deployment_url = 12;         // 部署URL
  string build_status_url = 9;
  Timestamp expires_at = 11;
  Timestamp claimed_at = 15;
}
```

### 24.3 部署文件上传状态

```
DEPLOY_WEB_APP_FILE_UPLOAD_STATUS_UNSPECIFIED
DEPLOY_WEB_APP_FILE_UPLOAD_STATUS_PENDING
DEPLOY_WEB_APP_FILE_UPLOAD_STATUS_IN_PROGRESS
DEPLOY_WEB_APP_FILE_UPLOAD_STATUS_SUCCESS
DEPLOY_WEB_APP_FILE_UPLOAD_STATUS_FAILURE
```

### 24.4 部署配置

```protobuf
message WebAppDeploymentConfig {
  string project_id = 1;              // 现有项目复用
  string framework = 2;               // 框架标识
}

message DeployTarget {
  DeploymentProvider deployment_provider = 1;
  bool is_sandbox = 2;                // 沙箱模式
  string provider_team_id = 3;
  string provider_team_slug = 4;
  string domain = 5;                  // windsurf.build
}
```

### 24.5 Sandbox 沙箱系统

```protobuf
enum SandboxEnforcementMode {
  OPTIONAL = 1;     // 可选
  REQUIRED = 2;     // 强制
}

// TeamConfig 中控制
bool allow_app_deployments = 10;
bool allow_sandbox_app_deployments = 19;
bool allow_teams_app_deployments = 20;
int32 max_unclaimed_sites = 9;         // 最大未认领站点数
int32 max_new_sites_per_day = 11;      // 每日新建上限
repeated string sandbox_allowed_domains = 56;
repeated string sandbox_denied_domains = 57;
```

### 24.6 Netlify SDK 集成

二进制中包含完整的 Netlify Go SDK，引用量 4257+，包含：
- `plumbing.Netlify` — 核心客户端
- `porcelain.Netlify` — 高层封装
- 88个 Deploy 相关类（DeployFile, DeployKey, DeployHook, DeployLive 等）
- `GetNetlifyUserId`, `GetNetlifyAuthData` — Netlify 账号关联
- `CreateWindsurfJSAppResponse`, `DeleteWindsurfJSAppResponse` — 项目管理
- `RollbackSiteDeploy`, `UpdateSiteBuildLog`, `UpdateSiteMetadata` — 部署操作

### 24.7 遥测事件

```
WS_APP_DEPLOYMENT_CREATE_PROJECT = 80
WS_APP_DEPLOYMENT_DEPLOY_PROJECT = 81
TEAM_CONFIG_TOGGLE_APP_DEPLOYMENTS = 164
TEAM_CONFIG_TOGGLE_SANDBOX_APP_DEPLOYMENTS = 165
TEAM_CONFIG_TOGGLE_TEAMS_APP_DEPLOYMENTS = 166
```

---

## 25. Browser Preview 系统

### 25.1 BrowserPreviewService (3 RPCs)

```protobuf
service BrowserPreviewService {
  rpc SendDOMElement(SendDOMElementRequest) returns (SendDOMElementResponse);
  rpc SendScreenshot(SendScreenshotRequest) returns (SendScreenshotResponse);
  rpc SendConsoleOutput(SendConsoleOutputRequest) returns (SendConsoleOutputResponse);
}
```

### 25.2 浏览器安装管理

```protobuf
enum BrowserInstallationStatus {
  NOT_INSTALLED = 1;
  IN_PROGRESS = 2;
  COMPLETE = 3;
  ERROR = 4;
}
```

二进制日志：
- `Failed to remove Playwright cache directory: %v`
- `Successfully removed Playwright cache directory: %s`
- `Successfully removed Windsurf browser directory: %s`
- 使用 `ms-playwright` 路径前缀

### 25.3 浏览器交互消息

```protobuf
message BrowserPageMetadata {
  string url = 1;
  string page_id = 2;
  string page_title = 3;
  uint32 viewport_width = 4;
  uint32 viewport_height = 5;
  string favicon_url = 6;
  Timestamp last_visited_time = 7;
}

message BrowserClickInteraction {
  uint32 viewport_scroll_x/y = 1,2;
  uint32 click_x/y = 3,4;
  string target_element_tag_name = 5;
  string target_element_x_path = 6;
}

message BrowserScrollInteraction {
  uint32 viewport_scroll_x/y = 1,2;
}
```

### 25.4 浏览器上下文作用域

5种 Browser 相关 ContextScopeItem:

| ScopeItem | 描述 |
|-----------|------|
| `BrowserPageScopeItem` | 整页可见文本 (url, title, visible_text_content, page_id) |
| `BrowserCodeBlockScopeItem` | 代码块 (url, code_content, language, context_text) |
| `BrowserTextScopeItem` | 选取文本 (url, visible_text) |
| `ConsoleLogScopeItem` | 控制台日志 (lines[], server_address) |
| `DOMElementScopeItem` | DOM元素 (tag_name, outer_html, react_component_name, file_line_range) |

### 25.5 DOM 树模型

```protobuf
message DOMTree {
  message DOMNode {
    repeated DOMNode children = 1;
    string tag_name = 2;
    string id = 3;
    repeated string class_names = 4;
    string text_content = 5;
    BoundingBox bbox = 6;
    string aria_label = 7;
    string title = 8;
    string alt = 9;
    string placeholder = 10;
    string href = 11;
  }
  DOMNode root = 1;
  uint32 num_nodes = 2;
}
```

### 25.6 遥测事件

```
BROWSER_OPEN = 180
CASCADE_WEB_TOOLS_OPEN_BROWSER_MARKDOWN = 181
BROWSER_PAGE_LOAD_SUCCESS = 206
BROWSER_TOOLBAR_INSERT_PAGE_MENTION = 208
BROWSER_INSERT_TEXT_CONTENT = 215
BROWSER_INSERT_SCREENSHOT = 216
BROWSER_INSERT_CODE_BLOCK = 217
BROWSER_INSERT_LOG_BLOCK = 218
BROWSER_INSERT_CONSOLE_OUTPUT = 219
BROWSER_INSERT_DOM_ELEMENT = 220
```

---

## 26. Arena / Model Router 系统

### 26.1 Arena 架构

Arena 是 Windsurf 的模型对战/评估系统，允许同一请求同时发送到多个模型并比较结果。

```protobuf
enum ArenaTier {
  ARENA_TIER_UNSPECIFIED = 0;
  ARENA_TIER_FAST = 1;     // 快速模型
  ARENA_TIER_SMART = 2;    // 智能模型
}

enum DisplayOption {
  DISPLAY_OPTION_UNSPECIFIED = 0;
  DISPLAY_OPTION_ARENA = 1;              // Arena 对战显示
  DISPLAY_OPTION_BATTLE_GROUP_ONLY = 2;  // 仅对战组
  DISPLAY_OPTION_MODEL_ROUTER = 3;       // 模型路由显示
  DISPLAY_OPTION_QUICK_REVIEW = 4;       // 快速审查
}
```

### 26.2 Arena 核心消息

```protobuf
// LS RPC: SpawnArenaCascades / ConvergeArenaCascades
message SpawnArenaCascadesRequest {
  Metadata metadata = ...;
  string arena_id = ...;
  repeated string cascade_ids = ...;
  ArenaTier arena_tier = ...;
  string model_router_uid = ...;
}

message ArenaConvergeTelemetry {
  int32 arena_converge_count = ...;   // 收敛计数
  string arena_assignment_jwt = ...;  // Arena 分配JWT
  string model_assignment_jwt = ...;  // 模型分配JWT
  string converged_arena_jwt = ...;   // 收敛后JWT
}
```

### 26.3 Model Router

Model Router 是动态模型选择机制，根据配置路由请求到最优模型：

```protobuf
message ModelInfo {
  ...
  bool is_model_router = 25;       // 是否为路由模型
  string model_family_uid = 23;    // 模型族标识
  InferenceConfig inference_config = 24;
  repeated string harness_uids = 20; // 关联的Harness
  ArenaConfig arena_config = 21;
}

message ApiProviderRoutingConfig {
  map<string, ApiProviderConfigMap> model_map = 1;
}

message ApiProviderConfig {
  uint32 weight = 1;               // 路由权重
  uint32 cache_ttl_minutes = 2;    // 缓存TTL
  string model_name = 3;
}

message ShadowTrafficConfig {
  map<string, ShadowTargetList> model_map = 1;
}

message ShadowTarget {
  string provider = 1;
  string model = 2;
  double sample_rate = 4;          // 影子流量采样率
}
```

### 26.4 Arena 计费

```protobuf
message CascadeModelConfigData {
  ...
  float arena_mode_cost_fast = 4;     // Fast 模式开销
  float arena_mode_cost_smart = 5;    // Smart 模式开销
}

// UserSettings 中
optional bool last_arena_mode_enabled = 95;
repeated string last_specific_arena_model_uids = 93;
bool arena_always_open_fullscreen = 94;
```

### 26.5 推理配置 (Inference Config)

支持不同提供商的专属推理选项：

```protobuf
message OpenAIInferenceConfig {
  string reasoning_effort = 1;              // "low"/"medium"/"high"
  string service_tier = 2;                  // "default"/"flex"/"scale"
  bool extended_prompt_cache_retention = 3;
}

message GoogleInferenceConfig {
  string reasoning_effort = 1;
}

message AnthropicInferenceConfig {
  bool thinking = 1;           // 开启思考模式
  string effort = 2;           // 思考深度
  bool fast_mode = 3;          // 快速模式
  bool context_1m = 4;         // 1M上下文窗口
}
```

### 26.6 68 Arena 相关类/函数

```
ArenaConfig, ArenaConvergeCount, ArenaConvergeTelemetry,
ArenaCascades, ArenaCascadesRequest/Response,
ArenaCapReached, ArenaInvocationCapReached,
ArenaMode, ArenaModeEnabled, ArenaModeInfo,
ArenaModeCostFast, ArenaModeCostSmart,
ArenaModeMidConversation,
ArenaFromExisting, ArenaAgentNames,
ArenaAssignmentJwt, ArenaAlwaysOpenFullscreen,
... 等 68 个
```

---

## 27. CodeMap 系统

### 27.1 概述

CodeMap 是代码库结构化地图系统，用于为 AI 提供高层次代码理解。

### 27.2 专用模型

```
MODEL_CODEMAP_SMALL   // 小型码图模型
MODEL_CODEMAP_MEDIUM  // 中型码图模型
MODEL_CODEMAP_SMART   // 智能码图模型
```

### 27.3 CodeMap Proto

```protobuf
message CodeMapScopeItem {
  string title = 1;
  string content = 2;
  string description = 3;
  optional string location = 4;
}
```

### 27.4 CodeMap 生命周期

从二进制提取的 72 个 CodeMap 类揭示了完整生命周期：

| 阶段 | 类/函数 |
|------|---------|
| **创建** | CodeMapFromFile, CodeMapFromJson, CodeMapFromTrajectory, CodeMapFromIndexEntry |
| **生成** | CodeMapGenerator, CodeMapGeneratorInterface, CodeMapGeneration, CodeMapGenerationStarted, CodeMapGenerationCompleted |
| **编辑** | CodeMapEdit, CodeMapEditsFromTrajectory |
| **索引** | CodeMapIndex, CodeMapIndexEntry, CodeMapInIndex, CodeMapMetadataInIndex |
| **存储** | CodeMapData, CodeMapJson, CodeMapJsonContent, CodeMapMetadata, CodeMapMetadataForSaving |
| **管理** | CodeMapManager, CodeMapMapIter, CodeMapById, CodeMapByRepo |
| **状态** | CodeMapArchived, CodeMapDownloaded, CodeMapFavorited, CodeMapFailed, CodeMapEncountered |
| **共享** | CodeMapCheck (由 TeamConfig.allow_codemap_sharing 控制) |

### 27.5 LS RPC 方法

```
GenerateCodeMap          — 从代码库生成码图
BranchCodeMap            — 基于分支的码图
GetCodeMapIndex          — 获取码图索引
ShareCodeMapByVersion    — 版本化共享
DismissCodeMapSuggestion — 忽略建议
```

### 27.6 TeamConfig 控制

```protobuf
bool disable_codemaps = 31;                  // 禁用码图
string allow_codemap_sharing = 32;           // 允许共享
```

---

## 28. Worktree 管理系统

### 28.1 概述

Worktree 是 Git worktree 的扩展管理系统，为 Cascade 的并行编辑和分支操作提供隔离环境。

### 28.2 LS RPC 方法

```
CreateWorktree               — 创建 worktree
ResolveWorktreeChanges       — 解析 worktree 变更 (merge/stash)
MountCascadeFilesystem       — 挂载 Cascade 文件系统
UnmountCascadeFilesystem     — 卸载 Cascade 文件系统
```

### 28.3 Worktree 消息

```protobuf
// WorktreeChangesMode: 如何处理 worktree 变更
message WorktreeChangesRequest { ... }
message WorktreeChangesResponse { ... }

// Worktree 合并
message WorktreeMergeRequest { ... }
message WorktreeMergeResponse { ... }
message WorktreeMergeSnapshot { ... }

// Worktree 信息
message WorktreeInfo { ... }
```

### 28.4 47 个 Worktree 类

```
WorktreeManager          — 管理器
WorktreeClient           — 客户端
WorktreeCreation         — 创建操作
WorktreeBranch/Branches  — 分支管理
WorktreeChanges/Mode     — 变更处理
WorktreeMerge/Snapshot   — 合并与快照
WorktreeHook/Done/Waiter — 钩子系统
WorktreeFileConflict     — 文件冲突
WorktreeFileToParent     — 父级文件关系
WorktreeFileWithMerge    — 合并后文件
WorktreeFileWithStash    — 暂存文件
WorktreeContents         — 内容
WorktreePathForFile      — 文件路径
WorktreePathsInStep      — 步骤中的路径
WorktreeLocalPath        — 本地路径
```

### 28.5 关键日志

```
"Failed to enforce max worktrees limit for repo %s: %v"
"Failed to delete worktree at %s for trajectory %s: %v"
"Successfully deleted worktree at %s for trajectory %s"
"ResolveWorktreeChanges: stash failed for %s: %v"
"ResolveWorktreeChanges: merge failed for %s: %v"
```

---

## 29. Forge / CLI 系统

### 29.1 Forge Access

Forge 是 Windsurf 的高级功能门控，由 PlanInfo 控制：

```protobuf
message PlanInfo {
  ...
  bool has_forge_access = 5;            // Forge 权限
  bool has_tab_to_jump = 23;            // Tab跳转权限
  bool has_autocomplete_fast_mode = 3;  // 快速自动补全
  bool allow_sticky_premium_models = 4; // 粘性高级模型
  bool browser_enabled = 31;            // 浏览器启用
  bool knowledge_base_enabled = 27;     // 知识库启用
  bool cascade_web_search_enabled = 19; // Web搜索
  bool cascade_can_auto_run_commands = 22;
  bool can_generate_commit_messages = 25;
  bool can_share_conversations = 28;
  bool can_allow_cascade_in_background = 29;
}
```

### 29.2 CLI 模型管理

```protobuf
// TeamOrganizationalControls 中
repeated string cli_model_labels = 9;
repeated string cli_model_uids = 13;

// PlanInfo 中
bool allow_premium_command_models = 15;
```

CLI 权限粒度控制：
```protobuf
// TeamConfig 中
repeated string cli_permissions_allow = 41;
repeated string cli_permissions_deny = 42;
repeated string cli_permissions_ask = 43;
bool cli_default_disabled = 50;
```

### 29.3 CLI Access Override

```protobuf
enum CliAccessOverride {
  CLI_ACCESS_OVERRIDE_UNSPECIFIED = 0;
  CLI_ACCESS_OVERRIDE_ENABLED = 1;
  CLI_ACCESS_OVERRIDE_DISABLED = 2;
}
```

### 29.4 Devin CLI 集成

```protobuf
// TeamConfig 中
bool allow_bundling_devin_cli = 47;
bool devin_terminal_acp_enabled = 58;
bool devin_cloud_acp_enabled = 59;

message DevinPlanInfo {
  bool can_use_cascade = 1;
  bool can_use_cli = 2;
  bool is_admin = 3;
  string org_id = 4;
  string webapp_host = 5;
  optional bool devin_review_enabled = 6;
}
```

---

## 30. Vibe and Replace 系统

### 30.1 概述

Vibe and Replace 是全文件/全项目级别的 AI 重写功能，支持流式差异和编辑。

### 30.2 二进制引用

- `vibe_and_replace` 包: 53 引用
- `VibeAndReplace` 类: 285 引用
- 核心函数: `CancelVibeAndReplace`, `cancelVibeAndReplace`, `GetIsVibeAndReplace`, `GetVibeAndReplaceData`

### 30.3 工具转换器

```
vibe_and_replace.vibeEditArgs          — 编辑参数
vibe_and_replace.VibeSkipArgs          — 跳过参数  
vibe_and_replace.VibeEditContentArgs   — 编辑内容参数
vibe_and_replace.VibeEditToolConverter — 工具转换器
```

### 30.4 LS RPC

```
VibeAndReplaceStream    — 流式 Vibe and Replace
```

### 30.5 权限控制

```protobuf
// TeamConfig 中
bool allow_vibe_and_replace = 27;
```

---

## 31. Instant Context Agent 系统

### 31.1 概述

Instant Context 是 Windsurf 的快速上下文代理，有专用模型。

### 31.2 专用模型

```
MODEL_COGNITION_INSTANT_CONTEXT  // 即时上下文模型
```

### 31.3 用户设置

```protobuf
// UserSettings 中
bool enable_instant_context_agent = 77;
bool disable_instant_context_agent = 78;
```

### 31.4 二进制引用

- `InstantContext`: 118 引用
- `InstantContextMetadata` — 元数据
- `applyInstantContextReminder` — 上下文提醒

---

## 32. codeium_common.proto 核心类型总结 (3859行)

### 32.1 文件概览

`codeium_common.proto` 是所有 Windsurf 子系统共享的核心类型定义文件，包含：
- **51 枚举** (enum) 定义
- **110+ 消息** (message) 定义
- 跨越认证、计费、模型管理、上下文、部署、遥测等所有领域

### 32.2 核心枚举分类

| 领域 | 枚举名 | 值数量 | 说明 |
|------|--------|--------|------|
| **模型** | Model | 340+ | 所有 AI 模型标识符 |
| **模型** | ModelAlias | 10+ | 模型别名 (CASCADE_BASE, VISTA, SHAMU, SWE_1) |
| **模型** | ModelProvider | 10+ | 提供商 (OpenAI, Anthropic, Google...) |
| **模型** | APIProvider | 51 | API提供商 |
| **模型** | ModelType | 5 | EMBED, CHAT, TAB, QUERY, PREMIUM |
| **模型** | ModelCostTier | 4 | UNSPECIFIED, LOW, MEDIUM, HIGH |
| **模型** | ModelStatus | 3 | OK, DEGRADED, DOWN |
| **模型** | DisplayOption | 5 | ARENA, BATTLE_GROUP, ROUTER, QUICK_REVIEW |
| **提示** | PromptElementKind | 20+ | 提示元素类型 |
| **提示** | PromptElementExclusionReason | 5+ | 排除原因 |
| **提示** | PromptTemplaterType | 7 | LLAMA_2/3, CHATML, DEEPSEEK_V2/V3, KIMI |
| **提示** | ToolFormatterType | 7 | LLAMA_3, HERMES, XML, KIMI, QWENCODER, SUPERCOMPLETE |
| **功能** | ExperimentKey | 165+ | Feature Flag |
| **语言** | Language | 93 | 编程语言 |
| **遥测** | EventType | 230+ | 产品事件 |
| **部署** | DeploymentProvider | 3 | Vercel, Netlify, Cloudflare |
| **部署** | DeploymentBuildStatus | 6 | 构建状态 |
| **部署** | ValidationStatus | 4 | 域名验证 |
| **部署** | SandboxEnforcementMode | 2 | OPTIONAL, REQUIRED |
| **计费** | BillingStrategy | 3+ | 计费策略 |
| **计费** | ModelPricingType | 3+ | ACU_TOKEN 等 |
| **计费** | GracePeriodStatus | 3 | NONE, ACTIVE, EXPIRED |
| **计费** | TransactionStatus | 3+ | 交易状态 |
| **团队** | TeamsTier | 5+ | FREE, PRO, TEAMS, ENTERPRISE |
| **团队** | UserTeamStatus | 3+ | 团队状态 |
| **团队** | Permission | 5+ | 权限 |
| **安全** | AuthSource | 5+ | Codeium, Deepnote, Codesandbox |
| **补全** | StopReason | 5+ | 停止原因 |
| **补全** | FilterReason | 10+ | 过滤原因 |
| **补全** | CompletionSource/Type | 5+ | 来源/类型 |
| **上下文** | ContextScopeType | 31 | 上下文作用域类型 (见 25.4) |
| **上下文** | CodeContextType/Source | 5+ | 代码上下文 |
| **浏览器** | BrowserInstallationStatus | 4 | 安装状态 |
| **终端** | TerminalShellCommandSource | 2 | USER, CASCADE |
| **终端** | TerminalShellCommandStatus | 2 | RUNNING, COMPLETED |
| **自定义** | RefreshCustomizationType | 6 | RULE, WORKFLOW, MEMORY, SKILL, PLAN, MCP |
| **Web搜索** | ThirdPartyWebSearchProvider | 1 | OPENAI |
| **Web搜索** | ThirdPartyWebSearchModel | 3 | O3, GPT_4_1, O4_MINI |

### 32.3 核心消息分类

#### 认证与元数据

```protobuf
message Metadata {
  string ide_name/version/type = 1,7,28;
  string extension_name/version = 12,2;
  string api_key = 3;
  string session_id = 10;
  string user_id = 20;
  string user_jwt = 21;
  string device_fingerprint = 24;
  string plan_name = 26;
  string team_id = 32;
  string impersonate_tier = 29;      // 模拟层级(调试)
  string f = 31;                     // 未知字段
}
```

#### 用户状态与计费

```protobuf
message UserStatus {
  bool pro = 1;
  string name/email = 3,7;
  TeamsTier teams_tier = 10;
  PlanStatus plan_status = 13;
  bool has_fingerprint_set = 30;
  TeamConfig team_config = 32;
  CascadeModelConfigData cascade_model_config_data = 33;
  int64 user_used_prompt_credits = 28;
  int64 user_used_flow_credits = 29;
}

message PlanStatus {
  PlanInfo plan_info = 1;
  Timestamp plan_start/end = 2,3;
  int32 available_prompt/flow/flex_credits = 8,9,4;
  int32 used_prompt/flow_credits = 6,5;
  TopUpStatus top_up_status = 10;
  GracePeriodStatus grace_period_status = 12;
  int32 daily/weekly_quota_remaining_percent = 14,15;
  int64 overage_balance_micros = 16;
  int64 daily/weekly_quota_reset_at_unix = 17,18;
}
```

#### 补全系统

```protobuf
message CompletionsRequest {
  CompletionConfiguration configuration = 1;
  string prompt = 2;
  string context_prompt = 21;
  string uid = 25;
  repeated PromptElementRange prompt_element_ranges = 8;
  Model model = 10;
  Repository repository = 16;
}

message CompletionConfiguration {
  uint64 num_completions = 1;
  uint64 max_tokens = 2;
  double temperature = 5;
  double top_p = 8;
  repeated string stop_patterns = 9;
  string service_tier = 17;
}
```

#### 模型特性

```protobuf
message ModelFeatures {
  bool supports_images = 11;
  bool supports_tool_calls = 12;
  bool supports_parallel_tool_calls = 21;
  bool supports_thinking = 15;
  bool interleave_thinking = 24;
  bool preserve_thinking = 25;
  bool supports_cumulative_context = 13;
  bool supports_estimate_token_counter = 17;
  bool supports_rejection_context = 26;
  bool tab_route_to_modal = 23;
}
```

#### 模型用量统计

```protobuf
message ModelUsageStats {
  string model_uid = 9;
  string billing_model_uid = 10;
  string requested_model_uid = 11;
  uint64 input_tokens = 2;
  uint64 output_tokens = 3;
  uint64 cache_write_tokens = 4;
  uint64 cache_read_tokens = 5;
  APIProvider api_provider = 6;
}
```

#### 流式补全

```protobuf
message CompletionDelta {
  string delta_text = 1;
  uint32 delta_tokens = 2;
  StopReason stop_reason = 3;
  ModelUsageStats usage = 4;
  repeated ChatToolCall delta_tool_calls = 5;
  string delta_thinking = 6;
  string delta_signature = 7;              // 签名 (审计)
  bool thinking_redacted = 8;
  string output_id = 9;
  string thinking_id = 10;
  bytes gemini_thought_signature = 11;     // Gemini思考签名
  string delta_signature_type = 12;
  string phase = 13;                       // 阶段标记
}
```

### 32.4 ContextScopeItem (31种上下文来源)

```protobuf
message ContextScopeItem {
  oneof scope_item {
    PathScopeItem file = 1;
    PathScopeItem directory = 2;
    RepositoryScopeItem repository = 3;
    CodeContextItem code_context = 4;
    CciWithSubrange cci_with_subrange = 6;
    RepositoryPathScopeItem repository_path = 7;
    KnowledgeBaseScopeItem slack = 8;
    KnowledgeBaseScopeItem github = 9;
    FileLineRange file_line_range = 10;
    TextBlock text_block = 11;
    KnowledgeBaseScopeItem jira = 12;
    KnowledgeBaseScopeItem google_drive = 13;
    ConsoleLogScopeItem console_log = 14;
    DOMElementScopeItem dom_element = 15;
    RecipeScopeItem recipe = 16;
    KnowledgeBaseScopeItem knowledge = 17;
    RuleScopeItem rule = 18;
    McpResourceItem mcp_resource = 19;
    BrowserPageScopeItem browser_page = 20;
    BrowserCodeBlockScopeItem browser_code_block = 21;
    BrowserTextScopeItem browser_text = 22;
    ConversationScopeItem conversation = 23;
    UserActivityScopeItem user_activity = 24;
    TerminalScopeItem terminal = 25;
    GithubPullRequestItem github_pull_request = 26;
    CodeMapScopeItem code_map = 27;
    McpPromptScopeItem mcp_prompt = 28;
    SkillScopeItem skill = 29;
    PlanFileScopeItem plan_file = 30;
    GitScopeItem git = 31;
  }
}
```

### 32.5 UserSettings (完整用户偏好, 99个字段)

关键字段分类：

| 分类 | 字段 |
|------|------|
| **模型选择** | last_selected_model, last_selected_cascade_model_uid, cascade_model_explicitly_set |
| **UI** | theme_preference, font_size, extension_panel_tab |
| **补全** | disable_autocomplete, disable_supercomplete, supercomplete_aggression, completion_mode |
| **Tab跳转** | disable_tab_to_jump, tab_to_jump |
| **Cascade** | cascade_auto_execution_policy, disable_cascade_auto_fix_lints, disable_cascade_browser_previews |
| **命令安全** | cascade_allowed/denied_commands, cascade_allowed/denied_commands_prefix |
| **Web** | cascade_web_search, cascade_user_allowed_web_origins, cascade_web_requests_auto_execution_policy |
| **记忆** | disable_auto_generate_memories |
| **Arena** | arena_always_open_fullscreen, last_arena_mode_enabled, last_specific_arena_model_uids |
| **终端** | enable_terminal_completion |
| **声音** | enable_sounds_for_special_events, enable_tab_sounds |
| **隐私** | detect_proxy |
| **代理** | use_clipboard_for_completions |
| **工作区** | custom_workspace |
| **计划** | global_plan_mode_preference |
| **通知** | enable_cascade_completion_notifications, enable_cascade_always_notify_on_finish |
| **浏览器** | enable_automatic_screenshot, browser_experimental_features_config |
| **注释** | annotations_config, enable_inlay_hint_shortcuts |

### 32.6 TeamConfig (完整企业配置, 65个字段)

```protobuf
message TeamConfig {
  // 信用管理
  int32 user_prompt_credit_cap = 2;
  int32 user_flow_credit_cap = 3;
  int32 user_add_on_credit_cap = 30;
  
  // 部署控制
  bool allow_app_deployments = 10;
  bool allow_sandbox_app_deployments = 19;
  bool allow_teams_app_deployments = 20;
  int32 max_unclaimed_sites = 9;
  int32 max_new_sites_per_day = 11;
  
  // 安全策略
  bool disable_tool_calls = 15;
  bool disable_tool_call_execution_outside_workspace = 26;
  repeated string allowed_ip_ranges = 35;
  repeated string terminal_allow_list = 39;
  repeated string terminal_deny_list = 40;
  CascadeCommandsAutoExecution max_cascade_auto_execution_level = 37;
  
  // MCP/注册表
  bool allow_mcp_servers = 5;
  repeated McpServerConfig allowed_mcp_servers = 23;
  repeated string mcp_registry_urls = 49;
  bool enforce_mcp_registry = 60;
  string acp_registry_config = 51;
  
  // CLI
  repeated string cli_permissions_allow/deny/ask = 41,42,43;
  bool cli_default_disabled = 50;
  
  // GitHub
  bool allow_github_reviews = 12;
  bool allow_github_description_edits = 13;
  bool allow_github_auto_reviews = 24;
  optional int32 pull_request_review_rate_limit = 21;
  
  // 高级功能
  bool allow_vibe_and_replace = 27;
  bool disable_deepwiki = 28;
  bool disable_codemaps = 31;
  bool disable_fast_context = 33;
  bool disable_lifeguard = 34;
  bool allow_arena_mode = 45;
  bool disable_cascade = 64;
  
  // Devin 集成
  bool allow_bundling_devin_cli = 47;
  bool devin_terminal_acp_enabled = 58;
  bool devin_cloud_acp_enabled = 59;
  
  // Sandbox
  SandboxEnforcementMode sandbox_enforcement_mode = 55;
  repeated string sandbox_allowed_domains = 56;
  repeated string sandbox_denied_domains = 57;
  
  // UI 定制
  bool user_configured_banner_enabled = 61;
  string user_configured_banner_label = 62;
  string user_configured_banner_color = 63;
  string extension_policy = 65;
  string cascade_hooks_json = 46;
}
```

---

## 33. LS Go 完整子模块列表 (152个)

从二进制提取的 `exa/language_server/` 下所有子模块：

```
action/                        — 代码动作 (command, create/delete_file, factory, helpers, interface)
api_server_client/             — API客户端 (chat, completion, embedding, mquery, tab, telemetry)
cache/                         — 缓存层
chat/                          — 聊天 (citation, docstring, explain, fast_apply, markdown, mentions, 
                                 problem_explain, refactor, unit_tests, utils)
chat_client_server_client/     — 聊天客户端服务端 (client, handler)
code_tracker/                  — 代码追踪器 (code_range, manager, listener, upload_ctu, user_data_uploader)
commit_graph/                  — 提交图 (cluster_utils, config)
completion_provider/           — 补全提供器
context_module/                — 上下文模块 (context_index, context_provider, data_scopes, relevance)
corpus/                        — 语料库
deploy/                        — 部署系统
diagnostics/                   — 诊断
documentindex/                 — 文档索引 (datastorage, indexdata)
file_system_provider_client/   — 文件系统提供器客户端
file_tracker/                  — 文件追踪器
fs/                            — 文件系统抽象
git_utils/                     — Git 工具
handlers/                      — 请求处理器 (最大子模块)
lsp/                           — LSP 协议层
mcp/                           — MCP 客户端
memories/                      — 记忆系统
prompt/                        — 提示构建
registry/                      — 注册表
search/                        — 搜索
server/                        — 服务端
session/                       — 会话管理
source_document/               — 源文档
supercomplete/                 — 超级补全
tab_jump/                      — Tab 跳转
telemetry/                     — 遥测
terminal/                      — 终端集成
workspace/                     — 工作区管理
```

---

## 34. Quick Review / PR Review 系统

### 34.1 Quick Review 设置

```protobuf
enum QuickReviewSetting {
  QUICK_REVIEW_SETTING_UNSPECIFIED = 0;
  QUICK_REVIEW_SETTING_ENABLED = 1;
  QUICK_REVIEW_SETTING_DISABLED = 2;
}
```

### 34.2 PR Review 配置

```protobuf
// TeamConfig 中
bool allow_github_reviews = 12;
bool allow_github_description_edits = 13;
string pull_request_review_guidelines = 14;
string pull_request_description_guidelines = 16;
optional int32 pull_request_review_rate_limit = 21;
bool allow_github_auto_reviews = 24;
```

### 34.3 Auto Cascade PR 遥测

```
AUTO_CASCADE_PR_TITLE_GENERATED = 198
AUTO_CASCADE_PR_DESCRIPTION_GENERATED = 199
AUTO_CASCADE_PR_REVIEW_REQUESTED = 200
AUTO_CASCADE_PR_REVIEW_GENERATED = 201
AUTO_CASCADE_GITHUB_CONNECTION_ADDED = 204
AUTO_CASCADE_GITHUB_CONNECTION_REMOVED = 205
```

---

## 35. Knowledge Base / 知识库系统

### 35.1 Index 类型

```protobuf
enum IndexChoice {
  GITHUB_BASE = 1;
  SLACK_BASE = 2;
  SLACK_AGGREGATE = 3;
  GOOGLE_DRIVE_BASE = 4;
  JIRA_BASE = 5;
  SCM = 6;
}
```

### 35.2 KnowledgeBase 消息

```protobuf
message KnowledgeBaseItem {
  string document_id = 1;
  string url = 3;
  string title = 4;
  Timestamp timestamp = 5;
  repeated KnowledgeBaseChunk chunks = 6;
  string summary = 7;
  ImageData image = 8;
  DOMTree dom_tree = 9;
  string text = 2;
}

message KnowledgeBaseChunk {
  oneof chunk_type {
    string text = 1;
    MarkdownChunk markdown_chunk = 3;
  }
  int32 position = 2;
}
```

### 35.3 遥测事件

```
KNOWLEDGE_BASE_ITEM_CREATED = 156
KNOWLEDGE_BASE_ITEM_EDITED = 157
KNOWLEDGE_BASE_ITEM_DELETED = 158
KNOWLEDGE_BASE_ITEM_READ = 159
KNOWLEDGE_BASE_CONNECTION_CREATE = 160
KNOWLEDGE_BASE_CONNECTION_REMOVE = 161
```

---

## 36. MCP Registry / ACP 系统

### 36.1 MCP 服务器配置

```protobuf
message McpServerConfig {
  oneof configuration {
    McpLocalServer local = 2;     // 本地进程
    McpRemoteServer remote = 3;   // 远程 SSE/HTTP
  }
  string server_id = 1;
}

message McpLocalServer {
  string command = 1;
  repeated string args = 2;
  map<string, string> env = 3;
}

message McpRemoteServer {
  string type = 1;               // "sse" | "streamable-http"
  string url = 2;
  map<string, string> headers = 3;
}
```

### 36.2 Go MCP 模块

```
exa/cortex/utils/mcp/
├── mcp_manager                  — MCP 管理器
├── mcp_server_client_instance   — 服务端客户端实例
├── oauth                        — OAuth 认证
├── policy                       — 策略评估
├── registry                     — 注册表
├── roots                        — 根目录管理
└── utils                        — 工具函数
```

### 36.3 TeamConfig 控制

```protobuf
bool allow_mcp_servers = 5;
repeated McpServerConfig allowed_mcp_servers = 23;
repeated string mcp_registry_urls = 49;
bool enforce_mcp_registry = 60;
string acp_registry_config = 51;     // ACP 注册表
```

---

## 37. DevService 调试后门

> 来源: `dev_pb/dev.proto` (30行) + 二进制字符串分析

### 37.1 Service 定义

```protobuf
service DevService {
  rpc Dev (DevRequest) returns (DevResponse);               // 任意命令执行
  rpc GetLSPCompletionItems (GetLSPCompletionItemsRequest)  // LSP补全项
      returns (GetLSPCompletionItemsResponse);
}
message DevRequest { string command = 1; }
message DevResponse {}
```

### 37.2 二进制发现

- **RPC路径**: `/exa.dev_pb.DevService/Dev`, `/exa.dev_pb.DevService/GetLSPCompletionItems`
- **Connect-RPC处理**: `DevServiceHandler.Dev-fm`, `DevServiceHandler.GetLSPCompletionItems-fm`
- **dev_mode 标志**: LanguageServerConfig 中 `dev_mode` (field 21)，EvalLanguageServerConfig 中也有
- **激活条件**: `~/.windsurf-dev/credentials.json` 存在时可能激活
- **11+ DevService引用**, **17 DevRequest引用**, **13 DevResponse引用**

### 37.3 GetLSPCompletionItems 双端点

同时存在于 `DevService` 和 `ExtensionServerService`:
- DevService: LS端 → 本地调试
- ExtensionServerService: LS→Extension 回调 → 获取IDE中的LSP补全

---

## 38. ACU 计费系统 (Active Compute Units)

> 来源: `seat_management.proto` + `codeium_common.proto` + 二进制分析

### 38.1 BillingStrategy 枚举

```protobuf
enum BillingStrategy {
  BILLING_STRATEGY_UNSPECIFIED = 0;
  BILLING_STRATEGY_CREDITS = 1;     // 传统额度制
  BILLING_STRATEGY_QUOTA = 2;       // 配额制
  BILLING_STRATEGY_ACU = 3;         // ACU 按量计费 (新)
}
```

### 38.2 Self-Hosted ACU 配置

```
GetSelfHostedAcuConfig / SetSelfHostedAcuConfig         — 配置ACU
BatchGetSelfHostedAcuConfig                               — 批量获取
DisableSelfHostedAcuBilling                               — 禁用ACU计费
GetSelfHostedAcuUserOverride / SetSelfHostedAcuUserOverride — 用户级覆盖
DeleteSelfHostedAcuUserOverride / BatchGetSelfHostedAcuUserOverrides
GetSelfHostedAcuTeamCycleUsage                            — 团队周期用量
```

### 38.3 ACU 关键字段

| 字段 | 描述 |
|------|------|
| `cycle_acu_limit` | 周期ACU上限 |
| `team_cycle_acu_limit` | 团队周期ACU上限 |
| `cascade_acu_multiplier` | Cascade ACU乘数 |
| `cli_acu_multiplier` | CLI ACU乘数 |
| `acu_billing_enabled` | ACU计费开关 |
| `billing_strategy` | 计费策略选择 |
| `billing_model` | 计费模型 |
| `daily_usage_micros` / `weekly_usage_micros` | 用量 (微单位) |
| `daily_limit_micros` / `weekly_limit_micros` | 限额 (微单位) |
| `previous_daily_usage_micros` | 历史用量 |

### 38.4 配额管理

```
GetQuotaUsageInternal / ResetQuotaUsageInternal — 内部配额API
overage_balance / exists_in_valkey / postgres_balance — Valkey(Redis)+Postgres双存储
```

### 38.5 ModelPricingType

```protobuf
enum ModelPricingType {
  MODEL_PRICING_TYPE_UNSPECIFIED = 0;
  MODEL_PRICING_TYPE_API = 1;
  MODEL_PRICING_TYPE_ACU_TOKEN = 2;  // ACU按token计价
}
```

---

## 39. Code Tracker (代码溯源系统)

> 来源: `api_server.proto` + 二进制 Go 函数分析

### 39.1 核心数据模型

```protobuf
message ByteDeltaInfo {
  CodeSource code_source = 1;   // 代码来源
  uint64 num_bytes = 2;         // 字节数
  uint64 start_offset = 3;      // 起始偏移
}
enum CodeSource {
  CODE_SOURCE_UNSPECIFIED = 0;
  CODE_SOURCE_BASE = 1;         // 原始代码
  CODE_SOURCE_CODEIUM = 2;      // AI生成
  CODE_SOURCE_USER = 3;         // 用户手写
  CODE_SOURCE_USER_LARGE = 4;   // 用户大段
  CODE_SOURCE_UNKNOWN = 5;
}
message CodeTrackerUpdate {
  repeated ByteDeltaInfo byte_deltas = 3;
  uint64 bytes_added = 8;
  uint64 bytes_deleted = 7;
}
```

### 39.2 Go 内部架构 (17个导出函数)

```
code_tracker.ByteDeltaKey / ByteDeltaKeyFromCodeRange  — Delta键
code_tracker.CodeRange / MergeCodeRanges               — 代码范围管理
code_tracker.CodeTracker / NewCodeTracker              — 跟踪器
code_tracker.NewCodeTrackerFromProto                   — Proto反序列化
code_tracker.NewCodeTrackerManager                     — 管理器
code_tracker.NewCodeTrackerWorkspaceListener           — 工作区监听
code_tracker.NewCodeRangeManager                       — 范围管理器
code_tracker.NewUserDataUploader                       — 数据上传
code_tracker.CompletionData / CompletionMetadata       — 补全元数据
code_tracker.DiskUpdateEvent                           — 磁盘更新事件
code_tracker.RepoWithCommit                            — 仓库+提交
code_tracker.UploadCodeTrackerUpdate                   — 上传更新
```

### 39.3 API 端点

```
ApiServerService/RecordCodeTrackerUpdates  — 上报代码跟踪数据
ApiServerService/UploadCodeTrackerUpdate   — 上传单次更新
```

### 39.4 追踪生命周期

1. 文件编辑 → `CodeTrackerWorkspaceListener` 监听变化
2. `ByteDeltaKey` 标识每个代码块, `CodeSource` 标注来源
3. `MergeCodeRanges` 合并相邻范围
4. `codeTrackerUpdateChan` → `DiskUpdateEvent` → 持久化
5. `UploadCodeTrackerUpdate` → API Server 汇报

---

## 40. Eval/Trainer ML 训练管道

> 来源: `eval.proto` (1247行) + `trainer_pb/config.proto` (614行)

### 40.1 Eval 系统概览

```protobuf
service EvalQueueService {
  rpc EnqueueEvalTask (EnqueueEvalTaskRequest) returns (EnqueueEvalTaskResponse);
  rpc DequeueEvalTask (DequeueEvalTaskRequest) returns (DequeueEvalTaskResponse);
  rpc EnqueueEvalResult (EnqueueEvalResultRequest) returns (EnqueueEvalResultResponse);
  rpc DequeueEvalResult (DequeueEvalResultRequest) returns (DequeueEvalResultResponse);
  rpc ResetQueues (ResetQueuesRequest) returns (ResetQueuesResponse);
}
```

### 40.2 评估类型

| EvalType | 描述 |
|----------|------|
| AUTOCOMPLETE | 代码自动补全 |
| CHAT | 对话 |
| INSTRUCTION_AUTOCOMPLETE | 指令补全 |
| INSTRUCTION_CHAT | 指令对话 |
| HUMAN_EVAL | HumanEval基准 |
| LLMJUDGE | LLM评判 |
| AUTOCOMPLETE_COMMAND | 命令补全 |
| CODE_REASONING | 代码推理 |

### 40.3 Deletion Types (训练数据生成)

```
INLINE_FIM, RANDOM_MULTILINE, FUNCTION_PARAMS,
REFERENCE, REPO_REFERENCE, FULL_FUNCTION, COMMENTED_CODEBLOCK
```

### 40.4 Infer Data Tags (67+)

分6大类: SOURCE (代码来源), DELETION (删除类型), CHAT (聊天评估),
INSTRUCTION (指令), SUPERCOMPLETE (超级补全), INSERTION/EDIT (插入/编辑)

### 40.5 Trainer 配置核心

| 模块 | 关键配置 |
|------|----------|
| **框架** | Torch, Megatron |
| **训练目标** | CausalLM, Embedding, Reward, Seq2Seq, DPO, KTO, GRPO, OnPolicyDPO |
| **优化器** | AdamW, Lion |
| **量化** | Int8, Int4, NF4, FP8 (PTQ); GPTQ, AWQ方法 |
| **模型架构** | RoPE, XPos, MUP, SlidingWindow, MultiLatentAttention, MoE |
| **并行化** | tensor_parallelism, pipeline_parallelism, expert_parallelism |
| **推理** | SGLang, 投机解码 (speculative_copy_length) |

### 40.6 GRPO/DPO/KTO 训练

```protobuf
message OnPolicyGRPOConfig {
  float reference_policy_kl_penalty_beta = 1;
  float ratio_clip_max = 3;
  bool use_dr_grpo_length_normalization = 4;   // Dr.GRPO长度归一化
}
message TrainerConfig_DpoConfig { ... }
message TrainerConfig_KtoConfig { ... }
message KnowledgeDistillationConfig { ... }    // 知识蒸馏
```

### 40.7 PR Eval 管道

```
PREvalConfig — 完整PR评估配置:
  GenerateLanguageServerConfig — 生成LS配置
  TrajectoryDownloadConfig — 轨迹下载
  RolloutDatasetConfig — Rollout数据集
  MetricsStageConfig — 指标评估 (LLM Judge, Process Judge, Review Judge)
  GenerateTaskConfig — 任务生成
```

### 40.8 Trajectory Judge (轨迹评判)

```
OverallTrajectoryJudgePromptType:
  CONVERSATIONAL, IMPLICIT_MATCHER, INTENT_BOUNDARY,
  RUBRIC_CREATOR, RUBRIC_EVAL, INTENT_BOUNDARY_RUN_COMMAND_VERIFIER
ProcessConditioningMode: PARTIAL_HISTORY, SUBTRAJECTORY_SUMMARY
```

### 40.9 Prompt Formats

```
INTERNAL, OPENAI, LLAMA, LLAMA3, HERMES3, INTERNAL_CUMULATIVE,
XML, DEEPSEEK, DEEPSEEKV2, DEEPSEEKV3, KIMI, QWEN_CODER
```

---

## 41. Supercomplete 引擎

> 来源: 二进制 Go 函数分析 (17个函数)

### 41.1 Go 架构

```
supercomplete/                        — 核心子模块
├── NewDebouncer                      — 防抖控制
├── NewRequestManager                 — 请求管理
├── NewTabQueueManager                — Tab队列管理
├── GetLatestSupercompleteContext      — 获取最新上下文
├── RequestInfo                       — 请求信息
├── Suggestion                        — 建议结果
└── TriggerState                      — 触发状态

completion_provider/
├── NewSupercompleteFeedbackManager   — 反馈管理
├── NewSupercompleteStreamReceiver    — 流式接收
├── NewTabjumpStreamReceiver          — TabJump流接收
└── ProcessTabJumpDiffs               — 处理TabJump差异

ls_unleash/
├── GetSupercompleteModelConfig       — 模型配置
├── GetSupercompleteModelConfigV1Compatible
└── GetSupercompleteModelConfigWithAggression — 激进度配置

state/
└── NewSupercompleteRequestState      — 请求状态
```

### 41.2 触发条件

```protobuf
enum SupercompleteTriggerCondition {
  SUPERCOMPLETE_TRIGGER_CONDITION_UNSPECIFIED = 0;
  // ... 多种触发条件
}
```

### 41.3 过滤系统

```
SuperCompleteFilterReason — 过滤原因
ExperimentKeys:
  SUPERCOMPLETE_MIN_SCORE, SUPERCOMPLETE_ON_TAB,
  SUPERCOMPLETE_MODEL_CONFIG, SUPERCOMPLETE_SPEED_FAST
```

### 41.4 Supercomplete V2

```
HandleSupercomplete / HandleSupercompleteV2
fireSupercompleteV2 / fireSupercompleteV2Impl
oldFireSupercompleteV2 / newFireSupercompleteV2    — V1/V2 双路径
tabjumpFireSupercompleteV2                          — TabJump集成
BuildSupercompletePrompt                            — 构建Prompt
```

---

## 42. TabJump / Tab预测

> 来源: 二进制分析 (10个Go函数, 50+ experiment keys)

### 42.1 Go 架构

```
tab/
├── FindBestStringMatch    — 最佳字符串匹配
├── IsDiffReusable         — 差异复用判断
└── NormalizeNewlines       — 换行符归一化

completion_provider/
├── NewTabjumpStreamReceiver    — 流式接收
├── NewNewTabjumpStreamReceiver — 新版流式接收
└── ProcessTabJumpDiffs         — 差异处理

ls_unleash/
└── GetTabJumpModelConfig   — 模型配置

api_server_client/
└── TabTrajectoryStepInput  — 轨迹步骤输入
```

### 42.2 TabToJump 枚举

```protobuf
enum TabToJump {
  TAB_TO_JUMP_UNSPECIFIED = 0;
  TAB_TO_JUMP_ENABLED = 1;
  TAB_TO_JUMP_DISABLED = 2;
}
```

### 42.3 Experiment Keys (20+)

```
TAB_JUMP_ENABLED, TAB_JUMP_LINE_RADIUS,
TAB_JUMP_MODEL_CONFIG, TAB_JUMP_FILTER_NO_OP,
TAB_JUMP_ACCEPT_ENABLED, TAB_JUMP_ON_ACCEPT_ONLY,
TAB_JUMP_PRUNE_RESPONSE, TAB_JUMP_MIN_FILTER_RADIUS,
TAB_JUMP_FILTER_IN_SELECTION, TAB_JUMP_FILTER_DELETION_CAP,
TAB_JUMP_FILTER_INSERTION_CAP, TAB_JUMP_STOP_TOKEN_MIDSTREAM,
TAB_JUMP_FILTER_SCORE_THRESHOLD, TAB_JUMP_FILTER_WHITESPACE_ONLY,
TAB_JUMP_FILTER_REVERT, COMPLETION_SPEED_TAB_JUMP_CACHE,
TAB_REQUEST_SOURCE_TAB_JUMP, EXPERIMENT_PROJECT_TAB_TO_JUMP,
EXPERIMENT_PROJECT_TAB_MODEL
```

---

## 43. DeepWiki 系统

> 来源: `chat_pb` + `api_server_pb` + 二进制分析

### 43.1 请求/响应类型

```protobuf
enum DeepWikiRequestType {
  DEEP_WIKI_REQUEST_TYPE_UNSPECIFIED = 0;
  DEEP_WIKI_REQUEST_TYPE_SUMMARY = 1;
  DEEP_WIKI_REQUEST_TYPE_ARTICLE = 2;
}
enum DeepWikiSymbolType {
  FILE, MODULE, NAMESPACE, PACKAGE, CLASS, ...
}
enum DeepWikiModelType {
  DEEP_WIKI_MODEL_TYPE_UNSPECIFIED = 0;
  DEEP_WIKI_MODEL_TYPE_PREMIUM = 1;
  DEEP_WIKI_MODEL_TYPE_LITE_FREE = 2;
  DEEP_WIKI_MODEL_TYPE_LITE_PAID = 3;
  DEEP_WIKI_MODEL_TYPE_CAPACITY_FALLBACK = 4;
}
```

### 43.2 上下文系统

```
DeepWikiContext / DeepWikiContextV2     — 双版本上下文
DeepWikiHoverContext                    — 悬停上下文
DeepWikiSymbolContext                   — 符号上下文
DeepWikiSymbolRange                     — 符号范围
```

### 43.3 API 端点

```
ApiServerService/GetDeepWiki           — 获取DeepWiki (流式)
LanguageServerService/GetDeepWiki      — LS本地处理
api_server_client.DeepWikiResult       — 结果封装
```

### 43.4 特性

- `disable_deepwiki` — 可禁用
- `is_followup` — 支持追问
- `followup_questions` — 后续问题建议
- **3种模型层级**: Premium / Lite-Free / Lite-Paid / Capacity-Fallback

---

## 44. Auto Cascade (异步PR/CF)

> 来源: `auto_cascade_common_pb` + 二进制分析

### 44.1 核心数据结构

```
auto_cascade_common_pb.SessionInfo     — 会话信息
auto_cascade_common_pb.SessionInfos    — 会话列表
auto_cascade_common_pb.GitRepoInfo     — Git仓库信息
auto_cascade_common_pb.BranchStatus    — 分支状态
auto_cascade_common_pb.CommentType     — 评论类型
auto_cascade_common_pb.GithubCICheckStatus     — CI检查状态
auto_cascade_common_pb.GithubPullRequestInfo   — PR信息
auto_cascade_common_pb.GithubInstallationInfo  — GitHub安装信息
auto_cascade_common_pb.GithubPullRequestBranchStatus — PR分支状态
```

### 44.2 RPC/功能

```
RecordAutoCascadeTelemetry              — 遥测上报
UpdateAutoCascadeGithubCredentials      — GitHub凭据更新
GetAddAutoCascadeMemories               — 添加记忆
GetAutoCascadeMemorySummary             — 记忆摘要
GetAutoCascadeBroadcast                 — 广播通知
AutoCascadeBroadcastToolConfig/Converter — 广播工具
AutoCascadeWorkspace                    — 工作区管理
```

### 44.3 轨迹来源

```
CORTEX_TRAJECTORY_SOURCE_ASYNC_PRR  — 异步PR审查
CORTEX_TRAJECTORY_SOURCE_ASYNC_CF   — 异步代码修复
CORTEX_TRAJECTORY_SOURCE_ASYNC_SL   — 异步SL (新发现)
```

### 44.4 LanguageServerConfig

```protobuf
bool auto_cascade_mode = 33;  // Auto Cascade 模式开关
```

---

## 45. Deep Think 系统

> 来源: `cortex.proto` + 二进制分析

### 45.1 核心结构

```protobuf
message CortexStepDeepThink {
  string exploration_document = 1;
  string exploration_document_absolute_path_uri = 2;
  string last_planner_response = 3;
}
// 关联枚举:
CORTEX_STEP_TYPE_DEEP_THINK
CORTEX_TRAJECTORY_TYPE_DEEP_THINK
BRAIN_ENTRY_TYPE_DEEP_THINK
```

### 45.2 工作机制

- 生成 `exploration_document` 进行深度思考
- 绑定到文件路径 (`exploration_document_absolute_path_uri`)
- 保留上一轮规划响应 (`last_planner_response`)
- 作为 Brain Entry 持久化 (BRAIN_ENTRY_TYPE_DEEP_THINK)

---

## 46. Virtual Filesystem (虚拟文件系统)

> 来源: `cortex.proto` + 二进制Go分析

### 46.1 核心

```protobuf
// CortexTrajectory 中:
bytes virtual_fs_serialized_overlay = 13; // 序列化的虚拟FS覆盖层
```

### 46.2 Go 实现

```
exa/fs/virtual_fs.go                       — VirtualFS 实现
fs.NewVirtualFS                             — 创建
fs.(*VirtualFS).ReadFile                    — 读文件
fs.(*VirtualFS).Stat                        — 文件信息
fs.(*VirtualFS).normalizePathForOverlay     — 路径归一化
fs.VirtualFSState / SerializableVirtualFile — 状态序列化
```

### 46.3 工作流

```
createCascadeVirtualFS → loadCascadeVirtualFS → syncWorktreeContents
                                                        ↓
                                            VirtualFS 状态序列化到 Trajectory
                                                        ↓
                                            failed to marshal/unmarshal VirtualFS state
```

- 每个 Cascade 对话有独立 VirtualFS
- 支持 worktree 同步
- 序列化后附着在 CortexTrajectory 上传服务器

---

## 47. OpenSearch Knowledge Base (深度搜索)

> 来源: `opensearch_clients.proto` (469行)

### 47.1 双 Service

```protobuf
service KnowledgeBaseService {     // 19 RPCs
  rpc KnowledgeBaseSearch (...)
  rpc GetKnowledgeBaseScopeItems (...)
  rpc GetKnowledgeBaseItemsFromScopeItems (...)
  rpc IngestSlackData / IngestGithubData / IngestGoogleDriveData / IngestJiraData
  rpc IngestJiraPayload / ForwardSlackPayload / IngestSlackPayload
  rpc ConnectKnowledgeBaseAccount / DeleteKnowledgeBaseConnection
  rpc UpdateConnectorConfig / CancelKnowledgeBaseJobs
  rpc GetKnowledgeBaseConnectorState / GetKnowledgeBaseJobStates
  rpc AddUsers / AddGithubUsers
  rpc GetKnowledgeBaseWebhookUrl / GetConnectorInternalConfig
}
service CodeIndexService {         // 4 RPCs
  rpc OpenSearchAddRepository (...)
  rpc OpenSearchGetIndex (...)
  rpc HybridSearch (...)           // 混合搜索 (keyword + embedding)
  rpc GraphSearch (...)            // 图搜索
}
```

### 47.2 Connector 类型

```protobuf
enum ConnectorType {
  GITHUB = 1; SLACK = 2; GOOGLE_DRIVE = 3; JIRA = 4;
  CODEIUM = 5; EMAIL = 6; GITHUB_OAUTH = 7;
}
```

### 47.3 搜索模式

```protobuf
enum SearchMode {
  HYBRID = 1;            // 混合搜索 (默认)
  KEYWORD = 2;           // 纯关键字
  APPROXIMATE_KNN = 3;   // 近似KNN向量搜索
  BRUTE_FORCE_KNN = 4;   // 暴力KNN
}
```

### 47.4 Job 管理

```
JobStatus: QUEUED → RUNNING → COMPLETED / CANCELLED / ERRORED / RETRYABLE
ConnectorState: initialized, config, document_type_counts, last_indexed_at, unhealthy_since
```

### 47.5 Slack 深度集成

```protobuf
message SlackMessagePayload {
  string dataset_id, type, channel_id, user, text, timestamp,
         thread_timestamp, channel_name, team_name, team_id,
         is_private_channel, team_domain, original_timestamp;
}
message SlackChannelPayload { ... }
// 内部配置: client_id, client_secret, signing_secret
```

---

## 48. Proxy Web Server

> 来源: `cortex.proto` + 二进制分析

### 48.1 工具配置

```protobuf
message CortexStepProxyWebServer {
  string target_url = 1;
  string name = 2;
}
message ProxyWebServerToolConfig {
  bool force_disable = 1;  // oneof
}
```

### 48.2 实现

```
handlers/proxy_web_server_handler.go  — 处理器
tools.ProxyWebServerToolConverter     — 工具转换器
managers.ProxyWebServerStringConverter — 字符串转换
CASCADE_ENABLE_PROXY_WEB_SERVER (ExperimentKey=290) — 实验开关
CORTEX_STEP_TYPE_PROXY_WEB_SERVER  — Step类型
```

---

## 49. Extension Code Execution (扩展代码执行)

> 来源: `cortex.proto` + 二进制分析

### 49.1 Auto-Run Decision

```protobuf
enum RunExtensionCodeAutoRunDecision {
  UNSPECIFIED = 0; ALLOWED = 1; DENIED = 2;
  MODEL_ALLOWED = 3; MODEL_DENIED = 4;
}
enum AutoRunDecision {
  UNSPECIFIED = 0;
  USER_ALLOW = 1; USER_DENY = 2;
  SYSTEM_ALLOW = 3; SYSTEM_DENY = 4;
  MODEL_ALLOW = 5; MODEL_DENY = 6;
  DEFAULT_ALLOW = 7; DEFAULT_DENY = 8;
  USER_SKIP = 9;
}
```

### 49.2 交互模型

```protobuf
message CascadeRunExtensionCodeInteraction { ... }
message CascadeRunExtensionCodeInteractionSpec { ... }
// CortexTrajectoryStep oneof:
RunExtensionCode (field 68)
// CascadeUserInteraction oneof:
RunExtensionCode
```

---

## 50. Database & Storage 层

> 来源: 二进制Go函数分析

### 50.1 存储技术

| 技术 | 用途 |
|------|------|
| **SQLite + FAISS** | 本地向量索引 (`LocalSqliteFaissDbStats`) |
| **native_storage_migrations** | 数据迁移 (`RunMigrations`) |
| **InMemoryIndexDataStorage** | 内存索引 |
| **database_dir** | LS本地数据库目录 |

### 50.2 Go 函数

```
documentindex/datastorage.NewInMemoryIndexDataStorage  — 内存索引
native_storage_migrations.RunMigrations                 — 数据迁移
```

### 50.3 配置

```protobuf
// LanguageServerConfig:
string database_dir = 7;   // 数据库目录
```

---

## 51. Lifeguard (AI安全)

> 来源: 二进制分析

### 51.1 功能

```
LifeguardBug / ReportBugs                    — Bug检测与上报
cognition-lifeguard                           — Cognition Lifeguard 安全服务
GetLifeguardConfig                            — 获取安全配置
PlannerType: LIFEGUARD                        — 独立Planner类型
TrajectorySource: LIFEGUARD                   — 轨迹来源
```

### 51.2 集成点

- Cascade 工具调用前安全检查
- 独立 Lifeguard Planner 可拦截危险操作
- Bug 上报到服务器端分析

---

## 统计更新

| 指标 | 数值 |
|------|------|
| **文档总章节** | 51 |
| **Proto Services (全部)** | 16+ (新增 EvalQueueService, OpenSearch KBService, CodeIndexService) |
| **ACU 计费字段** | 15+ |
| **Code Tracker Go函数** | 17 |
| **Supercomplete Go函数** | 17 |
| **TabJump Experiment Keys** | 20+ |
| **DeepWiki 模型类型** | 4 |
| **Auto Cascade proto类** | 10+ |
| **OpenSearch Connectors** | 7 (GitHub, Slack, Google Drive, Jira, Codeium, Email, GitHub OAuth) |
| **SearchMode** | 4 (Hybrid, Keyword, ApproxKNN, BruteForceKNN) |
| **Eval Types** | 8 |
| **Prompt Formats** | 12 |
| **Training Objectives** | 8+ (CausalLM, Embedding, Reward, DPO, KTO, GRPO...) |
| **AutoRunDecision 级别** | 9 |
| **BillingStrategy** | 4 (Unspecified, Credits, Quota, ACU) |

---

## 52. Analytics 双 Service (遥测上报)

> 来源: `analytics.proto` (192行) + `product_analytics.proto` (41行)

### 52.1 AnalyticsService (8 RPCs)

```protobuf
service AnalyticsService {
  rpc RecordCommandUsage (...)          // 命令使用统计
  rpc RecordCompletions (...)           // 补全结果记录
  rpc RecordContextToPrompt (...)       // 上下文→Prompt 记录
  rpc RecordCortexTrajectory (...)      // Cortex轨迹记录
  rpc RecordCortexTrajectoryStep (...)  // 轨迹单步记录
  rpc RecordTabTrajectoryStep (...)     // Tab轨迹步骤
  rpc BatchRecordPrompts (...)          // 批量Prompt记录
  rpc BatchRecordCompletions (...)      // 批量补全记录
}
```

### 52.2 RecordCommandUsage 字段 (21个)

```
metadata, command, selection, request_source, prompt_id,
completion_id, completion, prompt, requested_model_id,
stop_reason, language, provider_source, command_prompt_components,
cortex_trajectory_reference, super_complete_filter_reason,
supercomplete_trigger_condition, prompt_stage_latencies,
completion_profile, char_insertions, char_deletions,
trajectory_step_oids
```

### 52.3 RecordCortexTrajectory (轨迹上报)

```protobuf
message RecordCortexTrajectoryRequest {
  Metadata metadata = 1;
  string trajectory_id = 2;
  string cascade_id = 5;
  optional string arena_id = 8;           // Arena模式
  CortexTrajectoryType trajectory_type = 3;
  CortexTrajectorySource trajectory_source = 7;
  repeated CortexTrajectoryReference parents = 4;
  CortexTrajectoryMetadata trajectory_metadata = 6;
}
```

### 52.4 Arena 遥测

```protobuf
message RecordArenaModeTrajectoryDetailsRequest {
  string arena_id = 2; string cascade_id = 3;
  string trajectory_id = 4; uint32 step_index = 5;
  CortexStepType step_type = 6;
  AcknowledgementType acknowledgement_type = 7;
  Model model = 8; string label = 9; ModelProvider model_provider = 10;
}
```

### 52.5 原始补全记录 (调试/训练)

```protobuf
message RecordRawCompletionRequest {
  string trajectory_id = 2; string cascade_id = 3;
  string model_name = 5; string raw_prompt = 6;
  string raw_response = 7; int64 latency = 8;
  string error = 9;  // 含错误记录
}
```

### 52.6 ProductAnalyticsService (2 RPCs)

```protobuf
service ProductAnalyticsService {
  rpc RecordAnalyticsEvent (...)            // 单个事件
  rpc BatchRecordAnalyticsEvents (...)      // 批量事件
}
message RecordAnalyticsEventRequest {
  string event_name = 1;
  string api_key = 2; string installation_id = 3;
  string ide_name = 4; string os = 5;
  string codeium_version = 6; string ide_version = 7;
  uint64 duration_ms = 8;
  map<string, string> extra = 9;
  map<string, bool> experiments = 10;      // A/B实验标志
  string plan_tier = 11;
  string device_fingerprint = 12;          // 设备指纹
  string ide_type = 13;
}
```

---

## 53. Context Module (上下文引擎)

> 来源: `context_module.proto` (168行)

### 53.1 上下文变更类型

```protobuf
enum ContextChangeType {
  ACTIVE_DOCUMENT = 1;         // 活动文档变更
  CURSOR_POSITION = 2;         // 光标位置变更
  CHAT_MESSAGE_RECEIVED = 3;   // 收到聊天消息
  OPEN_DOCUMENTS = 4;          // 打开文档列表
  ORACLE_ITEMS = 5;            // Oracle项 (AI推荐上下文)
  PINNED_CONTEXT = 6;          // 固定上下文
  PINNED_GUIDELINE = 7;        // 固定准则
  ACTIVE_NODE = 9;             // 活动AST节点
}
```

### 53.2 上下文用途

```protobuf
enum ContextUseCase {
  AUTOCOMPLETE = 1;    CHAT = 2;    CHAT_COMPLETION = 3;
  CORTEX_RESEARCH = 4; EVAL = 5;    CHAT_COMPLETION_GENERATE = 6;
  SUPERCOMPLETE = 7;   FAST_APPLY = 8; COMMAND_TERMINAL = 9;
}
```

### 53.3 检索结果元数据

```protobuf
message RetrievedCodeContextItemMetadata {
  repeated CodeContextSource context_sources = 1;
  CodeContextType context_type = 2;
  string scorer = 3;      // BM25/向量等评分器名
  float score = 4;
  map<string, CodeContextProviderMetadata> provider_metadata = 5;
  bool is_in_pinned_scope = 6;
}
```

### 53.4 LocalNodeState (AST定位)

```protobuf
message LocalNodeState {
  CodeContextItem current_node = 1;
  CodeContextItem closest_above_node = 2;
  CodeContextItem closest_below_node = 3;
}
```

---

## 54. Bug Checker & Diff Action

### 54.1 Bug Checker (`bug_checker.proto`)

```protobuf
message Bug {
  string id = 1; string file = 2;
  int32 start = 3; int32 end = 4;
  string title = 5; string description = 6;
  string severity = 7; string resolution = 8;
  double confidence = 9;
  repeated string categories = 10;
  Fix fix = 11;    // 自动修复建议
}
message Fix { string old_str = 1; string new_str = 2; }
```

### 54.2 Diff Action (`diff_action.proto`)

```protobuf
enum DiffType {
  UNIFIED = 1;    // 标准 unified diff
  CHARACTER = 2;  // 字符级差异
  COMBO = 3;      // 组合差异 (行+字符)
}
message DiffBlock {
  int32 start_line = 1; int32 end_line = 2;
  UnifiedDiff unified_diff = 3;
  Language from_language = 4; Language to_language = 5; // 跨语言!
}
message ComboDiffLine {
  string text = 1; DiffChangeType type = 2;
  CharacterDiff character_diff = 3;  // 行内字符级差异
}
```

---

## 55. PR Eval Datasets (训练数据管道)

> 来源: `datasets.proto` (98行)

### 55.1 轨迹筛选模式 (5种)

```protobuf
message FilterTrajectoryStageConfig {
  oneof selection_mode {
    SelectionModeBestScoreConfig best_score = 10;       // 最佳分数
    SelectionModeGeneratePairsConfig generate_pairs = 11; // 生成对比对
    SelectionModeGTvsBestConfig gt_vs_best = 12;         // GroundTruth对比
    SelectionModeKTOThresholdConfig kto_threshold = 17;   // KTO阈值
    SelectionModeModelNameConfig model_name = 18;         // 模型名选择
  }
  repeated CortexStepType required_step_types = 2;
  int32 min_trajectory_length = 3;
  bool truncate_trajectory_to_judge_steps = 9;
}
```

### 55.2 偏好对合并

```protobuf
message MergeFormattedPreferencePairsConfig {
  enum MismatchedPromptResolution {
    STRICT_MATCH = 1;    // 严格匹配
    KEEP_WINNER = 2;     // 保留胜者
    KEEP_LOSER = 3;      // 保留败者
  }
  int32 max_allowed_trailing_mismatched_steps = 2;
  int32 world_size = 4;  // 分布式训练 world_size
}
```

---

## 56. SeatManagementService 完整 RPC 目录 (152 RPCs)

> 来源: `seat_management.proto` (2428行)

### 56.1 分类

| 类别 | RPCs | 说明 |
|------|------|------|
| **认证** | RegisterUser, CreateFbUser, GetOneTimeAuthToken, CreatePKCE, ExchangePKCE, CheckUserLoginMethod, WindsurfPostAuth, GetSelfDevinSessionToken, ExchangeDevinCode | 多种认证方式 |
| **用户** | GetUserStatus, GetCurrentUser, UpdateName, UpdateProfile, UpdateOccupation, DeleteUser, LogOutUser | 用户管理 |
| **头像** | GetProfilePicturePresignedUploadUrl, ProfilePictureUploadComplete, GetProfileData, DeleteProfilePicture | 头像上传 |
| **团队** | GetTeamMetadata, GetTeamInfo, DeleteTeam, CreateMultiTenantTeam, GetMultiTenantTeams, DeleteMultiTenantTeam | 团队管理 |
| **角色** | GetRoles, CreateRole, UpdateRole, DeleteRole, AddUserRole, RemoveUserRole, GetRolesForUser, UpdateUserRoles, BulkUpdateUserRoles | RBAC |
| **席位** | UpdateSeats, AddUsersToTeam, RemoveUserFromTeam, GrantPreapproval, RevokePreapproval, AcceptPreapproval | 席位管理 |
| **计费** | SubscribeToPlan, UpdatePlan, CancelPlan, UpdateBilling, GetCustomerPortal, GetUserSubscription, GetTeamBilling, GetPlanStatus | Stripe集成 |
| **额度** | PurchaseCascadeCredits, GetTeamCreditEntries, GetTeamCreditBalance, UpdateCreditTopUpSettings, InitiateTopUp, AddFlexCreditsToMultiTenantTeam | 额度管理 |
| **ACU** | GetSelfHostedAcuConfig, SetSelfHostedAcuConfig, DisableSelfHostedAcuBilling, BatchGet, GetTeamCycleUsage, UserOverride (Get/Set/Delete/BatchGet) | ACU计费 (9 RPCs) |
| **SSO** | GetSSOProvider, SaveSSOProvider, JoinTeamWithSSOLogin, UserSSOLoginRedirect, CheckEmailForSSO, VerifySSOLoginInternal | SSO集成 |
| **GitHub** | ConnectGithubAccount, GetGitHubAccountStatus, GetGitHubAccessToken | GitHub OAuth |
| **Netlify** | ConnectNetlifyAccount, DisconnectNetlifyAccount, GetNetlifyAccountStatus | Deploy |
| **Team Config** | UpdateTeamConfig, UpdateTeamConfigExternal, GetTeamConfigRecord | 团队配置 |
| **团队功能** | GetTeamsFeatures, GetTeamsFeaturesInternal, UpdateTeamsFeaturesInternal, SetTeamsFeatures, AddTeamAddOnFeature | 功能控制 |
| **域名** | AddTeamDomain, ListTeamDomains, VerifyTeamDomain, DeleteTeamDomain + Internal版本 | 域名验证 |
| **API密钥** | CreateTeamApiSecret, UpdateTeamApiSecret, GetAllTeamApiSecrets, DeleteTeamApiSecret, GetApiKeySummary, DeleteApiKey, GetSetUserApiProviderKeys, SetUserApiProviderKey, DeleteUserApiProviderKey | API密钥管理 |
| **配额** | GetQuotaUsageInternal, ResetQuotaUsageInternal, GetOverageBalanceInternal, AdjustOverageBalanceInternal | 配额内部API |
| **内部** | RemoveUsersFromTeamInternal, BulkDeleteUsersInternal, BulkDeleteUsersInternalFromBigQuery, ExportUserDataInternal, VerifyAccountOwnershipInternal, AddExtraFlexCreditsInternal, UpdateTeamNameInternal, UpdatePlanDetailsInternal | 内部管理 |
| **其他** | IsValidReferralCode, ProcessReferralCode, GetCascadeAnalytics, GetWrapped2024, SetTeamLicense, CheckProTrialEligibility, GetMucsInfo, UpdateCodeSnippetTelemetry, GetStripeSubscriptionState, InvalidateDevinCaches | 杂项 |

### 56.2 Windsurf/Devin 认证链 (新发现)

```
WindsurfPostAuth(auth1_token)
    → session_token + orgs[]
GetSelfDevinSessionToken(session_token)
    → devin_session_token
ExchangeDevinCode(code)
    → exchange code for token
InvalidateDevinCaches()
    → 清除Devin缓存
```

### 56.3 关键新 RPCs

- **CheckProTrialEligibility**: Pro试用资格检查
- **GetSetUserApiProviderKeys / SetUserApiProviderKey / DeleteUserApiProviderKey**: 用户自定义API Provider密钥 (BYOK)
- **GetApiKeySummary / DeleteApiKey**: API密钥摘要和删除
- **GetWrapped2024**: 2024年度总结
- **GetMucsInfo**: MUCS (Multi-User Cascade Session) 信息
- **ShowSSOAddOn**: SSO附加功能展示
- **GetStripeSubscriptionState**: Stripe订阅状态
- **GetOverageBalanceInternal / AdjustOverageBalanceInternal**: 超额余额管理

---

## 最终统计

| 指标 | 数值 |
|------|------|
| **文档总章节** | 56 |
| **Proto 文件分析** | 41 个 (全部) |
| **gRPC/Connect Services** | 20+ |
| **SeatManagement RPCs** | 152 |
| **ApiServer RPCs** | 171 |
| **LanguageServer RPCs** | 172 |
| **ExtensionServer RPCs** | 50 |
| **Analytics RPCs** | 10 (8 + 2 product) |
| **ContextUseCase** | 9 |
| **ContextChangeType** | 8 |
| **DiffType** | 3 (Unified, Character, Combo) |
| **轨迹筛选模式** | 5 |
| **ACU 计费 RPCs** | 9 |
| **认证方式** | 9 (Firebase, OTT, PKCE, SSO, Devin, WindsurfPost, GitHub, Code Exchange, VerifyOwnership) |

---

## 57. cortex.proto 完整枚举目录 (3071行)

> 来源: `cortex.proto` 全文分析 — 46 enum + 主要 message 定义

### 57.1 CortexStepType (87种工具/步骤)

```protobuf
enum CortexStepType {
  // 基础
  DUMMY = 1; FINISH = 2; ERROR_MESSAGE = 17; USER_INPUT = 14;
  PLANNER_RESPONSE = 15; INFORM = 11; BLOCKING = 74;

  // 代码操作
  CODE_ACTION = 5; WRITE_TO_FILE = 16; PROPOSE_CODE = 24;
  LINT_DIFF = 53; LINT_FIX_MESSAGE = 90; FIND_ALL_REFERENCES = 54;

  // 搜索/浏览
  GREP_SEARCH = 7; GREP_SEARCH_V2 = 91; VIEW_FILE = 8;
  VIEW_FILE_OUTLINE = 47; LIST_DIRECTORY = 9; FIND = 25;
  MQUERY = 4; CLUSTER_QUERY = 18; LIST_CLUSTERS = 19;
  INSPECT_CLUSTER = 20; VIEW_CODE_ITEM = 13; FILE_BREAKDOWN = 12;
  FIND_CODE_CONTEXT = 87;

  // 命令执行
  RUN_COMMAND = 21; COMMAND_STATUS = 28; READ_TERMINAL = 65;
  RUN_EXTENSION_CODE = 57;

  // Git
  GIT_COMMIT = 6; POST_PR_REVIEW = 49;

  // Memory/Brain
  MEMORY = 29; RETRIEVE_MEMORY = 34; BRAIN_UPDATE = 55;

  // 知识库/Web
  SEARCH_KNOWLEDGE_BASE = 26; LOOKUP_KNOWLEDGE_BASE = 30;
  READ_KNOWLEDGE_BASE_ITEM = 50; READ_URL_CONTENT = 31;
  VIEW_CONTENT_CHUNK = 32; SEARCH_WEB = 33;

  // Deploy
  DEPLOY_WEB_APP = 44; READ_DEPLOYMENT_CONFIG = 46;
  CHECK_DEPLOY_STATUS = 48; PROXY_WEB_SERVER = 43;

  // MCP
  MCP_TOOL = 38; LIST_RESOURCES = 51; READ_RESOURCE = 52;

  // Custom Tool / Recipe
  CUSTOM_TOOL = 36; CREATE_RECIPE = 37;

  // Multi-Agent / Proposal
  MANAGER_FEEDBACK = 39; TOOL_CALL_PROPOSAL = 40;
  TOOL_CALL_CHOICE = 41; TRAJECTORY_CHOICE = 42;
  PROPOSAL_FEEDBACK = 59; TRAJECTORY_SEARCH = 60;

  // CodeMap
  UPSERT_CODEMAP = 92; SUGGEST_CODEMAP = 93;

  // AI / 研究
  CHECKPOINT = 23; RELATED_FILES = 22; SUGGESTED_RESPONSES = 27;
  EXPLORE_RESPONSE = 80; SMART_FRIEND = 94;

  // Supercomplete
  SUPERCOMPLETE_ACTIVE_DOC = 86; SUPERCOMPLETE_FEEDBACK = 89;
  SUPERCOMPLETE_EPHEMERAL_FEEDBACK = 102;

  // 其他
  COMPILE = 10; AUTO_CASCADE_BROADCAST = 35; CLIPBOARD = 45;
  ADD_ANNOTATION = 58; TODO_LIST = 73; DO_TESTING = 95;
  REPORT_BUGS = 97; EXIT_PLAN_MODE = 99; ASK_USER_QUESTION = 100;
  SKILL = 101; ARENA_TRAJECTORY_CONVERGE = 103; TASK_SUBAGENT = 104;
  ARTIFACT_SUMMARY = 71; RESOLVE_TASK = 72;
  READ_NOTEBOOK = 82; EDIT_NOTEBOOK = 83;
}
```

### 57.2 完整枚举索引 (46个)

| 枚举名 | 值数 | 用途 |
|--------|------|------|
| **ActionStatus** | 8 | 操作生命周期 (Initialized→Preparing→Prepared→Applying→Applied→Rejected) |
| **PlanStatus** | 5 | 计划状态 |
| **CortexRequestSource** | 3 | 请求来源 (CASCADE/USER_IMPLICIT) |
| **CortexTrajectorySource** | 13 | 轨迹来源 (包含 ASYNC_PRR/CF/SL/PRD/CM) |
| **CortexTrajectoryType** | 19 | 轨迹类型 (包含 LLM_JUDGE/ARTIFACT_SUMMARY) |
| **CortexStepSource** | 6 | 步骤来源 (MANUAL/MODEL/USER_IMPLICIT/USER_EXPLICIT/SYSTEM) |
| **CortexStepCreditReason** | 2 | 计费折扣原因 (LINT_FIXING_DISCOUNT) |
| **ExecutionAsyncLevel** | 4 | 异步级别 (INVOCATION_BLOCKING/EXECUTOR_BLOCKING/FULL_ASYNC) |
| **CortexStepStatus** | 11 | 步骤状态 (含 GENERATING/HALTED/WAITING/SKIPPING) |
| **CascadeRunStatus** | 5 | 运行状态 (IDLE/RUNNING/CANCELING/BUSY) |
| **BrainFilterStrategy** | 3 | Brain过滤策略 |
| **SectionOverrideMode** | 4 | Prompt段覆盖 (OVERRIDE/APPEND/PREPEND) |
| **AgenticMixin** | 3 | Agent混入 (SMARTLINT/PR_REVIEW) |
| **CascadeAgentToolSet** | 4 | Agent工具集限制 |
| **ReplaceToolVariant** | 7 | 替换工具变体 (search_replace/apply_patch/openai_apply_patch/freeform) |
| **RunCommandAction** | 4 | 命令确认 (CONFIRM/REJECT/SKIP) |
| **ReadUrlContentAction** | 4 | URL读取许可 (ALLOW_ONCE/REJECT/ALWAYS_ALLOW_ORIGIN) |
| **CortexStepType** | 66 | 工具/步骤类型 (见上方) |
| **SemanticCodebaseSearchType** | 3 | 语义搜索类型 (MQUERY/VECTOR_INDEX) |
| **AcknowledgementType** | 3 | 确认类型 (ACCEPT/REJECT) |
| **CodeHeuristicFailure** | 3 | 代码启发失败 (LAZY_COMMENT/DELETED_LINES) |
| **InformPlannerMode** | 4 | 通知Planner模式 (CCIS/DIRECTORY_TREE/CLUSTERS) |
| **FindResultType** | 4 | 查找结果类型 (FILE/DIRECTORY/ANY) |
| **AutoRunDecision** | 10 | 自动执行决策 (USER/SYSTEM/MODEL/DEFAULT × ALLOW/DENY + SKIP) |
| **DeployWebAppFileUploadStatus** | 5 | 部署上传状态 |
| **ExecutorTerminationReason** | 8 | 执行器终止原因 (含 HOOK_BLOCKED/ARENA_INVOCATION_CAP) |
| **LintDiffType** | 4 | Lint差异类型 |
| **BrainEntryType** | 3 | Brain条目 (PLAN/TASK) |
| **TaskStatus** | 4 | 任务状态 (TODO/IN_PROGRESS/DONE) |
| **TaskDeltaType** | 6 | 任务变更 (ADD/PRUNE/DELETE/UPDATE/MOVE) |
| **BrainUpdateTrigger** | 5 | Brain更新触发 (含 RESEARCH_NEW_INFO) |
| **CommandOutputPriority** | 4 | 命令输出优先级 (TOP/BOTTOM/SPLIT) |
| **CortexMemorySource** | 4 | 记忆来源 (USER/CASCADE/AUTO_CASCADE) |
| **CortexMemoryTrigger** | 5 | 记忆触发 (ALWAYS_ON/MODEL_DECISION/MANUAL/GLOB) |
| **RuleSource** | 3 | 规则来源 (WORKSPACE/SYSTEM) |
| **SkillSource** | 4 | 技能来源 (WORKSPACE/GLOBAL/SYSTEM) |
| **MemoryActionType** | 4 | 记忆操作 (CREATE/UPDATE/DELETE) |
| **CortexStepManagerFeedbackStatus** | 4 | Manager反馈 (APPROVED/DENIED/ERROR) |
| **McpServerStatus** | 5 | MCP服务器状态 (含 NEEDS_OAUTH) |
| **CortexTodoListItemStatus** | 4 | TODO项状态 |
| **CortexTodoListItemPriority** | 4 | TODO优先级 |
| **TrajectoryShareStatus** | 2 | 轨迹共享 (TEAM) |
| **RunExtensionCodeAutoRunDecision** | 5 | 扩展代码自动执行 |
| **TrajectorySearchIdType** | 3 | 轨迹搜索ID类型 (CASCADE_ID/MAINLINE) |
| **HookAgentAction** | 13 | Hook触发动作 (含 POST_SETUP_WORKTREE, POST_CASCADE_RESPONSE_WITH_TRANSCRIPT) |

---

## 58. Checkpoint System (模型检查点)

> 来源: blackbox Section 14 + `cortex.proto`

### 58.1 Binary 函数分析 (51+ 匹配)

```
GetCheckpoint, GetCheckpointDir, GetCheckpointIndex,
GetCheckpointConfig, GetCheckpointModelUid,
GetCheckpointFrequency, GetCheckpointPathToLoad,
GetCheckpointStagingDir, GetUseCheckpointCache,
GetAsyncCheckpoints, maybeAddCheckpointStep,
fallbackCheckpointModel, GetHoldForValidCheckpoint,
GetNumCheckpointsForContext, GetFreezeCheckpointWeights,
GetGradientCheckpointing, GetMaxStepsPerCheckpoint
```

### 58.2 CheckpointConfig (Cortex层)

```protobuf
// cortex.proto
CORTEX_TRAJECTORY_TYPE_CHECKPOINT = 6;
CORTEX_STEP_TYPE_CHECKPOINT = 23;

// 从二进制提取的 CheckpointConfig 字段:
message CheckpointConfig {
  string checkpoint_dir = ?;
  string checkpoint_path_to_load = ?;
  string checkpoint_staging_dir = ?;
  string checkpoint_model_uid = ?;
  int32 checkpoint_frequency = ?;
  int32 max_steps_per_checkpoint = ?;
  bool async_checkpoints = ?;
  bool use_checkpoint_cache = ?;
  bool gradient_checkpointing = ?;
  bool hold_for_valid_checkpoint = ?;
  bool freeze_checkpoint_weights = ?;
  int32 num_checkpoints_for_context = ?;
}
```

### 58.3 TrajectoryPrefixMetadata (上下文压缩)

```protobuf
message TrajectoryPrefixMetadata {
  uint32 length = 1;          // 前缀长度
  uint32 tokens = 2;          // token数
  uint32 num_skipped = 3;     // 跳过的步骤数
  uint32 num_truncated = 4;   // 截断的步骤数
}
```
- 轨迹过长时自动跳过/截断早期步骤
- `MemoryConfig.num_checkpoints_for_context` 控制保留检查点数

---

## 59. Overage & Valkey (Redis替代)

> 来源: blackbox Section 15

### 59.1 Valkey 缓存层

```protobuf
// GetOverageBalanceInternalResponse 字段:
message GetOverageBalanceInternalResponse {
  int64 balance_micros = ?;
  bool exists_in_valkey = 2;           // Valkey (Redis兼容) 缓存命中
  int64 postgres_balance_micros = 3;   // PostgreSQL 持久层
  int64 overage_balance_micros = 16;   // 超额余额 (微单位)
}
```

### 59.2 架构解读

```
[用户请求] → CheckChatCapacity
    → GetOverageBalanceInternal
        → Valkey (Redis) 快速读取
        → Postgres fallback (持久存储)
    → exists_in_valkey: 缓存是否命中
    → AdjustOverageBalanceInternal: 扣费/调整
```

- **Valkey**: Redis的开源fork，用作高性能缓存层
- **Postgres**: 持久化余额存储
- **balance_micros**: 微单位余额 (÷1,000,000 = 实际额度)

---

## 60. Recipe / Custom Tool System

> 来源: blackbox Section 17 + `cortex.proto`

### 60.1 Proto 定义

```protobuf
// 自定义工具规范
message CustomToolSpec {
  string recipe_id = 1;
  ChatToolDefinition tool_definition = 2;    // 工具定义 (JSON Schema)
  string system_prompt = 3;                   // 独立 system prompt
  CascadeConfig config_override = 4;          // Cascade配置覆盖
  CortexTrajectory reference_trajectory = 5;  // 参考轨迹
  bool requires_write_mode = 6;               // 是否需要写权限
  bool is_builtin = 7;                        // 是否内置
}

// 执行步骤
message CortexStepCustomTool {
  string recipe_id = 1;
  string arguments_json = 2;     // 工具参数 (JSON)
  string output = 3;             // 输出
  string recipe_name = 4;
}

// 创建 Recipe
message CortexStepCreateRecipe {
  CustomToolSpec recipe = 1;
  string reference_trajectory_id = 2;        // 从已有轨迹学习
  repeated uint32 reference_step_indices = 3; // 引用的步骤索引
}
```

### 60.2 Recipe 生命周期

```
1. 用户执行一系列操作 → 生成 Trajectory
2. CreateRecipe: 从轨迹提取步骤 → 生成 CustomToolSpec
3. CustomToolSpec 包含:
   - tool_definition: JSON Schema 定义输入参数
   - system_prompt: 独立 prompt 指导行为
   - reference_trajectory: 示例轨迹
4. CortexStepCustomTool: 执行自定义工具
   - recipe_id 关联, arguments_json 传参
```

### 60.3 RecipeScopeItem

```
recipe_id + title → 在 ContextScope 中引用
recipe_ids → 在 CascadeConfig 和 experimentConfig 中配置
```

### 60.4 Binary 引用

```
CustomToolHandler, CustomToolStringConverter,
ReportBugsToolConverter (内置 Recipe),
custom_tool_handler.go (独立 handler 文件)
CORTEX_TRAJECTORY_TYPE_CUSTOM_TOOL = 8
CORTEX_STEP_TYPE_CUSTOM_TOOL = 36
CORTEX_STEP_TYPE_CREATE_RECIPE = 37
```

---

## 61. Heuristic Prompts & Ephemeral Messages

> 来源: blackbox Section 18 + `cortex.proto`

### 61.1 EphemeralMessagesConfig

```protobuf
message EphemeralMessagesConfig {
  optional bool enabled = 1;
  uint32 num_steps = 2;                              // 每N步注入
  repeated HeuristicPrompt heuristic_prompts = 3;    // 启发式提示列表
}

message HeuristicPrompt {
  string heuristic = 1;   // 触发条件/启发式名称
  string prompt = 2;      // 注入的 prompt 内容
}
```

### 61.2 工作机制

```
对话进行中 → 每 num_steps 步 → 检查 heuristic 条件
    → 匹配时注入 <ephemeral_message> 到对话流
    → 模型可看到但用户不可见的引导提示

二进制字符串证据:
"There will be an <ephemeral_message> appearing in the conversation at times"
```

### 61.3 Planner 集成

```
CascadePlannerConfig {
  include_ephemeral_message = 20;      // oneof 可选
  ephemeral_messages_config = 21;      // 配置
}
```

- **EphemeralMessageSection**: 独立的 Prompt Section 模块
- 启发式包含: 防止 lazy comment, 确保正确工具调用等

---

## 62. Proposal Feedback & Multi-Agent Orchestration

> 来源: blackbox Section 19-20 + `cortex.proto`

### 62.1 Proposal 工作流 (4步)

```
Step 1: ToolCallProposal
    模型提出工具调用建议
    message CortexStepToolCallProposal {
      ChatToolCall tool_call = 1;
    }

Step 2: ToolCallChoice (多方案选择)
    从多个提案中选择
    message CortexStepToolCallChoice {
      repeated ChatToolCall proposal_tool_calls = 1;
      uint32 choice = 2;
      string reason = 3;
    }

Step 3: TrajectoryChoice (多轨迹选择)
    从多条执行路径中选择
    message CortexStepTrajectoryChoice {
      repeated string proposal_trajectory_ids = 1;
      int32 choice = 2;
      string reason = 3;
    }

Step 4: ProposalFeedback (用户反馈)
    用户对建议进行确认/拒绝
    message CortexStepProposalFeedback {
      oneof target {
        ReplacementChunk replacement_chunk = 3;
      }
      AcknowledgementType acknowledgement_type = 1;
      uint32 target_step_index = 2;
    }
```

### 62.2 Manager Feedback (Multi-Agent)

```protobuf
message CortexStepManagerFeedback {
  CortexStepManagerFeedbackStatus status = 1;  // APPROVED/DENIED/ERROR
  string feedback = 2;
}

enum CortexStepManagerFeedbackStatus {
  UNSPECIFIED = 0;
  APPROVED = 1;    // Manager 批准
  DENIED = 2;      // Manager 拒绝
  ERROR = 3;       // Manager 出错
}
```

### 62.3 Multi-Agent 架构

```
TrajectoryType 关系:
  AUTO_CASCADE_MANAGER = 10   // Manager 轨迹
  TOOL_CALL_PROPOSAL = 12    // 工具提案轨迹
  TRAJECTORY_CHOICE = 13     // 轨迹选择轨迹
  LLM_JUDGE = 14             // LLM 评判轨迹
  INTERACTIVE_CASCADE = 17   // 交互式 Cascade

工作流:
  Manager Agent
    ├→ 子 Agent 1 → Trajectory A
    ├→ 子 Agent 2 → Trajectory B
    └→ LLM Judge → 评分 → TrajectoryChoice → 选择最优
```

### 62.4 ReplacementChunk (原子编辑单元)

```
ReplacementChunk: 代码替换的原子单元
ReplacementChunkInfo: 含元信息
ReplacementChunkNoAllowMultiple: 不允许多选

ReplaceToolVariant:
  REPLACEMENT_CHUNK = 1       // 原始块替换
  SEARCH_REPLACE = 2          // 搜索替换
  APPLY_PATCH = 3             // 补丁应用
  SINGLE_MULTI = 4            // 单/多编辑
  OPENAI_APPLY_PATCH = 5      // OpenAI格式补丁
  FREEFORM_APPLY_PATCH = 6    // 自由格式补丁
```

---

## 63. 完整 CortexTrajectory Step 消息目录

> 来源: `cortex.proto` 全文

### 63.1 CortexTrajectoryStep.step oneof (推断)

| Step Message | Field# | 说明 |
|-------------|--------|------|
| CortexStepClipboard | 45 | 剪贴板内容 |
| CortexStepCommandStatus | 28 | 命令执行状态 |
| CortexStepCustomTool | 36 | 自定义工具调用 |
| CortexStepCreateRecipe | 37 | 创建 Recipe |
| CortexStepMcpTool | 38 | MCP 工具调用 |
| CortexStepManagerFeedback | 39 | Manager 反馈 |
| CortexStepToolCallProposal | 40 | 工具调用提案 |
| CortexStepToolCallChoice | 41 | 工具调用选择 |
| CortexStepTrajectoryChoice | 42 | 轨迹选择 |
| CortexStepProxyWebServer | 43 | 代理Web服务器 |
| CortexStepDeployWebApp | 44 | 部署Web应用 |
| CortexStepCheckDeployStatus | 48 | 检查部署状态 |
| CortexStepPostPrReview | 49 | PR Review |
| CortexStepListResources | 51 | 列出MCP资源 |
| CortexStepReadResource | 52 | 读取MCP资源 |
| CortexStepLintDiff | 53 | Lint差异 |
| CortexStepFindAllReferences | 54 | 查找所有引用 |
| CortexStepBrainUpdate | 55 | Brain更新 |
| CortexStepRunExtensionCode | 57 | 运行扩展代码 |
| CortexStepAddAnnotation | 58 | 添加注释 |
| CortexStepProposalFeedback | 59 | 提案反馈 |
| CortexStepTrajectorySearch | 60 | 轨迹搜索 |
| CortexStepReadTerminal | 65 | 读取终端 |
| CortexStepDeepThink | 68? | 深度思考 |
| CortexStepArtifactSummary | 71 | 制品摘要 |
| CortexStepResolveTask | 72 | 解析任务 |
| CortexStepTodoList | 73 | TODO列表 |
| CortexStepViewFileOutline | 47 | 文件大纲 |
| CortexStepExitPlanMode | 99 | 退出Plan模式 |
| CortexStepReportBugs | 97 | 报告Bug |
| CortexStepSkill | 101 | 技能调用 |
| CortexStepAutoCascadeBroadcast | 35 | Auto Cascade 广播 |
| CortexStepMemory | 29 | 记忆操作 |
| CortexStepRetrieveMemory | 34 | 检索记忆 |
| CortexStepCodeMap | - | CodeMap内容 |
| CortexStepEditCodeMap | - | 编辑CodeMap |
| CortexStepUpsertCodemap | 92 | 插入/更新CodeMap |
| CortexStepSuggestCodemap | 93 | CodeMap建议 |

### 63.2 Memory 系统完整模型

```protobuf
CortexMemory
  ├─ memory_id, title, parse_error
  ├─ CortexMemoryText { content }
  ├─ CortexMemoryMetadata { created_at, last_modified, last_accessed, tags, user_triggered }
  ├─ CortexMemorySource { USER | CASCADE | AUTO_CASCADE }
  └─ CortexMemoryScope (5种):
       ├─ GlobalScope {}
       ├─ LocalScope { corpus_names[], base_dir_uris[], repo_base_dir_uri }
       ├─ AllScope {}
       ├─ SystemScope {}
       └─ ProjectScope { file_path, absolute_file_path, base_dir_uris[],
                          corpus_names[], trigger, description, globs[], rule_source }

MemoryConfig
  ├─ memory_model_uid
  ├─ num_checkpoints_for_context
  ├─ num_memories_to_consider
  ├─ max_global_cascade_memories
  ├─ condense_input_trajectory
  ├─ add_user_memories_to_system_prompt
  └─ enabled
```

### 63.3 Hooks 完整模型

```protobuf
HookAgentAction (13种):
  PRE/POST_READ_CODE, PRE/POST_WRITE_CODE,
  PRE/POST_MCP_TOOL_USE, PRE/POST_RUN_COMMAND,
  PRE_USER_PROMPT, POST_CASCADE_RESPONSE,
  POST_SETUP_WORKTREE,
  POST_CASCADE_RESPONSE_WITH_TRANSCRIPT  // 含完整对话记录!

CascadeHook {
  HookExecutionSpec hook_spec;    // command + working_directory + show_output + powershell_command
  HookCondition condition;         // 触发的 agent_actions[]
  repeated string workspace_dirs;  // 适用工作区
}

HookExecutionResult {
  CommandHookResult { exit_code, stdout, stderr }
}

ExecutorTerminationReason:
  HOOK_BLOCKED = 6  // Hook可阻止执行!
```

---

## 最终统计更新

| 指标 | 数值 |
|------|------|
| **文档总章节** | 63 |
| **cortex.proto 行数** | 3,071 |
| **cortex.proto 枚举** | 46 |
| **CortexStepType** | 66 种 |
| **CortexTrajectoryType** | 19 种 |
| **CortexTrajectorySource** | 13 种 |
| **CortexStepMessage** | 38+ 种 |
| **ReplaceToolVariant** | 6 种 (含 openai_apply_patch) |
| **HookAgentAction** | 13 种 (含 POST_CASCADE_RESPONSE_WITH_TRANSCRIPT) |
| **CortexMemoryScope** | 5 种 (Global/Local/All/System/Project) |
| **ExecutorTerminationReason** | 7 种 |
| **Blackbox 已分析节数** | 20/20 (全部完成) |

---

## 64. ACP (Agent Communication Protocol) — Chisel Agent 通信

> 来源: `extensions/windsurf/dist/acp/AGENTS.md` + `extension.js` 字符串提取

### 64.1 ACP 概述

ACP 是 Windsurf IDE 与 Chisel Agent (Devin) 之间的通信协议。
- 连接管理: `WindsurfAcpConnector` 类
- 代理二进制: `devin/bin/devin.exe` (Devin for Terminal, Rust编写)
- 分发标记: `devin/distribution` → "windsurf-next"

### 64.2 Initialize 握手 — ClientCapabilities

```json
{
  "clientInfo": { "name": "windsurf", "version": "<ideVersion>" },
  "clientCapabilities": {
    "elicitation": { "form": {} },
    "fs": { "readTextFile": true, "writeTextFile": true },
    "_meta": {
      "cognition.ai/subagentSupport": true,
      "cognition.ai/multiRootWorkspace": true,
      "cognition.ai/partialContent": true,
      "cognition.ai/messageGrouping": true,
      "cognition.ai/groupedSessionConfigOptions": true,
      "cognition.ai/revert": true,
      "cognition.ai/mcp": true,
      "cognition.ai/requestDiagnostics": "<BackgroundLintManager.enabled>"
    }
  }
}
```

### 64.3 ACP Session Methods (22个)

| 方法 | 方向 | 说明 |
|------|------|------|
| `session/new` | Client→Agent | 新建会话 |
| `session/prompt` | Client→Agent | 发送用户消息 |
| `session/cancel` | Client→Agent | 取消当前执行 |
| `session/close` | Client→Agent | 关闭会话 |
| `session/fork` | Client→Agent | 分叉会话 |
| `session/list` | Client→Agent | 列出会话 |
| `session/load` | Client→Agent | 加载会话 |
| `session/resume` | Client→Agent | 恢复会话 |
| `session/update` | Agent→Client | 更新会话状态 |
| `session/set_config_option` | Client→Agent | 设置配置 |
| `session/set_mode` | Client→Agent | 设置权限模式 |
| `session/set_model` | Client→Agent | 设置模型 |
| `session/request_permission` | Agent→Client | 请求权限 |
| `session/rename` | Client→Agent | 重命名会话 |

### 64.4 ACP Notification Methods

| 方法 | 说明 |
|------|------|
| `notifications/initialized` | 初始化完成 |
| `notifications/message` | 消息通知 |
| `notifications/progress` | 进度通知 |
| `notifications/cancelled` | 取消通知 |
| `notifications/resources/updated` | 资源更新通知 |

### 64.5 ACP File System Methods

| 方法 | 说明 |
|------|------|
| `fs/read_text_file` | 读取文本文件 |
| `fs/write_text_file` | 写入文本文件 |
| `elicitation/create` | 创建用户提问 |
| `elicitation/complete` | 完成用户提问 |

### 64.6 ACP Extension Methods (Agent→IDE)

```
_cognition.ai/request_diagnostics    // 请求 lint 诊断信息
_cognition.ai/revert/execute         // 执行回退
_cognition.ai/revert/preview         // 预览回退
cognition.ai/revert/listSteps        // 列出可回退步骤
cognition.ai/revert/forkFromStep     // 从某步骤分叉
cognition.ai/mcp/listServers         // 列出 MCP 服务器
cognition.ai/mcp/toggleServer        // 启用/禁用 MCP 服务器
cognition.ai/mcp/toggleTool          // 启用/禁用 MCP 工具
```

### 64.7 cognition.ai/ 元数据键 (100+)

**会话/消息:**
- `session`, `sessionPRs`, `sessionRepos`, `sessionArchiving`, `sessionLifecycle`
- `sessionRename`, `sessionListContentSearch`, `sessionListRefetch`
- `sessionUnreadTracking`, `sortUpdatedAt`, `streamingMessageId`
- `clientMessageId`, `messageGrouping`, `messageSubIndex`

**代码/工具:**
- `action`, `actions`, `toolName`, `inferenceToolName`
- `inputTokens`, `outputTokens`, `cachedReadTokens`, `cachedWriteTokens`
- `thinkingDurationMs`, `inputKey`, `outputKey`

**Subagent:**
- `subagentSupport`, `subagent_started`, `subagent_context`, `subagent_completed`

**文件/工作区:**
- `additionalWorkspaceDirs`, `listDirectory`, `contentsKey`
- `overwrite`, `scope`, `endLine`

**UI/展示:**
- `icon`, `title`, `summary`, `statusMessage`, `statusReason`
- `statusEnum`, `activityEnum`, `isTyping`, `isExitPlan`, `isOptimistic`
- `promoLabel`, `promoTooltip`, `featured`, `hidden`, `hiddenResource`
- `showContentWithExternalLinks`, `videoPath`, `screenshotKeys`

**权限/安全:**
- `permissionType`, `approved`, `secretName`, `secretNames`, `secretSend`
- `secretType`, `envVarName`, `canManageMcpServers`, `canManageOrgSecrets`

**PR/Git:**
- `proposedByDevinId`, `prManagement`, `prTitle`, `pullNumber`
- `repo`, `htmlUrl`, `botUsername`, `worktreeFor`

**上传:**
- `httpUpload`, `httpUploadUrl`, `httpUploadMaxBytes`, `maxEmbeddedResourceBytes`

---

## 65. Windsurf Extension 架构

> 来源: `extensions/windsurf/package.json` + `extension.js`

### 65.1 Package Info

```json
{
  "name": "windsurf",
  "publisher": "codeium",
  "version": "0.2.0",
  "main": "./dist/extension.js",  // 9.6MB, 3行 (minified)
  "activationEvents": ["*"]       // 所有事件激活!
}
```

### 65.2 Proposed APIs (内部 VSCode API)

```
contribSourceControlInputBoxMenu, windsurfEditorNudge,
windsurfAuth, windsurfAcp, inlineCompletionsAdditions,
findFiles2, terminalDataWriteEvent
```

### 65.3 Commands (31个)

| 类别 | 命令 |
|------|------|
| **认证** | login, logout, loginWithAuthToken, copyApiKey |
| **导入** | importVSCodeSettings/Extensions, importCursorSettings/Extensions, importWindsurfSettings/Extensions, importVSCodeRecentWorkspaces, importRulesFromCursor |
| **IDE** | restartLanguageServer, resetProductEducation, downloadDiagnostics, openBrowser |
| **账户** | openProfile, openBillingPage, openAutoRefillPage, openChangeLog |
| **Cascade** | triggerCascade, addCurrentFileToChat, generateCommitMessage |
| **工作流/规则** | createWorkflow, createGlobalWorkflow, createRule, openGlobalRules, openWorkspaceRules |
| **ACP** | setPortalUrl, reloadAcpConnections, openAcpLocalRegistry |
| **Lifeguard** | lifeguard.checkCurrentChanges, lifeguard.evaluateDataset |

### 65.4 Configuration Keys (26个)

| 键 | 类型 | 说明 |
|-----|------|------|
| `windsurf.acp.enabled` | bool | ACP 连接开关 |
| `windsurf.acp.preferredAgent` | string | 首选代理 |
| `windsurf.acp.enabledAgents` | array | 启用的代理列表 |
| `windsurf.acp.agentEnv` | object | 代理环境变量 |
| `windsurf.acp.diffZonesEnabled` | bool | ACP Diff区域 |
| `windsurf.cascade.enabled` | bool | Cascade 开关 |
| `windsurf.cascade.readClaudeCodeConfig` | bool | 读取 Claude Code 配置 |
| `windsurf.completionMode` | string | 补全模式 |
| `windsurf.autoContinue` | bool | 自动继续 |
| `windsurf.allowCascadeAccessGitignoreFiles` | bool | 允许访问 gitignore 文件 |
| `windsurf.lifeguard.enabled` | bool | Lifeguard 开关 |
| `windsurf.lifeguard.mode` | string | Lifeguard 模式 |
| `windsurf.lifeguard.triggerOnCommit` | bool | Commit 时触发 |
| `windsurf.lifeguard.triggerOnCascade` | bool | Cascade 时触发 |
| `windsurf.terminal.shellTimeoutMs` | number | Shell 超时 |
| `windsurf.terminal.cascadeProfile.*` | string | 终端 Profile (osx/linux/windows) |
| `windsurf.portalUrl` | string | Portal URL |
| `windsurf.searchMaxWorkspaceFileCount` | number | 搜索文件上限 |
| `windsurf.useIndexingV2` | bool | 索引V2 |
| `windsurf.indexingRetentionPeriod` | number | 索引保留期 |

### 65.5 Internal Commands (从 extension.js 提取)

```
windsurf.clearAcpMetadataCache
windsurf.clearManagedTerminalBuffer
windsurf.cascade.unmountAllDiffZones
windsurf.deleteGlobalRules
windsurf.deleteWorkspaceFile
windsurf.generateCodeMap
windsurf.isCodemapsEnabled
windsurf.loadCodeMap
windsurf.multiTenantMode
windsurf.muteUserSettingsSyncAlarm
windsurf.onManagedTerminalExit
windsurf.onShellCommandCompletion / Start
windsurf.openCascadeInNewGroup
windsurf.openFolderInNewWindow
windsurf.openGenericUrl
windsurf.pendingApiKeyMigration
windsurf.runManagedTerminalCommand
windsurf.sendChatActionMessage
windsurf.setWorkspaceCascadeMap
windsurf.updateTerminalLastCommand
windsurf.workflowEditor
windsurf.lifeguard.addMemory / cancelCheck / editCustomRules
windsurf.lifeguard.enable / getAvailableModes / getCascadeUserMessages
windsurf.lifeguard.getParentRepoForFile / getSuggestedBaseRef / runCheck
windsurf.state.lastSelectedCascadeModelUids
```

---

## 66. product.json 关键配置

> 来源: `windsurf-next/resources/app/product.json`

```json
{
  "nameShort": "Windsurf - Next",
  "applicationName": "windsurf-next",
  "aliasName": "surf-next",
  "dataFolderName": ".windsurf-next",
  "serverApplicationName": "windsurf-server-next",
  "tunnelApplicationName": "windsurf-tunnel",
  "darwinBundleIdentifier": "com.exafunction.windsurfNext",
  "urlProtocol": "windsurf-next",

  "zendeskTicketApiKey": "1d83db0009861157cacd3279a927855f53279e48c84bd26d2ba48d241699773d",
  "enableTelemetry": true,
  "aiConfig": { "ariaKey": "windsurf" },

  "extensionsGallery": {
    "serviceUrl": "https://marketplace.windsurf.com/vscode/gallery",
    "itemUrl": "https://marketplace.windsurf.com/vscode/item"
  },

  "extensionUntrustedWorkspaceSupport": {
    "codeium.windsurf": { "override": true }
  },

  "commandPaletteSuggestedCommandIds": ["windsurf.prioritized.chat.open"],

  "webviewContentExternalBaseUrlTemplate":
    "https://{{uuid}}.vscode-cdn.net/insider/<commit>/out/vs/workbench/contrib/webview/browser/pre/"
}
```

### 66.1 Devin CLI 集成

```
Devin for Terminal:
  - 二进制: extensions/windsurf/devin/bin/devin.exe
  - 权限模式: Normal, Accept Edits, Bypass, Autonomous
  - 沙箱: --sandbox 模式 (OS级别隔离)
  - 认证: devin auth login → Windsurf SSO
  - 会话: REPL模式 + 单次模式(-p)
  - 计费: Windsurf credit model 共享计费

Slash Commands:
  /mode, /plan, /ask, /bypass, /yolo, /dangerous
  /loop <prompt>     // 自动循环 prompt+review
  /compact           // 强制对话压缩
  /resume, /continue // 会话恢复
  /hooks             // 查看 hooks
  /model             // 模型选择
```

### 66.2 ACP Registry Schema

```json
{
  "version": "semver",
  "agents": [{
    "id": "lowercase-alphanumeric-with-hyphens",
    "name": "human-readable",
    "version": "semver",
    "distribution": {
      "binary": {
        "darwin-aarch64": { "archive": "url", "cmd": "...", "args": [], "env": {} },
        "linux-x86_64": { ... },
        "windows-x86_64": { ... }
      },
      "npx": { "package": "...", "args": [], "env": {} },
      "docker": { "image": "...", "tag": "...", "args": [], "env": {} }
    }
  }]
}
```
- 支持 6 平台 (darwin/linux/windows × aarch64/x86_64)
- 3 种分发方式: binary, npx, docker

---

## 最终统计更新

| 指标 | 数值 |
|------|------|
| **文档总章节** | 66 |
| **ACP Session Methods** | 14+ |
| **ACP Notification Methods** | 5 |
| **ACP Extension Methods** | 8 |
| **cognition.ai/ 元数据键** | 100+ |
| **Extension Commands** | 31 (注册) + 30+ (内部) |
| **Extension Config Keys** | 26 |
| **extension.js 大小** | 9.6MB (minified) |
| **Devin CLI 权限模式** | 4 (Normal/AcceptEdits/Bypass/Autonomous) |
| **ACP Agent 分发方式** | 3 (binary/npx/docker) |
| **ACP 支持平台** | 6 |

---

## 67. Unleash Feature Flag 系统

> 来源: `extension.js` 字符串提取 + Unleash SDK 初始化代码

### 67.1 Unleash 服务器配置

```javascript
{
  url: "https://unleash.codeium.com/api/",
  appName: "codeium-extension",
  customHeaders: {
    Authorization: isStaging
      ? "*:development.fdc4aa60423d33842aff8b27b03a5eb79eae2303c68661eea8119354"
      : "*:production.ead56b58a77f5ac50d9aa4f987fe381cd78473ec0b1762d5bff9faca"
  },
  refreshInterval: 60000,   // 60秒刷新
  timeout: 2000             // 2秒超时
}
```

### 67.2 多租户模式

```
isMultiTenantMode():
  - true → 不初始化 Unleash, 使用 _enterpriseExperimentConfig
  - false → 标准 Unleash 初始化
  - 企业客户通过 OrganizationalControls 下发实验配置
```

### 67.3 初始化异常处理

```
1. 尝试 startUnleash(config)
2. 设置 5秒超时竞赛
3. 失败时 → Sentry 报错 + fallback到 initialize(config)
4. UnleashProvider.getInstance() 单例模式
```

---

## 68. 完整 URL 端点目录

> 来源: `extension.js` URL 提取

### 68.1 核心服务器

| URL | 用途 |
|-----|------|
| `https://server.codeium.com` | 主 API 服务器 |
| `https://server-staging.codeium.com` | 预发布 API |
| `https://register.windsurf.com` | SeatManagement / 认证 |
| `https://inference.codeium.com` | 推理服务器 (高性能补全) |
| `https://eu.windsurf.com` | 欧盟数据合规端点 |
| `https://eu.windsurf.com/_route/api_server` | 欧盟 API 路由 |
| `https://unleash.codeium.com/api/` | Feature Flag 服务 |

### 68.2 Government/FedRAMP

| URL | 用途 |
|-----|------|
| `https://windsurf.fedstart.com` | FedRAMP 合规端点 |
| `https://windsurf.fedstart.com/_route/api_server` | FedRAMP API 路由 |
| `https://your-company.windsurf.com` | 自托管模板 URL |

### 68.3 CDN / 前端

| URL | 用途 |
|-----|------|
| `https://cdn.windsurf.com/sourcemaps/...` | Source Map CDN |
| `https://windsurf.com` | 官网 |
| `https://docs.windsurf.com` | 文档 |
| `https://docs.windsurf.com/troubleshooting/windsurf-common-issues` | 故障排查 |
| `https://marketplace.windsurf.com/vscode/gallery` | 扩展市场 |

### 68.4 内部工具

| URL | 用途 |
|-----|------|
| `https://cascadeplayground.watchdevinwork.com/cascade_query/` | Cascade Playground (开发工具) |
| `https://exafunction.retool.com/apps/.../Supercomplete` | Supercomplete 内部管理面板 |
| `https://codeium-staging-exafunction.vercel.app` | 预发布前端 |

---

## 69. 完整 Feature Flags 目录 (269+)

> 来源: `extension.js` 常量字符串提取

### 69.1 CASCADE_ 标志 (137个)

**核心功能开关:**
```
CASCADE_AUTO_FIX_LINTS              // 自动修复 lint
CASCADE_ENABLE_AUTOMATED_MEMORIES   // 自动记忆
CASCADE_ENABLE_MCP_TOOLS            // MCP 工具
CASCADE_ENABLE_PROXY_WEB_SERVER     // 代理 Web 服务器
CASCADE_ENFORCE_QUOTA               // 配额强制
CASCADE_USE_EXPERIMENT_CHECKPOINTER // 实验性检查点
CASCADE_USE_REPLACE_CONTENT_EDIT_TOOL // 替换内容编辑工具
CASCADE_USER_MEMORIES_IN_SYS_PROMPT // 用户记忆注入系统提示
CASCADE_WEB_APP_DEPLOYMENTS_ENABLED // Web 应用部署
CASCADE_WINDSURF_BROWSER_TOOLS_ENABLED // 浏览器工具
CASCADE_RECIPES_AT_MENTION_VISIBILITY // Recipe @提及
```

**模型/配置覆盖:**
```
CASCADE_BASE_MODEL_ID
CASCADE_DEFAULT_MODEL_OVERRIDE
CASCADE_GLOBAL_CONFIG_OVERRIDE
CASCADE_PLAN_BASED_CONFIG_OVERRIDE
CASCADE_BACKGROUND_RESEARCH_CONFIG_OVERRIDE
CASCADE_MEMORY_CONFIG_OVERRIDE
CASCADE_VIEW_FILE_TOOL_CONFIG_OVERRIDE
```

**Web搜索/浏览器:**
```
CASCADE_WEB_SEARCH_TOOL_DISABLED / ENABLED / UNSPECIFIED
CASCADE_WEB_REQUESTS_AUTO_EXECUTION_ALLOWLIST / DISABLED / TURBO
CASCADE_WEB_AT_MENTION
CASCADE_WEB_SEARCH_NUX
CASCADE_WEB_TOOLS_OPEN_BROWSER_MARKDOWN
CASCADE_WEB_TOOLS_OPEN_CHUNK_MARKDOWN
CASCADE_WEB_TOOLS_OPEN_READ_URL_MARKDOWN
```

**命令自动执行策略:**
```
CASCADE_COMMANDS_AUTO_EXECUTION_AUTO
CASCADE_COMMANDS_AUTO_EXECUTION_DISABLED
CASCADE_COMMANDS_AUTO_EXECUTION_EAGER
CASCADE_COMMANDS_AUTO_EXECUTION_OFF
CASCADE_COMMANDS_AUTO_EXECUTION_UNSPECIFIED
```

**NUX (New User Experience) 事件:**
```
CASCADE_NUX_EVENT_ANTHROPIC_API_PRICING
CASCADE_NUX_EVENT_BACKGROUND_CASCADE
CASCADE_NUX_EVENT_DIFF_OVERVIEW
CASCADE_NUX_EVENT_MODEL_SELECTOR_NUX
CASCADE_NUX_EVENT_OPEN_BROWSER_URL
CASCADE_NUX_EVENT_PLAN_MODE
CASCADE_NUX_EVENT_REVERT_STEP
CASCADE_NUX_EVENT_RULES
CASCADE_NUX_EVENT_TOOL_CALL
CASCADE_NUX_EVENT_TOOL_CALL_PRICING_NUX
CASCADE_NUX_EVENT_WEB_MENTION
CASCADE_NUX_EVENT_WEB_SEARCH
CASCADE_NUX_EVENT_WRITE_CHAT_MODE
```

### 69.2 SUPERCOMPLETE_ 标志 (51个)

**触发条件 (10种):**
```
TRIGGER_CONDITION_AUTOCOMPLETE_ACCEPT
TRIGGER_CONDITION_AUTOCOMPLETE_PREDICTIVE
TRIGGER_CONDITION_CURSOR_LINE_NAVIGATION
TRIGGER_CONDITION_FORCED
TRIGGER_CONDITION_SUPERCOMPLETE_ACCEPT
TRIGGER_CONDITION_SUPERCOMPLETE_PREDICTIVE
TRIGGER_CONDITION_TAB_JUMP_ACCEPT
TRIGGER_CONDITION_TAB_JUMP_EDIT
TRIGGER_CONDITION_TAB_JUMP_PREDICTIVE
TRIGGER_CONDITION_TYPING
```

**过滤器 (11种):**
```
FILTER_DELETION_CAP / INSERTION_CAP
FILTER_NO_OP / PREFIX_MATCH / SUFFIX_MATCH
FILTER_PREVIOUSLY_SHOWN / REVERT
FILTER_SCORE_THRESHOLD / WHITESPACE_ONLY
PRUNE_MAX_INSERT_DELETE_LINE_DELTA / PRUNE_RESPONSE
```

**配置:**
```
AGGRESSION_HIGH / LOW / MEDIUM
MAX_CONCURRENT_REQUESTS
MAX_DELETIONS / MAX_INSERTIONS
MAX_TRAJECTORY_STEP_SIZE / STEPS
RECENT_STEPS_DURATION
MIN_SCORE
LINE_RADIUS
MODEL_CONFIG / MODEL_CONFIG_HIGH / MODEL_CONFIG_LOW
FAST_DEBOUNCE / REGULAR_DEBOUNCE
DEEPWIKI_KILLSWITCH
```

### 69.3 TAB_JUMP_ 标志 (32个)

```
TAB_JUMP_ENABLED / ACCEPT_ENABLED
TAB_JUMP_CUMULATIVE_PROMPT_CONFIG
TAB_JUMP_MODEL_CONFIG
TAB_JUMP_ON_ACCEPT_ONLY
TAB_JUMP_STOP_TOKEN_MIDSTREAM
TAB_JUMP_MIN_FILTER_RADIUS / LINE_RADIUS
TAB_JUMP_FILTER_DELETION_CAP / INSERTION_CAP
TAB_JUMP_FILTER_IN_SELECTION / NO_OP / REVERT
TAB_JUMP_FILTER_SCORE_THRESHOLD / WHITESPACE_ONLY
TAB_JUMP_PRUNE_MAX_INSERT_DELETE_LINE_DELTA / PRUNE_RESPONSE
```

### 69.4 AUTOCOMPLETE_ 标志 (17个)

```
AUTOCOMPLETE_DEFAULT_DEBOUNCE_MS
AUTOCOMPLETE_FAST_DEBOUNCE_MS
AUTOCOMPLETE_HIDDEN_ERROR_REGEX
AUTOCOMPLETE_SPEED_DEFAULT / FAST / SLOW
AUTOCOMPLETE_PREDICTIVE
AUTOCOMPLETE_CHAT_REQUEST_ACCEPTED / ERROR / NO_RESPONSE
AUTOCOMPLETE_ONE_WORD_ACCEPTED
```

### 69.5 AUTO_CASCADE_ 标志 (8个)

```
AUTO_CASCADE_BROADCAST
AUTO_CASCADE_MANAGER
AUTO_CASCADE_GITHUB_CONNECTION_ADDED / REMOVED
AUTO_CASCADE_PR_DESCRIPTION_GENERATED
AUTO_CASCADE_PR_REVIEW_GENERATED / REQUESTED
AUTO_CASCADE_PR_TITLE_GENERATED
```

### 69.6 INDEXING_ 标志 (12个)

```
INDEXING_CREATE / DELETE / READ / UPDATE / MANAGEMENT
INDEXING_STATUS_CANCELED / CANCELING / CLONING_REPO
INDEXING_STATUS_DONE / ERROR / GENERATING_EMBEDDINGS
INDEXING_STATUS_QUEUED / SCANNING_REPO / VECTOR_INDEXING
```

---

---

# Chapter 70: Vibe and Replace 系统

> 来源: `deploy-browser-output.txt` + proto定义 + `language_server.exe` 符号

## 概述

Vibe and Replace 是 Windsurf 的**批量代码搜索替换**系统，利用 AI 理解自然语言指令对匹配文件执行编辑。它是 Cascade 之外的独立请求类型 (`CHAT_MESSAGE_REQUEST_TYPE_VIBE_AND_REPLACE = 8`)。

## 核心 Proto 消息

### VibeAndReplaceFile
```protobuf
message VibeAndReplaceFile {
  string file_uri = 1;
  string original_content = 2;
  repeated string matches = 3;
  repeated int32 match_lines = 4;
}
```

### GenerateVibeAndReplaceStreamingRequest
```protobuf
message GenerateVibeAndReplaceStreamingRequest {
  Metadata metadata = 1;
  PlanInfo plan_info = 2;
  string prompt = 3;              // 用户自然语言指令
  string search_query = 4;        // 搜索查询
  string search_options_text = 5;  // 搜索选项
  repeated VibeAndReplaceFile files = 6;  // 匹配文件列表
  string cascade_id = 7;
  optional string model_uid_for_generation = 9;
}
```

### VibeAndReplaceData (流式响应)
```protobuf
message VibeAndReplaceData {
  string request_id = 1;
  string output = 2;                     // 生成的替换内容
  repeated ChatToolCall tool_calls = 3;   // 工具调用
  bool is_complete = 5;
  bool is_skipped = 6;
}
```

## RPC 端点

| 方法 | 类型 | 服务 |
|------|------|------|
| `GenerateVibeAndReplaceStreaming` | 服务端流式 | LanguageServerService |
| `CancelVibeAndReplace` | Unary | ExtensionServerService (LS→Extension) |

## CortexTrajectory 集成

- `is_vibe_and_replace = true` 字段 (field 28) 在 `CascadeCortexStepConfig` 中
- API 请求类型: `CHAT_MESSAGE_REQUEST_TYPE_VIBE_AND_REPLACE = 8`

## 权限控制

- `allow_vibe_and_replace` (codeium_common field 27): 用户级别
- `allow_vibe_and_replace` (seat_management optional field 17): Team Org 控制

## Go 内部模块

从二进制符号表提取:
- `vibe_and_replace.vibeEditArgs` — 编辑参数
- `vibe_and_replace.VibeSkipArgs` — 跳过参数
- `vibe_and_replace.VibeEditContentArgs` — 编辑内容参数
- `vibe_and_replace.VibeEditToolConverter` — 工具转换器

## 工作流程

```
1. 用户提供自然语言 prompt + 搜索查询
2. Extension 执行 SearchQuery 找到匹配文件
3. 构建 VibeAndReplaceFile[] 列表 (含原始内容+匹配行号)
4. 调用 GenerateVibeAndReplaceStreaming (流式)
5. LS 调用远程 AI (requestType=8) 生成替换
6. 流式返回 VibeAndReplaceData (逐步输出)
7. Extension 可通过 CancelVibeAndReplace 中断
```

---

# Chapter 71: Browser Preview / Playwright 浏览器自动化系统

> 来源: `browser_preview.proto` + `deploy-browser-output.txt` + `codeium_common.proto`

## 概述

Windsurf 内置 Playwright 浏览器引擎，提供**完整的网页预览、DOM 交互、截图、控制台日志**捕获能力，直接注入 Cascade 上下文。

## BrowserPreviewService (3 RPCs)

```protobuf
service BrowserPreviewService {
  rpc SendDOMElement (SendDOMElementRequest) returns (SendDOMElementResponse);
  rpc SendScreenshot (SendScreenshotRequest) returns (SendScreenshotResponse);
  rpc SendConsoleOutput (SendConsoleOutputRequest) returns (SendConsoleOutputResponse);
}
```

这是**浏览器→LS**的回调服务：内嵌 Playwright 实例检测到页面变化时，主动推送数据给 LS。

## 浏览器安装生命周期

```protobuf
enum BrowserInstallationStatus {
  BROWSER_INSTALLATION_STATUS_UNSPECIFIED = 0;
  BROWSER_INSTALLATION_STATUS_NOT_INSTALLED = 1;
  BROWSER_INSTALLATION_STATUS_IN_PROGRESS = 2;
  BROWSER_INSTALLATION_STATUS_COMPLETE = 3;
  BROWSER_INSTALLATION_STATUS_ERROR = 4;
}
```

从二进制符号: `Successfully removed Playwright cache directory` / `Successfully removed Windsurf browser directory`

## DOM 树模型

```protobuf
message DOMTree {
  message BoundingBox { float x, y, width, height; }
  message DOMNode {
    repeated DOMNode children = 1;
    string tag_name = 2;
    string id = 3;
    repeated string class_names = 4;
    string text_content = 5;
    BoundingBox bbox = 6;
    string aria_label = 7;
    string title = 8;
    string alt = 9;
    string src = 10;
    string href = 11;
  }
  DOMNode root = 1;
  uint32 num_nodes = 2;
}
```

## 浏览器交互模型

```protobuf
message BrowserClickInteraction {
  uint32 viewport_scroll_x/y = 1/2;
  uint32 click_x/y = 3/4;
  string target_element_css_selector = 5;
  string target_element_x_path = 6;
}

message BrowserScrollInteraction {
  uint32 viewport_scroll_x/y = 1/2;
}

message BrowserInteraction {
  oneof interaction { BrowserClickInteraction click; BrowserScrollInteraction scroll; }
  Timestamp timestamp = 1;
  BrowserPageMetadata page_metadata = 2;
}
```

## 页面元数据

```protobuf
message BrowserPageMetadata {
  string url = 1;
  string page_id = 2;
  string page_title = 3;
  Timestamp last_visited_time = 7;
}
```

## Context Scope Items (注入 Cascade 上下文)

| ScopeItem | 字段 | 说明 |
|-----------|------|------|
| `BrowserPageScopeItem` | url, title, visible_text_content, page_id | 页面摘要 |
| `BrowserTextScopeItem` | url, visible_text, page_id | 可见文本 |
| `BrowserCodeBlockScopeItem` | url, title, code_content, language, page_id | 代码块 |
| `ConsoleLogScopeItem` | lines[], server_address | 控制台日志 |
| `DOMElementScopeItem` | tag_name, outer_html, id, caption, file_line_range | DOM 元素 |

## 遥测事件

- `BROWSER_PREVIEW_DOM_ELEMENT = 70`
- `BROWSER_PREVIEW_CONSOLE_OUTPUT = 71`

## 用户设置

- `enable_automatic_screenshot` (field 64) — 自动截图
- `disable_cascade_browser_previews` (field 33) — 禁用浏览器预览
- `browser_experimental_features_config` (field 66) — 实验功能开关

```protobuf
enum BrowserExperimentalFeaturesConfig {
  BROWSER_EXPERIMENTAL_FEATURES_CONFIG_UNSPECIFIED = 0;
  BROWSER_EXPERIMENTAL_FEATURES_CONFIG_ENABLED = 1;
  BROWSER_EXPERIMENTAL_FEATURES_CONFIG_DISABLED = 2;
}
```

## Go 内部结构

从二进制符号 (36 Browser* 类型):
- `BrowserPreviewServer` / `BrowserPreviewServiceHandler`
- `BrowserModule` — 浏览器管理模块
- `BrowserPreviews` — 预览管理
- `BrowserWebSettings` — Web 设置

---

# Chapter 72: Quick Review / PR Review 系统

> 来源: proto定义 + `deploy-browser-output.txt`

## 概述

Quick Review 是 Windsurf 内置的 **AI 代码审查系统**，支持 GitHub PR 审查和快速代码检视。

## 请求类型

```
CHAT_MESSAGE_REQUEST_TYPE_WINDSURF_REVIEW = 7
```

独立于 Cascade (=5) 的请求类型，表明审查有独立的 AI pipeline。

## Team 组织控制

```protobuf
enum QuickReviewSetting {
  QUICK_REVIEW_SETTING_UNSPECIFIED = 0;
  QUICK_REVIEW_SETTING_ENABLED = 1;
  QUICK_REVIEW_SETTING_DISABLED = 2;
}

// TeamOrganizationalControls
QuickReviewSetting quick_review_setting = 20;
```

## DisplayOption 集成

```protobuf
enum DisplayOption {
  DISPLAY_OPTION_UNSPECIFIED = 0;
  DISPLAY_OPTION_ARENA = 1;
  DISPLAY_OPTION_BATTLE_GROUP_ONLY = 2;
  DISPLAY_OPTION_MODEL_ROUTER = 3;
  DISPLAY_OPTION_QUICK_REVIEW = 4;   // ← Quick Review 作为展示选项
}
```

## PR Review 配置

```protobuf
// UserFeatures (codeium_common)
string pull_request_review_guidelines = 14;    // PR 审查指南
string pull_request_description_guidelines = 16; // PR 描述指南
optional int32 pull_request_review_rate_limit = 21; // 审查速率限制
bool allow_github_reviews = 12;
bool allow_github_description_edits = 13;
bool allow_github_auto_reviews = 24;
```

## Team Org 配置 (seat_management)

```protobuf
// TeamControlsConfig
optional bool allow_github_reviews = 5;
optional bool allow_github_description_edits = 6;
optional string pull_request_review_guidelines = 7;
optional string pull_request_description_guidelines = 8;
```

## 遥测事件

```
TEAM_CONFIG_TOGGLE_GITHUB_REVIEWS = 167
TEAM_CONFIG_TOGGLE_GITHUB_DESCRIPTION_EDITS = 168
```

---

# Chapter 73: Model Harness / Routing 模型路由系统

> 来源: proto定义 + `deploy-browser-output.txt` 符号

## 概述

Windsurf 使用 **Harness UID + Model Router** 实现模型分配和路由。这是 Arena 模式的底层基础设施。

## 核心消息

### ModelAssignmentInfo (cortex.proto)
```protobuf
message ModelAssignmentInfo {
  string assignment_jwt = 1;      // JWT 分配令牌
  string assigned_model_uid = 2;  // 分配的模型
  string harness_uid = 3;         // Harness 标识
  string model_router_uid = 4;    // 路由器标识
  Timestamp assigned_at = 5;
}
```

### ArenaModeInfo
```protobuf
message ArenaModeInfo {
  optional string arena_id = 1;
  optional string agent_name = 3;
  optional string arena_assignment_jwt = 4;
  optional string arena_model_uid = 5;
  optional string harness_uid = 6;
  optional string assigned_model_uid = 7;
}
```

### ModelAssignment (api_server)
```protobuf
message AssignModelRequest {
  Metadata metadata = 1;
  string model_router_uid = 2;  // 路由器
  string cascade_id = 3;
  ChatMessagePrompt chat_message_prompt = 5;
}

message ModelAssignment {
  string assignment_jwt = 1;
  string model_uid = 2;
  repeated string harness_uids = 3;  // 多 harness
}
```

## InferenceConfig (推理配置)

```protobuf
// 供应商特定配置
message OpenAIInferenceConfig {
  string reasoning_effort = 1;  // 推理努力等级
  string service_tier = 2;
  bool extended_prompt_cache_retention = 3;
}

message GoogleInferenceConfig {
  string reasoning_effort = 1;
}

message AnthropicInferenceConfig {
  bool thinking = 1;
  string effort = 2;
  bool fast_mode = 3;
  bool context_1m = 4;  // 1M context window
}

// 通用推理配置
message InferenceConfig {
  oneof config {
    OpenAIInferenceConfig openai = 1;
    GoogleInferenceConfig google = 2;
    AnthropicInferenceConfig anthropic = 3;
  }
}
```

## ClientModelConfig 中的路由字段

```protobuf
message ClientModelConfig {
  // ...
  repeated string harness_uids = 20;       // 可用 harness 列表
  ArenaConfig arena_config = 21;
  DisplayOption display_option = 22;
  string model_family_uid = 23;
  InferenceConfig inference_config = 24;    // 推理配置
  bool is_model_router = 25;               // 是否为路由器模型
}
```

## Arena 系统层级

```
Model Router (顶层) → 根据请求分配模型
    ↓
Harness UID (中间层) → 模型实例标识
    ↓
Arena Tier → FAST / SMART
    ↓
实际模型 (底层) → 具体的 LLM
```

### ArenaTier
```
ARENA_TIER_UNSPECIFIED = 0
ARENA_TIER_FAST = 1
ARENA_TIER_SMART = 2
```

### DisplayOption
```
DISPLAY_OPTION_ARENA = 1              → Arena 对比模式
DISPLAY_OPTION_BATTLE_GROUP_ONLY = 2  → 仅战斗组
DISPLAY_OPTION_MODEL_ROUTER = 3       → 模型路由
DISPLAY_OPTION_QUICK_REVIEW = 4       → 快速审查
```

## CortexTrajectory 中的使用

```protobuf
// CascadeCortexStepConfig
optional string override_harness_uid = 10;  // 覆盖 harness

// CortexTrajectory
optional ArenaModeInfo arena_mode_info = 20;
```

## Go 内部模块 (68 Arena* 类型)

关键类型:
- `ArenaConfig` / `ArenaModeInfo` / `ArenaModeCostFast` / `ArenaModeCostSmart`
- `ArenaConvergeCount` / `ArenaConvergeTelemetry`
- `ArenaInvocationCapReached` / `ArenaCapReached`

---

# Chapter 74: Instant Context Agent 即时上下文代理

> 来源: `cortex.proto` + `codeium_common.proto` + `deploy-browser-output.txt`

## 概述

Instant Context 是 Windsurf 的**快速代码定位系统**，使用专用 AI 模型 (`MODEL_COGNITION_INSTANT_CONTEXT = 355`) 根据搜索意图自动发现相关代码范围。

## 核心消息

### InstantContextResponse
```protobuf
message InstantContextResponse {
  map<string, LineRangeList> range_map = 1;       // 文件→行范围映射
  float duration = 3;
  map<string, LineRangeList> raw_range_map = 4;
  InstantContextTiming timing = 5;
}
```

### InstantContextStep (多步推理)
```protobuf
message InstantContextStep {
  repeated InstantContextToolCall tool_calls = 1;  // 工具调用
  string thoughts = 2;                             // 思考过程
}
```

### InstantContextToolCall
```protobuf
message InstantContextToolCall {
  enum ExecutionStatus {
    EXECUTION_STATUS_UNSPECIFIED = 0;
    EXECUTION_STATUS_PENDING = 1;
    EXECUTION_STATUS_SUCCESS = 2;
    EXECUTION_STATUS_FAILURE = 3;
  }
  string command_type = 1;      // 命令类型 (grep/find等)
  string param = 2;             // 参数
  ExecutionStatus execution_status = 3;
  string error_message = 4;
  string tool_call_id = 5;
  float duration_seconds = 6;
}
```

### InstantContextToolUpdate (实时更新)
```protobuf
message InstantContextToolUpdate {
  string tool_call_id = 1;
  ExecutionStatus execution_status = 2;
  string error_message = 3;
  float duration_seconds = 4;
  int32 tool_index = 5;
}
```

### InstantContextTiming (性能计时)
```protobuf
message InstantContextTiming {
  float total_duration_secs = 1;
  float answer_parse_duration_secs = 2;
  repeated TurnTiming turns = 3;
}
```

## CortexStep 集成

```protobuf
// CortexStepFindCodeContext
message CortexStepFindCodeContext {
  string search_term = 1;
  repeated InstantContextStep steps = 2;
  InstantContextResponse response = 3;
  string workspace_directory_path = 4;
  string error = 5;
}
```

对应 `CORTEX_STEP_TYPE_FIND_CODE_CONTEXT`。

## 用户设置

```protobuf
bool enable_instant_context_agent = 77;   // 启用
bool disable_instant_context_agent = 78;  // 禁用
```

## 专用模型

```
MODEL_COGNITION_INSTANT_CONTEXT = 355  // Cognition 专用模型
```

## 工作流程

```
1. Cascade 需要查找相关代码
2. 触发 CortexStepFindCodeContext (search_term)
3. Instant Context Agent 使用 MODEL_COGNITION_INSTANT_CONTEXT
4. 多步推理: 每步生成 thoughts + tool_calls
5. 工具调用执行 (grep/find 等) + 实时状态更新
6. 返回 range_map: 文件路径 → 行范围列表
7. 结果注入 Cascade 上下文
```

## Go 内部模块 (118+ 符号)

- `InstantContext` — 主模块
- `InstantContextMetadata` — 元数据
- `applyInstantContextReminder` — 上下文提醒注入
- `handlers.InstantContext` — 处理器

---

# Chapter 75: Deploy / Windsurf.build + Netlify 深度分析

> 来源: proto定义 + `deploy-browser-output.txt`

## 概述

Windsurf 内置完整的 **Web 应用部署系统**，通过 Netlify SDK 实现一键部署到 `windsurf.build` 域名，支持 Sandbox (免费) 和 Teams (付费) 两种模式。

## DeploymentProvider

```protobuf
enum DeploymentProvider {
  DEPLOYMENT_PROVIDER_UNSPECIFIED = 0;
  DEPLOYMENT_PROVIDER_VERCEL = 1;     // Vercel (保留)
  DEPLOYMENT_PROVIDER_NETLIFY = 2;    // Netlify (主要)
  DEPLOYMENT_PROVIDER_CLOUDFLARE = 3; // Cloudflare (保留)
}
```

## 部署流程 Proto

### CortexStepDeployWebApp
```protobuf
message CortexStepDeployWebApp {
  string project_path = 1;
  string subdomain = 2;
  string project_id = 11;
  string framework = 3;
  bool user_confirmed = 4;
  map<string, DeployWebAppFileUploadStatus> file_upload_status = 5;
  WindsurfDeployment deployment = 6;
  string deployment_config_uri = 7;
  WebAppDeploymentConfig deployment_config_output = 8;
}
```

### DeployWebAppFileUploadStatus
```protobuf
enum DeployWebAppFileUploadStatus {
  DEPLOY_WEB_APP_FILE_UPLOAD_STATUS_UNSPECIFIED = 0;
  DEPLOY_WEB_APP_FILE_UPLOAD_STATUS_PENDING = 1;
  DEPLOY_WEB_APP_FILE_UPLOAD_STATUS_IN_PROGRESS = 2;
  DEPLOY_WEB_APP_FILE_UPLOAD_STATUS_SUCCESS = 3;
  DEPLOY_WEB_APP_FILE_UPLOAD_STATUS_FAILURE = 4;
}
```

## 项目管理 API

| 方法 | 说明 |
|------|------|
| `CreateWindsurfJSApp` | 创建项目 |
| `DeleteWindsurfJSApp` | 删除项目 |
| `GetWindsurfJSApps` | 列出所有项目 |
| `GetWindsurfJSAppDeploymentStatusesByProjectId` | 获取部署状态 |
| `GetWindsurfJSAppDeployment` | 获取单个部署 |
| `GetDeploymentProviderProjectNameByProjectId` | 获取提供商项目名 |
| `GetWindsurfJSDeployTargetByProjectId` | 获取部署目标 |
| `GetWindsurfJSAvailableDeployTargets` | 可用部署目标 |

## WindsurfProject
```protobuf
message WindsurfProject {
  string windsurf_project_id = 1;
  string auth_uid = 2;
  DeploymentProvider deployment_provider = 3;
  string provider_project_id = 4;
  string project_name = 5;
  Timestamp created_at = 6;
}
```

## WindsurfDeployment
```protobuf
message WindsurfDeployment {
  string windsurf_deployment_id = 1;
  string auth_uid = 2;
  DeploymentProvider deployment_provider = 3;
  string provider_deployment_id = 14;
  string windsurf_project_id = 19;
  string project_id = 4;
  // ... claimed_at, expires_at, deprovisioned_at
}
```

## DeployTarget
```protobuf
message DeployTarget {
  DeploymentProvider deployment_provider = 1;
  bool is_sandbox = 2;          // Sandbox vs Teams
  string provider_team_id = 3;
  string provider_team_slug = 4;
}
```

## 权限控制

| 字段 | 位置 | 说明 |
|------|------|------|
| `allow_app_deployments` | UserFeatures field 10 | 允许部署 |
| `allow_sandbox_app_deployments` | UserFeatures field 19 | Sandbox 部署 |
| `allow_teams_app_deployments` | UserFeatures field 20 | Teams 部署 |
| `max_unclaimed_sites` | UserFeatures field 9 | 最大未认领站点 |
| `max_new_sites_per_day` | UserFeatures field 11 | 每日新建限制 |

## CortexStep 类型

```
CORTEX_STEP_TYPE_DEPLOY_WEB_APP = 44
CORTEX_STEP_TYPE_READ_DEPLOYMENT_CONFIG = 46
```

## Netlify SDK 集成

从二进制 4257 个 `netlify` 引用，包含完整 Netlify Go SDK:
- `DeployFile` / `DeployFunction` / `DeployKey`
- `RollbackSiteDeploy` / `UpdateSiteBuildLog`
- `CreateTicket` / `ShowTicket` (OAuth)
- `SetSite` / `GetSite` / `DeleteSite`
- 87 个 Deploy* 类型

---

# Chapter 76: Forge/CLI 访问控制与 Worktree 系统

> 来源: proto定义 + `deploy-browser-output.txt`

## Forge/CLI 访问控制

### Forge Access
```protobuf
// PlanInfo
bool has_forge_access = 5;  // Forge 命令行访问权限
```

### CLI Access Override
```protobuf
enum CliAccessOverride {
  CLI_ACCESS_OVERRIDE_UNSPECIFIED = 0;
  CLI_ACCESS_OVERRIDE_ENABLED = 1;
  CLI_ACCESS_OVERRIDE_DISABLED = 2;
}

// UserInfo (seat_management)
CliAccessOverride cli_access_override = 32;
```

### CLI Permissions (3级)
```protobuf
// TeamOrganizationalControls
repeated string cli_permissions_allow = 41;  // 允许列表
repeated string cli_permissions_deny = 42;   // 拒绝列表
repeated string cli_permissions_ask = 43;    // 询问列表
```

### CLI 模型配置
- `cli_model_uids` (field 13) — 可用 CLI 模型
- `cli_model_labels` (field 9) — CLI 模型标签
- `disable_cli_access` (field 3) — 禁用 CLI
- `GetCliModelConfigs` — 获取 66 个 CLI 模型

## Worktree 系统

### 概述

Worktree 是 Cascade 的**隔离文件系统**，基于 Git worktree 实现代码修改沙箱。

### 创建与管理

```protobuf
// StartCascadeRequest
optional bool git_worktree = 7;  // 请求创建 worktree

// CreateWorktreeResponse
message WorktreeInfo {
  WorkspaceInfo original = 1;
  string worktree_path = 2;
}
```

### 变更合并

```protobuf
enum ResolveWorktreeChangesMode {
  RESOLVE_WORKTREE_CHANGES_MODE_UNSPECIFIED = 0;
  RESOLVE_WORKTREE_CHANGES_MODE_MERGE = 1;
  RESOLVE_WORKTREE_CHANGES_MODE_STASH = 2;
}

message ResolveWorktreeChangesRequest {
  string cascade_id = 1;
  repeated string uris = 2;
  ResolveWorktreeChangesMode mode = 3;
  bool fail_on_conflicts = 4;
}

message ResolveWorktreeChangesResponse {
  bool had_conflicts = 1;
  repeated string conflicting_files = 2;
}
```

### RPC 方法

| 方法 | 说明 |
|------|------|
| `CreateWorktree` | 创建 Git worktree |
| `ResolveWorktreeChanges` | 合并/暂存变更 |
| `UndoWorktreeMerge` | 撤销合并 |
| `MountCascadeFilesystem` | 挂载虚拟文件系统 |
| `UnmountCascadeFilesystem` | 卸载虚拟文件系统 |

### CortexTrajectory 中的 Worktree

```protobuf
message CortexTrajectory {
  optional bytes virtual_fs_serialized_overlay = 13;  // 虚拟FS覆盖层
  optional string git_worktree_path = 18;             // 单worktree
  repeated string git_worktree_paths = 22;            // 多worktree
  repeated WorktreeMergeSnapshot worktree_merges = 23; // 合并快照
}
```

### Go 内部模块 (47 Worktree* 类型)

关键类型:
- `WorktreeManager` / `WorktreeClient`
- `WorktreeChanges` / `WorktreeContents`
- `WorktreeMerge` / `WorktreeMergeSnapshot`
- `WorktreeHook` / `WorktreeHookWaiter` / `WorktreeHookDone`
- `WorktreeFileConflict` / `WorktreeFileWithMerge`

---

# Chapter 77: Go Language Server 完整模块索引

> 来源: `deploy-browser-output.txt` 符号提取

## LS 核心模块 (152 个)

```
exa/language_server/
├── action/
│   ├── action_command
│   ├── action_create_file
│   ├── action_delete_file
│   ├── action_factory
│   ├── action_helpers
│   └── action_interface
├── api_server_client/
│   ├── api_server_client    # API 服务器客户端主模块
│   ├── chat                 # 聊天转发
│   ├── client_manager       # 客户端管理
│   ├── cm_api_client_wrapper
│   ├── completion           # 补全
│   ├── embedding            # 嵌入
│   ├── helpers
│   ├── mquery               # 模型查询
│   ├── tab                  # Tab 补全
│   └── telemetry            # 遥测
├── cache/cache
├── chat/
│   ├── chat                 # 主聊天模块
│   ├── citation             # 引用
│   ├── docstring            # 文档字符串生成
│   ├── explain              # 代码解释
│   ├── fast_apply           # 快速应用
│   ├── markdown             # Markdown 处理
│   ├── mentions             # @提及
│   ├── problem_explain      # 问题解释
│   ├── refactor             # 重构
│   ├── unit_tests           # 单元测试生成
│   └── utils
├── chat_client_server_client/
│   ├── client
│   └── handler
├── code_tracker/
│   ├── code_range
│   ├── code_range_manager
│   ├── code_tracker
│   ├── code_tracker_listener
│   ├── code_tracker_manager
│   ├── upload_ctu_helper
│   └── user_data_uploader
├── commit_graph/
│   ├── cluster_utils
│   ├── commit_graph
│   └── commit_graph_config
└── ... (112 more modules)
```

## Cortex MCP 模块 (7 个)

```
exa/cortex/utils/mcp/
├── mcp_manager                  # MCP 服务器管理
├── mcp_server_client_instance   # MCP 客户端实例
├── oauth                        # MCP OAuth
├── policy                       # MCP 安全策略
├── registry                     # MCP 注册表
├── roots                        # MCP roots
└── utils                        # MCP 工具
```

## 部署类型 (87 个 Deploy*)

关键:
- `DeployFile` / `DeployFunction` / `DeployKey` — Netlify 基础操作
- `DeployCreated` / `DeployLive` / `DeployNoContent` — 状态
- `DeployHook` / `DeployInteraction` — 钩子
- `DeployCustomDomain` / `DeployPreviewCustomDomain` — 域名

## Arena 类型 (68 个 Arena*)

关键:
- `ArenaConfig` / `ArenaMode` / `ArenaModeInfo`
- `ArenaModeCostFast` / `ArenaModeCostSmart` — 成本计算
- `ArenaConvergeCount` / `ArenaConvergeTelemetry`
- `ArenaInvocationCapReached` — 调用上限

## CodeMap 类型 (72 个 CodeMap*)

关键:
- `CodeMapGenerator` / `CodeMapGeneratorInterface`
- `CodeMapFromTrajectory` / `CodeMapFromFile` / `CodeMapFromJson`
- `CodeMapEdit` / `CodeMapEditsFromTrajectory`
- `CodeMapIndex` / `CodeMapIndexEntry`
- `CodeMapManager` / `CodeMapMetadata`
- `CodeMapSuggestion` / `CodeMapFavorited`

---

---

# Chapter 78: Electron 主进程架构 (main.js)

> 来源: `windsurf-next/resources/app/out/main.js` (1.11MB, 540行) 直接分析

## 嵌入式 Product Config

main.js 内嵌了完整的 product.json 配置 (33804 chars, 234 字段)：

### 版本信息
| 字段 | 值 |
|------|-----|
| `version` | 1.110.1-next |
| `commit` | a65d6c4e1fd335336d7a0b601099811667e184ca |
| `date` | 2026-05-06T04:34:19.061Z |
| `quality` | next |
| `codeiumVersion` | 1.48.2 |
| `windsurfVersion` | 2.2.1017+next.a65d6c4e1f |
| `updateUrl` | https://windsurf-next.codeium.com |
| `zendeskTicketApiKey` | 1d83db0009861157cacd3279a927855f53279e48c84bd26d2ba48d241699773d |

### Multi-Tenant Mode

```javascript
if (this.productService.windsurf_multi_tenant_mode) {
  let r = this.configurationService.getValue("windsurf.portalUrl")
       || this.configurationService.getValue("windsurf.serviceUrl");
  if (r) return r.replace(/\/$/, "");
}
return this.productService.updateUrl;
```

- `windsurf.portalUrl` — 企业多租户 Portal URL 覆盖
- `windsurf.serviceUrl` — 企业服务 URL 覆盖
- 允许企业客户指向自己的更新/服务服务器

### Tunnel Server 配置

```javascript
tunnelServerQualities: {
  stable: { serverApplicationName: "windsurf-server" },
  next:   { serverApplicationName: "windsurf-server-next" },
  insider:{ serverApplicationName: "windsurf-server-insiders" }
}
```

### Win32 右键菜单 CLSIDs
- x64: `75947501-1980-4697-99E8-2544FC3BE4B8`
- arm64: `62AD3AC1-4E9B-4345-859A-BC17C4CF7497`

### 信任域名白名单 (linkProtectionTrustedDomains)

```
https://*.codeium.com
https://*.windsurf.com
https://windsurf.com
https://codeium-staging-exafunction.vercel.app
https://staging.itsdev.in
https://app.devin.ai
https://app.beta.devin.ai
https://*.devinenterprise.com
https://beta.devinenterprise.com
https://marketplace.windsurf.com
```

### Extension Auth 信任

```javascript
trustedExtensionAuthAccess: {
  windsurf_auth: ["codeium.windsurf"]  // windsurf_auth 提供商
}
trustedExtensionProtocolHandlers: [
  "vscode.git",
  "vscode.github-authentication",
  "vscode.microsoft-authentication",
  "codeium.windsurf"  // Windsurf 协议处理
]
trustedExtensionPublishers: ["meta"]  // Meta (Facebook) 是信任发布商!
```

## Devin CLI 安装逻辑

```javascript
async installDevinCli(e) {
  let t = M ? "devin.exe" : "devin";
  let n = path.join(appRoot, "extensions", "windsurf", "devin", "bin");
  let i = path.join(n, t);  // 源二进制

  if (Windows) {
    // %LOCALAPPDATA%\devin\bin\{appName}.exe
    let l = path.join(LOCALAPPDATA, "devin", "bin");
    await copyFile(i, path.join(l, `${appName}.exe`));
    await addToPath(l);
  } else {
    // ~/.local/bin/{appName} -> symlink
    let l = path.join(HOME, ".local", "bin");
    await symlink(i, path.join(l, appName));
    await addToPath(l);
  }
}
```

### Devin CLI 路径

| 平台 | 源路径 | 安装位置 |
|------|--------|----------|
| Windows | `extensions/windsurf/devin/bin/devin.exe` | `%LOCALAPPDATA%\devin\bin\{name}.exe` |
| Linux/Mac | `extensions/windsurf/devin/bin/devin` | `~/.local/bin/{name}` (symlink) |

### CLI 命名变体

- `devin` / `devin.exe` — 主二进制
- `devin-next` — Next 版本
- `devin-insiders` — Insiders 版本

## Windsurf Electron 主进程服务 (5 个)

| 服务 | 功能 |
|------|------|
| `windsurfWindowsMainManager` | 窗口组管理 (MAX_CHILDREN_PER_GROUP=3) |
| `windsurfWindowsManager` | 窗口管理器 |
| `windsurfKeybindingMainService` | 快捷键服务 |
| `windsurfExtensionManager` | 扩展管理 |
| `windsurfLanguageServer` | LS 启动/管理 |

## Window Groups 系统

```javascript
// 每个workspace最多3个子窗口
static MAX_CHILDREN_PER_GROUP = 3;
static WINDOW_GROUPS_STATE_KEY = "windsurf.windowGroupsState";

// WindowGroupState
{
  parentWorkspaceUri: URI,
  children: [{
    workspaceUri: URI,
    lastActiveTimestamp: number
  }],
  currentActiveWindowWorkspaceUri: URI
}
```

## LS Groups State (Worktree 多 LS)

```javascript
static WINDSURF_LS_GROUPS_STATE_KEY = "windsurf.lsGroupsState";

// LsGroupState
{
  groupId: string,
  parentWorkspaceUri: URI,
  children: [{
    parentWorkspaceUri: URI,
    worktreeUri: URI,
    creationTimestamp: number
  }]
}
```

这揭示了 **一个 workspace 可以有多个 LS 实例**，每个 worktree 分支一个。

## IPC 通道 (36 个 vscode: 通道)

包含 Windsurf 特有:
- `vscode:openChatSession` — 打开聊天会话

## Marketplace

独立于 VSCode Marketplace:
- Gallery: `https://marketplace.windsurf.com/vscode/gallery`
- Item: `https://marketplace.windsurf.com/vscode/item`
- Extension IDs: `codeium.windsurf`, `codeium.windsurfpyright`

---

# Chapter 79: Proposed APIs 完整目录 (26 个)

> 来源: main.js 中 vscode.proposed.windsurf*.d.ts 引用

## 完整列表

| API 名称 | 推测功能 |
|----------|----------|
| `windsurfAcp` | Agent Communication Protocol — Chisel 代理通信 |
| `windsurfAnnotations` | 代码注释/标注系统 |
| `windsurfAudio` | 音频录制 (语音转文字) |
| `windsurfAuth` | Windsurf 认证 API |
| `windsurfCascade` | Cascade AI 核心接口 |
| `windsurfCommandPopup` | 命令面板弹出 |
| `windsurfDebug` | AI 辅助调试 |
| `windsurfDevContainers` | Dev Containers 集成 |
| `windsurfDiffZone` | 差异编辑区 (虚拟FS覆盖显示) |
| `windsurfEditorCommandPopup` | 编辑器内命令弹出 |
| `windsurfEditorNudge` | 编辑器内 AI 提示/建议 |
| `windsurfExtensionManager` | 扩展管理 API |
| `windsurfExtensionMetadata` | 扩展元数据 |
| `windsurfFiles` | 文件操作增强 |
| `windsurfGenerateCommitMessageButton` | 生成提交消息按钮 |
| `windsurfInlineCompletions` | 内联补全 (Supercomplete) |
| `windsurfLanguageServer` | Language Server 通信 |
| `windsurfMarkers` | 代码标记系统 |
| `windsurfMcp` | MCP 插件接口 |
| `windsurfProductEducation` | 产品教育/引导 |
| `windsurfSettings` | Windsurf 设置 |
| `windsurfSideHint` | 侧边栏 AI 提示 |
| `windsurfStatusBar` | 状态栏定制 |
| `windsurfTabToJump` | Tab 跳转功能 |
| `windsurfTerminalCommandPopup` | 终端命令弹出 |
| `windsurfUndoRedo` | 撤销/重做增强 (Cascade 编辑) |

## 新发现: DevContainers 支持

`windsurfDevContainers` 表明 Windsurf 有 Dev Containers 集成计划，可能允许:
- 在容器环境中运行 Cascade
- 远程开发环境中的 AI 支持
- 隔离执行环境

---

# Chapter 80: NLS Messages — 隐藏功能与 UI 文本

> 来源: `nls.messages.json` (17289 条消息)

## Devin 相关 UI 文本 (13 条)

| 功能 | 文本 |
|------|------|
| **Devin for Terminal** | "Install Devin for Terminal" |
| **Devin Sleep** | "Put Devin to sleep" |
| **Devin Desktop** | "Open Devin's desktop" |
| **Devin Cloud** | "Devin Cloud Resource" |
| **Devin Review** | "Toggle Developer Tools (Devin Review)" |
| **Team Admin** | "Please contact your Windsurf team administrator to enable installing Devin for Terminal via Windsurf" |

### Devin Cloud Session
```
"Whether the cascade editor tab is for a Devin Cloud session that is currently 
 awake (has an external URL and is not sleeping)"
```

这揭示了 **Devin Cloud** 模式:
- Cascade 编辑器标签可以连接到 Devin Cloud 会话
- 会话有 "awake" (活跃, 有外部 URL) 和 "sleeping" 状态
- 可以 "Put Devin to sleep" 让会话休眠

## Cascade UI (16 条)

- "Cascade" / "Cascade Editor" / "Cascade in new tab"
- "Code with Cascade" — 主要 CTA
- "Fix with Cascade" — 修复功能
- "Open Cascade Conversation"
- "Add Codemap to Cascade"
- Cascade 管理的终端 (只读)

## CodeMap (13 条)

- "Generate Codemap" / "Generate Codemap from Cascade"
- "Generate Codemap from Navigation History"
- "Share Codemap" / "Load Codemap"
- "Open Codemap by ID" / "Open Codemap Chat"
- "Check if Codemaps is Enabled"
- "Codemap Editor" — 独立编辑器

## Worktree (4 条)

- "Workspace (Worktree)"
- "Open Worktree in Integrated Terminal"
- "Open Worktree in New Window"

## Vibe and Replace (1 条)

- "Vibe and Replace" — UI 名称确认

---

# Chapter 81: 构建系统与 Source Maps

> 来源: main.js/cli.js 嵌入信息

## Build Script

```
"npm install && npm run prepare-exa && bash build_windsurf/download_fd_and_devin_cli.sh"
```

构建过程:
1. `npm install` — 安装依赖
2. `npm run prepare-exa` — 准备 Exa/Codeium 组件
3. `bash build_windsurf/download_fd_and_devin_cli.sh` — 下载 fd (文件查找) 和 Devin CLI

## Source Maps

| 文件 | Source Map URL |
|------|----------------|
| main.js | `https://cdn.windsurf.com/sourcemaps/a65d6c4e.../core/main.js.map` |
| cli.js | `https://cdn.windsurf.com/sourcemaps/a65d6c4e.../core/cli.js.map` |
| extension.js | `https://cdn.windsurf.com/sourcemaps/a65d6c4e.../extensions/windsurf/dist/extension.js.map` |

所有 source map 按 commit hash 组织在 CDN 上。

## 更新机制

| 通道 | 服务器名 | 更新 URL |
|------|---------|----------|
| stable | `windsurf-server` | `https://windsurf.codeium.com` (推测) |
| next | `windsurf-server-next` | `https://windsurf-next.codeium.com` |
| insider | `windsurf-server-insiders` | (推测存在) |

Linux 手动更新: `https://codeium.com/windsurf/update_linux`

## Devin 集成域名

| 域名 | 用途 |
|------|------|
| `app.devin.ai` | Devin 主应用 |
| `app.beta.devin.ai` | Devin Beta |
| `*.devinenterprise.com` | Devin 企业版 |
| `beta.devinenterprise.com` | Devin 企业 Beta |
| `staging.itsdev.in` | Devin 内部 staging |

---

---

# Chapter 82: ACP (Agent Communication Protocol) 完整协议

> 来源: `extensions/windsurf/dist/acp/AGENTS.md` — 官方内部文档

## 概述

ACP 是 Windsurf IDE 与 Chisel Agent (Devin) 之间的通信协议。连接器在 `windsurfAcpConnector.ts` 中实现。

## Initialize 握手

客户端在 `initialize` 请求中发送:

```javascript
{
  clientInfo: {
    name: "windsurf" | "windsurf-next" | "windsurf-insiders",
    version: ideVersion
  },
  clientCapabilities: {
    elicitation: { form: {} },           // 表单交互
    fs: { readTextFile: true, writeTextFile: true },  // 文件访问
    _meta: {
      "cognition.ai/subagentSupport": true,
      "cognition.ai/multiRootWorkspace": true,
      "cognition.ai/partialContent": true,
      "cognition.ai/messageGrouping": true,
      "cognition.ai/groupedSessionConfigOptions": true,
      "cognition.ai/revert": true,
      "cognition.ai/mcp": true,
      "cognition.ai/requestDiagnostics": BackgroundLintManager.enabled
    }
  }
}
```

## Custom Capabilities (cognition.ai/* 前缀)

| Capability | 功能 |
|-----------|------|
| `cognition.ai/subagentSupport` | 子代理支持 |
| `cognition.ai/multiRootWorkspace` | 多根工作区 |
| `cognition.ai/partialContent` | 部分表单数据 (elicitation decline) |
| `cognition.ai/messageGrouping` | 流式工具调用预览 + clientMessageId 分块重组 |
| `cognition.ai/groupedSessionConfigOptions` | 模型配置按家族分组 (SessionConfigSelectGroup) |
| `cognition.ai/revert` | 回退到步骤 (listSteps/preview/execute/forkFromStep) |
| `cognition.ai/mcp` | MCP 市场 (listServers/toggleServer/toggleTool) |
| `cognition.ai/requestDiagnostics` | 诊断请求 (受 CASCADE_AUTO_FIX_LINTS flag 控制) |

## Revert Extension Methods

```
cognition.ai/revert/listSteps
cognition.ai/revert/preview
cognition.ai/revert/execute
cognition.ai/revert/forkFromStep
```

UI 通过 `supportsRevert(agentCapabilities)` 判断是否显示回退功能。

## MCP Extension Methods

```
cognition.ai/mcp/listServers
cognition.ai/mcp/toggleServer
cognition.ai/mcp/toggleTool
```

UI 通过 `supportsMcpManagement(agentCapabilities)` 判断。

## Diagnostics 流程

1. 连接器在每次 `fs/write_text_file` 请求前调用 `BackgroundLintManager.watchForLints()`
2. Lint 快照捕获编辑前状态
3. 在 Stop 边界，agent 通过 `_cognition.ai/request_diagnostics` 拉取诊断
4. 调用 `consumeCollectedLints()` 返回监视窗口内累积的 lint
5. 早退路径调用 `finalizeActiveWatch()` 清理

## 终端处理

标准 ACP `terminal` capability 被**故意省略**，因为 Windsurf 通过自己的扩展 API 处理终端。

## Audit 要求

修改 `WindsurfAcpConnector.initialize()` 中的 `clientCapabilities` 或 `_meta` 字段时，**必须**更新审计表：
> `devin-webapp/apps/chisel/cognition-acp/CAPABILITIES_AUDIT.md`

---

# Chapter 83: ACP Agent Registry + MCP Config Schema

> 来源: `extensions/windsurf/schemas/`

## ACP Agent Registry Schema

文件: `acp_registry.schema.json` → 匹配 `**/acp/registry.json`

### Agent 定义结构

```json
{
  "version": "1.0.0",
  "agents": [{
    "id": "claude-code",
    "name": "Claude Code",
    "version": "1.0.0",
    "description": "...",
    "repository": "...",
    "authors": ["..."],
    "license": "MIT",
    "icon": "...",
    "distribution": { ... },
    "cognition.ai/featured": true,
    "cognition.ai/bundled": false,
    "cognition.ai/hidden": false,
    "cognition.ai/promoLabel": "Preview",
    "cognition.ai/promoTooltip": "..."
  }]
}
```

### 分发方式 (4 种)

| 方式 | 字段 | 说明 |
|------|------|------|
| **binary** | `archive`, `cmd`, `args`, `env` | 预编译二进制 (6 平台) |
| **npx** | `package`, `args`, `env` | npm 包 |
| **uvx** | `package`, `args`, `env` | Python 包 (uv) |
| **websocket** | `url` | WebSocket 代理 |

### 支持平台 (binary)

```
darwin-aarch64, darwin-x86_64
linux-aarch64, linux-x86_64
windows-aarch64, windows-x86_64
```

### Cognition 特殊字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `cognition.ai/featured` | boolean | 在 Registry 中推荐 |
| `cognition.ai/bundled` | boolean | 随 Windsurf 捆绑 |
| `cognition.ai/hidden` | boolean | 对用户隐藏 |
| `cognition.ai/promoLabel` | string | 推广标签 (如 "Preview") |
| `cognition.ai/promoTooltip` | string | 推广提示 |

## MCP Config Schema

文件: `mcp_config.schema.json` → 匹配 `**/mcp_config.json`

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@some/mcp-server"],
      "env": { "API_KEY": "..." },
      "serverUrl": "http://...",
      "url": "http://...",
      "disabled": false,
      "registry": "io.github.foo/bar",
      "disabledTools": ["tool-name"],
      "headers": { "Authorization": "..." },
      "oauth": {
        "clientId": "...",
        "scopes": ["read", "write"]
      }
    }
  }
}
```

### MCP Config 字段说明

| 字段 | 说明 |
|------|------|
| `command` + `args` | 本地启动命令 |
| `serverUrl` / `url` | 远程服务器地址 |
| `registry` | 来自 MCP Registry 的标识符 |
| `disabledTools` | 禁用的工具列表 |
| `oauth` | OAuth 2.1 配置 (clientId + scopes) |
| `headers` | 自定义 HTTP 头 |

---

# Chapter 84: Devin for Terminal — 完整文档分析

> 来源: `extensions/windsurf/devin/share/devin/docs/` (20+ mdx 文件)

## 产品定位

- **Devin for Terminal**: 本地命令行 AI coding agent
- **Devin (Cloud)**: 云端 VM AI 软件工程师
- 两者独立但深度集成

## 安装方式

| 平台 | 方法 |
|------|------|
| macOS/Linux/WSL | `curl -fsSL https://cli.devin.ai/install.sh \| bash` |
| Windows (x64) | `https://static.devin.ai/cli/devin-updater-x86_64-pc-windows.exe` |
| Windows (ARM64) | `https://static.devin.ai/cli/devin-updater-aarch64-pc-windows.exe` |
| Windows (PS) | `irm https://static.devin.ai/cli/setup.ps1 \| iex` |
| Windsurf Enterprise | Command Palette → "Install Devin for Terminal" (需管理员启用) |

## 4 种权限模式

| 模式 | 行为 |
|------|------|
| **Normal** (默认) | 读操作自动批准, 写/执行需确认 |
| **Accept Edits** | 文件编辑自动批准, shell 命令仍需确认 |
| **Bypass** (`/yolo`) | 全部自动批准 (无沙盒) |
| **Autonomous** | 沙盒内全自动 (需 `--sandbox`) |

## 3 种 Agent 模式

- **Normal** — 标准交互
- **Plan** (`/plan`) — 规划模式
- **Ask** (`/ask`) — 只问不改

## 企业认证 (双通道)

### Windsurf Auth
- `devin auth login` → SSO for Enterprise
- 计费: **Windsurf credit model**
- 管理: `windsurf.com/team/cli-settings`

### Devin Auth
- `devin auth login` → Devin for Enterprise
- 计费: **Devin ACU (Agent Compute Unit) model**
- RBAC 权限: "Use Devin for Terminal"
- 管理: `app.devin.ai/org/{orgName}/settings/windsurf`

## Team Settings (企业管理)

| 设置 | 功能 |
|------|------|
| **Models** | 模型白名单 + 默认模型 |
| **Web Search** | 互联网搜索开关 (默认关) |
| **MCP Servers** | MCP 白名单 |
| **Terminal Permissions** | deny/ask/allow 三级权限 (最高优先) |
| **Sandbox Enforcement** | Optional / Required / Strict |
| **Domain Filtering** | 域名 allowlist + denylist |
| **Install CLI** | Windsurf 命令面板安装开关 |

### 权限语法

```json
{
  "deny": ["Exec(rm)", "Write(/etc)"],
  "ask": ["Fetch(https://internal.api/*)"],
  "allow": ["Read(~/my-repository/**)"]
}
```

| 类型 | 格式 | 示例 |
|------|------|------|
| 文件读 | `Read(/path)` | `Read(~/sensitive/**)` |
| 文件写 | `Write(/path)` | `Write(.env*)` |
| 命令执行 | `Exec(cmd)` | `Exec(sudo)` |
| HTTP | `Fetch(url)` | `Fetch(https://api/*)` |

## Extensibility (.devin/ 目录)

```
my-project/
├── .devin/
│   ├── config.json          # 项目配置 (MCP, 权限)
│   ├── config.local.json    # 个人覆盖 (gitignored)
│   ├── hooks.v1.json        # 生命周期钩子
│   ├── skills/review/SKILL.md
│   └── agents/reviewer/AGENT.md
├── AGENTS.md                # 项目规则
```

### 跨工具配置兼容

```json
{
  "read_config_from": {
    "cursor": true,
    "windsurf": true,
    "claude": true
  }
}
```

支持读取: `AGENTS.md`, `.cursor/rules/`, `.windsurf/rules/`, `.claude/`

## Extension Package.json 分析

### 31 个命令

| 命令 | 功能 |
|------|------|
| `windsurf.login` / `logout` | 登录/登出 |
| `windsurf.triggerCascade` | 启动 Cascade |
| `windsurf.generateCommitMessage` | 生成提交消息 |
| `windsurf.createWorkflow` / `createGlobalWorkflow` | 创建工作流 |
| `windsurf.createRule` | 创建规则 |
| `windsurf.importRulesFromCursor` | 从 Cursor 导入规则 |
| `windsurf.openBrowser` | 打开浏览器 (when: browserFeatureEnabled) |
| `windsurf.reloadAcpConnections` | 重载 ACP 连接 (when: acpEnabled) |
| `windsurf.openAcpLocalRegistry` | 打开本地 ACP 注册表 |
| `windsurf.lifeguard.checkCurrentChanges` | Lifeguard 检查 |
| `windsurf.lifeguard.evaluateDataset` | Lifeguard 评估 (仅内部用户) |
| `windsurf.copyApiKey` | 复制 API Key (仅内部用户) |
| `windsurf.setPortalUrl` | 设置 Portal URL |

### 26 个配置项

| 配置 | 类型 | 说明 |
|------|------|------|
| `windsurf.portalUrl` | string | 企业 Portal URL |
| `windsurf.completionMode` | string | 补全模式 (Supercomplete 等) |
| `windsurf.autoContinue` | integer | 自动继续 |
| `windsurf.acp.preferredAgent` | string | 首选 ACP agent (claude-code/opencode/gemini) |
| `windsurf.acp.diffZonesEnabled` | boolean | ACP 差异编辑区 |
| `windsurf.acp.enabled` | boolean | ACP 总开关 |
| `windsurf.acp.enabledAgents` | object | 各 agent 启用状态 |
| `windsurf.acp.agentEnv` | object | agent 环境变量 |
| `windsurf.acp.agentPreferences` | object | agent 会话偏好 |
| `windsurf.cascade.enabled` | boolean | Cascade 开关 |
| `windsurf.cascade.readClaudeCodeConfig` | boolean | 读取 .claude 配置 |
| `windsurf.lifeguard.enabled` | boolean | Lifeguard 开关 |
| `windsurf.lifeguard.mode` | string | 分析模式 (fast/smart) |
| `windsurf.lifeguard.triggerOnCommit` | string | 提交时触发 |
| `windsurf.lifeguard.triggerOnCascade` | string | Cascade 后触发 |
| `windsurf.allowCascadeAccessGitignoreFiles` | boolean | 允许访问 gitignore 文件 |

### 29 个快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+I` | 触发 Cascade |
| `Ctrl+I` | 终端/编辑器命令 |
| `Tab` | Supercomplete 接受 |
| `Alt+J/K` | 聚焦下/上一个 Hunk |
| `Alt+Enter` | 接受聚焦的 Hunk |
| `Ctrl+Enter` | 接受文件内所有更改 |
| `Ctrl+Shift+M` | 麦克风开关 |
| `Ctrl+Shift+.` | Agent 选择器 |
| `Ctrl+/` | 模型选择器 |
| `Ctrl+;` | Worktree 开关 |
| `Ctrl+'` | Agent 选择器开关 |
| `Ctrl+.` | Write/Chat 模式切换 |
| `Ctrl+U` | Lifeguard 检查 |

### 7 个 Proposed APIs

```
contribSourceControlInputBoxMenu
windsurfEditorNudge
windsurfAuth
windsurfAcp
inlineCompletionsAdditions
findFiles2
terminalDataWriteEvent
```

### 2 个自定义语言

- `jsonc` → `mcp_config.json`
- `codemap` → `.codemap` 文件 (别名: "Windsurf Codemap")

---

---

# Chapter 85: product.json — 产品完整配置

> 来源: `windsurf-next/resources/app/product.json` (45KB, 1341行)

## 产品标识

| 字段 | 值 |
|------|------|
| `nameShort` | Windsurf - Next |
| `applicationName` | windsurf-next |
| `aliasName` | surf-next |
| `dataFolderName` | .windsurf-next |
| `serverApplicationName` | windsurf-server-next |
| `tunnelApplicationName` | windsurf-tunnel |
| `urlProtocol` | windsurf-next |
| `version` | 1.110.1-next |
| `codeiumVersion` | 1.48.2 |
| `windsurfVersion` | 2.2.1017+next.a65d6c4e1f |
| `quality` | next |
| `date` | 2026-05-06T04:34:19.061Z |

## Windows AppIDs

| 架构 | AppID |
|------|-------|
| x64 | `{85A2F254-36A6-439F-8112-4F4F18D8456D}` |
| arm64 | `{70F392B9-1552-4FF0-9C4E-9EC8D63A7F24}` |
| x64 (user) | `{6A08BD37-37E5-4A33-94CD-64CFC56A59ED}` |
| arm64 (user) | `{C972DD02-A1A7-4A2F-AD1F-86DEEA1C2A9C}` |
| AppUserModelId | `Exafunction.WindsurfNext` |

## macOS 标识

- `darwinBundleIdentifier`: `com.exafunction.windsurfNext`

## Extension Gallery (Marketplace)

```json
{
  "serviceUrl": "https://marketplace.windsurf.com/vscode/gallery",
  "itemUrl": "https://marketplace.windsurf.com/vscode/item"
}
```

## 内置扩展 (builtInExtensions)

| 扩展 | 版本 |
|------|------|
| `ms-vscode.js-debug-companion` | 1.1.3 |
| `ms-vscode.js-debug` | 1.110.0 |
| `ms-vscode.vscode-js-profile-table` | 1.0.10 |

## Zendesk + Telemetry

```json
{
  "zendeskTicketApiKey": "1d83db0009861157cacd3279a927855f53279e48c84bd26d2ba48d241699773d",
  "enableTelemetry": true,
  "aiConfig": { "ariaKey": "windsurf" }
}
```

## Trusted Extension Auth Access

| Auth Provider | 授权扩展 |
|--------------|---------|
| `github` | vscode.github, github.remotehub, ms-vscode.remote-server, github.copilot, github.copilot-chat, ms-vsliveshare.vsliveshare 等 |
| `microsoft` | ms-vscode.azure-repos, ms-vscode.remote-server, ms-toolsai.vscode-ai 等 |
| `windsurf_auth` | **codeium.windsurf** (唯一) |

## 已验证发布者

```json
{
  "verifiedExtensionPublishers": { "codeium": "https://windsurf.com" },
  "extensionPublisherDisplayNameOverrides": { "codeium": "Windsurf" },
  "trustedExtensionPublishers": ["meta"],
  "trustedExtensionProtocolHandlers": ["vscode.git", "vscode.github-authentication", "vscode.microsoft-authentication", "codeium.windsurf"]
}
```

## Tunnel Server Qualities

```json
{
  "stable": { "serverApplicationName": "windsurf-server" },
  "next": { "serverApplicationName": "windsurf-server-next" },
  "insider": { "serverApplicationName": "windsurf-server-insiders" }
}
```

## 完整性校验 (checksums)

验证 9 个核心文件的 SHA256:
- `vs/base/parts/sandbox/electron-browser/preload.js`
- `vs/workbench/workbench.desktop.main.js` / `.css`
- `vs/workbench/api/node/extensionHostProcess.js`
- `vs/code/electron-browser/workbench/workbench.html` / `.js`
- `vs/sessions/sessions.desktop.main.js` / `.css`
- `vs/sessions/electron-browser/sessions.html` / `.js`

## Chat Participant Registry

```
https://main.vscode-cdn.net/extensions/chat.json
```

## 推荐命令面板命令

```json
"commandPaletteSuggestedCommandIds": ["windsurf.prioritized.chat.open"]
```

## Link Protection Trusted Domains (24 个)

```
https://open-vsx.org
https://marketplace.windsurf.com
https://*.visualstudio.com, https://*.microsoft.com, https://aka.ms
https://*.gallerycdn.vsassets.io, https://*.github.com
https://*.codeium.com, https://*.windsurf.com, https://windsurf.com
https://codeium-staging-exafunction.vercel.app
https://staging.itsdev.in
https://app.devin.ai, https://app.beta.devin.ai
https://*.devinenterprise.com, https://beta.devinenterprise.com
```

---

# Chapter 86: Workbench UI 层 — 34 个 Windsurf 服务 + 299 配置键

> 来源: `workbench.desktop.main.js` (31.28 MB) + `sessions.desktop.main.js` (30.16 MB)

## 34 个 Windsurf Workbench 服务

| 服务名 | 推断功能 |
|--------|---------|
| `windsurfAcpService` | ACP Agent 连接管理 |
| `windsurfActionsManagerService` | **新发现** — 动作管理器 (仅 workbench) |
| `windsurfAnnotationsService` | 代码注解 (inline annotations) |
| `windsurfAudioService` | 语音输入/转录 |
| `windsurfAuthService` | 认证服务 |
| `windsurfCascadeService` | Cascade 核心服务 |
| `windsurfCascadeTerminalService` | Cascade 终端管理 |
| `windsurfChangelogService` | 更新日志 |
| `windsurfCommandPopupService` | 命令弹窗 (Ctrl+I) |
| `windsurfFeedbackService` | **新发现** — 反馈 (仅 workbench) |
| `windsurfFileSystemService` | 文件系统代理 |
| `windsurfHeaderService` | **新发现** — 头部栏 (仅 workbench) |
| `windsurfKeybindingService` | 快捷键管理 |
| `windsurfMcpService` | MCP 插件管理 |
| `windsurfMetadataService` | 元数据/配置缓存 |
| `windsurfNetworkService` | 网络状态 |
| `windsurfProductInfoService` | 产品信息 |
| `windsurfResourceService` | **新发现** — 资源管理 (仅 workbench) |
| `windsurfSandboxedTerminalService` | 沙盒终端 |
| `windsurfSearchContextService` | 搜索上下文 |
| `windsurfSpaceService` | **新发现** — Spaces 系统 |
| `windsurfStatusBarSettingsService` | 状态栏设置 |
| `windsurfSvgService` | SVG 图标渲染 |
| `windsurfUserSettingsService` | 用户设置同步 |
| `windsurfVibeAndReplaceService` | Vibe & Replace |
| `windsurfWindowsMainManager` | **新发现** — 主窗口管理器 (仅 workbench) |
| `windsurfWindowsManager` | **新发现** — 窗口管理器 |
| `windsurfWorkbenchModeService` | 工作台模式 |
| `cascadeDiffService` | Cascade Diff 渲染 |
| `windsurf.languageServerMainService` | LS 主服务 |
| `windsurf.languageServerService` | LS 通信 |
| `windsurf.unleashService` | Feature Flag 控制 |
| `windsurf.inlayHintsManager` | Inlay Hints 管理 |
| `windsurf.provideAuthTokenToAuthProvider` | Auth Token 提供 |

### workbench 独有服务 (6 个，sessions 中不存在)

- `windsurfActionsManagerService`
- `windsurfFeedbackService`
- `windsurfHeaderService`
- `windsurfResourceService`
- `windsurfWindowsMainManager`
- `windsurfWindowsManager`

## 新发现的功能系统

### Agent Window (代理窗口)

```
windsurf.agentWindow.openDesktop      — 在桌面打开
windsurf.agentWindow.openShell        — 在 Shell 打开
windsurf.agentWindow.tryOpenGitHubPullRequestInExtension  — GitHub PR
windsurf.agentWindow.viewSpaceDiffs   — 查看 Space 差异
windsurf.prioritized.newAgentWindowSession — 新代理窗口会话
```

### Spaces 系统

```
windsurf.space.addFileToSpace         — 添加文件到 Space
windsurf.spaces.shareContext          — 共享 Space 上下文
windsurf.editor.managedSpaces         — 管理的 Spaces
windsurf.prioritized.setActiveAgentSpace — 设置活跃 Agent Space
```

### Smart Pane (智能面板)

```
windsurf.prioritized.newCascadeInSmartPane   — 在 Smart Pane 中新建 Cascade
windsurf.prioritized.openAgentInSmartPane    — 在 Smart Pane 中打开 Agent
windsurf.prioritized.smartQuickOpen          — Smart 快速打开
```

### DeepWiki Panel

```
windsurf.deepwikiPanel.focused        — DeepWiki 面板聚焦状态
```

### Cascade Playground

```
https://cascadeplayground.watchdevinwork.com/cascade_query/
https://watchdevinwork.com/cascade/
```

### App Icon Customization

```
windsurf.appIconCustomization         — 图标定制配置
windsurf.customizeAppIcon             — 定制图标
windsurf.isAbleToCustomizeAppIcon     — 是否支持定制
```

### Tab-to-Jump / Rich Ghost Text

```
windsurf.tabToJump                    — Tab 跳转
windsurf.tabToJumpPointerWidget       — 跳转指针组件
windsurf.inlineTabToJumpWidget        — 内联 Tab 跳转
windsurf.richGhostTextShown           — 富预览文本
windsurf.sideHintShown                — 侧边提示
```

### Component Sharing

```
windsurf.componentSharingEnabled      — 组件共享开关
```

### Sea Theme

```
windsurf.sea                          — Sea 主题
windsurf.sea.shade                    — Sea 暗色
windsurf.sea.tint                     — Sea 亮色
```

## 59 个 Windsurf/Codeium URL (workbench)

### 核心服务

| URL | 用途 |
|-----|------|
| `https://server.codeium.com` | API 服务器 |
| `https://unleash.codeium.com/api/frontend` | Feature Flags |
| `https://marketplace.windsurf.com/vscode/gallery` | 扩展市场 |
| `https://windsurf-next.codeium.com` | 更新服务器 |
| `https://status.windsurf.com/` | 状态页 |

### 文档

| URL | 用途 |
|-----|------|
| `https://docs.windsurf.com` | 主文档 |
| `https://docs.windsurf.com/windsurf/cascade/mcp` | MCP 文档 |
| `https://docs.windsurf.com/windsurf/cascade/memories` | 记忆文档 |
| `https://docs.windsurf.com/windsurf/cascade/workflows` | 工作流文档 |
| `https://docs.windsurf.com/windsurf/cascade/app-deploys` | 部署文档 |
| `https://docs.windsurf.com/windsurf/models` | 模型文档 |
| `https://docs.windsurf.com/windsurf/spaces` | **新发现** — Spaces 文档 |
| `https://docs.windsurf.com/troubleshooting/windsurf-common-issues` | 常见问题 |

### 商业/账号

| URL | 用途 |
|-----|------|
| `https://windsurf.com/redirect/windsurf/add-credits` | 充值 |
| `https://windsurf.com/redirect/windsurf/upgrade` | 升级 |
| `https://windsurf.com/redirect/windsurf/feedback` | 反馈 |
| `https://windsurf.com/redirect/windsurf/settings` | 设置 |
| `https://windsurf.com/redirect/windsurf/update-payment` | 支付 |
| `https://www.windsurf.com/windsurf/signin` | 登录页 |
| `https://codeium.com/redirect/windsurf/cascade-model-header-warning` | 模型警告 |
| `https://your-company.windsurf.com` | 企业 Portal 占位符 |
| `https://placeholder.windsurf.com` | 占位符 |

### Devin/外部

| URL | 用途 |
|-----|------|
| `https://app.devin.ai` | Devin 主应用 |
| `https://app.beta.devin.ai` | Devin Beta |
| `https://beta.devinenterprise.com` | Devin 企业 Beta |
| `https://cascadeplayground.watchdevinwork.com/cascade_query/` | **新发现** — Cascade Playground |
| `https://watchdevinwork.com/cascade/` | Watch Devin Work |

### Proposed API 源码 URL (26 个)

全部指向 `https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/vscode.proposed.windsurf*.d.ts`，确认 26 个 Proposed API:

```
windsurfAcp, windsurfAnnotations, windsurfAudio, windsurfAuth,
windsurfCascade, windsurfCommandPopup, windsurfDebug, windsurfDevContainers,
windsurfDiffZone, windsurfEditorCommandPopup, windsurfEditorNudge,
windsurfExtensionManager, windsurfExtensionMetadata, windsurfFiles,
windsurfGenerateCommitMessageButton, windsurfInlineCompletions,
windsurfLanguageServer, windsurfMarkers, windsurfMcp,
windsurfProductEducation, windsurfSettings, windsurfSideHint,
windsurfStatusBar, windsurfTabToJump, windsurfTerminalCommandPopup,
windsurfUndoRedo
```

## 67 个 cascade_* 内部状态键

### Cascade 运行时状态

| 键 | 说明 |
|----|------|
| `cascade_id` / `cascade_ids` | 当前 Cascade 会话 ID |
| `cascade_messages` / `cascade_messages_sent` | 消息计数 |
| `cascade_lines` / `cascade_lines_written` | 代码行数 |
| `cascade_runs` | 运行次数 |
| `cascade_cost` / `cascade_costs` | 成本 |
| `cascade_acu_multiplier` | ACU 乘数 |
| `cascade_seat_type` | 席位类型 |
| `cascade_usage_month_start` / `cascade_usage_month_end` | 月用量周期 |
| `cascade_model_config_data` | 模型配置 |
| `cascade_model_uids` / `cascade_model_labels` | 模型 UID/标签 |
| `cascade_model_explicitly_set` | 模型是否手动设置 |
| `cascade_tool_usage` | 工具使用统计 |
| `cascade_memory_summary` | 记忆摘要 |
| `cascade_nux_states` | 新用户引导状态 |
| `cascade_panel_crash` | 面板崩溃状态 |

### Cascade 安全策略

| 键 | 说明 |
|----|------|
| `cascade_allowed_commands` / `cascade_denied_commands` | 命令白/黑名单 |
| `cascade_allowed_commands_prefix` / `cascade_denied_commands_prefix` | 前缀匹配 |
| `cascade_auto_execution_policy` | 自动执行策略 |
| `cascade_can_auto_run_commands` | 是否可自动运行 |
| `cascade_config_allowlist` / `cascade_config_denylist` | 配置白/黑名单 |
| `cascade_web_requests_auto_execution_policy` | Web 请求策略 |
| `cascade_web_search` / `_enabled` / `_disabled` | Web 搜索开关 |
| `cascade_removed_default_web_origins` | 已移除的默认 Web 源 |
| `cascade_user_allowed_web_origins` | 用户允许的 Web 源 |
| `cascade_hooks_json` | Hooks 配置 JSON |

### Cascade UI 状态

| 键 | 说明 |
|----|------|
| `cascadeEnabled` | Cascade 全局开关 |
| `cascadePlannerMode` | 规划器模式 |
| `cascadeConversationTitle` / `cascadeConversationDropdown` | 对话标题/下拉 |
| `cascadeDiffs` / `cascadeDiffService` | 差异视图 |
| `cascadeEdit` | 编辑状态 |
| `cascadeSuggestion` | 建议状态 |
| `cascadeManagedTerminalFocus` / `cascadeUiTerminalFocus` | 终端焦点 |
| `cascadeEditorHasExternalUrl` | 编辑器外部 URL |
| `cascadeEditorIsDevinCloudAndAwake` | Devin Cloud 唤醒状态 |
| `cascadeHmrInitialLoader` | HMR 初始加载器 |
| `cascadeDismissedSuggestionWorkspaces` | 已关闭建议的工作区 |
| `cascadeAllowedCommands` / `cascadeAutoExecutionPolicy` | UI 层策略 |

---

# Chapter 87: Windsurf 附属扩展 + 构建系统

## 3 个附属扩展

### windsurf-dev-containers (v0.0.1)

开发容器支持，8 个命令:

| 命令 | 功能 |
|------|------|
| `windsurf-dev-containers.reopenInContainer` | 在容器中重新打开 |
| `windsurf-dev-containers.openInContainer` | 在容器中打开文件夹 |
| `windsurf-dev-containers.reopenFolderLocally` | 本地重新打开 |
| `windsurf-dev-containers.attachToRunningContainer` | 附加到运行中容器 |
| `windsurf-dev-containers.showLog` | 显示日志 |
| `windsurf-dev-containers.explorer.refresh` | 刷新 |
| `windsurf-dev-containers.explorer.deleteContainer` | 删除容器 |
| `windsurf-dev-containers.openFromHistory` | 从历史打开 |

配置:
- `remote.windsurfDevContainers.enableSSHAgentForwarding` [boolean]
- `remote.windsurfDevContainers.experimental.disableServerChecksum` [boolean]

### windsurf-remote-openssh (v0.0.1)

SSH 远程连接，12 个命令:

| 命令 | 功能 |
|------|------|
| `windsurf-remote-openssh.newWindow` | 连接 SSH (新窗口) |
| `windsurf-remote-openssh.currentWindow` | 连接 SSH (当前窗口) |
| `windsurf-remote-openssh.closeSSHProcess` | 关闭 SSH 进程 |
| `windsurf-remote-openssh.showLog` | 显示日志 |
| `windsurf-remote-openssh.explorer.*` | 资源管理器操作 |

配置:
- `remote.windsurfSSH.configFile` — SSH 配置文件路径
- `remote.windsurfSSH.path` — SSH 二进制路径
- `remote.windsurfSSH.httpProxy` / `httpsProxy` — 代理
- `remote.windsurfSSH.connectTimeout` [number] — 超时
- `remote.windsurfSSH.maxReconnectionAttempts` — 重连次数
- `remote.windsurfSSH.reconnectionGraceTime` — 重连间隔
- `remote.windsurfSSH.experimental.serverDownloadUrlTemplate` — 服务器下载模板
- `remote.windsurfSSH.experimental.serverBinaryName` — 服务器二进制名
- `remote.windsurfSSH.experimental.disableServerChecksum` — 禁用校验

### windsurf-remote-wsl (v0.0.1)

WSL 远程开发，14 个命令:

| 命令 | 功能 |
|------|------|
| `windsurfremotewsl.connect` | 连接 WSL |
| `windsurfremotewsl.connectInNewWindow` | 新窗口连接 |
| `windsurfremotewsl.connectUsingDistro` | 选择发行版连接 |
| `windsurfremotewsl.explorer.addDistro` | 添加发行版 |
| `windsurfremotewsl.explorer.setDefaultDistro` | 设置默认发行版 |
| `windsurfremotewsl.explorer.deleteDistro` | 删除发行版 |

配置:
- `remote.WSL.serverDownloadUrlTemplate` — 服务器下载模板
- `remote.WSL.experimental.disableServerChecksum` — 禁用校验

## 构建系统 (package.json scripts)

### 核心构建脚本

| 脚本 | 命令 |
|------|------|
| `setup-dev` | `npm install && npm run prepare-exa && bash build_windsurf/download_fd_and_devin_cli.sh` |
| `prepare-exa` | `cd .. && pnpm install --frozen-lockfile && pnpm build:windsurf-deps && cd windsurf && ...` |
| `copy-chat-client` | `node ../exa/chat_client/scripts/copy-to-windsurf.js` |
| `copy-windsurf-acp` | `node ../exa/windsurf_acp/scripts/copy-to-windsurf.js` |
| `port-protos` | 复制 `extensions/windsurf/src/generated` → `src/vs/base/common/generated` |
| `protoc` | `buf generate` — 从 `exa/` 目录生成 protobuf 代码 |
| `generate-ls-version` | 生成 LS 版本号 |
| `watch-theme-windsurf` | `node ../exa/windsurf-ds-theme/build.js --watch` |

### Monorepo 结构推断

从构建脚本推断上游 monorepo:

```
(root)/
├── exa/                              # Exafunction 核心代码
│   ├── chat_client/                  # Chat 客户端 proto 生成
│   ├── windsurf_acp/                 # ACP 协议实现
│   ├── windsurf-ds-theme/            # Windsurf 设计系统主题
│   ├── language_server_pb/           # LS protobuf 定义
│   └── product_analytics_pb/         # 产品分析 protobuf
├── windsurf/                         # VS Code fork (当前目录)
│   ├── extensions/windsurf/          # 主扩展
│   ├── src/vs/                       # VS Code 源码
│   └── build_windsurf/              # Windsurf 构建脚本
└── vscode-packages/                  # 组件探索器
```

### 依赖管理

- 63 个 npm 依赖
- 使用 `patch-package` (postinstall)
- 使用 `pnpm` (prepare-exa 阶段)
- 使用 `buf` (protobuf 代码生成)
- 使用 `deemon` (持久化开发服务器)

## Workbench 文件体积分析

| 文件 | 大小 |
|------|------|
| `workbench.desktop.main.js` | 31.28 MB |
| `sessions.desktop.main.js` | 30.16 MB |
| `extensionHostProcess.js` | 2.24 MB |
| `extensionHostWorkerMain.js` | 2.00 MB |
| `nls.metadata.json` | 1.64 MB |
| `main.js` (Electron) | 1.11 MB |
| `workbench.desktop.main.css` | 1.16 MB |
| `sharedProcessMain.js` | 1.02 MB |
| `sessions.desktop.main.css` | 0.95 MB |
| `cliProcessMain.js` | 0.71 MB |
| **总计 JS** | **~70 MB** |

Sessions 是 Windsurf 独有的并行 workbench 实例 (用于 Cascade 独立窗口)，几乎完全复制 workbench 代码。

---

## 最终统计更新

| 指标 | 数值 |
|------|------|
| **文档总章节** | 87 |
| **Windsurf Workbench 服务** | 34 个 |
| **windsurf.* 配置/命令键** | 299 个 (workbench) |
| **cascade_* 内部状态键** | 67 个 |
| **Windsurf/Codeium URL** | 59 个 (workbench) |
| **Proposed APIs** | 26 个 |
| **附属扩展** | 3 个 (dev-containers + SSH + WSL) |
| **附属扩展命令** | 34 个 (8+12+14) |
| **构建系统脚本** | 65+ |
| **JS Bundle 总体积** | ~70 MB |
| **product.json 行数** | 1341 行 |
| **完整性校验文件** | 9 个 |

---

# Chapter 88: Devin for Terminal 完整扩展体系

> 来源: 26 个 `.mdx` 文档 (Devin CLI 内置离线文档)

## Subagents 系统

Devin CLI 支持完整的子代理 (Subagent) 体系:

### 内置 Subagent Profile

| Profile | 能力 | 工具访问 |
|---------|------|---------|
| `subagent_explore` | 只读代码探索和研究 | 仅 read-only 工具 |
| `subagent_general` | 通用任务 (可修改代码) | 前台: 全部; 后台: 仅已授权 |

### 运行模式

- **前台 (Foreground)**: 父代理暂停等待, 可逐步审批工具调用
- **后台 (Background)**: 并行执行, 未授权工具自动拒绝, 完成后通知父代理
- **切换**: `Ctrl+B` 前台→后台; Subagent panel 按 `f` 后台→前台
- **取消**: `Ctrl+C` / `Esc` (前台); panel 按 `x` (后台)
- **恢复**: 已取消/失败/完成的 subagent 可恢复, 恢复后强制前台模式
- **嵌套限制**: 仅 root agent 可 spawn subagent, 不允许嵌套

### 自定义 Subagent

目录结构: `.devin/agents/<name>/AGENT.md` 或 `~/.config/devin/agents/<name>/AGENT.md`

AGENT.md Frontmatter:

```yaml
---
name: reviewer
description: Reviews code changes
model: sonnet
allowed-tools: [read, grep, glob, exec]
permissions:
  allow: ["Exec(git diff)"]
  deny: ["write", "edit"]
---
系统提示内容...
```

- 兼容 Claude Code 的 `.claude/agents/*.md` 格式
- Claude Code 使用 `tools` 字段 → Devin 使用 `allowed-tools` (两者都支持)

## Skills 系统

### 定义格式

文件: `SKILL.md` 在命名目录内

```yaml
---
name: review
description: Review staged changes
argument-hint: "[file] [options]"
model: sonnet
subagent: true
agent: reviewer           # 指定 subagent profile
allowed-tools: [read, grep, glob, exec]
permissions:
  allow: ["Read(src/**)"]
  deny: ["exec"]
  ask: ["Write(**)"]
triggers: [user, model]
---
提示内容... $1 $ARGUMENTS @file.md !`command`
```

### Skill 存储位置

| 位置 | 范围 | 提交到 git? |
|------|------|-----------|
| `.agents/skills/<name>/SKILL.md` | 项目 | 是 |
| `.devin/skills/<name>/SKILL.md` | 项目 | 是 |
| `.windsurf/skills/<name>/SKILL.md` | 项目 | 是 |
| `~/.agents/skills/<name>/SKILL.md` | 全局 | 否 |
| `~/.config/devin/skills/<name>/SKILL.md` | 全局 | 否 |
| `~/.codeium/<channel>/skills/<name>/SKILL.md` | 全局 (channel) | 否 |

### 动态内容

- `$1`, `$2`... — 位置参数
- `$ARGUMENTS` — 全部参数
- `@file.md` — 文件内容引入
- `` !`command` `` — Shell 命令输出

### Skill 编排模式

Skills 可作为 subagent 执行 → 一个普通 skill 可以调用多个 subagent skill = 编排器模式，始终单层嵌套。

## Hooks 系统 (Claude Code 兼容)

### 8 个 Hook 事件

| 事件 | 触发时机 | 可用数据 |
|------|---------|---------|
| `PreToolUse` | 工具执行前 | tool_name, tool_input |
| `PostToolUse` | 工具执行后 | tool_name, tool_input, tool_response |
| `PermissionRequest` | 需要权限决策时 | tool_name, tool_input |
| `UserPromptSubmit` | 用户提交消息时 | prompt |
| `Stop` | Agent 决定停止时 | stop_hook_active |
| `PostCompaction` | 上下文压缩完成后 | summary |
| `SessionStart` | 会话开始时 | source |
| `SessionEnd` | 会话结束时 | reason |

### Hook 类型

- **command**: 运行 shell 命令, stdin 接收 JSON 事件, stdout 返回决策
- **prompt**: LLM 提示评估, 支持 `{{variable}}` 模板

### Hook 决策

| decision | 效果 |
|----------|------|
| `approve` | 允许 |
| `block` | 阻止 |
| `deny` | 拒绝 |
| `ask` | 强制用户确认 |
| `interrupt` | 中断 agent |

### Hook 退出码

| 代码 | 含义 |
|------|------|
| 0 | 成功 |
| 2 | 阻止 |
| 其他 | 错误 (记录但不阻止) |

### Hook 配置位置

| 位置 | 说明 |
|------|------|
| `.devin/hooks.v1.json` | 独立 hook 文件 (推荐) |
| `.devin/config.json` → `hooks` | 项目配置 |
| `.devin/config.local.json` → `hooks` | 本地覆盖 |
| `.claude/settings.json` → `hooks` | Claude Code 兼容 |
| `~/.config/devin/config.json` → `hooks` | 用户全局 |

### Custom Hooks (YAML 格式, 计划中)

高级 YAML 格式支持:
- `cogs` (Middleware): 临时修改权限/工具
- `prompt` 类型: LLM 评估 + 模板插值
- Glob/Regex 匹配器

## 配置系统

### 完整配置参考

| 选项 | 类型 | 默认值 | 范围 |
|------|------|--------|------|
| `agent.model` | string | `"swe-1-6-fast"` | 仅用户 |
| `agent.show_history_on_continue` | bool | `true` | 仅用户 |
| `theme_mode` | string/null | `null` | 仅用户 |
| `show_path` | bool | `false` | 仅用户 |
| `unicode_mode` | string | `"auto"` | 仅用户 |
| `include_gitignored_files` | bool | `false` | 仅用户 |
| `respect_gitignore` | bool | `false` | 仅用户 |
| `auto_update` | bool | `true` | 仅用户 |
| `notify` | string | `"smart"` | 仅用户 |
| `permissions` | object | `{}` | 用户+项目 |
| `mcpServers` | object | `{}` | 用户+项目 |
| `read_config_from` | object | all true | 用户+项目 |
| `hooks` | object | `{}` | 用户+项目 |
| `proxy.mode` | string | `"system"` | 仅用户 |
| `proxy.url` | string/null | `null` | 仅用户 |
| `proxy.no_proxy` | string/null | `null` | 仅用户 |
| `sandbox.allowed_domains` | string[] | `[]` | 仅用户 |
| `sandbox.denied_domains` | string[] | `[]` | 仅用户 |
| `sandbox.network_mode` | string | `"full"` | 仅用户 |

### 5 级配置优先级

1. **组织/团队设置** (最高, 不可覆盖)
2. **会话批准** (内存中)
3. **项目本地** `.devin/config.local.json` (gitignored)
4. **项目** `.devin/config.json` (committed)
5. **用户** `~/.config/devin/config.json` (最低)

### Sandbox 系统

- `--sandbox` 启用 OS 级别沙盒
- Autonomous 模式: shell 命令自动批准 (沙盒限制)
- `edit`/`write` 工具仍需手动批准 (运行在 CLI 进程中)
- 动态 Scope 扩展: 会话中授权 → 沙盒自动扩展
- 域名过滤: `allowed_domains` / `denied_domains` + `network_mode`
- 失败关闭: 沙盒不可用时 CLI 拒绝启动

### 6 工具跨配置导入

| 工具 | 导入内容 |
|------|---------|
| **Cursor** | rules (`.cursorrules`, `.cursor/rules/*.md`), MCP (`.cursor/mcp.json`) |
| **Windsurf** | rules (`.windsurf/rules/*.md`), skills, workflows, MCP (`mcp_config.json`) |
| **Claude Code** | rules (`CLAUDE.md`), skills, commands→skills, MCP (7 个位置) |
| **OpenCode** | MCP (`opencode.json`, `~/.config/opencode/opencode.json`) |
| **VS Code** | MCP (`.vscode/mcp.json`, 使用 `servers` 键) |
| **Zed** | MCP (`.zed/settings.json`, 使用 `context_servers` 键) |

## Permission 系统

### 4 种权限模式对比

| 工具类型 | Normal | Accept Edits | Bypass | Autonomous |
|---------|--------|-------------|--------|-----------|
| 只读 | ✅自动 | ✅自动 | ✅自动 | ✅自动 |
| Fetch | 需确认 | 需确认 | ✅自动 | ✅自动 |
| Shell | 需确认 | 需确认 | ✅自动 | ✅自动 |
| 文件编辑 | 需确认 | ✅自动(工作区) | ✅自动 | 需确认 |

### Permission 语法

- **Scope-based**: `Read(glob)`, `Write(glob)`, `Exec(prefix)`, `Fetch(pattern)`
- **Tool-based**: `read`, `edit`, `grep`, `glob`, `exec`
- **MCP**: `mcp__server__tool`, `mcp__server__*`, `mcp__*`
- **优先级**: deny > ask > allow > default(prompt)

## MCP 配置 (Devin CLI)

### CLI MCP 命令

```bash
devin mcp add <name> -- <command> [args...]    # stdio
devin mcp add <name> <URL>                      # Streamable HTTP
devin mcp add -s project <name> <URL>           # 项目范围
devin mcp add -s user <name> <URL>              # 用户范围
devin mcp list / get / remove / login / logout
```

### MCP 传输

- **stdio**: command + args + env (本地进程)
- **Streamable HTTP**: url + headers (远程)
- **Legacy SSE**: ❌ 不支持 (内部代号 `chisel` 引擎)
- **OAuth**: `devin mcp login <name>` → 浏览器授权 → 本地存储 token

### 已知 MCP 服务器集成

- GitHub (`@modelcontextprotocol/server-github`)
- Notion (`https://mcp.notion.com/mcp`)
- Linear (`https://mcp.linear.app/mcp`)
- Atlassian/Jira (`https://mcp.atlassian.com/v1/mcp`)

## Rules / AGENTS.md 系统

### 支持的规则文件

| 文件 | 格式 |
|------|------|
| `AGENTS.md` / `AGENT.md` / `CLAUDE.md` | Always-on rules |
| `.cursorrules` | Cursor 兼容 |
| `.cursor/rules/*.md` | Cursor rules (支持 frontmatter) |
| `.windsurf/rules/*.md` | Windsurf rules (支持 trigger) |
| `.windsurf/global_rules.md` | Windsurf 全局 |

### Rule 激活类型

| 类型 | 行为 |
|------|------|
| `always_on` | 每次会话自动加载 |
| `glob` | 匹配文件时激活 |
| `model_decision` | Agent 自行决定 |
| `manual` | 用户手动触发 |

### 子目录发现

`AGENTS.md` 和 `.windsurf/rules/` 支持多级目录存在。根目录在会话开始时加载，子目录在 agent 访问时懒加载。

## 模型系统

- 默认模型: `swe-1-6-fast` (Cognition 自研 SWE 模型)
- 短名: `opus`, `sonnet`, `swe`, `codex`, `gemini` → 始终解析到最新版本
- 推理等级: `Alt+T` 循环切换
- 支持: Anthropic, OpenAI, Google, Cognition, 开源 (Kimi, GLM)
- 推荐: `swe` (快速/低成本), `gpt` (多文件重构), `opus` (深度推理)

---

# Chapter 89: 进程架构 + Telemetry + node_modules 依赖

## Electron 进程架构

### 6 个进程 Bundle

| 进程 | 文件 | 大小 | 角色 |
|------|------|------|------|
| **Main** | `main.js` | 1.16 MB | Electron 主进程 |
| **Workbench Renderer** | `workbench.desktop.main.js` | 31.28 MB | 主 UI 渲染 |
| **Sessions Renderer** | `sessions.desktop.main.js` | 30.16 MB | Cascade 独立窗口 |
| **Extension Host (Node)** | `extensionHostProcess.js` | 2.35 MB | 扩展宿主 (Node) |
| **Extension Host (Worker)** | `extensionHostWorkerMain.js` | 2.10 MB | 扩展宿主 (Web Worker) |
| **Shared Process** | `sharedProcessMain.js` | 1.06 MB | 后台共享进程 |
| **CLI Process** | `cliProcessMain.js` | 0.74 MB | CLI 命令处理 |
| **PTY Host** | `ptyHostMain.js` | 0.39 MB | 终端伪终端 |

### 进程间 Windsurf 差异

- **所有进程**: 共享 26 个 Proposed API 定义
- **Workbench 独有**: 6 个额外服务 (ActionsManager, Feedback, Header, Resource, WindowsMainManager, WindowsManager)
- **Extension Host**: `registerWindsurfDevContainerContext` API
- **Shared/CLI**: Telemetry URL 端点

## Telemetry 系统

### 新发现: Telemetry URL

```
https://windsurf-telemetry.codeium.com/ping
https://windsurf-telemetry.codeium.com/telemetry
```

仅在 `sharedProcessMain.js` 和 `cliProcessMain.js` 中出现, 不在 workbench/sessions 中。表明:
- Telemetry 通过 Shared Process 统一收集
- CLI 独立上报遥测数据
- Workbench 通过 IPC → Shared Process 间接上报

## Sourcemap CDN

```
https://cdn.windsurf.com/sourcemaps/{commit_hash}/core/{bundle_path}.map
```

当前 commit: `a65d6c4e1fd335336d7a0b601099811667e184ca`

## vscode.d.ts Windsurf 扩展

核心 TypeScript 定义中仅有一个 Windsurf 特有类型:

```typescript
windsurfAdditionalSelectedCompletionInfo
```

这是对 VS Code 补全 API 的扩展, 携带 Windsurf 特有的补全元信息。

## node_modules 依赖分析 (8124 文件)

### Windsurf/Cognition 私有包

| 包 | 用途 |
|-----|------|
| `@exa/*` | Exafunction 内部包 |
| `@connectrpc/*` | Connect-RPC 协议库 |
| `@bufbuild/*` | Protobuf/Buf 工具链 |

### AI/ML 相关

| 包 | 用途 |
|-----|------|
| `@anthropic-ai/*` | Anthropic API 客户端 |
| `eventsource-parser` | SSE 解析 (streaming) |
| `launchdarkly-eventsource` | LaunchDarkly SSE |

### 可视化

| 包 | 用途 |
|-----|------|
| `d3` + 27 个 d3-* | D3.js 数据可视化 |
| `mermaid` | Mermaid 图表渲染 |
| `cytoscape` / `dagre-d3-es` | 图/网络可视化 |
| `katex` | LaTeX 数学公式渲染 |
| `roughjs` / `hachure-fill` | 手绘风格图形 |
| `svg-pan-zoom` | SVG 缩放平移 |

### UI 框架

| 包 | 用途 |
|-----|------|
| `react` + `react-dom` + `scheduler` | React UI |
| `preact` | 轻量 React 替代 |
| `framer-motion` / `motion` / `motion-dom` | 动画库 |
| `zustand` | React 状态管理 |
| `stylis` | CSS-in-JS |

### 终端/浏览器

| 包 | 用途 |
|-----|------|
| `@xterm/*` | xterm.js 终端模拟器 |
| `node-pty` | PTY 原生绑定 |
| `playwright-core` | Browser Preview (Chromium) |
| `chrome-remote-interface` | Chrome DevTools Protocol |

### Feature Flags

| 包 | 用途 |
|-----|------|
| `unleash-client` | Unleash Feature Flags 客户端 |
| `unleash-proxy-client` | Unleash Proxy 客户端 |

### 安全/认证

| 包 | 用途 |
|-----|------|
| `kerberos` | Kerberos 企业认证 |
| `tas-client` | 治疗分配服务 (A/B 测试) |
| `native-keymap` | 原生键盘映射 |

### 网络

| 包 | 用途 |
|-----|------|
| `undici` | HTTP/1.1+2 客户端 |
| `socks` / `socks-proxy-agent` | SOCKS 代理 |
| `http-proxy-agent` / `https-proxy-agent` | HTTP 代理 |
| `tunnel-agent` | HTTP 隧道 |

### LS 相关

| 包 | 用途 |
|-----|------|
| `vscode-languageserver` + protocol + types | LSP 协议 |
| `vscode-jsonrpc` | JSON-RPC 通信 |
| `vscode-textmate` / `vscode-oniguruma` | 语法高亮 |

### 工具

| 包 | 用途 |
|-----|------|
| `marked` | Markdown 渲染 |
| `dompurify` | HTML 净化 |
| `semver` | 版本号比较 |
| `zod` | 运行时类型验证 |
| `langium` | 语言工程框架 |
| `chevrotain` | Parser 工具 |

## LS Binary

```
bin/language_server_windows_x64.exe  — Go 编译的 Language Server
bin/fd.exe                           — fd (文件搜索工具)
bin/fd.LICENSE                       — fd MIT 许可证
```

---

# Chapter 90: 全面逆向总结

## 一、架构全景

```
┌─────────────────────────────────────────────────────┐
│                Windsurf IDE (Electron)               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ Main Process│  │  Workbench  │  │  Sessions   │ │
│  │  (main.js)  │  │  Renderer   │  │  Renderer   │ │
│  │  1.16 MB    │  │  31.28 MB   │  │  30.16 MB   │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
│         │                │                │         │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐ │
│  │Shared Proc  │  │ Ext Host    │  │ PTY Host    │ │
│  │  1.06 MB    │  │  2.35 MB    │  │  0.39 MB    │ │
│  └─────────────┘  └──────┬──────┘  └─────────────┘ │
│                          │                           │
│              ┌───────────┴───────────┐              │
│              │  Windsurf Extension   │              │
│              │   (extension.js)      │              │
│              │      9.6 MB           │              │
│              └───────────┬───────────┘              │
│                          │ gRPC                      │
│              ┌───────────┴───────────┐              │
│              │  Language Server (Go) │              │
│              │  language_server.exe   │              │
│              └───────────┬───────────┘              │
└──────────────────────────┼──────────────────────────┘
                           │ Connect-RPC / gRPC
              ┌────────────┴────────────┐
              │   Cloud Infrastructure  │
              │                         │
              │ server.codeium.com      │
              │ server.self-serve.ws.com│
              │ register.windsurf.com   │
              │ inference.codeium.com   │
              │ unleash.codeium.com     │
              │ windsurf-telemetry.*.com│
              │ marketplace.ws.com      │
              │ cdn.windsurf.com        │
              └─────────────────────────┘
```

## 二、核心数据统计

| 分类 | 数量 |
|------|------|
| **文档总章节** | 90 |
| **gRPC Services** | 14 |
| **gRPC Methods** | 512 |
| **Proto 文件** | 41 |
| **CortexStepType** | 93 种 |
| **TrajectoryType** | 19 种 |
| **PlannerType** | 8 种 |
| **CascadeToolConfig** | 30 种 |
| **远程可调用端点** | 19+ |
| **LS 本地方法** | 140 |
| **Proposed APIs** | 26 |
| **Workbench 服务** | 34 |
| **windsurf.* 键** | 299 |
| **cascade_* 键** | 67 |
| **URL 端点** | 59+ |
| **Extension 命令** | 31 + 34 (附属) |
| **Extension 配置项** | 26 + 14 (附属) |
| **模型列表** | 115 Cascade + 66 CLI + 8 Command |
| **Devin Hooks 事件** | 8 个 |
| **Devin Skill 存储位置** | 6 个 |
| **配置导入工具** | 6 个 (Cursor/Windsurf/Claude/OpenCode/VS Code/Zed) |
| **node_modules 包** | 200+ |
| **JS Bundle 总体积** | ~70 MB |

## 三、认证链路

```
用户浏览器 → Windsurf Auth1 Login
    ↓ auth1_token
WindsurfPostAuth(auth1_token)
    ↓ session_token (X-Devin-Auth1-Token)
GetOneTimeAuthToken(session_token)
    ↓ ott$xxx
RegisterUser(ott)
    ↓ api_key (devin-session-token$JWT) + api_server_url
所有 API 调用使用 metadata.apiKey
```

## 四、协议栈

```
Extension ↔ LS:        gRPC (localhost, protobuf)
LS ↔ API Server:       Connect-RPC (HTTP/1.1 + protobuf) 
LS ↔ Inference:        gRPC (inference.codeium.com)
Extension ↔ Devin:     ACP (Agent Communication Protocol)
IDE ↔ MCP:             stdio / Streamable HTTP
Workbench ↔ Ext Host:  JSON-RPC (IPC)
Main ↔ Renderer:       Electron IPC
Shared Process:        IPC Channels
```

## 五、关键发现

### 1. Sessions = Cascade 独立窗口
`sessions.desktop.main.js` (30MB) 几乎完全复制 `workbench.desktop.main.js` (31MB)，是 Agent Window/Smart Pane 的底层实现。

### 2. Devin for Terminal = Cognition 的 Claude Code 竞品
完全兼容 Claude Code hooks/agents 格式，支持导入 6 种工具的配置，内置 OS 级别沙盒。内部代号 "chisel"。

### 3. 6 个新发现系统
- **Agent Window**: 独立 AI Agent 窗口
- **Spaces**: 文件组织/共享上下文系统
- **Smart Pane**: 智能面板 (Cascade + Agent 集成)
- **DeepWiki Panel**: 知识库面板
- **Cascade Playground**: 在线测试环境 (`cascadeplayground.watchdevinwork.com`)
- **Component Sharing**: 组件共享系统

### 4. 三层 Feature Flag 控制
- Unleash (`unleash.codeium.com`) → 远程特性开关
- TAS Client → A/B 测试分配
- `checkExperiment` → LS→Extension 实验检查

### 5. 完整性校验
9 个核心文件的 SHA256 校验写入 `product.json`，启动时验证。

### 6. Telemetry 双通道
- `windsurf-telemetry.codeium.com/ping` — 心跳
- `windsurf-telemetry.codeium.com/telemetry` — 详细遥测
- 通过 Shared Process 和 CLI Process 上报

## 六、已分析文件清单

### JS Bundles (全部 ✅)

| 文件 | 大小 | 状态 |
|------|------|------|
| `workbench.desktop.main.js` | 31.28 MB | ✅ |
| `sessions.desktop.main.js` | 30.16 MB | ✅ |
| `extension.js` | 9.6 MB | ✅ |
| `extensionHostProcess.js` | 2.35 MB | ✅ |
| `extensionHostWorkerMain.js` | 2.10 MB | ✅ |
| `main.js` | 1.16 MB | ✅ |
| `sharedProcessMain.js` | 1.06 MB | ✅ |
| `nls.messages.json` | 0.85 MB | ✅ |
| `cli.js` | 0.26 MB | ✅ |
| `cliProcessMain.js` | 0.74 MB | ✅ |
| `ptyHostMain.js` | 0.39 MB | ✅ |

### 配置/元数据 (全部 ✅)

| 文件 | 状态 |
|------|------|
| `product.json` | ✅ |
| `package.json` (app) | ✅ |
| `package.json` (windsurf ext) | ✅ |
| `package.json` (dev-containers) | ✅ |
| `package.json` (remote-openssh) | ✅ |
| `package.json` (remote-wsl) | ✅ |
| `vscode.d.ts` | ✅ |
| `acp_registry.schema.json` | ✅ |
| `mcp_config.schema.json` | ✅ |

### Proto 文件 (全部 ✅)

| 范围 | 数量 |
|------|------|
| `cortex.proto` + 相关 | 41 个 |

### 文档 (全部 ✅)

| 来源 | 数量 |
|------|------|
| Devin CLI `.mdx` | 26 个 |
| Devin `AGENTS.md` | 1 个 |

### Binary

| 文件 | 说明 |
|------|------|
| `language_server_windows_x64.exe` | Go LS (无法反编译) |
| `fd.exe` | 文件搜索工具 |
| `458.js` | 并发映射器 (无 Windsurf 特有内容) |

## 七、未覆盖/不可分析

- `language_server_windows_x64.exe` — Go binary, 无源码
- `node_modules.asar` — Electron 打包资源
- `ThirdPartyNotices.txt` — 第三方许可 (纯法律文本)
- `extension.js.LICENSE.txt` — 许可信息

---

# 91. @exa/chat-client 深度逆向 — 完整 Proto 类型清单与事件体系

> 来源: `node_modules/@exa/chat-client/index.js` (14.4 MB, 单文件 minified)

## 一、包概况

| 指标 | 值 |
|------|-----|
| **包名** | `@exa/chat-client` |
| **大小** | 14.4 MB (2 行 minified) |
| **版本** | `0.0.0` (内部包) |
| **模块格式** | ESM (`"type": "module"`) |
| **导出符号** | 41 个 |

### 核心导出

| 导出名称 | 用途 |
|----------|------|
| `CascadeAction` | Cascade 操作枚举 |
| `ConnectionState` | 连接状态管理 |
| `DEVIN_CLOUD_PROVIDER_ID` | Devin Cloud 提供者标识 |
| `EventChannel` | 事件通道管理 |
| `MAX_CONNECTION_ATTEMPTS` | 最大连接重试次数 |
| `RETRY_TIMEOUT` | 重试超时 |
| `ReactiveStateStore` | 响应式状态存储 |
| `acpStore` | ACP 存储实例 |
| `activeViewInstances` | 活跃视图实例 |
| `cascadeSessionResource` | Cascade 会话资源 |
| `commandsDetectedByWindsurfIdeRunByChatClient` | IDE 检测到的命令 |
| `deriveDevinSleepStatus` | Devin 睡眠状态推导 |
| `filterActiveSessions` | 过滤活跃会话 |
| `getCascadeIdFromResource` | 从资源提取 Cascade ID |
| `getSessionUrl` | 获取会话 URL |
| `getView` / `registerView` / `renderView` | 视图管理 |
| `getWorktreePathFromResource` | 获取工作树路径 |
| `isDevinSessionSleeping` | Devin 会话睡眠检测 |
| `loadSessionThunk` | 加载会话 (Redux thunk) |
| `sendAgentRequestThunk` | 发送 Agent 请求 |
| `registerAcpSingleton` / `tryGetAcpSingleton` | ACP 单例管理 |
| `resolveSpaceSessionInfo` | 解析 Space 会话信息 |
| `saveDiffZoneStates` | 保存差异区域状态 |
| `updateCascadeSessionBridgeSummaries` | 更新会话桥接摘要 |
| `useVSCodeAPI` | VS Code API Hook (React) |

## 二、Connect-RPC 服务绑定 (4 个 Service)

```
exa.extension_server_pb.ExtensionServerService  → LS→Extension 回调
exa.language_server_pb.LanguageServerService      → Extension→LS 请求
exa.seat_management_pb.SeatManagementService      → 账号管理/认证
exa.user_analytics_pb.UserAnalyticsService        → 用户分析 (新发现!)
```

> **新发现**: `UserAnalyticsService` 此前未在 chat-client 上下文中出现过，表明 chat-client 直接参与分析数据上报。

## 三、RPC 方法 (chat-client 内部)

| 方法名 | 用途 |
|--------|------|
| `agent_thought_chunk` | Agent 思考块流 |
| `tool_call_update` | 工具调用更新流 |
| `user_message_chunk` | 用户消息块流 |
| `map` | 通用映射 |

## 四、完整 Proto 类型清单 — 1943 个 Service Paths

### 4.1 按 Proto 包分布

| Proto 包 | 类型数量 | 说明 |
|----------|---------|------|
| `exa.codeium_common_pb` | ~330 | 核心公共类型 |
| `exa.cortex_pb` | ~360 | Cortex 引擎 |
| `exa.language_server_pb` | ~300 | LS 方法 |
| `exa.seat_management_pb` | ~350 | 账号管理 |
| `exa.extension_server_pb` | ~110 | Extension 服务 |
| `exa.opensearch_clients_pb` | ~85 | 知识库连接器 |
| `exa.user_analytics_pb` | ~90 | 用户分析 |
| `exa.index_pb` | ~65 | 索引系统 |
| `exa.chat_pb` | ~50 | 聊天消息 |
| `exa.cascade_plugins_pb` | ~35 | MCP 插件 |
| `exa.knowledge_base_pb` | ~15 | 知识库 CRUD |
| `exa.context_module_pb` | ~20 | 上下文模块 |
| `exa.diff_action_pb` | ~12 | 差异操作 |
| `exa.reactive_component_pb` | ~10 | 响应式组件 |
| `exa.auto_cascade_common_pb` | ~8 | Auto Cascade |
| `exa.product_analytics_pb` | ~5 | 产品分析 |
| `exa.bug_checker_pb` | ~3 | Bug 检查器 |
| `exa.chat_client_server_pb` | ~8 | Chat Client 服务 |

### 4.2 新发现 Proto 类型 (此前未详细记录)

#### ChatClientServer 请求类型

```protobuf
exa.chat_client_server_pb.AddCascadeInputRequest
exa.chat_client_server_pb.ChatClientRequest
exa.chat_client_server_pb.FileDiffState
exa.chat_client_server_pb.ImplementPlanRequest         // 实现计划请求
exa.chat_client_server_pb.InitialAckRequest            // 初始确认
exa.chat_client_server_pb.RefreshCustomizationRequest   // 刷新自定义
exa.chat_client_server_pb.SendActionToChatPanelRequest  // 发送动作到面板
exa.chat_client_server_pb.SendCascadeInputRequest       // 发送输入
exa.chat_client_server_pb.StartChatClientRequestStreamRequest // 启动请求流
```

#### DeepWiki 类型 (新细节)

```protobuf
exa.chat_pb.DeepWikiContext
exa.chat_pb.DeepWikiHoverContext        // 悬停上下文
exa.chat_pb.DeepWikiRequestType
exa.chat_pb.DeepWikiSymbolContext       // 符号上下文
exa.chat_pb.DeepWikiSymbolRange
exa.chat_pb.DeepWikiSymbolType          // 符号类型
exa.codeium_common_pb.DeepWikiModelType // 模型类型
```

#### Browser 自动化类型

```protobuf
exa.codeium_common_pb.BrowserClickInteraction
exa.codeium_common_pb.BrowserCodeBlockScopeItem
exa.codeium_common_pb.BrowserExperimentalFeaturesConfig
exa.codeium_common_pb.BrowserInstallationStatus
exa.codeium_common_pb.BrowserInteraction
exa.codeium_common_pb.BrowserPageMetadata
exa.codeium_common_pb.BrowserPageScopeItem
exa.codeium_common_pb.BrowserScrollInteraction
exa.codeium_common_pb.BrowserTextScopeItem
```

#### Model 系统扩展类型

```protobuf
exa.codeium_common_pb.ModelAlias               // 模型别名
exa.codeium_common_pb.ModelCostTier             // 模型成本层级
exa.codeium_common_pb.ModelDimension            // 模型维度
exa.codeium_common_pb.ModelDimensionKind        // 维度种类
exa.codeium_common_pb.ModelFamilyMetadata       // 模型族元数据
exa.codeium_common_pb.ModelFamilyMetadataEntry
exa.codeium_common_pb.ModelFamilyMetadataValue
exa.codeium_common_pb.ModelFeatures             // 模型特性
exa.codeium_common_pb.ModelNotification         // 模型通知
exa.codeium_common_pb.ModelOrAlias              // 模型或别名
exa.codeium_common_pb.ModelPricingType          // 定价类型
exa.codeium_common_pb.ModelUsageStats           // 使用统计
exa.codeium_common_pb.ResponseDimension         // 响应维度
exa.codeium_common_pb.ResponseDimensionCopyableCode
exa.codeium_common_pb.ResponseDimensionCumulativeMetric
exa.codeium_common_pb.ResponseDimensionGroup
exa.codeium_common_pb.ResponseDimensionMetric
```

#### 推理配置 (多提供者)

```protobuf
exa.codeium_common_pb.AnthropicInferenceConfig  // Anthropic 推理配置
exa.codeium_common_pb.GoogleInferenceConfig     // Google 推理配置
exa.codeium_common_pb.OpenAIInferenceConfig     // OpenAI 推理配置
exa.codeium_common_pb.InferenceConfig           // 通用推理配置
exa.codeium_common_pb.ApiProviderConfig         // API 提供者配置
exa.codeium_common_pb.ApiProviderConfigMap
exa.codeium_common_pb.ApiProviderRoutingConfig  // 路由配置
exa.codeium_common_pb.ShadowTrafficConfig       // 影子流量配置
exa.codeium_common_pb.ShadowTarget
exa.codeium_common_pb.ShadowTargetList
```

## 五、事件/消息类型常量 — 429 个

### 5.1 ACP 事件 (11 个)

```
ACP_ENABLED, ACP_MESSAGE_QUEUED, ACP_MESSAGE_SENT,
ACP_SESSION_LOAD_REQUESTED, ACP_SESSION_NEW_REQUESTED,
ACP_SESSION_PROMPT_SEND_FAILED, ACP_SESSION_PROMPT_SENT,
ACP_SESSION_SWITCH, ACP_SIDEBAR_ARCHIVE_CLICK, ACP_SIDEBAR_SESSION_CLICK
```

### 5.2 Arena 事件 (9 个)

```
ARENA, ARENA_INVOCATION_CAP, ARENA_MODE_INSUFFICIENT_MODELS,
ARENA_MODE_TOGGLED, ARENA_PROCEED_BUTTON_PRESSED,
ARENA_TIER_FAST, ARENA_TIER_SMART, ARENA_TIER_UNSPECIFIED,
ARENA_TRAJECTORY_CONVERGE
```

### 5.3 Brain 事件 (12 个)

```
BRAIN, BRAIN_ENTRY_TYPE_PLAN, BRAIN_ENTRY_TYPE_TASK,
BRAIN_ENTRY_TYPE_UNSPECIFIED, BRAIN_FILTER_STRATEGY_NO_MEMORIES,
BRAIN_FILTER_STRATEGY_NO_SYSTEM_INJECTED_STEPS,
BRAIN_FILTER_STRATEGY_UNSPECIFIED, BRAIN_UPDATE,
BRAIN_UPDATE_TRIGGER_RESEARCH_NEW_INFO, BRAIN_UPDATE_TRIGGER_SYSTEM_FORCED,
BRAIN_UPDATE_TRIGGER_USER_NEW_INFO, BRAIN_UPDATE_TRIGGER_USER_REQUESTED
```

### 5.4 Cascade 核心事件 (~100 个, 摘要)

#### 运行状态

```
CASCADE_RUN_STATUS_BUSY, CASCADE_RUN_STATUS_CANCELING,
CASCADE_RUN_STATUS_IDLE, CASCADE_RUN_STATUS_RUNNING
```

#### 模型/配置

```
CASCADE_BASE_MODEL_ID, CASCADE_DEFAULT_MODEL_OVERRIDE,
CASCADE_GLOBAL_CONFIG_OVERRIDE, CASCADE_PLAN_BASED_CONFIG_OVERRIDE,
CASCADE_BACKGROUND_RESEARCH_CONFIG_OVERRIDE, CASCADE_MEMORY_CONFIG_OVERRIDE,
CASCADE_VIEW_FILE_TOOL_CONFIG_OVERRIDE
```

#### 命令自动执行

```
CASCADE_COMMANDS_AUTO_EXECUTION_AUTO, _DISABLED, _EAGER, _OFF
CASCADE_WEB_REQUESTS_AUTO_EXECUTION_ALLOWLIST, _DISABLED, _TURBO
```

#### NUX (New User Experience) 事件

```
CASCADE_NUX_EVENT_ANTHROPIC_API_PRICING
CASCADE_NUX_EVENT_BACKGROUND_CASCADE
CASCADE_NUX_EVENT_DIFF_OVERVIEW
CASCADE_NUX_EVENT_MODEL_SELECTOR_NUX
CASCADE_NUX_EVENT_NEW_MODELS_WAVE2
CASCADE_NUX_EVENT_OPEN_BROWSER_URL
CASCADE_NUX_EVENT_PLAN_MODE
CASCADE_NUX_EVENT_REVERT_STEP
CASCADE_NUX_EVENT_RULES
CASCADE_NUX_EVENT_TOOL_CALL
CASCADE_NUX_EVENT_TOOL_CALL_PRICING_NUX
CASCADE_NUX_EVENT_WEB_MENTION
CASCADE_NUX_EVENT_WEB_SEARCH
CASCADE_NUX_EVENT_WRITE_CHAT_MODE
```

#### 功能开关

```
CASCADE_ENABLE_AUTOMATED_MEMORIES
CASCADE_ENABLE_MCP_PROMPTS
CASCADE_ENABLE_MCP_TOOLS
CASCADE_ENABLE_PROXY_WEB_SERVER
CASCADE_ENFORCE_QUOTA
CASCADE_SKILLS_ENABLED
CASCADE_WEB_APP_DEPLOYMENTS_ENABLED
CASCADE_WINDSURF_BROWSER_TOOLS_ENABLED
CASCADE_USE_EXPERIMENT_CHECKPOINTER
CASCADE_USE_REPLACE_CONTENT_EDIT_TOOL
```

#### Seat 类型

```
CASCADE_SEAT_TYPE_ENTRY, CASCADE_SEAT_TYPE_STANDARD
```

### 5.5 CortexStep 类型完整枚举 (85 个)

```
CORTEX_STEP_TYPE_ADD_ANNOTATION        CORTEX_STEP_TYPE_ARENA_TRAJECTORY_CONVERGE
CORTEX_STEP_TYPE_ARTIFACT_SUMMARY      CORTEX_STEP_TYPE_ASK_USER_QUESTION
CORTEX_STEP_TYPE_AUTO_CASCADE_BROADCAST CORTEX_STEP_TYPE_BLOCKING
CORTEX_STEP_TYPE_BRAIN_UPDATE          CORTEX_STEP_TYPE_CHECKPOINT
CORTEX_STEP_TYPE_CHECK_DEPLOY_STATUS   CORTEX_STEP_TYPE_CLIPBOARD
CORTEX_STEP_TYPE_CLUSTER_QUERY         CORTEX_STEP_TYPE_CODE_ACTION
CORTEX_STEP_TYPE_COMMAND_STATUS        CORTEX_STEP_TYPE_COMPILE
CORTEX_STEP_TYPE_CREATE_RECIPE         CORTEX_STEP_TYPE_CUSTOM_TOOL
CORTEX_STEP_TYPE_DEPLOY_WEB_APP        CORTEX_STEP_TYPE_DO_TESTING
CORTEX_STEP_TYPE_DUMMY                 CORTEX_STEP_TYPE_EDIT_NOTEBOOK
CORTEX_STEP_TYPE_ERROR_MESSAGE         CORTEX_STEP_TYPE_EXIT_PLAN_MODE
CORTEX_STEP_TYPE_EXPLORE_RESPONSE      CORTEX_STEP_TYPE_FILE_BREAKDOWN
CORTEX_STEP_TYPE_FIND                  CORTEX_STEP_TYPE_FIND_ALL_REFERENCES
CORTEX_STEP_TYPE_FIND_CODE_CONTEXT     CORTEX_STEP_TYPE_FINISH
CORTEX_STEP_TYPE_GET_DOM_TREE          CORTEX_STEP_TYPE_GIT_COMMIT
CORTEX_STEP_TYPE_GREP_SEARCH           CORTEX_STEP_TYPE_GREP_SEARCH_V2
CORTEX_STEP_TYPE_INFORM                CORTEX_STEP_TYPE_INSPECT_CLUSTER
CORTEX_STEP_TYPE_LINT_DIFF             CORTEX_STEP_TYPE_LINT_FIX_MESSAGE
CORTEX_STEP_TYPE_LIST_CLUSTERS         CORTEX_STEP_TYPE_LIST_DIRECTORY
CORTEX_STEP_TYPE_LIST_RESOURCES        CORTEX_STEP_TYPE_LOOKUP_KNOWLEDGE_BASE
CORTEX_STEP_TYPE_MANAGER_FEEDBACK      CORTEX_STEP_TYPE_MCP_TOOL
CORTEX_STEP_TYPE_MEMORY                CORTEX_STEP_TYPE_MQUERY
CORTEX_STEP_TYPE_PLANNER_RESPONSE      CORTEX_STEP_TYPE_PLAN_INPUT
CORTEX_STEP_TYPE_POST_PR_REVIEW        CORTEX_STEP_TYPE_PROPOSAL_FEEDBACK
CORTEX_STEP_TYPE_PROPOSE_CODE          CORTEX_STEP_TYPE_PROXY_WEB_SERVER
CORTEX_STEP_TYPE_READ_DEPLOYMENT_CONFIG CORTEX_STEP_TYPE_READ_KNOWLEDGE_BASE_ITEM
CORTEX_STEP_TYPE_READ_NOTEBOOK         CORTEX_STEP_TYPE_READ_RESOURCE
CORTEX_STEP_TYPE_READ_TERMINAL         CORTEX_STEP_TYPE_READ_URL_CONTENT
CORTEX_STEP_TYPE_RELATED_FILES         CORTEX_STEP_TYPE_REPORT_BUGS
CORTEX_STEP_TYPE_RESOLVE_TASK          CORTEX_STEP_TYPE_RETRIEVE_MEMORY
CORTEX_STEP_TYPE_RUN_COMMAND           CORTEX_STEP_TYPE_RUN_EXTENSION_CODE
CORTEX_STEP_TYPE_SEARCH_KNOWLEDGE_BASE CORTEX_STEP_TYPE_SEARCH_WEB
CORTEX_STEP_TYPE_SKILL                 CORTEX_STEP_TYPE_SMART_FRIEND
CORTEX_STEP_TYPE_SUGGESTED_RESPONSES   CORTEX_STEP_TYPE_SUGGEST_CODEMAP
CORTEX_STEP_TYPE_SUPERCOMPLETE_ACTIVE_DOC
CORTEX_STEP_TYPE_SUPERCOMPLETE_EPHEMERAL_FEEDBACK
CORTEX_STEP_TYPE_SUPERCOMPLETE_FEEDBACK
CORTEX_STEP_TYPE_TASK_SUBAGENT         CORTEX_STEP_TYPE_TODO_LIST
CORTEX_STEP_TYPE_TOOL_CALL_CHOICE      CORTEX_STEP_TYPE_TOOL_CALL_PROPOSAL
CORTEX_STEP_TYPE_TRAJECTORY_CHOICE     CORTEX_STEP_TYPE_TRAJECTORY_SEARCH
CORTEX_STEP_TYPE_UPSERT_CODEMAP        CORTEX_STEP_TYPE_USER_INPUT
CORTEX_STEP_TYPE_VIEW_CODE_ITEM        CORTEX_STEP_TYPE_VIEW_CONTENT_CHUNK
CORTEX_STEP_TYPE_VIEW_FILE             CORTEX_STEP_TYPE_VIEW_FILE_OUTLINE
CORTEX_STEP_TYPE_WRITE_TO_FILE
```

> **新增**: `DO_TESTING`, `GET_DOM_TREE`, `SMART_FRIEND`, `ARTIFACT_SUMMARY`, `TOOL_CALL_CHOICE`, `TOOL_CALL_PROPOSAL`, `TRAJECTORY_CHOICE`, `TRAJECTORY_SEARCH`, `CLIPBOARD`, `CREATE_RECIPE`, `CUSTOM_TOOL`, `EXPLORE_RESPONSE`, `FILE_BREAKDOWN`, `MANAGER_FEEDBACK`, `PROPOSE_CODE`, `PROPOSAL_FEEDBACK`, `READ_RESOURCE`, `LIST_RESOURCES` 等

### 5.6 Trajectory 类型 (19 个 — 更新)

```
CASCADE, BRAIN_UPDATE, ARENA, SUPERCOMPLETE, AUTO_CASCADE,
AUTO_CASCADE_MANAGER, BACKGROUND_RESEARCH, CHECKPOINT,
CUSTOM_TOOL, INTERACTIVE_CASCADE, LLM_JUDGE, PASSIVE_CODER,
RETRIEVE_MEMORY, TOOL_CALL_PROPOSAL, TRAJECTORY_CHOICE,
APPLIER, ARTIFACT_SUMMARY, USER_GRANULAR, USER_MAINLINE
```

### 5.7 Hook Agent Actions (13 个)

```
PRE_READ_CODE, POST_READ_CODE,
PRE_WRITE_CODE, POST_WRITE_CODE,
PRE_MCP_TOOL_USE, POST_MCP_TOOL_USE,
PRE_RUN_COMMAND, POST_RUN_COMMAND,
PRE_USER_PROMPT,
POST_CASCADE_RESPONSE, POST_CASCADE_RESPONSE_WITH_TRANSCRIPT,
POST_SETUP_WORKTREE   // 新! Worktree 设置后钩子
```

### 5.8 Tool Formatter 类型 (8 个)

```
TOOL_FORMATTER_TYPE_CHAT_TRANSCRIPT    // 聊天记录格式
TOOL_FORMATTER_TYPE_HERMES             // Hermes 格式
TOOL_FORMATTER_TYPE_KIMI               // Kimi 格式
TOOL_FORMATTER_TYPE_LLAMA_3            // LLaMA 3 格式
TOOL_FORMATTER_TYPE_QWENCODER          // QwenCoder 格式
TOOL_FORMATTER_TYPE_SUPERCOMPLETE      // SuperComplete 格式
TOOL_FORMATTER_TYPE_XML                // XML 格式
```

> 重要发现: 多种 Tool Formatter 表明 LS 对不同模型使用不同的工具调用序列化格式。

### 5.9 Memory / Skill / Rule 枚举

```
MEMORY_ACTION_TYPE_CREATE, _DELETE, _UPDATE
CORTEX_MEMORY_SOURCE_AUTO_CASCADE, _CASCADE, _USER
CORTEX_MEMORY_TRIGGER_ALWAYS_ON, _GLOB, _MANUAL, _MODEL_DECISION
SKILL_SOURCE_GLOBAL, _SYSTEM, _WORKSPACE
RULE_SOURCE_SYSTEM, _WORKSPACE
```

## 六、URL 完整清单 (72 个)

### 6.1 核心 Windsurf URL

| URL | 用途 |
|-----|------|
| `https://status.windsurf.com/` | **Windsurf 状态页** (新!) |
| `https://windsurf.com/deploy` | 部署页面 |
| `https://windsurf.com/leaderboard` | **排行榜** (新!) |
| `https://windsurf.com/pricing` | 定价页 |
| `https://windsurf.com/support` | 支持页 |
| `https://windsurf.com/redirect/windsurf/add-credits` | 添加额度 |
| `https://windsurf.com/redirect/windsurf/update-payment` | 更新支付 |
| `https://windsurf.com/redirect/windsurf/upgrade` | 升级 |
| `https://windsurf.com/subscription/auto-refill?referrer=windsurf` | 自动充值 |
| `https://windsurf.com/subscription/usage?referrer=windsurf` | 用量查看 |
| `https://docs.windsurf.com` | 文档首页 |
| `https://docs.windsurf.com/windsurf/cascade/app-deploys` | 应用部署文档 |
| `https://docs.windsurf.com/windsurf/cascade/mcp` | MCP 文档 |
| `https://docs.windsurf.com/windsurf/cascade/memories` | 记忆文档 |
| `https://docs.windsurf.com/windsurf/cascade/workflows` | 工作流文档 |
| `https://docs.windsurf.com/windsurf/models` | 模型文档 |
| `https://docs.windsurf.com/windsurf/spaces` | Spaces 文档 |

### 6.2 Codeium / 基础设施 URL

| URL | 用途 |
|-----|------|
| `https://codeium.com/acceptable-use-policy` | 使用策略 |
| `https://codeium.com/profile?referrer=extension` | 用户资料 |
| `https://codeium.com/redirect/windsurf/cascade-model-header-warning` | 模型警告 |
| `https://codeium.com/terms-of-service-individual` | 服务条款 |
| `https://unleash.codeium.com/api/frontend/` | Unleash Feature Flags API |
| `https://agentskills.io/home` | **Agent Skills 平台** (新!) |

### 6.3 Sentry 错误跟踪

```
https://564eba057587639c8a92b81cfa4b3f12@o4507463137361920.ingest.us.sentry.io/4507737596690432
```

> DSN 解码:
> - **Organization ID**: `o4507463137361920`
> - **Project ID**: `4507737596690432`
> - **Public Key**: `564eba057587639c8a92b81cfa4b3f12`
> - **Region**: US (ingest.us.sentry.io)

### 6.4 第三方 CDN / 资源

| URL | 用途 |
|-----|------|
| `https://cdn.jsdelivr.net/npm/simple-icons@v13/icons` | Simple Icons CDN |
| `https://www.netlify.com/pdf/self-serve-subscription-agreement.pdf/` | Netlify 协议 |
| `https://base-ui.com/production-error` | Base UI 错误页 |
| `https://exafunction.github.io/public/images/ides/...` | IDE 图标 (18+ 个) |

## 七、HTTP Headers 完整清单 (138 个 — 关键项)

### 7.1 认证 Headers

| Header | 用途 |
|--------|------|
| `Authorization` / `authorization` | 标准认证 |
| `X-Api-Key` | API 密钥 |
| `X-Auth-Token` | 认证令牌 |
| `X-Devin-Auth1-Token` | **Devin Auth1 令牌** |
| `X-Devin-Session-Token` | **Devin 会话令牌** |
| `X-Devin-Account-Id` | **Devin 账号 ID** |
| `X-Devin-Primary-Org-Id` | **Devin 主组织 ID** |
| `x-codeium-csrf-token` | CSRF 令牌 |
| `authorization_code` | 授权码 |

### 7.2 调试 Headers

| Header | 用途 |
|--------|------|
| `X-Debug-Email` | 调试用 Email |
| `X-Debug-Team-Name` | 调试用团队名 |
| `X-Grpc-Web` | gRPC-Web 标记 |
| `X-User-Agent` | 用户代理覆盖 |

### 7.3 Devin 内部变量

```
devin_account_id, devin_api_url, devin_auth1_token,
devin_cloud_acp_enabled, devin_exited, devin_info,
devin_knowledge, devin_message, devin_playbooks,
devin_primary_org_id, devin_review_enabled,
devin_session_create, devin_session_token, devin_suspended,
devin_terminal_acp_enabled, devin_usage_entries,
devin_user_id, devin_version, devin_webapp_host
```

### 7.4 Windsurf 部署变量

```
windsurf_deployment_id, windsurf_deployments,
windsurf_pro_trial_end_time, windsurf_project_id,
windsurf_projects, windsurf_setting
```

### 7.5 Devin Plan 类型

```
DEVIN_CLOUD_SESSION_OPENED
DEVIN_ENTERPRISE, DEVIN_FREE, DEVIN_MAX,
DEVIN_PRO, DEVIN_TEAMS, DEVIN_TEAMS_V2, DEVIN_TRIAL
```

## 八、流式传输模式 (33 个)

```
streamCascadePanelReactiveUpdates     → Cascade 面板实时更新
streamCascadeReactiveUpdates          → Cascade 对话实时更新
streamCascadeSummariesReactiveUpdates → Cascade 摘要实时更新
streamUserTrajectoryReactiveUpdates   → 用户轨迹实时更新
streamAutocompleteText                → 自动补全文本流
streamReactiveUpdates                 → 通用响应式更新流
ServerStream / ClientStream           → gRPC 流类型
StreamingRequest / StreamingResponse  → 通用流式请求/响应
```

---

# 92. @exa/windsurf-acp 深度逆向 — ACP 连接器完整实现

> 来源: `node_modules/@exa/windsurf-acp/index.js` (728 KB, 20557 行)

## 一、包概况

| 指标 | 值 |
|------|-----|
| **包名** | `@exa/windsurf-acp` |
| **大小** | 728 KB (20,557 行, 可读!) |
| **版本** | `0.0.0` (内部包) |
| **用途** | Windsurf ACP 协议连接器实现 |

## 二、核心导出类

| 类/函数 | 用途 |
|---------|------|
| `WindsurfAcpConnection` | ACP 连接管理 |
| `AcpConnectionClosedError` | 连接关闭错误 |
| `AcpRegistrySchema` | ACP 注册表 Schema |
| `AcpRegistryAgentSchema` | ACP Agent Schema |
| `AugmentFactory` | 增强工厂 |
| `DEVIN_CLOUD_PROVIDER_ID` | Devin Cloud 提供者标识 |
| `notificationHandler` | 通知处理器 |
| `requestHandler` | 请求处理器 |

## 三、ACP Capability 模式 — 97 个 `cognition.ai/*` 键

### 3.1 会话管理

```
cognition.ai/session, cognition.ai/session-id,
cognition.ai/sessionArchiving, cognition.ai/sessionLifecycle,
cognition.ai/sessionListContentSearch, cognition.ai/sessionListCreatedAfter,
cognition.ai/sessionListRefetch, cognition.ai/sessionListUpdatedAfter,
cognition.ai/sessionPRs, cognition.ai/sessionRename,
cognition.ai/sessionRepos, cognition.ai/sessionUnreadTracking,
cognition.ai/sortUpdatedAt
```

### 3.2 Agent 行为

```
cognition.ai/action, cognition.ai/actions,
cognition.ai/activityEnum, cognition.ai/statusEnum,
cognition.ai/statusMessage, cognition.ai/statusReason,
cognition.ai/agent_stopped, cognition.ai/isTyping,
cognition.ai/isExitPlan, cognition.ai/isOptimistic,
cognition.ai/sender, cognition.ai/summary
```

### 3.3 Subagent 系统

```
cognition.ai/subagent_started,
cognition.ai/subagent_completed,
cognition.ai/subagent_context
```

### 3.4 工具调用

```
cognition.ai/toolName, cognition.ai/toolArgs,
cognition.ai/inferenceToolName,
cognition.ai/inputKey, cognition.ai/outputKey,
cognition.ai/inputTokens, cognition.ai/outputTokens,
cognition.ai/cachedReadTokens, cognition.ai/cachedWriteTokens
```

### 3.5 文件/代码操作

```
cognition.ai/contentsKey, cognition.ai/newStringContentsKey,
cognition.ai/oldStringContentsKey, cognition.ai/endLine,
cognition.ai/overwrite, cognition.ai/listDirectory,
cognition.ai/revert
```

### 3.6 MCP / 权限

```
cognition.ai/mcp,
cognition.ai/canManageMcpServers,
cognition.ai/canManageOrgSecrets,
cognition.ai/permissionType, cognition.ai/approved,
cognition.ai/secretName, cognition.ai/secretNames,
cognition.ai/secretSend, cognition.ai/secretType,
cognition.ai/envVarName, cognition.ai/encryptedValue
```

### 3.7 PR / Git 操作

```
cognition.ai/prManagement, cognition.ai/prTitle,
cognition.ai/prDescription, cognition.ai/pullNumber,
cognition.ai/repo, cognition.ai/repoName,
cognition.ai/branchName, cognition.ai/htmlUrl,
cognition.ai/worktreeFor
```

### 3.8 注册表元数据

```
cognition.ai/featured, cognition.ai/bundled,
cognition.ai/hidden, cognition.ai/hiddenResource,
cognition.ai/icon, cognition.ai/promoLabel, cognition.ai/promoTooltip,
cognition.ai/botUsername
```

### 3.9 媒体/上传

```
cognition.ai/httpUpload, cognition.ai/httpUploadMaxBytes,
cognition.ai/httpUploadUrl, cognition.ai/pre-uploaded,
cognition.ai/screenshotKeys, cognition.ai/videoPath,
cognition.ai/cleanVideoUrl, cognition.ai/recordingId,
cognition.ai/annotationsAttachmentUuid, cognition.ai/attachment-id
```

### 3.10 消息/流式

```
cognition.ai/clientMessageId, cognition.ai/streamingMessageId,
cognition.ai/messageSubIndex, cognition.ai/content,
cognition.ai/partialContent, cognition.ai/thinkingDurationMs,
cognition.ai/timestamp, cognition.ai/title
```

### 3.11 chat-client 独有 ACP 键 (额外 54 个)

chat-client 中额外发现的 ACP 键 (不在 windsurf-acp 中):

```
cognition.ai/acuUsed                    // ACU 使用量
cognition.ai/additionalWorkspaceDirs    // 额外工作区目录
cognition.ai/after                      // 后续
cognition.ai/allowOther                 // 允许其他
cognition.ai/blueprintId                // 蓝图 ID
cognition.ai/command                    // 命令
cognition.ai/compaction                 // 压缩
cognition.ai/createdAfter               // 创建后
cognition.ai/createdAt                  // 创建时间
cognition.ai/creatorUserId              // 创建者 ID
cognition.ai/declarativeSetupEligible   // 声明式设置
cognition.ai/error, cognition.ai/errorKind
cognition.ai/eventId, cognition.ai/eventType
cognition.ai/filterName
cognition.ai/hasNext                    // 分页
cognition.ai/impact                     // 影响度
cognition.ai/initialRepos               // 初始仓库
cognition.ai/initiatorLinks             // 发起者链接
cognition.ai/isPlanImplementationRequest
cognition.ai/isUnread                   // 未读状态
cognition.ai/manageIntegrationsUrl
cognition.ai/manageOrgsUrl
cognition.ai/maxEmbeddedResourceBytes
cognition.ai/multiRootWorkspace
cognition.ai/noAccessibleOrgs
cognition.ai/note
cognition.ai/openable
cognition.ai/original-mention-data
cognition.ai/original-mention-trigger
cognition.ai/otherOptionValue
cognition.ai/pageSize
cognition.ai/playbookLink               // Playbook 链接
cognition.ai/proposedByDevinId
cognition.ai/questions                  // 问题列表
cognition.ai/queuePosition              // 队列位置
cognition.ai/reason
cognition.ai/requestId, cognition.ai/requestingTabId
cognition.ai/retryAfterSeconds
cognition.ai/saveScope
cognition.ai/scope-item-type
cognition.ai/sessionIds, cognition.ai/sessionOrigin
cognition.ai/shouldSave
cognition.ai/showContentWithExternalLinks
cognition.ai/sink
cognition.ai/skillFiles                 // 技能文件
cognition.ai/tags, cognition.ai/target
cognition.ai/updatedAfter
cognition.ai/url, cognition.ai/userMessageCount
```

---

# 93. 新发现 Proto Services 与子系统

## 一、OpenSearch Knowledge Base Service (20 RPC + 4 Search RPC)

> 来源: `exa.opensearch_clients_pb`

### 1.1 服务定义

```protobuf
service KnowledgeBaseService {
  rpc KnowledgeBaseSearch             // 知识库搜索 (Hybrid/KNN/Keyword)
  rpc GetKnowledgeBaseScopeItems      // 获取知识库范围项
  rpc GetKnowledgeBaseItemsFromScopeItems
  rpc IngestSlackData                 // 导入 Slack 数据
  rpc IngestGithubData                // 导入 GitHub 数据
  rpc IngestGoogleDriveData           // 导入 Google Drive 数据
  rpc IngestJiraData                  // 导入 Jira 数据
  rpc IngestJiraPayload               // Jira Webhook 载荷
  rpc ForwardSlackPayload             // 转发 Slack 载荷
  rpc IngestSlackPayload              // Slack 事件载荷
  rpc ConnectKnowledgeBaseAccount     // 连接知识库账号 (OAuth)
  rpc DeleteKnowledgeBaseConnection   // 删除连接
  rpc UpdateConnectorConfig           // 更新连接器配置
  rpc CancelKnowledgeBaseJobs         // 取消导入任务
  rpc GetKnowledgeBaseConnectorState  // 获取连接器状态
  rpc GetKnowledgeBaseJobStates       // 获取任务状态
  rpc AddUsers                        // 添加用户
  rpc AddGithubUsers                  // 添加 GitHub 用户
  rpc GetKnowledgeBaseWebhookUrl      // 获取 Webhook URL
  rpc GetConnectorInternalConfig      // 获取内部配置
}

service CodeIndexService {
  rpc OpenSearchAddRepository         // 添加代码仓库索引
  rpc OpenSearchGetIndex              // 获取索引状态
  rpc HybridSearch                    // 混合搜索 (关键词+向量)
  rpc GraphSearch                     // 图搜索
}
```

### 1.2 连接器类型 (7 种)

```
CONNECTOR_TYPE_GITHUB          // GitHub (App 安装)
CONNECTOR_TYPE_SLACK           // Slack (Webhook + OAuth)
CONNECTOR_TYPE_GOOGLE_DRIVE    // Google Drive (文件夹 ID)
CONNECTOR_TYPE_JIRA            // Jira (Webhook)
CONNECTOR_TYPE_CODEIUM         // Codeium 内部
CONNECTOR_TYPE_EMAIL           // Email
CONNECTOR_TYPE_GITHUB_OAUTH    // GitHub OAuth
```

### 1.3 搜索模式 (4 种)

```
SEARCH_MODE_HYBRID             // 混合搜索 (默认)
SEARCH_MODE_KEYWORD            // 关键词搜索
SEARCH_MODE_APPROXIMATE_KNN    // 近似 KNN
SEARCH_MODE_BRUTE_FORCE_KNN    // 暴力 KNN
```

### 1.4 任务状态 (7 种)

```
JOB_STATUS_QUEUED → RUNNING → COMPLETED
                  → CANCELLED / CANCELLING
                  → ERRORED / RETRYABLE
```

### 1.5 Slack 深度集成

```protobuf
message SlackMessagePayload {
  string dataset_id, type, channel_id, user, text,
         timestamp, thread_timestamp, channel_name,
         team_name, team_id, team_domain;
  bool is_private_channel;
}
message SlackChannelPayload { ... }
```

### 1.6 搜索请求结构

```protobuf
message KnowledgeBaseSearchRequest {
  repeated string queries;               // 多查询
  repeated chat_pb.ChatMessagePrompt;    // 聊天上下文
  TimeRange time_range;                  // 时间范围
  repeated DocumentType document_types;  // 文档类型过滤
  SearchMode search_mode;                // 搜索模式
  bool disable_reranking;                // 禁用重排序
  bool disable_contextual_lookup;        // 禁用上下文查找
}
```

## 二、UserAnalytics Service (7 RPC)

> 来源: `exa.user_analytics_pb`

### 2.1 服务定义

```protobuf
service UserAnalyticsService {
  rpc Analytics                // 通用分析查询
  rpc UserPageAnalytics        // 用户页面分析
  rpc CascadeAnalytics         // Cascade 专项分析
  rpc GetAnalytics             // 获取分析 (32种查询类型)
  rpc GetGlobalLeaderboardApiKey // 全球排行榜 API Key
  rpc GetBigQueryAnalytics     // BigQuery 分析
  rpc GetDevinUserAnalytics    // Devin 用户分析 (ACU 统计)
}
```

### 2.2 数据源 (7 种)

```
QUERY_DATA_SOURCE_USER_DATA              // 用户数据
QUERY_DATA_SOURCE_CHAT_DATA              // 聊天数据
QUERY_DATA_SOURCE_COMMAND_DATA           // 命令数据
QUERY_DATA_SOURCE_CASCADE_DATA           // Cascade 数据
QUERY_DATA_SOURCE_PCW_DATA               // Percent Code Written
QUERY_DATA_SOURCE_CASCADE_LINES_ANALYTICS // Cascade 行分析
QUERY_DATA_SOURCE_CASCADE_TOOL_ANALYTICS  // Cascade 工具分析
```

### 2.3 查询类型 (32 种)

| 类别 | 查询 |
|------|------|
| **Completion** | CompletionStats, ByDay, ByLanguage, ByIde, ByApiKey, ByRepository, ByLanguagePerUser |
| **Chat** | ChatsByDay, ChatStatsByModel, ChatStats |
| **Cascade** | CascadeLines, CascadeRuns, CascadeToolUsage |
| **用户** | ActiveUserCount, ActiveDaysByApiKey, DailyActiveUserCounts |
| **代码** | PercentCodeWritten, IndividualPercentCodeWritten, CharsPerOpportunity |
| **命令** | CommandStats |
| **自定义** | CustomQuery, UserPageAnalytics |

### 2.4 排行榜系统

```protobuf
message ModelStats {
  string model;
  int64 elo_rating;          // ELO 评分!
  int64 votes;               // 投票数
  double win_rate;            // 胜率
  int64 confidence_lower;    // 置信下限
  int64 confidence_upper;    // 置信上限
  double model_speed;        // 模型速度
  string model_group;        // 模型组
}
```

> **关键发现**: Windsurf 运行 ELO 评分系统对模型进行排名，这解释了 `windsurf.com/leaderboard` 页面的数据来源。

### 2.5 代码贡献分析

```protobuf
message QueryResultPercentCodeWritten {
  double percent_code_written;
  int64 codeium_bytes_by_autocomplete;
  int64 codeium_bytes_by_command;
  int64 codeium_bytes_by_supercomplete;
  int64 codeium_bytes_by_cascade;
  int64 user_bytes;
  int64 codeium_bytes;
  int64 total_bytes;
}
```

### 2.6 Devin ACU 统计

```protobuf
message GetDevinUserAnalyticsResponse {
  repeated DevinUsageEntry devin_usage_entries;
  double total_acus;     // 总 ACU 消耗
}
message DevinUsageEntry {
  string day;
  double acus;            // 每日 ACU
}
```

## 三、ProductAnalytics Service (2 RPC)

> 来源: `exa.product_analytics_pb`

```protobuf
service ProductAnalyticsService {
  rpc RecordAnalyticsEvent         // 记录单个事件
  rpc BatchRecordAnalyticsEvents   // 批量记录
}
```

### 事件结构

```protobuf
message RecordAnalyticsEventRequest {
  string event_name;               // 事件名称
  string api_key;                  // API Key
  string installation_id;          // 安装 ID
  string ide_name;                 // IDE 名称 ("windsurf")
  string os;                       // 操作系统
  string codeium_version;          // Codeium 版本
  string ide_version;              // IDE 版本
  uint64 duration_ms;              // 持续时间
  map<string, string> extra;       // 额外数据
  map<string, bool> experiments;   // 实验开关
  string plan_tier;                // 计划层级
  string device_fingerprint;       // 设备指纹
  string ide_type;                 // IDE 类型
}
```

## 四、Auto Cascade 系统

> 来源: `exa.auto_cascade_common_pb`

### 4.1 GitHub PR 集成

```protobuf
message GithubPullRequestInfo {
  string url, owner, repo, title, number;
  GithubCICheckStatus ci_status;
  GithubPullRequestBranchStatus branch_status;
}
```

### 4.2 分支状态 (5 种)

```
NO_PR → PR_OPEN → PR_CLOSED / PR_MERGED / HAS_SUGGESTION
```

### 4.3 评论类型 (4 种)

```
MANUAL_REVIEW_TRIGGER    // 手动触发审查
LGTM                     // 通过
REVIEW_BODY              // 审查正文
REVIEW_COMMENT           // 审查评论
```

### 4.4 Auto Cascade Session

```protobuf
message SessionInfo {
  string session_id, explanation, ssh_url, summary, session_key;
  CascadeRunStatus status;
  CortexTrajectory trajectory;
  repeated GitRepoInfo git_repos;
  Timestamp created_at, updated_at;
}
```

## 五、Bug Checker 系统

> 来源: `exa.bug_checker_pb`

```protobuf
message Bug {
  string id, file, title, description, severity, resolution;
  int32 start, end;                // 代码范围
  double confidence;               // 置信度
  repeated string categories;     // 分类
  Fix fix;                         // 自动修复
}

message Fix {
  string old_str;                  // 原始文本
  string new_str;                  // 修复文本
}
```

> 这是 **Lifeguard** 功能的底层数据结构，提供带有置信度和自动修复建议的 bug 检测。

## 六、Context Module 系统

> 来源: `exa.context_module_pb`

### 6.1 上下文变化事件 (8 种)

```
ACTIVE_DOCUMENT      → 活跃文档变化
CURSOR_POSITION      → 光标位置变化
CHAT_MESSAGE_RECEIVED → 聊天消息接收
OPEN_DOCUMENTS       → 打开文档变化
ORACLE_ITEMS         → Oracle 项变化
PINNED_CONTEXT       → 固定上下文变化
PINNED_GUIDELINE     → 固定指南变化
ACTIVE_NODE          → 活跃节点变化 (AST)
```

### 6.2 上下文使用场景 (9 种)

```
AUTOCOMPLETE          → 自动补全
CHAT                  → 聊天
CHAT_COMPLETION       → 聊天补全
CORTEX_RESEARCH       → Cortex 研究
EVAL                  → 评估
CHAT_COMPLETION_GENERATE → 聊天生成
SUPERCOMPLETE         → SuperComplete
FAST_APPLY            → 快速应用
COMMAND_TERMINAL      → 命令终端
```

### 6.3 代码上下文检索

```protobuf
message ContextModuleResult {
  repeated CciWithSubrangeWithRetrievalMetadata retrieved_ccis;
  Document active_document;
  DocumentOutline active_document_outline;
  LocalNodeState local_node_state;    // AST 节点状态
  Guideline guideline;
  repeated Document open_documents;
}

message LocalNodeState {
  CodeContextItem current_node;
  CodeContextItem closest_above_node;  // 最近上方节点
  CodeContextItem closest_below_node;  // 最近下方节点
}
```

---

# 94. 更新逆向总结 — Round 2

## 一、新增统计

| 指标 | Ch.90 值 | 更新后 |
|------|---------|--------|
| **总章节** | 90 | **94** |
| **Proto Services** | 14 | **18** (+ProductAnalytics, KnowledgeBaseService, CodeIndexService, UserAnalytics) |
| **RPC 方法总数** | 512 | **~545** (+KnowledgeBaseService 20 + CodeIndexService 4 + ProductAnalytics 2 + UserAnalytics 7) |
| **CortexStep 类型** | 93 | **85 个确认枚举值** (精确计数) |
| **事件常量** | - | **429 个** (首次精确计数) |
| **ACP Capability** | ~8 | **151 个** (从 @exa 包提取) |
| **HTTP Headers** | ~10 | **138 个** (含认证/调试/Devin 变量) |
| **URLs** | 59 | **72+** |
| **Proto 类型** | - | **1943 个** (完整 Service Paths) |

## 二、新发现的关键子系统

### 2.1 Knowledge Base 企业搜索引擎

- **4 种搜索模式**: Hybrid, Keyword, Approximate KNN, Brute Force KNN
- **7 种连接器**: GitHub, Slack, Google Drive, Jira, Codeium, Email, GitHub OAuth
- **Webhook 集成**: Slack 实时消息/频道事件、Jira 事件
- **OpenSearch 后端**: 基于 AWS OpenSearch 的向量+关键词混合搜索
- **Graph Search**: 图搜索能力 (知识图谱?)

### 2.2 用户分析与排行榜

- **32 种查询类型**: 覆盖 Completion、Chat、Cascade、Command 维度
- **BigQuery 集成**: 用于全球排行榜数据
- **ELO 评分系统**: 模型排名 (elo_rating, win_rate, confidence)
- **Percent Code Written**: 精细到 autocomplete/command/supercomplete/cascade 的代码贡献分析
- **Devin ACU 统计**: 每日 ACU 消耗跟踪

### 2.3 Tool Formatter 多模型适配

```
Hermes / LLaMA 3 / Kimi / QwenCoder / XML / ChatTranscript / SuperComplete
```

LS 使用不同的工具调用格式适配不同模型系列，这是支持 115+ 模型的关键基础设施。

### 2.4 Sentry 错误追踪

- Sentry DSN 直接编译在 chat-client 中
- Organization: `o4507463137361920`
- Project: `4507737596690432`
- Region: US

### 2.5 完整 ACP Capability 体系

从 8 个已知 capability 扩展到 **151 个**，涵盖:
- 会话管理 (13 个)
- Agent 行为 (12 个)
- Subagent 系统 (3 个)
- 工具调用 (8 个)
- 文件操作 (7 个)
- MCP/权限 (10 个)
- PR/Git (8 个)
- 注册表 (8 个)
- 媒体/上传 (10 个)
- 消息/流式 (7 个)
- 其他 (65 个)

## 三、更新后的架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Windsurf Next IDE                            │
├──────────────────┬──────────────────┬───────────────────────────────┤
│   Electron Main  │  Workbench (31MB)│   Sessions (30MB)             │
│   (1.1MB)        │  React+Preact    │   Agent Window                │
├──────────────────┴──────────────────┴───────────────────────────────┤
│   @exa/chat-client (14.4MB)          @exa/windsurf-acp (728KB)      │
│   ├─ ReactiveStateStore             ├─ WindsurfAcpConnection        │
│   ├─ EventChannel                   ├─ AcpRegistrySchema            │
│   ├─ 4 Connect-RPC Services         └─ 97 ACP Capabilities         │
│   └─ 1943 Proto Types                                               │
├─────────────────────────────────────────────────────────────────────┤
│             Extension Host (9.6MB extension.js)                      │
│   ├─ LanguageServerService (172 RPC)                                │
│   ├─ ExtensionServerService (50 RPC)                                │
│   └─ Go LS Binary (gRPC)                                           │
├─────────────────────────────────────────────────────────────────────┤
│                     Remote Services                                  │
│   ├─ ApiServerService (171 RPC)     → server.codeium.com           │
│   ├─ SeatManagementService (151)    → register.windsurf.com        │
│   ├─ KnowledgeBaseService (20+4)    → OpenSearch backend           │
│   ├─ UserAnalyticsService (7)       → BigQuery integration         │
│   ├─ ProductAnalyticsService (2)    → Event tracking               │
│   ├─ CascadePluginsService (5)      → MCP registry                 │
│   └─ BrowserPreviewService (3)      → Preview                      │
├─────────────────────────────────────────────────────────────────────┤
│                   External Integrations                              │
│   ├─ Slack (Webhook + OAuth)        ├─ Jira (Webhook)              │
│   ├─ GitHub (App + OAuth)           ├─ Google Drive (OAuth)         │
│   ├─ Sentry (Error tracking)        ├─ Unleash (Feature flags)     │
│   └─ Netlify (Deploy)              └─ You.com (Web search)         │
└─────────────────────────────────────────────────────────────────────┘
```

## 四、新增分析文件清单

| 文件 | 大小 | 状态 |
|------|------|------|
| `@exa/chat-client/index.js` | 14.4 MB | ✅ |
| `@exa/windsurf-acp/index.js` | 728 KB | ✅ |
| `opensearch_clients.proto` | 469 行 | ✅ |
| `user_analytics.proto` | 516 行 | ✅ |
| `auto_cascade_common.proto` | 83 行 | ✅ |
| `product_analytics.proto` | 41 行 | ✅ |
| `bug_checker.proto` | 26 行 | ✅ |
| `context_module.proto` | 168 行 | ✅ |

## 五、完整 Service 索引 (18 个)

| # | Service | 包 | RPC 数 |
|---|---------|-----|--------|
| 1 | LanguageServerService | language_server_pb | 172 |
| 2 | ExtensionServerService | extension_server_pb | 50 |
| 3 | ApiServerService | api_server_pb | 171 |
| 4 | SeatManagementService | seat_management_pb | 151 |
| 5 | CascadePluginsService | cascade_plugins_pb | 5 |
| 6 | KnowledgeBaseService (LS) | knowledge_base_pb | 11 |
| 7 | BrowserPreviewService | browser_preview_pb | 3 |
| 8 | ChatClientServerService | chat_client_server_pb | 1 (streaming) |
| 9 | FileSystemProviderService | filesystem_pb | 3 |
| 10 | ReactiveComponent (streams) | reactive_component_pb | 4 |
| 11 | **KnowledgeBaseService (OS)** | opensearch_clients_pb | **20** |
| 12 | **CodeIndexService** | opensearch_clients_pb | **4** |
| 13 | **UserAnalyticsService** | user_analytics_pb | **7** |
| 14 | **ProductAnalyticsService** | product_analytics_pb | **2** |
| 15 | IndexService | index_pb | ~30 |
| 16 | AnalyticsService | analytics_pb | ~5 |
| 17 | EvalService | eval_pb | ~10 |
| 18 | PromptService | prompt_pb | ~5 |

**总 RPC 方法: ~654**

---

# 95. ACP 协议完整逆向 — Agent Client Protocol 实现细节

## 95.1 ACP SDK 版本与来源

```
Package: @agentclientprotocol/sdk@0.20.0
Bundled inside: @exa/windsurf-acp (728KB, 20557 lines)
Schema validation: zod@3.25.76
Utility lib: lodash-es@4.18.1
Protocol spec: https://agentclientprotocol.com/protocol/overview
```

## 95.2 ACP 协议方法表 — 完整 27 个方法

### Agent Methods (Client → Agent 请求, 17个)

| 方法名 | Wire Name | 类型 | 说明 |
|--------|-----------|------|------|
| initialize | `initialize` | Request | 初始化连接,协商capabilities |
| authenticate | `authenticate` | Request | 认证 |
| logout | `logout` | Request | 登出 (unstable) |
| session_new | `session/new` | Request | 新建会话 |
| session_load | `session/load` | Request | 加载已有会话 |
| session_list | `session/list` | Request | 列出所有会话 |
| session_fork | `session/fork` | Request | 分叉会话 (unstable) |
| session_resume | `session/resume` | Request | 恢复会话 |
| session_close | `session/close` | Request | 关闭会话 |
| session_prompt | `session/prompt` | Request | 发送prompt |
| session_cancel | `session/cancel` | Notification | 取消当前操作 |
| session_set_mode | `session/set_mode` | Request | 设置会话模式 |
| session_set_model | `session/set_model` | Request | 设置模型 (unstable) |
| session_set_config_option | `session/set_config_option` | Request | 设置配置选项 |
| nes_start | `nes/start` | Request | 启动NES (unstable) |
| nes_suggest | `nes/suggest` | Request | NES建议 (unstable) |
| nes_close | `nes/close` | Request | 关闭NES (unstable) |

### Agent Notifications (Client → Agent 通知, 8个)

| 方法名 | Wire Name | 说明 |
|--------|-----------|------|
| session_cancel | `session/cancel` | 取消会话操作 |
| document_did_open | `document/didOpen` | 文档打开 (unstable) |
| document_did_change | `document/didChange` | 文档变更 (unstable) |
| document_did_close | `document/didClose` | 文档关闭 (unstable) |
| document_did_save | `document/didSave` | 文档保存 (unstable) |
| document_did_focus | `document/didFocus` | 文档获焦 (unstable) |
| nes_accept | `nes/accept` | NES接受 (unstable) |
| nes_reject | `nes/reject` | NES拒绝 (unstable) |

### Client Methods (Agent → Client 请求/通知, 11个)

| 方法名 | Wire Name | 类型 | 说明 |
|--------|-----------|------|------|
| session_update | `session/update` | Notification | 会话状态更新 |
| session_request_permission | `session/request_permission` | Request | 请求工具调用权限 |
| fs_read_text_file | `fs/read_text_file` | Request | 读取文本文件 |
| fs_write_text_file | `fs/write_text_file` | Request | 写入文本文件 |
| terminal_create | `terminal/create` | Request | 创建终端 |
| terminal_output | `terminal/output` | Request | 终端输出 |
| terminal_release | `terminal/release` | Request | 释放终端 |
| terminal_wait_for_exit | `terminal/wait_for_exit` | Request | 等待终端退出 |
| terminal_kill | `terminal/kill` | Request | 终止终端 |
| elicitation_create | `elicitation/create` | Request | 创建选择弹窗 (unstable) |
| elicitation_complete | `elicitation/complete` | Notification | 完成选择弹窗 (unstable) |

### 额外的 Windsurf 扩展方法 (3个 providers)

| 方法名 | Wire Name | 说明 |
|--------|-----------|------|
| providers_disable | `providers/disable` | 禁用provider |
| providers_list | `providers/list` | 列出providers |
| providers_set | `providers/set` | 设置provider |

## 95.3 WindsurfAcpConnection 架构

```
WindsurfAcpConnection
├── handler: { onClientRequest(request) → Promise }
├── connection: ClientSideConnection
│   ├── sendRequest(method, params) → Promise
│   ├── sendNotification(method, params)
│   ├── signal: AbortSignal (连接关闭检测)
│   └── closed: Promise (连接关闭等待)
├── createClient() → {
│   ├── sessionUpdate(params)             // notification
│   ├── requestPermission(params)         // request
│   ├── readTextFile(params)              // request
│   ├── writeTextFile(params)             // request
│   ├── createTerminal(params)            // request
│   ├── terminalOutput(params)            // request
│   ├── releaseTerminal(params)           // request
│   ├── waitForTerminalExit(params)       // request
│   ├── killTerminal(params)              // request
│   ├── unstable_createElicitation(params)// request
│   ├── unstable_completeElicitation(params)// notification
│   ├── extMethod(method, params)         // 自定义方法
│   └── extNotification(method, params)   // 自定义通知
│   }
└── sendRequest(request) → Promise
    ├── notification → fire-and-forget
    └── request → Promise.race([rpcPromise, closedPromise])
        └── 连接断开 → AcpConnectionClosedError
```

## 95.4 ACP 传输层 — 双模式

### ndJsonStream (stdio 模式)
```javascript
// 基于 NDJSON (Newline-Delimited JSON) over stdin/stdout
function ndJsonStream(output, input) {
  // ReadableStream: input → TextDecoder → split(\n) → JSON.parse → enqueue
  // WritableStream: JSON.stringify → TextEncoder → output.write
}
```

### webSocketStream (WebSocket 模式)
```javascript
// WebSocket URL: wss://app.devin.ai/api/acp/live
// Credentials via query parameters, NOT headers
function webSocketStream(ws) {
  // ReadableStream: ws.onmessage → JSON.parse → enqueue
  // WritableStream: JSON.stringify → ws.send
  // ws.onclose → controller.close()
  // ws.onerror → controller.error()
  // Close codes: 1000 (normal), 1011 (abort)
}
```

## 95.5 ACP 会话状态机 — 8种 sessionUpdate 类型

```javascript
applySessionEvent(messages, info, update, toolCallIndex, subagentIndex)
// update.sessionUpdate 枚举:
switch (update.sessionUpdate) {
  case "user_message_chunk":     // 用户消息分块 (支持 clientMessageId 去重)
  case "agent_message_chunk":    // Agent 消息分块 (支持 overwrite + streamingMessageId)
  case "agent_thought_chunk":    // Agent 思考分块 (含 thinkingDurationMs)
  case "tool_call":              // 工具调用 (含 subagent_started/completed)
  case "tool_call_update":       // 工具调用更新
  case "plan":                   // 执行计划
  case "plan_update":            // 计划更新
  case "status":                 // 状态变更
}
```

### 消息分组算法
- **user_message_chunk**: 按 `cognition.ai/clientMessageId` + `cognition.ai/messageSubIndex` 去重
- **agent_message_chunk**: 按 `cognition.ai/streamingMessageId` 分组, `cognition.ai/overwrite` 支持重写
- **agent_thought_chunk**: 同上 + `cognition.ai/thinkingDurationMs` 累积
- **tool_call**: 按 `toolCallId` 索引, 支持嵌套子agent

### 子Agent (Subagent) 系统
```javascript
// 启动: cognition.ai/subagent_started → { agentId, title, task, profile, depth, isBackground }
// 完成: cognition.ai/subagent_completed → { agentId, success, summary, depth }
// 上下文: cognition.ai/subagent_context → { parentAgentId }
// 状态: running → completed | failed
// 子agent消息递归嵌套: parent.childMessages
```

## 95.6 完整 cognition.ai/* 元数据键 (68个)

### 会话与消息
| 键 | 类型 | 说明 |
|----|------|------|
| `cognition.ai/session` | object | 会话信息 |
| `cognition.ai/clientMessageId` | string | 客户端消息ID |
| `cognition.ai/messageSubIndex` | number | 消息子索引 |
| `cognition.ai/streamingMessageId` | string | 流式消息ID |
| `cognition.ai/isOptimistic` | boolean | 乐观更新标记 |
| `cognition.ai/overwrite` | boolean | 重写标记 |
| `cognition.ai/timestamp` | string | 时间戳 |
| `cognition.ai/isTyping` | boolean | 正在输入 |

### Agent/Subagent
| 键 | 类型 | 说明 |
|----|------|------|
| `cognition.ai/subagent_started` | object | 子agent启动 {agentId, title, task, profile, depth, isBackground} |
| `cognition.ai/subagent_completed` | object | 子agent完成 {agentId, success, summary, depth} |
| `cognition.ai/subagent_context` | object | 子agent上下文 {parentAgentId} |
| `cognition.ai/botUsername` | string | Bot用户名 |
| `cognition.ai/sender` | object | 发送者信息 |
| `cognition.ai/thinkingDurationMs` | number | 思考时长(ms) |

### 工具调用
| 键 | 类型 | 说明 |
|----|------|------|
| `cognition.ai/toolName` | string | MCP工具名 |
| `cognition.ai/inferenceToolName` | string | 推理工具名 |
| `cognition.ai/permissionType` | string | 权限请求类型 |
| `cognition.ai/approved` | boolean | 权限批准 |
| `cognition.ai/reason` | string | 权限原因 |
| `cognition.ai/actions` | array | ComputerUse动作列表 |
| `cognition.ai/screenshotKeys` | array | 截图键列表 |
| `cognition.ai/inputKey` | string | 输入截图键 |
| `cognition.ai/outputKey` | string | 输出截图键 |
| `cognition.ai/videoPath` | string | 录屏路径 |
| `cognition.ai/shellId` | string | Shell ID |
| `cognition.ai/listDirectory` | boolean | 目录列表标记 |
| `cognition.ai/showContentWithExternalLinks` | boolean | 外部链接内容 |
| `cognition.ai/endLine` | number | 读取文件结束行 |

### Secrets 管理
| 键 | 类型 | 说明 |
|----|------|------|
| `cognition.ai/secretName` | string | Secret名 |
| `cognition.ai/secretType` | string | Secret类型 |
| `cognition.ai/secretNames` | string[] | Secret名列表 |
| `cognition.ai/envVarName` | string | 环境变量名 |
| `cognition.ai/requestId` | string | 请求ID |
| `cognition.ai/action` | string | 操作 (saved/dismissed) |

### Session/PR 管理
| 键 | 类型 | 说明 |
|----|------|------|
| `cognition.ai/proposedByDevinId` | string | Devin提议者ID |
| `cognition.ai/sessionPRs` | array | 会话关联的PR列表 |
| `cognition.ai/sessionRepos` | array | 会话关联的Repo列表 |
| `cognition.ai/url` | string | 会话URL |
| `cognition.ai/htmlUrl` | string | PR HTML URL |
| `cognition.ai/prTitle` | string | PR标题 |
| `cognition.ai/pullNumber` | string/number | PR编号 |
| `cognition.ai/repo` | string | Repo名 |
| `cognition.ai/worktreeFor` | string | Worktree关联 |
| `cognition.ai/additionalWorkspaceDirs` | string[] | 额外工作区 |
| `cognition.ai/sortUpdatedAt` | string | 排序更新时间 |
| `cognition.ai/session-id` | string | 会话ID |
| `cognition.ai/sessionLifecycle` | string | 会话生命周期 |

### Capability 标志
| 键 | 类型 | 说明 |
|----|------|------|
| `cognition.ai/multiRootWorkspace` | boolean | 多根工作区 |
| `cognition.ai/sessionListCreatedAfter` | boolean | 按创建时间过滤 |
| `cognition.ai/sessionListUpdatedAfter` | boolean | 按更新时间过滤 |
| `cognition.ai/sessionListRefetch` | boolean | 重新获取列表 |
| `cognition.ai/sessionListContentSearch` | boolean | 内容搜索 |
| `cognition.ai/sessionArchiving` | boolean | 会话归档 |
| `cognition.ai/sessionRename` | boolean | 会话重命名 |
| `cognition.ai/sessionUnreadTracking` | boolean | 未读追踪 |
| `cognition.ai/prManagement` | boolean | PR管理 |
| `cognition.ai/secretSend` | boolean | Secret发送 |
| `cognition.ai/revert` | boolean | Revert能力 |
| `cognition.ai/mcp` | boolean | MCP管理 |
| `cognition.ai/httpUpload` | boolean | HTTP上传 |
| `cognition.ai/httpUploadMaxBytes` | number | 上传大小限制 |
| `cognition.ai/maxEmbeddedResourceBytes` | number | 嵌入资源大小限制 |
| `cognition.ai/httpUploadUrl` | string | 上传URL |
| `cognition.ai/canManageMcpServers` | boolean | MCP服务器管理 |
| `cognition.ai/canManageOrgSecrets` | boolean | 组织Secret管理 |
| `cognition.ai/manageIntegrationsUrl` | string | 集成管理URL |
| `cognition.ai/manageOrgsUrl` | string | 组织管理URL |

### 其他
| 键 | 类型 | 说明 |
|----|------|------|
| `cognition.ai/eventType` | string | 云事件类型 |
| `cognition.ai/hiddenResource` | boolean | 隐藏资源 |
| `cognition.ai/isExitPlan` | boolean | 退出计划 |
| `cognition.ai/impact` | string | 阻塞影响 |
| `cognition.ai/playbookTitle` | string | Playbook标题 |
| `cognition.ai/questions` | array | 用户问题 |
| `cognition.ai/icon` | string | 选项图标 |
| `cognition.ai/title` | string | 标题 |
| `cognition.ai/summary` | string | 摘要 |
| `cognition.ai/sink` | string | 配置目标 |
| `cognition.ai/skillFiles` | string | 技能文件 |
| `cognition.ai/contentsKey` | string | Diff内容键 |
| `cognition.ai/statusEnum` | string | 状态枚举 |
| `cognition.ai/statusReason` | string | 状态原因 |
| `cognition.ai/statusMessage` | string | 状态消息 |
| `cognition.ai/queuePosition` | number | 队列位置 |
| `cognition.ai/activityEnum` | string | 活动枚举 |
| `cognition.ai/availableMentionTypes` | array | 可用@提及类型 |

### Token 使用统计
| 键 | 类型 | 说明 |
|----|------|------|
| `cognition.ai/inputTokens` | number | 输入token数 |
| `cognition.ai/outputTokens` | number | 输出token数 |
| `cognition.ai/cachedReadTokens` | number | 缓存读取token数 |
| `cognition.ai/cachedWriteTokens` | number | 缓存写入token数 |

### ACP Registry Agent 元数据
| 键 | 类型 | 说明 |
|----|------|------|
| `cognition.ai/featured` | boolean | 精选agent |
| `cognition.ai/bundled` | boolean | 捆绑agent |
| `cognition.ai/hidden` | boolean | 隐藏agent |
| `cognition.ai/promoLabel` | string | 推广标签 |
| `cognition.ai/promoTooltip` | string | 推广提示 |

### Windsurf 扩展方法常量
```javascript
REVERT_LIST_STEPS_METHOD  = "_cognition.ai/revert/listSteps"
REVERT_PREVIEW_METHOD     = "_cognition.ai/revert/preview"
REVERT_EXECUTE_METHOD     = "_cognition.ai/revert/execute"
REVERT_FORK_FROM_STEP_METHOD = "_cognition.ai/revert/forkFromStep"
MCP_LIST_SERVERS_METHOD   = "_cognition.ai/mcp/listServers"
MCP_TOGGLE_SERVER_METHOD  = "_cognition.ai/mcp/toggleServer"
MCP_TOGGLE_TOOL_METHOD    = "_cognition.ai/mcp/toggleTool"
SESSION_RENAME_METHOD     = "_cognition.ai/session/rename"
ELICITATION_METHOD        = "_session/elicitation"
REVIEW_DIFF_URI           = "diff://workspace/changes"
DEVIN_CLOUD_PROVIDER_ID   = "devin-cloud"
```

## 95.7 ACP Agent Registry Schema

```javascript
AcpRegistrySchema = {
  version: "x.y.z",          // semver
  agents: [{
    id: /^[a-z][a-z0-9-]*$/,  // 唯一标识符
    name: string,              // 人类可读名
    version: "x.y.z",         // agent版本
    description: string,       // 描述
    repository?: string,       // 源码仓库URL
    authors?: string[],        // 作者
    license?: string,          // SPDX许可证
    icon?: string,             // 图标URL
    distribution: {
      npx?: { package, args?, env? },    // npm包启动
      uvx?: { package, args?, env? },    // Python包启动
      binary?: {                          // 二进制分发
        "darwin-aarch64"?: { archive, cmd, args?, env? },
        "darwin-x86_64"?: ...,
        "linux-aarch64"?: ...,
        "linux-x86_64"?: ...,
        "windows-aarch64"?: ...,
        "windows-x86_64"?: ...
      },
      websocket?: { url }                // WebSocket代理
    }
  }]
}
```

### Agent 启动优先级
```
1. npx (npm包) → npx -y <package> [args]
2. uvx (Python) → uvx <package> [args]  
3. binary (原生) → 按平台选择 archive+cmd
4. websocket → wss://app.devin.ai/api/acp/live (Devin Cloud)
```

## 95.8 ACP RequestError 错误码

| Code | 名称 | 说明 |
|------|------|------|
| -32700 | parseError | JSON解析错误 |
| -32600 | invalidRequest | 无效请求 |
| -32601 | methodNotFound | 方法不存在 |
| -32602 | invalidParams | 无效参数 |
| -32603 | internalError | 内部错误 |
| -32000 | authRequired | 需要认证 |
| -32002 | resourceNotFound | 资源不存在 |

---

# 96. Eval 系统完整逆向 — 模型训练评估流水线

## 96.1 eval.proto 概览

```
Package: exa.eval_pb (1247 行)
依赖: api_server_pb, chat_pb, codeium_common_pb, context_module_pb,
      cortex_pb, eval/pr_eval/datasets_pb, model_management_pb, trainer_pb
Service: EvalQueueService (5 RPC)
```

## 96.2 评估类型体系 (16个枚举)

### EvalType (8种)
```protobuf
EVAL_TYPE_AUTOCOMPLETE = 1          // 自动补全
EVAL_TYPE_CHAT = 2                  // 聊天
EVAL_TYPE_INSTRUCTION_AUTOCOMPLETE = 3  // 指令式自动补全
EVAL_TYPE_INSTRUCTION_CHAT = 4      // 指令式聊天
EVAL_TYPE_HUMAN_EVAL = 5           // 人类评估
EVAL_TYPE_LLMJUDGE = 6             // LLM裁判
EVAL_TYPE_AUTOCOMPLETE_COMMAND = 7  // 自动补全命令
EVAL_TYPE_CODE_REASONING = 8       // 代码推理
```

### PromptFormat (12种) — 精确模型适配
```protobuf
PROMPT_FORMAT_INTERNAL = 1         // Codeium内部格式
PROMPT_FORMAT_OPENAI = 2           // OpenAI格式
PROMPT_FORMAT_LLAMA = 3            // LLaMA原始格式
PROMPT_FORMAT_LLAMA3 = 4           // LLaMA3格式
PROMPT_FORMAT_HERMES3 = 5          // Hermes3格式
PROMPT_FORMAT_INTERNAL_CUMULATIVE = 6  // 内部累积格式
PROMPT_FORMAT_XML = 7              // XML格式
PROMPT_FORMAT_DEEPSEEK = 8         // DeepSeek V1
PROMPT_FORMAT_DEEPSEEKV2 = 9       // DeepSeek V2
PROMPT_FORMAT_DEEPSEEKV3 = 10      // DeepSeek V3
PROMPT_FORMAT_KIMI = 11            // Kimi格式
PROMPT_FORMAT_QWEN_CODER = 12      // QwenCoder格式
```

### DeletionType (7种) — 测试用例生成策略
```protobuf
DELETION_TYPE_INLINE_FIM = 1        // 行内FIM删除
DELETION_TYPE_RANDOM_MULTILINE = 2  // 随机多行删除
DELETION_TYPE_FUNCTION_PARAMS = 3   // 函数参数删除
DELETION_TYPE_REFERENCE = 4         // 引用删除
DELETION_TYPE_REPO_REFERENCE = 5    // 仓库引用删除
DELETION_TYPE_FULL_FUNCTION = 6     // 完整函数删除
DELETION_TYPE_COMMENTED_CODEBLOCK = 7 // 注释代码块删除
```

### InferDataTags (18种) — 推理数据标签
```
Source类 (100-): function_body_random, definition_function, reference_call,
                 reference_class, function_body_full, repo_reference, commented_codeblock
Deletion类 (100+): single_line, multi_line, inline_fim
Chat类 (200+): refactor_efficiency
Instruction类 (300+): insert, edit
Supercomplete类 (400+): no_edit
Chat Context类 (500+): single/multi_turn × with/without_context
Cascade类 (600+): system_response, tool_call, code_writing
Completion类 (700+): insertion, edit
```

### CortexGenerationType (7种) — Cortex生成模式
```protobuf
CORTEX_GENERATION_TYPE_DYNAMIC_TRAJECTORY = 3  // 动态轨迹
CORTEX_GENERATION_TYPE_INFORM = 5              // Inform模式
CORTEX_GENERATION_TYPE_FILE_RESEARCH = 4       // 文件研究
CORTEX_GENERATION_TYPE_CCI_RESEARCH = 6        // CCI研究
CORTEX_GENERATION_TYPE_GROUNDTRUTH = 8         // 基准真值
CORTEX_GENERATION_TYPE_REAPPLY_GROUND_TRUTH = 9// 重新应用真值
CORTEX_GENERATION_TYPE_VERIFY = 10             // 验证
```

### LLMJudgeEvalType (4种)
```protobuf
LLM_JUDGE_EVAL_TYPE_SUPERCOMPLETE = 4        // Supercomplete评估
LLM_JUDGE_EVAL_TYPE_SUPERCOMPLETE_LABEL = 5  // Supercomplete标签
LLM_JUDGE_EVAL_TYPE_CASCADE = 6              // Cascade评估
LLM_JUDGE_EVAL_TYPE_TAB_JUMP_LABEL = 7       // TabJump标签
```

### OverallTrajectoryJudgePromptType (6种)
```protobuf
CONVERSATIONAL = 1               // 会话式评判
IMPLICIT_MATCHER = 2             // 隐式匹配
INTENT_BOUNDARY = 3              // 意图边界
RUBRIC_CREATOR = 4               // 评分标准生成
RUBRIC_EVAL = 5                  // 评分标准评估
INTENT_BOUNDARY_RUN_COMMAND_VERIFIER = 6  // 命令执行意图边界验证
```

### IntervalType (7种) — 行为间隔追踪
```protobuf
INTERVAL_TYPE_EDIT_TO_VIEW = 1      // 编辑→查看
INTERVAL_TYPE_EDIT_TO_EDIT = 2      // 编辑→编辑
INTERVAL_TYPE_EDIT_TO_COMMAND = 3   // 编辑→命令
INTERVAL_TYPE_COMMAND_TO_EDIT = 4   // 命令→编辑
INTERVAL_TYPE_COMMAND_TO_COMMAND = 5// 命令→命令
INTERVAL_TYPE_CASCADE_TURN = 6     // Cascade轮次
INTERVAL_TYPE_AFTER_PAUSE = 7      // 暂停后
```

## 96.3 LanguageServerConfig — LS 启动配置全字段

```protobuf
message LanguageServerConfig {
  int32 server_port = 1;
  int32 lsp_port = 2;
  bool random_port = 3;
  string random_port_dir = 4;
  string manager_lock_file = 5;
  string child_lock_file = 6;
  string database_dir = 7;
  string portal_url = 9;
  string api_server_url = 10;
  string inference_api_server_url = 32;
  bool use_mock_api_server_client = 11;
  int32 api_server_http_client_timeout_seconds = 34;
  bool detect_proxy = 12;
  bool enable_lsp = 13;
  bool enable_local_search = 14;
  int32 search_max_workspace_file_count = 15;
  int32 file_watch_max_dir_count = 31;
  bool enable_chat_web_server = 16;
  bool enable_chat_client = 17;
  string workspace_id = 18;
  string index_service_url = 19;
  bool enable_index_service = 20;
  string embedding_model_name = 29;
  bool auto_prepare_actions = 25;
  bool m_query_for_context_module = 27;
  bool record_cortex_telemetry = 28;
  bool dev_mode = 21;              // 开发模式
  bool remote_mode = 22;           // 远程模式
  bool teams_mode = 23;            // 团队模式
  bool enterprise_mode = 24;       // 企业模式
  bool eval_mode = 30;             // 评估模式
  bool auto_cascade_mode = 33;     // 自动Cascade模式
}
```

**6种运行模式**: dev, remote, teams, enterprise, eval, auto_cascade

## 96.4 EvalQueueService (5 RPC)

```protobuf
service EvalQueueService {
  rpc EnqueueEvalTask (EnqueueEvalTaskRequest) returns (EnqueueEvalTaskResponse);
  rpc DequeueEvalTask (DequeueEvalTaskRequest) returns (DequeueEvalTaskResponse);
  rpc EnqueueEvalResult (EnqueueEvalResultRequest) returns (EnqueueEvalResultResponse);
  rpc DequeueEvalResult (DequeueEvalResultRequest) returns (DequeueEvalResultResponse);
  rpc ResetQueues (ResetQueuesRequest) returns (ResetQueuesResponse);
}
```

## 96.5 训练评估流水线架构

```
TrajectoryDownload → FindTrajectory → GenerateTask → [LanguageServer启动]
     ↓                                    ↓
  QueryConfig                    InitialWorkspaceState
  (6种查询类型:                   (file_state_override +
   REVERT/THUMBS_UP/              base_state_repo_info)
   DATE_RANGE/DOWNLOAD/
   METRICS/PASSTHROUGH)
     ↓
  GenerateLanguageServerConfig → CascadeConfigRandomizer
     ↓                           (ConfigVariant × weights)
  Rollout → Metrics → Judge
     ↓         ↓        ↓
  RolloutDataset  MetricsStage  OverallTrajectoryJudge
  (training data)  (LLM judge)   (pairwise + process + review)
```

### 关键发现 — CascadeConfigRandomizer
```protobuf
message CascadeConfigRandomizer {
  message ConfigVariant {
    float randomization_weight = 1;
    string name = 2;
    CascadeConfig cascade_config = 3;
  }
  repeated ConfigVariant config_variants = 2;
  CascadeConfig override_cascade_config = 3;
}
```
**Windsurf 内部使用 A/B 测试框架对 Cascade 配置进行随机化实验!**

---

# 97. Diff/Analytics/Prompt/Index 完整逆向

## 97.1 diff_action.proto (76行)

### 3种 Diff 类型
```protobuf
enum DiffType {
  DIFF_TYPE_UNIFIED = 1;     // 标准unified diff
  DIFF_TYPE_CHARACTER = 2;   // 字符级diff
  DIFF_TYPE_COMBO = 3;       // 组合diff (行级+字符级)
}
```

### Diff 消息体系
```
DiffSet
├── UnifiedDiff → UnifiedDiffLine[] { text, type(INSERT/DELETE/UNCHANGED) }
├── CharacterDiff → CharacterDiffChange[] { text, type }
└── ComboDiff → ComboDiffLine[] { text, type, character_diff }

DiffList → DiffBlock[] { start_line, end_line, unified_diff, from_language, to_language }
```

**关键**: DiffBlock 支持跨语言 diff (from_language ≠ to_language)

## 97.2 analytics.proto (192行) — AnalyticsService (8 RPC)

```protobuf
service AnalyticsService {
  rpc RecordCommandUsage      // 命令使用记录
  rpc RecordCompletions       // 补全记录
  rpc RecordContextToPrompt   // 上下文→Prompt映射
  rpc RecordCortexTrajectory  // Cortex轨迹记录
  rpc RecordCortexTrajectoryStep  // 轨迹步骤记录
  rpc RecordTabTrajectoryStep // Tab轨迹步骤
  rpc BatchRecordPrompts      // 批量Prompt记录
  rpc BatchRecordCompletions  // 批量补全记录
}
```

### RecordCommandUsage 关键字段
```protobuf
message RecordCommandUsageRequest {
  Metadata metadata = 1;
  string command = 2;
  string selection = 3;
  CommandRequestSource request_source = 4;
  string prompt = 8;
  string completion = 7;
  Model requested_model_id = 9;
  StopReason stop_reason = 10;
  Language language = 11;
  ProviderSource provider_source = 12;
  UnifiedPromptComponents command_prompt_components = 13;
  CortexTrajectoryReference cortex_trajectory_reference = 14;
  SuperCompleteFilterReason super_complete_filter_reason = 15;
  SupercompleteTriggerCondition supercomplete_trigger_condition = 17;
  repeated PromptStageLatency prompt_stage_latencies = 16;
  CompletionProfile completion_profile = 18;
  int32 char_insertions = 19;
  int32 char_deletions = 20;
  repeated string trajectory_step_oids = 21;  // MongoDB ObjectID引用!
}
```

### Arena 模式遥测
```protobuf
message RecordArenaModeTrajectoryDetailsRequest {
  string arena_id = 2;
  string cascade_id = 3;
  string trajectory_id = 4;
  uint32 step_index = 5;
  CortexStepType step_type = 6;
  AcknowledgementType acknowledgement_type = 7;
  Model model = 8;
  string label = 9;
  ModelProvider model_provider = 10;
}
```

### Raw Completion 记录 (用于训练数据收集)
```protobuf
message RecordRawCompletionRequest {
  string trajectory_id = 2;
  string cascade_id = 3;
  int32 step_index = 4;
  string model_name = 5;
  string raw_prompt = 6;      // 完整原始prompt
  string raw_response = 7;    // 完整原始response
  int64 latency = 8;
  string error = 9;
  ProviderSource provider_source = 12;
}
```

**重要发现**: Windsurf 收集原始 prompt+response 用于训练数据!

## 97.3 prompt.proto (85行) — Prompt 构建系统

### UnifiedPromptComponents — 统一 Prompt 组件
```protobuf
message UnifiedPromptComponents {
  ContextModuleResult context_module_result = 2;   // 上下文检索
  CortexTrajectory cortex_trajectory = 3;          // 当前轨迹
  CommandIntentInfo command_intent_info = 4;        // 命令意图
  repeated ChatMessage chat_messages = 1;           // 聊天消息
  repeated CodeDiagnostic code_diagnostics = 5;     // 代码诊断
  repeated Document other_documents = 9;            // 其他文档
  DeepWikiSymbolContext deep_wiki_context = 10;     // DeepWiki V1
  DeepWikiContext deep_wiki_context_v2 = 11;        // DeepWiki V2
  SupercompleteFeedbackContext supercomplete_feedback_context = 12;  // 反馈上下文
}
```

### CumulativePromptConfig — Token 分配策略
```protobuf
message CumulativePromptConfig {
  float persistent_context_multiplier = 7;           // 持久上下文占比
  float persistent_active_document_multiplier = 10;  // 活动文档占比
  float persistent_open_docs_multiplier = 11;        // 打开文档占比
  int64 persistent_max_tokens_per_open_doc = 17;     // 每文档最大token
  int64 persistent_max_ccis_considered = 12;          // 最大CCI数
  float persistent_document_suffix_frac = 20;        // 文档后缀占比
  float trajectory_context_multiplier = 2;           // 轨迹上下文占比
  float trajectory_refresh_threshold_multiplier = 15;// 刷新阈值
  float trajectory_truncation_multiplier = 16;       // 截断乘数
  float ephemeral_context_multiplier = 9;            // 临时上下文占比
  int64 intent_reservation_tokens = 6;               // 意图预留token
  float ephemeral_active_document_multiplier = 13;
  int64 ephemeral_max_ccis_considered = 14;
  float ephemeral_document_suffix_frac = 21;
  repeated CortexStepType allowed_cascade_step_types = 18;
  map<string, bool> allowed_implicit_step_types = 22;
}
```

**Prompt 构建的 3 层上下文**:
1. **Persistent**: 活动文档 + 打开文档 + CCI (代码上下文项)
2. **Trajectory**: Cortex 轨迹 (含刷新阈值和截断)
3. **Ephemeral**: 临时上下文 (命令意图/诊断)

### SupercompleteFeedback — 自适应学习
```protobuf
message SupercompleteFeedback {
  bool accepted = 1;
  bool intentional_reject = 2;
  string completion_id = 3;
  int64 timestamp_ms = 4;
  HandleStreamingTabV2Response.Diff diff_suggestion = 5;
  HandleStreamingTabV2Response.TabJump tabjump_suggestion = 6;
}
```

## 97.4 index.proto (463行) — 2个服务 23个RPC

### IndexManagementService (19 RPC)
```protobuf
service IndexManagementService {
  rpc EnableIndexing / DisableIndexing        // 启用/禁用索引
  rpc AddRepository / EditRepository / DeleteRepository  // 仓库管理
  rpc GetRepositories                         // 获取仓库列表
  rpc AddIndex / CancelIndexing / RetryIndexing / DeleteIndex  // 索引操作
  rpc GetIndexes / GetIndex / GetRemoteIndexStats  // 索引查询
  rpc PruneDatabase / GetDatabaseStats        // 数据库维护
  rpc SetIndexConfig / GetIndexConfig         // 配置管理
  rpc GetNumberConnections / GetConnectionsDebugInfo  // 连接调试
}
```

### IndexService (4 RPC)
```protobuf
service IndexService {
  rpc GetIndexedRepositories        // 获取已索引仓库
  rpc GetNearestCCIsFromEmbedding   // 向量近邻搜索
  rpc GetEmbeddingsForCodeContextItems  // 代码上下文嵌入
  rpc GetMatchingFilePaths          // 文件路径匹配
}
```

### IndexMode (5种向量索引模式)
```protobuf
INDEX_MODE_HALFVEC = 1               // 半精度向量
INDEX_MODE_BINARY = 2                // 二进制量化
INDEX_MODE_BINARY_WITH_RERANK = 3    // 二进制+重排序
INDEX_MODE_BRUTE_FORCE = 4           // 暴力搜索
INDEX_MODE_RANDOM_SEARCH = 5         // 随机搜索 (测试用)
```

### IndexingStatus (9种状态)
```
QUEUED → CLONING_REPO → SCANNING_REPO → GENERATING_EMBEDDINGS → VECTOR_INDEXING → DONE
                                                                                    ↓
CANCELING → CANCELED                                                            ERROR
```

### IndexerEvent (7种事件)
```protobuf
oneof event_oneof {
  Deletion deletion = 2;           // 文件删除
  Untrack untrack = 3;             // 取消跟踪
  Update update = 4;               // 文件更新 (含workspace uid)
  AddWorkspace add_workspace = 5;  // 添加工作区 (含file count + size)
  RemoveWorkspace remove_workspace = 6;  // 移除工作区
  IgnoreWorkspace ignore_workspace = 7;  // 忽略工作区
  AddCommit add_commit = 8;        // 新增commit
}
```

### RepositoryConfig — 自动索引
```protobuf
message AutoIndexConfig {
  string branch_name = 1;
  Duration interval = 2;         // 定期索引间隔
  int32 max_num_auto_indexes = 3;  // 最大自动索引数
}
```

支持 SCM: GitHub, GitLab, Bitbucket + GitHub App + Service Key 认证

---

# 98. 更新逆向总结 — Round 3

## 98.1 Round 3 新发现统计

| 维度 | Round 2 | Round 3 | 增量 |
|------|---------|---------|------|
| 文档章节 | 94 | 98 | +4 |
| gRPC Services | 18 | 22 | +4 (EvalQueue, Analytics, IndexManagement, Index) |
| RPC Methods | ~654 | ~686 | +32 |
| ACP 方法 | 未详 | 27 (Agent:17 + Client:11) | 首次完整记录 |
| cognition.ai/* 元数据 | ~97 | **68 (精确)** | 精确化 |
| PromptFormat | 8 | **12** | +4 (DeepSeek V1/V2/V3, QwenCoder) |
| LS 运行模式 | 未详 | **6** | 首次记录 |
| Eval 枚举 | 未详 | **16** | 首次记录 |
| Diff 类型 | 未详 | **3** | 首次记录 |
| 向量索引模式 | 未详 | **5** | 首次记录 |

## 98.2 Round 3 关键新发现

### 1. ACP 协议完整破解
- **27个方法** (17 Agent + 11 Client) 完整文档化
- **68个 cognition.ai/* 元数据键** 精确提取 (比 Round 2 更准确)
- **双传输层**: ndJsonStream (stdio) + webSocketStream (`wss://app.devin.ai/api/acp/live`)
- **8种 sessionUpdate 类型** 构成完整会话状态机
- **子Agent系统**: 嵌套深度+后台运行+递归消息
- **ACP Registry**: 4种分发方式 (npx/uvx/binary/websocket)

### 2. Eval/训练系统暴露
- **12种 PromptFormat**: 包含 DeepSeek V1/V2/V3, Kimi, QwenCoder — 证实 Windsurf 支持自训模型
- **CascadeConfigRandomizer**: 内部 A/B 测试框架, 按权重随机选择 Cascade 配置
- **LLM-as-Judge**: 6种评判策略 (会话式/隐式匹配/意图边界/评分标准/配对比较)
- **轨迹数据收集**: RecordRawCompletion 记录完整 prompt+response 用于训练

### 3. LanguageServerConfig 完整
- **6种运行模式**: dev, remote, teams, enterprise, eval, auto_cascade
- **34个配置字段** 完整提取, 含 inference_api_server_url 独立推理路径

### 4. 向量索引系统
- **5种索引模式**: HALFVEC, BINARY, BINARY_WITH_RERANK, BRUTE_FORCE, RANDOM_SEARCH
- **9种索引状态** 完整状态机
- **7种 IndexerEvent**: 实时文件变更追踪
- 支持 AutoIndexConfig (定期自动索引分支)

### 5. Analytics 遥测深度
- **RecordRawCompletion**: 收集完整 raw prompt + raw response + model_name + latency
- **trajectory_step_oids**: MongoDB ObjectID 引用, 确认后端存储
- **Arena 遥测**: 记录 model + label + model_provider 用于 A/B 模型对比

## 98.3 更新架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Windsurf IDE (Electron)                │
├───────────────┬──────────────┬───────────────────────────┤
│  extension.js │  chat-client │  windsurf-acp             │
│  (6 services) │  (14.4MB)    │  (728KB)                  │
│               │  1943 types  │  27 ACP methods            │
│               │  429 events  │  68 cognition.ai/* keys    │
│               │  12 PromptFmt│  ACP Registry Schema       │
├───────────┬───┴──────────────┴───────────────────────────┤
│           │         Connect-RPC (HTTP/1.1)               │
│           ▼                                               │
│  ┌─────────────────────────────────────────────────┐     │
│  │           Language Server (Go Binary)            │     │
│  │  172+50 RPC │ 6 modes │ 34 config fields        │     │
│  ├─────────────┼─────────┼─────────────────────────┤     │
│  │ Cortex      │ Context │ Eval Pipeline            │     │
│  │ 85 steps    │ Module  │ 12 PromptFormat           │     │
│  │ Brain System│ 3 layers│ CascadeConfigRandomizer   │     │
│  │ 8 planners  │         │ LLM-as-Judge              │     │
│  │ CodeMap     │         │ Trajectory Collector       │     │
│  ├─────────────┼─────────┼─────────────────────────┤     │
│  │ Index       │ Search  │ Analytics                 │     │
│  │ 5 modes     │ OpenSrch│ 8 RPC, raw prompt/resp    │     │
│  │ 23 RPC      │ 24 RPC  │ Arena telemetry           │     │
│  │ 9 statuses  │ 7 conns │ trajectory_step_oids      │     │
│  └──────┬──────┴────┬────┴────────┬────────────────┘     │
│         │           │             │                       │
│         ▼           ▼             ▼                       │
│  ┌──────────┐ ┌──────────┐ ┌───────────────┐            │
│  │server.   │ │inference.│ │register.      │            │
│  │codeium   │ │codeium   │ │windsurf.com   │            │
│  │.com      │ │.com      │ │               │            │
│  └──────────┘ └──────────┘ └───────────────┘            │
│                                                           │
│  ┌──────────────────────────────────────────────┐        │
│  │           ACP Agent Transport                  │        │
│  │  stdio: ndJsonStream (local agents)            │        │
│  │  ws: wss://app.devin.ai/api/acp/live (cloud)  │        │
│  └──────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

## 98.4 更新 Service 总表

| # | Service | Proto Package | RPC Count |
|---|---------|--------------|-----------|
| 1 | LanguageServerService | language_server_pb | **172** |
| 2 | ApiServerService | api_server_pb | **171** |
| 3 | SeatManagementService | seat_management_pb | **151** |
| 4 | ExtensionServerService | extension_server_pb | **50** |
| 5 | **KnowledgeBaseService** | opensearch_clients_pb | **20** |
| 6 | **IndexManagementService** | index_pb | **19** |
| 7 | CascadePluginsService | language_server_pb | **5** |
| 8 | **EvalQueueService** | eval_pb | **5** |
| 9 | **AnalyticsService** | analytics_pb | **8** |
| 10 | **UserAnalyticsService** | user_analytics_pb | **7** |
| 11 | **IndexService** | index_pb | **4** |
| 12 | **CodeIndexService** | opensearch_clients_pb | **4** |
| 13 | BrowserPreviewService | language_server_pb | **3** |
| 14 | FileSystemProviderService | language_server_pb | **3** |
| 15 | **ProductAnalyticsService** | product_analytics_pb | **2** |
| 16 | ChatClientServerService | language_server_pb | **1** |
| 17-22 | ReactiveStreams + 其他 | various | ~61 |

**总 gRPC Services: 22 | 总 RPC Methods: ~686**

## 98.5 累计逆向统计

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Windsurf 逆向工程 — 累计统计 (Round 3)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  文档章节:         98
  gRPC Services:    22
  RPC Methods:      ~686
  Proto Types:      1943+
  Proto Enums:      226+
  Events/Constants: 429
  ACP Methods:      27 (精确)
  cognition.ai/*:   68 (精确)
  PromptFormat:     12
  HTTP Headers:     138
  URLs:             72+
  CortexStep Types: 85
  Trajectory Types: 19
  Tool Formatters:  8
  LS Run Modes:     6
  Index Modes:      5
  Diff Types:       3
  Vector Search:    5 modes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

# 99. @anthropic-ai/sandbox-runtime 逆向 — 安全沙箱系统

## 99.1 概览

```
Package: @anthropic-ai/sandbox-runtime@0.0.23
License: Apache-2.0
Source: github.com/anthropic-experimental/sandbox-runtime
CLI binary: srt (dist/cli.js)
Config file: ~/.srt-settings.json
Sourcemap: cdn.windsurf.com/sourcemaps/a65d6c4e1fd335336d7a0b601099811667e184ca/
```

**用途**: Windsurf 使用 Anthropic 的沙箱运行时为 AI agent 执行的命令提供安全边界 (网络+文件系统限制)

## 99.2 SandboxManager API (21个方法)

| 方法 | 说明 |
|------|------|
| `initialize(config, askCallback?, enableLogMonitor?)` | 初始化沙箱 (启动代理服务器) |
| `isSupportedPlatform(platform)` | 检查平台支持 (macOS + Linux) |
| `isSandboxingEnabled()` | 是否已启用沙箱 |
| `checkDependencies(ripgrepConfig?)` | 检查依赖 (rg, bwrap, socat) |
| `wrapWithSandbox(cmd, binShell?, customConfig?, abortSignal?)` | **核心**: 包装命令加安全限制 |
| `getFsReadConfig()` | 获取文件读取限制 |
| `getFsWriteConfig()` | 获取文件写入限制 |
| `getNetworkRestrictionConfig()` | 获取网络限制 |
| `getAllowUnixSockets()` | Unix Socket 白名单 |
| `getAllowLocalBinding()` | 是否允许本地端口绑定 |
| `getIgnoreViolations()` | 忽略的违规配置 |
| `getEnableWeakerNestedSandbox()` | Docker 弱嵌套模式 |
| `getProxyPort()` | HTTP 代理端口 |
| `getSocksProxyPort()` | SOCKS 代理端口 |
| `getLinuxHttpSocketPath()` | Linux HTTP Socket 路径 |
| `getLinuxSocksSocketPath()` | Linux SOCKS Socket 路径 |
| `waitForNetworkInitialization()` | 等待网络初始化完成 |
| `reset()` | 重置/清理 |
| `getSandboxViolationStore()` | 获取违规记录存储 |
| `annotateStderrWithSandboxFailures(cmd, stderr)` | 为 stderr 添加沙箱违规注释 |
| `getLinuxGlobPatternWarnings()` | Linux glob 模式警告 |

## 99.3 配置 Schema

```javascript
SandboxRuntimeConfigSchema = {
  network: {
    allowedDomains: string[],    // e.g. ["github.com", "*.npmjs.org"]
    deniedDomains: string[],     // 拒绝列表 (优先)
    allowUnixSockets?: string[], // macOS Unix Socket 白名单
    allowAllUnixSockets?: bool,  // Linux 允许所有 Unix Socket
    allowLocalBinding?: bool,    // 允许绑定本地端口
    httpProxyPort?: number,      // 外部 HTTP 代理端口
    socksProxyPort?: number,     // 外部 SOCKS 代理端口
  },
  filesystem: {
    denyRead: string[],          // 禁止读取路径
    allowWrite: string[],        // 允许写入路径
    denyWrite: string[],         // 禁止写入路径 (优先于 allowWrite)
    allowGitConfig?: bool,       // 允许写 .git/config
  },
  ignoreViolations?: { [cmdPattern]: string[] },  // 忽略特定命令的违规
  enableWeakerNestedSandbox?: bool,                // Docker 嵌套模式
  ripgrep?: { command: string, args?: string[] },  // 自定义 ripgrep
  mandatoryDenySearchDepth?: number,               // 危险文件搜索深度 (1-10, 默认3)
  allowPty?: bool,                                 // 允许 PTY (macOS)
}
```

## 99.4 安全文件保护

### 危险文件列表 (9个)
```javascript
DANGEROUS_FILES = [
  '.gitconfig', '.gitmodules',
  '.bashrc', '.bash_profile',
  '.zshrc', '.zprofile', '.profile',
  '.ripgreprc', '.mcp.json'
]
```

### 危险目录 (3个 + Claude特有)
```javascript
DANGEROUS_DIRECTORIES = ['.git', '.vscode', '.idea']
// 额外保护:
'.claude/commands'
'.claude/agents'
```

### 默认可写路径 (10个)
```javascript
getDefaultWritePaths() = [
  '/dev/stdout', '/dev/stderr', '/dev/null', '/dev/tty',
  '/dev/dtracehelper', '/dev/autofs_nowait',
  '/tmp/claude', '/private/tmp/claude',
  '~/.npm/_logs', '~/.claude/debug'
]
```

## 99.5 网络限制架构

```
┌───────────────────────────────────────────────┐
│  Sandboxed Process                            │
│  env: HTTP_PROXY=localhost:N                  │
│       HTTPS_PROXY=localhost:N                 │
│       ALL_PROXY=socks5h://localhost:M         │
│       SANDBOX_RUNTIME=1                       │
│       TMPDIR=/tmp/claude                      │
│       NO_PROXY=localhost,127.0.0.1,...        │
├───────────────────────────────────────────────┤
│         ↓ HTTP        ↓ SOCKS5               │
│  ┌──────────────┐  ┌──────────────┐          │
│  │ HTTP Proxy   │  │ SOCKS Proxy  │          │
│  │ (127.0.0.1:N)│  │ (127.0.0.1:M)│          │
│  │ filterFunc() │  │ filterFunc() │          │
│  └──────┬───────┘  └──────┬───────┘          │
│         │ allowed?         │ allowed?         │
│         ↓                  ↓                  │
│  ┌──────────────────────────────────────┐    │
│  │ Domain Filter                        │    │
│  │ 1. Check deniedDomains → DENY        │    │
│  │ 2. Check allowedDomains → ALLOW      │    │
│  │ 3. No match → sandboxAskCallback()   │    │
│  │    (interactive user prompt)          │    │
│  └──────────────────────────────────────┘    │
└───────────────────────────────────────────────┘
```

### 代理环境变量 (20+)
| 变量 | 值 | 说明 |
|------|-----|------|
| `HTTP_PROXY` | `http://localhost:N` | HTTP 代理 |
| `HTTPS_PROXY` | `http://localhost:N` | HTTPS 代理 |
| `ALL_PROXY` | `socks5h://localhost:M` | 全局 SOCKS5h (DNS通过代理) |
| `GIT_SSH_COMMAND` | `ssh -o ProxyCommand='nc -X 5 ...'` | Git SSH 代理 (macOS) |
| `GRPC_PROXY` | `socks5h://localhost:M` | gRPC 代理 |
| `CLOUDSDK_PROXY_*` | 多个字段 | Google Cloud SDK |
| `DOCKER_HTTP_PROXY` | `http://localhost:N` | Docker 代理 |
| `FTP_PROXY` | `socks5h://localhost:M` | FTP 代理 |
| `SANDBOX_RUNTIME` | `1` | 沙箱标记 |
| `TMPDIR` | `/tmp/claude` | 临时目录 |

## 99.6 平台实现

### macOS (sandbox-exec/seatbelt)
- 使用 macOS 原生 `sandbox-exec` (Seatbelt profiles)
- 支持 glob 模式 (正则转换)
- 日志监控: `startMacOSSandboxLogMonitor()` → 违规记录
- 支持 PTY 控制

### Linux (bubblewrap + seccomp)
- 使用 `bwrap` (bubblewrap) 容器隔离
- `socat` 桥接 Unix Socket → TCP 代理
- `seccomp-bpf` 系统调用过滤 (vendor/seccomp/)
- 支持弱嵌套模式 (Docker 内)
- ripgrep 搜索危险文件

### Windows
- **不支持** (isSupportedPlatform 返回 false)
- Windows 上 Windsurf 沙箱无效!

## 99.7 违规检测

```javascript
// 违规记录结构
sandboxViolationStore.addViolation(violation)
sandboxViolationStore.getViolationsForCommand(command)

// stderr 自动注释
annotateStderrWithSandboxFailures(command, stderr)
// 输出: stderr + <sandbox_violations>...</sandbox_violations>
```

**关键发现**: Windsurf 使用 Anthropic (Claude) 的安全沙箱来限制 AI agent 的命令执行, 这证实了 Devin/Claude Code 与 Windsurf 的深度集成。

---

# 100. @connectrpc/connect 协议层完整逆向

## 100.1 版本与架构

```
Package: @connectrpc/connect@1.7.0 + @connectrpc/connect-web@1.7.0
Peer dep: @bufbuild/protobuf@^1.10.0
Protocols: connect, grpc, grpc-web
User-Agent: connect-es/1.7.0
Protocol-Version: 1
```

## 100.2 Content-Type 映射

| 调用类型 | Binary | JSON |
|---------|--------|------|
| Unary | `application/proto` | `application/json` |
| Stream | `application/connect+proto` | `application/connect+json` |

### Content-Type 正则
```javascript
// 通用匹配
/^application\/(connect\+)?(?:(json)(?:; ?charset=utf-?8)?|(proto))$/i
// Unary匹配
/^application\/(?:json(?:; ?charset=utf-?8)?|proto)$/i
// Stream匹配
/^application\/connect\+?(?:json(?:; ?charset=utf-?8)?|proto)$/i
```

## 100.3 协议 Headers

| Header | 用途 | Windsurf 使用 |
|--------|------|-------------|
| `Content-Type` | 编码类型 | `application/proto` (unary) / `application/connect+proto` (stream) |
| `Content-Length` | 正文长度 | Unary 请求 |
| `Content-Encoding` | Unary 压缩 | 可选 |
| `Connect-Content-Encoding` | Stream 压缩 | 可选 |
| `Accept-Encoding` | Unary 接受压缩 | 可选 |
| `Connect-Accept-Encoding` | Stream 接受压缩 | 可选 |
| `Connect-Timeout-Ms` | 超时(毫秒) | 按方法配置 |
| `Connect-Protocol-Version` | 协议版本 | **必须 = "1"** |
| `User-Agent` | 客户端标识 | `connect-es/1.7.0` |

### Windsurf 自定义 Headers
```
x-codeium-csrf-token: <csrf_token>     // CSRF 保护
x-devin-auth1-token: <auth1_token>     // Devin Auth1
x-devin-session-token: <session_token> // Devin 会话
```

## 100.4 错误码映射

### Connect Code → HTTP Status
| Connect Code | HTTP | 说明 |
|-------------|------|------|
| Canceled (1) | 499 | 客户端取消 |
| Unknown (2) | 500 | 未知错误 |
| InvalidArgument (3) | 400 | 无效参数 |
| DeadlineExceeded (4) | 504 | 超时 |
| NotFound (5) | 404 | 未找到 |
| AlreadyExists (6) | 409 | 冲突 |
| PermissionDenied (7) | 403 | 权限拒绝 |
| ResourceExhausted (8) | 429 | 配额耗尽 |
| FailedPrecondition (9) | 400 | 前置条件失败 |
| Aborted (10) | 409 | 操作中止 |
| OutOfRange (11) | 400 | 范围超出 |
| Unimplemented (12) | 501 | 未实现 |
| Internal (13) | 500 | 内部错误 |
| Unavailable (14) | 503 | 不可用 |
| DataLoss (15) | 500 | 数据丢失 |
| Unauthenticated (16) | 401 | 未认证 |

### HTTP Status → Connect Code (反向)
| HTTP | Connect Code |
|------|-------------|
| 400 | Internal |
| 401 | Unauthenticated |
| 403 | PermissionDenied |
| 404 | Unimplemented |
| 429 | Unavailable |
| 502/503/504 | Unavailable |

## 100.5 流式帧协议

```
┌─────────────────────────────────────────────┐
│            Connect Stream Frame              │
├──────────┬──────────────────────────────────┤
│ flags(1B)│ length(4B, uint32 big-endian)    │
├──────────┼──────────────────────────────────┤
│ 0x00     │ Data frame (protobuf payload)    │
│ 0x02     │ End-of-stream (JSON: {metadata,  │
│          │   error?})                        │
└──────────┴──────────────────────────────────┘
```

### EndStreamResponse 格式
```json
{
  "metadata": {
    "header-name": ["value1", "value2"]
  },
  "error": {
    "code": "internal",
    "message": "error message",
    "details": [...]
  }
}
```

### endStreamFlag = 0b00000010 (0x02)
- flags=0x00: 数据帧, payload 是 protobuf binary
- flags=0x02: 结束帧, payload 是 JSON EndStreamResponse

## 100.6 Transport 实现

### Unary 调用流程
```
1. serialize(message) → requestBody (protobuf)
2. 如果 size > compressMinBytes → compress + set Content-Encoding
3. 可选: GET 请求转换 (idempotent 方法)
4. POST /ServiceName/MethodName
   Headers: Content-Type: application/proto
            Connect-Protocol-Version: 1
   Body: raw protobuf
5. Response: HTTP 200 + application/proto body
6. 如果 HTTP != 200 → codeFromHttpStatus() 映射错误
```

### Stream 调用流程
```
1. POST /ServiceName/MethodName
   Headers: Content-Type: application/connect+proto
            Connect-Protocol-Version: 1
2. Request body: [5B header + protobuf] × N messages
3. Response: application/connect+proto
   [flags=0x00 + length + protobuf] × N data frames
   [flags=0x02 + length + JSON end-stream]
4. EndStream contains trailer metadata and optional error
```

### URL 格式
```
{baseUrl}/{ServiceName}/{MethodName}

Windsurf 实际 URL 示例:
- http://localhost:PORT/exa.language_server_pb.LanguageServerService/GetChatMessage
- https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage
- https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/GetUserStatus
```

## 100.7 Windsurf 的 ConnectRPC 配置

```javascript
createConnectTransport({
  baseUrl: `http://${address}`,     // localhost:PORT
  useBinaryFormat: true,            // 使用 protobuf (非 JSON)
  httpVersion: "1.1",               // HTTP/1.1 (非 HTTP/2)
  interceptors: [csrfInterceptor]   // CSRF token 注入
})
```

### 关键细节
- **HTTP/1.1**: Windsurf 本地通信使用 HTTP/1.1 (不是 gRPC 的 HTTP/2)
- **Binary format**: 始终使用 protobuf binary (非 JSON)
- **CSRF**: 每个请求注入 `x-codeium-csrf-token` header
- **Interceptor 链**: csrf → auth → retry → 实际调用

---

# 101. 最终逆向总结 — Round 3 完成

## 101.1 Round 3 完整新增 (章节 95-100)

| 章节 | 主题 | 关键发现 |
|------|------|---------|
| 95 | ACP 协议完整逆向 | 27方法, 68 cognition.ai/* 键, 双传输, 会话状态机 |
| 96 | Eval 训练系统 | 12 PromptFormat, A/B 测试, LLM-as-Judge, 6种LS运行模式 |
| 97 | Diff/Analytics/Prompt/Index | 3种Diff, 8个Analytics RPC, 3层Prompt上下文, 5种向量索引 |
| 98 | Round 3 中期总结 | 22 Services, ~686 RPC |
| 99 | Sandbox Runtime | Anthropic 安全沙箱, 21 API, macOS/Linux, 网络+FS隔离 |
| 100 | ConnectRPC 协议 | 16错误码, 帧协议, Content-Type, HTTP/1.1+protobuf |

## 101.2 最终累计统计

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Windsurf 逆向工程 — 最终统计 (Round 3)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  文档章节:         101
  gRPC Services:    22
  RPC Methods:      ~686
  Proto Types:      1943+
  Proto Enums:      226+
  Events/Constants: 429
  ACP Methods:      27 (精确)
  cognition.ai/*:   68 (精确)
  PromptFormat:     12
  HTTP Headers:     138 + Connect 9
  URLs:             72+
  CortexStep Types: 85
  Trajectory Types: 19
  Tool Formatters:  8
  LS Run Modes:     6
  Index Modes:      5
  Diff Types:       3
  Connect Codes:    16
  Sandbox APIs:     21
  Sandbox Files:    9 dangerous
  Sandbox Dirs:     5 dangerous
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 101.3 完整架构概览

```
┌────────────────────────────────────────────────────────────────┐
│                     Windsurf IDE (Electron)                     │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐     │
│  │ extension.js │  │ chat-client  │  │ windsurf-acp     │     │
│  │ 6 gRPC svc   │  │ 14.4MB       │  │ 27 ACP methods   │     │
│  │ 383 RPC      │  │ 1943 types   │  │ 68 meta keys     │     │
│  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘     │
│         │                  │                    │               │
│  ┌──────┴──────────────────┴────────────────────┘              │
│  │                                                              │
│  │  Connect-RPC (HTTP/1.1 + application/proto)                 │
│  │  Connect-Protocol-Version: 1                                 │
│  │  x-codeium-csrf-token: <csrf>                                │
│  │  Stream: 5B frame header (flags + uint32BE length)           │
│  │                                                              │
│  └──────────────────────┬───────────────────────┘              │
│                          │                                      │
│  ┌───────────────────────▼──────────────────────────────┐      │
│  │              Language Server (Go 1.26.1)              │      │
│  │                                                       │      │
│  │  ┌─────────┐ ┌─────────┐ ┌──────────────────────┐   │      │
│  │  │ Cortex  │ │ Context │ │ Eval Pipeline         │   │      │
│  │  │ 85 step │ │ Module  │ │ 12 PromptFormat       │   │      │
│  │  │ 8 plan  │ │ 3-layer │ │ A/B Randomizer        │   │      │
│  │  │ Brain   │ │ prompt  │ │ LLM-as-Judge          │   │      │
│  │  │ CodeMap │ │         │ │ Trajectory Collect     │   │      │
│  │  ├─────────┤ ├─────────┤ ├──────────────────────┤   │      │
│  │  │ Index   │ │ Search  │ │ Analytics             │   │      │
│  │  │ 5 modes │ │ OpenSrc │ │ Raw prompt/response   │   │      │
│  │  │ 23 RPC  │ │ 7 conns │ │ Arena telemetry       │   │      │
│  │  └────┬────┘ └────┬────┘ └──────────┬───────────┘   │      │
│  │       │           │                  │               │      │
│  └───────┼───────────┼──────────────────┼───────────────┘      │
│          │           │                  │                       │
│  ┌───────▼───┐ ┌─────▼────┐ ┌──────────▼───────────┐          │
│  │server.    │ │inference.│ │register.windsurf.com  │          │
│  │codeium.com│ │codeium   │ │server.self-serve.     │          │
│  │API+Chat   │ │.com      │ │windsurf.com           │          │
│  │171 RPC    │ │补全推理   │ │SeatMgmt 151 RPC      │          │
│  └───────────┘ └──────────┘ └───────────────────────┘          │
│                                                                 │
│  ┌──────────────────────────────────────────────────────┐      │
│  │                  ACP Agent Layer                       │      │
│  │  stdio: ndJsonStream (local npx/uvx/binary agents)    │      │
│  │  ws: wss://app.devin.ai/api/acp/live (Devin Cloud)   │      │
│  │  Registry: npx > uvx > binary > websocket             │      │
│  ├──────────────────────────────────────────────────────┤      │
│  │              Sandbox Runtime (Anthropic)               │      │
│  │  macOS: sandbox-exec + seatbelt profiles              │      │
│  │  Linux: bubblewrap + seccomp-bpf + socat              │      │
│  │  Network: HTTP Proxy + SOCKS5 Proxy + Domain Filter   │      │
│  │  FS: denyRead + allowWrite/denyWrite + dangerous list │      │
│  │  Windows: NOT SUPPORTED                                │      │
│  └──────────────────────────────────────────────────────┘      │
└────────────────────────────────────────────────────────────────┘
```

## 101.4 安全发现汇总

1. **沙箱仅限 macOS/Linux**: Windows 用户的 AI agent 命令执行无沙箱保护
2. **训练数据收集**: RecordRawCompletion 收集完整 prompt+response
3. **Devin 深度集成**: ACP WebSocket → `wss://app.devin.ai/api/acp/live`
4. **A/B 测试**: CascadeConfigRandomizer 对 Cascade 行为做随机化实验
5. **CSRF 保护**: 所有本地 Connect-RPC 调用需 `x-codeium-csrf-token`
6. **API Key 暴露**: stdin 传入的 Metadata protobuf 含 api_key (field 3)
7. **Sourcemap 公开**: `cdn.windsurf.com/sourcemaps/` 提供完整 sourcemap

---

# 102. Workbench 深度逆向 — Windsurf 命令系统与 UI 架构

## 102.1 文件概览

```
文件: out/vs/workbench/workbench.desktop.main.js
大小: 31.3 MB (minified, single line)
关键字出现次数:
  windsurf:      2,731
  codeium:       1,939
  cascade:       5,135
  cognition.ai:  374
  devin:         658
  cortex:        1,433
  AcpConnection: 5
```

## 102.2 Windsurf 命令枚举 (132个)

### Cascade 核心 (22个)
| 枚举常量 | 命令 ID |
|---------|---------|
| INITIALIZE_CASCADE | `windsurf.initializeCascade` |
| TRIGGER_CASCADE | `windsurf.triggerCascade` |
| EXECUTE_CASCADE_ACTION | `windsurf.executeCascadeAction` |
| TOGGLE_CHAT_FOCUS | `windsurf.prioritized.chat.open` |
| OPEN_NEW_CASCADE_CONVERSATION | `windsurf.prioritized.chat.openNewConversation` |
| CASCADE_TOGGLE_WRITE_CHAT_MODE | `windsurf.prioritized.chat.toggleWriteChatMode` |
| CASCADE_TOGGLE_MODEL_SELECTOR | `windsurf.cascade.toggleModelSelector` |
| CASCADE_TOGGLE_AGENT_SELECTOR | `windsurf.cascade.toggleAgentSelector` |
| CASCADE_TOGGLE_WORKTREE | `windsurf.cascade.toggleWorktree` |
| CASCADE_SWITCH_TO_NEXT_MODEL | `windsurf.cascade.switchToNextModel` |
| CASCADE_OPEN_AGENT_PICKER | `windsurf.cascade.openAgentPicker` |
| CASCADE_PRESS_MICROPHONE | `windsurf.cascade.pressMicrophone` |
| CASCADE_CHAT_CLIENT_ACCEPT_CASCADE_STEP | `windsurf.cascade.acceptCascadeStep` |
| CASCADE_CHAT_CLIENT_REJECT_CASCADE_STEP | `windsurf.cascade.rejectCascadeStep` |
| RESET_CURRENT_CASCADE_CONVERSATION | `windsurf.cascade.resetCurrentConversation` |
| UPDATE_CONVERSATION_SUMMARIES | `windsurf.updateConversationSummaries` |
| ADD_CURRENT_FILE_TO_CHAT | `windsurf.addCurrentFileToChat` |
| SEND_TEXT_TO_CHAT | `windsurf.sendTextToChat` |
| SEND_TERMINAL_TO_CHAT | `windsurf.sendTerminalToChat` |
| TOGGLE_CHAT_FOCUS_FROM_TERMINAL | `windsurf.prioritized.chat.openFromTerminal` |
| TOGGLE_CHAT_FOCUS_FROM_PROBLEMS_PANEL | `windsurf.prioritized.chat.openFromProblemsPanel` |
| TOGGLE_CHAT_FOCUS_FROM_PROBLEMS_PANEL_FOR_SINGLE_FILE | `windsurf.prioritized.chat.openFromProblemsPanelForSingleFile` |

### DiffZone / 编辑审核 (12个)
| 枚举常量 | 命令 ID |
|---------|---------|
| EDIT_WITH_DIFF_ZONE | `windsurf.editWithDiffZone` |
| OPEN_DIFF_ZONES | `windsurf.openDiffZones` |
| OPEN_DIFF_VIEW | `windsurf.openDiffView` |
| ACCEPT_FOCUSED_DIFFZONE_HUNK | `windsurf.prioritized.cascadeAcceptFocusedHunk` |
| REJECT_FOCUSED_DIFFZONE_HUNK | `windsurf.prioritized.cascadeRejectFocusedHunk` |
| CASCADE_ACCEPT_ALL_IN_FILE | `windsurf.prioritized.cascadeAcceptAllInFile` |
| CASCADE_REJECT_ALL_IN_FILE | `windsurf.prioritized.cascadeRejectAllInFile` |
| CASCADE_NAV_TO_NEXT_HUNK | `windsurf.prioritized.cascadeFocusNextHunk` |
| CASCADE_NAV_TO_PREVIOUS_HUNK | `windsurf.prioritized.cascadeFocusPreviousHunk` |
| CASCADE_NAV_TO_NEXT_FILE | `windsurf.prioritized.cascadeFocusNextFile` |
| CASCADE_NAV_TO_PREVIOUS_FILE | `windsurf.prioritized.cascadeFocusPreviousFile` |
| CAN_ACCEPT_OR_REJECT_FOCUSED_DIFFZONE_HUNK | `windsurf.canAcceptOrRejectFocusedHunk` |

### Vibe & Replace (新功能, 3个)
| 枚举常量 | 命令 ID |
|---------|---------|
| CREATE_VIBE_AND_REPLACE_SESSION | `windsurf.createVibeAndReplaceSession` |
| VIBE_AND_REPLACE | `windsurf.vibeAndReplace` |
| CANCEL_VIBE_AND_REPLACE | `windsurf.cancelVibeAndReplace` |

### Lifeguard 安全 (10个)
| 枚举常量 | 命令 ID |
|---------|---------|
| ATTACH_LIFEGUARD_BUG_TO_CHAT | `windsurf.lifeguard.attachBugToChat` |
| LEARN_FROM_LIFEGUARD_BUG | `windsurf.lifeguard.learnFromBug` |
| (config) | `windsurf.lifeguard.addMemory` |
| (config) | `windsurf.lifeguard.cancelCheck` |
| (config) | `windsurf.lifeguard.editCustomRules` |
| (config) | `windsurf.lifeguard.enable` |
| (config) | `windsurf.lifeguard.getAvailableModes` |
| (config) | `windsurf.lifeguard.mode` |
| (config) | `windsurf.lifeguard.openRules` |
| (config) | `windsurf.lifeguard.runCheck` |

### 终端命令 (6个)
| 枚举常量 | 命令 ID |
|---------|---------|
| TERMINAL_COMMAND_OPEN | `windsurf.prioritized.terminalCommand.open` |
| TERMINAL_COMMAND_ACCEPT | `windsurf.terminalCommand.accept` |
| TERMINAL_COMMAND_REJECT | `windsurf.terminalCommand.reject` |
| TERMINAL_COMMAND_RUN | `windsurf.terminalCommand.run` |
| CAN_TRIGGER_TERMINAL_COMMAND_ACTION | `windsurf.canTriggerTerminalCommandAction` |
| SEND_TERMINAL_TO_CHAT | `windsurf.sendTerminalToChat` |

### MCP 插件 (5个)
| 枚举常量 | 命令 ID |
|---------|---------|
| GET_MCP_CATALOG | `windsurf.getAvailableCascadePlugins` |
| GET_MCP_REGISTRY_SERVERS | `windsurf.getMcpRegistryServers` |
| OPEN_MCP_CONFIG_FILE | `windsurf.openMcpConfigFile` |
| OPEN_MCP_DOCS_PAGE | `windsurf.openMcpDocsPage` |
| REFRESH_MCP_SERVERS | `windsurf.refreshMcpServers` |

### Supercomplete / Tab (5个)
| 枚举常量 | 命令 ID |
|---------|---------|
| ACCEPT_COMPLETION | `windsurf.acceptCompletion` |
| SUPERCOMPLETE_FORCE | `windsurf.forceSupercomplete` |
| SUPERCOMPLETE_ESCAPE | `windsurf.prioritized.supercompleteEscape` |
| TAB_JUMP_ESCAPE | `windsurf.prioritized.tabJumpEscape` |
| TAB_REPORTING | `windsurf.tabReporting` |

### Worktree (4个)
| 枚举常量 | 命令 ID |
|---------|---------|
| CASCADE_TOGGLE_WORKTREE | `windsurf.cascade.toggleWorktree` |
| DELETE_WORKTREE_LANGUAGE_SERVER | `windsurf.deleteWorktreeLanguageServer` |
| START_WORKTREE_LANGUAGE_SERVER | `windsurf.setWorktreeLanguageServer` |
| RENAME_WORKTREE_BRANCH | `windsurf.renameWorktreeBranch` |

### 认证 / 账户 (8个)
| 枚举常量 | 命令 ID |
|---------|---------|
| LOGIN_WITH_REDIRECT | `windsurf.login` |
| LOGIN_WITH_AUTH_TOKEN | `windsurf.loginWithAuthToken` |
| LOGOUT | `windsurf.logout` |
| PROVIDE_AUTH_TOKEN_TO_AUTH_PROVIDER | `windsurf.provideAuthTokenToAuthProvider` |
| IS_LOGGED_IN | `windsurf.isLoggedIn` |
| COPY_API_KEY | `windsurf.copyApiKey` |
| OPEN_BILLING_PAGE | `windsurf.openBillingPage` |
| OPEN_PRICING_PAGE | `windsurf.openPricingPage` |

## 102.3 Windsurf 25 Proposed VS Code APIs

| API 名称 | 功能域 |
|---------|--------|
| `windsurfAcp` | Agent Client Protocol |
| `windsurfAnnotations` | 代码注释/标记 |
| `windsurfAudio` | 语音输入/录音 |
| `windsurfAuth` | 认证系统 |
| `windsurfCascade` | Cascade AI 对话 |
| `windsurfCommandPopup` | 命令弹窗 |
| `windsurfDebug` | 调试信息 |
| `windsurfDevContainers` | 开发容器 |
| `windsurfDiffZone` | 差异编辑区 |
| `windsurfEditorCommandPopup` | 编辑器内命令弹窗 |
| `windsurfEditorNudge` | 编辑器提示 |
| `windsurfExtensionManager` | 扩展管理 |
| `windsurfExtensionMetadata` | 扩展元数据 |
| `windsurfFiles` | 文件操作 |
| `windsurfInlineCompletions` | 行内补全 |
| `windsurfLanguageServer` | 语言服务器 |
| `windsurfMarkers` | 问题标记 |
| `windsurfMcp` | MCP 插件 |
| `windsurfProductEducation` | 产品教育 |
| `windsurfSettings` | 设置管理 |
| `windsurfSideHint` | 侧边提示 |
| `windsurfStatusBar` | 状态栏 |
| `windsurfTabToJump` | Tab 跳转 |
| `windsurfTerminalCommandPopup` | 终端命令弹窗 |
| `windsurfUndoRedo` | 撤销/重做 |

## 102.4 cognition.ai/* 完整键清单 (151个)

### Session 管理 (20个)
```
cognition.ai/session, session-id, sessionIds, sessionArchiving,
sessionLifecycle, sessionListContentSearch, sessionListCreatedAfter,
sessionListRefetch, sessionListUpdatedAfter, sessionOrigin,
sessionPRs, sessionRename, sessionRepos, sessionUnreadTracking,
createdAt, createdAfter, updatedAfter, sortUpdatedAt,
isArchived, archivedStatus
```

### Agent/Tool (18个)
```
action, actions, toolName, toolArgs, inferenceToolName,
command, shellId, target, revert, overwrite, approved,
permissionType, isExitPlan, isPlanImplementationRequest,
isOptimistic, isTyping, agent_stopped,
subagent_started, subagent_completed, subagent_context
```

### Content/Display (16个)
```
content, partialContent, contentsKey, newStringContentsKey,
oldStringContentsKey, inputKey, outputKey, title, summary,
note, error, errorKind, severity, impact, reason, statusMessage
```

### Token/Usage (9个)
```
inputTokens, outputTokens, cachedReadTokens, cachedWriteTokens,
acuUsed, thinkingDurationMs, retryAfterSeconds, queuePosition,
userMessageCount
```

### Secret/Security (6个)
```
secretName, secretNames, secretSend, secretType,
encryptedValue, sensitive
```

### HTTP Upload (4个)
```
httpUpload, httpUploadMaxBytes, httpUploadUrl, pre-uploaded
```

### Resource/File (9个)
```
endLine, hiddenResource, listDirectory, openable,
screenshotKeys, videoPath, cleanVideoUrl,
annotationsAttachmentUuid, recordingId
```

### Devin/ACP 会话 (20个)
```
blueprintId, botUsername, branchName, clientMessageId,
compaction, declarativeSetupEligible, eventId, eventType,
htmlUrl, icon, initiatorLinks, manageIntegrationsUrl,
manageOrgsUrl, noAccessibleOrgs, prDescription, prTitle,
prManagement, pullNumber, repoName, repo, worktreeFor
```

### MCP/Elicitation (10个)
```
mcp, allowOther, otherOptionValue, questions,
availableMentionTypes, original-mention-data,
original-mention-trigger, scope-item-type, saveScope, shouldSave
```

### Skill/Workflow (8个)
```
skillFiles, activityEnum, statusEnum, featured,
hidden, tags, filterName, pageSize, hasNext
```

### 其余 (31个)
```
additionalWorkspaceDirs, after, attachment-id, bundled,
canManageMcpServers, canManageOrgSecrets, creatorUserId,
envVarName, initialRepos, isUnread, maxEmbeddedResourceBytes,
messageSubIndex, multiRootWorkspace, playbookLink, playbookTitle,
promoLabel, promoTooltip, proposedByDevinId, requestId,
requestingTabId, sender, showContentWithExternalLinks, sink,
statusReason, streamingMessageId, timestamp, url, worktreeFor
```

---

# 103. Devin 集成层深度逆向

## 103.1 Devin 内部变量 (18个)

| 变量名 | 说明 |
|--------|------|
| `devin_account_id` | Devin 账户 ID |
| `devin_api_url` | Devin API 服务器 |
| `devin_auth1_token` | Auth1 认证令牌 |
| `devin_cloud_acp_enabled` | 云端 ACP 启用 |
| `devin_exited` | 会话退出状态 |
| `devin_info` | 基本信息 |
| `devin_knowledge` | 知识库 |
| `devin_message` | 消息 |
| `devin_playbooks` | Playbook 列表 |
| `devin_primary_org_id` | 主组织 ID |
| `devin_review_enabled` | 代码审查启用 |
| `devin_session_create` | 创建会话 |
| `devin_session_token` | 会话令牌 |
| `devin_suspended` | 会话暂停 |
| `devin_terminal_acp_enabled` | 终端 ACP 启用 |
| `devin_usage_entries` | 使用量记录 |
| `devin_user_id` | 用户 ID |
| `devin_version` | Devin 版本 |
| `devin_webapp_host` | Web 应用主机 |

## 103.2 Devin 产品变体 (8种)

```
devin-desktop     — 桌面客户端 (Windsurf 内嵌)
devin-cloud       — 云端 ACP (wss://app.devin.ai)
devin-local       — 本地代理
devin-terminal    — 终端集成
devin-cli         — CLI 工具
devin-insiders    — 内测版
devin-next        — 下一代版本
devin-cli-bundling — CLI 打包
```

## 103.3 Devin 服务接口

```
devinService       — 核心 Devin 服务
devinResourceContent — 资源内容提供
devin://           — Devin 协议 URL scheme
devin:///          — Devin 文件系统根
devin-ai-integration[bot] — GitHub bot
```

## 103.4 Devin 企业功能

```
https://*.devinenterprise.com — 企业版域名
https://beta.devinenterprise.com — 企业 Beta
devin_review_enabled — 代码审查
devin_primary_org_id — 组织管理
canManageOrgSecrets — 组织密钥管理
```

---

# 104. URL 端点完整清单 (76 个)

## 104.1 核心服务
| URL | 用途 |
|-----|------|
| `https://server.codeium.com` | API 主服务器 |
| `https://windsurf-next.codeium.com` | Next 版本 |
| `https://unleash.codeium.com/api/frontend` | Feature Flags |
| `https://app.devin.ai` | Devin 云端 |
| `https://app.beta.devin.ai` | Devin Beta |
| `https://beta.devinenterprise.com` | Devin 企业 |

## 104.2 Windsurf Web (15个)
```
https://windsurf.com (主站)
https://windsurf.com/pricing | /changelog | /deploy
https://windsurf.com/leaderboard | /support
https://windsurf.com/editor/releases
https://windsurf.com/subscription/usage | /auto-refill
https://windsurf.com/redirect/windsurf/add-credits
https://windsurf.com/redirect/windsurf/feedback | /settings
https://windsurf.com/redirect/windsurf/update-payment | /upgrade
https://www.windsurf.com/windsurf/signin
```

## 104.3 文档 (7个)
```
https://docs.windsurf.com
https://docs.windsurf.com/windsurf/cascade/mcp | /memories | /workflows
https://docs.windsurf.com/windsurf/cascade/app-deploys
https://docs.windsurf.com/windsurf/models | /spaces
```

## 104.4 Marketplace (3个)
```
https://marketplace.windsurf.com
https://marketplace.windsurf.com/vscode/gallery | /item
```

## 104.5 监控/分析
```
Sentry: https://564eba05...@o4507463137361920.ingest.us.sentry.io/4507737596690432
Status: https://status.windsurf.com/
Agent:  https://agentskills.io/home
Watch:  https://watchdevinwork.com/cascade
```

## 104.6 Proposed API .d.ts (25个)
```
https://raw.githubusercontent.com/microsoft/vscode/main/src/vscode-dts/
  vscode.proposed.windsurfAcp.d.ts
  vscode.proposed.windsurfAnnotations.d.ts
  vscode.proposed.windsurfAudio.d.ts
  ... (共 25 个, 每个对应一个 Proposed API)
```

---

# 105. Sessions 文件逆向

```
文件: out/vs/sessions/sessions.desktop.main.js
大小: 30.2 MB
windsurf.* keys: 232
devin_ keys: 18 (同 workbench)
cognition.ai: 372 次出现
sandbox-runtime: 2 次引用
```

包含完整的 Cascade 会话管理逻辑, 与 workbench 共享大量代码.

---

# 106. Round 4 逆向总结

## 106.1 新增章节

| 章节 | 主题 | 关键发现 |
|------|------|---------|
| 102 | Workbench 命令系统 | 132 命令枚举, 25 Proposed API, 151 cognition.ai 键 |
| 103 | Devin 集成层 | 18 内部变量, 8 产品变体, devin:// 协议 |
| 104 | URL 端点 | 76 精确 URL, Sentry DSN, Unleash, Staging |
| 105 | Sessions | 30.2MB, 232 windsurf keys |

## 106.2 累计统计

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Windsurf 逆向工程 — Round 4 统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  文档章节:           106
  gRPC Services:      22
  RPC Methods:        ~686
  Proto Types:        1943+
  Windsurf Commands:  132 (精确)
  Proposed APIs:      25 (精确)
  cognition.ai/*:     151 (精确)
  windsurf.* keys:    301 (精确)
  devin_ variables:   18 (精确)
  Devin 产品变体:      8
  URL 端点:           76 (精确)
  ACP Methods:        27
  HTTP Headers:       147
  Connect Codes:      16
  Sandbox APIs:       21
  CortexStep Types:   85
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 106.3 Round 4 关键发现

1. **Vibe & Replace**: 新功能 — AI 大规模代码重构 (3 命令)
2. **25 私有 VS Code API**: Windsurf 深度修改 VS Code 内核
3. **Devin 8 种产品变体**: desktop/cloud/local/terminal/cli/insiders/next/bundling
4. **Unleash Feature Flags**: `unleash.codeium.com` 控制功能开关
5. **Staging 暴露**: `codeium-staging-exafunction.vercel.app`
6. **Sentry DSN 硬编码**: 完整错误追踪 DSN
7. **watchdevinwork.com/cascade**: Devin 实时观察页
8. **agentskills.io**: AI agent 能力排行榜

---

# 107. Go Language Server 启动参数完整逆向

## 107.1 LS 命令行参数 (35个)

从 `extension.js` 提取的完整 Go LS binary 启动参数:

### 必需参数
| 参数 | 值来源 | 说明 |
|------|--------|------|
| `--api_server_url` | `A.apiServerUrl` | API 服务器 (server.codeium.com) |
| `--run_child` | 固定 | 作为子进程运行 |
| `--enable_lsp` | 固定 | 启用 LSP 协议 |
| `--extension_server_port` | `A.extensionServerPort` | 扩展服务器端口 |
| `--ide_name` | `getWindsurfIdeName()` | IDE 名称 ("windsurf") |
| `--stdin_initial_metadata` | 固定 | 通过 stdin 接收初始 metadata (protobuf) |

### 端口配置
| 参数 | 说明 |
|------|------|
| `--server_port` | 语言服务器 RPC 端口 (已知端口) |
| `--lsp_port` | LSP 协议端口 |
| `--random_port` | 随机分配端口 (与 server_port 二选一) |

### 索引与搜索
| 参数 | 说明 |
|------|------|
| `--enable_index_service` | 启用代码索引 |
| `--enable_local_search` | 启用本地搜索 |
| `--database_dir` | 数据库路径 (~/.codeium/database/9c0694...) |
| `--search_max_workspace_file_count` | 工作区最大文件数 |
| `--indexed_files_retention_period_days` | 索引文件保留天数 |
| `--use_indexing_v2` | 使用索引 V2 (条件开启) |

### 工作区与会话
| 参数 | 说明 |
|------|------|
| `--workspace_id` | 工作区 ID |
| `--is_secondary` | 是否为次要实例 |
| `--parent_pipe_path` | 父进程管道路径 (IPC) |
| `--windsurf_version` | Windsurf IDE 版本 |

### 目录配置
| 参数 | 说明 |
|------|------|
| `--codeium_dir` | Codeium 数据目录 |
| `--extensions_dir` | 扩展路径 |

### 推理与网络
| 参数 | 说明 |
|------|------|
| `--inference_api_server_url` | 推理 API (inference.codeium.com) |
| `--detect_proxy` | 是否检测代理 |
| `--multitenant_mode` | 多租户模式 (Teams/Enterprise) |
| `--portal_url` | 门户 URL (多租户) |

### 遥测与调试
| 参数 | 说明 |
|------|------|
| `--sentry_telemetry` | 启用 Sentry 遥测 |
| `--sentry_environment` | 环境: development/insider/next/stable |
| `--prerelease_mode` | 预发布模式 (insider/next) |
| `--dev_mode` | 开发模式 |
| `--debug` | 调试模式 |

### 其余
| 参数 | 说明 |
|------|------|
| `--count` | 计数 |
| `--exclude` | 排除模式 |
| `--inspect` | 检查模式 |
| `--short` | 短模式 |
| `--stdio` | 标准IO模式 |
| `--verify` | 验证模式 |

## 107.2 LS 启动完整命令序列

```
language_server_binary \
  --api_server_url "https://server.codeium.com" \
  --run_child \
  --enable_lsp \
  --extension_server_port 12345 \
  --ide_name "windsurf" \
  --random_port \                              # 或 --server_port N --lsp_port M
  --inference_api_server_url "https://inference.codeium.com" \
  --database_dir "~/.codeium/database/9c069456..." \
  --enable_index_service \
  --enable_local_search \
  --search_max_workspace_file_count 5000 \
  --indexed_files_retention_period_days 30 \
  --workspace_id "uuid" \
  --sentry_telemetry \
  --sentry_environment "stable" \
  --codeium_dir "~/.codeium" \
  --extensions_dir "/path/to/extensions" \
  --parent_pipe_path "\\.\pipe\server_abc123" \  # Windows named pipe
  --windsurf_version "2.5.0" \
  --stdin_initial_metadata \
  --detect_proxy=true
```

## 107.3 父进程管道 (IPC)

```javascript
// Windows: \\.\pipe\server_{random_hex}
// Linux/macOS: /tmp/server_{random_hex}
// 用于 extension ↔ LS 之间的 IPC 通信
```

## 107.4 数据库目录

```
~/.codeium/database/9c0694567290725d9dcba14ade58e297/
// 固定 hash, 存储本地索引和搜索数据库
```

---

# 108. LS 环境变量完整清单

## 108.1 Windsurf 特有 (33个)

### 核心运行时
| 变量 | 说明 |
|------|------|
| `CODEIUM_EDITOR_APP_ROOT` | 编辑器应用根目录 |
| `CODEIUM_LANGUAGE_SERVER_BIN` | 自定义 LS binary 路径 |
| `WINDSURF_CSRF_TOKEN` | CSRF 令牌 (注入到 LS) |
| `WINDSURF_IDE_TYPE` | IDE 类型标识 |
| `WINDSURF_SENTRY_SAMPLE_RATE` | Sentry 采样率 |
| `GORACE` | Go race detector (仅 insiders: "halt_on_error=1") |

### 扩展标识
| 变量 | 说明 |
|------|------|
| `CODEIUM_EXT` | Codeium 扩展标识 |
| `CODEIUM_DEV_EXT` | 开发扩展标识 |
| `WINDSURF_EXT` | Windsurf 扩展标识 |
| `WINDSURF_EXTENSIONS` | 已安装扩展 |

### 状态追踪
| 变量 | 说明 |
|------|------|
| `CODEIUM_STATE_UNSPECIFIED` | 状态: 未指定 |
| `CODEIUM_STATE_INACTIVE` | 状态: 未激活 |
| `CODEIUM_STATE_PROCESSING` | 状态: 处理中 |
| `CODEIUM_STATE_SUCCESS` | 状态: 成功 |
| `CODEIUM_STATE_WARNING` | 状态: 警告 |
| `CODEIUM_STATE_ERROR` | 状态: 错误 |

### Cascade 终端
| 变量 | 说明 |
|------|------|
| `WINDSURF_CASCADE_TERMINAL` | Cascade 终端标识 |
| `WINDSURF_CASCADE_TERMINAL_ID` | 终端 ID |
| `WINDSURF_CASCADE_TERMINAL_KIND` | 终端类型 |

### UI 状态
| 变量 | 说明 |
|------|------|
| `WINDSURF_BROWSER` | 浏览器功能 |
| `WINDSURF_BROWSER_TOOLS_ENABLED` | 浏览器工具启用 |
| `WINDSURF_CLICK` | 点击追踪 |
| `WINDSURF_CROSS_SELL` | 交叉销售 |
| `WINDSURF_EDITOR_READY` | 编辑器就绪 |
| `WINDSURF_EXTENSION_ACTIVATED` | 扩展已激活 |
| `WINDSURF_EXTENSION_START` | 扩展启动 |
| `WINDSURF_NUDGE_IMPRESSION` | 提示展示 |
| `WINDSURF_RESEARCH` | 研究模式 |
| `WINDSURF_RESEARCH_THINKING` | 思考过程 |
| `WINDSURF_SETTINGS` | 设置 |
| `WINDSURF_STATUS_BAR_COMMAND` | 状态栏命令 |
| `WINDSURF_STATUS_BAR_TEXT` | 状态栏文本 |

## 108.2 Sentry 环境变量 (9个)
```
SENTRY_DSN, SENTRY_DEBUG, SENTRY_ENVIRONMENT,
SENTRY_RELEASE, SENTRY_NAME, SENTRY_TRACE,
SENTRY_BAGGAGE, SENTRY_SPOTLIGHT,
SENTRY_TRACES_SAMPLE_RATE, SENTRY_USE_ENVIRONMENT
```

## 108.3 调试追踪 (4个)
```
LOG_STREAM, LOG_TOKENS       — 日志控制
TRACING_DUMP, TRACING_DUMP_DIR — 追踪转储
```

---

# 109. Unleash Feature Flags 系统

## 109.1 Unleash 配置

```javascript
{
  url: "https://unleash.codeium.com/api/frontend/",
  clientKey: "*:production.a902e0c159994fded827db0c074d3040b534458b13a8398d745df7d2",
  refreshInterval: 60,  // 每 60 秒刷新
  appName: "chat-client"
}
```

**关键发现**: 生产环境 Unleash API key 硬编码在 workbench 中!

## 109.2 Feature Flags (10个)

| Flag 名称 | 功能 |
|-----------|------|
| `CASCADE_TERMINAL_PROFILE_DEFAULT_ENABLED` | Cascade 终端 profile 默认启用 |
| `codemaps` | CodeMaps 代码地图功能 |
| `devin-cli-bundling` | Devin CLI 打包 |
| `disable-deepwiki` | 禁用 DeepWiki |
| `disable-vibe-and-replace` | 禁用 Vibe & Replace |
| `disable-vibe-and-replace-model-picker` | 禁用 V&R 模型选择 |
| `enable-cascade-review-button` | 启用 Cascade 审查按钮 |
| `enable-pyrefly` | 启用 Pyrefly (Python 类型检查) |
| `enable-rich-plan-editor` | 启用富计划编辑器 |
| `panel` | 面板功能 |

## 109.3 Sentry 环境分类

```
development — 开发环境
insider     — 内测版 (Windsurf Insiders)
next        — 下一代版本 (Windsurf Next)
stable      — 正式版
```

## 109.4 两个 Sentry 项目

| Sentry DSN | 组件 |
|-----------|------|
| `564eba05...@o4507463137361920.ingest.us.sentry.io/4507737596690432` | Workbench (chat-client) |
| `8265dd07...@o4507463137361920.ingest.us.sentry.io/4508180955267072` | Extension (windsurf) |

同一 Sentry Organization (`o4507463137361920`), 两个不同 Project.

---

# 110. 依赖包安全分析

## 110.1 安全相关依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `@pondwader/socks5-server` | 1.0.10 | SOCKS5 代理 (沙箱网络) |
| `@braintree/sanitize-url` | — | URL 净化 (XSS 防护) |
| `@c4312/eventsource-umd` | — | EventSource (SSE) |
| `@antfu/install-pkg` | — | 包安装工具 (MCP 插件) |

## 110.2 Microsoft 遥测

| 包 | 用途 |
|----|------|
| `@microsoft/1ds-core-js` | 1DS 遥测核心 |
| `@microsoft/1ds-post-js` | 1DS 遥测上报 |
| `@microsoft/applicationinsights-core-js` | Application Insights |
| `@microsoft/applicationinsights-shims` | AI 兼容层 |
| `@microsoft/dynamicproto-js` | 动态原型 |

**关键**: Windsurf 保留了 VS Code 的 Microsoft 遥测 + 自有 Sentry, 双重遥测上报.

---

# 111. Round 5 逆向总结

## 111.1 新增章节

| 章节 | 主题 | 关键发现 |
|------|------|---------|
| 107 | Go LS 启动参数 | 35 参数, IPC 管道, 数据库路径 |
| 108 | LS 环境变量 | 33 Windsurf 特有 + 9 Sentry + 4 调试 |
| 109 | Unleash Feature Flags | 10 flags, 生产 API key 暴露, 2 个 Sentry 项目 |
| 110 | 依赖包安全 | SOCKS5, MS 遥测, URL 净化 |

## 111.2 累计统计

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Windsurf 逆向工程 — Round 5 统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  文档章节:           111
  gRPC Services:      22
  RPC Methods:        ~686
  Proto Types:        1943+
  Windsurf Commands:  132
  Proposed APIs:      25
  cognition.ai/*:     151
  windsurf.* keys:    301
  devin_ variables:   18
  LS CLI flags:       35
  LS env vars:        33 + 9 Sentry + 4 debug
  Feature Flags:      10 (Unleash)
  Sentry Projects:    2
  URL 端点:           76
  ACP Methods:        27
  Connect Codes:      16
  Sandbox APIs:       21
  CortexStep Types:   85
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 111.3 Round 5 安全发现

1. **Unleash 生产 API Key 硬编码**: `*:production.a902e0c1...` 可直接调用
2. **双 Sentry 项目暴露**: workbench + extension 两个 DSN
3. **数据库路径固定 Hash**: `9c0694567290725d9dcba14ade58e297` (所有用户相同)
4. **CSRF Token 通过环境变量**: `WINDSURF_CSRF_TOKEN` 注入到 LS 进程
5. **Go Race Detector**: Insiders 版启用 `GORACE=halt_on_error=1`
6. **双重遥测**: Microsoft 1DS + Sentry 同时上报
7. **自定义 LS 路径**: `CODEIUM_LANGUAGE_SERVER_BIN` 可替换 LS binary

---

# 112. Extension.js Proto 类型全景 — 1,736 个定义

## 112.1 18 个 Proto 包分布

| 包名 | 类型数 | 功能域 |
|------|--------|--------|
| `language_server_pb` | 389 | 语言服务器核心 |
| `cortex_pb` | 316 | AI 对话/推理引擎 |
| `codeium_common_pb` | 231 | 通用数据结构 |
| `extension_server_pb` | 109 | Extension ↔ LS IPC |
| `opensearch_clients_pb` | 76 | 知识库/搜索系统 |
| `index_pb` | 72 | 代码索引 |
| `chat_pb` | 44 | 聊天消息 |
| `cascade_plugins_pb` | 35 | MCP 插件 |
| `knowledge_base_pb` | 23 | 知识库 CRUD |
| `context_module_pb` | 20 | 上下文模块 |
| `code_edit` | 19 | 代码编辑/检索 |
| `reactive_component_pb` | 10 | 反应式组件 |
| `diff_action_pb` | 9 | 差异操作 |
| `auto_cascade_common_pb` | 5 | 自动 Cascade |
| `product_analytics_pb` | 4 | 产品分析 |
| `dev_pb` | 4 | 开发工具 |
| `bug_checker_pb` | 2 | Bug 检查 (Lifeguard) |
| `seat_management_pb` | 398 | 账户/团队管理 |
| **总计** | **1,736** | |

## 112.2 369 个 RPC 方法 (从 extension.js)

extension.js 中内联了完整的 Service 定义, 共 **369 个 RPC 方法**, 较此前 proto 文件分析的 ~686 更精确.

### 新发现的 RPC 方法 (精选)

#### Knowledge Base 系统 (企业功能)
```
GetKnowledgeBaseItemsForTeam
CreateConnectionRequest (GitHub/Slack/Jira/Google Drive)
ConnectKnowledgeBaseAccount
DeleteKnowledgeBaseConnection
KnowledgeBaseSearch (HybridSearch, GraphSearch)
IngestGithubData / IngestSlackData / IngestJiraData / IngestGoogleDriveData
```

#### Auto Cascade (自动化)
```
SyncExploreAgentRun
SpawnArenaModeMidConversation
ConvergeArenaCascades
ReplayGroundTruthTrajectory
```

#### Vibe & Replace
```
GenerateVibeAndReplaceStreaming
CancelVibeAndReplace
```

#### Code Maps
```
GenerateCodeMap / LoadCodeMap / SaveCodeMapFromJson
ShareCodeMap / GetSharedCodeMap
BranchCascadeAndGenerateCodeMap
DismissCodeMapSuggestion / GetCodeMapSuggestions
```

#### Lifeguard
```
CheckBugs
GetLifeguardConfig
```

#### 反应式更新 (WebSocket streaming)
```
StreamCascadePanelReactiveUpdates
StreamCascadeReactiveUpdates
StreamCascadeSummariesReactiveUpdates
StreamUserTrajectoryReactiveUpdates
StreamReactiveUpdatesRequest/Response
```

---

# 113. extension_server_pb 完整逆向 (109 类型)

## 113.1 核心 IPC 消息

Extension ↔ LS 通信使用 Connect-RPC over localhost, 以下为完整类型列表:

### 启动/生命周期
```
LanguageServerStartedRequest { language_server_port, lsp_port, chat_client_port, csrf_token }
LanguageServerStartedResponse {}
```

### 编辑器操作 (10个)
```
WriteCascadeEditRequest/Response       — 写入 Cascade 编辑
OpenFilePointerRequest/Response        — 打开文件位置
InsertCodeAtCursorRequest/Response     — 插入代码
OpenDiffZonesRequest/Response          — 打开差异区
OpenMultiDiffRequest/Response          — 多文件差异
UnmountChangesRequest/Response         — 卸载更改
SaveDocumentRequest/Response           — 保存文件
OpenVirtualFileRequest/Response        — 打开虚拟文件
RefreshURIsRequest/Response            — 刷新 URI
```

### 注释系统 (6个)
```
AddAnnotationRequest/Response
RemoveAnnotationRequest/Response
ShowAnnotationRequest/Response
```

### 音频 (4个)
```
StartAudioRecordingRequest/Response
EndAudioRecordingRequest/Response
GetCurrentAudioRecordingRequest { } → { average_volume: float }
```

### 终端 (6个)
```
OpenTerminalRequest/Response
ShowTerminalRequest/Response
ReadTerminalRequest/Response
CheckTerminalShellSupportRequest/Response
```

### 秘密管理 (4个)
```
GetSecretValueRequest/Response
StoreSecretValueRequest/Response
```

### Native Storage (6个)
```
GetNativeValuesRequest/Response
SetNativeValueRequest/Response
ClearNativeValueRequest/Response
SubscribeNativeValuesRequest/Response  — 实时订阅值变化
```

### MCP (4个)
```
NotifyMcpStateChangedRequest/Response
OpenConfigurePluginsPageRequest/Response
```

### Vibe & Replace (2个)
```
CancelVibeAndReplaceRequest/Response
```

### 认证/设置 (4个)
```
GetRedirectUriRequest/Response
LogoutWindsurfRequest/Response
OpenSettingRequest/Response
```

### 搜索/查找 (4个)
```
SearchQueryRequest/Response
FindAllReferencesRequest/Response
```

### Lint/Bug (8个)
```
GetLintErrorsRequest { AwaitNewLintsConfig } / Response
GetLintsForAcknowledgerRequest/Response
WatchForLintsRequest/Response
```

### 其余
```
ExecuteCommandRequest                  — 执行 VS Code 命令
HandleAsyncPostMessageRequest/Response — 异步消息
CheckExperimentRequest/Response        — 检查 A/B 实验
LogEventRequest/Response               — 日志事件
LoadCodeMapRequest/Response            — 加载代码地图
UpdateCascadeTrajectorySummariesRequest/Response
OpenConversationWorkspaceQuickPickRequest/Response
OpenWindsurfRulesFileRequest/Response
DeleteWindsurfRulesFileRequest/Response
DeleteWindsurfWorkflowRequest/Response
OpenExternalUrlRequest/Response
```

---

# 114. OpenSearch Knowledge Base 系统 (76 类型)

## 114.1 概述

Windsurf 集成了完整的企业知识库系统, 支持 4 种外部数据源:

| 数据源 | Connector | Ingest | Internal Config |
|--------|-----------|--------|-----------------|
| **GitHub** | `ConnectorConfigGithub` | `IngestGithubData` | `ConnectorInternalConfigGithub` |
| **Slack** | `ConnectorConfigSlack` | `IngestSlackData` | `ConnectorInternalConfigSlack` |
| **Jira** | `ConnectorConfigJira` | `IngestJiraData` | `ConnectorInternalConfigJira` |
| **Google Drive** | `ConnectorConfigGoogleDrive` | `IngestGoogleDriveData` | `ConnectorInternalConfigGoogleDrive` |

## 114.2 搜索 API

```
HybridSearchRequest/Response     — 混合搜索 (关键词+向量)
GraphSearchRequest/Response      — 图搜索
KnowledgeBaseSearchRequest/Response — 知识库搜索
QuerySearchResponse              — 查询搜索结果
```

## 114.3 文档管理

```
CommonDocument / CommonDocumentWithScore
DocumentTypeCount
OpenSearchAddRepository / GetIndex
ForwardSlackPayload / IngestSlackPayload / IngestJiraPayload
```

## 114.4 连接器生命周期

```
ConnectKnowledgeBaseAccount → 连接账户
GetKnowledgeBaseConnectorState → 状态查询
CancelKnowledgeBaseJobs → 取消任务
DeleteKnowledgeBaseConnection → 删除连接
GetKnowledgeBaseWebhookUrl → Webhook URL
```

---

# 115. cortex.proto 后段未文档化消息 (line 2400-3071)

## 115.1 新发现的 CortexStep 类型 (CortexStep 总计 91 个)

| 消息 | 功能 |
|------|------|
| `CortexStepClipboard` | 剪贴板操作 |
| `CortexStepLintDiff` | Lint 差异 |
| `CortexStepBrainUpdate` | Brain 系统更新 (plan/task) |
| `CortexStepAddAnnotation` | 添加注释 |
| `CortexStepCommandStatus` | 命令执行状态 |
| `CortexStepMemory` | 记忆操作 (create/update/delete) |
| `CortexStepRetrieveMemory` | 检索记忆 |
| `CortexStepCustomTool` | 自定义工具 |
| `CortexStepAutoCascadeBroadcast` | Auto Cascade 广播 |
| `CortexStepPostPrReview` | PR 代码审查 |
| `CortexStepMcpTool` | MCP 工具调用 |
| `CortexStepListResources` | 列出 MCP 资源 |
| `CortexStepReadResource` | 读取 MCP 资源 |
| `CortexStepArtifactSummary` | 制品摘要 |
| `CortexStepManagerFeedback` | 管理者反馈 |
| `CortexStepToolCallProposal` | 工具调用提案 |
| `CortexStepToolCallChoice` | 工具调用选择 |
| `CortexStepTrajectoryChoice` | 轨迹选择 |
| `CortexStepCreateRecipe` | 创建自定义工具配方 |
| `CortexStepProxyWebServer` | 代理 Web 服务器 |
| `CortexStepViewFileOutline` | 文件大纲视图 |
| `CortexStepTodoList` | 待办列表 |
| `CortexStepCodeMap` | 代码地图 |
| `CortexStepEditCodeMap` | 编辑代码地图 |
| `CortexStepFindAllReferences` | 查找所有引用 |
| `CortexStepRunExtensionCode` | 运行扩展代码 |
| `CortexStepProposalFeedback` | 提案反馈 |
| `CortexStepTrajectorySearch` | 轨迹搜索 |
| `CortexStepReadTerminal` | 读取终端 |
| `CortexStepDeepThink` | 深度思考 |
| `CortexStepSuggestCodemap` | 建议代码地图 |
| `CortexStepReportBugs` | Lifeguard Bug 报告 |
| `CortexStepUpsertCodemap` | 创建/更新代码地图 |
| `CortexStepResolveTask` | 解决任务 |
| `CortexStepExitPlanMode` | 退出计划模式 |
| `CortexStepSkill` | 技能 |

## 115.2 Brain 系统 (计划/任务管理)

```
BrainEntry { id, type(BrainEntryType), content }
BrainEntryDelta { before, after, absolute_path_uri, summary }
BrainEntryDeltaSummary { plan | task }
PlanEntryDeltaSummary { items_added, items_completed }
TaskItem { id, content, status(TaskStatus), parent_id, prev_sibling_id }
TaskDelta { type, id, content, status, parent/sibling 移动 }
TaskEntryDeltaSummary { deltas, items_added/pruned/deleted/updated/moved }
CortexStepBrainUpdate { entry_type, trigger, deltas }
```

## 115.3 Cascade Hook 系统 (事件钩子)

```
HookCondition { agent_actions[] }
CommandHookSpec { command, working_directory, show_output, powershell_command }
HookExecutionSpec { command_hook }
CommandHookResult { exit_code, stdout, stderr }
HookExecutionResult { command_result }
CascadeHook { hook_spec, condition, workspace_dirs }
HookExecutionDetail { spec, result }
```

## 115.4 记忆系统完整结构

```
CortexMemory { text_memory, memory_id, title, metadata, source, scope }
CortexMemoryScope:
  - GlobalScope (全局)
  - LocalScope { corpus_names, base_dir_uris, repo_base_dir_uri }
  - ProjectScope { file_path, base_dir_uris, globs, trigger, rule_source }
  - AllScope (所有)
  - SystemScope (系统)
MemoryConfig { model, num_memories_to_consider, max_global_cascade_memories, ... }
```

## 115.5 Lifeguard Bug 检测

```
LifeguardBug {
  id, file, start, end, title, description,
  severity, resolution,
  fix_old_str, fix_new_str  — 自动修复建议
}
CortexStepReportBugs { bugs[] }
```

---

# 116. Round 5 补充总结

## 116.1 补充章节

| 章节 | 主题 | 关键发现 |
|------|------|---------|
| 112 | Extension Proto 全景 | 1,736 类型, 18 包, 369 RPC |
| 113 | extension_server_pb | 109 IPC 类型, 完整 Extension↔LS 通信 |
| 114 | OpenSearch 知识库 | 76 类型, GitHub/Slack/Jira/GDrive 集成 |
| 115 | cortex.proto 后段 | 91 CortexStep, Brain 系统, Hook, Memory, Lifeguard |

## 116.2 最终统计

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Windsurf 逆向工程 — Round 5 完整统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  文档章节:           116
  Proto Types:        1,736 (精确, 18包)
  RPC Methods:        369 (精确, extension.js)
  CortexStep Types:   91 (精确)
  Windsurf Commands:  132
  Proposed APIs:      25
  cognition.ai/*:     151
  windsurf.* keys:    301
  LS CLI flags:       35
  LS env vars:        46 (33+9+4)
  Feature Flags:      10
  Sentry Projects:    2
  URL 端点:           76
  ACP Methods:        27
  Knowledge Base:     4 数据源 (GitHub/Slack/Jira/GDrive)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 116.3 Round 5 全部安全发现

1. **Unleash 生产 API Key**: `*:production.a902e0c1...` 硬编码
2. **双 Sentry DSN**: workbench + extension 两个项目 ID
3. **数据库路径固定 Hash**: `9c0694567290725d9dcba14ade58e297`
4. **CSRF Token 环境注入**: `WINDSURF_CSRF_TOKEN`
5. **自定义 LS 路径**: `CODEIUM_LANGUAGE_SERVER_BIN` 可劫持
6. **双重遥测**: Microsoft 1DS + Sentry
7. **LifeguardBug 自动修复**: `fix_old_str/fix_new_str` 可操纵
8. **CortexStepRunExtensionCode**: 可执行任意扩展代码
9. **Knowledge Base Webhooks**: 外部数据源 webhook URL 暴露
10. **CortexStepProxyWebServer**: 内建 Web 代理功能

---

# 117. product.json 完整逆向 (1,341 行)

## 117.1 Windsurf 身份标识

```json
{
  "nameShort": "Windsurf - Next",
  "applicationName": "windsurf-next",
  "aliasName": "surf-next",
  "dataFolderName": ".windsurf-next",
  "serverApplicationName": "windsurf-server-next",
  "tunnelApplicationName": "windsurf-tunnel",
  "urlProtocol": "windsurf-next",
  "darwinBundleIdentifier": "com.exafunction.windsurfNext",
  "win32AppUserModelId": "Exafunction.WindsurfNext",
  "quality": "next",
  "version": "1.110.1-next",
  "codeiumVersion": "1.48.2",
  "windsurfVersion": "2.2.1017+next.a65d6c4e1f",
  "codeiumCommit": "a65d6c4e1fd335336d7a0b601099811667e184ca"
}
```

## 117.2 硬编码 API Keys

| Key | 值 | 用途 |
|-----|-----|------|
| **Zendesk Ticket API Key** | `1d83db0009861157cacd3279a927855f53279e48c84bd26d2ba48d241699773d` | 客服工单系统 |
| **Unleash Client Key** | `*:production.a902e0c159994fded827db0c074d3040b534458b13a8398d745df7d2` | Feature Flags |
| **Sentry DSN (workbench)** | `564eba05...@o4507463137361920/4507737596690432` | 错误追踪 |
| **Sentry DSN (extension)** | `8265dd07...@o4507463137361920/4508180955267072` | 错误追踪 |

## 117.3 Marketplace 配置

```json
{
  "extensionsGallery": {
    "serviceUrl": "https://marketplace.windsurf.com/vscode/gallery",
    "itemUrl": "https://marketplace.windsurf.com/vscode/item"
  },
  "chatParticipantRegistry": "https://main.vscode-cdn.net/extensions/chat.json",
  "updateUrl": "https://windsurf-next.codeium.com"
}
```

## 117.4 Trust Domain (安全边界)

```json
"linkProtectionTrustedDomains": [
  "https://*.codeium.com",
  "https://*.windsurf.com",
  "https://windsurf.com",
  "https://codeium-staging-exafunction.vercel.app",
  "https://staging.itsdev.in",
  "https://app.devin.ai",
  "https://app.beta.devin.ai",
  "https://*.devinenterprise.com",
  "https://beta.devinenterprise.com"
]
```

**新发现**: `staging.itsdev.in` — Devin 内部 staging 域名首次出现!

## 117.5 认证 Trust 链

```json
"trustedExtensionAuthAccess": {
  "windsurf_auth": ["codeium.windsurf"]
}
"trustedExtensionProtocolHandlers": [
  "vscode.git",
  "vscode.github-authentication",
  "vscode.microsoft-authentication",
  "codeium.windsurf"
]
"verifiedExtensionPublishers": { "codeium": "https://windsurf.com" }
```

## 117.6 Tunnel Server (远程开发)

```json
"tunnelServerQualities": {
  "stable":  { "serverApplicationName": "windsurf-server" },
  "next":    { "serverApplicationName": "windsurf-server-next" },
  "insider": { "serverApplicationName": "windsurf-server-insiders" }
}
```

## 117.7 文件完整性校验 (checksums)

product.json 包含 10 个关键文件的 Base64 SHA 校验:
```
preload.js, workbench.desktop.main.js, workbench.desktop.main.css,
extensionHostProcess.js, workbench.html, workbench.js,
sessions.desktop.main.js, sessions.desktop.main.css,
sessions.html, sessions.js
```

## 117.8 Copilot 残留配置

Windsurf 保留了完整的 VS Code `defaultChatAgent` GitHub Copilot 配置:
- `extensionId: "GitHub.copilot"`
- Copilot scope: `["read:user", "user:email", "repo", "workflow"]`
- 但被 `codeium.windsurf` 覆盖

## 117.9 codeium.windsurfpyright

```json
"languageExtensionTips": [..., "codeium.windsurfpyright", ...]
```
Windsurf 有自己的 Python 类型检查器 fork: **windsurfpyright**.

---

# 118. Electron main.js 逆向 (1.1MB)

## 118.1 Windsurf Main Process 服务

| 服务 ID | 功能 |
|---------|------|
| `windsurf.languageServerService` | LS 服务 (渲染进程) |
| `windsurf.languageServerMainService` | LS 主进程服务 (IPC) |
| `windsurfWindowsMainManager` | Windows 窗口管理器 (主) |
| `windsurfWindowsManager` | 窗口管理器 |
| `windsurfKeybindingMainService` | 键绑定服务 (主进程) |

## 118.2 Windsurf 自定义图标 (10个)

Windsurf 在 Codicon 基础上注册了自定义图标:

| 图标名 | 代码点 | 用途 |
|--------|--------|------|
| `cascade` | 63742 | Cascade AI 对话 |
| `cascade-browser` | 63743 | Cascade 浏览器 |
| `deepwiki` | 63744 | DeepWiki 知识 |
| `ask` | 60544 | 提问 |
| `openai` | 60545 | OpenAI 模型 |
| `claude` | 60546 | Claude 模型 |
| `open-in-window` | 60547 | 在窗口打开 |
| `new-session` | 60548 | 新会话 |
| `worktree` | 60542 | 工作树 |
| `worktree-small` | 60541 | 工作树(小) |
| `screen-cut` | 60543 | 截屏 |
| `remove-small` | 60540 | 移除(小) |

## 118.3 main.js 中的 214 个 URL

从 main.js 提取的关键 URL:
- `https://windsurf-next.codeium.com` — 更新服务器
- `https://codeium.com/windsurf/update_linux` — Linux 更新
- `https://cdn.windsurf.com/sourcemaps/.../core/main.js.map` — 主进程 sourcemap
- `https://marketplace.windsurf.com/vscode/gallery` — Marketplace
- `https://app.devin.ai` / `https://app.beta.devin.ai` — Devin
- `https://beta.devinenterprise.com` — Devin Enterprise Beta
- `https://codeium-staging-exafunction.vercel.app` — Staging

---

# 119. Native 模块清单 (19个 .node)

## 119.1 @vscode 系列 (10个)

| 模块 | 功能 |
|------|------|
| `@parcel/watcher` | 文件系统监视 |
| `@vscode/deviceid` | 设备 ID (遥测) |
| `@vscode/native-watchdog` | 进程看门狗 |
| `@vscode/policy-watcher` | 组策略监视 |
| `@vscode/spdlog` | 高速日志 |
| `@vscode/sqlite3` | SQLite 数据库 |
| `@vscode/windows-ca-certs` | Windows CA 证书 |
| `@vscode/windows-mutex` | 进程互斥 |
| `@vscode/windows-process-tree` | 进程树 |
| `@vscode/windows-registry` | Windows 注册表 |

## 119.2 功能模块 (9个)

| 模块 | 功能 |
|------|------|
| `kerberos` | Kerberos 认证 (SSO/Enterprise) |
| `native-is-elevated` | 提权检测 |
| `native-keymap` | 键盘布局映射 |
| `node-pty` (conpty + conpty_console_list) | 终端仿真 |
| `windows-foreground-love` | 窗口前台控制 |
| `msal-node-runtime` | Microsoft 认证 (MSAL) |

## 119.3 WASM 模块 (11个)

| 模块 | 功能 |
|------|------|
| `tree-sitter.wasm` | Tree-sitter 解析器引擎 |
| `tree-sitter-typescript.wasm` | TypeScript 语法 |
| `tree-sitter-bash.wasm` | Bash 语法 |
| `tree-sitter-css.wasm` | CSS 语法 |
| `tree-sitter-ini.wasm` | INI 语法 |
| `tree-sitter-powershell.wasm` | PowerShell 语法 |
| `tree-sitter-regex.wasm` | 正则表达式语法 |
| `onig.wasm` | Oniguruma 正则引擎 (TextMate) |
| `chromehash_bg.wasm` | Chrome hash (JS debug) |
| `*.module.wasm` (×2) | 性能分析 |

---

# 120. 剩余黑盒评估 + Round 6 总结

## 120.1 已完全分析的组件

| 组件 | 状态 |
|------|------|
| product.json | ✅ 全部 1,341 行 |
| extension.js | ✅ 1,736 proto types, 369 RPC |
| workbench.desktop.main.js | ✅ 31.3MB |
| sessions.desktop.main.js | ✅ 30.2MB |
| main.js (Electron 主进程) | ✅ 1.1MB |
| cli.js | ✅ 262KB |
| 全部 proto 文件 | ✅ |
| @exa 私有包 | ✅ |
| @anthropic-ai/sandbox-runtime | ✅ |
| @connectrpc/connect | ✅ |
| cortex.proto 完整 (3071 行) | ✅ |
| Native modules (.node) | ✅ 19 个已枚举 |
| WASM modules | ✅ 11 个已枚举 |
| node_modules 第三方包 | ✅ |

## 120.2 不可静态分析的组件 (Go Binary)

| 组件 | 原因 |
|------|------|
| `language_server_*` (Go binary) | 编译二进制, 需 IDA/Ghidra |
| WASM 内部逻辑 | 需 WASM 反编译 |
| Native .node 模块内部逻辑 | 需 C++ 反编译 |
| Electron V8 快照 | 启动优化, 二进制 blob |

## 120.3 最终统计

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Windsurf 逆向工程 — Round 6 最终统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  文档章节:               120
  Proto Types:            1,736 (精确, 18包)
  RPC Methods:            369 (精确)
  CortexStep Types:       91
  Windsurf Commands:      132
  Proposed APIs:          25
  cognition.ai/* keys:    151
  windsurf.* keys:        301
  LS CLI flags:           35
  LS env vars:            46
  Feature Flags:          10
  Sentry Projects:        2
  URL 端点:               76+214 (main.js)
  ACP Methods:            27
  Knowledge Base Sources: 4
  Native Modules:         19 (.node)
  WASM Modules:           11
  Hardcoded API Keys:     4 (Zendesk, Unleash, 2×Sentry)
  Custom Icons:           12
  Trusted Domains:        12
  Tunnel Server Variants: 3
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 120.4 Round 6 关键安全发现

1. **Zendesk API Key 硬编码**: `1d83db00...` 可直接创建客服工单
2. **staging.itsdev.in**: Devin 内部 staging 域名首次曝光
3. **beta.devinenterprise.com**: Enterprise Beta 端点
4. **windsurf-next.codeium.com**: Next 版本更新服务器
5. **文件完整性校验**: product.json 含 10 个文件 SHA, 可用于检测篡改
6. **Copilot 残留**: 完整 GitHub Copilot 配置保留在 product.json
7. **MSAL 认证**: 内置 Microsoft 身份认证 (Kerberos + MSAL)
8. **SQLite 数据库**: 本地数据存储 (@vscode/sqlite3)
9. **设备 ID 指纹**: @vscode/deviceid 用于遥测追踪

## 120.5 黑盒静态分析完成度: ~95%

所有可通过静态文本分析的 JavaScript/JSON/Proto 文件已全部覆盖。
剩余 ~5% 为编译二进制 (Go LS, .node, .wasm), 需要二进制逆向工具。

---

# 121. impersonate_tier — Tier 伪装机制

## 121.1 配置入口

```
VS Code Setting: codeiumDev.impersonateTier
Proto Field:     exa.codeium_common_pb.Metadata.impersonate_tier (field 29, string)
默认值:          "" (空字符串)
```

## 121.2 数据流

```
codeiumDev.impersonateTier (settings.json)
  → getConfig(Config.IMPERSONATE_TIER)
  → MetadataProvider.getMetadata()
  → metadata.impersonateTier = "TEAMS_TIER_DEVIN_PRO"
  → 每个 RPC 请求 → LS → API Server
```

extension.js 关键代码:
```javascript
impersonateTier: (0, E.getConfig)(E.Config.IMPERSONATE_TIER)
// Config.IMPERSONATE_TIER = "codeiumDev.impersonateTier"
```

## 121.3 TeamsTier 枚举 (21个值)

```protobuf
enum TeamsTier {
  TEAMS_TIER_UNSPECIFIED = 0;
  TEAMS_TIER_TEAMS = 1;
  TEAMS_TIER_PRO = 2;
  TEAMS_TIER_TRIAL = 9;
  TEAMS_TIER_ENTERPRISE_SAAS = 3;
  TEAMS_TIER_HYBRID = 4;
  TEAMS_TIER_ENTERPRISE_SELF_HOSTED = 5;
  TEAMS_TIER_ENTERPRISE_SELF_SERVE = 10;
  TEAMS_TIER_DEVIN_ENTERPRISE = 12;
  TEAMS_TIER_DEVIN_TEAMS = 14;
  TEAMS_TIER_DEVIN_TEAMS_V2 = 15;
  TEAMS_TIER_DEVIN_PRO = 16;      // ← 目标
  TEAMS_TIER_DEVIN_MAX = 17;
  TEAMS_TIER_MAX = 18;
  TEAMS_TIER_DEVIN_FREE = 19;
  TEAMS_TIER_DEVIN_TRIAL = 20;    // ← 当前
  TEAMS_TIER_WAITLIST_PRO = 6;
  TEAMS_TIER_TEAMS_ULTIMATE = 7;
  TEAMS_TIER_PRO_ULTIMATE = 8;
  TEAMS_TIER_ENTERPRISE_SAAS_POOLED = 11;
}
```

## 121.4 codeiumDev 完整配置项 (9个开发者设置)

| Setting | 类型 | 默认值 | 用途 |
|---------|------|--------|------|
| `codeiumDev.impersonateTier` | string | `""` | Tier 伪装 |
| `codeiumDev.externalLanguageServerAddress` | string | `""` | 外部 LS 地址 |
| `codeiumDev.externalLanguageServerLspPort` | string | `""` | 外部 LS LSP 端口 |
| `codeiumDev.languageServerBinaryPath` | string | `""` | 自定义 LS 二进制路径 |
| `codeiumDev.languageServerEnv` | object | `{}` | LS 环境变量 |
| `codeiumDev.forceEnableExperiments` | string | `""` | 强制开启实验 |
| `codeiumDev.forceDisableExperiments` | string | `""` | 强制关闭实验 |
| `codeiumDev.forceEnableExperimentsWithVariants` | array | `[]` | 带变体的实验 |
| `codeiumDev.website` | string | `"https://windsurf.com"` | 网站 URL |

---

# 122. API 服务器区域分布 (新发现)

## 122.1 区域配置映射

extension.js 内含 5 套 API 服务器配置:

| 区域 | API_SERVER_URL | INFERENCE_URL | WEBSITE |
|------|---------------|---------------|---------|
| **默认** | `server.codeium.com` | `inference.codeium.com` | `windsurf.com` |
| **EU** | `eu.windsurf.com/_route/api_server` | `eu.windsurf.com/_route/api_server` | `eu.windsurf.com` |
| **FedStart** | `windsurf.fedstart.com/_route/api_server` | `windsurf.fedstart.com/_route/api_server` | `windsurf.fedstart.com` |
| **Secure** | 动态 (portalUrl) | 动态 | 动态 |
| **Staging** | `server-staging.codeium.com` | (默认) | `codeium-staging-exafunction.vercel.app` |

## 122.2 区域选择逻辑

```javascript
// 优先级: Secure > EU > Fed > Internal > Default
if (isWindsurfSecure()) return secureConfig;
if (isWindsurfEU()) return EU_Config;
if (isWindsurfFed()) return FedConfig;
if (isInternal()) return StagingConfig;
return DefaultConfig;
```

## 122.3 Multi-Tenant Mode

EU 和 FedStart 区域启用 `MULTI_TENANT_MODE=true`，默认区域为 `false`。
这意味着 EU/Fed 使用统一入口 `/_route/api_server` 路由，而默认区域直连。

## 122.4 新域名发现

- `eu.windsurf.com` — EU 数据主权合规入口
- `windsurf.fedstart.com` — FedRAMP/政府合规入口
- `server-staging.codeium.com` — 内部 staging 服务器

## 122.5 Register 服务器

```javascript
DEFAULT_API_SERVER_URL = "https://server.codeium.com"
DEFAULT_REGISTER_API_SERVER_URL = "https://register.windsurf.com"
```

---

# 123. ACP (Agent Compute Platform) — Devin Cloud 集成

## 123.1 ACP 架构概述

sessions.desktop.main.js 内发现完整的 ACP (Agent Compute Platform) 系统，
这是 Windsurf 与 Devin Cloud 的深度集成层。

ACP Redux Store 初始状态:
```javascript
{
  sessions: [],
  enabledAgents: [],
  preferredAgent: null,
  clientRequests: {},
  agentRequests: {},
  pendingConfigValues: {},
  focusedSessionId: null,
  visibleSessionIds: [],
  devinCloudNoOrgAccess: false,
  devinCloudManageOrgsUrl: null,
  workspaceFolders: [],
  homeDir: "",
  savedDiffZoneStates: {}
}
```

## 123.2 ACP 状态键 (38+)

| 键 | 说明 |
|-----|------|
| `acp.enabled` | ACP 总开关 |
| `acp.hasActiveConnector` | 是否有活跃连接器 |
| `acp.enabledAgents` | 启用的 Agent 列表 |
| `acp.preferredAgent` | 首选 Agent |
| `acp.sessions` | 所有 ACP 会话 |
| `acp.focusedSessionId` | 当前焦点会话 |
| `acp.agentRequests` | Agent 请求队列 |
| `acp.clientRequests` | 客户端请求队列 |
| `acp.diffZonesEnabled` | Diff 区域开关 |
| `acp.devinCloudManageOrgsUrl` | Devin Cloud 组织管理 URL |
| `acp.devinCloudNoOrgAccess` | 是否无组织访问权限 |
| `acp.workspaceFolders` | 工作区文件夹 |
| `acp.homeDir` | 主目录 |
| `acp.pendingConfigValues.devin_version` | Devin 版本选择 |
| `acp.pendingConfigValues.mode` | 模式 |
| `acp.pendingConfigValues.persona_slug` | 人设 slug |
| `acp.pendingConfigValues.repos` | 仓库列表 |
| `acp.pendingConfigValues.use_devin_rs` | 使用 Devin RS |

## 123.3 ACP 事件

- `ACP_MESSAGE_QUEUED` — 消息入队
- `ACP_MESSAGE_SENT` — 消息已发送
- `ACP_SESSION_LOAD_REQUESTED` — 会话加载请求
- `ACP_SESSION_NEW_REQUESTED` — 新会话请求
- `ACP_SESSION_PROMPT_SEND_FAILED` — 提示发送失败

## 123.4 Devin API 端点 (30+)

从 sessions.desktop.main.js 提取的 Devin Cloud API 方法:

| API 方法 | 功能 |
|----------|------|
| `devin_auth` | Devin 认证 |
| `devin_session_create` | 创建会话 |
| `devin_session_events` | 会话事件流 |
| `devin_session_interact` | 会话交互 |
| `devin_session_search` | 会话搜索 |
| `devin_session_gather` | 会话聚合 |
| `devin_session_batch` | 批量会话 |
| `devin_session_token` | 会话 Token |
| `devin_sessions` | 会话列表 |
| `devin_cli` | CLI 操作 |
| `devin_code` | 代码操作 |
| `devin_docs` | 文档 |
| `devin_info` | 信息查询 |
| `devin_knowledge` | 知识库 |
| `devin_knowledge_manage` | 知识库管理 |
| `devin_message` | 消息 |
| `devin_playbooks` | Playbook 列表 |
| `devin_playbook_manage` | Playbook 管理 |
| `devin_review` | 代码审查 |
| `devin_review_enabled` | 审查开关 |
| `devin_secrets` | 密钥管理 |
| `devin_schedule_manage` | 定时任务管理 |
| `devin_org_analytics` | 组织分析 |
| `devin_usage_entries` | 用量条目 |
| `devin_suspended` | 挂起状态 |
| `devin_exited` | 退出状态 |
| `devin_terminal_acp_enabled` | 终端 ACP 开关 |
| `devin_cloud_acp_enabled` | 云端 ACP 开关 |
| `devin_cloud_permission` | 云端权限 |

## 123.5 Devin 配置选项

```javascript
configOptions: [
  { id: "use_devin_rs", type: "boolean" },    // 使用 Devin RS (Rust 版本?)
  { id: "devin_version", type: "select" },    // 版本选择 (下拉)
  { id: "persona_slug", type: "select" },     // 人设选择 (下拉)
  { id: "repos", type: "..." },               // 仓库选择
  { id: "mode", type: "..." }                 // 模式选择
]
```

## 123.6 Agent Window 系统

Windsurf 内建独立 Agent Window (非标准编辑器窗口):

| 组件 | 说明 |
|------|------|
| `AgentWindowSession` | Agent 窗口会话 |
| `AgentWindowWelcome` | 欢迎页面 |
| `AgentWindowToNormalMode` | 切回普通模式 |
| `agentWindow.openDesktop` | 打开桌面视图 |
| `agentWindow.openShell` | 打开 Shell 视图 |
| `agentWindow.viewSpaceDiffs` | 查看 Space Diffs |
| `agentWindow.tryOpenGitHubPullRequestInExtension` | 打开 GitHub PR |

---

# 124. Worktree 系统

## 124.1 概述

Windsurf 扩展了 Git Worktree 概念，每个 Cascade 会话可关联独立 worktree:

## 124.2 Worktree Proto 消息 (12+)

| 消息 | 说明 |
|------|------|
| `WorktreeRequest` | 创建 worktree 请求 |
| `WorktreeResponse` | 创建响应 |
| `WorktreeChanges` | worktree 变更 |
| `WorktreeChangesRequest/Response` | 变更查询 |
| `WorktreeMerge` | worktree 合并 |
| `WorktreeMergeRequest/Response` | 合并请求 |
| `WorktreeMergeSnapshot` | 合并快照 |
| `WorktreeInfo` | worktree 信息 |
| `WorktreeFiles` | 文件列表 |
| `WorktreePaths` | 路径列表 |
| `WorktreeLanguageServerInfo` | 关联 LS 信息 |
| `WorktreeForSpace` | Space 关联的 worktree |

## 124.3 Worktree 命令

```
windsurf.cascade.toggleWorktree    — 切换 worktree
windsurf.deleteWorktreeLanguageServer — 删除 worktree LS
windsurf.setWorktreeLanguageServer — 设置 worktree LS
windsurf.renameWorktreeBranch      — 重命名 worktree 分支
windsurf.setWorkspaceCascadeMap    — 设置工作区 Cascade 映射
```

---

# 125. sessions.desktop.main.js 完整命令枚举 (231个)

## 125.1 认证 & 账户 (12)

```
windsurf.login
windsurf.loginWithAuthToken
windsurf.logout
windsurf.provideAuthTokenToAuthProvider
windsurf.cancelLogin
windsurf.SignInToWindsurf
windsurf.openProfile
windsurf.openBillingPage
windsurf.openAutoRefillPage
windsurf.openPricingPage
windsurf.openReferralLink
windsurf.copyApiKey
```

## 125.2 Cascade 核心 (20)

```
windsurf.triggerCascade
windsurf.executeCascadeAction
windsurf.initializeCascade
windsurf.openCascade
windsurf.cascade.acceptCascadeStep
windsurf.cascade.rejectCascadeStep
windsurf.cascade.resetCurrentConversation
windsurf.cascade.switchToNextModel
windsurf.cascade.switchToNextSession
windsurf.cascade.switchToPreviousSession
windsurf.cascade.switchToHighestPrioritySession
windsurf.cascade.closeActiveCascadeTab
windsurf.cascade.closeOtherCascadeTabs
windsurf.cascade.toggleWorktree
windsurf.cascade.toggleModelSelector
windsurf.cascade.toggleAgentSelector
windsurf.cascade.openAgentPicker
windsurf.cascade.pressMicrophone
windsurf.cascade.readClaudeCodeConfig
windsurf.cascade.chat.searchConversation
```

## 125.3 Agent Window & ACP (8)

```
windsurf.agentWindow.openDesktop
windsurf.agentWindow.openShell
windsurf.agentWindow.viewSpaceDiffs
windsurf.agentWindow.tryOpenGitHubPullRequestInExtension
windsurf.acp.agentPreferences
windsurf.acp.enabled
windsurf.acp.enabledAgents
windsurf.acp.hasActiveConnector
```

## 125.4 导入 & 迁移 (8)

```
windsurf.importVSCodeSettings
windsurf.importVSCodeExtensions
windsurf.importVSCodeRecentWorkspaces
windsurf.importCursorSettings
windsurf.importCursorExtensions
windsurf.importWindsurfSettings
windsurf.importWindsurfExtensions
windsurf.importRulesFromCursor
```

## 125.5 Lifeguard & 安全 (2)

```
windsurf.lifeguard.attachBugToChat
windsurf.lifeguard.learnFromBug
```

## 125.6 Workflow & Skills (5)

```
windsurf.createWorkflow
windsurf.createGlobalWorkflow
windsurf.createRule
windsurf.createSkill
windsurf.createGlobalSkill
```

## 125.7 新发现命令 (Round 7)

```
windsurf.cascade.readClaudeCodeConfig  — 读取 Claude Code 配置 (竞品兼容!)
windsurf.vibeAndReplace                — Vibe 编辑模式
windsurf.cancelVibeAndReplace          — 取消 Vibe 编辑
windsurf.implementPlan                 — 执行计划
windsurf.autoContinue                  — 自动继续
windsurf.build                         — 构建
windsurf.openBrowser                   — 打开浏览器
windsurf.openDesktopViewer             — 打开桌面查看器
windsurf.openShellViewer               — 打开 Shell 查看器
windsurf.openTestRecordingViewer       — 打开测试录制查看器
windsurf.editWithDiffZone              — 使用 DiffZone 编辑
windsurf.forceSupercomplete            — 强制超级补全
windsurf.generateCodeMapFromCascade    — 从 Cascade 生成 CodeMap
windsurf.sea / windsurf.sea.shade / windsurf.sea.tint — SEA 主题系统
```

---

# 126. Go LS Binary 字符串分析 (language_server_windows_x64.exe)

## 126.1 基本信息

- 文件: `windsurf/bin/language_server_windows_x64.exe`
- 大小: 163.7 MB
- 语言: Go 1.26.1
- 53 个第三方 Go 模块
- 175 个 Exafunction 内部包
- 117 个相关环境变量/常量

## 126.2 关键 URLs (从二进制中提取)

| URL | 用途 |
|-----|------|
| `https://server.codeium.com` | 主 API 服务器 |
| `https://inference.codeium.com` | 推理服务器 |
| `https://unleash.codeium.com/api/experiment` | Feature Flag 服务 |
| `https://southcentral-lb.codeium.com` | 南部区域负载均衡 |
| `https://api.codeium.com/register_user/after` | 注册回调 |
| `https://cascadeplayground.watchdevinwork.com/cascade_query/%s-` | Cascade Playground (Devin) |
| `https://deepwiki.org` | DeepWiki 服务 |
| `https://windsurf.ai` | Windsurf AI 站点 |
| `https://windsurf.com` | Windsurf 主站 |
| `https://registry.modelcontextprotocol.io/v0.1` | MCP 注册中心 |
| `https://exafunction.github.io/public/changelog/%d.%d.md` | 版本更新日志 |
| `https://connectrpc.com/docs/go/common-errors` | Connect-RPC 文档 |
| `https://react.dev/errors/` | React 错误页 |
| `https://issuer.cel.dev` | CEL (Common Expression Language) |

## 126.3 Exafunction 内部 Go 包结构 (175个)

### Proto 包 (22个)
```
exa/analytics_pb          — 遥测分析
exa/api_server_pb         — API 服务器 proto
exa/auth_pb               — 认证 proto
exa/auto_cascade_common_pb — 自动 Cascade
exa/browser_preview_pb    — 浏览器预览
exa/bug_checker_pb        — Bug 检测 (Lifeguard)
exa/cascade_plugins_pb    — Cascade 插件
exa/chat_client_server_pb — Chat 客户端服务
exa/chat_pb               — Chat proto
exa/code_edit/code_edit_pb — 代码编辑
exa/codeium_common_pb     — 公共 proto
exa/context_module_pb     — 上下文模块
exa/cortex_pb             — Cortex 核心
exa/dev_pb                — 开发 proto
exa/diff_action_pb        — Diff 动作
exa/eval_pb               — 评估
exa/extension_server_pb   — 扩展服务
exa/file_system_provider_pb — 文件系统
exa/index_pb              — 索引
exa/knowledge_base_pb     — 知识库
exa/language_server_pb    — 语言服务器
exa/model_management_pb   — 模型管理
exa/opensearch_clients_pb — OpenSearch
exa/product_analytics_pb  — 产品分析
exa/prompt_pb             — Prompt
exa/reactive_component_pb — 响应式组件
exa/seat_management_pb    — 席位管理
exa/tokenizer_pbb         — Tokenizer
exa/trainer_pb            — 训练器
exa/tree_sitter/language_data_pb — TreeSitter 语言数据
exa/user_analytics_pb     — 用户分析
```

### Language Server 核心包 (30个)
```
exa/language_server/action            — 动作执行
exa/language_server/api_server_client — API 客户端
exa/language_server/cache             — 缓存层
exa/language_server/chat              — Chat 处理
exa/language_server/chat_client_server_client — Chat 客户端
exa/language_server/code_tracker      — 代码追踪
exa/language_server/commit_graph      — Commit 图
exa/language_server/commit_messages   — Commit 消息生成
exa/language_server/completion_provider — 补全提供器
exa/language_server/completion_store  — 补全存储
exa/language_server/completion_type   — 补全类型
exa/language_server/completion_utils  — 补全工具
exa/language_server/completions_state — 补全状态
exa/language_server/context_module    — 上下文模块
exa/language_server/cortex            — Cortex 集成
exa/language_server/diff_action       — Diff 动作
exa/language_server/directory_utils   — 目录工具
exa/language_server/documentindex     — 文档索引
exa/language_server/documentmanager   — 文档管理
exa/language_server/edit_distance     — 编辑距离
exa/language_server/extension_server_client — 扩展服务客户端
exa/language_server/git_log_utils     — Git Log 工具
exa/language_server/indexed_repos_cache — 索引仓库缓存
exa/language_server/interceptor       — 拦截器
exa/language_server/interfaces        — 接口定义
exa/language_server/language_server_defaults — 默认配置
exa/language_server/language_utils    — 语言工具
exa/language_server/ls_unleash        — Feature Flag 客户端
exa/language_server/lsp               — LSP 协议层
exa/language_server/metadata_provider — 元数据提供器 (★关键)
exa/language_server/mquery            — M-Query 检索
exa/language_server/native_storage_migrations — 存储迁移
exa/language_server/onboarding        — 入门引导
exa/language_server/other_docs        — 文档管理
exa/language_server/performance       — 性能监控
exa/language_server/pipe_watcher      — 管道监视
exa/language_server/prompt            — Prompt 构建
exa/language_server/session           — 会话管理
exa/language_server/state             — 状态管理
exa/language_server/streaming         — 流式处理
exa/language_server/supercomplete     — 超级补全
exa/language_server/tab               — Tab 补全
exa/language_server/types             — 类型定义
exa/language_server/user_settings     — 用户设置
exa/language_server/user_status       — 用户状态
exa/language_server/vibe_and_replace  — Vibe & Replace 模式
```

### Cortex 子包 (7个)
```
exa/cortex/brain       — Brain 系统
exa/cortex/config      — 配置
exa/cortex/executors   — 执行器
exa/cortex/handlers    — 处理器
exa/cortex/implicit    — 隐式 Trajectory
exa/cortex/interfaces  — 接口
exa/cortex/managers    — 管理器
exa/cortex/memories    — 记忆系统
exa/cortex/proto_saver — Proto 持久化
exa/cortex/state       — 状态管理
exa/cortex/tools       — 工具调用
exa/cortex/traj        — Trajectory 管理
exa/cortex/utils       — 工具函数
```

### 基础设施包 (20+)
```
exa/browser_preview/proxy   — 浏览器预览代理
exa/browser_preview/server  — 浏览器预览服务
exa/connect_utils           — Connect-RPC 工具
exa/constants               — 常量定义
exa/document                — 文档处理
exa/environment_config      — 环境配置
exa/fs                      — 文件系统抽象
exa/fs/file_system_provider_fs — FSP 文件系统
exa/fs/file_watcher         — 文件监视器
exa/fs/has_scheme           — URI scheme 处理
exa/fs/workspace_manager    — 工作区管理
exa/git_manager             — Git 管理
exa/git_utils               — Git 工具
exa/git_utils/git_cci       — Git CCI (Commit Context Info)
exa/gitignore               — Gitignore 解析
exa/go_utils                — Go 通用工具
exa/harness_uid             — Harness UID
exa/hooks                   — Hooks 系统
exa/log                     — 日志
exa/mem                     — 内存管理
exa/model_family_uid        — 模型族 UID
exa/model_uid               — 模型 UID
exa/models/completion_length_model — 补全长度模型
exa/models/model_config     — 模型配置
exa/prompt                  — Prompt 工具
exa/prompt/cumulative_prompt_handler — 累积 Prompt
exa/proto_utils             — Proto 工具
exa/proxy                   — 代理层
exa/radix                   — Radix 树
exa/reactive_component      — 响应式组件
exa/recover_traces          — 恢复追踪
exa/repo_info               — 仓库信息
exa/scm_utils               — SCM 工具
exa/stamp                   — 版本戳
exa/terminal                — 终端管理
exa/tokenizer               — Tokenizer
exa/transport               — 传输层
exa/tree_sitter             — TreeSitter 解析
exa/tree_sitter/lib         — TreeSitter 库
exa/unleash                 — Feature Flag (Unleash)
exa/vcs                     — 版本控制
exa/web_app_deployment      — Web 应用部署
exa/web_scraping            — Web 爬虫
exa/workflow/node           — Workflow 节点
```

## 126.4 第三方 Go 模块 (53个)

| 模块 | 用途 |
|------|------|
| `github.com/Azure/go-autorest` | Azure 认证 |
| `github.com/BurntSushi/toml` | TOML 解析 |
| `github.com/Microsoft/go-winio` | Windows IO |
| `github.com/PuerkitoBio/goquery` | HTML 解析 |
| `github.com/adrg/frontmatter` | Frontmatter 解析 |
| `github.com/antchfx/htmlquery` | HTML XPath |
| `github.com/antchfx/xmlquery` | XML XPath |
| `github.com/dmitryikh/leaves` | ML 决策树 (补全长度预测) |
| `github.com/form3tech-oss/jwt-go` | JWT 处理 |
| `github.com/fsnotify/fsnotify` | 文件监视 |
| `github.com/getsentry/sentry-go` | Sentry 错误上报 |
| `github.com/go-git/gcfg` | Git 配置解析 |
| `github.com/go-ole/go-ole` | Windows OLE |
| `github.com/go-openapi/*` | OpenAPI/Swagger |
| `github.com/gobwas/glob` | Glob 匹配 |
| `github.com/gocolly/colly` | Web 爬虫框架 |
| `github.com/gofrs/flock` | 文件锁 |
| `github.com/google/uuid` | UUID 生成 |
| `github.com/gorilla/websocket` | WebSocket |
| `github.com/invopop/jsonschema` | JSON Schema |
| `github.com/pbnjay/memory` | 系统内存信息 |
| `github.com/rs/cors` | CORS 处理 |
| `github.com/saintfish/chardet` | 字符编码检测 |
| `github.com/sirupsen/logrus` | 结构化日志 |
| `github.com/spf13/pflag` | CLI flag 解析 |
| `github.com/tailscale/hujson` | JSONC 解析 |
| `github.com/temoto/robotstxt` | robots.txt 解析 |
| `github.com/twmb/murmur3` | Murmur3 哈希 |
| `github.com/vito/midterm` | 终端模拟 |
| `github.com/yusufpapurcu/wmi` | WMI 查询 |

## 126.5 关键常量/枚举 (从 Go binary 提取)

### TeamsTier 枚举 (确认)
```
TEAMS_TIER_DEVIN_ENTERPRISE
TEAMS_TIER_DEVIN_FREE
TEAMS_TIER_DEVIN_MAX
TEAMS_TIER_DEVIN_PRO        ← 目标伪装值
TEAMS_TIER_DEVIN_TEAMS
TEAMS_TIER_DEVIN_TRIAL      ← 当前值
```

### Cascade 运行状态
```
CASCADE_RUN_STATUS_BUSY
CASCADE_RUN_STATUS_CANCELING
CASCADE_RUN_STATUS_IDLE
CASCADE_RUN_STATUS_RUNNING
CASCADE_RUN_STATUS_UNSPECIFIED
```

### Cascade 席位类型
```
CASCADE_SEAT_TYPE_ENTRY
CASCADE_SEAT_TYPE_STANDARD
CASCADE_SEAT_TYPE_UNSPECIFIED
```

### API Provider (Devin 特有)
```
API_PROVIDER_ANTHROPIC_DEVIN
API_PROVIDER_FIREWORKS_DEVIN
API_PROVIDER_OPENAI_DEVIN
```

### Windsurf 生命周期事件
```
WINDSURF_EDITOR_READY
WINDSURF_EXTENSION_ACTIVATED
WINDSURF_EXTENSION_START
WINDSURF_SENTRY_SAMPLE_RATE
```

### Cascade 遥测事件 (30+)
```
CASCADE_VIEW_LOADED, CASCADE_MESSAGE_SENT, CASCADE_STEP_COMPLETED
CASCADE_ONBOARDING, CASCADE_ONBOARDING_REVERT
CASCADE_PLUGIN_INSTALLED/ENABLED/DISABLED/PANEL_OPENED/PAGE_OPENED
CASCADE_PLUGIN_TOOL_ENABLED/DISABLED
CASCADE_RULE_OPEN, CASCADE_RULE_REFRESH_CLICKED
CASCADE_WEB_SEARCH_NUX, CASCADE_WEB_SEARCH_TOOL_ENABLED
CASCADE_WORKFLOW_OPEN, CASCADE_MEMORIES_VIEW/EDIT, CASCADE_MEMORY_DELETED
CASCADE_NEW_MODELS_NUX, CASCADE_MODEL_HEADER_WARNING
CASCADE_DEFAULT_MODEL_OVERRIDE, CASCADE_GLOBAL_CONFIG_OVERRIDE
CASCADE_ENABLE_MCP_TOOLS, CASCADE_ENABLE_PROXY_WEB_SERVER
CASCADE_ENFORCE_QUOTA, CASCADE_ERROR_STEP
CASCADE_INSERT_AT_MENTION, CASCADE_TOOL_CALL_PRICING_NUX
CASCADE_NUX_EVENT_DIFF_OVERVIEW/PLAN_MODE/REVERT_STEP/RULES/TOOL_CALL/WEB_MENTION/WEB_SEARCH
```

## 126.6 新发现: 关键配置字段

从 Go binary 字符串中发现的重要配置:

| 字段 | 说明 |
|------|------|
| `windsurf_deployment_id` | Windsurf 部署 ID |
| `windsurf_project_id` | 项目 ID |
| `windsurf_pro_trial_end_time` | Pro 试用结束时间 |
| `windsurf_deployments` | 部署列表 |
| `windsurf_projects` | 项目列表 |
| `windsurf_setting` | 设置 |
| `netlify_access_token` | Netlify 访问令牌 |
| `saml_auth_token` | SAML 认证 token |
| `session_token` | 会话 token |
| `refresh_token` | 刷新 token |
| `verification_token` | 验证 token |
| `turnstile_token` | Cloudflare Turnstile token |
| `sso_token` / `sso_url` | SSO 认证 |
| `devin_account_id` | Devin 账号 ID |
| `devin_api_url` | Devin API URL |
| `devin_webapp_host` | Devin WebApp 主机 |
| `devin_primary_org_id` | Devin 主组织 ID |
| `devin_user_id` | Devin 用户 ID |

---

# 127. VS Code 平台扩展 — Windsurf 贡献点

从 nls.keys.json 提取的 Windsurf VS Code 贡献模块 (37个):

## 127.1 Workbench 贡献 (25个)

```
vs/workbench/contrib/windsurfAcpDev              — ACP 开发
vs/workbench/contrib/windsurfAcpService          — ACP 服务
vs/workbench/contrib/windsurfAgentSidebar        — Agent 侧边栏
vs/workbench/contrib/windsurfAgentWindow         — Agent 窗口
vs/workbench/contrib/windsurfCascade             — Cascade 核心
vs/workbench/contrib/windsurfCascadeView         — Cascade 视图
vs/workbench/contrib/windsurfCodeMapViewer       — CodeMap 查看器
vs/workbench/contrib/windsurfCustomAppIcon       — 自定义图标
vs/workbench/contrib/windsurfDesktopViewer       — 桌面查看器
vs/workbench/contrib/windsurfDiffViewer          — Diff 查看器
vs/workbench/contrib/windsurfFeedback            — 反馈
vs/workbench/contrib/windsurfMcpService          — MCP 服务
vs/workbench/contrib/windsurfOnboarding          — 入门引导
vs/workbench/contrib/windsurfPlanEditor          — 计划编辑器
vs/workbench/contrib/windsurfPullRequest         — PR 集成
vs/workbench/contrib/windsurfSettingsPage        — 设置页面
vs/workbench/contrib/windsurfShellViewer         — Shell 查看器
vs/workbench/contrib/windsurfStatusBarSettingsService — 状态栏设置
vs/workbench/contrib/windsurfTestRecordingViewer — 测试录制查看器
vs/workbench/contrib/lifeguard                   — Lifeguard (5子模块)
vs/workbench/browser/parts/editor/editorGroupWindsurfWelcome — 编辑器欢迎页
```

## 127.2 平台层贡献 (4个)

```
vs/platform/windsurfAuth/common/windsurfAuth     — 认证平台服务
vs/platform/windsurfSvg/browser/windsurfSvgService — SVG 服务
vs/platform/theme/common/colors/windsurfCustomColors — 自定义颜色
vs/platform/theme/common/colors/windsurfDiffColors  — Diff 颜色
```

## 127.3 编辑器贡献 (2个)

```
vs/editor/contrib/windsurfAnnotations           — 代码注释
vs/editor/contrib/windsurfEditorInfoWidget      — 编辑器信息组件
```

## 127.4 终端贡献 (1个)

```
vs/workbench/contrib/terminalContrib/cascadeManagedFooter — Cascade 管理终端页脚
```

---

# 128. 累计统计 (Round 7 最终)

| 指标 | 数量 |
|------|------|
| 文档章节 | 128 |
| Proto Types | 1,736+ |
| RPC Methods | 369+ |
| CortexStepType | 93 |
| windsurf.* 命令 | 231 |
| Exafunction Go 包 | 175 |
| 第三方 Go 模块 | 53 |
| 环境变量/常量 | 117 |
| NLS Keys (Windsurf) | 244 |
| VS Code 贡献模块 | 37 |
| Devin API 方法 | 30+ |
| ACP 状态键 | 38+ |
| Worktree Proto 消息 | 12+ |
| 硬编码 URLs | 14+ |
| Feature Flags (Unleash) | 10+ |
| 静态分析完成度 | ~97% |

---

# Round 8: Cortex 执行引擎深度分析 + Rate Limit 机制

## 129. Cortex 执行引擎完整架构

从 `cortex.proto` (3071行) 完整提取的 Cortex 执行引擎架构。

### 129.1 CortexStepType 完整枚举 (104种工具)

| # | 类型 | 功能 |
|---|------|------|
| 0 | UNSPECIFIED | 未指定 |
| 1 | DUMMY | 测试虚拟步骤 |
| 2 | FINISH | 完成 |
| 3 | PLAN_INPUT | 计划输入 |
| 4 | MQUERY | 语义代码搜索 |
| 5 | CODE_ACTION | 代码修改 (核心编辑) |
| 6 | GIT_COMMIT | Git 提交 |
| 7 | GREP_SEARCH | Grep 搜索 v1 |
| 8 | VIEW_FILE | 查看文件 |
| 9 | LIST_DIRECTORY | 列出目录 |
| 10 | COMPILE | 编译/Pylint |
| 11 | INFORM | 通知 Planner |
| 12 | FILE_BREAKDOWN | 文件结构分解 |
| 13 | VIEW_CODE_ITEM | 查看代码项 |
| 14 | USER_INPUT | 用户输入 |
| 15 | PLANNER_RESPONSE | Planner 回复 |
| 16 | WRITE_TO_FILE | 写入新文件 |
| 17 | ERROR_MESSAGE | 错误消息 |
| 18 | CLUSTER_QUERY | 集群查询 |
| 19 | LIST_CLUSTERS | 列出集群 |
| 20 | INSPECT_CLUSTER | 检查集群 |
| 21 | RUN_COMMAND | 运行命令 (核心) |
| 22 | RELATED_FILES | 相关文件 |
| 23 | CHECKPOINT | 检查点 (摘要/缓存) |
| 24 | PROPOSE_CODE | 提议代码 |
| 25 | FIND | 查找文件 (fd) |
| 26 | SEARCH_KNOWLEDGE_BASE | 知识库搜索 |
| 27 | SUGGESTED_RESPONSES | 建议响应 |
| 28 | COMMAND_STATUS | 命令状态查看 |
| 29 | MEMORY | 记忆操作 (CRUD) |
| 30 | LOOKUP_KNOWLEDGE_BASE | 知识库查找 |
| 31 | READ_URL_CONTENT | 读取URL内容 |
| 32 | VIEW_CONTENT_CHUNK | 查看内容块 |
| 33 | SEARCH_WEB | 网页搜索 |
| 34 | RETRIEVE_MEMORY | 检索记忆 |
| 35 | AUTO_CASCADE_BROADCAST | 自动广播 |
| 36 | CUSTOM_TOOL | 自定义工具 |
| 37 | CREATE_RECIPE | 创建配方 |
| 38 | MCP_TOOL | MCP工具调用 |
| 39 | MANAGER_FEEDBACK | 管理反馈 |
| 40 | TOOL_CALL_PROPOSAL | 工具调用提案 |
| 41 | TOOL_CALL_CHOICE | 工具调用选择 |
| 42 | TRAJECTORY_CHOICE | 轨迹选择 |
| 43 | PROXY_WEB_SERVER | 代理Web服务器 |
| 44 | DEPLOY_WEB_APP | 部署Web应用 |
| 45 | CLIPBOARD | 剪贴板 |
| 46 | READ_DEPLOYMENT_CONFIG | 读取部署配置 |
| 47 | VIEW_FILE_OUTLINE | 文件大纲 |
| 48 | CHECK_DEPLOY_STATUS | 检查部署状态 |
| 49 | POST_PR_REVIEW | 发布PR评审 |
| 50 | READ_KNOWLEDGE_BASE_ITEM | 读取知识库项 |
| 51 | LIST_RESOURCES | 列出MCP资源 |
| 52 | READ_RESOURCE | 读取MCP资源 |
| 53 | LINT_DIFF | Lint差异 |
| 54 | FIND_ALL_REFERENCES | 查找所有引用 |
| 55 | BRAIN_UPDATE | Brain更新 |
| 57 | RUN_EXTENSION_CODE | 运行扩展代码 |
| 58 | ADD_ANNOTATION | 添加注释 |
| 59 | PROPOSAL_FEEDBACK | 提案反馈 |
| 60 | TRAJECTORY_SEARCH | 轨迹搜索 |
| 65 | READ_TERMINAL | 读取终端 |
| 68 | GET_DOM_TREE | 获取DOM树 |
| 71 | ARTIFACT_SUMMARY | 制品摘要 |
| 72 | RESOLVE_TASK | 解决任务 |
| 73 | TODO_LIST | TODO列表 |
| 74 | BLOCKING | 阻塞 |
| 80 | EXPLORE_RESPONSE | 探索响应 |
| 82 | READ_NOTEBOOK | 读取Notebook |
| 83 | EDIT_NOTEBOOK | 编辑Notebook |
| 86 | SUPERCOMPLETE_ACTIVE_DOC | 超级补全活动文档 |
| 87 | FIND_CODE_CONTEXT | 查找代码上下文 |
| 89 | SUPERCOMPLETE_FEEDBACK | 超级补全反馈 |
| 90 | LINT_FIX_MESSAGE | Lint修复消息 |
| 91 | GREP_SEARCH_V2 | Grep搜索 v2 |
| 92 | UPSERT_CODEMAP | 更新CodeMap |
| 93 | SUGGEST_CODEMAP | 建议CodeMap |
| 94 | SMART_FRIEND | 智能朋友 |
| 95 | DO_TESTING | 执行测试 |
| 97 | REPORT_BUGS | 报告Bug (Lifeguard) |
| 99 | EXIT_PLAN_MODE | 退出计划模式 |
| 100 | ASK_USER_QUESTION | 询问用户 |
| 101 | SKILL | 技能调用 |
| 102 | SUPERCOMPLETE_EPHEMERAL_FEEDBACK | 短暂超级补全反馈 |
| 103 | ARENA_TRAJECTORY_CONVERGE | Arena合并 |
| 104 | TASK_SUBAGENT | 任务子代理 |

### 129.2 Planner 类型 (8种)

```protobuf
message CascadePlannerConfig {
  oneof planner_type_config {
    CascadeConversationalPlannerConfig conversational = 2;
    CascadeConversationalV2PlannerConfig conversational_v2 = 27;
    CascadeAgenticPlannerConfig agentic = 3;
    CascadeResearchPlannerConfig research = 10;
    CascadePassivePlannerConfig passive = 22;
    CascadeAgentV2PlannerConfig agent_v2 = 24;
    CascadeCodemapPlannerConfig codemap = 29;
    CascadeLifeguardPlannerConfig lifeguard = 33;
  }
}
```

| Planner | 功能 | 特点 |
|---------|------|------|
| conversational | 对话式 | clusters, eval_mode |
| conversational_v2 | 对话式v2 | planner_mode enum |
| agentic | 代理式 (核心) | feedback_loop, manager, applier |
| research | 研究 | 只读引用节点, clusters |
| passive | 被动 | read_only |
| agent_v2 | 代理v2 | summarizer |
| codemap | CodeMap | 空配置 |
| lifeguard | Lifeguard | agent_version |

### 129.3 Executor 配置

```protobuf
message CascadeExecutorConfig {
  optional bool disable_async = 1;
  int32 max_generator_invocations = 2;          // 最大LLM调用次数
  repeated CortexStepType terminal_step_types = 3; // 终止步骤类型
  optional bool run_pending_steps = 4;
  optional bool hold_for_valid_checkpoint = 5;
  int32 hold_for_valid_checkpoint_timeout = 6;
  bool research_only = 7;
  optional bool use_aggressive_snapshotting = 8;
  bool enable_background_linting = 9;
  int32 max_lint_injection_count = 10;
}
```

**终止原因 (ExecutorTerminationReason):**
- ERROR (1): 错误
- USER_CANCELED (2): 用户取消
- MAX_INVOCATIONS (3): 达到最大调用次数
- NO_TOOL_CALL (4): 无工具调用
- HALTED_STEP (5): 步骤被暂停
- HOOK_BLOCKED (6): Hook 阻止
- ARENA_INVOCATION_CAP (7): Arena 调用上限

### 129.4 CascadeConfig 完整结构

```
CascadeConfig
├── planner_config: CascadePlannerConfig
│   ├── planner_type_config (oneof 8种)
│   ├── tool_config: CascadeToolConfig (40种工具配置)
│   ├── plan_model_uid
│   ├── requested_model_uid
│   ├── max_iterations
│   ├── max_output_tokens
│   ├── truncation_threshold_tokens
│   ├── is_vibe_and_replace
│   └── prompt_override: PromptOverrideConfig
├── checkpoint_config: CheckpointConfig
│   ├── token_threshold
│   ├── max_token_limit
│   ├── checkpoint_model_uid
│   └── checkpoint_model_fallback_uid
├── executor_config: CascadeExecutorConfig
├── trajectory_conversion_config
├── memory_config: MemoryConfig
├── brain_config: BrainConfig
│   ├── brain_model_uid
│   ├── update_strategy (forced/dynamic)
│   ├── filter_strategy
│   └── use_rules_in_subagent
├── parallel_rollout_config: ParallelRolloutConfig
│   ├── num_parallel_rollouts
│   ├── max_invocations_per_rollout
│   └── guide_model_uid
├── hooks: CascadeHook[]
└── override_harness_uid
```

### 129.5 CascadeToolConfig 完整工具配置 (40种)

| 工具 | 配置键 | 核心参数 |
|------|--------|----------|
| mquery | MqueryToolConfig | m_query_config, max_tokens, num_items_full_source |
| code | CodeToolConfig | replace_content, fast_apply_fallback, auto_fix_lints |
| intent | IntentToolConfig | intent_model_uid, max_context_tokens |
| grep | GrepToolConfig | max_results, include_cci, enterprise_config |
| grep_v2 | GrepV2ToolConfig | enterprise_config, allow_gitignore |
| find | FindToolConfig | max_results, fd_path |
| cluster_query | ClusterQueryToolConfig | max_results |
| inspect_cluster | InspectClusterToolConfig | max_tokens |
| run_command | RunCommandToolConfig | max_chars, auto_command, shell_name/path, timeout |
| knowledge_base_search | KnowledgeBaseSearchToolConfig | max_tokens, prompt_fraction |
| view_file | ViewFileToolConfig | max_tokens_outline, max_lines_per_view, v2 |
| view_code_item | ViewCodeItemToolConfig | max_num_items, max_bytes |
| suggested_response | SuggestedResponseConfig | force_disable |
| search_web | SearchWebToolConfig | force_disable, third_party_config |
| read_url_content | ReadUrlContentToolConfig | force_disable, auto_web_request |
| memory | MemoryToolConfig | force_disable, disable_auto_generate, disable_write |
| mcp | McpToolConfig | force_disable, max_output_bytes |
| proxy_web_server | ProxyWebServerToolConfig | force_disable |
| deploy_web_app | DeployWebAppToolConfig | enabled |
| list_dir | ListDirToolConfig | enterprise_config |
| command_status | CommandStatusToolConfig | use_delta |
| read_knowledge_base_item | ReadKnowledgeBaseItemToolConfig | enabled, items |
| find_all_references | FindAllReferencesConfig | enabled |
| run_extension_code | RunExtensionCodeConfig | enabled, only |
| add_annotation | AddAnnotationConfig | enabled |
| trajectory_search | TrajectorySearchToolConfig | force_disable, max_scored_chunks |
| auto_cascade_broadcast | AutoCascadeBroadcastToolConfig | force_disable |
| notebook | NotebookToolConfig | enabled |
| find_code_context | FindCodeContextToolConfig | force_disable |
| smart_friend | SmartFriendToolConfig | smart_friend_model_uid |
| exit_plan_mode | ExitPlanModeToolConfig | enabled |
| ask_user_question | AskUserQuestionToolConfig | enabled |
| task_subagent | TaskSubagentToolConfig | enabled |

### 129.6 ReplaceToolVariant (代码编辑策略)

```protobuf
enum ReplaceToolVariant {
  REPLACEMENT_CHUNK = 1;     // 原始替换块
  SEARCH_REPLACE = 2;       // 搜索替换
  APPLY_PATCH = 3;          // 应用补丁
  SINGLE_MULTI = 4;         // 单/多编辑
  OPENAI_APPLY_PATCH = 5;   // OpenAI风格补丁
  FREEFORM_APPLY_PATCH = 6; // 自由格式补丁
}
```

### 129.7 AutoRunDecision (命令自动执行决策)

```protobuf
enum AutoRunDecision {
  USER_ALLOW = 1;     // 用户允许
  USER_DENY = 2;      // 用户拒绝
  SYSTEM_ALLOW = 3;   // 系统允许
  SYSTEM_DENY = 4;    // 系统拒绝
  MODEL_ALLOW = 5;    // 模型允许
  MODEL_DENY = 6;     // 模型拒绝
  DEFAULT_ALLOW = 7;  // 默认允许
  DEFAULT_DENY = 8;   // 默认拒绝
  USER_SKIP = 9;      // 用户跳过
}
```

## 130. Rate Limit / Tier 绕过机制深度分析

### 130.1 Tier 系统完整枚举 (21种)

```protobuf
enum TeamsTier {
  TEAMS_TIER_UNSPECIFIED = 0;
  TEAMS_TIER_TEAMS = 1;
  TEAMS_TIER_PRO = 2;
  TEAMS_TIER_TRIAL = 9;
  TEAMS_TIER_ENTERPRISE_SAAS = 3;
  TEAMS_TIER_HYBRID = 4;
  TEAMS_TIER_ENTERPRISE_SELF_HOSTED = 5;
  TEAMS_TIER_ENTERPRISE_SELF_SERVE = 10;
  TEAMS_TIER_DEVIN_ENTERPRISE = 12;
  TEAMS_TIER_DEVIN_TEAMS = 14;
  TEAMS_TIER_DEVIN_TEAMS_V2 = 15;
  TEAMS_TIER_DEVIN_PRO = 16;          // ← 目标
  TEAMS_TIER_DEVIN_MAX = 17;
  TEAMS_TIER_MAX = 18;
  TEAMS_TIER_DEVIN_FREE = 19;
  TEAMS_TIER_DEVIN_TRIAL = 20;        // ← 当前
  TEAMS_TIER_WAITLIST_PRO = 6;
  TEAMS_TIER_TEAMS_ULTIMATE = 7;
  TEAMS_TIER_PRO_ULTIMATE = 8;
  TEAMS_TIER_ENTERPRISE_SAAS_POOLED = 11;
}
```

### 130.2 Rate Limit 检查数据流

```
Extension (发起请求)
  │
  ├── CheckUserMessageRateLimit(metadata, model_uid)
  │     └── metadata.impersonate_tier = "TEAMS_TIER_DEVIN_PRO"
  │
  ├── CheckChatCapacity(metadata, model_uid)
  │
  │   ↓ (metadata 含 api_key + impersonate_tier)
  │
  ├── LanguageServer (转发)
  │     └── _injectMetadata(apiReq, key) → 注入 impersonate_tier
  │
  │   ↓ (gRPC/Connect-RPC to server.codeium.com)
  │
  └── API Server
        ├── 验证 api_key
        ├── 读取 impersonate_tier
        ├── 返回 has_capacity + messages_remaining
        └── 根据 tier 决定配额
```

### 130.3 Metadata.impersonate_tier 注入点

```protobuf
message Metadata {
  string ide_name = 1;
  string ide_version = 7;
  string extension_version = 2;
  string api_key = 3;           // 认证
  string session_id = 10;
  uint64 request_id = 9;
  string impersonate_tier = 29; // ★ Tier 伪装字段
  string team_id = 32;
}
```

**注入逻辑** (已实现于 `language-server-service.js`):
```javascript
_injectMetadata(apiReq, key) {
  if (!apiReq.metadata) apiReq.metadata = {};
  apiReq.metadata.api_key = key;
  if (this.impersonateTier) {
    apiReq.metadata.impersonate_tier = this.impersonateTier;
  }
}
```

### 130.4 PlanInfo 中的 Tier 控制

`PlanInfo` 决定用户可以做什么:

| 字段 | Pro=true 时 |
|------|-------------|
| teams_tier | TEAMS_TIER_DEVIN_PRO (16) |
| has_autocomplete_fast_mode | true |
| allow_sticky_premium_models | true |
| has_tab_to_jump | true |
| max_num_premium_chat_messages | 高额度 |
| monthly_prompt_credits | 大量 |
| monthly_flow_credits | 大量 |
| cascade_web_search_enabled | true |
| cascade_can_auto_run_commands | true |
| can_generate_commit_messages | true |
| knowledge_base_enabled | true |
| browser_enabled | true |
| can_share_conversations | true |
| can_allow_cascade_in_background | true |

### 130.5 ClientModelConfig.allowed_tiers

每个模型都有 `allowed_tiers` 字段，决定哪些 Tier 可以使用:

```protobuf
message ClientModelConfig {
  string label = 1;
  string model_uid = 22;
  repeated TeamsTier allowed_tiers = 12; // ★ Tier 白名单
  bool is_premium = 7;
  float credit_multiplier = 3;
}
```

当 `impersonate_tier = TEAMS_TIER_DEVIN_PRO` 时，所有标记 Pro 可用的模型都会解锁。

### 130.6 RecordCascadeUsage 中的 Tier 追踪

```protobuf
message RecordCascadeUsageRequest {
  Metadata metadata = 1;
  string trajectory_id = 2;
  int32 prompt_credits_used = 4;
  int32 flow_credits_used = 5;
  TeamsTier user_tier = 22;         // ★ 使用记录中的Tier
  BillingStrategy billing_strategy = 21;
}
```

### 130.7 UserStatus 中的 Tier 信息

```protobuf
message UserStatus {
  bool pro = 1;                    // ★ 是否Pro
  TeamsTier teams_tier = 10;       // ★ 当前Tier
  PlanStatus plan_status = 13;     // 含配额信息
  int64 user_used_prompt_credits = 28;
  int64 user_used_flow_credits = 29;
}
```

## 131. System Prompt 构建机制

### 131.1 GetSystemPromptAndTools RPC (本地方法)

```protobuf
// 仅 LS 本地处理，不发送到远程服务器
rpc GetSystemPromptAndTools(GetSystemPromptAndToolsRequest)
  returns (GetSystemPromptAndToolsResponse);

message GetSystemPromptAndToolsRequest {
  Metadata metadata = 1;
  CascadeConfig cascade_config = 2; // 包含完整配置
}

message GetSystemPromptAndToolsResponse {
  string system_prompt = 1;               // 完整系统提示
  repeated ChatToolDefinition tool_definitions = 2; // 工具定义列表
}
```

### 131.2 System Prompt 构建配置

```protobuf
message SystemPromptConstructionConfig {
  string element_separator = 1;
}

message CumulativePromptConfig {
  float persistent_context_multiplier = 7;
  float persistent_active_document_multiplier = 10;
  float persistent_open_docs_multiplier = 11;
  int64 persistent_max_tokens_per_open_doc = 17;
  float trajectory_context_multiplier = 2;
  float trajectory_refresh_threshold_multiplier = 15;
  float ephemeral_context_multiplier = 9;
  int64 intent_reservation_tokens = 6;
  repeated CortexStepType allowed_cascade_step_types = 18;
}
```

### 131.3 PromptOverrideConfig (自定义系统提示)

```protobuf
message PromptOverrideConfig {
  map<string, string> section_overrides = 1; // 覆盖特定段落
  repeated string additional_instructions = 2; // 追加指令
}

message SectionOverrideConfig {
  SectionOverrideMode mode = 1; // OVERRIDE/APPEND/PREPEND
  string content = 2;
}
```

CascadeConversationalPlannerConfig 允许覆盖以下段落:
- code_research_section_content
- test_section
- tool_calling_section
- code_changes_section
- additional_instructions_section
- communication_section

### 131.4 PlannerResponse 含 Thinking

```protobuf
message CortexStepPlannerResponse {
  string response = 1;
  string modified_response = 8;
  string thinking = 3;             // ★ 思考过程
  string signature = 4;
  bool thinking_redacted = 5;
  string message_id = 6;
  repeated ChatToolCall tool_calls = 7;
  string output_id = 9;
  string thinking_id = 10;
  bytes gemini_thought_signature = 11;
  string signature_type = 12;
  Duration thinking_duration = 13;
  string phase = 14;               // ★ 阶段标记
}
```

## 132. Brain 系统深度分析

### 132.1 BrainConfig 完整配置

```protobuf
message BrainConfig {
  optional bool enabled = 1;
  string brain_model_uid = 14;
  optional bool use_main_model_as_brain_model = 13;
  optional bool force_no_explanation = 4;
  BrainFilterStrategy filter_strategy = 5;
  BrainUpdateStrategy update_strategy = 6;
  optional bool use_replace_content_for_updates = 7;
  optional bool condense_trajectory_messages = 8;
  optional uint32 recent_update_tool_threshold = 9;
  optional uint32 stale_update_tool_threshold = 10;
  string additional_ephemeral_prompt = 11;
  optional bool use_rules_in_subagent = 12;
}
```

### 132.2 Brain 更新策略

```protobuf
message BrainUpdateStrategy {
  oneof strategy {
    Empty executor_forced = 2;                  // 执行器强制
    ForcedBrainUpdateConfig invocation_forced = 3;  // 调用强制(采样率)
    DynamicBrainUpdateConfig dynamic_update = 6;    // 动态(攻击性提示)
    Empty executor_forced_and_with_discretion = 5;  // 强制+自主
  }
}
```

### 132.3 TaskItem 结构 (Todo系统)

```protobuf
message TaskItem {
  string id = 1;
  string content = 2;
  TaskStatus status = 3;     // TODO/IN_PROGRESS/DONE
  string parent_id = 4;      // 树形结构
  string prev_sibling_id = 5;
}

message TaskDelta {
  TaskDeltaType type = 1;    // ADD/PRUNE/DELETE/UPDATE/MOVE
  string id = 2;
  string content = 3;
  TaskStatus status = 4;
  string parent_id = 5;
  string prev_sibling_id = 6;
}
```

## 133. MCP (Model Context Protocol) 完整架构

### 133.1 McpServerSpec

```protobuf
message McpServerSpec {
  string server_name = 1;
  string command = 2;           // 本地: 命令
  repeated string args = 3;
  map<string, string> env = 4;
  uint32 server_index = 5;
  string server_url = 6;        // 远程: URL
  bool disabled = 7;
  repeated string disabled_tools = 8;
  map<string, string> headers = 9;
  McpOAuthConfig oauth = 10;    // OAuth 支持
  string registry = 11;         // npm/pip registry
}
```

### 133.2 McpServerState (运行时状态)

```protobuf
message McpServerState {
  McpServerSpec spec = 1;
  McpServerStatus status = 2;    // PENDING/READY/ERROR/NEEDS_OAUTH
  string error = 3;
  repeated ChatToolDefinition tools = 4;
  repeated string tool_errors = 7;
  McpServerInfo server_info = 5;
  string instructions = 6;
  repeated McpPrompt prompts = 8;
}
```

### 133.3 MCP 资源系统

```protobuf
message McpResource {
  string uri = 1;
  string name = 2;
  string description = 3;
  string mime_type = 4;
}

message McpResourceContent {
  oneof data {
    TextData text = 2;
    ImageData image = 3;
  }
  string uri = 1;
}
```

## 134. Hooks 系统深度架构

### 134.1 完整触发点 (13种)

```protobuf
enum HookAgentAction {
  PRE_READ_CODE = 1;
  POST_READ_CODE = 2;
  PRE_WRITE_CODE = 3;
  POST_WRITE_CODE = 4;
  PRE_MCP_TOOL_USE = 5;
  POST_MCP_TOOL_USE = 6;
  PRE_RUN_COMMAND = 7;
  POST_RUN_COMMAND = 8;
  PRE_USER_PROMPT = 9;
  POST_CASCADE_RESPONSE = 10;
  POST_SETUP_WORKTREE = 11;
  POST_CASCADE_RESPONSE_WITH_TRANSCRIPT = 12;
}
```

### 134.2 Hook 执行结构

```protobuf
message CascadeHook {
  HookExecutionSpec hook_spec = 5;
  HookCondition condition = 6;      // 触发条件
  repeated string workspace_dirs = 7; // 生效目录
}

message CommandHookSpec {
  string command = 1;               // Unix 命令
  string working_directory = 2;
  bool show_output = 3;
  string powershell_command = 4;    // ★ Windows PowerShell
}

message CommandHookResult {
  int32 exit_code = 1;             // 非0则阻止
  string stdout = 2;
  string stderr = 3;
}
```

## 135. CortexTrajectory 核心数据结构

### 135.1 完整 Trajectory 结构

```protobuf
message CortexTrajectory {
  string trajectory_id = 1;
  string cascade_id = 6;
  CortexTrajectoryType trajectory_type = 4;
  repeated CortexTrajectoryStep steps = 2;
  repeated CortexTrajectoryReference parent_references = 5;
  repeated CortexStepGeneratorMetadata generator_metadata = 3;
  repeated ExecutorMetadata executor_metadatas = 9;
  CortexTrajectorySource source = 8;
  CortexTrajectoryMetadata metadata = 7;
  optional string renamed_title = 10;
  optional bytes virtual_fs_serialized_overlay = 13;  // ★ 虚拟文件系统
  uint32 diff_lines_added = 14;
  uint32 diff_lines_removed = 15;
  optional string arena_id = 16;
  repeated QueuedMessage message_queue = 17;
  optional string git_worktree_path = 18;
  repeated string git_worktree_paths = 22;
  optional ArenaModeInfo arena_mode_info = 20;
  optional ConversationalPlannerMode conversational_mode = 21;
  repeated WorktreeMergeSnapshot worktree_merges = 23;
  optional ModelAssignmentInfo model_assignment_info = 24;
}
```

### 135.2 GeneratorMetadata (LLM调用记录)

```protobuf
message ChatModelMetadata {
  string system_prompt = 1;                    // ★ 系统提示
  repeated ChatMessagePrompt message_prompts = 2; // 消息历史
  string model_uid = 15;
  ModelUsageStats usage = 4;
  float model_cost = 5;
  uint32 last_cache_index = 6;
  ChatToolChoice tool_choice = 7;
  repeated ChatToolDefinition tools = 8;
  Duration time_to_first_token = 11;
  Duration streaming_duration = 12;
  int32 credit_cost = 13;
  double acu_cost = 16;
  optional int64 quota_cost_basis_points = 18;
  optional int64 overage_cost_cents = 19;
}
```

### 135.3 Checkpoint (上下文压缩)

```protobuf
message CortexStepCheckpoint {
  uint32 checkpoint_index = 1;
  string conversation_title = 10;
  string user_intent = 4;
  string session_summary = 5;
  string code_change_summary = 6;
  string plan_snapshot = 13;
  map<string, DiffList> edited_file_map = 7;
  string memory_summary = 8;
}
```

## 136. Parallel Rollout (并行推理) 系统

```protobuf
message ParallelRolloutConfig {
  int32 num_parallel_rollouts = 1;         // 并行数
  uint32 max_invocations_per_rollout = 2;  // 每路最大调用
  string guide_model_uid = 6;              // 评判模型
  int32 max_guide_invocations = 4;
  bool force_bad_rollout = 5;              // 测试用
}

message ParallelRolloutGeneratorMetadata {
  string guide_judgement_trajectory_id = 1;
  CortexStepTrajectoryChoice guide_choice_step = 2;
}
```

## 137. Lifeguard (AI安全) 系统

```protobuf
message LifeguardBug {
  string id = 1;
  string file = 2;
  int32 start = 3;
  int32 end = 4;
  string title = 5;
  string description = 6;
  string severity = 7;
  string resolution = 8;
  optional string fix_old_str = 9;   // ★ 自动修复
  optional string fix_new_str = 10;
}

message CascadeLifeguardPlannerConfig {
  string agent_version = 1;
}
```

## 138. 新发现的工具类型

### 138.1 FindCodeContext (即时上下文)

```protobuf
message CortexStepFindCodeContext {
  string search_term = 1;
  repeated InstantContextStep steps = 2;
  InstantContextResponse response = 3;
}

message InstantContextToolCall {
  string command_type = 1;  // grep/find/view等
  string param = 2;
  ExecutionStatus execution_status = 3;
  float duration_seconds = 6;
}
```

多轮工具调用 → 自动聚合结果，提供即时代码上下文。

### 138.2 SmartFriend (智能顾问)

```protobuf
message CortexStepSmartFriend {
  string question = 1;
  string advice = 2;
  string model_uid = 6;     // 可用不同模型
  string model_name = 4;
}
```

### 138.3 TaskSubagent (子代理)

```protobuf
message CortexStepTaskSubagent {
  string description = 1;
  string prompt = 2;
  string result = 3;
}
```

### 138.4 CortexStepDeepThink (深度思考)

```protobuf
message CortexStepDeepThink {
  string exploration_document = 1;
  string exploration_document_absolute_path_uri = 2;
  string last_planner_response = 3;
}
```

## 139. Round 8 累计统计

| 指标 | 数量 |
|------|------|
| 章节总数 | 139 |
| CortexStepType | **104** (之前统计为 93，新增 11) |
| TeamsTier 枚举 | **21** (完整) |
| Planner 类型 | 8 |
| 工具配置类型 | 40 |
| ReplaceToolVariant | 6 |
| Hook 触发点 | 13 |
| AutoRunDecision | 9 |
| ExecutorTerminationReason | 7 |
| Cortex proto 总行数 | 3,071 |
| codeium_common proto 总行数 | 3,859 |
| api_server proto 总行数 | 2,312 |
| language_server proto 总行数 | 2,337 |
| 静态分析完成度 | **~98%** |

---

## Round 9: Feature Flag / Unleash 系统深度分析

### 140. Unleash 基础架构

Windsurf 使用 [Unleash](https://www.getunleash.io/) 作为 Feature Flag / A/B Test 平台，有两套独立的 Unleash 客户端：

#### 9.1 Extension-Side Unleash Client (Go LS 代理)

| 配置项 | 值 |
|--------|-----|
| **URL** | `https://unleash.codeium.com/api/` |
| **appName** | `codeium-extension` |
| **refreshInterval** | 60,000ms (1分钟) |
| **timeout** | 2,000ms |
| **Production clientKey** | `*:production.ead56b58a77f5ac50d9aa4f987fe381cd78473ec0b1762d5bff9faca` |
| **Staging clientKey** | `*:development.fdc4aa60423d33842aff8b27b03a5eb79eae2303c68661eea8119354` |

选择逻辑: 如果 `codeium.apiServerUrl` 包含 "staging" 则用 staging key，否则用 production key。

#### 9.2 Chat Panel Unleash Client (React前端)

| 配置项 | 值 |
|--------|-----|
| **URL** | `https://unleash.codeium.com/api/frontend/` |
| **appName** | `chat-client` |
| **refreshInterval** | 60 秒 |
| **Production clientKey** | `*:production.a902e0c159994fded827db0c074d3040b534458b13a8398d745df7d2` |

注意: Chat Panel 使用 Frontend API (`/api/frontend/`)，Extension 使用标准 Client API (`/api/`)。

#### 9.3 Sessions Desktop Unleash Client (VS Code Host)

| 配置项 | 值 |
|--------|-----|
| **URL** | `https://unleash.codeium.com/api/frontend` |
| **appName** | `codeium-extension` |
| **Production clientKey** | `*:production.a902e0c159994fded827db0c074d3040b534458b13a8398d745df7d2` |
| **Staging clientKey** | `*:development.717b5b0b7c94dae39d6dc833144c6aa6f08216f1d2d4ef17c2f5b7b1` |

---

### 141. Unleash Context 构造

所有 Unleash 客户端使用一致的 context 结构:

```javascript
{
  userId: metadata.apiKey,        // 用户API key作为userId
  sessionId: metadata.sessionId,  // 会话ID
  properties: {
    ide: metadata.ideName,                    // "windsurf"
    ideVersion: metadata.ideVersion,          // "2.5.0"
    extensionVersion: metadata.extensionVersion,
    disableTelemetry: "true"/"false",
    invocationId: uuid(),                     // 每次刷新生成新UUID
    userTimeWindowId: `${apiKey}:${ISO时间}`, // 时间窗口标识
    devMode: "true"/"false",                  // hasDevExtension()
    planName: metadata.planName,              // 用户订阅计划名
    teamId: metadata.teamId                   // 团队ID
  }
}
```

**Context 刷新机制**:
1. 启动时获取一次 (`_refreshUnleashContext`)
2. 每60秒定时刷新 (`setInterval`)
3. Auth 状态变更时刷新 (`onDidChangeWindsurfAuthStatus` / `onDidUpdateAuthState`)

**数据流**: Extension → `GetUnleashData` RPC → Go LS → 返回 `UnleashContext` + `ExperimentConfig`

---

### 142. 双层实验系统

Windsurf 有两层实验系统并存:

#### Layer 1: Unleash Feature Flags (远程)

直接通过 Unleash SDK 的 `isEnabled(flag)` / `getVariant(flag)` 查询:

**Extension.js 中使用的 Flag (15个)**:
| Flag Name | 功能 |
|-----------|------|
| `ACP_ENABLED` | ACP (Agent Coding Platform) 启用 |
| `CASCADE_AUTO_FIX_LINTS` | Cascade 自动修复 lint 错误 |
| `CASCADE_TERMINAL_PROFILE_DEFAULT_ENABLED` | 终端配置默认启用 |
| `ENABLE_QUICK_ACTIONS` | 快捷操作启用 |
| `ENABLE_SUPERCOMPLETE` | Supercomplete 功能启用 |
| `LSP_TELEMETRY_ENABLED` | LSP 遥测启用 |
| `SUPERCOMPLETE_DEEPWIKI_KILLSWITCH` | DeepWiki 杀手开关 |
| `acp-custom-enabled` | ACP 自定义模式 |
| `devin-cloud-enabled` | Devin 云端功能 |
| `devin-terminal-enabled` | Devin 终端集成 |
| `devin-terminal-default-on` | 终端默认启用 Devin |
| `disable-vibe-and-replace` | 禁用 Vibe-and-Replace |
| `enable-pyrefly` | Pyrefly (Python分析) 启用 |
| `implicit-uses-lint-diff` | 隐式使用 lint diff |
| `RECORD_PRODUCT_EVENT` | 产品事件记录 |

**Sessions.desktop.main.js 中使用的 Flag (6个)**:
| Flag Name | 功能 |
|-----------|------|
| `devin-cli-bundling` | Devin CLI 打包 |
| `disable-vibe-and-replace` | 禁用 Vibe-and-Replace |
| `disable-vibe-and-replace-model-picker` | 禁用模型选择器 |
| `enable-cascade-review-button` | Cascade 审查按钮 |
| `enable-pyrefly` | Pyrefly 启用 |
| `panel` | 面板控制 |

#### Layer 2: ExperimentConfig (Proto-based, 本地+远程)

通过 `ExperimentConfig` protobuf 消息传递，随每个 RPC 请求发送:

```protobuf
message ExperimentConfig {
  repeated ExperimentWithVariant experiments = 6;
  repeated ExperimentKey force_enable_experiments = 1;
  repeated ExperimentKey force_disable_experiments = 2;
  repeated ExperimentWithVariant force_enable_experiments_with_variants = 3;
  repeated string force_enable_experiment_strings = 4;
  repeated string force_disable_experiment_strings = 5;
  bool dev_mode = 7;
}

message ExperimentWithVariant {
  oneof payload {
    string string = 2;
    string json = 3;
    string csv = 4;
  }
  ExperimentKey key = 1;
  string key_string = 5;
  bool disabled = 6;
  ExperimentSource source = 7;
}
```

---

### 143. ExperimentKey 枚举 (173个实验)

完整 `ExperimentKey` 枚举列表，按功能分类:

#### Cascade / AI 核心:
| Key | ID | 功能 |
|-----|-----|------|
| CASCADE_BASE_MODEL_ID | 190 | Cascade 基础模型 |
| CASCADE_PLAN_BASED_CONFIG_OVERRIDE | 266 | 按计划覆盖配置 |
| CASCADE_GLOBAL_CONFIG_OVERRIDE | 212 | 全局配置覆盖 |
| CASCADE_BACKGROUND_RESEARCH_CONFIG_OVERRIDE | 193 | 后台研究配置 |
| CASCADE_ENFORCE_QUOTA | 204 | 配额强制 |
| CASCADE_ENABLE_AUTOMATED_MEMORIES | 224 | 自动记忆 |
| CASCADE_MEMORY_CONFIG_OVERRIDE | 314 | 记忆配置覆盖 |
| CASCADE_USE_REPLACE_CONTENT_EDIT_TOOL | 228 | Replace编辑工具 |
| CASCADE_VIEW_FILE_TOOL_CONFIG_OVERRIDE | 258 | 文件查看工具配置 |
| CASCADE_USE_EXPERIMENT_CHECKPOINTER | 247 | 实验检查点 |
| CASCADE_ENABLE_MCP_TOOLS | 245 | MCP工具启用 |
| CASCADE_AUTO_FIX_LINTS | 275 | 自动修复lint |
| CASCADE_USER_MEMORIES_IN_SYS_PROMPT | 289 | 系统提示中的用户记忆 |
| CASCADE_ENABLE_PROXY_WEB_SERVER | 290 | 代理Web服务器 |
| CASCADE_DEFAULT_MODEL_OVERRIDE | 321 | 默认模型覆盖 |
| CASCADE_WEB_APP_DEPLOYMENTS_ENABLED | 300 | Web应用部署 |
| CASCADE_RECIPES_AT_MENTION_VISIBILITY | 316 | Recipes @提及可见性 |
| CASCADE_WEB_SEARCH_NUX | 311 | Web搜索新用户体验 |
| CASCADE_TOOL_CALL_PRICING_NUX | 322 | 工具调用定价NUX |
| CASCADE_PLUGINS_TAB | 323 | 插件标签页 |
| CASCADE_WINDSURF_BROWSER_TOOLS_ENABLED | 328 | 浏览器工具 |
| CASCADE_MODEL_HEADER_WARNING | 329 | 模型头部警告 |
| CASCADE_ONBOARDING | 326 | 入门引导 |
| CASCADE_ONBOARDING_REVERT | 327 | 入门引导回退 |
| CASCADE_NEW_MODELS_NUX | 259 | 新模型NUX |
| CASCADE_NEW_WAVE_2_MODELS_NUX | 270 | Wave 2 模型NUX |
| COLLAPSE_ASSISTANT_MESSAGES | 312 | 折叠助手消息 |

#### Supercomplete:
| Key | ID | 功能 |
|-----|-----|------|
| ENABLE_SUPERCOMPLETE | 123 | 总开关 |
| SUPERCOMPLETE_FILTER_REVERT | 125 | 撤回过滤 |
| SUPERCOMPLETE_FILTER_PREFIX_MATCH | 126 | 前缀匹配过滤 |
| SUPERCOMPLETE_FILTER_SCORE_THRESHOLD | 127 | 分数阈值 |
| SUPERCOMPLETE_FILTER_INSERTION_CAP | 128 | 插入上限 |
| SUPERCOMPLETE_FILTER_DELETION_CAP | 133 | 删除上限 |
| SUPERCOMPLETE_FILTER_WHITESPACE_ONLY | 156 | 仅空白过滤 |
| SUPERCOMPLETE_FILTER_NO_OP | 170 | 无操作过滤 |
| SUPERCOMPLETE_FILTER_SUFFIX_MATCH | 176 | 后缀匹配 |
| SUPERCOMPLETE_FILTER_PREVIOUSLY_SHOWN | 182 | 已展示过滤 |
| SUPERCOMPLETE_MIN_SCORE | 129 | 最低分数 |
| SUPERCOMPLETE_MAX_INSERTIONS | 130 | 最大插入数 |
| SUPERCOMPLETE_LINE_RADIUS | 131 | 行范围半径 |
| SUPERCOMPLETE_MAX_DELETIONS | 132 | 最大删除数 |
| SUPERCOMPLETE_RECENT_STEPS_DURATION | 138 | 最近步骤时长 |
| SUPERCOMPLETE_MAX_TRAJECTORY_STEPS | 154 | 最大轨迹步骤 |
| SUPERCOMPLETE_MAX_TRAJECTORY_STEP_SIZE | 203 | 步骤大小限制 |
| SUPERCOMPLETE_DISABLE_TYPING_CACHE | 231 | 禁用打字缓存 |
| SUPERCOMPLETE_ALWAYS_USE_CACHE_ON_EQUAL_STATE | 293 | 相等状态缓存 |
| SUPERCOMPLETE_CACHE_ON_PARENT_ID_KILL_SWITCH | 297 | 父ID缓存杀手开关 |
| SUPERCOMPLETE_PRUNE_RESPONSE | 140 | 响应裁剪 |
| SUPERCOMPLETE_PRUNE_MAX_INSERT_DELETE_LINE_DELTA | 141 | 行差异裁剪 |
| SUPERCOMPLETE_MODEL_CONFIG | 145 | 模型配置 |
| SUPERCOMPLETE_MODEL_CONFIG_LOW | 330 | 低配模型 |
| SUPERCOMPLETE_MODEL_CONFIG_HIGH | 331 | 高配模型 |
| SUPERCOMPLETE_ON_TAB | 151 | Tab触发 |
| SUPERCOMPLETE_INLINE_PURE_DELETE | 171 | 纯删除内联 |
| SUPERCOMPLETE_INLINE_RICH_GHOST_TEXT_INSERTIONS | 218 | 富文本幽灵插入 |
| SUPERCOMPLETE_MAX_CONCURRENT_REQUESTS | 284 | 最大并发请求 |
| SUPERCOMPLETE_NO_CONTEXT | 165 | 无上下文模式 |
| SUPERCOMPLETE_NO_ACTIVE_NODE | 166 | 无活动节点 |
| SUPERCOMPLETE_FAST_DEBOUNCE | 262 | 快速防抖 |
| SUPERCOMPLETE_REGULAR_DEBOUNCE | 263 | 常规防抖 |
| SUPERCOMPLETE_DONT_FILTER_MID_STREAMED | 269 | 流式中不过滤 |
| DISABLE_SUPERCOMPLETE_PCW | 303 | 禁用PCW |

#### Tab Jump:
| Key | ID | 功能 |
|-----|-----|------|
| TAB_JUMP_ENABLED | 168 | Tab Jump总开关 |
| TAB_JUMP_ACCEPT_ENABLED | 169 | 接受功能 |
| TAB_JUMP_LINE_RADIUS | 177 | 行半径 |
| TAB_JUMP_MIN_FILTER_RADIUS | 197 | 最小过滤半径 |
| TAB_JUMP_ON_ACCEPT_ONLY | 205 | 仅接受时跳转 |
| TAB_JUMP_FILTER_IN_SELECTION | 215 | 选区内过滤 |
| TAB_JUMP_MODEL_CONFIG | 237 | 模型配置 |
| TAB_JUMP_FILTER_NO_OP | 238 | 无操作过滤 |
| TAB_JUMP_FILTER_REVERT | 239 | 撤回过滤 |
| TAB_JUMP_FILTER_SCORE_THRESHOLD | 240 | 分数阈值 |
| TAB_JUMP_FILTER_WHITESPACE_ONLY | 241 | 空白过滤 |
| TAB_JUMP_FILTER_INSERTION_CAP | 242 | 插入上限 |
| TAB_JUMP_FILTER_DELETION_CAP | 243 | 删除上限 |
| TAB_JUMP_PRUNE_RESPONSE | 260 | 响应裁剪 |
| TAB_JUMP_PRUNE_MAX_INSERT_DELETE_LINE_DELTA | 261 | 行差异裁剪 |
| TAB_JUMP_STOP_TOKEN_MIDSTREAM | 317 | 中流停止 |
| TAB_JUMP_CUMULATIVE_PROMPT_CONFIG | 301 | 累积提示配置 |

#### Autocomplete:
| Key | ID | 功能 |
|-----|-----|------|
| USE_AUTOCOMPLETE_MODEL | 64 | 自动补全模型 |
| USE_AUTOCOMPLETE_MODEL_SERVER_SIDE | 163 | 服务端模型 |
| AUTOCOMPLETE_DEFAULT_DEBOUNCE_MS | 213 | 默认防抖时间 |
| AUTOCOMPLETE_FAST_DEBOUNCE_MS | 214 | 快速防抖时间 |
| AUTOCOMPLETE_HIDDEN_ERROR_REGEX | 234 | 隐藏错误正则 |
| DISABLE_IDE_COMPLETIONS_DEBOUNCE | 278 | 禁用IDE防抖 |
| BLOCK_TAB_ON_SHOWN_AUTOCOMPLETE | 304 | 阻止Tab |
| ONLY_MULTILINE | 60 | 仅多行 |
| USE_MULTILINE_MODEL | 89 | 多行模型 |
| FAST_MULTILINE | 94 | 快速多行 |
| SINGLE_COMPLETION | 95 | 单一补全 |
| FAST_SINGLELINE | 144 | 快速单行 |
| SPLIT_MODEL | 152 | 分割模型 |
| PREDICTIVE_MULTILINE | 160 | 预测多行 |
| FAST_SPEED_KILL_SWITCH | 159 | 快速模式杀手开关 |

#### 模型相关:
| Key | ID | 功能 |
|-----|-----|------|
| USE_INTERNAL_CHAT_MODEL | 36 | 内部聊天模型 |
| CHAT_MODEL_CONFIG | 78 | 聊天模型配置 |
| COMMAND_MODEL_CONFIG | 79 | 命令模型配置 |
| MODEL_CHAT_11121_VARIANTS | 103 | 聊天模型变体A |
| MODEL_CHAT_19821_VARIANTS | 308 | 聊天模型变体B |
| MODEL_LLAMA_3_1_70B_INSTRUCT_LONG_CONTEXT_VARIANTS | 295 | Llama 3.1变体 |
| LLAMA3_405B_KILL_SWITCH | 119 | Llama3 405B杀手开关 |
| XML_TOOL_PARSING_MODELS | 268 | XML工具解析模型 |
| MODEL_NOTIFICATIONS | 319 | 模型通知 |
| MODEL_SELECTOR_NUX_COPY | 320 | 模型选择器NUX |
| FIREWORKS_ON_DEMAND_DEPLOYMENT | 276 | Fireworks按需部署 |

#### Prompt:
| Key | ID | 功能 |
|-----|-----|------|
| INCLUDE_PROMPT_COMPONENTS | 105 | 提示组件包含 |
| COMMAND_PROMPT_CACHE_CONFIG | 255 | 命令提示缓存 |
| CUMULATIVE_PROMPT_CONFIG | 256 | 累积提示配置 |
| CUMULATIVE_PROMPT_CASCADE_CONFIG | 279 | Cascade累积提示 |
| COMMAND_INJECT_USER_MEMORIES | 233 | 注入用户记忆 |
| USE_ANTHROPIC_TOKEN_EFFICIENT_TOOLS_BETA | 296 | Anthropic工具效率 |

#### 系统/基础设施:
| Key | ID | 功能 |
|-----|-----|------|
| CORTEX_CONFIG | 102 | Cortex配置 |
| LANGUAGE_SERVER_VERSION | 55 | LS版本 |
| LANGUAGE_SERVER_AUTO_RELOAD | 56 | LS自动重载 |
| R2_LANGUAGE_SERVER_DOWNLOAD | 147 | R2下载源 |
| SENTRY | 136 | Sentry错误跟踪 |
| WINDSURF_SENTRY_SAMPLE_RATE | 198 | Sentry采样率 |
| API_SERVER_CUTOFF | 158 | API服务器截止 |
| API_SERVER_VERBOSE_ERRORS | 84 | 详细错误 |
| API_SERVER_CLIENT_USE_HTTP_2 | 202 | HTTP/2客户端 |
| API_SERVER_PROMPT_CACHE_REPLICAS | 307 | 提示缓存副本 |
| API_SERVER_ENABLE_MORE_LOGGING | 272 | 更多日志 |
| MIN_IDE_VERSION | 81 | 最低IDE版本 |
| NON_TEAMS_KILL_SWITCH | 106 | 非团队杀手开关 |
| CHAT_COMPLETION_TOKENS_SOFT_LIMIT | 114 | 补全token软限制 |
| CHAT_TOKENS_SOFT_LIMIT | 115 | 聊天token软限制 |
| DISABLE_COMPLETIONS_CACHE | 118 | 禁用缓存 |
| PROFILING_TELEMETRY_SAMPLE_RATE | 219 | 性能遥测采样 |
| SKIP_CONSISTENCY_MANAGER | 194 | 跳过一致性管理 |

#### 功能开关:
| Key | ID | 功能 |
|-----|-----|------|
| ENABLE_SMART_COPY | 181 | 智能复制 |
| ENABLE_COMMIT_MESSAGE_GENERATION | 185 | 提交信息生成 |
| ENABLE_SUGGESTED_RESPONSES | 187 | 建议回复 |
| ENABLE_QUICK_ACTIONS | 250 | 快捷操作 |
| QUICK_ACTIONS_WHITELIST_REGEX | 251 | 快捷操作白名单 |
| ENABLE_AUTOCOMPLETE_DURING_INTELLISENSE | 146 | IntelliSense期间补全 |
| STREAM_USER_SHELL_COMMANDS | 225 | 流式shell命令 |
| STREAMING_EXTERNAL_COMMAND | 172 | 流式外部命令 |
| USE_SPECIAL_EDIT_CODE_BLOCK | 179 | 特殊编辑代码块 |
| USE_COMMAND_DOCSTRING_GENERATION | 121 | 命令文档生成 |
| IMPLICIT_USES_CLIPBOARD | 310 | 隐式使用剪贴板 |
| WAVE_8_RULES_ENABLED | 324 | Wave 8 规则 |
| WAVE_8_KNOWLEDGE_ENABLED | 325 | Wave 8 知识 |
| USE_CUSTOM_CHARACTER_DIFF | 292 | 自定义字符diff |
| FORCE_NON_OPTIMIZED_DIFF | 298 | 非优化diff |

#### 其他:
| Key | ID | 功能 |
|-----|-----|------|
| RECORD_FILES | 47 | 文件记录 |
| NO_SAMPLER_EARLY_STOP | 48 | 采样器无提前停止 |
| CM_MEMORY_TELEMETRY | 53 | CodeMap内存遥测 |
| STOP_FIRST_NON_WHITESPACE_LINE | 96 | 停止非空白行 |
| PERSIST_CODE_TRACKER | 108 | 持久化代码跟踪 |
| ATTRIBUTION_KILL_SWITCH | 92 | 归因杀手开关 |
| USE_ATTRIBUTION_FOR_INDIVIDUAL_TIER | 68 | 个人归因 |
| COLLECT_ONBOARDING_EVENTS | 87 | 收集入门事件 |
| COLLECT_EXAMPLE_COMPLETIONS | 88 | 收集示例补全 |
| DEFAULT_ENABLE_SEARCH | 86 | 默认启用搜索 |
| JETBRAINS_ENABLE_ONBOARDING | 137 | JetBrains入门 |
| COMMAND_BOX_ON_TOP | 155 | 命令框置顶 |
| CONTEXT_ACTIVE_DOCUMENT_FRACTION | 149 | 活动文档上下文比例 |
| CONTEXT_FORCE_LOCAL_CONTEXT | 178 | 强制本地上下文 |
| CROSS_SELL_EXTENSION_DOWNLOAD_WINDSURF | 220 | 交叉推广 |
| VIEWED_FILE_TRACKER_CONFIG | 211 | 文件查看跟踪配置 |
| SNAPSHOT_TO_STEP_OPTIONS_OVERRIDE | 305 | 快照步骤选项 |
| COMPLETION_SPEED_SUPERCOMPLETE_CACHE | 207 | 补全速度缓存 |
| COMPLETION_SPEED_PREDICTIVE_SUPERCOMPLETE | 208 | 预测补全速度 |
| COMPLETION_SPEED_TAB_JUMP_CACHE | 209 | TabJump速度缓存 |
| COMPLETION_SPEED_PREDICTIVE_TAB_JUMP | 210 | 预测TabJump |
| COMPLETION_SPEED_BLOCK_TAB_JUMP_ON_PREDICTIVE_SUPERCOMPLETE | 294 | 阻止预测跳转 |
| ANNOYANCE_MANAGER_MAX_NAVIGATION_RENDERS | 285 | 导航渲染限制 |
| ANNOYANCE_MANAGER_INLINE_PREVENTION_THRESHOLD_MS | 286 | 内联阻止阈值 |
| ANNOYANCE_MANAGER_INLINE_PREVENTION_MAX_INTENTIONAL_REJECTIONS | 287 | 最大有意拒绝 |
| ANNOYANCE_MANAGER_INLINE_PREVENTION_MAX_AUTO_REJECTIONS | 288 | 最大自动拒绝 |
| TEST_ONLY | 999 | 仅测试 |

---

### 144. ExperimentSource 枚举

```protobuf
enum ExperimentSource {
  EXPERIMENT_SOURCE_UNSPECIFIED = 0;
  EXPERIMENT_SOURCE_EXTENSION = 1;      // 来自VS Code扩展
  EXPERIMENT_SOURCE_LANGUAGE_SERVER = 2; // 来自Go LS
  EXPERIMENT_SOURCE_API_SERVER = 3;      // 来自API服务器
}
```

---

### 145. 实验配置覆盖机制

#### VS Code Settings 配置:
| Setting | 功能 |
|---------|------|
| `codeiumDev.forceEnableExperiments` | 强制启用实验 (逗号分隔字符串) |
| `codeiumDev.forceDisableExperiments` | 强制禁用实验 |
| `codeiumDev.forceEnableExperimentsWithVariants` | 带变体强制启用 |

#### 优先级链 (从高到低):
1. **forceEnable/forceDisable** (用户手动设置，最高优先级)
2. **Unleash Remote** (远程 Feature Flag 服务)
3. **Enterprise Config** (多租户模式下的企业配置)
4. **Default** (默认值)

#### isEnabled() 完整逻辑:
```javascript
isEnabled(flag) {
  // 1. 检查强制启用/禁用列表
  if (forceEnabled.includes(flag) && forceDisabled.includes(flag))
    return false; // 冲突时禁用
  if (forceEnabled.includes(flag)) return true;
  if (forceDisabled.includes(flag)) return false;
  
  // 2. 多租户模式走企业配置
  if (isMultiTenantMode)
    return isEnabledInEnterpriseMode(flag);
  
  // 3. 标准模式走Unleash远程
  return unleashClient.isEnabled(flag, context);
}
```

---

### 146. 实验配置同步 RPC

| RPC | 方向 | 功能 |
|-----|------|------|
| `UpdateDevExperiments` | Extension→LS | 同步用户forceEnable/Disable设置到LS |
| `SetBaseExperiments` | Extension→LS | 设置基础实验列表 |
| `GetUnleashData` | Extension→LS→API | 获取Unleash上下文和实验配置 |
| `ShouldEnableUnleash` | Extension→LS | 询问是否应启用Unleash |
| `UpdateEnterpriseExperimentsFromUrl` | Admin→LS | 从URL更新企业实验 |
| `CheckExperiment` | Extension→LS | 检查单个实验是否启用 |

#### Proto 定义:
```protobuf
message GetUnleashDataRequest {
  Metadata metadata = 1;
  map<string, string> properties = 2;
}

message GetUnleashDataResponse {
  UnleashContext context = 1;
  ExperimentConfig experiment_config = 2;
}

message UnleashContext {
  string user_id = 1;
  string session_id = 2;
  map<string, string> properties = 3;
}

message ShouldEnableUnleashRequest {}
message ShouldEnableUnleashResponse {
  bool should_enable = 1;
}

message CheckExperimentRequest {
  string experiment_key = 1;
  map<string, string> context_overrides = 2;
}

message CheckExperimentResponse {
  bool enabled = 1;
  optional ExperimentVariant variant = 2;
  optional string error_message = 3;
}

message ExperimentVariant {
  string name = 1;
  ExperimentPayload payload = 2;
}

message ExperimentPayload {
  string type = 1;
  string value = 2;
}
```

---

### 147. ExperimentConfig 在请求中的传播

`ExperimentConfig` 被嵌入到几乎所有重要的 RPC 请求中:

| 请求 | 作用 |
|------|------|
| `GetCompletionsRequest.experiment_config` | 自动补全时携带 |
| `GetCompletionsResponse.experiment_config` | 服务端返回更新 |
| `HeartbeatRequest.experiment_config` | 心跳同步 |
| `AcceptCompletionRequest.experiment_config` | 接受补全时 |
| `InitializeCascadeRequest.experiment_config` | Cascade初始化 |
| `SendUserCascadeMessageRequest.experiment_config` | 每条消息 |
| `RejectCascadeStepRequest.experiment_config` | 拒绝步骤 |
| `CaptureFileRequest.experiment_config` | 文件捕获 |
| `CortexConfig.experiment_config` | Cortex配置中 |

---

### 148. 多租户 / 企业模式

当 `isMultiTenantMode()` 为 true 时:
- 不连接 Unleash 远程服务器
- 通过 LS 的 `GetUnleashData` 获取 `experimentConfig`
- 实验配置由企业管理员在后台设置
- 使用 `UpdateEnterpriseExperimentsFromUrl` 从企业URL同步

```javascript
isEnabledInEnterpriseMode(flag) {
  for (exp of enterpriseExperimentConfig.experiments) {
    if (exp.keyString === flag)
      return !exp.disabled;
  }
  return false; // 未配置则禁用
}
```

---

### 149. localStorage 持久化

Chat Panel 侧使用 localStorage 缓存 Unleash 启用状态:
```javascript
// 缓存key: "windsurf:enableUnleash"
localStorage.setItem("windsurf:enableUnleash", String(shouldEnable))
// 用于在LS未就绪时提供快速回退值
```

---

### 150. CascadeConfig 构造

Extension 发送 Cascade 消息时构造的配置:

```javascript
// 标准 Cascade 消息
new CascadeConfig({
  plannerConfig: new CascadePlannerConfig({
    plannerTypeConfig: {
      case: "conversational",
      value: new CascadeConversationalPlannerConfig({})
    },
    requestedModelUid: userSelectedModel
  })
})

// Vibe-and-Replace 模式
new CascadeConfig({
  plannerConfig: new CascadePlannerConfig({
    plannerTypeConfig: {
      case: "conversational",
      value: new CascadeConversationalPlannerConfig({})
    },
    requestedModelUid: "MODEL_CLAUDE_4_SONNET", // 硬编码
    isVibeAndReplace: true
  })
})
```

---

### Round 9 统计更新

| 指标 | 值 |
|------|-----|
| ExperimentKey 枚举数量 | **173** |
| Unleash Feature Flags (Extension) | 15 |
| Unleash Feature Flags (Chat Panel) | 6 |
| Unleash 客户端数量 | 3 (Extension/Chat/Sessions) |
| Unleash API Keys | 4 (2 prod + 2 staging) |
| 实验同步 RPC | 6 |
| ExperimentConfig 传播点 | 9+ |
| ExperimentSource | 4 |
| VS Code 实验配置设置 | 3 |
| 静态分析完成度 | **~99%** |

---

## Round 10: Go LS Binary 逆向 (Ghidra + 符号表提取)

### 151. Go Binary 基础信息

| 项目 | 值 |
|------|-----|
| 文件 | `windsurf-next/resources/app/extensions/windsurf/bin/language_server_windows_x64.exe` |
| 大小 | **163.7 MB** |
| 架构 | Windows x86_64, Go 编译 |
| 总符号数 | **67,957** (Go 保留完整符号表) |
| Exafunction 符号 | **34,202** |
| Go 内部包 | **134** 个 (github.com/Exafunction/Exafunction/exa/) |

### 152. Go 包层级架构 (134 个内部包)

#### 核心包

| 包路径 | 功能 |
|--------|------|
| `cortex` | Cortex 执行引擎顶层 |
| `cortex/executors` | CascadeExecutor + ParallelCascadeExecutor |
| `cortex/handlers` | 所有工具 Handler (40+) |
| `cortex/managers` | Mixin 系统 + SystemPrompt Section |
| `cortex/brain` | Brain 计划管理 |
| `cortex/config` | Cascade 配置适配 + Unleash 覆盖 |
| `cortex/memories` | Memory 系统 |
| `cortex/tools` | 工具注册和管理 |
| `cortex/state` | 状态管理 |
| `cortex/traj` | Trajectory 操作 |
| `cortex/implicit` | 隐式上下文 |
| `cortex/interfaces` | 接口定义 |
| `cortex/utils/mcp` | MCP 工具支持 |
| `cortex/proto_saver` | Proto 序列化 |

#### Language Server 包

| 包路径 | 功能 |
|--------|------|
| `language_server` | LS 主服务 |
| `language_server/api_server_client` | API 服务器连接 |
| `language_server/chat` | Chat 处理 |
| `language_server/chat_client_server_client` | Chat 客户端 |
| `language_server/completion_provider` | 自动补全提供器 |
| `language_server/completions_state` | 补全状态管理 |
| `language_server/context_module` | 上下文模块 |
| `language_server/context_module/relevance` | 相关性评估 |
| `language_server/cortex/nodes` | Cortex 节点 |
| `language_server/cortex/types` | Cortex 类型 |
| `language_server/diff_action` | Diff 操作 |
| `language_server/documentmanager` | 文档管理 |
| `language_server/extension_server_client` | Extension 回调客户端 |
| `language_server/ls_unleash` | LS Unleash 集成 |
| `language_server/lsp` | LSP 协议 |
| `language_server/mquery` | MQuery 搜索 |
| `language_server/prompt` | Prompt 构建 |
| `language_server/streaming` | 流式处理 |
| `language_server/supercomplete` | Supercomplete |
| `language_server/tab` | Tab 补全 |
| `language_server/vibe_and_replace` | Vibe-and-Replace 模式 |
| `language_server/user_settings` | 用户设置 |

#### 支撑包

| 包路径 | 功能 |
|--------|------|
| `prompt` | 系统提示构建核心 |
| `prompt/cumulative_prompt_handler` | 累积 Prompt 处理 |
| `chat_utils/tool_parsers` | 工具调用解析 (Hermes/Qwencoder/XML/Supercomplete) |
| `tokenizer` | Token 计算 |
| `tree_sitter` | 语法解析 |
| `model_uid` | 模型 UID 管理 |
| `model_family_uid` | 模型族 UID |
| `harness_uid` | Harness UID |
| `unleash` | Unleash 客户端 |
| `git_manager` | Git 操作 |
| `git_utils/git_cci` | Git CCI |
| `web_scraping` | 网页抓取 |
| `web_app_deployment` | 应用部署 |
| `hooks` | Hook 系统 |
| `proxy` | 代理服务器 |
| `reactive_component` | Reactive 增量更新 |

### 153. System Prompt Section 架构 (31 个 Section)

通过 Go 符号表发现系统提示由 **31 个可组合的 Section** 构成，每个 Section 实现 4 个方法：
- `GetName()` → Section 名称
- `GetDefaultContent()` → 默认内容（嵌入在 binary 中的字符串常量）
- `GetOverrideConfig()` → Unleash 覆盖配置
- `ShouldInclude()` → 是否包含该 Section

#### Section 列表

| # | Section 类型 | XML 标签 | 描述 |
|---|-------------|---------|------|
| 1 | `IdentitySection` | N/A | Agent 身份定义 |
| 2 | `CommunicationSection` | `communication_style` | 回复风格规则 |
| 3 | `MakingCodeChangesSection` | `making_code_changes` | 代码编辑纪律 |
| 4 | `ToolCallingSection` | `tool_calling` | 工具使用规则 |
| 5 | `RunningCommandsSection` | `running_commands` | 终端命令安全规则 |
| 6 | `TaskManagementSection` | `task_management` | 计划/TODO 管理 |
| 7 | `DebuggingSection` | `debugging` | 调试纪律 |
| 8 | `CallingExternalAPIsSection` | `calling_external_apis` | 外部 API 使用规则 |
| 9 | `WorkflowsSection` | `workflows` | Workflow 系统 |
| 10 | `MemorySystemSection` | `memory_system` | Memory CRUD |
| 11 | `UserRulesSection` | `user_rules` | 用户自定义规则 (AGENTS.md) |
| 12 | `UserInformationSection` | `user_information` | OS/Workspace/Corpus |
| 13 | `IdeMetadataSection` | `ide_metadata` | 活动文档/光标/打开文件 |
| 14 | `WorkspaceInformationSection` | `workspace_information` | 工作区布局 |
| 15 | `CodeResearchSection` | `code_research` | 代码库探索策略 |
| 16 | `TestCodeSection` | N/A | 测试相关任务处理 |
| 17 | `ChatModeSection` | `chat_mode` | Chat 模式特定行为 |
| 18 | `EvalModeSection` | `eval_mode` | 评估模式行为 |
| 19 | `EphemeralMessageSection` | N/A | 临时状态消息 |
| 20 | `McpServersSection` | `mcp_servers` | MCP 服务器配置 |
| 21 | `KnowledgeBaseSection` | `knowledge_base` | 知识库项目查找 |
| 22 | `AdditionalInstructionsSection` | N/A | 动态附加指令 |
| 23 | `CodemapsAboutCodemapsSection` | N/A | Codemap 说明 |
| 24 | `CodemapsReadOnlySection` | N/A | Codemap 只读模式 |
| 25 | `LifeguardIdentitySection` | `lifeguard_identity` | Lifeguard 身份 |
| 26 | `LifeguardInstructionsSection` | `lifeguard_instructions` | Lifeguard 指令 |
| 27 | `LifeguardOutputFormatSection` | `lifeguard_output_format` | Lifeguard 输出格式 |
| 28 | `LifeguardReadOnlySection` | `lifeguard_read_only` | Lifeguard 只读 |
| 29 | `LifeguardV2SystemPromptSection` | N/A | Lifeguard V2 系统提示 |
| 30 | `PassiveCoderIdentitySection` | N/A | 被动编码器身份 |
| 31 | `PassiveCoderCommunicationSection` | N/A | 被动编码器通信 |

#### Section 与 Planner 的对应关系

根据 Mixin 类型，不同 Planner 使用不同的 Section 组合：

- **CascadeConversationalMixin** → Identity + Communication + MakingCodeChanges + ToolCalling + RunningCommands + TaskManagement + Debugging + CallingExternalAPIs + Workflows + Memory + UserRules + UserInfo + IdeMetadata + WorkspaceInfo + CodeResearch + TestCode
- **CascadeAgentMixin** → 同上 (agent 模式)
- **CascadeCodemapMixin** → 同上 + Codemaps sections
- **CascadeLifeguardMixin** → Lifeguard* sections
- **CascadePrReviewMixin** → PR Review 相关 sections
- **CascadeSmartLintMixin** → SmartLint 相关 sections
- **PassivePlannerMixin** → PassiveCoder* sections

### 154. System Prompt 已提取文本片段

从 binary 的 `.rodata` 段提取到的关键 prompt 文本（Go 字符串连续存储，边界为近似值）：

#### Identity Variants

| 变体 | 文本 |
|-------|------|
| Agent (高级) | `You are Cascade, a powerful agentic AI coding assistant acting as a senior pair programmer.` |
| Agent (标准) | `You are Cascade, a powerful agentic AI coding assistant.` |
| Agent (IDE) | `You are an agentic AI coding assistant working in the user's IDE to pair program and complete coding tasks.` |
| Smart | `You are a smart coding assistant.` |

#### 已确认的指令文本

```
- Be terse and direct.
- Direct responses: Begin responses immediately with the substantive content.
  Do not acknowledge, validate, or express agreement with the user's request before addressing it.
- Be concise and avoid unnecessary verbosity.
- Format your messages with Markdown.
- Do not overstep your bounds.
- NEVER output code to the USER, unless requested.
- Prefer minimal, focused edits using the [edit] or [multi_edit] tools.
- Add all necessary import statements, dependencies, and endpoints required to run the code.
- Your generated code must be immediately runnable.
- Use only the available tools. Never guess parameters.
- If a tool exists for an action, prefer to use the tool instead of shell commands.
- THIS IS CRITICAL: When using the [run_command] tool NEVER include `cd` as part of the command.
- You must NEVER NEVER run a command automatically if it could be unsafe.
- Always set the `cwd` param when using run_command. Do not use `cd` in commands.
- Before creating a new memory, first check to see if a semantically related memory already exists.
- You DO NOT need to be conservative about creating memories.
- The following are user-defined rules that you MUST ALWAYS FOLLOW WITHOUT ANY EXCEPTION.
- When exploring a new or unfamiliar area of the codebase, focus first on mapping the main entry points.
- Identify likely call sites or consumers that must be updated.
- When working on test-related tasks, you may proactively run tests regardless of mode.
- Do not attempt to fix unrelated bugs or broken tests.
- When user asks for 'review', default to a code review mindset: prioritize identifying bugs, risks,
  behavioural regressions, and missing tests.
- Always explain what you're doing in a commentary message FIRST, BEFORE sampling an analysis thinking message.
- For tasks that have no prior context, you should feel free to be ambitious and demonstrate creativity.
- While you are working, you might notice unexpected changes that you didn't make.
  If this happens, STOP IMMEDIATELY and ask the user how they would like to proceed.
- If asked to make a commit or code edits and there are unrelated changes, don't revert those changes.
- Your git authentication has been set up correctly, any errors are because you are doing something wrong.
- Bug fixing discipline: Prefer minimal upstream fixes over downstream workarounds.
- Long-horizon workflow: For multi-session work, consider keeping concise notes.
- Planning cadence: Draft a succinct plan for non-trivial tasks.
- Testing discipline: Design or update tests before major implementation work.
- Verification tools: Prefer available automated verification to confirm work.
- Progress notes: Prefer lightweight workspace artifacts over long chat recaps.
```

#### 工作区布局模板

```xml
<workspace_layout workspace="%s">
%s
</workspace_layout>
```

#### 格式化/引用规则

```
- Valid (multi-line):
  @/Users/alice/projects/myapp/src/utils/file.py:1-3
- ALWAYS use citation format when mentioning any file path
- When explaining, always reference relevant file, directory, function, class or symbol names/paths
  by backticking them in Markdown to provide accurate citations.
```

#### Token 长度指导

```
*50-300 tokens* for simple queries,
*300-800 tokens* for complex tasks.
```

### 155. CascadeExecutor 执行器架构

#### 单体执行器 (CascadeExecutor)

| 方法 | 功能 |
|------|------|
| `Execute()` | 主执行循环 (含 3 个 deferwrap + 3 个内部 func) |
| `handleStep()` | 处理单个 CortexStep |
| `shouldBreakExecutorLoop()` | 判断是否退出循环 |
| `passesInitialBreakConditions()` | 初始退出条件检查 |
| `stepsContainTerminalStepType()` | 检查终止步骤类型 |
| `maybeAddCheckpointStep()` | 可能添加检查点步骤 |
| `maybeAddReflectionSteps()` | 可能添加反思步骤 |
| `maybeAddRetrieveMemoryStep()` | 可能添加记忆检索步骤 |
| `maybeInjectLintFixMessage()` | 可能注入 Lint 修复消息 |
| `holdForValidCheckpointState()` | 等待有效检查点状态 |

#### 并行执行器 (ParallelCascadeExecutor)

| 方法 | 功能 |
|------|------|
| `Execute()` | 并行执行主循环 |
| `RolloutFromGuide()` | 从 Guide 生成 Rollout |
| `newGuideGenerator()` | 创建 Guide 生成器 |
| `newGuideJudgeConfig()` | 创建 Guide 判断配置 |
| `newJudgeExecutor()` | 创建 Judge 执行器 |
| `newRolloutGenerator()` | 创建 Rollout 生成器 |
| `rolloutAgentConfig()` | Rollout Agent 配置 |

#### 执行器配置 (CascadeExecutorConfig)

```
- DisableAsync: 禁用异步
- EnableBackgroundLinting: 启用后台 Lint
- HoldForValidCheckpoint: 等待有效检查点
- HoldForValidCheckpointTimeout: 检查点超时
- MaxGeneratorInvocations: 最大生成器调用次数
- MaxLintInjectionCount: 最大 Lint 注入次数
- ResearchOnly: 仅研究模式
- RunPendingSteps: 运行待处理步骤
- TerminalStepTypes: 终止步骤类型
- UseAggressiveSnapshotting: 使用积极快照
```

### 156. Cortex Handler 完整映射 (40+ Handlers)

从符号表提取到的所有 `NewXxxHandler` 构造函数：

| Handler | 对应 CortexStepType |
|---------|---------------------|
| `NewAddAnnotationHandler` | CORTEX_STEP_TYPE_ADD_ANNOTATION |
| `NewAskUserQuestionHandler` | CORTEX_STEP_TYPE_ASK_USER_QUESTION |
| `NewBrainUpdateHandler` | CORTEX_STEP_TYPE_BRAIN_UPDATE |
| `NewCheckDeployStatusHandler` | CORTEX_STEP_TYPE_CHECK_DEPLOY_STATUS |
| `NewCheckpointHandler` | CORTEX_STEP_TYPE_CHECKPOINT |
| `NewClusterQueryHandler` | CORTEX_STEP_TYPE_CLUSTER_QUERY |
| `NewCodeActionHandler` | CORTEX_STEP_TYPE_CODE_ACTION |
| `NewCompileHandler` | CORTEX_STEP_TYPE_COMPILE |
| `NewCustomToolHandler` | CORTEX_STEP_TYPE_CUSTOM_TOOL |
| `NewDeployWebAppHandler` | CORTEX_STEP_TYPE_DEPLOY_WEB_APP |
| `NewEditNotebookHandler` | CORTEX_STEP_TYPE_EDIT_NOTEBOOK |
| `NewExitPlanModeHandler` | CORTEX_STEP_TYPE_EXIT_PLAN_MODE |
| `NewFileBreakdownHandler` | CORTEX_STEP_TYPE_FILE_BREAKDOWN |
| `NewFindAllReferencesHandler` | CORTEX_STEP_TYPE_FIND_ALL_REFERENCES |
| `NewFindCodeContextHandler` | CORTEX_STEP_TYPE_FIND_CODE_CONTEXT |
| `NewFindHandler` | CORTEX_STEP_TYPE_FIND |
| `NewGrepHandler` | CORTEX_STEP_TYPE_GREP |
| `NewGrepSearchV2Handler` | CORTEX_STEP_TYPE_GREP_SEARCH_V2 |
| `NewInspectClusterHandler` | CORTEX_STEP_TYPE_INSPECT_CLUSTER |
| `NewIntentHandler` | CORTEX_STEP_TYPE_INTENT |
| `NewListClustersHandler` | CORTEX_STEP_TYPE_LIST_CLUSTERS |
| `NewListDirHandler` | CORTEX_STEP_TYPE_LIST_DIR |
| `NewListResourcesHandler` | CORTEX_STEP_TYPE_LIST_RESOURCES |
| `NewMcpHandler` | CORTEX_STEP_TYPE_MCP |
| `NewMemoryHandler` | CORTEX_STEP_TYPE_MEMORY |
| `NewPostPRReviewHandler` | CORTEX_STEP_TYPE_POST_PR_REVIEW |
| `NewProposeCodeHandler` | CORTEX_STEP_TYPE_PROPOSE_CODE |
| `NewProxyWebServerHandler` | CORTEX_STEP_TYPE_PROXY_WEB_SERVER |
| `NewReadDeploymentConfigHandler` | CORTEX_STEP_TYPE_READ_DEPLOYMENT_CONFIG |
| `NewReadNotebookHandler` | CORTEX_STEP_TYPE_READ_NOTEBOOK |
| `NewReadResourceHandler` | CORTEX_STEP_TYPE_READ_RESOURCE |
| `NewReadTerminalHandler` | CORTEX_STEP_TYPE_READ_TERMINAL |
| `NewReadUrlContentHandler` | CORTEX_STEP_TYPE_READ_URL_CONTENT |
| `NewRelatedFilesHandler` | CORTEX_STEP_TYPE_RELATED_FILES |
| `NewResolveTaskHandler` | CORTEX_STEP_TYPE_RESOLVE_TASK |
| `NewRetrieveMemoryHandler` | CORTEX_STEP_TYPE_RETRIEVE_MEMORY |
| `NewRunCommandHandler` | CORTEX_STEP_TYPE_RUN_COMMAND |
| `NewSearchWebHandler` | CORTEX_STEP_TYPE_SEARCH_WEB |
| `NewSemanticCodebaseSearchHandler` | CORTEX_STEP_TYPE_SEMANTIC_CODEBASE_SEARCH |
| `NewSmartFriendHandler` | CORTEX_STEP_TYPE_SMART_FRIEND |
| `NewSupercompleteFeedbackHandler` | CORTEX_STEP_TYPE_SUPERCOMPLETE_FEEDBACK |
| `NewTaskSubagentHandler` | CORTEX_STEP_TYPE_TASK_SUBAGENT |
| `NewTrajectorySearchHandler` | CORTEX_STEP_TYPE_TRAJECTORY_SEARCH |
| `NewUpsertCodemapHandler` | CORTEX_STEP_TYPE_UPSERT_CODEMAP |
| `NewViewContentChunkHandler` | CORTEX_STEP_TYPE_VIEW_CONTENT_CHUNK |
| `NewViewFileHandler` | CORTEX_STEP_TYPE_VIEW_FILE |

### 157. Cortex Config 覆盖机制 (Go 实现)

从符号表提取的 `cortex/config` 包函数：

| 函数 | 功能 |
|------|------|
| `adaptBrainConfig` | Brain 配置适配 |
| `adaptCascadeConfig` | Cascade 配置适配 |
| `adaptCheckpointConfig` | 检查点配置适配 |
| `adaptDeprecatedModelFields` | 弃用模型字段适配 |
| `adaptMemoryConfig` | Memory 配置适配 |
| `adaptParallelRolloutConfig` | 并行 Rollout 配置适配 |
| `adaptPlannerConfig` | Planner 配置适配 |
| `applyCheckpointConfig` | 应用检查点配置 |
| `applyEnterpriseConfigOverrides` | 应用企业配置覆盖 |
| `applyUnleashFullCascadeOverrideConfig` | **Unleash 完整 Cascade 覆盖** |
| `applyUnleashMemoryOverrideConfig` | **Unleash Memory 覆盖** |
| `applyUnleashSystemPromptSectionOverrideConfig` | **Unleash System Prompt Section 覆盖** |
| `augmentConversationalConfigWithExperiment` | 用实验增强对话配置 |
| `augmentPassiveConfigWithExperiment` | 用实验增强被动配置 |
| `cacheApiServerExperimentValues` | 缓存 API 服务器实验值 |
| `IsCascadeConfigWithToolChoice` | 检查是否有工具选择 |
| `maybeUpdateCascadeBaseModel` | 可能更新 Cascade 基础模型 |
| `MergeConfigs` | 合并配置 |
| `validateConfig` | 验证配置 |

**关键发现**: `applyUnleashSystemPromptSectionOverrideConfig` 证实系统提示的每个 Section 都可以通过 Unleash Feature Flag **远程覆盖**。

### 158. 工具调用解析器 (chat_utils/tool_parsers)

| 解析器类型 | FormatSystemPrompt | 描述 |
|-----------|-------------------|------|
| `HermesToolFormatter` | ✅ | Hermes 格式 (Nous/DeepSeek) |
| `QwencoderToolFormatter` | ✅ | Qwen 格式 |
| `SupercompleteToolFormatter` | ✅ | Supercomplete 专用 |
| `XMLToolFormatter` | ✅ | XML 格式 (Claude/Sonnet) |

每种解析器都有 `FormatSystemPrompt` 方法，说明工具描述会注入到系统提示中。

### 159. Prompt 构建核心 (prompt 包)

| 函数/类型 | 功能 |
|-----------|------|
| `SystemPromptElements` | 系统提示元素容器 |
| `SystemPromptElements.ToPromptWithLimit` | 带限制的 prompt 构建 |
| `SystemPromptElements.ToMinimalPrompt` | 最小 prompt |
| `SystemPromptElementsFromPromptComponents` | 从组件构建 |
| `DefaultCascadeSystemPromptForCumulativePrompt` | 默认 Cascade 系统提示 |
| `defaultCascadeSystemPromptParts` | 默认系统提示部件 |
| `CascadeSystemPromptForCumulativePromptWithUserMemories` | 含用户记忆的系统提示 |
| `ReadCumulativePromptConfigFromUnleash` | **从 Unleash 读取 Prompt 配置** |
| `ProcessTrajectoryForCumulativePrompt` | 处理 Trajectory |
| `ConstructCombinedChatCompletionPrompt` | 构建组合 Chat 提示 |
| `ConstructDocumentOutline` | 构建文档大纲 |
| `ConstructGuidelinePromptElement` | 构建指南提示元素 |
| `BuildCommandIntentInfo` | 构建命令意图信息 |
| `BuildSupercompleteIntentInfo` | 构建 Supercomplete 意图 |
| `StreamingReplaceFileContentParser` | 流式替换文件内容解析 |
| `UnifiedPromptComponentsWrapper` | 统一提示组件包装器 |

### 160. CascadeWrapper 完整方法列表

`CascadeWrapper` 是对 Cascade 会话的完整包装，管理消息队列、步骤、遥测等：

| 方法 | 功能 |
|------|------|
| `AddToMessageQueue` | 添加到消息队列 |
| `PopFromMessageQueue` | 从队列弹出 |
| `PeekFromMessageQueue` | 窥视队列 |
| `MoveQueuedMessage` | 移动排队消息 |
| `ClearMessageQueue` | 清空消息队列 |
| `ClearSteps` | 清空步骤 |
| `Clone` | 克隆会话 |
| `Close` | 关闭会话 |
| `AddGeneratorMetadata` | 添加生成器元数据 |
| `AppendExecutorMetadata` | 追加执行器元数据 |
| `AcknowledgeCodeEdit` | 确认代码编辑 |
| `CommitArchiveState` | 提交归档状态 |
| `PopWorktreeMerge` | 弹出工作树合并 |
| `processPendingUpdates` | 处理待处理更新 |
| `applyUpdate` | 应用更新 |
| `maybeUploadArenaModeTelemetry` | 可能上传 Arena 遥测 |
| `maybeUploadStepTelemetry` | 可能上传步骤遥测 |

### Round 10 统计更新

| 指标 | 值 |
|------|-----|
| Go Binary 大小 | 163.7 MB |
| Go 符号总数 | 67,957 |
| Exafunction 专有符号 | 34,202 |
| Go 内部包数量 | 134 |
| System Prompt Sections | **31** |
| Cortex Handlers (Go 实现) | 46 |
| 工具调用解析器 | 4 (Hermes/Qwen/Supercomplete/XML) |
| CascadeExecutor 方法 | 10 |
| ParallelCascadeExecutor 方法 | 7 |
| Cortex Config 适配函数 | 19 |
| Prompt 构建函数 | 15+ |
| CascadeWrapper 方法 | 16+ |
| System Prompt 已提取指令 | 30+ 条 |
| 分析完成度 | **~99.5%** (Ghidra 反编译进行中) |

### 161. 新发现的 System Prompt 指令 (Round 10 补充)

#### 内部系统提示变体

| 变体名称 | 文本 |
|-----------|------|
| Analysis Mode Title Gen | `ENTER ANALYSIS MODE\nDONT TAKE ANY ACTIONS. ONLY OUTPUT YOUR ANALYSIS FOLLOWING THE PROVIDED FORMAT\nGenerate a short conversation title around 3-5 words describing the USER's intent...` |
| Expert Summary | `You are an expert AI coding assistant and are pair programming with a USER to solve a coding task. When asked, you focus on outlining the USER's main goals and anticipating likely next steps they will take.` |
| Serialized Conversation | `-- THIS IS A SERIALIZED HUMAN-READABLE VERSION OF A CONVERSATION BETWEEN A USER AND ANOTHER AI MODEL. YOU SHOULD STILL CALL TOOLS AS DESCRIBED IN YOUR SYSTEM PROMPT. --` |

#### 行为指令（补充）

```
- Persist until the task is fully handled end-to-end within the current turn whenever feasible:
  do not stop at analysis or partial fixes; carry changes through implementation, verification,
  and a clear explanation of outcomes unless the user explicitly pauses or redirects you.
- When working in interactive modes, hold off on running tests or lint commands until the user is
  ready for you to finalize your output, because these commands take time to run and slow down
  iteration. Instead suggest what you want to do next, and let the user confirm first.
- Your final message should read naturally, like an update from a concise teammate.
  For casual conversation, brainstorming tasks, or quick questions from the user, respond in a
  friendly, conversational tone. You should ask questions, suggest ideas, and adapt to the user's style.
- Analyze the codebase and understand the structure. Trace upwards and downwards, digging into
  implementations as well as callsites, to provide a comprehensive answer.
- Trace across service boundaries and abstractions to find the core pieces of logic that make up
  the full code path.
- No tools are available for this task. Please do your best to respond to the USER's request using
  only the information already provided to you.
- Never lie or make things up.
```

### 162. 工具描述完整提取 (33 个工具)

| # | 工具名称 | 描述长度 | Binary Offset |
|---|---------|----------|---------------|
| 1 | `edit` | 1300 chars | 55940762 |
| 2 | `multi_edit` | 1976 chars | 55988524 |
| 3 | `view_file / read_file` | 2000+ chars | 55901584 |
| 4 | `write_to_file` | 2000+ chars | 55845286 |
| 5 | `run_command` | 2000+ chars | 55898418 |
| 6 | `command_status` | 454 chars | 55860977 |
| 7 | `grep_search` | short | 55355704 |
| 8 | `find_by_name` | 2000+ chars | 55868945 |
| 9 | `code_search (Fast Context)` | 2000+ chars | 55929042 |
| 10 | `browser_preview` | short | 55582361 |
| 11 | `deploy_web_app` | short | 55684631 |
| 12 | `read_deployment_config` | short | 55762081 |
| 13 | `check_deploy_status` | 2000+ chars | 55821519 |
| 14 | `update_plan / todo_list` | 2000+ chars | 55782616 |
| 15 | `create_memory` | 2000+ chars | 55688506 |
| 16 | `ask_user_question` | 2000+ chars | 55696759 |
| 17 | `search_web` | 2000+ chars | 55735733 |
| 18 | `read_url_content` | 2000+ chars | 55655541 |
| 19 | `view_content_chunk` | 2000+ chars | 55803965 |
| 20 | `trajectory_search` | 2000+ chars | 55809620 |
| 21 | `read_notebook` | 2000+ chars | 55533992 |
| 22 | `edit_notebook` | 734 chars | 55892525 |
| 23 | `list_dir` | 2000+ chars | 55844919 |
| 24 | `list_resources (MCP)` | 251 chars | 55813485 |
| 25 | `read_resource (MCP)` | 2000+ chars | 55399835 |
| 26 | `propose_code` | short | 55542597 |
| 27 | `bash` | short | 55542653 |
| 28 | `apply_patch` | 2000+ chars | 55498764 |
| 29 | `skill` | 365 chars | 55632234 |
| 30 | `report_bugs` | 2000+ chars | 55783692 |
| 31 | `restricted_exec (Fast Context 子代理)` | 2000+ chars | 56206978 |
| 32 | `cluster_query` | 2000+ chars | 55784237 |
| 33 | `code_search_v2` | 2000+ chars | 55777776 |

### 163. Fast Context 子代理完整系统提示

`restricted_exec` 是 Fast Context 工具的内部子代理，完整系统提示提取如下：

```
- Allowed sub-commands (schema-enforced):
  - rg: Search for patterns in files using ripgrep
    - Required: pattern (string), path (string)
    - Optional: include (array of globs), exclude (array of globs)
  - readfile: Read contents of a file with optional line range
    - Required: file (string)
    - Optional: start_line (int), end_line (int) — 1-indexed, inclusive
  - tree: Display directory structure as a tree
    - Required: path (string)
    - Optional: levels (int)

# THINKING RULES
- Think step-by-step. Plan, reason, and reflect before each tool call.
- Use tool calls liberally and purposefully to ground every conclusion in real code.
- If a command fails, rethink and try something different; do not complain to the user.

# FAST-SEARCH DEFAULTS
- Start NARROW, then widen only if needed.
- Prefer fixed-string search for literals; use smart case.
- Prefer file-type filters and globs over full-repo scans.
- Default EXCLUDES: node_modules, .git, dist, build, coverage, .venv, venv, target, out,
  .cache, __pycache__, vendor, deps, third_party, logs, data, *.min.*
- Limit directory traversal with tree levels to quickly orient before deeper inspection.

# WORKFLOWS
- MAP: tree + rg on likely roots
- ANCHOR: rg for keywords, restrict by language globs
- TRACE: Follow imports with targeted rg, readfile scoped to semantic blocks
- VERIFY: Confirm each candidate, drop false positives

# TOOL USE
- Single restricted_exec call, at most %d commands per turn.
- Each command result may be truncated to 50 lines.
- DO NOT EVER USE MORE THAN %d commands in a single turn.

# ANSWER FORMAT
<ANSWER>
  <file path="/codebase/...">
    <range>10-60</range>
  </file>
</ANSWER>
```

### 164. Planner-to-Section 组合关系 (10 种 Mixin)

每种 Mixin 实现统一接口：`GetSystemPrompt()`, `GetToolConverters()`, `GetToolOptions()`, `TrajectoryToChatMessages()`, `ShouldTerminate()`, `GetEphemeralMessage()`

| # | Mixin 类型 | 角色 |
|---|-----------|------|
| 1 | `CascadeConversationalMixin` | 对话式 Cascade |
| 2 | `CascadeAgentMixin` | Agent 模式 |
| 3 | `CascadeCodemapMixin` | Codemap 模式 |
| 4 | `CascadeLifeguardMixin` | Lifeguard 守护 |
| 5 | `CascadePrReviewMixin` | PR Review |
| 6 | `CascadeSmartLintMixin` | 智能 Lint |
| 7 | `PassivePlannerMixin` | 被动规划器 |
| 8 | `RetrieveMemoryMixin` | 记忆检索 |
| 9 | `SingleEntryUpdaterMixin` | 单条目更新 (Brain) |
| 10 | `TaskSubagentMixin` | 任务子代理 |
| 11 | `TrajectoryJudgeSubagentMixin` | 轨迹评判子代理 |

### 165. 内部模型 UID 完整列表 (从 Binary 提取)

#### GPT 系列

| 模型 UID | 优先级/备注 |
|----------|------------|
| `gpt-5-5-low` | 默认模型 |
| `gpt-5-5-medium` / `gpt-5-5-high` / `gpt-5-5-xhigh` | 不同优先级 |
| `gpt-5-5-none` / `gpt-5-5-review` | |
| `gpt-5-4-low` / `gpt-5-4-medium` / `gpt-5-4-high` / `gpt-5-4-xhigh` | |
| `gpt-5-4-mini-low` / `gpt-5-4-mini-medium` / `gpt-5-4-mini-high` / `gpt-5-4-mini-xhigh` | |
| `gpt-5-3-codex-low` / `gpt-5-3-codex-medium` / `gpt-5-3-codex-high` / `gpt-5-3-codex-xhigh` | Codex 系列 |
| `gpt-5-3-codex-spark-medium` / `gpt-5-3-codex-spark-preview` | Spark 变体 |
| `gpt-5-codex` / `gpt-5-nano` / `gpt-5-pro-2025-10-06` | |
| `gpt-5-2025-08-07` | |
| `gpt-5.1-codex` / `gpt-5.1-codex-max` | |
| `gpt-5.2-codex` / `gpt-5.2-2025-12-11` | |
| `gpt-5.3-codex` / `gpt-5.4` / `gpt-5.4-mini` / `gpt-5.5` | |
| `gpt-oss-120b` / `cognition-gpt-oss-120b` | 开源 120B |
| `gpt-4.1-2025-04-14` / `gpt-4.1-mini-2025-04-14` / `gpt-4.1-nano-2025-04-14` | |

#### Claude 系列

| 模型 UID | 备注 |
|----------|------|
| `claude-opus-4-7-low` / `claude-opus-4-7-medium` / `claude-opus-4-7-high` / `claude-opus-4-7-xhigh` / `claude-opus-4-7-max` | Opus 4.7 |
| `claude-opus-4-6` / `claude-opus-4-6-fast` / `claude-opus-4-6-1m` / `claude-opus-4-6-1m-max` | Opus 4.6 |
| `claude-opus-4-6-thinking` / `claude-opus-4-6-thinking-1m` / `claude-opus-4-6-thinking-1m-max` / `claude-opus-4-6-thinking-fast` | Thinking 变体 |
| `claude-sonnet-4-6` / `claude-sonnet-4-6-1m` / `claude-sonnet-4-6-thinking` / `claude-sonnet-4-6-thinking-1m` | Sonnet 4.6 |
| `claude-sonnet-4-5-20250929` / `claude-opus-4-5-20251101` | 日期版本 |
| `haiku-4.5` | |

#### Gemini 系列

| 模型 UID | 备注 |
|----------|------|
| `gemini-3.1-pro` / `gemini-3-1-pro-low` / `gemini-3-1-pro-high` | Gemini 3.1 Pro |
| `gemini-3.0-pro` / `gemini-3-pro` | Gemini 3.0 Pro |
| `gemini-3.0-flash` / `gemini-3-flash-preview` | Flash |
| `gemini-2.5-pro` / `gemini-2.5-flash` / `gemini-2.5-flash-lite` | |

#### 其他模型

| 模型 UID | 备注 |
|----------|------|
| `deepseek-r1-slow` / `deepseek-v3` / `deepseek-v3p2` / `deepseek-v4` / `deepseek-v4-pro` | DeepSeek |
| `kimi-k2-5` / `kimi-k2-6` / `kimi-k2-instruct-0905` / `kimi-k2-thinking` | Kimi K2 |
| `o1-mini` / `o1-preview` / `o3` / `o3-mini` / `o3-pro-2025-06-10` / `o4-mini-2025-04-16` | OpenAI O 系列 |
| `artemis-low` / `artemis-medium` / `artemis-high` / `artemis-max` | Artemis (内部?) |
| `jupiter-low` / `jupiter-medium` / `jupiter-high` / `jupiter-xhigh` | Jupiter (内部?) |
| `neptune-low` / `neptune-medium` / `neptune-high` / `neptune-xhigh` | Neptune (内部?) |
| `glacier-alpha` / `crest-alpha` / `skyhawk` / `fiercefalcon` | 代号模型 |
| `crispy-unicorn` / `crispy-unicorn-thinking` | 独角兽? |
| `swe-1-6-fast` / `swe-1-6-live` / `swe-check` | SWE-bench |
| `mimic-mixed` / `mimic-review` / `mimic-smart` | Mimic |
| `arena-smart` / `arena-mixed` / `arena-dev-only` | Arena |
| `adaptive-dev` / `sglang-rollout` | 开发/评测 |

### 166. apply_patch 工具 XML 格式

从 binary 中发现 `apply_patch` 使用 XML 格式：

```xml
<%s path="%s" language="%s">
<old_str>%s</old_str>
<new_str>%s</new_str>
</%s>
```

这证实 Windsurf 内部使用了类似 Claude Code 的 `apply_patch` XML 差异格式。

### Round 10 最终统计

| 指标 | 值 |
|------|-----|
| Go Binary 大小 | 163.7 MB |
| Go 符号总数 | 67,957 |
| Exafunction 专有符号 | 34,202 |
| Go 内部包数量 | **134** |
| System Prompt Sections | **31** |
| System Prompt 身份变体 | **5** |
| Cortex Handlers (Go 实现) | **46** |
| 工具描述已提取 | **33** |
| Mixin 类型 | **11** |
| 模型 UID (从 binary) | **100+** |
| 新指令文本已提取 | **30+** 条 |
| Ghidra 状态 | 分析进行中 |
| 分析完成度 | **~99.7%** |

### 167. ToolConverter 完整映射 (58 个)

58 个 ToolConverter 覆盖了所有工具的参数 schema、描述和行为。

#### 代码编辑类 (7 种变体)

| ToolConverter | 编辑格式 | 描述 |
|--------------|---------|------|
| `EditFileToolConverter` | old_string/new_string | 标准精确替换 (edit) |
| `MultiReplaceFileContentToolConverter` | edits[] array | 多编辑 (multi_edit) |
| `SingleReplaceFileContentToolConverter` | ReplacementChunks | 替换块 |
| `DiffSearchReplaceToolConverter` | SEARCH/REPLACE diff | 搜索替换差异 |
| `ApplyPatchToolConverter` | XML `<old_str>/<new_str>` | 标准 apply_patch |
| `OpenAIApplyPatchToolConverter` | OpenAI 格式 patch | OpenAI 兼容 patch |
| `FreeformApplyPatchToolConverter` | freeform patch | 自由格式 patch |

Go 泛型暴露了各变体的 JSON Schema：

```go
// CodeEdit (Vibe-and-Replace 模式)
CodeEdit string `jsonschema_description:"Specify ONLY the precise lines of code 
  that you wish to edit. **NEVER specify or write out unchanged code**. Instead, 
  represent all unchanged code using this special placeholder: {{ ... }}"`

// Diff Search/Replace
Diff []string `jsonschema_description:"Array of diff strings in the SEARCH/REPLACE 
  format. There should be exactly one replacement per diff string."`

// Apply Patch
Input string `jsonschema_description:"The patch that you wish to apply."`

// ReplacementChunks
ReplacementChunks []*ReplacementChunk `jsonschema_description:"A list of chunks to 
  replace. It is best to provide multiple chunks for non-contiguous edits if possible. 
  This must be a JSON array, not a string."`
```

#### 搜索/浏览类

| ToolConverter | 描述 |
|--------------|------|
| `ViewFileToolConverter` | 查看文件 (含 outline、line numbers、file bytes 配置) |
| `ReadFileToolConverter` | 读取文件 |
| `GrepSearchToolConverter` | ripgrep 搜索 |
| `GrepSearchV2ToolConverter` | grep v2 |
| `FindToolConverter` | fd 文件查找 |
| `SearchInFileToolConverter` | 文件内搜索 |
| `CodebaseSearchToolConverter` | 语义代码搜索 |
| `ListDirToolConverter` | 列出目录 |
| `FindAllReferencesToolConverter` | LSP 查找引用 |
| `FindReferencesToolConverter` | 查找引用 |
| `GotoDefinitionToolConverter` | 转到定义 |
| `FindCodeContextToolConverter` | 代码上下文 |
| `ClusterQueryToolConverter` | 聚类查询 |
| `InspectClusterToolConverter` | 检查聚类 |
| `ListClustersToolConverter` | 列出聚类 |
| `RelatedFilesToolConverter` | 相关文件 |

#### 执行/命令类

| ToolConverter | 描述 |
|--------------|------|
| `RunCommandToolConverter` | 运行命令 |
| `CommandStatusToolConverter` | 命令状态 |
| `BashToolConverter` | Bash 命令 |
| `ReadTerminalToolConverter` | 读取终端 |

#### 部署/Web

| ToolConverter | 描述 |
|--------------|------|
| `DeployWebAppToolConverter` | 部署 Web 应用 |
| `ReadDeploymentConfigToolConverter` | 部署配置 |
| `CheckDeployStatusToolConverter` | 部署状态 |
| `ProxyWebServerToolConverter` | Web 预览代理 |

#### 知识/记忆/规划

| ToolConverter | 描述 |
|--------------|------|
| `MemoryToolConverter` | 记忆管理 |
| `ReadKnowledgeBaseItemToolConverter` | 知识库 |
| `TodoListToolConverter` | TODO 列表 |
| `UpdatePlanToolConverter` | 更新计划 |
| `TaskSubagentToolConverter` | 子代理 |
| `SmartFriendToolConverter` | Fast Context |
| `TrajectorySearchToolConverter` | 轨迹搜索 |
| `SkillToolConverter` | 技能调用 |

#### 其他

| ToolConverter | 描述 |
|--------------|------|
| `AskUserQuestionToolConverter` | 提问用户 |
| `SearchWebToolConverter` | Web 搜索 |
| `ReadUrlContentToolConverter` | 读取 URL |
| `WriteToFileToolConverter` | 写入文件 |
| `EditNotebookToolConverter` | 编辑 Notebook |
| `ReadNotebookToolConverter` | 读取 Notebook |
| `McpToolConverter` | MCP 工具 |
| `ListResourcesToolConverter` | MCP 资源列表 |
| `ReadResourceToolConverter` | MCP 读取资源 |
| `AddAnnotationToolConverter` | 添加注释 |
| `PostPrReviewToolConverter` | PR Review |
| `ReportBugsToolConverter` | 报告 Bug |
| `FixBugsToolConverter` | 修复 Bug |
| `SuggestedResponsesToolConverter` | 建议回复 |
| `ExitPlanModeToolConverter` | 退出计划模式 |
| `FinishToolConverter` | 完成工具 |
| `ResolveTaskToolConverter` | 解决任务 |
| `AutoCascadeBroadcastToolConverter` | Auto Cascade 广播 |
| `CreateCodemapToolConverter` | 创建 Codemap |
| `EditCodemapToolConverter` | 编辑 Codemap |

### 168. ViewFile 配置参数 (从 Go 符号提取)

`ViewFileToolConverter` 暴露了大量可配置参数：

| 参数 | 类型 | 描述 |
|------|------|------|
| `GetMaxDocLinesFraction` | float | 文档最大行数比例 |
| `GetMaxLinesPerView` | int | 每次查看的最大行数 |
| `GetMaxTokensPerOutline` | int | 每个 outline 的最大 token |
| `GetMaxTotalOutlineBytes` | int | outline 的最大总字节 |
| `GetShowFullFileBytes` | int | 显示完整文件的字节阈值 |
| `GetShowTriggeredMemories` | bool | 是否显示触发的记忆 |
| `GetSplitOutlineTool` | bool | 是否分离 outline 工具 |
| `GetUseLineNumbersForRaw` | bool | 是否使用行号 |
| `GetUsePromptPrefix` | bool | 是否使用 prompt 前缀 |
| `GetUseViewFileV2` | bool | 是否使用 V2 版本 |

### 169. cortex/managers Go 源文件结构 (27 个文件)

| 文件名 | 功能 |
|--------|------|
| `prompt_builder.go` | PromptBuilder 组装逻辑 |
| `conversational_prompt_sections.go` | 对话模式 Section 定义 |
| `lifeguard_prompt_sections.go` | Lifeguard Section 定义 |
| `lifeguard_v2_prompt_sections.go` | Lifeguard V2 Section |
| `passive_prompt_sections.go` | 被动模式 Section |
| `codemap_prompt_sections.go` | Codemap Section |
| `cascade_agent_mixin.go` | Agent Mixin |
| `cascade_conversational_mixin.go` | 对话 Mixin |
| `cascade_codemap_mixin.go` | Codemap Mixin |
| `cascade_lifeguard_mixin.go` | Lifeguard Mixin |
| `cascade_pr_review_mixin.go` | PR Review Mixin |
| `cascade_smart_lint_mixin.go` | Smart Lint Mixin |
| `passive_planner_mixin.go` | 被动规划器 Mixin |
| `retrieve_memory_mixin.go` | 记忆检索 Mixin |
| `single_entry_updater_mixin.go` | 单条目更新 Mixin |
| `task_subagent_mixin.go` | 任务子代理 Mixin |
| `base_mixin.go` | 基类 Mixin |
| `planner_generator.go` | Planner 生成器 |
| `tool_converter_factory.go` | 工具转换器工厂 |
| `tool_profiles.go` | 工具配置文件 |
| `trajectory_chat_converter.go` | 轨迹聊天转换 |
| `step_string_converters.go` | 步骤字符串转换 |
| `lifeguard_string_converters.go` | Lifeguard 字符串转换 |
| `judge_converter.go` | 评判转换器 |
| `ephemeral.go` | 临时消息 |
| `image_captioner.go` | 图片描述 |
| `no_tool_context.go` | 无工具上下文 |

### 170. @Item 提及系统

从 binary 中发现 Cascade 支持 `@[ITEM]` 提及语法：

```
The user has mentioned some items in the form @[ITEM]. Here is extra information 
about the items that were mentioned by the user, in the order that they appear:
```

Codemap 标签系统：
```
The user tagged %s, but the whole codemap is provided for context:
%s
Reminder: The user specifically tagged %s, not the entire codemap. 
Keep responses focused.
```

Codemap 跳过生成：
```
The system suggested creating a codemap based on the conversation so far, 
but the user decided to skip generating it. Continue as if the suggestion never happened.
```

### 171. Executor 完整架构 (5 种 + 2 种 Wrapper)

#### Executor 类型

| Executor | 文件 | 方法数 | 描述 |
|----------|------|--------|------|
| `CascadeExecutor` | cascade_executor.go | 10 | 核心单轮执行器 |
| `ParallelCascadeExecutor` | parallel_executor.go | 14+ | 并行 rollout 执行器 |
| `ReplayExecutor` | replay_executor.go | 3 | 重放已有轨迹 |
| `RevertExecutor` | revert_executor.go | 3 | 撤回操作 |
| `SubagentExecutor` | (嵌入) | 4 | 子代理执行器 |

#### CascadeExecutor 核心方法

```
Execute()                       — 主执行循环
handleStep()                    — 处理单个步骤
shouldBreakExecutorLoop()       — 循环终止条件
passesInitialBreakConditions()  — 初始中断检查
stepsContainTerminalStepType()  — 终止步骤检测
maybeAddCheckpointStep()        — 可能添加检查点
maybeAddReflectionSteps()       — 可能添加反思步骤
maybeAddRetrieveMemoryStep()    — 可能检索记忆
maybeInjectLintFixMessage()     — 可能注入 lint 修复
holdForValidCheckpointState()   — 等待有效检查点
```

#### ParallelCascadeExecutor 配置

| 参数 | 描述 |
|------|------|
| `NumParallelRollouts` | 并行 rollout 数 |
| `MaxInvocationsPerRollout` | 每个 rollout 最大调用次数 |
| `MaxGuideInvocations` | guide 模型最大调用次数 |
| `GuideModelUid` | guide 模型 UID |
| `ForceBadRollout` | 强制坏结果 (测试用) |

Parallel 执行包含 `newGuideGenerator`, `newGuideJudgeConfig`, `newJudgeExecutor`, `newRolloutGenerator`, `RolloutFromGuide`, `rolloutAgentConfig`。

#### Wrapper 类型

| Wrapper | 方法数 | 描述 |
|---------|--------|------|
| `CascadeWrapper` | 79 | 轨迹状态管理 |
| `ExecutionCascadeWrapper` | 50+ | 执行期间的 Wrapper |

### 172. Hooks 执行引擎 (完整提取)

| 函数 | 描述 |
|------|------|
| `executeHook` | 执行单个 Hook |
| `executeHookWithInput` | 带输入执行 Hook |
| `RunPreToolUseHooks` | 工具使用前 Hook |
| `RunPostToolUseHooks` | 工具使用后 Hook |
| `RunPostCascadeResponseHooks` | Cascade 响应后 Hook |
| `RunPostCascadeResponseWithTranscriptHooks` | 带 transcript 的响应后 Hook |
| `RunPostSetupWorktreeHooks` | Worktree 设置后 Hook |
| `HasPostSetupWorktreeHooks` | 检查是否有 Worktree Hook |
| `loadHooksFromFile` | 从文件加载 Hook |
| `LoadHooksFromMultipleLocations` | 从多个位置加载 |
| `parseAndConvertHooks` | 解析并转换 Hook |
| `convertConfigToCascadeHooks` | 配置转 Hook |
| `stepMatchesHookCondition` | 步骤匹配 Hook 条件 |
| `agentActionMatchesPrePost` | Agent 动作匹配前后 |
| `agentActionToStepTypes` | Agent 动作到步骤类型 |
| `augmentHookExecutionWithWorkingDir` | 增强 Hook 执行目录 |
| `createCmdInput` | 创建命令输入 |
| `createPostCascadeResponseCmdInput` | 创建响应后输入 |
| `createPostCascadeResponseCmdInputWithTranscript` | 带 transcript 的输入 |
| `createPostSetupWorktreeCmdInput` | Worktree 输入 |

### 173. Diff 解析器

| 函数 | 描述 |
|------|------|
| `parseSearchReplaceBlock` | 解析 SEARCH/REPLACE 格式 |
| `parseV4ADiffFormat` | 解析 V4A diff 格式 |
| `generateEditsFromToolInfo` | 从工具信息生成编辑 |

### 174. 规则/记忆系统 (Executor 层)

| 函数 | 描述 |
|------|------|
| `formatSessionRules` | 格式化会话规则 |
| `formatTriggeredRules` | 格式化触发的规则 |
| `extractMentionedManualRuleIDs` | 提取手动提及的规则 ID |
| `ExtractRuleIDsFromTriggeredMemories` | 从触发的记忆中提取规则 |
| `buildRuleContext` | 构建规则上下文 |

### 175. Transcript/Summary 系统

| 函数 | 描述 |
|------|------|
| `stepsToMarkdown` | 步骤转 Markdown |
| `stepToSummaryMarkdown` | 步骤摘要 Markdown |
| `stepToTranscriptJSON` | 步骤转 Transcript JSON |
| `writeTranscriptFile` | 写入 Transcript 文件 |
| `stepTypeToReadable` | 步骤类型可读名 |
| `stepStatusToReadable` | 步骤状态可读名 |

### 176. 确认的 XML Section 标签名

以下 XML 标签经 binary 搜索确认存在（作为开/闭标签对使用）：

| Section | XML 标签名 | 确认方式 |
|---------|-----------|---------|
| CommunicationSection | `<communication_guidelines>` | open+close |
| MakingCodeChangesSection | `<making_code_changes>` | name offset |
| CallingExternalAPIsSection | `<calling_external_apis>` | name offset |
| RunningCommandsSection | `<running_commands>` | open+close |
| DebuggingSection | `<debugging>` | name offset |
| ToolCallingSection | `<tool_calling>` | open+close |
| TaskManagementSection | `<task_management>` | name offset |
| UserRulesSection | `<user_rules>` | open+close |
| UserInformationSection | `<user_information>` | name offset |
| IdeMetadataSection | `<ide_metadata>` | name offset |
| MemorySystemSection | `<memory_system>` | open+close |
| WorkflowsSection | `<workflows>` | name offset |
| MarkdownFormattingSection | `<markdown_formatting>` | open+close |
| CitationGuidelinesSection | `<citation_guidelines>` | open+close |
| KnowledgeBaseSection | `<knowledge_base>` | name offset |
| McpServersSection | `<mcp_servers>` | name offset |
| EphemeralMessageSection | `<ephemeral_message>` | open |
| WorkspaceInformationSection | `<workspace_information>` | name offset |
| CodeResearchSection | `<code_research>` | name offset |
| EvalModeSection | `<eval_mode>` | name offset |
| AdditionalInstructionsSection | `<additional_instructions>` | name offset |
| CodemapsAboutCodemapsSection | `<about_codemaps>` | tag confirmed |
| LifeguardReadOnlySection | `<lifeguard_read_only>` | name offset |
| LifeguardIdentitySection | `<lifeguard_identity>` | name offset |
| LifeguardInstructionsSection | `<lifeguard_instructions>` | name offset |
| LifeguardOutputFormatSection | `<lifeguard_output_format>` | name offset |
| LifeguardV2SystemPromptSection | `<lifeguard_v2_system_prompt>` | name offset |
| (额外) | `<review_guide>` | tag confirmed |
| (额外) | `<broadcasting>` | tag confirmed |

### 177. Implicit Trajectory 系统

`cortex/implicit` 包管理隐式轨迹——用户无需显式操作即可自动追踪：

| 组件 | 方法数 | 描述 |
|------|--------|------|
| `UserImplicitTrajectoryManager` | 20+ | 隐式轨迹管理器 |
| `UserImplicitTrajectoryWrapper` | 25+ | 轨迹包装器 |
| `workspaceEventRouter` | 8 | 工作区事件路由 |

关键功能：
- **Git 集成**: `createGitWatcher`, `watchGitEvents`, `handleCommitEvent`, `segmentStepsByCommit`
- **文件监控**: `CreateFile`, `DeleteFile`, `UpdateFile`, `shouldIgnorePath`
- **持久化**: `saveTrajectory`, `loadTrajectory`, `debouncedSave`
- **反应式**: `StreamReactiveUpdates`, `initReactiveState`, `processUpdate`
- **快照**: `OverrideSnapshotFileState`, `WithContentOverrides`, `WithPostDiffContentOverrides`

### 178. PlannerGenerator — LLM 调用核心

`PlannerGenerator` 是连接 Mixin/Section 和 LLM API 的关键组件：

| 方法 | 描述 |
|------|------|
| `Generate()` | 主生成入口 |
| `buildChatMessageRequest` | 构建 GetChatMessage 请求 |
| `handleToolCall` | 处理工具调用返回 |
| `processPlannerModelOutputs` | 处理模型输出 |
| `shouldHalt` / `shouldRetry` | 终止/重试条件 |
| `shouldRetryBasedOnContent` | 基于内容的重试 |
| `shouldShowErrorToUser` | 错误可见性判断 |
| `addFeedbackForToolParseErrorRetry` | 工具解析错误反馈 |
| `getTools` | 获取当前工具集 |
| `refreshModelAssignmentJwt` | 刷新模型 JWT |

#### PlannerGenerator 配置参数

| 参数 | 描述 |
|------|------|
| `GetPlanModelUid` | 计划模型 UID |
| `GetRequestedModelUid` | 请求的模型 UID |
| `GetMaxIterations` | 最大迭代次数 |
| `GetMaxOutputTokens` | 最大输出 token |
| `GetMaxStepParseRetries` | 最大步骤解析重试 |
| `GetTruncationThresholdTokens` | 截断阈值 token |
| `GetIsVibeAndReplace` | 是否 Vibe-and-Replace 模式 |
| `GetRunAsProposer` | 是否作为 Proposer 运行 |
| `GetAllowPendingSteps` | 是否允许待处理步骤 |
| `GetForbidToolUseOnLastRetry` | 最后重试禁止工具使用 |
| `GetIncludeEphemeralMessage` | 是否包含临时消息 |
| `GetPromptOverride` | 提示覆盖 |
| `GetRetryOnResponseContent` | 基于响应内容重试 |
| `GetShowAllErrors` | 是否显示所有错误 |
| `GetNoToolExplanation` | 无工具解释文本 |

#### Planner 类型配置

| 方法 | Planner 类型 |
|------|-------------|
| `GetConversational` | conversational |
| `GetConversationalV2` | conversational_v2 |
| `GetAgentic` | agentic |
| `GetResearch` | research |
| `GetPassive` | passive |
| `GetAgentV2` | agent_v2 |
| `GetCodemap` | codemap |
| `GetLifeguard` | lifeguard |

### 179. Handler 完整列表 (49 个)

| # | Handler | 功能 | 特殊方法 |
|---|---------|------|---------|
| 1 | `AddAnnotationHandler` | 添加注释 | |
| 2 | `AskUserQuestionHandler` | 提问用户 | Printf |
| 3 | `BlockingHandler` | 阻塞操作 | |
| 4 | `BrainUpdateHandler` | Brain 更新 | WithBenign |
| 5 | `CheckDeployStatusHandler` | 部署状态检查 | |
| 6 | `CheckpointHandler` | 检查点 | async goroutine |
| 7 | `ClusterQueryHandler` | 聚类查询 | async goroutine |
| 8 | `CodeActionHandler` | 代码操作 (核心) | handleFastApplyFallback, handleReplaceFileContentWithFallback |
| 9 | `CommandStatusHandler` | 命令状态 | WithCutOnLineBoundary, WithTruncationPriority |
| 10 | `CustomToolHandler` | LSP 操作 | handleFindReferences, handleGotoDefinition, appendReverseCallHierarchy, Revert |
| 11 | `DeployWebAppHandler` | 部署 Web | |
| 12 | `EditNotebookHandler` | 编辑 Notebook | WithBenign |
| 13 | `ExitPlanModeHandler` | 退出计划模式 | |
| 14 | `FileBreakdownHandler` | 文件分解 | |
| 15 | `FindAllReferencesHandler` | 查找所有引用 | |
| 16 | `FindCodeContextHandler` | 代码上下文 | async goroutine |
| 17 | `FindHandler` | 文件查找 | WithBenign |
| 18 | `GrepHandler` | ripgrep 搜索 | WithBenign×3 |
| 19 | `GrepSearchV2Handler` | grep v2 | WithBenign×3 |
| 20 | `InspectClusterHandler` | 检查聚类 | |
| 21 | `IntentHandler` | 意图处理 | |
| 22 | `ListClustersHandler` | 列出聚类 | |
| 23 | `ListDirHandler` | 列出目录 | WithBenign |
| 24 | `ListResourcesHandler` | MCP 资源列表 | |
| 25 | `McpHandler` | MCP 工具调用 | |
| 26 | `MemoryHandler` | 记忆操作 | |
| 27 | `NoOpHandler` | 无操作 | |
| 28 | `PostPRReviewHandler` | PR Review | |
| 29 | `ProposeCodeHandler` | 代码提议 | |
| 30 | `ProxyWebServerHandler` | Web 预览代理 | |
| 31 | `ReadDeploymentConfigHandler` | 部署配置 | |
| 32 | `ReadNotebookHandler` | 读取 Notebook | WithBenign |
| 33 | `ReadResourceHandler` | MCP 读取资源 | |
| 34 | `ReadTerminalHandler` | 读取终端 | |
| 35 | `ReadUrlContentHandler` | 读取 URL | WithBenign×3 |
| 36 | `RelatedFilesHandler` | 相关文件 | async goroutine |
| 37 | `ReportBugsHandler` | 报告 Bug | |
| 38 | `ResolveTaskHandler` | 解决任务 | WithBenign |
| 39 | `RetrieveMemoryHandler` | 检索记忆 | |
| 40 | `RunCommandHandler` | 运行命令 (最复杂) | 7 个子函数, WithBenign×3 |
| 41 | `SearchWebHandler` | Web 搜索 | |
| 42 | `SemanticCodebaseSearchHandler` | 语义搜索 | WithBenign |
| 43 | `SmartFriendHandler` | Fast Context | |
| 44 | `SupercompleteFeedbackHandler` | Supercomplete 反馈 | |
| 45 | `TaskSubagentHandler` | 子代理任务 | |
| 46 | `TodoListHandler` | TODO 列表 | |
| 47 | `TrajectorySearchHandler` | 轨迹搜索 | |
| 48 | `UpsertCodemapHandler` | 创建/更新 Codemap | |
| 49 | `ViewContentChunkHandler` | 查看内容块 | |
| 50 | `ViewCodeItemHandler` | 查看代码项 | WithBenign |
| 51 | `ViewFileHandler` | 查看文件 | handleDirectoryListing, handleImageFile, handleV2 |

#### WithBenign 模式

多个 Handler 使用 `WithBenign` 选项——这是一个安全标记，表示该操作"良性"不会对系统造成修改（只读操作）。具有 `WithBenign` 的 Handler 包括：
`BrainUpdate`, `EditNotebook`, `Find`, `Grep`, `GrepV2`, `ListDir`, `ReadNotebook`, `ReadUrlContent`, `ResolveTask`, `RunCommand`, `SemanticCodebaseSearch`, `ViewCodeItem`, `ViewFile`, `CodeAction`

### 180. Language Server 内部子包完整列表 (41 个)

| # | 子包 | 功能 |
|---|------|------|
| 1 | `action` | 代码操作 |
| 2 | `api_server_client` | API 服务器客户端 |
| 3 | `cache` | 缓存 |
| 4 | `chat` | 聊天处理 |
| 5 | `chat_client_server_client` | Chat Client Server 客户端 |
| 6 | `code_tracker` | 代码追踪 (AI 写的代码追踪) |
| 7 | `commit_graph` | Git 提交图 |
| 8 | `commit_messages` | 提交消息生成 |
| 9 | `completion_provider` | 补全提供器 |
| 10 | `completion_store` | 补全存储 |
| 11 | `completion_utils` | 补全工具 |
| 12 | `completions_state` | 补全状态 |
| 13 | `context_module` | 代码上下文模块 (核心) |
| 14 | `diff_action` | Diff 操作 (38 个函数) |
| 15 | `directory_utils` | 目录工具 |
| 16 | `documentindex` | 文档索引 |
| 17 | `documentmanager` | 文档管理器 |
| 18 | `edit_distance` | 编辑距离 |
| 19 | `extension_server_client` | Extension Server 客户端 |
| 20 | `git_log_utils` | Git 日志工具 |
| 21 | `indexed_repos_cache` | 索引仓库缓存 |
| 22 | `interceptor` | gRPC 拦截器 |
| 23 | `language_server_defaults` | 默认配置 |
| 24 | `language_utils` | 语言工具 |
| 25 | `ls_unleash` | Unleash 集成 (模型配置) |
| 26 | `lsp` | LSP 协议 |
| 27 | `metadata_provider` | Metadata 单例 |
| 28 | `mquery` | MQuery 检索 |
| 29 | `native_storage_migrations` | 原生存储迁移 |
| 30 | `onboarding` | 用户引导 |
| 31 | `other_docs` | 其他文档 |
| 32 | `performance` | 性能监控 |
| 33 | `pipe_watcher` | 命名管道监控 |
| 34 | `prompt` | Prompt 构建 |
| 35 | `session` | 会话管理 |
| 36 | `state` | 状态管理 |
| 37 | `streaming` | 流式处理 |
| 38 | `supercomplete` | Supercomplete (Tab 补全增强) |
| 39 | `tab` | Tab 补全 |
| 40 | `user_settings` | 用户设置 |
| 41 | `user_status` | 用户状态 |
| 42 | `vibe_and_replace` | Vibe-and-Replace 模式 |

### 181. Vibe-and-Replace 详细架构

完整揭露 Vibe-and-Replace 模式的内部实现：

| 组件 | 描述 |
|------|------|
| `VibeEditToolConverter` | 编辑工具转换器 |
| `VibeSkipToolConverter` | 跳过工具 |
| `GenerateVibeAndReplace` | 核心生成函数 |
| `GetCascadeConfig` | 获取 Cascade 配置 |
| `getLLMResponseWithToolCalls` | 获取 LLM 响应 |
| `CreateSummaryStep` | 创建摘要步骤 |
| `toCitationUri` | 转换为引用 URI |

Go 泛型暴露的参数 Schema：
```go
vibeEditArgs {
    Edits []vibeEditArgs `json:"edits" 
        jsonschema_description:"Array of edit operations to perform 
        sequentially on the file" jsonschema:"minItems=1"`
}
```

### 182. CodeTracker — AI 代码追踪系统

`code_tracker` 包追踪 AI 生成代码的完整生命周期：

| 组件 | 方法数 | 描述 |
|------|--------|------|
| `CodeTracker` | 8 | 单文件代码追踪 |
| `CodeTrackerManager` | 18 | 全局追踪管理 |
| `CodeRangeManager` | 3 | 代码范围管理 |
| `UserDataUploader` | 6 | 数据上传器 |
| `codeTrackerWorkspaceListener` | 8 | 工作区监听 |

关键流程：
```
代码生成 → acceptCascadeDiffs/AcceptCompletion → CodeRange 创建
→ updateCodeTrackerState → 持久化到磁盘
→ UserDataUploader.UploadCodeTrackerUpdate → 服务器
→ UploadOpportunity → 上传"机会"数据
```

每个 `CodeRange` 包含：
- 文件路径、起止行号、偏移量
- 关联的 commit (`RepoWithCommit`)
- 序列化为 Proto (`ToProto`)

### 183. Supercomplete — Tab 补全增强

| 组件 | 方法数 | 描述 |
|------|--------|------|
| `TabQueueManager` | 16 | Tab 队列管理 |
| `RequestManager` | 4 | 请求管理 |
| `Debouncer` | 3 | 防抖器 |

完整流程：
```
用户输入 → DebounceRequest → StartCompletionRequest
→ buildPredictiveRequestLocked (预测性预取)
→ AddSuggestion → WaitForSuggestion
→ GetCachedSuggestionIfAvailable (缓存命中)
→ CompleteSuggestion → HandleCompletionFeedback
```

关键方法：
- `buildPredictiveRequestLocked` — 在用户完成当前补全前预测下一步
- `shouldRatelimit` — 速率限制
- `shouldFilterSuggestion` — 过滤低质量建议
- `getQueueLengthLimit` — 队列长度限制

### 184. ls_unleash — Unleash 模型配置

从 Unleash Feature Flags 动态获取模型配置：

| 函数 | 描述 |
|------|------|
| `addHardcodedExperiments` | 添加硬编码实验 |
| `GetChatModelConfig` | 聊天模型配置 |
| `GetCommandModelConfig` | 命令模型配置 |
| `GetSupercompleteModelConfig` | Supercomplete 模型 |
| `GetSupercompleteModelConfigV1Compatible` | V1 兼容模型 |
| `GetSupercompleteModelConfigWithAggression` | 带激进度的配置 |
| `GetTabJumpModelConfig` | Tab Jump 模型 |
| `GetEnterpriseExperiments` | 企业实验 |
| `GetAndParseProtoVariant` | 解析 Proto 变体 |
| `GetStringVariantAsIntFromKey` | 字符串变体转整数 |

### 185. CumulativePromptHandler — 增量 Prompt 构建

| 方法 | 描述 |
|------|------|
| `ConstructCumulativePrompt` | 构建增量 Prompt (核心) |
| `ConstructCumulativeSupercompletePrompt` | Supercomplete 的增量 Prompt |
| `FetchCachedContextAndRefreshDecision` | 获取缓存上下文和刷新决策 |
| `GetCache` | 获取缓存 |
| `getNewPersistentChatMessagePrompts` | 获取新的持久化聊天消息 |
| `SetPersistentCachedContext` | 设置持久化缓存上下文 |
| `SetTrajectoryStartIndexForCachedContext` | 设置轨迹起始索引 |

### 186. ContextModule — 代码上下文核心

| 方法 | 描述 |
|------|------|
| `GetRelevantCCIs` | 获取相关代码上下文项 |
| `GetSortedCodeContextItems` | 排序的代码上下文 |
| `GetGuidelines` | 获取指南/规则 |
| `SetPinnedContext` | 固定上下文 |
| `SetPinnedGuideline` | 固定指南 |
| `RefreshContextForChatCompletions` | 刷新聊天上下文 |
| `RefreshContextForIdeAction` | 刷新 IDE 动作上下文 |
| `RefreshAndGetContextForSupercomplete` | 刷新 Supercomplete 上下文 |
| `GetMatchingCodeContext` | 获取匹配的代码上下文 |
| `ContextToAutocompletePrompt` | 上下文转自动补全 Prompt |
| `SetContextProvidersForEvent` | 为事件设置上下文提供器 |
| `SetCodeContextItemIndex` | 设置代码上下文索引 |
| `getBestScorer` | 获取最佳评分器 |

### 187. StreamingReplaceFileContentParser

实时解析 AI 代码编辑输出：

| 方法 | 描述 |
|------|------|
| `ConsumeReplaceFileContentDelta` | 消费替换文件内容增量 |
| `tryParsePartialReplaceFile` | 尝试解析部分替换 |
| `tryParseTabJumpToolCall` | 尝试解析 Tab Jump 工具调用 |

### Round 10 最终补充统计

| 指标 | 值 |
|------|-----|
| ToolConverter 类型 | **58** |
| 代码编辑变体 | 7 种 |
| 搜索/浏览工具 | 16 种 |
| cortex/managers Go 文件 | 27 个 |
| cortex/executors Go 文件 | 8 个 |
| language_server 子包 | **42** |
| ViewFile 配置参数 | 10 个 |
| Executor 类型 | **5** (+ 2 Wrapper) |
| Handler 类型 | **51** |
| Hook 执行函数 | **20** |
| Diff 操作函数 | **38** |
| Diff 解析器 | **3** |
| 规则系统函数 | **5** |
| Transcript 函数 | **6** |
| XML Section 标签 | **30** |
| Implicit Trajectory 方法 | **53+** |
| PlannerGenerator 配置参数 | **15** |
| CodeTracker 方法 | **43** |
| Supercomplete 方法 | **23** |

---

# Round 11: @exa/windsurf-acp 模块分析

## 140. ACP 概述 — Agent Client Protocol

`@exa/windsurf-acp` (710KB, 20,557行) 是 Windsurf 对 **Agent Client Protocol (ACP)** 的封装实现。

### 核心身份
- **ACP = Agent Client Protocol** — Cognition AI (Devin) 定义的开放协议
- 协议官网: `https://agentclientprotocol.com/`
- SDK 来源: `@agentclientprotocol/sdk@0.20.0` (bundled with zod@3.25.76)
- 传输层: **NDJSON over stdio** (本地) 或 **WebSocket** (远程/Devin Cloud)

### 包结构
```
@exa/windsurf-acp/
├── package.json          — name: "@exa/windsurf-acp", version: "0.0.0", type: "module"
├── index.js              — 710KB 单文件 bundle (esbuild 产物)
└── (无 index.d.ts)       — types 字段声明但文件缺失
```

### 源码组成 (从 bundle 注释推断)
```
src/types.ts          — 类型检查函数 + cognition.ai/ meta key 辅助
src/messages.ts       — applySessionEvent, constructMessageHistory
src/registry.ts       — AcpRegistrySchema, parseRegistry, resolveAgentCommand
src/webSocketStream.ts — WebSocket ↔ ReadableStream/WritableStream 适配
src/utils.ts          — 消息内容提取辅助
src/index.ts          — 入口, 180+ 导出
```

### 内嵌依赖
- `lodash-es@4.18.1` — 深度合并 (merge)
- `zod@3.25.76` — 运行时 schema 验证 (两套: v3 classic + v4)
- `@agentclientprotocol/sdk@0.20.0` — ACP 协议 SDK 核心

## 141. ACP 协议方法 (Agent Methods)

Client → Agent 方向，26 个方法:

### 核心会话方法
| 方法 | 类型 | 说明 |
|------|------|------|
| `initialize` | Request | 版本协商 + 能力发现 |
| `authenticate` | Request | 认证 (env_var / terminal / agent) |
| `logout` | Request | 终止认证会话 (UNSTABLE) |
| `session/new` | Request | 创建新会话 |
| `session/load` | Request | 加载已有会话 (历史回放) |
| `session/resume` | Request | 恢复会话 (不回放历史) |
| `session/fork` | Request | 分叉会话 (UNSTABLE) |
| `session/close` | Request | 关闭会话 |
| `session/list` | Request | 列出会话 |
| `session/prompt` | Request | 发送用户提示 → 触发完整对话回合 |
| `session/cancel` | Notification | 取消当前回合 |
| `session/set_mode` | Request | 切换模式 (ask/architect/code) |
| `session/set_model` | Request | 切换模型 (UNSTABLE) |
| `session/set_config_option` | Request | 设置配置选项 |

### NES (Next Edit Suggestions) 方法
| 方法 | 类型 | 说明 |
|------|------|------|
| `nes/start` | Request | 启动 NES 会话 |
| `nes/suggest` | Request | 请求下一步编辑建议 |
| `nes/close` | Request | 关闭 NES 会话 |
| `nes/accept` | Notification | 接受 NES 建议 |
| `nes/reject` | Notification | 拒绝 NES 建议 |

### 文档事件通知
| 方法 | 类型 |
|------|------|
| `document/didOpen` | Notification |
| `document/didChange` | Notification |
| `document/didClose` | Notification |
| `document/didSave` | Notification |
| `document/didFocus` | Notification |

### Provider 管理
| 方法 | 类型 |
|------|------|
| `providers/list` | Request |
| `providers/set` | Request |
| `providers/disable` | Request |

## 142. ACP 协议方法 (Client Methods)

Agent → Client 方向，11 个方法:

| 方法 | 类型 | 说明 |
|------|------|------|
| `session/update` | Notification | 会话状态增量推送 |
| `session/request_permission` | Request | 请求工具执行权限 |
| `fs/read_text_file` | Request | 读取客户端文件 |
| `fs/write_text_file` | Request | 写入客户端文件 |
| `terminal/create` | Request | 创建终端 |
| `terminal/output` | Request | 终端输出推送 |
| `terminal/release` | Request | 释放终端 |
| `terminal/wait_for_exit` | Request | 等待终端进程退出 |
| `terminal/kill` | Request | 终止终端进程 |
| `elicitation/create` | Request | 创建用户询问 |
| `elicitation/complete` | Notification | 完成用户询问 |

## 143. Session Update 事件类型

`session/update` 通知携带 `sessionUpdate` 字段，10 种事件类型:

| sessionUpdate 类型 | 说明 |
|---------------------|------|
| `user_message_chunk` | 用户消息块 (支持 optimistic 标记) |
| `agent_message_chunk` | Agent 消息块 (支持 overwrite 覆盖) |
| `agent_thought_chunk` | Agent 思考内容 (含 thinkingDurationMs) |
| `tool_call` | 工具调用 (首次) |
| `tool_call_update` | 工具调用更新 (增量) |
| `plan` | 计划 (新计划自动将旧计划标记 stale) |
| `available_commands_update` | 可用命令更新 + mention 类型 |
| `session_info_update` | 会话信息更新 (title, updatedAt) |
| `current_mode_update` | 当前模式切换 |
| `config_option_update` | 配置选项更新 |
| `usage_update` | 用量更新 (inputTokens, outputTokens, cachedRead/Write) |

### 消息模型
```
messages[] → 6 种 kind:
  user_message    — { kind, content: ContentBlock[] }
  agent_message   — { kind, content: ContentBlock[] }
  agent_thought   — { kind, content: ContentBlock[], thinkingDurationMs? }
  tool_call       — { kind, content: ToolCallFields, warnings[] }
  plan            — { kind, content, status: "current"|"stale" }
  subagent        — { kind, agentId, title, task, profile, depth, isBackground, status, childMessages[] }
  unknown         — { kind, content }
```

### Subagent 支持
- `cognition.ai/subagent_started` → 创建子 agent 消息
- `cognition.ai/subagent_completed` → 标记完成/失败
- `cognition.ai/subagent_context` → 路由更新到父 agent 的 childMessages
- 支持递归嵌套 (depth 字段)

## 144. Cognition.ai Meta Keys

ACP 消息通过 `_meta` 字段携带 Cognition/Devin 扩展信息。发现的所有 meta key:

### 会话/身份
| Key | 类型 | 说明 |
|-----|------|------|
| `cognition.ai/session` | object | 会话信息对象 |
| `cognition.ai/proposedByDevinId` | string | 提议的 Devin 实例 ID |
| `cognition.ai/botUsername` | string | Bot 用户名 |
| `cognition.ai/sender` | object | 发送者信息 |
| `cognition.ai/session-id` | string | 会话 ID |
| `cognition.ai/url` | string | 会话 URL |

### 消息控制
| Key | 类型 | 说明 |
|-----|------|------|
| `cognition.ai/clientMessageId` | string | 客户端消息去重 ID |
| `cognition.ai/messageSubIndex` | number | 消息子索引 (首条=0) |
| `cognition.ai/streamingMessageId` | string | 流式消息分组 ID |
| `cognition.ai/overwrite` | boolean | 覆盖同组历史内容 |
| `cognition.ai/isOptimistic` | boolean | 乐观 UI 标记 |
| `cognition.ai/isTyping` | boolean | 正在输入 |
| `cognition.ai/timestamp` | string | 时间戳 |
| `cognition.ai/eventType` | string | 事件类型 |
| `cognition.ai/thinkingDurationMs` | number | 思考耗时毫秒 |

### 工具调用
| Key | 类型 | 说明 |
|-----|------|------|
| `cognition.ai/toolName` | string | MCP 工具名 |
| `cognition.ai/inferenceToolName` | string | 推理工具名 |
| `cognition.ai/permissionType` | string | 权限请求类型 |
| `cognition.ai/approved` | boolean | 权限已批准 |
| `cognition.ai/reason` | string | 权限审批原因 |
| `cognition.ai/isExitPlan` | boolean | 退出计划标记 |
| `cognition.ai/actions` | array | Computer Use 操作列表 |
| `cognition.ai/screenshotKeys` | array | 截图 key 列表 |
| `cognition.ai/inputKey` | string | 输入截图 key |
| `cognition.ai/outputKey` | string | 输出截图 key |
| `cognition.ai/videoPath` | string | 录屏路径 |
| `cognition.ai/listDirectory` | boolean | 目录列表标记 |
| `cognition.ai/showContentWithExternalLinks` | boolean | 外部链接内容 |

### PR/Git 集成
| Key | 类型 | 说明 |
|-----|------|------|
| `cognition.ai/htmlUrl` | string | PR HTML URL |
| `cognition.ai/prTitle` | string | PR 标题 |
| `cognition.ai/pullNumber` | string\|number | PR 编号 |
| `cognition.ai/repo` | string | 仓库名 |
| `cognition.ai/sessionPRs` | array | 会话关联 PR 列表 |
| `cognition.ai/worktreeFor` | string | Worktree 关联 |

### 密钥/安全
| Key | 类型 | 说明 |
|-----|------|------|
| `cognition.ai/secretName` | string | 密钥名 |
| `cognition.ai/secretType` | string | 密钥类型 |
| `cognition.ai/secretNames` | string[] | 密钥名列表 |
| `cognition.ai/requestId` | string | 请求 ID |
| `cognition.ai/envVarName` | string | 环境变量名 |
| `cognition.ai/action` | string | 密钥操作 (saved/dismissed) |

### 资源/内容
| Key | 类型 | 说明 |
|-----|------|------|
| `cognition.ai/hiddenResource` | boolean | 隐藏资源标记 |
| `cognition.ai/contentsKey` | string | Diff 内容 key |
| `cognition.ai/endLine` | number | 文件读取结束行 |
| `cognition.ai/scope-item-type` | string | 作用域项类型 |
| `cognition.ai/maxEmbeddedResourceBytes` | number | 最大嵌入资源字节 |
| `cognition.ai/httpUpload` | boolean | HTTP 上传支持 |
| `cognition.ai/httpUploadMaxBytes` | number | HTTP 上传最大字节 |
| `cognition.ai/httpUploadUrl` | string | HTTP 上传 URL |

### 用量/状态
| Key | 类型 | 说明 |
|-----|------|------|
| `cognition.ai/inputTokens` | number | 输入 token 数 |
| `cognition.ai/outputTokens` | number | 输出 token 数 |
| `cognition.ai/cachedReadTokens` | number | 缓存读 token |
| `cognition.ai/cachedWriteTokens` | number | 缓存写 token |
| `cognition.ai/statusEnum` | string | 状态枚举 |
| `cognition.ai/statusReason` | string | 状态原因 |
| `cognition.ai/statusMessage` | string | 状态消息 |
| `cognition.ai/queuePosition` | number | 队列位置 |
| `cognition.ai/activityEnum` | string | 活动枚举 |
| `cognition.ai/sessionLifecycle` | string | 会话生命周期 |

### Subagent
| Key | 类型 | 说明 |
|-----|------|------|
| `cognition.ai/subagent_started` | object | {agentId, title, task, profile, depth, isBackground} |
| `cognition.ai/subagent_completed` | object | {agentId, success, summary, depth} |
| `cognition.ai/subagent_context` | object | {parentAgentId} |

### 能力标记
| Key | 类型 | 说明 |
|-----|------|------|
| `cognition.ai/multiRootWorkspace` | boolean | 多根工作区支持 |
| `cognition.ai/sessionListCreatedAfter` | boolean | 按创建时间过滤 |
| `cognition.ai/sessionListUpdatedAfter` | boolean | 按更新时间过滤 |
| `cognition.ai/sessionListRefetch` | boolean | 刷新列表 |
| `cognition.ai/sessionListContentSearch` | boolean | 内容搜索 |
| `cognition.ai/prManagement` | boolean | PR 管理 |
| `cognition.ai/sessionUnreadTracking` | boolean | 未读追踪 |
| `cognition.ai/secretSend` | boolean | 密钥发送 |
| `cognition.ai/revert` | boolean | 回滚支持 |
| `cognition.ai/mcp` | boolean | MCP 管理 |
| `cognition.ai/sessionArchiving` | boolean | 会话归档 |
| `cognition.ai/sessionRename` | boolean | 会话重命名 |
| `cognition.ai/canManageMcpServers` | boolean | MCP 服务器管理 |
| `cognition.ai/canManageOrgSecrets` | boolean | 组织密钥管理 |

## 145. WindsurfAcpConnection 适配层

`WindsurfAcpConnection` 是 Windsurf 对 ACP `ClientSideConnection` 的封装:

```javascript
class WindsurfAcpConnection {
  constructor(handler, stream) {
    // handler.onClientRequest(request) — Windsurf 处理 Agent 回调
    this.connection = new ClientSideConnection((_agent) => this.createClient(), stream);
  }
  
  createClient() {
    return {
      sessionUpdate:     (params) => handler.onClientRequest({method: "session/update", params}),
      requestPermission: (params) => handler.onClientRequest({id, method: "session/request_permission", params}),
      readTextFile:      (params) => handler.onClientRequest({id, method: "fs/read_text_file", params}),
      writeTextFile:     (params) => handler.onClientRequest({id, method: "fs/write_text_file", params}),
      createTerminal:    (params) => handler.onClientRequest({id, method: "terminal/create", params}),
      terminalOutput:    (params) => handler.onClientRequest({id, method: "terminal/output", params}),
      releaseTerminal:   (params) => handler.onClientRequest({id, method: "terminal/release", params}),
      waitForTerminalExit:(params) => handler.onClientRequest({id, method: "terminal/wait_for_exit", params}),
      killTerminal:      (params) => handler.onClientRequest({id, method: "terminal/kill", params}),
      unstable_createElicitation:  (params) => handler.onClientRequest({id, method: "elicitation/create", params}),
      unstable_completeElicitation:(params) => handler.onClientRequest({method: "elicitation/complete", params}),
      extMethod:         (method, params) => handler.onClientRequest({id, method: "ext/method", params: {method, params}}),
      extNotification:   (method, params) => handler.onClientRequest({method: "ext/notification", params: {method, params}})
    };
  }
  
  async sendRequest(request) {
    // Notifications → fire-and-forget
    // Requests → race against connection.closed (throw AcpConnectionClosedError on disconnect)
  }
}
```

### Windsurf 扩展方法 (通过 ext/method)
| 方法 | 说明 |
|------|------|
| `_session/elicitation` | Elicitation 请求 (message + requestedSchema) |
| `_cognition.ai/revert/listSteps` | 列出可回滚步骤 |
| `_cognition.ai/revert/preview` | 预览回滚 |
| `_cognition.ai/revert/execute` | 执行回滚 |
| `_cognition.ai/revert/forkFromStep` | 从步骤分叉 |
| `_cognition.ai/mcp/listServers` | 列出 MCP 服务器 |
| `_cognition.ai/mcp/toggleServer` | 启用/禁用 MCP 服务器 |
| `_cognition.ai/mcp/toggleTool` | 启用/禁用 MCP 工具 |
| `_cognition.ai/session/rename` | 重命名会话 |

## 146. ACP 传输层

### 1. NDJSON Stream (stdio 本地)
```javascript
ndJsonStream(output, input) → { readable, writable }
// output: WritableStream (stdout) → 每行 JSON + '\n'
// input: ReadableStream (stdin) → 按行解析 JSON
```

### 2. WebSocket Stream (远程/Devin Cloud)
```javascript
webSocketStream(ws) → { readable, writable }
// ws.message → JSON.parse → controller.enqueue
// writable.write → JSON.stringify → ws.send
// ws.close → readable.close, ws.error → readable.error
// writable.close → ws.close(1000), writable.abort → ws.close(1011, reason)
// reason 截断到 123 bytes UTF-8
```

WebSocket URL 示例: `wss://app.devin.ai/api/acp/live`
认证: query parameters (token, org ID)，非 headers

### 3. Connection 内部
```javascript
class Connection {
  pendingResponses = new Map();  // id → {resolve, reject}
  nextRequestId = 0;
  stream;                        // { readable, writable }
  writeQueue = Promise.resolve(); // 序列化写入
  abortController;               // 连接生命周期
  closedPromise;                 // 连接关闭 Promise
  
  sendRequest(method, params) → Promise<result>
  sendNotification(method, params) → void
  receive() → 循环读取 readable, dispatch to handlers
}
```

## 147. ACP Agent Registry

ACP 支持 Agent 注册表，定义 Agent 的分发方式:

### AgentDistributionSchema
```javascript
{
  binary: {                     // 平台原生二进制
    "darwin-aarch64": { archive, cmd, args?, env? },
    "darwin-x86_64":  { ... },
    "linux-aarch64":  { ... },
    "linux-x86_64":   { ... },
    "windows-aarch64":{ ... },
    "windows-x86_64": { ... },
  },
  npx: { package, args?, env? },      // npm 包
  uvx: { package, args?, env? },      // Python (uv) 包
  websocket: { url }                   // WebSocket 连接
}
```

### AcpRegistryAgentSchema
```javascript
{
  id: /^[a-z][a-z0-9-]*$/,     // 唯一标识
  name: string,                  // 人类可读名
  version: semver,               // 语义化版本
  description: string,           // 描述
  repository?: string,           // 源码仓库
  authors?: string[],            // 作者
  license?: string,              // SPDX 许可
  icon?: string,                 // 图标
  distribution: AgentDistribution,
  // Cognition/Windsurf 扩展字段:
  "cognition.ai/featured"?: boolean,   // 推荐标记
  "cognition.ai/bundled"?: boolean,    // 内置标记
  "cognition.ai/hidden"?: boolean,     // UI 隐藏
  "cognition.ai/promoLabel"?: string,  // 徽章标签 (如 "Preview")
  "cognition.ai/promoTooltip"?: string // 徽章提示
}
```

### resolveAgentCommand 优先级
1. **npx** → `npx -y <package> [args]`
2. **uvx** → `uvx <package> [args]`
3. **binary** (如果 allowBinary) → 按平台选择 `{cmd} [args]`
4. **websocket** → 不走命令, 直接 WebSocket 连接

## 148. Devin Cloud 集成

`DEVIN_CLOUD_PROVIDER_ID = "devin-cloud"` 作为特殊 Provider:

### Elicitation 响应格式差异
```javascript
// 标准 ACP agent:
{ action: { action, content? }, _meta? }

// Devin Cloud agent (providerId === "devin-cloud"):
{ action: { action: { action, content? } }, _meta? }
// → 多一层嵌套!
```

### Devin Cloud 特有功能
- **Computer Use**: `cognition.ai/actions` (操作列表), `cognition.ai/screenshotKeys`
- **PR 管理**: `cognition.ai/htmlUrl`, `cognition.ai/prTitle`, `cognition.ai/pullNumber`
- **Playbook**: `cognition.ai/playbookTitle`
- **Blocker 报告**: `cognition.ai/impact`
- **录屏**: `cognition.ai/videoPath`
- **Skill PR 建议**: `cognition.ai/skillFiles`
- **环境配置建议**: `cognition.ai/sink`

### 消费者分析
| 模块 | WindsurfAcpConnection | devin-cloud | session/prompt |
|------|----------------------|-------------|----------------|
| extension.js | 2 | 7 | 4 |
| sessions.desktop.main.js | 1 | 38 | 15 |

**sessions.desktop.main.js** 是 ACP 的主要消费者，它是 Sessions 面板的 webview host。

## 149. Elicitation 子系统

ACP 支持结构化用户输入 (Elicitation):

### 方法
- `_session/elicitation` (via `ext/method`)
- `elicitation/create` (Agent → Client)
- `elicitation/complete` (Agent → Client, notification)

### Schema 类型
| 类型 | 判定条件 |
|------|---------|
| TitledSingleSelect | `type:"string"` + `oneOf[]` |
| UntitledSingleSelect | `type:"string"` + `enum[]` |
| TitledMultiSelect | `type:"array"` + `items.anyOf[]` |
| UntitledMultiSelect | `type:"array"` + `items.enum[]` |

### Allow Other
- `cognition.ai/allowOther`: 允许自定义选项
- `cognition.ai/otherOptionValue`: 遗留自定义值字段

## 150. Round 11 累计统计

| 指标 | 数量 |
|------|------|
| ACP Agent Methods | **26** |
| ACP Client Methods | **11** |
| Session Update 事件类型 | **10** |
| cognition.ai/ meta keys | **60+** |
| ACP 能力标记 | **14** |
| Agent 分发方式 | **4** (binary/npx/uvx/websocket) |
| 平台 keys | **6** (darwin/linux/windows × aarch64/x86_64) |
| Windsurf ext/ 扩展方法 | **9** |
| Elicitation schema 类型 | **4** |
| 消息 kind 类型 | **7** (含 subagent, unknown) |
| NES 方法 | **5** |
| 文档事件 | **5** |

### 关键发现
1. **ACP 是 Cognition AI (Devin) 的标准化 Agent 协议**，Windsurf 已深度集成
2. **WebSocket 远程 Agent** 支持: `wss://app.devin.ai/api/acp/live`
3. **Devin Cloud** 作为特殊 Provider，有额外嵌套响应格式
4. **NES (Next Edit Suggestions)** 是通过 ACP 实现的，非独立协议
5. **Subagent 递归嵌套** 支持任意深度的 agent 委托
6. **sessions.desktop.main.js** 是 ACP 主要消费者 (38 devin-cloud 引用)
7. **回滚系统 (Revert)** 通过 ACP ext/method 实现
8. **Computer Use** (截图/录屏/操作) 通过 cognition.ai meta keys 传递
