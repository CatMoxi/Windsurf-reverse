# Windsurf API 完整接口文档

> 分析目标: Windsurf Next v2.2.1017 (commit a65d6c4e1f)
> 逆向提取: 6 个 gRPC Services, 188+ RPC Methods, 1736 Proto Messages, 22 Proto Packages

## 服务器地址

| 服务 | URL | 说明 |
|---|---|---|
| API Server | `https://server.codeium.com` | LanguageServer 主服务 |
| Register Server | `https://register.windsurf.com` | 注册/账户管理 |
| Inference Server | `https://inference.codeium.com` | AI 推理服务 |
| Website (Auth) | `https://windsurf.com` | OAuth 登录页面 |
| API Server (Auth1) | `https://server.self-serve.windsurf.com` | Auth1/Devin 账号 API |
| Feature Flags | `https://unleash.codeium.com/api/` | 实验/功能开关 |
| EU API | `https://eu.windsurf.com/_route/api_server` | 欧盟区 |
| FedStart API | `https://windsurf.fedstart.com/_route/api_server` | 政府合规区 |
| Staging API | `https://server-staging.codeium.com` | 测试环境 |
| Staging Web | `https://codeium-staging-exafunction.vercel.app` | 测试网站 |

## 协议规范

- **Connect-RPC** (gRPC-Web compatible)
- **Binary Format** (Protobuf wire format)
- **HTTP/1.1**
- **认证**: `X-Api-Key` header

```
POST /{package}.{Service}/{Method}
Content-Type: application/proto
Connect-Protocol-Version: 1
X-Api-Key: {api_key}

[protobuf binary body]
```

---

## Service 1: SeatManagementService (132 methods)

- **Package**: `exa.seat_management_pb`
- **Server**: `https://register.windsurf.com`
- **用途**: 用户注册、账户管理、团队、计费、SSO、角色

### 认证相关
| Method | 说明 |
|---|---|
| `RegisterUser` | OAuth token → api_key (核心登录) |
| `MigrateApiKey` | 迁移旧 API Key |
| `CreateFbUser` | 创建 Firebase 用户 |
| `GetOneTimeAuthToken` | 获取一次性认证 token |
| `CreatePKCEAuthorizationCode` | 创建 PKCE 授权码 |
| `ExchangePKCEAuthorizationCode` | 交换 PKCE 授权码 |
| `LogOutUser` | 登出 |
| `SendEmailVerification` | 发送邮箱验证 |
| `WindsurfPostAuth` | 登录后处理 |
| `GetSelfDevinSessionToken` | 获取 Devin session token |
| `ExchangeDevinCode` | 交换 Devin code |

### 用户信息
| Method | 说明 |
|---|---|
| `GetUserStatus` | 获取用户状态 |
| `GetUsers` | 获取用户列表 |
| `GetCurrentUser` | 获取当前用户信息 |
| `GetProfileData` | 获取个人资料 |
| `UpdateProfile` | 更新个人资料 |
| `UpdateName` | 更新名称 |
| `UpdateOccupation` | 更新职业 |
| `UpdateInboundSource` | 更新来源 |
| `GetProfilePicturePresignedUploadUrl` | 获取头像上传 URL |
| `ProfilePictureUploadComplete` | 头像上传完成 |
| `DeleteProfilePicture` | 删除头像 |
| `DeleteUser` | 删除用户 |
| `GetUserNotifications` | 获取用户通知 |
| `GetWrapped2024` | 获取年度总结 |
| `GetPrimaryApiKeyForDevsOnly` | 获取开发者 API Key |
| `GetApiKeySummary` | API Key 摘要 |
| `DeleteApiKey` | 删除 API Key |
| `GetSetUserApiProviderKeys` | 获取/设置用户 API Provider Keys |
| `SetUserApiProviderKey` | 设置用户 API Provider Key |
| `DeleteUserApiProviderKey` | 删除用户 API Provider Key |

### 角色和权限
| Method | 说明 |
|---|---|
| `GetRolesForUser` | 获取用户角色 |
| `AddUserRole` | 添加角色 |
| `RemoveUserRole` | 移除角色 |
| `CreateRole` | 创建角色 |
| `DeleteRole` | 删除角色 |
| `GetRoles` | 获取所有角色 |
| `UpdateUserRoles` | 更新用户角色 |
| `BulkUpdateUserRoles` | 批量更新角色 |
| `UpdateRole` | 更新角色 |
| `GrantSuperAdminAccess` | 授予超级管理员 |
| `GrantTeamAdminAccess` | 授予团队管理员 |

