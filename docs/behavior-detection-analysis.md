# Windsurf Cascade 行为检测与限速机制 深度分析

## 概述

从 LS binary + Proto 定义中提取的完整行为检测、限速、安全审查机制。
Windsurf 使用 **6 层防御体系** 控制 AI 行为和用户使用量。

---

## 1. 信用/配额系统 (Credits & Quota)

### 1.1 三种信用类型

从 `PlanStatus` proto 定义:
```protobuf
message PlanStatus {
  int32 available_prompt_credits = 8;   // 可用 prompt credits
  int32 available_flow_credits = 9;     // 可用 flow credits  
  int32 available_flex_credits = 4;     // 可用 flex credits
  int32 used_flex_credits = 7;
  int32 used_flow_credits = 5;
  int32 used_prompt_credits = 6;
  int32 daily_quota_remaining_percent = 14;   // 每日配额剩余百分比
  int32 weekly_quota_remaining_percent = 15;  // 每周配额剩余百分比
  int64 overage_balance_micros = 16;          // 超额余额 (微分)
  int64 daily_quota_reset_at_unix = 17;       // 每日配额重置时间
  int64 weekly_quota_reset_at_unix = 18;      // 每周配额重置时间
  GracePeriodStatus grace_period_status = 12; // 宽限期状态
  google.protobuf.Timestamp grace_period_end = 13;
}
```

| 信用类型 | 说明 | 用途 |
|----------|------|------|
| **Prompt Credits** | 月度固定配额 | 每次 AI 对话消耗 |
| **Flow Credits** | 月度固定配额 | 工作流/自动化操作 |
| **Flex Credits** | 购买的额外信用 | 超额后使用 |

### 1.2 每次请求的信用消耗

从 `GetChatMessageResponse` proto:
```protobuf
int32 credit_cost = 14;                            // 本次请求信用消耗
int32 committed_credit_cost = 18;                   // 实际扣除的信用
optional int64 committed_quota_cost_basis_points = 26;  // 配额消耗 (基点)
optional int64 committed_overage_cost_cents = 27;       // 超额消耗 (分)
```

### 1.3 模型定价分级

```protobuf
enum ModelCostTier {
  MODEL_COST_TIER_UNSPECIFIED = 0;
  MODEL_COST_TIER_LOW = 1;      // 低成本
  MODEL_COST_TIER_MEDIUM = 2;   // 中等成本
  MODEL_COST_TIER_HIGH = 3;     // 高成本 (推断)
}

enum BillingStrategy {
  BILLING_STRATEGY_CREDITS = 1;  // 按固定信用计费
  BILLING_STRATEGY_QUOTA = 2;    // 按配额计费
  BILLING_STRATEGY_ACU = 3;      // 按 ACU (AI Compute Unit) 计费
}

enum ModelPricingType {
  MODEL_PRICING_TYPE_STATIC_CREDIT = 1;  // 固定信用
  MODEL_PRICING_TYPE_API = 2;             // API 计费
  MODEL_PRICING_TYPE_BYOK = 3;            // 自带 API Key
  MODEL_PRICING_TYPE_ACU_TOKEN = 4;       // 按 token ACU 计费
  MODEL_PRICING_TYPE_ACU_CREDIT = 5;      // 按信用 ACU 计费
}
```

每个模型配置包含:
```protobuf
message ClientModelConfig {
  float credit_multiplier = 3;   // 信用倍率
  bool is_premium = 7;           // 是否为高级模型
  repeated TeamsTier allowed_tiers = 12;  // 允许使用的套餐层级
  bool is_capacity_limited = 20;          // 是否有容量限制
  ModelCostTier model_cost_tier = 24;     // 成本分级
}
```

### 1.4 套餐层级控制

```protobuf
enum TeamsTier {
  TEAMS_TIER_UNSPECIFIED = 0;
  TEAMS_TIER_TEAMS = 1;   // Teams 版
  TEAMS_TIER_PRO = 2;     // Pro 版
}

message PlanInfo {
  TeamsTier teams_tier = 1;
  int64 max_num_premium_chat_messages = 6;   // 高级模型最大消息数
  int64 max_num_chat_input_tokens = 7;       // 最大输入 token
  int32 monthly_prompt_credits = 12;          // 月度 prompt credits
  int32 monthly_flow_credits = 13;            // 月度 flow credits
  bool can_buy_more_credits = 18;             // 是否可购买更多
  bool cascade_can_auto_run_commands = 22;    // 是否允许自动执行命令
  bool allow_sticky_premium_models = 4;       // 是否允许锁定高级模型
  bool allow_premium_command_models = 15;     // 高级命令模型
  bool hide_daily_quota = 36;                 // 是否隐藏每日配额显示
  bool hide_weekly_quota = 37;                // 是否隐藏每周配额显示
  BillingStrategy billing_strategy = 35;      // 计费策略
  DevinPlanInfo devin_info = 33;              // Devin 特有信息
  bool is_devin = 34;                         // 是否为 Devin 用户
}
```

### 1.5 信用购买系统

```protobuf
message PurchaseCascadeCreditsRequest {
  string auth_token = 1;
  optional int32 overage_amount = 6;    // 超额购买量
}

message PurchaseCascadeCreditsResponse {
  string checkout_url = 1;
  int64 add_on_credits_available = 2;   // 可用附加信用
  int64 add_on_credits_used = 3;        // 已用附加信用
}

message UpdateCreditTopUpSettingsRequest {
  bool enabled = 2;                  // 是否启用自动充值
  int32 monthly_top_up_amount = 3;   // 月度充值额度
  int32 top_up_increment = 4;        // 充值增量
}
```

