# Go LS Binary Deep Analysis - Ghidra Decompilation Results

## 1. Binary Overview

- **File**: `language_server_windows_x64.exe`
- **Size**: 163.7 MB
- **Go Version**: 1.26.1
- **Functions**: 116,443 total (63,001 Exafunction-specific)

## 2. Go pclntab Symbol Recovery

Successfully parsed the Go runtime pclntab (program counter line table) to recover all 116,443 function symbols.

### pclntab Structure
| Field | Value |
|-------|-------|
| Raw file offset | `0x3D002E0` |
| Magic | `0xFFFFFFF1` (Go 1.18+) |
| nfunc | 116,443 |
| nfiles | 3,848 |
| funcname offset | `0x48` |
| functab offset | `0x0196B648` |
| textStart VA | `0x140001000` |

### Parsing Method
- **functab entries**: (uint32 entryOff, uint32 funcoff) pairs, 8 bytes each
- **funcoff**: relative to functab base (`pclntab + pclnOffset`)
- **_func struct**: at `functab_base + funcoff`, fields: `entryOff(u32)`, `nameOff(i32)`
- **Function VA**: `textStart + entryOff`
- **Function name**: null-terminated string at `funcnameBase + nameOff`

### Output Files
- `docs/ghidra-output/go-pclntab-symbols.txt`: 63,001 Exafunction symbols with VA addresses
- `docs/ghidra-output/ghidra-target-decompiled.txt`: 13 decompiled target functions

## 3. Key Function Addresses

| Function | Virtual Address | Size |
|----------|----------------|------|
| `cortex.(*CascadeManager).GetSystemPromptAndTools` | `0x141D1D360` | 677 bytes |
| `cortex/managers.(*PromptBuilder).Build` | `0x141C0C3E0` | 1883 bytes |
| `cortex/managers.(*PromptBuilder).AddSections` | `0x141C0C100` | 1883 bytes |
| `cortex/managers.(*PlannerGenerator).Generate` | `0x141C08860` | 197 bytes |
| `cortex/managers.(*PlannerGenerator).buildChatMessageRequest` | `0x141C061A0` | 690 bytes |
| `cortex/managers.(*PlannerGenerator).handleToolCall` | `0x141C00760` | 932 bytes |
| `prompt.DefaultCascadeSystemPromptForCumulativePrompt` | `0x141ACD760` | 660 bytes |
| `prompt.DefaultCascadeConfigForCumulativePrompt` | `0x141ACD440` | 472 bytes |
| `cortex.(*CascadeManager).executeHelper` | `0x141D10920` | 870 bytes |
| `cortex.(*CascadeManager).ExecuteOne` | `0x141D159A0` | 531 bytes |
| `cortex.CreateDefaultCascadeHandlerMap` | `0x141D2A660` | 223 bytes |
| `language_server.(*Server).GetSystemPromptAndTools` | `0x141E7F300` | - |
| `cortex/nodes.(*RelatedFilesMixin).GetSystemPrompt` | `0x141BD5D20` | 1889 bytes |
| `vibe_and_replace.(*VibeEditToolConverter).GetToolDefinition` | `0x141DC09A0` | 214 bytes |

## 4. DefaultCascadeConfigForCumulativePrompt - Token Budget Allocation

Three planner type configurations were decoded from IEEE 754 float32 constants:

### Default Planner (conversational)
| Field | Offset | Value |
|-------|--------|-------|
| system_prompt_ratio | +0x08 | 0.25 |
| system_prompt_sub_ratio_1 | +0x0C | 0.5 |
| system_prompt_sub_ratio_2 | +0x10 | 0.0 |
| max_prompt_tokens | +0x18 | 1024 |
| max_context_items | +0x20 | 25 |
| context_budget_float | +0x28 | 0.25 |
| context_ratio | +0x2C | 0.65 |
| context_sub_ratio_1 | +0x30 | 0.9 |
| context_sub_ratio_2 | +0x34 | 0.5 |
| tool_ratio | +0x38 | 0.1 |
| tool_max_tokens | +0x40 | 512 |
| tool_sub_ratio | +0x48 | 0.5 |

### Research Planner (type=6)
| Field | Value |
|-------|-------|
| system_prompt_ratio | 0.33 |
| sub_ratios | 0.5, 0.5 |
| max_prompt_tokens | 2048 |
| context_ratio | 0.6 |
| tool_ratio | 0.07 |
| tool_max_tokens | 512 |
| tool_sub_ratio | 0.9 |