### 团队管理
| Method | 说明 |
|---|---|
| `GetTeamMetadata` | 获取团队元数据 |
| `GetTeamInfo` | 获取团队信息 |
| `GetTeamActivity` | 获取团队活动 |
| `RemoveUserFromTeam` | 从团队移除用户 |
| `RefreshTeamInviteId` | 刷新邀请链接 |
| `AddUsersToTeam` | 添加用户到团队 |
| `RequestTeamAccess` | 请求加入团队 |
| `UpdateUserTeamStatus` | 更新用户团队状态 |
| `CreateEnterprise` | 创建企业团队 |
| `UpdateTeamConfig` | 更新团队配置 |
| `UpdateTeamConfigExternal` | 更新外部团队配置 |
| `GetCliTeamSettings` | 获取 CLI 团队设置 |
| `CreateMultiTenantTeam` | 创建多租户团队 |
| `DeleteMultiTenantTeam` | 删除多租户团队 |
| `GetTeamOrgId` | 获取团队 Org ID |
| `DeleteTeam` | 删除团队 |
| `CreateTeamApiSecret` | 创建团队 API Secret |
| `UpdateTeamApiSecret` | 更新团队 API Secret |
| `GetAllTeamApiSecrets` | 获取所有团队 Secrets |
| `DeleteTeamApiSecret` | 删除团队 Secret |
| `UpdateTeamNameInternal` | 内部更新团队名 |

### 订阅和计费
| Method | 说明 |
|---|---|
| `SubscribeToPlan` | 订阅计划 |
| `UpdatePlan` | 更新计划 |
| `CancelPlan` | 取消计划 |
| `GetTeamBilling` | 获取计费信息 |
| `UpdateBilling` | 更新计费 |
| `GetCustomerPortal` | 获取客户门户 |
| `GetUserSubscription` | 获取用户订阅 |
| `UpdateSeats` | 更新席位 |
| `PurchaseCascadeCredits` | 购买 Cascade 积分 |
| `GetTeamCreditEntries` | 获取积分记录 |
| `GetTeamCreditBalance` | 获取积分余额 |
| `UpdateCreditTopUpSettings` | 更新充值设置 |
| `InitiateTopUp` | 发起充值 |
| `GetStripeSubscriptionState` | 获取 Stripe 订阅状态 |
| `GetPlanStatus` | 获取计划状态 |
| `CheckProTrialEligibility` | 检查 Pro 试用资格 |
| `AddTeamAddOnFeature` | 添加附加功能 |
| `GetLicense` | 获取许可证 |
| `SetTeamLicense` | 设置团队许可证 |

### SSO 和域名
| Method | 说明 |
|---|---|
| `SaveSSOProvider` | 保存 SSO Provider |
| `GetSSOProvider` | 获取 SSO Provider |
| `JoinTeamWithSSOLogin` | SSO 加入团队 |
| `CheckEmailForSSO` | 检查邮箱 SSO |
| `CheckUserLoginMethod` | 检查登录方式 |
| `UserSSOLoginRedirect` | SSO 登录重定向 |
| `ShowSSOAddOn` | 显示 SSO 附加 |
| `AddTeamDomain` | 添加团队域名 |
| `ListTeamDomains` | 列出团队域名 |
| `VerifyTeamDomain` | 验证域名 |
| `DeleteTeamDomain` | 删除域名 |
| `VerifySSOLoginInternal` | 内部验证 SSO |

### 预审批
| Method | 说明 |
|---|---|
| `GrantPreapproval` | 授予预审批 |
| `RevokePreapproval` | 撤销预审批 |
| `GetPreapprovals` | 获取预审批列表 |
| `GetPreapprovalMetadata` | 获取预审批元数据 |
| `AcceptPreapproval` | 接受预审批 |
| `RejectPreapproval` | 拒绝预审批 |
| `GetPreapprovalForUser` | 获取用户预审批 |
| `BulkEditUserApprovals` | 批量编辑审批 |