---

## 2. 速率限制 (Rate Limiting)

### 2.1 消息级速率限制

```protobuf
// 检查单条消息速率限制
rpc CheckUserMessageRateLimit (CheckUserMessageRateLimitRequest) 
    returns (CheckUserMessageRateLimitResponse);

message CheckUserMessageRateLimitRequest {
  Metadata metadata = 1;
  string model_uid = 3;    // 按模型限速
}

message CheckUserMessageRateLimitResponse {
  bool has_capacity = 1;           // 是否有容量
  string message = 2;              // 限速消息 (显示给用户)
  int32 messages_remaining = 3;    // 剩余消息数
  int32 max_messages = 4;          // 最大消息数
}
```

### 2.2 会话级容量检查

```protobuf
// 检查聊天容量 (是否可开新会话)
rpc CheckChatCapacity (CheckChatCapacityRequest) 
    returns (CheckChatCapacityResponse);

message CheckChatCapacityRequest {
  Metadata metadata = 1;
  string model_uid = 3;
}

message CheckChatCapacityResponse {
  bool has_capacity = 1;      // 是否有容量
  string message = 2;         // 容量不足消息
  int32 active_sessions = 3;  // 当前活跃会话数
}
```

### 2.3 每日/每周配额

`PlanStatus` 中的配额字段:
- `daily_quota_remaining_percent` — 每日配额剩余百分比
- `weekly_quota_remaining_percent` — 每周配额剩余百分比
- `daily_quota_reset_at_unix` — 每日重置时间戳
- `weekly_quota_reset_at_unix` — 每周重置时间戳

实验开关 `CASCADE_ENFORCE_QUOTA` (ExperimentKey=204) 控制是否启用配额强制执行。

### 2.4 超额计费

```protobuf
int64 overage_balance_micros = 16;  // PlanStatus 中的超额余额
optional int64 committed_overage_cost_cents = 27;  // 每次请求的超额成本
```

---

## 3. 使用量记录 (Usage Recording)

### 3.1 RecordCascadeUsage

```protobuf
message RecordCascadeUsageRequest {
  Metadata metadata = 1;
  string trajectory_id = 2;
  int32 step_index = 3;
  int32 prompt_credits_used = 4;       // prompt 信用消耗
  int32 flow_credits_used = 5;         // flow 信用消耗
  ConversationalPlannerMode planner_mode = 6;
  string cascade_id = 7;
  ModelOrAlias model = 8;
  string model_uid = 18;
  double prompt_credits_per_acu = 19;  // 每 ACU 的 prompt 信用
  int64 list_cost_micros = 20;         // 列表价格 (微分)
  int64 discounted_cost_micros = 23;   // 折扣后价格
  BillingStrategy billing_strategy = 21;
  double cli_acu_multiplier = 17;      // CLI ACU 倍率
}

message RecordCascadeUsageResponse {
  UserStatus user_status = 2;          // 返回最新用户状态
  int32 prompt_credits_used = 3;       // 已用 prompt 信用
  int32 flex_credits_used = 4;         // 已用 flex 信用
}
```

### 3.2 CascadeAnalytics

```protobuf
message GetCascadeAnalyticsResponse {
  int32 used_prompt_credits = 1;
  int32 used_flow_credits = 2;
  int32 estimated_monthly_prompts = 3;   // 预估月度 prompt 用量
  int32 estimated_monthly_flows = 4;     // 预估月度 flow 用量
  int64 purchased_credits = 5;           // 已购买信用
}
```

---

## 4. 行为检测与 Prompt 注入 (Agent-Side)

### 4.1 渐进式编辑失败惩罚 (3 级)

**Level 1: Lint Feedback (温和提醒)**
```
As IDE feedback, the following lint errors may be related to your recent edits...
AVOID unproductive loops; if you detect yourself repeatedly creating/fixing lints
in a short period, offer some thoughts but MOVE ON.
```

**Level 2: EXTREME SUSPICION (强制自检)**
```
EXTREME SUSPICION REQUIRED: You have failed %d consecutive times on this file.
Before attempting another edit, you MUST:
(1) Explain in detail why EACH of the previous failed tool calls failed
(2) Explain in detail why your upcoming tool call will succeed where the others failed
(3) Be EXTREMELY suspicious of your upcoming change and double-check every detail.
Most likely, unless you make significant changes to your tool call, you will fail again.
```

**Level 3: BANNED (编辑禁令)**
```
BANNED: You have failed %d consecutive times on this file. You are BANNED from
making further edit attempts on this file until the next user message, or when
given explicit permission. Instead, you MUST use alternative approaches such as:
(1) using sed commands
(2) finding other solutions which don't require this edit
(3) asking the user for help
(4) using other tools.
Do NOT attempt another edit on this file.
```

独立 Notebook BANNED:
```
BANNED: You have failed %d consecutive times on this notebook. You are BANNED
from making further edit attempts on this file until the next user message.
```

### 4.2 文件大小限制

```
!! IMPORTANT
This file is too large to be edited. Do not try again to use the edit / edit
proposal tool. Present the user with the change to make via a regular message.
Do not try to make the edit yourself.
!! IMPORTANT
```

空 diff 检测:
```
!! IMPORTANT
The generated diff shows no changed lines. Do not try again to use the edit /
edit proposal tool. Present the user with the change to make via a regular message.
!! IMPORTANT
```