### Agent V2 Planner (type=0xB=11)
| Field | Value |
|-------|-------|
| system_prompt_ratio | 0.25 |
| sub_ratios | 0.45, 0.25 |
| max_prompt_tokens | 2048 |
| context_ratio | 0.5 |
| tool_ratio | 0.25 |
| tool_max_tokens | 512 |
| tool_sub_ratio | 1.0 |

**Interpretation**: The system allocates the model's context window (total tokens - reserved output) as:
- **system_prompt_ratio** × remaining = tokens for system prompt
- **context_ratio** × remaining = tokens for user context (files, code, etc.)
- **tool_ratio** × remaining = tokens for tool definitions
- Sub-ratios further subdivide each section

## 5. System Prompt Fragments Extracted from Binary

### 5.1 Core Identity
```
You are Cascade, a powerful agentic AI coding assistant.
```

### 5.2 Workspace Layout Template
```xml
<workspace_layout workspace="%s">
%s
</workspace_layout>
```

### 5.3 Communication Style
```
Be terse and direct. Briefly summarize after clusters of tool calls when needed.
If changes are in files you touched, understand them; if unrelated, ignore them.
When user asks for 'review', prioritize bugs, risks, regressions, missing tests.
```

### 5.4 Communication Guidelines
```
Be concise and avoid unnecessary verbosity.
```

### 5.5 No Acknowledgment Rule
```
No acknowledgment phrases: Never start responses with phrases like "You're absolutely right!",
"Great idea!", "I agree", "Good point", "That makes sense", etc. Jump straight into addressing
the request without any preamble or validation of the user's statement.
```

### 5.6 Direct Response Rule
```
Direct responses: Begin responses immediately with the substantive content. Do not acknowledge,
validate, or express agreement with the user's request before addressing it.
```

### 5.7 Markdown Formatting
```
Format your messages with Markdown.
- Each reference should have a stand alone path.
- Don't nest bullets or create deep hierarchies.
- Use single backtick inline code for variable or function names.
- fenced code blocks with language when referencing code snippets.
- Keep bullets to one line unless breaking for clarity is unavoidable.
- Never use unicode bullet points. Use the markdown list syntax to format lists.
```

### 5.8 Citation Guidelines
```
citation format when mentioning any file path in your response
- Format: `@/Users/alice/projects/myapp/src/file.ext:30` for specific lines
```

### 5.9 Running Commands
```
NEVER include `cd` as part of the command. Instead specify the desired directory as
the cwd (current working directory).
```

### 5.10 Unexpected Changes Alert
```
While you are working, you might notice unexpected changes that you didn't make.
If this happens, STOP IMMEDIATELY and ask the user how they would like to proceed.
```

### 5.11 Memory Management
```
Before creating a new memory, first check to see if a semantically related memory
already exists in the database. If found, update it instead of creating a duplicate.
Save important context relevant to the USER and their task to a memory database.
```

### 5.12 Code Style
```
Code style: Do not add or delete ***ANY*** comments or documentation unless asked.
Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
```

### 5.13 Code Quality
```
Your generated code must be immediately runnable. To guarantee this, follow these instructions carefully:
Add all necessary import statements, dependencies, and endpoints required to run the code.
create an appropriate dependency management file (e.g. requirements.txt) with package versions and a helpful README.
building a web app from scratch, give it a beautiful and modern UI, imbued with best UX practices.
making a very large edit (>300 lines), break it up into multiple smaller edits.
Imports must always be at the top of the file.
```

### 5.14 Editing Strategy
```
Prefer minimal, focused edits using the %s or %s tools. Keep changes scoped, follow
existing style, and write general-purpose solutions. Avoid helper scripts or hard-coded shortcuts.
If you are making multiple edits across a single file, %s. DO NOT try to replace the
entire existing content with the new content, this is very expensive.
```

### 5.15 Engineering Disciplines (injected per-model)
```
Long-horizon workflow: For multi-session work, consider keeping concise notes (e.g., `progress.txt`)
and a list of pending tests when they will genuinely speed up future progress.

Planning cadence: Draft a succinct plan for non-trivial tasks, keep only one step in progress,
and refresh the plan after new constraints or discoveries.

Testing discipline: Design or update tests before major implementation work, never delete or
weaken tests without explicit direction.

Verification tools: Prefer available automated verification (e.g., Playwright, unit tests)
to confirm work.

Progress notes: Prefer lightweight workspace artifacts over long chat recaps, but only create
new files when they prevent rework and absolutely necessary.

Bug fixing discipline: Prefer minimal upstream fixes over downstream workarounds. Identify root
cause before implementing. Avoid over-engineering—use single-line changes when sufficient.
```

