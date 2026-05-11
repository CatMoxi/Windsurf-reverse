# Codex CLI vs Claude Code vs Windsurf Cascade — 工作流对比

## 1. 架构总览

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Codex CLI (OpenAI)                            │
│  Terminal TUI (ink/react) → AgentLoop → OpenAI /responses API        │
│  唯一工具: shell (+ apply_patch via shell)                           │
│  沙箱: macOS seatbelt / Linux bubblewrap / Docker                   │
│  ~88行核心循环                                                       │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                        Claude Code (Anthropic)                       │
│  Terminal TUI (ink/react) → AgentLoop → Anthropic Messages API       │
│  ~50 工具 (Bash/Read/Write/Edit/Grep/Glob/Agent/MCP/LSP/...)       │
│  权限系统: 5级 (ReadOnly→DangerFullAccess)                           │
│  Sub-agent: 可派生子agent (不可递归)                                  │
│  ~88行核心循环 (Rust重写版)                                          │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                      Windsurf Cascade (Codeium)                      │
│  VSCode Extension → Connect-RPC → LanguageServer(Go) → API Server   │
│  70+ 工具 (CortexStepType), 40+ 工具配置 (CascadeToolConfig)        │
│  Cortex 执行引擎: Planner→Executor→Generator 循环                   │
│  Brain 自维护工作记忆, Checkpoint 压缩                                │
│  协议: Protobuf + Connect-RPC                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. Agent Loop 对比

### Codex CLI — 极简循环
```
User Input → system_prompt + history → OpenAI /responses API
  → streaming response
  → if function_call(shell): 
      check approval → sandbox exec → stdout → append result
      → continue loop
  → if text only: 
      display → exit loop
```

**特点**:
- **单工具设计**: 只有 `shell`（+ `container.exec`），所有操作通过 shell 命令完成
- 文件编辑 = `cat > file << 'EOF'` 或 `apply_patch` (也是 shell 命令)
- 极度依赖模型能力，harness 极薄
- 循环终止 = 模型不再调用工具

### Claude Code — 丰富工具循环
```
User Input → system_prompt + history + tools → Anthropic Messages API
  → streaming response
  → for each tool_use block:
      authorize(tool, input) → 5级权限检查
      if allowed: execute → append ToolResult
      if denied: append error → model adapts
  → if no tool_calls: exit loop
  → continue
```

**特点**:
- **~50 工具**: Bash, Read, Write, Edit, MultiEdit, Grep, Glob, LS, Agent (sub-agent), WebFetch, WebSearch, NotebookRead/Edit, TodoRead/Write, MCP tools, LSP, Skill, TaskCreate/Get/Stop, TeamCreate, CronCreate, Monitor, etc.
- Sub-agent 可并行处理独立任务（但不可递归）
- **Messages = State**: 一切状态存在 message history 中
- 错误也作为 ToolResult 反馈给模型（model adapts）
- CLAUDE.md / AGENTS.md 作为 user instructions 注入
- Prompt cache 优化长对话

### Windsurf Cascade — 全栈引擎循环
```
User Input (TextOrScopeItem[]) → Extension → LS
  → LS 组装 system_prompt (分段拼接)
  → Trajectory → ChatMessagePrompt[] 转换
  → GetChatMessage API (Connect-RPC, streaming)
  → for each delta_tool_call:
      map to CortexStepType
      ToolCallProposal → 用户确认 (if dangerous)
      本地执行 (LS 进程内)
      结果 → CortexTrajectoryStep
  → Trajectory 更新 → 继续循环
  → Brain 自动更新工作记忆
  → Checkpoint 压缩旧步骤
```

**特点**:
- **70+ 工具** (CortexStepType): 文件操作、搜索、命令、部署、MCP、记忆、代码地图等
- **三层架构**: Extension(UI) → LanguageServer(引擎) → API Server(LLM)
- Trajectory 作为持久状态（非纯 message history）
- Brain 系统自动总结长对话
- 服务端动态下发工具配置 (CascadeToolConfig)
- 支持并行 rollout (ParallelRolloutConfig)

## 3. 工具系统对比

