# Windsurf Prompt 机制深度分析

## 整体架构

Windsurf 的 prompt 不是简单的"system prompt + user message"，而是一个多层组装系统：

```
┌─────────────────────────────────────────────────────┐
│ System Prompt (服务端 Planner 组装)                    │
│  ├─ 基础指令 (tool calling, communication style)     │
│  ├─ Tool Definitions (JSON Schema)                  │
│  ├─ User Memories (从数据库检索)                      │
│  ├─ Rules (.windsurfrules, AGENTS.md)              │
│  ├─ Section Overrides (动态覆盖)                     │
│  └─ Ephemeral Messages (临时提示)                    │
├─────────────────────────────────────────────────────┤
│ Message History (Trajectory → Messages 转换)         │
│  ├─ User Input Steps → USER messages               │
│  ├─ Tool Calls → TOOL messages + results           │
│  ├─ Planner Response → SYSTEM messages             │
│  └─ Checkpoint compression (减少 token)             │
├─────────────────────────────────────────────────────┤
│ Context (IDE 状态注入)                               │
│  ├─ Active Document (当前文件)                       │
│  ├─ Open Documents (打开的文件)                      │
│  ├─ Workspace Paths (工作区)                         │
│  ├─ Code Context Items (相关代码)                    │
│  ├─ Scope Items (用户 @ 提到的)                      │
│  └─ Diagnostics/Lints (错误信息)                     │
└─────────────────────────────────────────────────────┘
```

## 两套 Prompt 路径

### 路径 1: LanguageServerService.GetChatMessage (旧版/简单聊天)
```protobuf
// Extension → LS
message GetChatMessageRequest {
  Metadata metadata = 1;
  repeated ChatMessage chat_messages = 3;        // 完整历史
  Document active_document = 5;                  // 当前文件
  repeated string open_document_uris = 12;       // 打开的文件
  repeated string workspace_uris = 13;           // 工作区
  string active_selection = 11;                  // 选中文本
  ContextInclusionType context_inclusion_type = 8;
  string system_prompt_override = 10;            // 可覆盖system prompt
  string chat_model_name = 14;
}
```

### 路径 2: LanguageServerService.StartCascade + SendUserCascadeMessage (Cascade Agent)
```protobuf
// 1. 启动 Cascade session
message StartCascadeRequest {
  Metadata metadata = 1;
  BaseTrajectoryIdentifier base_trajectory_identifier = 3;  // 基于哪个轨迹
  CortexTrajectorySource source = 4;                        // 来源
  CortexTrajectoryType trajectory_type = 5;                 // CASCADE/AUTO等
}
// → 返回 cascade_id

// 2. 发送用户消息
message SendUserCascadeMessageRequest {
  Metadata metadata = 3;
  string cascade_id = 1;
  repeated TextOrScopeItem items = 2;            // 文本 + @ 引用混合
  repeated ImageData images = 6;                 // 图片
  CascadeConfig cascade_config = 5;             // 执行配置
  ExperimentConfig experiment_config = 4;
  repeated string recipe_ids = 7;               // 技能/配方
  bool blocking = 8;
  repeated CortexTrajectoryStep additional_steps = 9;  // 额外步骤
}
```

## 用户输入格式: TextOrScopeItem

用户在 Cascade 中的输入不是纯文本，而是 **文本+引用** 混合序列：

```protobuf
message TextOrScopeItem {
  oneof chunk {
    string text = 1;                    // 纯文本部分
    ContextScopeItem item = 2;          // @ 引用
  }
}
```

### ContextScopeItem 支持 31 种上下文类型：
| 类型 | 说明 | 用户操作 |
|------|------|---------|
| `file` | 文件 | @file.ts |
| `directory` | 目录 | @src/ |
| `repository` | 仓库 | @repo |
| `code_context` | 代码符号 | @function |
| `terminal` | 终端 | @terminal |
| `console_log` | 控制台日志 | @console |
| `browser_page` | 浏览器页面 | @page |
| `conversation` | 历史对话 | @conversation |
| `user_activity` | 用户活动 | @activity |
| `rule` | 规则文件 | @rules |
| `skill` | 技能 | /skill |
| `plan_file` | 计划文件 | @plan |
| `recipe` | 配方 | @recipe |
| `knowledge` | 知识库 | @docs |
| `git` | Git数据 | @commit, @diff |
| `mcp_prompt` | MCP prompt | @mcp |
| `code_map` | 代码地图 | @codemap |

## System Prompt 构建

### SystemPromptConstructionConfig
```protobuf
message SystemPromptConstructionConfig {
  string element_separator = 1;  // 各 section 之间的分隔符
}
```