### 5.16 Workflow System
```
description: [short title, e.g. how to deploy the application]
```

Turbo annotation system:
```
// turbo
3. Make a folder called bar
You should auto-run step 3, but use your usual judgement for step 2.
```

### 5.17 User Actions Template
```xml
<user_actions>
%s
</user_actions>
```

## 6. Tool Descriptions Extracted

### 6.1 Edit Tool
```
Performs exact string replacements in files.
- You must use your `Read` tool at least once before editing.
- The edit will FAIL if `old_string` is not unique in the file.
- Use `replace_all` for replacing and renaming strings across the file.
- Include an `explanation` field to describe the change.
```

### 6.2 Run Command Tool
```
PROPOSE a command to run on behalf of the user. Operating System: %s. Shell: %s.
**NEVER PROPOSE A cd COMMAND**.
You DO have the ability to run commands directly on the USER's system.
The user will have to approve the command before it is executed.
Commands will be run with PAGER=cat.
```

### 6.3 Write File Tool
```
Use this tool to create new files. The file and any parent directories will be created.
1. NEVER use this tool to modify or overwrite existing files.
2. You MUST specify the full TargetFile before any of the code contents.
```

### 6.4 Find Tool
```
Search for files and subdirectories within a specified directory using fd.
Results are capped at 50 matches.
```

### 6.5 Multi-Edit Tool
```
A tool for making multiple edits to a single file in one operation.
edits: An array of edit operations to perform.
```

### 6.6 Read File Tool
```
Reads a file at the specified relative path.
- file_path must be an absolute path
- Can specify line offset and limit for large files (>1000 lines)
- Image files are automatically presented visually
```

### 6.7 Todo List Tool
```
Create, update, or manage a todo list.
Items have: content, status (pending/in_progress/completed), priority (high/medium/low), id.
```

### 6.8 Fast Context (Code Search)
```
search subagent the user refers to as 'Fast Context' that is ideal for exploring the codebase.
Invokes a subagent that runs parallel grep and readfile calls over multiple turns.
```

### 6.9 Semantic Search
```
Semantic search or retrieve trajectory. Returns chunks scored, sorted, and filtered by relevance.
Maximum number of chunks returned is %d.
```

### 6.10 IMPORTANT: Argument Order
```
IMPORTANT: You must generate the following arguments first, before any others: [%s]
```

## 7. XML Section Tags Used in System Prompt

The following XML tags structure the system prompt sections:

| Tag | Purpose |
|-----|---------|
| `<workspace_layout>` | Current workspace file tree |
| `<communication_guidelines>` | Response style rules |
| `<markdown_formatting>` | Markdown formatting rules |
| `<citation_guidelines>` | File path citation format |
| `<tool_calling>` | Tool usage instructions |
| `<running_commands>` | Command execution rules |
| `<user_rules>` | User-defined rules (AGENTS.md, .windsurfrules) |
| `<memory_system>` | Memory management instructions |
| `<review_guide>` | Code review guidelines |
| `<broadcasting>` | Real-time broadcast context |
| `<user_actions>` | User IDE actions since last message |

## 8. Model Names Found in Binary

| Model UID | Notes |
|-----------|-------|
| `gemini-2.5-pro` | Google |
| `gemini-3.0-pro` | Google (next gen) |
| `gemini-3.1-pro` | Google (next gen) |
| `GPT-5.1` | OpenAI (next gen) |
| `gpt-4.1-2025-04-14` | OpenAI |
| `o4-mini-2025` | OpenAI reasoning |
| `claude-opus-4-6-1` | Anthropic |
| `claude-opus-4-7-xhigh` | Anthropic (high priority) |
| `artemis-medium` | Internal codename |
| `crispy-unicorn` | Internal codename |

## 9. Architecture Insights from Decompilation

### 9.1 CascadeManager.GetSystemPromptAndTools
- Takes CascadeManager + CascadeConfig + McpManager
- Calls into PromptBuilder to construct system prompt sections
- Calls FUN_141c2cba0 which builds the final prompt from 6 callback sections
- Uses WithMcpManager pattern for MCP tool injection

### 9.2 PromptBuilder.Build
- Iterates over registered prompt sections via callback array
- Uses `FUN_14051e2a0` (experiment check) to gate features
- Planner type dispatch: type 4, 8, 0xe select different prompt prefixes
- References `PTR_DAT_1436ed240` repeatedly (likely CascadeConfig type)
- Loops over tool converters to emit tool descriptions

