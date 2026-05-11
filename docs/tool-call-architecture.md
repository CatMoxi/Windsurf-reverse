# Windsurf Tool Call 架构分析

## 整体架构

Windsurf 的 tool_call 并非标准 OpenAI function-calling，而是一套完全自定义的 **Cortex 执行引擎**：

```
用户消息 → GetChatMessage(API) → LLM 返回 delta_tool_calls[]
                                        ↓
                        LanguageServer (Cortex Engine)
                                        ↓
                    解析 ChatToolCall → 映射到 CortexStepType
                                        ↓
                    本地执行 (文件操作/命令/搜索等)
                                        ↓
                    执行结果 → ChatMessagePrompt (tool_call_id + prompt)
                                        ↓
                    继续 GetChatMessage → 下一轮 tool_call 或最终回复
```

## 核心数据结构

### ChatToolCall (API 层)
```protobuf
message ChatToolCall {
  string id = 1;              // 唯一标识，如 "call_abc123"
  string name = 2;            // 工具名，如 "write_to_file", "run_command"
  string arguments_json = 3;  // JSON 格式参数
}
```

### ChatToolDefinition (传给 LLM 的工具声明)
```protobuf
message ChatToolDefinition {
  string name = 1;                    // 工具名
  string description = 2;            // 描述
  string json_schema_string = 3;     // JSON Schema 参数定义
  repeated string attribution_field_names = 5;
  string server_name = 6;            // MCP server 名
  optional bool read_only_hint = 7;
  optional ComputerUseToolConfig computer_use_config = 8;
  optional bool is_custom_tool = 9;
}
```

### GetChatMessageRequest 中的 Tool 相关字段
```protobuf
message GetChatMessageRequest {
  repeated ChatToolDefinition tools = 10;       // 可用工具列表
  bool disable_parallel_tool_calls = 11;        // 禁用并行调用
  ChatToolChoice tool_choice = 12;              // 强制/禁止工具选择
  // ...
}
```

### GetChatMessageResponse 中的 Tool 输出
```protobuf
message GetChatMessageResponse {
  string delta_text = 3;
  repeated ChatToolCall delta_tool_calls = 6;   // 流式 tool call
  StopReason stop_reason = 5;                    // STOP_REASON_TOOL_USE
}
```

## Tool Call 循环流程

### 1. 首次请求
```
GetChatMessage {
  metadata: { api_key, ... }
  chat_message_prompts: [
    { source: USER, prompt: "创建一个 hello.py" }
  ]
  tools: [ ChatToolDefinition... ]   // 所有可用工具的 schema
  request_type: CASCADE
}
```

### 2. LLM 返回 tool_call
```
GetChatMessageResponse (streaming) {
  delta_tool_calls: [{
    id: "call_xyz",
    name: "write_to_file", 
    arguments_json: '{"target_file": "hello.py", "code_content": "print(\"hello\")"}'
  }]
  stop_reason: STOP_REASON_TOOL_USE
}
```

### 3. LanguageServer 本地执行
LS 收到 tool_call 后:
1. 解析 `name` → 映射到 `CortexStepType`
2. 创建对应的 `CortexTrajectoryStep`
3. 本地执行（写文件/运命令/搜索等）
4. 记录结果

### 4. 回传结果（下一轮请求）
```
GetChatMessage {
  chat_message_prompts: [
    { source: USER, prompt: "创建一个 hello.py" },
    { source: AGENT, tool_calls: [{ id: "call_xyz", ... }] },
    { source: USER, tool_call_id: "call_xyz", prompt: "文件已创建", tool_result_is_error: false }
  ]
  tools: [ ... ]
}
```

### 5. 循环直到 STOP_REASON_FINISH

## CortexStepType ↔ Tool Name 映射

| CortexStepType | Tool Name | 功能 |
|---|---|---|
| CORTEX_STEP_TYPE_VIEW_FILE (5) | `view_file` / `read_file` | 读取文件内容 |
| CORTEX_STEP_TYPE_WRITE_TO_FILE (6) | `write_to_file` | 创建/写入文件 |
| CORTEX_STEP_TYPE_CODE_ACTION (4) | `edit` / `multi_edit` | 编辑现有文件 |
| CORTEX_STEP_TYPE_RUN_COMMAND (11) | `run_command` | 执行终端命令 |
| CORTEX_STEP_TYPE_GREP_SEARCH (7) | `grep_search` | 正则搜索文件内容 |
| CORTEX_STEP_TYPE_FIND (18) | `find_by_name` | 按名称搜索文件 |
| CORTEX_STEP_TYPE_LIST_DIRECTORY (8) | `list_dir` | 列出目录内容 |
| CORTEX_STEP_TYPE_SEARCH_WEB (33) | `search_web` | 网页搜索 |
| CORTEX_STEP_TYPE_READ_URL_CONTENT (31) | `read_url_content` | 读取URL内容 |
| CORTEX_STEP_TYPE_COMMAND_STATUS (20) | `command_status` | 检查命令执行状态 |
| CORTEX_STEP_TYPE_MCP_TOOL (38) | (dynamic) | MCP 工具调用 |
| CORTEX_STEP_TYPE_CUSTOM_TOOL (36) | (dynamic) | 自定义工具 |
| CORTEX_STEP_TYPE_DEPLOY_WEB_APP (26) | `deploy_web_app` | 部署应用 |
| CORTEX_STEP_TYPE_MEMORY (22) | `create_memory` | 创建记忆 |
| CORTEX_STEP_TYPE_VIEW_CODE_ITEM (9) | `code_search` | 代码搜索 |
| CORTEX_STEP_TYPE_PROPOSE_CODE (14) | `propose_code` | 代码提议 |
| CORTEX_STEP_TYPE_CHECKPOINT (13) | — | 检查点（自动） |
| CORTEX_STEP_TYPE_TODO_LIST (?) | `todo_list` | TODO管理 |
| CORTEX_STEP_TYPE_ASK_USER_QUESTION (?) | `ask_user_question` | 向用户提问 |
| CORTEX_STEP_TYPE_READ_NOTEBOOK (?) | `read_notebook` | 读取Jupyter |
| CORTEX_STEP_TYPE_EDIT_NOTEBOOK (?) | `edit_notebook` | 编辑Jupyter |
| CORTEX_STEP_TYPE_SKILL (?) | `skill` | 技能调用 |