### 分段组装 (Sections)
系统 prompt 由多个 section 拼接而成：

```protobuf
message CascadeConversationalPlannerConfig {
  // ...
  optional string code_research_section_content = 6;
  optional SectionOverrideConfig test_section = 9;
  optional SectionOverrideConfig tool_calling_section = 10;
  optional SectionOverrideConfig code_changes_section = 11;
  optional SectionOverrideConfig additional_instructions_section = 12;
  optional SectionOverrideConfig communication_section = 13;
}
```

### Section Override 模式
```protobuf
enum SectionOverrideMode {
  SECTION_OVERRIDE_MODE_UNSPECIFIED = 0;
  SECTION_OVERRIDE_MODE_OVERRIDE = 1;   // 完全替换
  SECTION_OVERRIDE_MODE_APPEND = 2;     // 追加
  SECTION_OVERRIDE_MODE_PREPEND = 3;    // 前置
}
```

### PromptOverrideConfig (全局覆盖)
```protobuf
message PromptOverrideConfig {
  map<string, string> section_overrides = 1;     // section_name → content
  repeated string additional_instructions = 2;   // 额外指令
}
```

## Trajectory → Messages 转换

Cortex 执行产生的步骤 (CortexTrajectoryStep) 需要转换为 LLM 可读的 messages：

### TrajectoryConversionConfig
```protobuf
message TrajectoryConversionConfig {
  optional bool use_tool_format = 1;                      // 用 tool_call 格式
  optional bool include_input_step = 2;                   // 包含输入步骤
  optional bool group_tools_with_planner_response = 3;    // 工具结果分组
  repeated CortexStepType disabled_step_types = 4;        // 排除某些步骤
  optional string tool_call_footer = 5;                   // 每个 tool call 后添加
}
```

### 转换规则：
```
CortexTrajectoryStep        →  ChatMessagePrompt
─────────────────────────────────────────────────
UserInput                   →  source: USER, prompt: "用户文本"
PlannerResponse(text)       →  source: SYSTEM, prompt: "AI 回复"
CodeAction(tool_call)       →  source: SYSTEM, tool_calls: [{name, args}]
CodeAction(result)          →  source: TOOL, tool_call_id: "id", prompt: "结果"
RunCommand(tool_call)       →  source: SYSTEM, tool_calls: [{name: "run_command", ...}]
RunCommand(output)          →  source: TOOL, tool_call_id: "id", prompt: "stdout..."
ViewFile(tool_call)         →  source: SYSTEM, tool_calls: [{name: "view_file", ...}]
ViewFile(content)           →  source: TOOL, tool_call_id: "id", prompt: "文件内容"
```

## Memory 系统

### MemoryConfig
```protobuf
message MemoryConfig {
  string memory_model_uid = 8;                           // 用于检索的模型
  uint32 num_checkpoints_for_context = 5;                // checkpoint 数
  int32 num_memories_to_consider = 3;                    // 考虑多少条记忆
  int32 max_global_cascade_memories = 4;                 // 全局记忆上限
  optional bool condense_input_trajectory = 6;           // 压缩输入
  optional bool add_user_memories_to_system_prompt = 7;  // 记忆注入 system prompt
  optional bool enabled = 2;
}
```

### CortexStepRetrieveMemory (记忆检索步骤)
```protobuf
message CortexStepRetrieveMemory {
  bool run_subagent = 1;               // 启动子agent检索
  bool add_user_memories = 8;          // 注入用户记忆
  bool add_auto_cascade_memories = 10; // 注入自动级联记忆
  string cascade_memory_summary = 2;   // 级联记忆摘要
  string user_memory_summary = 3;      // 用户记忆摘要
  string auto_cascade_memory_summary = 9;
  string retrieval_query = 4;          // 检索查询
  string rag_context = 5;             // RAG 上下文
  bool blocking = 7;
}
```

## Brain 系统 (自我维护的工作记忆)

```protobuf
message BrainConfig {
  optional bool enabled = 1;
  string brain_model_uid = 14;
  optional bool use_main_model_as_brain_model = 13;
  optional bool force_no_explanation = 4;
  BrainFilterStrategy filter_strategy = 5;      // 过滤策略
  BrainUpdateStrategy update_strategy = 6;      // 更新策略
  optional bool use_replace_content_for_updates = 7;
  optional bool condense_trajectory_messages = 8;
  optional uint32 recent_update_tool_threshold = 9;
  optional uint32 stale_update_tool_threshold = 10;
  string additional_ephemeral_prompt = 11;
  optional bool use_rules_in_subagent = 12;
}
```

Brain 是 Cascade 的"工作记忆"——在长对话中自动总结和更新，类似于 `CortexStepBrainUpdate`。