### GitHub/Netlify 集成
| Method | 说明 |
|---|---|
| `ConnectGithubAccount` | 连接 GitHub |
| `GetGitHubAccountStatus` | 获取 GitHub 状态 |
| `GetGitHubAccessToken` | 获取 GitHub Token |
| `ConnectNetlifyAccount` | 连接 Netlify |
| `DisconnectNetlifyAccount` | 断开 Netlify |
| `GetNetlifyAccountStatus` | 获取 Netlify 状态 |

### 功能配置
| Method | 说明 |
|---|---|
| `GetTeamsFeatures` | 获取团队功能 |
| `SetTeamsFeatures` | 设置团队功能 |
| `GetTeamsFeaturesInternal` | 内部获取功能 |
| `UpdateTeamsFeaturesInternal` | 内部更新功能 |
| `UsageConfig` | 用量配置 |
| `GetUsageConfig` | 获取用量配置 |
| `UpdateCliAccess` | 更新 CLI 访问 |
| `UpdateCodeiumAccess` | 更新 Codeium 访问 |
| `UpdateCodeSnippetTelemetry` | 更新代码遥测 |

### 自托管 ACU
| Method | 说明 |
|---|---|
| `GetSelfHostedAcuConfig` | 获取自托管配置 |
| `SetSelfHostedAcuConfig` | 设置自托管配置 |
| `DisableSelfHostedAcuBilling` | 禁用自托管计费 |
| `BatchGetSelfHostedAcuConfig` | 批量获取配置 |
| `GetSelfHostedAcuTeamCycleUsage` | 获取周期用量 |
| `GetSelfHostedAcuUserOverride` | 获取用户覆盖 |
| `SetSelfHostedAcuUserOverride` | 设置用户覆盖 |
| `DeleteSelfHostedAcuUserOverride` | 删除用户覆盖 |
| `BatchGetSelfHostedAcuUserOverrides` | 批量获取覆盖 |

### 引荐和内部
| Method | 说明 |
|---|---|
| `IsValidReferralCode` | 验证引荐码 |
| `ProcessReferralCode` | 处理引荐码 |
| `GetCascadeAnalytics` | 获取 Cascade 分析 |
| `GetMucsInfo` | 获取 MUCS 信息 |
| `InvalidateDevinCaches` | 失效 Devin 缓存 |
| `RemoveUsersFromTeamInternal` | 内部移除用户 |
| `BulkDeleteUsersInternal` | 内部批量删除 |
| `ExportUserDataInternal` | 导出用户数据 |
| `GetQuotaUsageInternal` | 获取配额用量 |
| `ResetQuotaUsageInternal` | 重置配额 |
| `GetOverageBalanceInternal` | 获取超额余额 |
| `AdjustOverageBalanceInternal` | 调整超额余额 |
| `UpdatePlanDetailsInternal` | 内部更新计划 |
| `InitiateAccountOwnershipVerificationInternal` | 账户所有权验证 |
| `VerifyAccountOwnershipInternal` | 验证账户所有权 |

---

## Service 2: LanguageServerService (90+ methods)

- **Package**: `exa.language_server_pb`
- **Server**: `https://server.codeium.com` (via language_server binary)
- **用途**: AI 补全、Cascade 对话、代码索引、编辑、MCP

### 认证和状态
| Method | 说明 |
|---|---|
| `RegisterUser` | 注册用户 (旧版) |
| `MigrateApiKey` | 迁移 API Key |
| `GetAuthToken` | 获取认证 token |
| `GetUserStatus` | 获取用户状态 |
| `GetUserSettings` | 获取用户设置 |
| `SetUserSettings` | 设置用户设置 |
| `GetStatus` | 获取服务状态 |
| `Heartbeat` | 心跳 |
| `Exit` | 退出 |

### AI 代码补全
| Method | 说明 |
|---|---|
| `GetCompletions` | **获取代码补全** (核心接口) |
| `HandleStreamingTab` | 流式 Tab 补全 |
| `HandleStreamingTabV2` | 流式 Tab 补全 v2 |
| `HandleStreamingCommand` | 流式命令补全 |
| `HandleStreamingTerminalCommand` | 流式终端命令 |
| `ProvideCompletionFeedback` | 补全反馈 |
| `OnEdit` | 编辑事件 |
| `GetCommandModelConfigs` | 获取命令模型配置 |
| `GetExternalModel` | 获取外部模型 |
| `GetModelStatuses` | 获取模型状态 |
| `GetCascadeModelConfigs` | 获取 Cascade 模型配置 |