### 4.3 Context Window 警告

```
Remember that you have a limited context window and ALL CONVERSATION CONTEXT,
INCLUDING checkpoint summaries, will be deleted.
```

### 4.4 命令安全检查

```
You must NEVER NEVER run a command automatically if it could be unsafe. You cannot
allow the USER to override your judgement on this. If a command is unsafe, do not
run it automatically, even if the USER wants you to.
```

用户拒绝后:
```
user reviewed the command and decided not to run it, check with the user to continue
```

### 4.5 意外变更检测

```
While you are working, you might notice unexpected changes that you didn't make.
If this happens, STOP IMMEDIATELY and ask the user how they would like to proceed.
```

---

## 5. Lifeguard 安全审查系统

### 5.1 架构

从 LS binary Go 源码路径:
```
exa/language_server/lifeguard_agent_manager.go
```

- 使用 `cognition-lifeguard` 模型
- Lifeguard Agent v2
- 通过 `GetLifeguardConfig` API 获取配置

### 5.2 banned_extensions 系统

LS 内有独立的 banned extensions 管理:
```
exa/language_server/banned_extensions.go
```
用于阻止已知恶意或不安全的 MCP 扩展。

---

## 6. Feature Flag 系统 (Unleash)

### 6.1 Unleash 客户端

LS 集成了 Unleash feature flag 系统:
```
github.com/Unleash/unleash-client-go/v4
```

策略类型:
- `applicationHostnameStrategy` — 按主机名
- `defaultStrategy` — 默认策略
- `flexibleRolloutStrategy` — 灵活灰度
- `normalizedRolloutValue` — 归一化灰度值

### 6.2 Cascade 相关实验开关

从 `ExperimentKey` enum 提取 (总计 150+ 开关):

| Key | ID | 说明 |
|-----|-----|------|
| `CASCADE_ENFORCE_QUOTA` | 204 | **强制执行配额** |
| `CASCADE_BASE_MODEL_ID` | 190 | 基础模型选择 |
| `CASCADE_PLAN_BASED_CONFIG_OVERRIDE` | 266 | 按套餐覆盖配置 |
| `CASCADE_GLOBAL_CONFIG_OVERRIDE` | 212 | 全局配置覆盖 |
| `CASCADE_ENABLE_AUTOMATED_MEMORIES` | 224 | 自动记忆 |
| `CASCADE_MEMORY_CONFIG_OVERRIDE` | 314 | 记忆配置覆盖 |
| `CASCADE_USE_REPLACE_CONTENT_EDIT_TOOL` | 228 | 替换内容编辑工具 |
| `CASCADE_VIEW_FILE_TOOL_CONFIG_OVERRIDE` | 258 | 查看文件工具覆盖 |
| `CASCADE_USE_EXPERIMENT_CHECKPOINTER` | 247 | 实验性检查点 |
| `CASCADE_ENABLE_MCP_TOOLS` | 245 | MCP 工具开关 |
| `CASCADE_AUTO_FIX_LINTS` | 275 | 自动修复 lint |
| `CASCADE_USER_MEMORIES_IN_SYS_PROMPT` | 289 | 用户记忆注入 prompt |
| `CASCADE_ENABLE_PROXY_WEB_SERVER` | 290 | 代理 Web 服务器 |
| `CASCADE_DEFAULT_MODEL_OVERRIDE` | 321 | 默认模型覆盖 |
| `CASCADE_BACKGROUND_RESEARCH_CONFIG_OVERRIDE` | 193 | 后台研究配置 |
| `CASCADE_WEB_APP_DEPLOYMENTS_ENABLED` | 300 | Web 应用部署 |
| `CASCADE_WINDSURF_BROWSER_TOOLS_ENABLED` | 328 | 浏览器工具 |
| `CASCADE_MODEL_HEADER_WARNING` | 329 | 模型 header 警告 |
| `CASCADE_TOOL_CALL_PRICING_NUX` | 322 | 工具调用定价提示 |
| `CASCADE_RECIPES_AT_MENTION_VISIBILITY` | 316 | @mention 可见性 |
| `CASCADE_ONBOARDING` | 326 | 入门引导 |
| `CASCADE_PLUGINS_TAB` | 323 | 插件 Tab |
| `CASCADE_NEW_MODELS_NUX` | 259 | 新模型提示 |

### 6.3 Prompt 配置实验

```
Failed to parse cumulative prompt config from experiment %s from unleash
```
- `CUMULATIVE_PROMPT_CONFIG` (256) — 累积 prompt 配置
- `CUMULATIVE_PROMPT_CASCADE_CONFIG` (279) — Cascade 专用 prompt 配置
- 通过 Unleash 动态控制 prompt 模板内容

### 6.4 烦扰管理器 (Annoyance Manager)

```
ANNOYANCE_MANAGER_MAX_NAVIGATION_RENDERS = 285
ANNOYANCE_MANAGER_INLINE_PREVENTION_THRESHOLD_MS = 286
ANNOYANCE_MANAGER_INLINE_PREVENTION_MAX_INTENTIONAL_REJECTIONS = 287
ANNOYANCE_MANAGER_INLINE_PREVENTION_MAX_AUTO_REJECTIONS = 288
```
- 控制自动补全的展示频率
- 检测用户拒绝行为，动态减少展示
- `MAX_INTENTIONAL_REJECTIONS` — 最大有意拒绝次数
- `MAX_AUTO_REJECTIONS` — 最大自动拒绝次数