## 关键 Tool 的参数结构

### write_to_file
```json
{
  "target_file_uri": "/absolute/path/to/file",
  "code_content": ["line1", "line2", ...],
  "diff": { /* DiffBlock */ }
}
```

### run_command
```json
{
  "command_line": "npm install",
  "cwd": "/workspace",
  "blocking": true,
  "should_auto_run": false,
  "wait_ms_before_async": 5000
}
```

### edit (CodeAction)
```json
{
  "action_spec": {
    "file_path": "/path/to/file",
    "old_string": "...",
    "new_string": "..."
  }
}
```

## MCP Tool 特殊处理

MCP tools 通过 `CortexStepMcpTool` 处理：
```protobuf
message CortexStepMcpTool {
  string server_name = 1;        // MCP server 名
  ChatToolCall tool_call = 2;    // 标准 tool_call
  McpServerInfo server_info = 4;
  string result_string = 3;      // 执行结果
  repeated ImageData images = 5;
}
```

## Tool Choice 控制

```protobuf
message ChatToolChoice {
  oneof choice {
    string option_name = 1;  // "auto", "none", "required"
    string tool_name = 2;    // 强制使用特定工具
  }
}
```

## CascadeToolConfig - 工具配置体系

服务端通过 `CascadeConfig → CascadePlannerConfig → CascadeToolConfig` 控制每个工具的行为：

```protobuf
message CascadeToolConfig {
  MqueryToolConfig mquery = 1;         // 语义搜索配置
  CodeToolConfig code = 2;             // 代码编辑配置
  GrepToolConfig grep = 4;             // Grep 配置
  FindToolConfig find = 5;             // Find 配置
  RunCommandToolConfig run_command = 8; // 命令执行配置
  ViewFileToolConfig view_file = 10;   // 文件查看配置
  SearchWebToolConfig search_web = 13; // 网页搜索配置
  McpToolConfig mcp = 16;             // MCP 配置
  DeployWebAppToolConfig deploy_web_app = 18;
  repeated string tool_allowlist = 32; // 工具白名单
  // ...共 40+ 个工具配置
}
```

## 执行引擎 (Executor)

`CascadeExecutorConfig` 控制执行循环:
- `max_generator_invocations`: 最大 LLM 调用次数
- `terminal_step_types`: 遇到这些类型停止执行
- `disable_async`: 禁用异步执行
- `research_only`: 只读模式（不写文件/不执行命令）

## Tool Call Proposal (确认机制)

对于危险操作（写文件、执行命令）：
```protobuf
message CortexStepToolCallProposal {
  ChatToolCall tool_call = 1;  // 提议的 tool call
}

message CortexStepToolCallChoice {
  repeated ChatToolCall proposal_tool_calls = 1;
  uint32 choice = 2;     // 用户选择
  string reason = 3;
}
```

流程: LLM 提议 → ToolCallProposal → 用户确认/拒绝 → 执行

## RequestedInteraction (用户交互)

工具执行需要用户确认时:
```
CascadeRunCommandInteraction { confirm: true/false }
CascadeDeployInteraction { deploy_target, subdomain }
CascadeReadUrlContentInteraction { action, url }
```

## 与 OpenAI Function Calling 的主要区别

| 方面 | OpenAI | Windsurf |
|------|--------|----------|
| 执行位置 | 客户端执行 | LanguageServer 本地执行 |
| 结果格式 | 自由文本 | 结构化 CortexTrajectoryStep |
| 循环控制 | 客户端决定 | 服务端 Executor 控制 |
| 确认机制 | 无 | ToolCallProposal + RequestedInteraction |
| 工具定义 | 固定 JSON Schema | 服务端动态下发 CascadeToolConfig |
| 并行调用 | 支持 | 可通过 disable_parallel_tool_calls 控制 |
| 异步执行 | 无 | 支持异步命令 + CommandStatus 检查 |