### Cascade 对话 (AI Agent)
| Method | 说明 |
|---|---|
| `StartCascade` | **启动 Cascade 会话** |
| `SendUserCascadeMessage` | 发送用户消息 |
| `HandleCascadeUserInteraction` | 处理用户交互 |
| `CancelRequest` | 取消请求 |
| `InterruptWithQueuedMessage` | 中断排队消息 |
| `QueueCascadeMessage` | 排队 Cascade 消息 |
| `MoveQueuedMessage` | 移动排队消息 |
| `RemoveFromQueue` | 从队列移除 |
| `GetCascadeTrajectory` | 获取对话轨迹 |
| `GetCascadeTrajectorySteps` | 获取轨迹步骤 |
| `GetAllCascadeTrajectories` | 获取所有轨迹 |
| `GetCascadeTranscriptForTrajectoryId` | 获取对话记录 |
| `GetCascadeTrajectoryGeneratorMetadata` | 获取生成器元数据 |
| `RenameCascadeTrajectory` | 重命名轨迹 |
| `DeleteCascadeTrajectory` | 删除轨迹 |
| `LogCascadeSession` | 记录 Cascade 会话 |
| `InitializeCascadePanelState` | 初始化面板状态 |
| `UpdatePanelStateWithUserStatus` | 更新面板状态 |
| `RevertToCascadeStep` | 回退到某步 |
| `ResolveOutstandingSteps` | 解决未完成步骤 |
| `SpawnArenaModeMidConversation` | 中途开启竞技模式 |
| `UpdateCascadeMemory` | 更新 Cascade 记忆 |
| `GetCascadeMemories` | 获取 Cascade 记忆 |
| `GetUserMemories` | 获取用户记忆 |

### 代码索引和搜索
| Method | 说明 |
|---|---|
| `GetProcesses` | 获取进程 |
| `GetBrainStatus` | 获取索引状态 |
| `GetWorkspaceInfos` | 获取工作区信息 |
| `RemoveTrackedWorkspace` | 移除跟踪工作区 |
| `GetRepoInfos` | 获取仓库信息 |
| `GetMatchingCodeContext` | 搜索匹配代码上下文 |
| `GetMatchingContextScopeItems` | 搜索上下文范围项 |
| `GetMatchingIndexedRepos` | 搜索索引仓库 |
| `GetSuggestedContextScopeItems` | 获取建议上下文 |
| `RefreshContextForIdeAction` | 刷新 IDE 操作上下文 |
| `GetFunctions` | 获取函数列表 |
| `GetClassInfos` | 获取类信息 |

### 代码编辑和 Diff
| Method | 说明 |
|---|---|
| `GetPatchAndCodeChange` | 获取补丁和变更 |
| `GetWorkspaceEditState` | 获取工作区编辑状态 |
| `ResolveWorktreeChanges` | 解决工作树变更 |
| `UndoWorktreeMerge` | 撤销工作树合并 |
| `GenerateVibeAndReplaceStreaming` | Vibe & Replace 流式生成 |
| `GetRevertPreview` | 获取回退预览 |

### Code Map
| Method | 说明 |
|---|---|
| `GenerateCodeMap` | 生成代码地图 |
| `GetCodeMapsForFile` | 获取文件代码地图 |
| `GetCodeMapsForRepos` | 获取仓库代码地图 |
| `GetCodeMapSuggestions` | 获取代码地图建议 |
| `SaveCodeMapFromJson` | 从 JSON 保存代码地图 |
| `UpdateCodeMapMetadata` | 更新代码地图元数据 |
| `ShareCodeMap` | 分享代码地图 |
| `GetSharedCodeMap` | 获取共享代码地图 |

### MCP (Model Context Protocol)
| Method | 说明 |
|---|---|
| `GetMcpServerStates` | 获取 MCP 服务器状态 |
| `GetMcpPrompt` | 获取 MCP Prompt |
| `GetMcpRegistryServers` | 获取 MCP 注册表 |
| `SaveMcpServerToConfigFile` | 保存 MCP 到配置 |
| `UpdateMcpServerInConfigFile` | 更新 MCP 配置 |
| `RefreshMcpServers` | 刷新 MCP 服务器 |
| `ToggleMcpTool` | 切换 MCP 工具 |