---

## 7. 团队/企业级控制 (TeamConfig)

```protobuf
message TeamConfig {
  int32 user_prompt_credit_cap = 2;          // 单用户 prompt 信用上限
  int32 user_flow_credit_cap = 3;            // 单用户 flow 信用上限
  int32 user_add_on_credit_cap = 30;         // 附加信用上限
  bool auto_provision_cascade_seat = 4;      // 自动分配席位
  bool allow_mcp_servers = 5;                // 允许 MCP 服务器
  bool allow_auto_run_commands = 7;          // 允许自动执行命令
  optional int32 max_session_duration_seconds = 34; // 最大会话时长
  bool disable_tool_call_execution_outside_workspace = 26;  // 禁止工作区外执行
  bool disable_deepwiki = 28;
  bool disable_codemaps = 31;
  bool disable_fast_context = 33;
  bool allow_vibe_and_replace = 27;
}
```

---

## 8. Arena Mode 与模型路由

### 8.1 Arena 配置

```protobuf
enum ArenaTier {
  ARENA_TIER_FAST = 1;    // 快速模式
  ARENA_TIER_SMART = 2;   // 智能模式
}

message ArenaConfig {
  float tokens_per_second = 2;
}

// 模型配置中的 Arena 相关
float arena_mode_cost_fast = 4;   // 快速模式成本
float arena_mode_cost_smart = 5;  // 智能模式成本
```

### 8.2 Arena JWT 与模型分配

从 binary 中发现:
- `arena_assignment_jwt` — Arena 模型分配 JWT
- `ConvergeArenaCascades` — Arena 会话收敛
- `AssignArenaModel` RPC — 分配 Arena 模型
- `arena_invocation_cap_reached` — Arena 调用上限已达

### 8.3 模型路由

- `dev-model-router` — 开发环境模型路由器
- `DISPLAY_OPTION_MODEL_ROUTER` — 模型路由显示选项
- `model_group_variant_preferences` — 模型组变体偏好
- `allow_sticky_premium_models` — 允许锁定高级模型

---

## 9. 遥测与追踪 (Telemetry)

### 9.1 Sentry 集成

- `sentry_telemetry` — Sentry 遥测开关
- `SENTRY_ENVIRONMENT` — 环境标识
- `WINDSURF_SENTRY_SAMPLE_RATE` (ExperimentKey=198) — 采样率控制
- `PROFILING_TELEMETRY_SAMPLE_RATE` (ExperimentKey=219) — 性能分析采样率

### 9.2 设备指纹

```protobuf
message Metadata {
  string device_fingerprint = 24;  // 设备指纹
}

message UserStatus {
  bool has_fingerprint_set = 30;   // 是否已设置指纹
}
```

### 9.3 使用量跟踪

```protobuf
message TeamMember {
  google.protobuf.Timestamp last_autocomplete_usage_time = 9;
  google.protobuf.Timestamp last_chat_usage_time = 10;
  google.protobuf.Timestamp last_command_usage_time = 11;
  int64 prompt_credits_used = 12;
  int64 tabs_generated = 14;
  int64 cascade_messages = 15;
}
```

### 9.4 安装时间追踪

- `time_since_install` — 距安装的时间
- `first_windsurf_use_time` — 首次使用时间
- `windsurf_pro_trial_end_time` — Pro 试用到期时间

---

## 10. CascadeConfig 控制字段

从 proto 提取的 CascadeConfig 关键字段:
```
cascade_tools_enabled            — 工具是否启用
cascade_read_only_mode           — 只读模式
enable_model_based_auto_execution — 基于模型的自动执行
cascade_run_extension_code       — 运行扩展代码
cascade_run_extension_code_auto_run — 自动运行扩展代码
cascade_input_autocomplete       — 输入自动补全
claude_code_max_turns            — Claude Code 最大轮次
claude_code_system_prompt        — Claude Code 自定义 prompt
claude_code_append_system_prompt — 追加 system prompt
claude_code_model                — Claude Code 使用的模型
disable_superflow                — 禁用 superflow
last_arena_mode_category         — 上次 Arena 模式类别
```

---

## 11. 宽限期系统 (Grace Period)

```protobuf
enum GracePeriodStatus {
  GRACE_PERIOD_STATUS_UNSPECIFIED = 0;
  GRACE_PERIOD_STATUS_NONE = 1;     // 无宽限期
  GRACE_PERIOD_STATUS_ACTIVE = 2;   // 宽限期中
}
```
- 配额耗尽后不会立即断服，有宽限期
- `grace_period_end` 标记宽限期结束时间

---

## 总结: 完整限速/检测链路

```
用户发送消息
  │
  ├─ 1. CheckChatCapacity → 检查是否有新会话容量
  │     └─ 返回 has_capacity + active_sessions
  │
  ├─ 2. CheckUserMessageRateLimit → 检查消息速率
  │     └─ 返回 has_capacity + messages_remaining + max_messages
  │
  ├─ 3. PlanStatus 检查
  │     ├─ daily_quota_remaining_percent (每日配额)
  │     ├─ weekly_quota_remaining_percent (每周配额)
  │     ├─ available_prompt_credits (剩余 prompt 信用)
  │     └─ grace_period_status (宽限期)
  │
  ├─ 4. 模型级检查
  │     ├─ is_premium → allowed_tiers 限制
  │     ├─ is_capacity_limited → 容量限制
  │     ├─ credit_multiplier → 信用消耗倍率
  │     └─ arena_invocation_cap_reached → Arena 上限
  │
  ├─ 5. AI 执行中
  │     ├─ Lifeguard (cognition-lifeguard) → 安全审查
  │     ├─ Lint Feedback → 编辑质量检查
  │     ├─ EXTREME SUSPICION → 连续失败检测
  │     ├─ BANNED → 编辑禁令
  │     └─ File Too Large → 大文件保护
  │
  └─ 6. 执行后记录
        ├─ RecordCascadeUsage → 记录信用消耗
        ├─ credit_cost / committed_credit_cost
        ├─ overage_cost_cents → 超额计费
        └─ UserStatus 更新
```