| 维度 | Codex CLI | Claude Code | Windsurf |
|------|-----------|-------------|----------|
| **工具数量** | 1 (shell) | ~50 | 70+ |
| **文件读取** | `cat file` (shell) | `Read` 工具 | `CortexStepViewFile` |
| **文件写入** | `cat > file` (shell) | `Write` 工具 | `CortexStepWriteToFile` |
| **文件编辑** | `apply_patch` (shell) | `Edit` / `MultiEdit` | `CortexStepCodeAction` |
| **搜索** | `grep`/`rg` (shell) | `Grep` + `Glob` | `CortexStepGrepSearch` + `CortexStepFind` |
| **命令执行** | shell (native) | `Bash` 工具 | `CortexStepRunCommand` |
| **子代理** | ❌ | `Agent` 工具 | `CortexStepTaskSubagent` |
| **MCP** | ❌ | `ListMcpResources` + MCP tools | `CortexStepMcpTool` + `CortexStepListResources` |
| **Web** | ❌ (实验性 web_search) | `WebFetch` + `WebSearch` | `CortexStepSearchWeb` + `CortexStepReadUrlContent` |
| **部署** | ❌ | ❌ | `CortexStepDeployWebApp` |
| **记忆** | ❌ | CLAUDE.md (文件) | `CortexStepMemory` + Brain 系统 |
| **代码智能** | ❌ | `LSP` 工具 | IDE 内置 (非工具) |
| **TODO** | ❌ | `TodoRead`/`TodoWrite` | `CortexStepTodoList` |
| **Git** | `git` (shell) | `git` (Bash) | `CortexStepGitCommit` |
| **用户提问** | ❌ | `AskUserQuestion` | `CortexStepAskUserQuestion` |
| **技能** | ❌ | `Skill` | `CortexStepSkill` |
| **Notebook** | ❌ | `NotebookRead`/`NotebookEdit` | `CortexStepReadNotebook`/`CortexStepEditNotebook` |

## 4. Prompt 构建对比

### Codex CLI
```
System Prompt = 硬编码字符串 (agent-loop.ts 中的 prefix)
             + ~/.codex/instructions.md (全局)
             + codex.md (项目级)
```
- **最简单**: 一个固定 system prompt + 用户自定义指令文件
- 无动态 section, 无 token budget 分配
- `--full-context` 模式: 一次性读入所有文件

### Claude Code
```
System Prompt = 动态组装 (~十几个 section)
  ├─ 基础角色定义
  ├─ Using Your Tools (根据可用工具动态变化)
  ├─ CLAUDE.md / AGENTS.md (用户指令)
  ├─ 条件 sections (plan mode? tasks? etc.)
  ├─ Attachments (@ 引用)
  └─ Skills
```
- **中等复杂度**: ~50 工具的描述动态拼接
- 对话压缩: ~12 种方法 (compaction, offloading, summarizing)
- Prompt cache 利用 Anthropic API 特性
- Tool definitions 也是动态的（根据权限和 MCP）

### Windsurf Cascade
```
System Prompt = 服务端 Planner 组装 (多个 SectionOverrideConfig)
  ├─ tool_calling_section
  ├─ code_changes_section
  ├─ communication_section
  ├─ additional_instructions_section
  ├─ test_section
  ├─ User Memories (数据库检索, add_user_memories_to_system_prompt)
  ├─ Brain 摘要 (自动工作记忆)
  ├─ Rules (.windsurfrules, AGENTS.md)
  └─ Ephemeral Messages (HeuristicPrompt 条件注入)

Context = CumulativePromptConfig (token 比例分配)
  ├─ persistent_context_multiplier (持久上下文)
  ├─ trajectory_context_multiplier (轨迹历史)
  ├─ ephemeral_context_multiplier (临时上下文)
  └─ 各子项独立权重
```
- **最复杂**: Section 可被 override/append/prepend
- Token budget 按比例分配
- Trajectory → Messages 转换 (TrajectoryConversionConfig)
- Checkpoint 压缩 + Brain 自维护
- 服务端控制（非客户端）

## 5. 安全/权限模型对比

| 维度 | Codex CLI | Claude Code | Windsurf |
|------|-----------|-------------|----------|
| **模式** | suggest / auto-edit / full-auto | 5级权限 | ToolCallProposal + RequestedInteraction |
| **沙箱** | macOS seatbelt / bubblewrap / Docker | 无 OS 沙箱 | 无 (IDE 进程内) |
| **网络隔离** | iptables 限制只通 OpenAI API | 无 | 无 |
| **文件限制** | 沙箱白名单 writable paths | 工作区限制 + 权限检查 | 工作区限制 |
| **用户确认** | 按 policy 决定 | 权限不足时 ask_user | ToolCallProposal UI |
| **auto-run** | full-auto 模式 | allow 规则 | AutoCommandConfig allowlist |

### Codex CLI
- 最严格的沙箱：OS 级别限制文件访问和网络
- full-auto 模式自动在沙箱内执行
- suggest 模式所有操作需确认