### Cascade Plugins
| Method | 说明 |
|---|---|
| `GetAvailableCascadePlugins` | 获取可用插件 |
| `GetCascadePluginById` | 获取插件详情 |
| `InstallCascadePlugin` | 安装插件 |

### 实验和配置
| Method | 说明 |
|---|---|
| `ShouldEnableUnleash` | 是否启用功能开关 |
| `GetUnleashData` | 获取功能开关数据 |
| `SetBaseExperiments` | 设置基础实验 |
| `UpdateDevExperiments` | 更新开发实验 |
| `UpdateEnterpriseExperimentsFromUrl` | 从 URL 更新企业实验 |
| `EditConfiguration` | 编辑配置 |
| `RefreshCustomization` | 刷新自定义 |

### 遥测和分析
| Method | 说明 |
|---|---|
| `RecordEvent` | 记录事件 |
| `RecordSystemMetrics` | 记录系统指标 |
| `RecordChatFeedback` | 记录聊天反馈 |
| `RecordChatPanelSession` | 记录面板会话 |
| `RecordCommitMessageSave` | 记录 commit 保存 |
| `RecordLints` | 记录 Lint 结果 |
| `RecordSearchDocOpen` | 记录搜索文档打开 |
| `RecordSearchResultsView` | 记录搜索结果查看 |
| `RecordUserGrep` | 记录用户 grep |
| `RecordUserStepSnapshot` | 记录步骤快照 |
| `GetUserAnalyticsSummary` | 获取分析摘要 |

### 其他
| Method | 说明 |
|---|---|
| `GenerateCommitMessage` | 生成 commit 消息 |
| `GetTranscription` | 获取转录 (语音) |
| `GetWebDocsOptions` | 获取 Web 文档选项 |
| `SubmitBugReport` | 提交 Bug 报告 |
| `ImportFromCursor` | 从 Cursor 导入 |
| `WellSupportedLanguages` | 获取支持语言 |
| `ProgressBars` | 获取进度条 |
| `GetChangelog` | 获取更新日志 |
| `SkipOnboarding` | 跳过引导 |
| `ResetOnboarding` | 重置引导 |
| `GetLifeguardConfig` | 获取安全配置 |
| `GetTeamOrganizationalControls` | 获取团队组织控制 |
| `GetProfileData` | 获取个人资料 |
| `GetPrimaryApiKeyForDevsOnly` | 获取开发者 Key |
| `StatUri` | 获取 URI 状态 |
| `GetDefaultWebOrigins` | 获取默认 Web Origins |
| `GetSystemPromptAndTools` | 获取系统 Prompt 和工具 |
| `SetPinnedContext` | 设置固定上下文 |
| `SetPinnedGuideline` | 设置固定指南 |
| `GetAllRules` | 获取所有规则 |
| `GetAllSkills` | 获取所有技能 |
| `GetAllWorkflows` | 获取所有工作流 |
| `GetAllPlans` | 获取所有计划 |
| `GetConversationTags` | 获取对话标签 |
| `UpdateConversationTags` | 更新对话标签 |
| `GetUserTrajectory` | 获取用户轨迹 |
| `GetUserTrajectoryDescriptions` | 获取轨迹描述 |
| `GetUserTrajectoryDebug` | 获取轨迹调试 |
| `MountCascadeFilesystem` | 挂载文件系统 |
| `UnmountCascadeFilesystem` | 卸载文件系统 |
| `UploadRecentCommands` | 上传最近命令 |
| `GetCodeValidationStates` | 获取代码验证状态 |
| `ForceBackgroundResearchRefresh` | 强制刷新后台研究 |
| `SyncExploreAgentRun` | 同步探索 Agent |
| `UpdateAutoCascadeGithubCredentials` | 更新 AutoCascade GitHub 凭据 |
| `BranchCascadeAndGenerateCodeMap` | 分支并生成代码地图 |

### Windsurf JS App (部署)
| Method | 说明 |
|---|---|
| `ValidateWindsurfJSAppProjectName` | 验证项目名 |
| `SaveWindsurfJSAppProjectName` | 保存项目名 |
| `GetWindsurfJSAppDeployment` | 获取部署信息 |
| `GetActiveAppDeploymentForWorkspace` | 获取活跃部署 |