### Feature Flag 动态控制

Unleash 可远程开关:
- `CASCADE_ENFORCE_QUOTA` → 是否强制执行配额
- `CASCADE_AUTO_FIX_LINTS` → 自动修复开关
- `CUMULATIVE_PROMPT_CASCADE_CONFIG` → 动态修改 prompt 模板
- Annoyance Manager → 动态调节展示频率

---

## 12. Lifeguard 安全系统 (完整逆向)

### 12.1 架构概览

Lifeguard 是独立的 AI 安全审查层，拥有自己的:
- **专用模型**: `MODEL_COGNITION_LIFEGUARD` (ID=410), `MODEL_LLAMA_FT_LIFEGUARD` (ID=398)
- **独立 prompt**: `lifeguard_v2_system_prompt` (v2 版本)
- **独立 trajectory 源**: `CORTEX_TRAJECTORY_SOURCE_LIFEGUARD` (ID=15)
- **独立请求类型**: `CHAT_MESSAGE_REQUEST_TYPE_LIFEGUARD` (ID=14)
- **Go Manager**: `exa/language_server/lifeguard_agent_manager.go`

### 12.2 Lifeguard 配置

```protobuf
message LifeguardConfig {
  map<string, LifeguardModeConfig> modes = 1;  // 按模式配置
}

message LifeguardModeConfig {
  bool enabled = 1;                  // 是否启用
  Model model = 2;                    // 使用的模型
  string model_display_name = 3;      // 模型显示名
  string agent_version = 4;           // agent 版本 (v2)
}
```

### 12.3 Lifeguard Bug 报告

Lifeguard 检测到的 bug 以结构化格式报告:
```protobuf
message LifeguardBug {
  string id = 1;
  string file = 2;
  int32 start = 3;            // 起始行
  int32 end = 4;              // 结束行
  string title = 5;           // Bug 标题
  string description = 6;     // Bug 描述
  string severity = 7;        // 严重程度
  string resolution = 8;      // 解决方案
  optional string fix_old_str = 9;   // 修复: 旧代码
  optional string fix_new_str = 10;  // 修复: 新代码
}
```

### 12.4 Planner 中的 Lifeguard 配置

```protobuf
message CascadeLifeguardPlannerConfig {
  string agent_version = 1;  // "v2"
}

// 在 CascadePlannerConfig.oneof 中:
CascadeLifeguardPlannerConfig lifeguard = 33;
```

### 12.5 可禁用

团队管理员可以禁用:
```protobuf
// TeamConfig
bool disable_lifeguard = 34;

// SeatManagement UpdateTeamFeaturesRequest
optional bool disable_lifeguard = 22;
```

---

## 13. 命令执行安全体系 (完整)

### 13.1 自动执行策略 (3 级)

```protobuf
enum CascadeCommandsAutoExecution {
  CASCADE_COMMANDS_AUTO_EXECUTION_UNSPECIFIED = 0;
  CASCADE_COMMANDS_AUTO_EXECUTION_OFF = 1;     // 完全禁止自动执行
  CASCADE_COMMANDS_AUTO_EXECUTION_AUTO = 2;    // 允许自动执行
}
```

### 13.2 多层允许/拒绝列表

```protobuf
message AutoCommandConfig {
  optional bool enable_model_auto_run = 1;      // 模型级自动执行
  repeated string user_allowlist = 2;            // 用户允许列表
  repeated string user_denylist = 3;             // 用户拒绝列表
  repeated string system_allowlist = 4;          // 系统允许列表
  repeated string system_denylist = 5;           // 系统拒绝列表
  repeated string system_nooplist = 7;           // 系统空操作列表
  CascadeCommandsAutoExecution auto_execution_policy = 6;
  CascadeCommandsAutoExecution max_auto_execution_level = 8;   // 最大自动执行级别
  CascadeCommandsAutoExecution workflow_auto_execution_policy = 9;
  repeated string team_allowlist = 10;           // 团队允许列表
  repeated string team_denylist = 11;            // 团队拒绝列表
  repeated string cascade_config_allowlist = 12; // Cascade 配置允许列表
  repeated string cascade_config_denylist = 13;  // Cascade 配置拒绝列表
}
```

**5 层优先级**: team → system → cascade_config → user → model

### 13.3 Web 请求自动执行

```protobuf
message AutoWebRequestConfig {
  repeated string allowlist = 1;           // URL 允许列表
  CascadeWebRequestsAutoExecution auto_execution_policy = 2;
}
```

### 13.4 RunCommand 工具配置

```protobuf
message RunCommandToolConfig {
  uint32 max_chars_command_stdout = 1;     // 最大 stdout 字符数
  optional bool force_disable = 2;          // 强制禁用命令执行
  AutoCommandConfig auto_command_config = 3;
  optional bool enable_ide_terminal_execution = 4;  // IDE 终端执行
  optional bool enable_midterm_output_processor = 8; // 中间输出处理
}
```