## Ephemeral Messages (临时提示注入)

```protobuf
message EphemeralMessagesConfig {
  optional bool enabled = 1;
  uint32 num_steps = 2;                          // 生效步数
  repeated HeuristicPrompt heuristic_prompts = 3;
}

message HeuristicPrompt {
  string heuristic = 1;  // 条件/启发式规则
  string prompt = 2;     // 满足条件时注入的提示
}
```

用途：根据启发式规则在特定情况下注入临时提示，例如"如果最近有lint错误，提醒检查"。

## Prompt Cache (减少 token 消耗)

```protobuf
message PromptCacheOptions {
  CacheControlType type = 1;  // EPHEMERAL, etc.
}

message CacheBreakpointMetadata {
  uint32 index = 1;
  PromptCacheOptions options = 2;
  string content_checksum = 3;
}

message ChatStartMetadata {
  uint32 start_step_index = 1;
  int32 checkpoint_index = 2;
  repeated uint32 steps_covered_by_checkpoint = 3;
  int32 latest_stable_message_index = 5;
  repeated CacheBreakpointMetadata cache_breakpoints = 6;
  CacheBreakpointMetadata system_prompt_cache = 7;  // system prompt 缓存
}
```

Windsurf 使用 **Anthropic prompt caching** 和 **checkpoint 压缩** 来优化长对话的 token 使用。

## CumulativePromptConfig (Token 分配)

```protobuf
message CumulativePromptConfig {
  float persistent_context_multiplier = 7;           // 持久上下文占比
  float persistent_active_document_multiplier = 10;  // 当前文档占比
  float persistent_open_docs_multiplier = 11;        // 打开文档占比
  int64 persistent_max_tokens_per_open_doc = 17;     // 每文档最大 token
  int64 persistent_max_ccis_considered = 12;         // 最大代码上下文数
  float trajectory_context_multiplier = 2;           // 轨迹历史占比
  float trajectory_refresh_threshold_multiplier = 15;
  float trajectory_truncation_multiplier = 16;       // 轨迹截断
  float ephemeral_context_multiplier = 9;            // 临时上下文占比
  int64 intent_reservation_tokens = 6;               // 意图预留 token
  repeated CortexStepType allowed_cascade_step_types = 18;
}
```

这定义了 prompt token 在各部分之间的分配比例。

## 完整 Prompt 组装流程

```
1. Extension 收集 IDE 上下文:
   - active_document (当前文件内容)
   - open_documents (所有打开的文件)
   - workspace_paths
   - selection (选中文本)
   - diagnostics (lint 错误)
   - terminal output
   - @ mentions → ContextScopeItem

2. SendUserCascadeMessage → LS:
   - items: [TextOrScopeItem...]
   - cascade_config: CascadeConfig

3. LS (Cortex Engine) 组装 LLM 请求:
   a. System Prompt 构建:
      - 基础 agent 指令
      - Tool definitions (从 CascadeToolConfig)
      - User rules (.windsurfrules, AGENTS.md)
      - Retrieved memories (MemoryConfig)
      - Section overrides
      - Ephemeral heuristic prompts
   
   b. Message History 构建:
      - Trajectory → ChatMessagePrompt[] 转换
      - Checkpoint 压缩 (旧步骤合并)
      - Brain 摘要注入
      - Cache breakpoints 标记
   
   c. Context 注入:
      - Active document snapshot
      - Code context items
      - Scope items 展开
      - Token budget 控制 (CumulativePromptConfig)

4. GetChatMessage → API Server:
   - system_prompt: 组装好的字符串
   - chat_message_prompts: 转换后的消息序列
   - tools: ChatToolDefinition[]
   - tool_choice: auto/none/specific

5. API Server → LLM (Claude/GPT):
   - 标准 tool_call 格式
   - streaming response

6. Response → CortexTrajectoryStep:
   - delta_text → 下一步加入 trajectory
   - delta_tool_calls → 执行 + 结果加入 trajectory
   - 循环回到步骤 3
```

## 关键设计选择

1. **Prompt 由 LS 组装，非 Extension**：Extension 只提供原始上下文，LS(服务端逻辑) 负责 prompt engineering
2. **Trajectory 作为记忆**：所有步骤记录在 CortexTrajectory 中，转换为 messages 时可压缩/截断
3. **动态 Tool 集**：服务端根据 CascadeToolConfig 决定给 LLM 哪些工具
4. **多级缓存**：system prompt 缓存 + message 缓存 + checkpoint 压缩
5. **Brain 自维护**：长对话中自动总结，避免超出 context window
6. **Section 可覆盖**：企业/团队可通过配置覆盖 system prompt 各部分