---

## Service 3: ExtensionServerService (49 methods)

- **Package**: `exa.extension_server_pb`
- **Server**: 本地 (语言服务器 → IDE 扩展 的回调)
- **用途**: IDE 操作回调，由 language_server 调用 IDE 扩展执行

| Method | 说明 |
|---|---|
| `LanguageServerStarted` | 语言服务器启动通知 |
| `OpenSetting` | 打开设置 |
| `OpenFilePointer` | 打开文件位置 |
| `InsertCodeAtCursor` | 在光标插入代码 |
| `LogEvent` | 记录事件 |
| `CheckTerminalShellSupport` | 检查终端支持 |
| `ExecuteCommand` | 执行命令 (streaming) |
| `ShowTerminal` | 显示终端 |
| `OpenVirtualFile` | 打开虚拟文件 |
| `SaveDocument` | 保存文档 |
| `ReadTerminal` | 读取终端 |
| `OpenTerminal` | 打开终端 |
| `GetLintErrors` | 获取 Lint 错误 |
| `WatchForLints` | 监视 Lint |
| `GetLintsForAcknowledger` | 获取确认 Lint |
| `OpenDiffZones` | 打开 Diff 区域 |
| `OpenExternalUrl` | 打开外部 URL |
| `OpenMultiDiff` | 打开多文件 Diff |
| `HandleAsyncPostMessage` | 异步消息处理 |
| `OpenWindsurfRulesFile` | 打开规则文件 |
| `DeleteWindsurfRulesFile` | 删除规则文件 |
| `DeleteWindsurfWorkflow` | 删除工作流 |
| `NotifyMcpStateChanged` | MCP 状态变更通知 |
| `OpenConfigurePluginsPage` | 打开插件配置 |
| `OpenConversationWorkspaceQuickPick` | 打开对话工作区选择 |
| `FindAllReferences` | 查找所有引用 |
| `GetLSPCompletionItems` | 获取 LSP 补全项 |
| `RefreshURIs` | 刷新 URI |
| `CheckExperiment` | 检查实验 |
| `WriteCascadeEdit` | 写入 Cascade 编辑 |
| `StartAudioRecording` | 开始录音 |
| `EndAudioRecording` | 结束录音 |
| `GetCurrentAudioRecording` | 获取当前录音 |
| `UpdateCascadeTrajectorySummaries` | 更新轨迹摘要 |
| `LoadCodeMap` | 加载代码地图 |
| `AddAnnotation` | 添加注解 |
| `RemoveAnnotation` | 移除注解 |
| `ShowAnnotation` | 显示注解 |
| `GetSecretValue` | 获取密钥值 |
| `StoreSecretValue` | 存储密钥值 |
| `GetRedirectUri` | 获取重定向 URI |
| `CancelVibeAndReplace` | 取消 Vibe & Replace |
| `SearchQuery` | 搜索查询 |
| `UnmountChanges` | 卸载变更 |
| `LogoutWindsurf` | 登出 |
| `GetNativeValues` | 获取原生值 |
| `SetNativeValue` | 设置原生值 |
| `ClearNativeValue` | 清除原生值 |
| `SubscribeNativeValues` | 订阅原生值变更 |

---

## Service 4: UserAnalyticsService (7 methods)

- **Package**: `exa.user_analytics_pb`
- **Server**: `https://server.codeium.com`
- **用途**: 用户分析和统计

| Method | 说明 |
|---|---|
| `Analytics` | 通用分析 |
| `UserPageAnalytics` | 用户页面分析 |
| `CascadeAnalytics` | Cascade 分析 |
| `GetAnalytics` | 获取分析数据 |
| `GetGlobalLeaderboardApiKey` | 获取排行榜 Key |
| `GetBigQueryAnalytics` | 获取 BigQuery 分析 |
| `GetDevinUserAnalytics` | 获取 Devin 用户分析 |

---

## Service 5: ProductAnalyticsService (2 methods)

- **Package**: `exa.product_analytics_pb`
- **Server**: `https://server.codeium.com`
- **用途**: 产品事件记录

| Method | 说明 |
|---|---|
| `RecordAnalyticsEvent` | 记录分析事件 |
| `BatchRecordAnalyticsEvents` | 批量记录事件 |