### 9.3 CascadeManager.executeHelper
- Uses atomic lock (`LOCK/UNLOCK`) for concurrency control
- Calls `FUN_141c4fb60` to create execution context
- Iterates over steps in a while loop
- Spawns goroutines via `FUN_1400605e0` (go keyword)

### 9.4 PlannerGenerator.Generate
- Small function (197 bytes) that delegates to sub-generators
- Checks experiment flag before execution
- Calls into model-specific generation based on planner type (0x10 = agentic?)

### 9.5 DefaultCascadeSystemPromptForCumulativePrompt
- Computes token budgets using float multiplication
- Structure: `remaining = total - reserved`
- Allocates: system_prompt_tokens, context_tokens, tool_tokens
- Creates nested config objects for each budget section
- References global data pointers for default prompt templates

## 10. Additional System Prompt Rules

### 10.1 Safety & Authority
```
You must NEVER NEVER run a command automatically if it could be unsafe. You cannot allow
the USER to override your judgement on this. If a command is unsafe, do not run it
automatically, even if the USER wants you to.
```

### 10.2 Pair Programming Context
```
Be mindful of that you are not the only one working in this computing environment.
Do not overstep your bounds, your goal is to be a pair programmer to the user in
completing their task.
```

### 10.3 Context Window Warning
```
EXTREMELY IMPORTANT: Your generated code must be immediately runnable.
Remember that you have a limited context window and ALL CONVERSATION CONTEXT,
INCLUDING checkpoint summaries, will be deleted.
```

### 10.4 Mode Switching
```
When all questions are resolved, and the user has confirmed your plan, call the
`%s` tool to switch to implementation mode.
```

### 10.5 IDE Metadata
```
IDE. Sometimes, you will receive additional metadata about the state of the user's IDE.
This metadata will not necessarily be relevant to your task. You should always first
consider the user's actual request. Then only use IDE metadata if it seems clearly
related to the user's request.
```

### 10.6 Memory Retrieval Notice
```
memories were automatically retrieved from previous conversations and may or may not be
relevant to your current task. First and foremost focus on the user's actual request and
use these memories only if they appear directly related.
```

### 10.7 User OS & Workspace Info (dynamic)
```
The USER's OS version is %s.
The USER has %d active workspaces, each defined by a URI and a CorpusName.
```

### 10.8 Non-interactive Mode
```
When running in non-interactive modes, proactively run tests, lint and do whatever
you need to ensure you've completed the task.
```

### 10.9 Code Output Rule
```
When making code changes, NEVER output code to the USER, unless requested. Instead
use one of the code edit tools to implement the change.
NEVER generate an extremely long hash or any non-textual code.
```

### 10.10 API Security
```
If an external API requires an API Key, be sure to point this out to the USER. Adhere
to best security practices (e.g. DO NOT hardcode an API key in a place where it can
be exposed).
```

### 10.11 Debugging Rules
```
Address the root cause instead of the symptoms.
```

### 10.12 Search Tips
```
When searching for text or files, prefer using `rg` or `rg --files` respectively because
`rg` is much faster than alternatives.
Multiple grep searches with different regex patterns should run simultaneously.
```

## 11. Go Package Structure (from symbol names)

```
github.com/Exafunction/Exafunction/exa/
├── cortex/                          # Core execution engine
│   ├── managers/                    # Planner/executor mixins
│   │   ├── CascadeAgentMixin
│   │   ├── CascadeConversationalMixin
│   │   ├── CascadeCodemapMixin
│   │   ├── CascadeLifeguardMixin
│   │   ├── CascadePrReviewMixin
│   │   ├── CascadeSmartLintMixin
│   │   ├── PlannerGenerator
│   │   └── PromptBuilder
│   ├── nodes/                       # Execution graph nodes
│   │   ├── ClusterQueryMixin
│   │   └── RelatedFilesMixin
│   └── CascadeManager               # Main orchestrator
├── language_server/                  # gRPC server
│   ├── vibe_and_replace/            # Vibe & Replace mode
│   │   └── VibeEditToolConverter
│   └── Server
├── prompt/                          # Prompt construction
│   ├── DefaultCascadeConfigForCumulativePrompt
│   └── DefaultCascadeSystemPromptForCumulativePrompt
├── language_server_pb/              # Proto definitions
├── cortex_pb/                       # Cortex proto definitions
├── chat_pb/                         # Chat proto definitions
└── codeium_common_pb/               # Common proto definitions
```