### 13.5 终端允许/拒绝列表 (团队级)

```protobuf
// TeamConfig
repeated string terminal_allow_list = 39;
repeated string terminal_deny_list = 40;
```

---

## 14. 企业级安全控制 (TeamOrganizationalControls)

### 14.1 完整控制结构

```protobuf
message TeamOrganizationalControls {
  // 模型过滤
  ModelFilterMode model_filter_mode = 14;
  repeated string cascade_model_uids = 11;     // 允许的 Cascade 模型
  repeated string command_model_uids = 12;      // 允许的命令模型
  repeated string cli_model_uids = 13;          // 允许的 CLI 模型
  repeated string blocked_model_tags = 19;      // 被阻止的模型标签
  
  // 安全验证
  CyberVerificationEnabled anthropic_cyber_verification_enabled = 18;
  string anthropic_profile_id = 16;
  string anthropic_cyber_verification_status = 17;
  
  // 功能开关
  AdaptiveSetting adaptive_setting = 15;
  QuickReviewSetting quick_review_setting = 20;
}
```

### 14.2 Cyber Verification

```protobuf
enum CyberVerificationEnabled {
  CYBER_VERIFICATION_ENABLED_UNSPECIFIED = 0;
  CYBER_VERIFICATION_ENABLED_ON = 1;    // 启用安全验证
  CYBER_VERIFICATION_ENABLED_OFF = 2;   // 禁用安全验证
}
```
- 与 Anthropic 的 profile_id 关联
- 企业级安全验证开关

### 14.3 TeamConfig 完整安全控制

```protobuf
message TeamConfig {
  // 信用控制
  int32 user_prompt_credit_cap = 2;       // 单用户 prompt 信用上限
  int32 user_flow_credit_cap = 3;         // 单用户 flow 信用上限
  int32 user_add_on_credit_cap = 30;      // 附加信用上限
  
  // 功能开关
  bool allow_mcp_servers = 5;
  bool allow_auto_run_commands = 7;
  bool allow_app_deployments = 10;
  bool allow_vibe_and_replace = 27;
  bool allow_browser_experimental_features = 25;
  
  // 禁用开关
  bool disable_tool_calls = 15;
  bool disable_tool_call_execution_outside_workspace = 26;
  bool disable_deepwiki = 28;
  bool disable_codemaps = 31;
  bool disable_fast_context = 33;
  bool disable_lifeguard = 34;
  
  // 网络安全
  repeated string allowed_ip_ranges = 35;
  repeated string terminal_allow_list = 39;
  repeated string terminal_deny_list = 40;
  repeated McpServerConfig allowed_mcp_servers = 23;
  
  // 会话控制
  optional int32 max_session_duration_seconds = 34;
  CascadeCommandsAutoExecution max_cascade_auto_execution_level = 37;
  
  // PR 审查
  optional int32 pull_request_review_rate_limit = 21;
  bool allow_github_auto_reviews = 24;
}
```

---

## 15. Devin 集成

### 15.1 Devin 用户识别

```protobuf
// User 消息中
string devin_user_id = 33;
string devin_account_id = 34;

// PlanInfo 中
DevinPlanInfo devin_info = 33;
bool is_devin = 34;

message DevinPlanInfo {
  bool can_use_cascade = 1;   // 可使用 Cascade
  bool can_use_cli = 2;       // 可使用 CLI
  bool is_admin = 3;          // 是否管理员
}
```

### 15.2 Summary Mode 中的 DEVIN 身份

LS binary 中的完整 Summary Mode 触发:
```
STARTING POP QUIZ. ENTER SUMMARY MODE. YOU ARE NO LONGER DEVIN,
YOU ARE DEVIN'S ASSISTANT. DO NOT TAKE ANY ACTIONS
```
- Cascade AI 在内部被称为 "DEVIN"
- Summary Mode 时切换为 "DEVIN'S ASSISTANT"
- 这证实了 Windsurf 与 Devin (Cognition AI) 的深度集成

---

## 16. Worktree 管理与会话限制

### 16.1 Worktree 限制

从 binary 提取:
```
Failed to enforce max worktrees limit for repo %s: %v
Failed to delete worktree at %s for trajectory %s: %v
Successfully deleted worktree at %s for trajectory %s
```
- LS 管理 Git worktree 池
- 有最大 worktree 数量限制
- 超限时自动删除旧 worktree

### 16.2 Cascade 删除/清理

```
cascade_deletions    // Cascade 会话删除
overall_deletions    // 总体删除
```

### 16.3 超时控制

```
command timed out     // 命令执行超时
max_session_duration_seconds  // 最大会话时长 (团队级配置)
```

---

## 17. Kill Switch 系统

从 ExperimentKey 提取的 Kill Switch:
| 开关 | ID | 说明 |
|------|-----|------|
| `NON_TEAMS_KILL_SWITCH` | 106 | 非团队用户紧急关闭 |
| `ATTRIBUTION_KILL_SWITCH` | 92 | 代码归属紧急关闭 |
| `LLAMA3_405B_KILL_SWITCH` | 119 | Llama3-405B 模型紧急关闭 |
| `FAST_SPEED_KILL_SWITCH` | 159 | 快速补全紧急关闭 |
| `API_SERVER_CUTOFF` | 158 | API 服务器截断 |