---

## Service 6: DevService (2 methods)

- **Package**: `exa.dev_pb`
- **Server**: `https://server.codeium.com`
- **用途**: 开发调试

| Method | 说明 |
|---|---|
| `Dev` | 开发调试调用 |
| `GetLSPCompletionItems` | 获取 LSP 补全 |

---

## Proto Packages 完整列表 (22 packages)

| Package | 说明 |
|---|---|
| `exa.auto_cascade_common_pb` | AutoCascade 公共定义 |
| `exa.bug_checker_pb` | Bug 检查器 |
| `exa.cascade_plugins_pb` | Cascade 插件 |
| `exa.chat_pb` | 聊天消息 |
| `exa.code_edit.code_edit_pb` | 代码编辑 |
| `exa.codeium_common_pb` | Codeium 公共 (Metadata等) |
| `exa.context_module_pb` | 上下文模块 |
| `exa.cortex_pb` | Cortex (Agent 步骤) |
| `exa.dev_pb` | 开发调试 |
| `exa.diff_action_pb` | Diff 操作 |
| `exa.extension_server_pb` | 扩展服务器 |
| `exa.index_pb` | 代码索引 |
| `exa.knowledge_base_pb` | 知识库 |
| `exa.language_server_pb` | 语言服务器 |
| `exa.opensearch_clients_pb` | OpenSearch 客户端 |
| `exa.product_analytics_pb` | 产品分析 |
| `exa.reactive_component_pb` | 响应式组件 |
| `exa.seat_management_pb` | 席位管理 |
| `exa.user_analytics_pb` | 用户分析 |

## 关键 Proto 消息定义

### Metadata (通用请求头)
```protobuf
message Metadata {
  string ide_name = 1;
  string extension_version = 2;
  string api_key = 3;
  string locale = 4;
  string os = 5;
  bool disable_telemetry = 6;
  string ide_version = 7;
  string hardware = 8;
  uint64 request_id = 9;
  string session_id = 10;
  string source_address = 11;
  string extension_name = 12;
  Timestamp ls_timestamp = 16;
  string ide_type = 28;
}
```

### RegisterUserRequest / Response
```protobuf
message RegisterUserRequest {
  string firebase_id_token = 1;
}

message RegisterUserResponse {
  string api_key = 1;
  string name = 2;
  string api_server_url = 3;
  string redirect_url = 4;
  repeated TeamOption team_options = 5;
}
```

### GetAuthTokenResponse
```protobuf
message GetAuthTokenResponse {
  string auth_token = 1;
  string uuid = 2;
}
```

### GitRepoInfo (AutoCascade)
```protobuf
message GitRepoInfo {
  string repo_name = 1;
  string branch = 2;
  string commit = 3;
  string pr_url = 4;
}
```

### SessionInfo (AutoCascade)
```protobuf
message SessionInfo {
  string session_id = 1;
  string explanation = 2;
  string ssh_url = 3;
  CascadeRunStatus status = 4;
  string summary = 5;
  CortexTrajectory trajectory = 6;
  string session_key = 7;
  Timestamp created_at = 8;
  repeated GitRepoInfo git_repos = 9;
  Timestamp updated_at = 10;
}
```

## 已验证的远程可调用端点 (22+)

> 以下端点已通过实际 API 调用验证可工作。
> Server: `server.self-serve.windsurf.com` (Auth1 账号) 或 `server.codeium.com` (标准账号)

### 核心 AI 功能
| 端点 | 类型 | 请求 | 返回 | 说明 |
|------|------|------|------|------|
| `GetChatMessage` | stream | metadata, chatMessagePrompts[], chatModelUid, requestType=5, cascadeId, promptId | delta_text, delta_tool_calls, stop_reason | 流式聊天+工具+图片+thinking |
| `GetDevstralStream` | stream | metadata, prompt | delta_text | Devstral 轻量聊天 |
| `GetEmbeddings` | unary | metadata, texts[], model | embeddings[] | 向量嵌入 (Ada/3-Small/3-Large) |
| `GetTranscription` | unary | metadata, audioData (WAV) | text | 语音转文字 |
| `GetWebSearchResults` | unary | metadata, query | results[{url,title,summary}], webSearchUrl | Web搜索 (You.com API) |