### Claude Code
- 5 级权限梯度: ReadOnly → WorkspaceWrite → DangerFullAccess → Prompt → Allow
- 权限差一级 → 询问用户; 差太多 → 直接拒绝
- Sub-agent 有 high 权限但无 UI → 自动执行范围内操作
- 无 OS 级沙箱

### Windsurf Cascade
- ToolCallProposal: 危险操作先提议再执行
- RequestedInteraction: 需要用户输入时暂停
- AutoCommandConfig: allowlist/denylist 控制命令自动执行
- 企业 EnterpriseToolConfig 可限制各工具

## 6. 状态管理对比

| 维度 | Codex CLI | Claude Code | Windsurf |
|------|-----------|-------------|----------|
| **状态模型** | ResponseItem[] (append-only) | Message[] (append-only) | CortexTrajectory (步骤树) |
| **持久化** | 会话级 (无) | 会话保存/恢复 | 轨迹持久化 + Brain |
| **压缩** | token 估算 | ~12 种压缩方法 | Checkpoint + Brain 摘要 |
| **记忆** | codex.md (文件) | CLAUDE.md (文件) | Memory 数据库 + Brain |
| **跨会话** | 无 | 有 (`--resume`) | 有 (cascade_id 恢复) |

## 7. 上下文注入对比

| 维度 | Codex CLI | Claude Code | Windsurf |
|------|-----------|-------------|----------|
| **当前文件** | 需 model 主动 cat | 需 model 主动 Read | 自动注入 active_document |
| **打开的文件** | 无 | 无 | 自动注入 open_document_uris |
| **工作区** | cwd | cwd | workspace_uris |
| **选中文本** | 无 | 无 | active_selection |
| **@ 引用** | 无 | 无 (通过文件) | 31 种 ContextScopeItem |
| **诊断信息** | 需运行 linter | LSP 工具 | 自动注入 diagnostics |
| **Git 状态** | 需 `git status` | 需 `git status` | GitScopeItem |
| **用户指令** | codex.md | CLAUDE.md / AGENTS.md | .windsurfrules + Rules |

## 8. 模型/API 对比

| 维度 | Codex CLI | Claude Code | Windsurf |
|------|-----------|-------------|----------|
| **默认模型** | o4-mini | claude-sonnet-4 | gpt-5.5-low |
| **API** | OpenAI /responses | Anthropic Messages | 自有 Protobuf API |
| **协议** | HTTPS + JSON | HTTPS + JSON (SSE) | Connect-RPC + Protobuf |
| **流式** | Server-Sent Events | Server-Sent Events | 5字节帧头 + proto |
| **多模型** | 可配置 | Opus/Sonnet | 115 模型 (含 Claude/GPT) |
| **开源** | ✅ Apache-2.0 | ❌ (已泄露) | ❌ |

## 9. 核心设计哲学

### Codex CLI: "The loop is trivial; the infrastructure is everything"
- **极简主义**: 1 个工具 (shell), ~88 行循环
- 把复杂度推给模型 — 模型自己决定用什么 shell 命令
- 安全通过 OS 级沙箱保证
- 开源、可审计

### Claude Code: "Messages = State, Errors = Feedback"
- **工具丰富但循环简单**: ~50 工具, ~88 行循环
- 一切状态存 message history (append-only)
- 错误不崩溃，作为反馈让模型自适应
- Sub-agent 实现并行但禁止递归
- Prompt 动态组装，~12 种压缩策略

### Windsurf Cascade: "全栈控制，IDE 深度集成"
- **最复杂的 harness**: 70+ 工具, 多层架构
- IDE 状态自动注入（不需 model 主动查询）
- Trajectory 作为一等公民（非纯 message）
- Brain 自维护工作记忆（model 不可见）
- 服务端控制一切：tool config, section override, token budget
- 31 种 @ 引用让用户精确指定上下文

## 10. 总结表

| 维度 | Codex CLI | Claude Code | Windsurf |
|------|-----------|-------------|----------|
| **复杂度** | ★☆☆ | ★★☆ | ★★★ |
| **工具丰富度** | ★☆☆ | ★★★ | ★★★ |
| **IDE 集成** | ❌ (终端) | ❌ (终端) | ★★★ (VS Code fork) |
| **安全沙箱** | ★★★ | ★★☆ | ★☆☆ |
| **上下文工程** | ★☆☆ | ★★★ | ★★★ |
| **状态管理** | ★☆☆ | ★★☆ | ★★★ |
| **可扩展性** | ★☆☆ | ★★★ (MCP/Skill) | ★★★ (MCP/Recipe/Skill) |
| **开源** | ✅ | ❌ | ❌ |
| **多模型** | ✅ (OpenAI) | ❌ (Anthropic only) | ✅ (115 模型) |