---

## 18. 模型容量与降级

### 18.1 容量降级

```protobuf
enum DeepWikiModelType {
  DEEP_WIKI_MODEL_TYPE_CAPACITY_FALLBACK = 1;  // 容量降级
  DEEP_WIKI_MODEL_TYPE_LITE_FREE = 2;
  DEEP_WIKI_MODEL_TYPE_LITE_PAID = 3;
  DEEP_WIKI_MODEL_TYPE_PREMIUM = 4;
}
```

### 18.2 模型状态监控

从 binary:
```
Model provider unreachable    // 模型提供商不可达
Error checking context: %v    // 上下文检查错误
```
- `GetModelStatuses` API 返回各模型实时状态
- `is_capacity_limited` 标记容量受限的模型
- `FastStatus` 快速模式状态

---

## 19. MitM 检测与代理

### 19.1 TLS 降级检测

```
tls: downgrade attempt detected, possibly due to a MitM attack
or a broken middlebox
```

### 19.2 代理相关

- `--detect_proxy` CLI 参数启用代理检测
- `CASCADE_ENABLE_PROXY_WEB_SERVER` (ExperimentKey=290) 代理 Web 服务器
- `proxy_web_server` 作为 tool action 类型存在

---

## 20. 完整限速/检测链路 (修订版)

```
用户发送消息
  │
  ├─ 0. 设备指纹 (device_fingerprint) 识别
  │
  ├─ 1. CheckChatCapacity → 检查是否有新会话容量
  │     └─ 返回 has_capacity + active_sessions
  │
  ├─ 2. CheckUserMessageRateLimit → 检查消息速率
  │     ├─ 按 model_uid 限速
  │     └─ 返回 has_capacity + messages_remaining + max_messages
  │
  ├─ 3. PlanStatus 配额检查
  │     ├─ daily_quota_remaining_percent (每日配额)
  │     ├─ weekly_quota_remaining_percent (每周配额)
  │     ├─ available_prompt_credits (剩余 prompt 信用)
  │     ├─ available_flow_credits (剩余 flow 信用)
  │     ├─ grace_period_status (宽限期)
  │     └─ CASCADE_ENFORCE_QUOTA (Unleash 开关)
  │
  ├─ 4. TeamConfig 企业级限制
  │     ├─ user_prompt_credit_cap (个人信用上限)
  │     ├─ max_session_duration_seconds (会话时长)
  │     ├─ disable_tool_calls (禁用工具调用)
  │     ├─ disable_tool_call_execution_outside_workspace
  │     ├─ allowed_ip_ranges (IP 白名单)
  │     ├─ terminal_allow_list / terminal_deny_list
  │     └─ max_cascade_auto_execution_level
  │
  ├─ 5. 模型级检查
  │     ├─ is_premium → allowed_tiers 限制
  │     ├─ is_capacity_limited → 容量限制
  │     ├─ credit_multiplier → 信用消耗倍率
  │     ├─ arena_invocation_cap_reached → Arena 上限
  │     └─ Model provider unreachable → 降级
  │
  ├─ 6. 命令执行安全
  │     ├─ 5 层 allowlist/denylist (team→system→config→user→model)
  │     ├─ SafeToAutoRun 判断
  │     ├─ force_disable → 强制禁用
  │     └─ MitM 检测 (TLS downgrade)
  │
  ├─ 7. AI 执行中行为检测
  │     ├─ Lifeguard (cognition-lifeguard) → 安全审查 + Bug 报告
  │     ├─ Lint Feedback → 编辑质量 (反循环保护)
  │     ├─ EXTREME SUSPICION → 连续失败 3 点自检
  │     ├─ BANNED → 编辑禁令 (改用 sed)
  │     ├─ File Too Large → 大文件保护
  │     ├─ 空 diff 检测
  │     ├─ Context Window 耗尽警告
  │     └─ Unexpected Changes → 立即停止
  │
  ├─ 8. Annoyance Manager (自动补全)
  │     ├─ max_navigation_renders → 最大渲染次数
  │     ├─ inline_prevention_threshold_ms → 阈值
  │     ├─ max_intentional_rejections → 有意拒绝上限
  │     └─ max_auto_rejections → 自动拒绝上限
  │
  ├─ 9. Kill Switch 紧急关闭
  │     ├─ NON_TEAMS_KILL_SWITCH
  │     ├─ API_SERVER_CUTOFF
  │     └─ 各模型独立 kill switch
  │
  └─ 10. 执行后记录
        ├─ RecordCascadeUsage → 信用消耗
        ├─ credit_cost / committed_credit_cost
        ├─ committed_quota_cost_basis_points → 配额消耗
        ├─ committed_overage_cost_cents → 超额计费
        ├─ CascadeAnalytics → 使用量分析
        └─ UserStatus 更新 (plan_status)
```

---

## 21. Extension.js 客户端限速 UI 逻辑

### 21.1 计费策略分流

extension.js 根据 `billingStrategy` 分为两套 UI:

```javascript
// 判断计费模式
const billingStrategy = planInfo.billingStrategy === BillingStrategy.QUOTA
  ? WindsurfBillingStrategy.Quota    // 配额制
  : WindsurfBillingStrategy.Credits; // 信用制

// 配额制: 提取每日/每周剩余
quotaUsage = {
  dailyRemainingPercent: planStatus.dailyQuotaRemainingPercent ?? 100,
  weeklyRemainingPercent: planStatus.weeklyQuotaRemainingPercent ?? 100,
  overageBalanceMicros: Number(planStatus.overageBalanceMicros ?? 0),
  dailyResetAtUnix: Number(planStatus.dailyQuotaResetAtUnix ?? 0),
  weeklyResetAtUnix: Number(planStatus.weeklyQuotaResetAtUnix ?? 0),
};

// 信用制: 计算剩余
usage = {
  messages: monthlyPromptCredits,
  flowActions: monthlyFlowCredits,
  flexCredits: (可购买 ? usedFlexCredits : Infinity),
  remainingMessages: monthlyPromptCredits - usedPromptCredits,
  remainingFlowActions: monthlyFlowCredits - usedFlowCredits,
  remainingFlexCredits: flexCredits - usedFlexCredits,
};
```

### 21.2 配额耗尽 UI 显示

```javascript
// updatePlanInfoDisplayForQuota
const quotaExhausted = (!hideDailyQuota && dailyRemaining <= 0)
                    || (!hideWeeklyQuota && weeklyRemaining <= 0);
const hasOverage = overageBalanceMicros > 0;

if (quotaExhausted) {
  if (hasOverage) {
    text = `${planName} - Extra Usage Active`;       // 超额使用中
    backgroundColor = undefined;
  } else {
    text = `$(error) ${planName} - Quota Exhausted`; // 配额耗尽 (红色!)
    backgroundColor = "statusBarItem.errorBackground";
  }
} else {
  text = planName;
}

tooltip = `Daily: ${100-dailyRemaining}% quota used · Weekly: ${100-weeklyRemaining}% quota used`;
```

### 21.3 信用制 UI 显示

```javascript
// 信用耗尽判断
const allCreditsExhausted = remainingMessages === 0
                         && remainingFlowActions === 0
                         && remainingFlexCredits === 0;

if (teamsTier === TRIAL && allCreditsExhausted) {
  text = `${planName} - Upgrade Now`;  // 试用期耗尽
}

tooltip = `${remainingMessages/100} prompt credits left, ${remainingFlexCredits/100} add-on credits left`;
```

### 21.4 CheckUserMessageRateLimit 响应

```javascript
class CheckUserMessageRateLimitResponse {
  hasCapacity = false;       // 是否还有容量
  message = "";              // 限速消息 (显示给用户)
  messagesRemaining = 0;     // 剩余消息数
  maxMessages = 0;           // 最大消息数
  resetsInSeconds = 0n;      // 重置倒计时 (秒)
}
```

### 21.5 CheckChatCapacity 响应

```javascript
class CheckChatCapacityResponse {
  hasCapacity = false;       // 是否可开新会话
  message = "";              // 容量不足消息
  activeSessions = 0;        // 当前活跃会话数
}
```

---

## 22. AnnoyanceManager 完整实现

从 extension.js 逆向的完整 AnnoyanceManager 类:

### 22.1 三种限制状态

```javascript
enum AnnoyanceManagerRestriction {
  ALLOW_ALL = "allowAll",                         // 正常
  BLOCK_INLINE_RENDERS = "blockInlineRenders",    // 阻止内联渲染
  BLOCK_DUE_TO_INACTIVITY = "blockDueToInactivity" // 因不活跃阻止
}
```

### 22.2 默认阈值

| 参数 | 默认值 | Unleash 开关 |
|------|--------|-------------|
| `inlinePreventionThresholdMs` | 20000 (20s) | `ANNOYANCE_MANAGER_INLINE_PREVENTION_THRESHOLD_MS` |
| `inlinePreventionMaxIntentionalRejections` | 2 | `ANNOYANCE_MANAGER_INLINE_PREVENTION_MAX_INTENTIONAL_REJECTIONS` |
| `inlinePreventionMaxAutoRejections` | 4 | `ANNOYANCE_MANAGER_INLINE_PREVENTION_MAX_AUTO_REJECTIONS` |
| `inactivityThresholdMs` | 15000 (15s) | `ANNOYANCE_MANAGER_INACTIVITY_THRESHOLD_MS` |

### 22.3 检测逻辑

```javascript
checkRestriction() {
  // 1. 超过 15s 未编辑 → 因不活跃阻止
  if (Date.now() - lastEditTimestamp > inactivityThresholdMs)
    return BLOCK_DUE_TO_INACTIVITY;

  // 2. 20s 内有意拒绝 ≥ 2 次 → 阻止内联渲染
  const recentIntentional = getRecentRejections(intentionalTimestamps);
  // 3. 20s 内自动拒绝 ≥ 4 次 → 阻止内联渲染
  const recentAuto = getRecentRejections(autoTimestamps);
  
  if (recentIntentional.length >= maxIntentional ||
      recentAuto.length >= maxAuto)
    return BLOCK_INLINE_RENDERS;

  return ALLOW_ALL;
}

// 接受补全 → 重置所有拒绝记录
markAccept() {
  autoRejectionTimestamps = [];
  intentionalRejectionTimestamps = [];
}
```

### 22.4 工作原理总结

- **有意拒绝 (intentional)**: 用户主动按 Esc 或切换光标
- **自动拒绝 (auto)**: 补全弹出但用户继续打字导致自动消失
- **20s 滑动窗口内**超过阈值 → 暂时停止弹出补全
- **接受任何补全** → 立即重置拒绝计数
- **15s 无编辑** → 停止弹出补全 (用户可能不在编辑)
- 所有阈值通过 **Unleash feature flags** 远程可调