### 配置/管理
| 端点 | 类型 | 请求 | 返回 | 说明 |
|------|------|------|------|------|
| `GetCascadeModelConfigs` | unary | metadata | clientModelConfigs[] (115个) | Cascade 模型列表 |
| `GetCliModelConfigs` | unary | metadata | clientModelConfigs[] (66个) | CLI 模型详情含 credits/tokens |
| `GetCommandModelConfigs` | unary | metadata | clientModelConfigs[] (8个) | 命令模型 |
| `GetModelProviders` | unary | (空) | modelProviders[] (8个) | AI 提供商列表 (无需认证) |
| `GetModelStatuses` | unary | metadata | modelStatusInfos[] | 模型状态 |
| `GetUserStatus` | unary | metadata | name, email, planInfo, teamConfig | 账号+额度信息 |
| `CheckUserMessageRateLimit` | unary | metadata, requestType | allowed, resetTime | 限速检查 |
| `CheckChatCapacity` | unary | metadata | hasCapacity | 容量检查 |
| `GetTeamOrganizationalControls` | unary | metadata | controls | 团队策略 |

### 功能/工具
| 端点 | 类型 | 请求 | 返回 | 说明 |
|------|------|------|------|------|
| `GetWebDocsOptions` | unary | metadata | options[] (149个) | @docs 文档库 (llms.txt) |
| `GetLifeguardConfig` | unary | metadata | modes{agent{enabled,model}} | AI 安全配置 |
| `GenerateSyntheticRule` | unary | metadata, commentBody, fileContent, lineNumber | rule{prompt} | AI 生成代码规则 |
| `GetWindsurfJSAvailableDeployTargets` | unary | metadata | deployTargets[] | 部署目标 (Netlify) |
| `GetAvailableCascadePlugins` | unary | metadata | plugins[] | MCP 插件列表 |
| `GetDefaultWorkflowTemplates` | unary | metadata | templates[] | 工作流模板 |
| `SupportsRemoteIndexing` | unary | metadata | supportsRemoteIndexing:bool | 远程索引支持 |
| `Ping` | unary | workDurationMs | latencyMs | 健康检查 |

### 不可远程调用的端点
| 端点 | 状态 | 原因 |
|------|------|------|
| `GetCompletions` | invalid_argument | 需要 LS 构建 FIM prompt |
| `GetTab` | invalid_argument | 需要 LS 构建 prompt |
| `GetChatCompletions` | invalid_argument | 缺少必要字段 |
| `GetStreamingModelAPITextCompletion` | permission_denied | 权限限制 |
| `GetDeepWiki` | 200 空 | 需要代码库索引 |
| `GetSystemPromptAndTools` | 404 | 仅 LS 本地 (Go 构建) |
| `GenerateVibeAndReplaceStreaming` | 404 | 仅 LS 本地 |
| `ReadUrlContent` | 404 | 仅 LS 本地 |
| `HandleStreamingCommand/Tab` | 404 | 仅 LS 本地 |
| `FetchTrajectoryShare` | 401 | 需要特殊 auth token |
| `ListUserSharedCodeMaps` | 401 | 需要特殊 auth token |
| `GetExternalModel` | 501 | 未实现 |
| `GetTeamOidcProviders` | 501 | 未实现 |
| `AssignArenaModel` | 400 | 需正规 Arena 流程 |
| `GetMcpRegistryServers` | 404 | 不存在 |

## API 调用示例

### 启动 Cascade 会话
```
POST https://server.codeium.com/exa.language_server_pb.LanguageServerService/StartCascade
Content-Type: application/proto
Connect-Protocol-Version: 1
X-Api-Key: {api_key}

[StartCascadeRequest protobuf binary]
```

### 获取代码补全
```
POST https://server.codeium.com/exa.language_server_pb.LanguageServerService/GetCompletions
Content-Type: application/proto
Connect-Protocol-Version: 1
X-Api-Key: {api_key}

[GetCompletionsRequest protobuf binary with Metadata]
```

### 注册用户 (登录)
```
POST https://register.windsurf.com/exa.seat_management_pb.SeatManagementService/RegisterUser
Content-Type: application/proto
Connect-Protocol-Version: 1

[RegisterUserRequest protobuf binary: field 1 = access_token]
```
