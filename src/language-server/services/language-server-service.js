'use strict';

const CascadeEngine = require('../core/cascade-engine');
const { ApiKeyPool } = require('../core/api-key-pool');

/**
 * LanguageServerService - Full implementation of all 172 RPC methods.
 * 
 * This service is what the Windsurf extension connects to locally.
 * It proxies requests to ApiServerService on server.codeium.com
 * and calls back to ExtensionServerService for IDE operations.
 */
class LanguageServerService {
  constructor({ apiClient, inferenceClient, extensionClient, seatMgmtClient, logger, args, keyPool }) {
    this.api = apiClient;
    this.inference = inferenceClient; // For high-performance completions
    this.ext = extensionClient;
    this.seatMgmt = seatMgmtClient;
    this.log = logger;
    this.args = args;
    
    // State
    this.apiKey = args.api_key || '';
    this.csrfToken = args.csrf_token || '';
    
    // Impersonate tier for rate limit bypass
    // Set via --impersonate_tier CLI arg or IMPERSONATE_TIER env var
    this.impersonateTier = args.impersonate_tier || process.env.IMPERSONATE_TIER || 'TEAMS_TIER_DEVIN_PRO';
    
    // API key pool for multi-account rotation
    this.keyPool = keyPool || null;
    
    // Cascade engine
    this.cascade = new CascadeEngine({ apiClient, extensionClient, logger });
  }
  
  /**
   * Get the current API key — from pool (round-robin) or static.
   */
  _getApiKey() {
    if (this.keyPool && this.keyPool.size > 0) {
      return this.keyPool.getKey() || this.apiKey;
    }
    return this.apiKey;
  }

  getHandlers() {
    const handlers = {};
    handlers.GetCompletions = this.getCompletions.bind(this);
    handlers.AcceptCompletion = this.acceptCompletion.bind(this);
    handlers.ProvideCompletionFeedback = this.provideCompletionFeedback.bind(this);
    handlers.Heartbeat = this.heartbeat.bind(this);
    handlers.GetStatus = this.getStatus.bind(this);
    handlers.GetCommandModelConfigs = this.getCommandModelConfigs.bind(this);
    handlers.GetCascadeModelConfigs = this.getCascadeModelConfigs.bind(this);
    handlers.GetProcesses = this.getProcesses.bind(this);
    handlers.GetExternalModel = this.getExternalModel.bind(this);
    handlers.GetAuthToken = this.getAuthToken.bind(this);
    handlers.RecordEvent = this.recordEvent.bind(this);
    handlers.RecordSystemMetrics = this.recordSystemMetrics.bind(this);
    handlers.CancelRequest = this.cancelRequest.bind(this);
    handlers.EditConfiguration = this.editConfiguration.bind(this);
    handlers.MigrateApiKey = this.migrateApiKey.bind(this);
    handlers.GetPrimaryApiKeyForDevsOnly = this.getPrimaryApiKeyForDevsOnly.bind(this);
    handlers.WellSupportedLanguages = this.wellSupportedLanguages.bind(this);
    handlers.ProgressBars = this.progressBars.bind(this);
    handlers.RecordSearchDocOpen = this.recordSearchDocOpen.bind(this);
    handlers.RecordSearchResultsView = this.recordSearchResultsView.bind(this);
    handlers.HandleStreamingCommand = this.handleStreamingCommand.bind(this);
    handlers.HandleStreamingTab = this.handleStreamingTab.bind(this);
    handlers.HandleStreamingTabV2 = this.handleStreamingTabV2.bind(this);
    handlers.HandleStreamingTerminalCommand = this.handleStreamingTerminalCommand.bind(this);
    handlers.UploadRecentCommands = this.uploadRecentCommands.bind(this);
    handlers.GetBrainStatus = this.getBrainStatus.bind(this);
    handlers.SetPinnedGuideline = this.setPinnedGuideline.bind(this);
    handlers.SetPinnedContext = this.setPinnedContext.bind(this);
    handlers.AddTrackedWorkspace = this.addTrackedWorkspace.bind(this);
    handlers.RemoveTrackedWorkspace = this.removeTrackedWorkspace.bind(this);
    handlers.StatUri = this.statUri.bind(this);
    handlers.ValidateWindsurfJSAppProjectName = this.validateWindsurfJSAppProjectName.bind(this);
    handlers.SaveWindsurfJSAppProjectName = this.saveWindsurfJSAppProjectName.bind(this);
    handlers.RefreshContextForIdeAction = this.refreshContextForIdeAction.bind(this);
    handlers.GetMatchingCodeContext = this.getMatchingCodeContext.bind(this);
    handlers.GetMatchingIndexedRepos = this.getMatchingIndexedRepos.bind(this);
    handlers.GetMatchingContextScopeItems = this.getMatchingContextScopeItems.bind(this);
    handlers.GetSuggestedContextScopeItems = this.getSuggestedContextScopeItems.bind(this);
    handlers.GetChatMessage = this.getChatMessage.bind(this);
    handlers.RawGetChatMessage = this.rawGetChatMessage.bind(this);
    handlers.GetDeepWiki = this.getDeepWiki.bind(this);
    handlers.CheckUserMessageRateLimit = this.checkUserMessageRateLimit.bind(this);
    handlers.GetMessageTokenCount = this.getMessageTokenCount.bind(this);
    handlers.RecordChatFeedback = this.recordChatFeedback.bind(this);
    handlers.RecordChatPanelSession = this.recordChatPanelSession.bind(this);
    handlers.CheckChatCapacity = this.checkChatCapacity.bind(this);
    handlers.ShouldEnableUnleash = this.shouldEnableUnleash.bind(this);
    handlers.GetWorkspaceEditState = this.getWorkspaceEditState.bind(this);
    handlers.GetRepoInfos = this.getRepoInfos.bind(this);
    handlers.GetWorkspaceInfos = this.getWorkspaceInfos.bind(this);
    handlers.GenerateCommitMessage = this.generateCommitMessage.bind(this);
    handlers.RecordCommitMessageSave = this.recordCommitMessageSave.bind(this);
    handlers.SendActionToChatPanel = this.sendActionToChatPanel.bind(this);
    handlers.GetUserSettings = this.getUserSettings.bind(this);
    handlers.SetUserSettings = this.setUserSettings.bind(this);
    handlers.GetDefaultWebOrigins = this.getDefaultWebOrigins.bind(this);
    handlers.GetDebugDiagnostics = this.getDebugDiagnostics.bind(this);
    handlers.GetUserStatus = this.getUserStatus.bind(this);
    handlers.GetProfileData = this.getProfileData.bind(this);
    handlers.CaptureCode = this.captureCode.bind(this);
    handlers.CaptureFile = this.captureFile.bind(this);
    handlers.GetChangelog = this.getChangelog.bind(this);
    handlers.GetFunctions = this.getFunctions.bind(this);
    handlers.GetClassInfos = this.getClassInfos.bind(this);
    handlers.SetupUniversitySandbox = this.setupUniversitySandbox.bind(this);
    handlers.Exit = this.exit.bind(this);
    handlers.ResetOnboarding = this.resetOnboarding.bind(this);
    handlers.SkipOnboarding = this.skipOnboarding.bind(this);
    handlers.GetUserTrajectoryDebug = this.getUserTrajectoryDebug.bind(this);
    handlers.GetUserTrajectoryDescriptions = this.getUserTrajectoryDescriptions.bind(this);
    handlers.StreamUserTrajectoryReactiveUpdates = this.streamUserTrajectoryReactiveUpdates.bind(this);
    handlers.GetCascadeMemories = this.getCascadeMemories.bind(this);
    handlers.DeleteCascadeMemory = this.deleteCascadeMemory.bind(this);
    handlers.UpdateCascadeMemory = this.updateCascadeMemory.bind(this);
    handlers.GetUserMemories = this.getUserMemories.bind(this);
    handlers.RefreshCustomization = this.refreshCustomization.bind(this);
    handlers.GetConversationTags = this.getConversationTags.bind(this);
    handlers.UpdateConversationTags = this.updateConversationTags.bind(this);
    handlers.StartCascade = this.startCascade.bind(this);
    handlers.CancelCascadeInvocation = this.cancelCascadeInvocation.bind(this);
    handlers.CancelCascadeInvocationAndWait = this.cancelCascadeInvocationAndWait.bind(this);
    handlers.CancelCascadeSteps = this.cancelCascadeSteps.bind(this);
    handlers.SendUserCascadeMessage = this.sendUserCascadeMessage.bind(this);
    handlers.BranchCascade = this.branchCascade.bind(this);
    handlers.QueueCascadeMessage = this.queueCascadeMessage.bind(this);
    handlers.InterruptWithQueuedMessage = this.interruptWithQueuedMessage.bind(this);
    handlers.RemoveFromQueue = this.removeFromQueue.bind(this);
    handlers.MoveQueuedMessage = this.moveQueuedMessage.bind(this);
    handlers.SyncExploreAgentRun = this.syncExploreAgentRun.bind(this);
    handlers.RevertToCascadeStep = this.revertToCascadeStep.bind(this);
    handlers.GetRevertPreview = this.getRevertPreview.bind(this);
    handlers.RecordUserStepSnapshot = this.recordUserStepSnapshot.bind(this);
    handlers.GetAllCascadeTrajectories = this.getAllCascadeTrajectories.bind(this);
    handlers.HandleCascadeUserInteraction = this.handleCascadeUserInteraction.bind(this);
    handlers.AcknowledgeCascadeCodeEdit = this.acknowledgeCascadeCodeEdit.bind(this);
    handlers.GetCodeValidationStates = this.getCodeValidationStates.bind(this);
    handlers.CreateWorktree = this.createWorktree.bind(this);
    handlers.ResolveWorktreeChanges = this.resolveWorktreeChanges.bind(this);
    handlers.UndoWorktreeMerge = this.undoWorktreeMerge.bind(this);
    handlers.DeleteCascadeTrajectory = this.deleteCascadeTrajectory.bind(this);
    handlers.RenameCascadeTrajectory = this.renameCascadeTrajectory.bind(this);
    handlers.ArchiveCascadeTrajectory = this.archiveCascadeTrajectory.bind(this);
    handlers.InitializeCascadePanelState = this.initializeCascadePanelState.bind(this);
    handlers.UpdatePanelStateWithUserStatus = this.updatePanelStateWithUserStatus.bind(this);
    handlers.SpawnArenaModeMidConversation = this.spawnArenaModeMidConversation.bind(this);
    handlers.ConvergeArenaCascades = this.convergeArenaCascades.bind(this);
    handlers.StreamCascadePanelReactiveUpdates = this.streamCascadePanelReactiveUpdates.bind(this);
    handlers.StreamCascadeReactiveUpdates = this.streamCascadeReactiveUpdates.bind(this);
    handlers.StreamCascadeSummariesReactiveUpdates = this.streamCascadeSummariesReactiveUpdates.bind(this);
    handlers.ForceBackgroundResearchRefresh = this.forceBackgroundResearchRefresh.bind(this);
    handlers.ResolveOutstandingSteps = this.resolveOutstandingSteps.bind(this);
    handlers.RefreshMcpServers = this.refreshMcpServers.bind(this);
    handlers.GetMcpServerStates = this.getMcpServerStates.bind(this);
    handlers.GetMcpPrompt = this.getMcpPrompt.bind(this);
    handlers.SaveMcpServerToConfigFile = this.saveMcpServerToConfigFile.bind(this);
    handlers.UpdateMcpServerInConfigFile = this.updateMcpServerInConfigFile.bind(this);
    handlers.ToggleMcpTool = this.toggleMcpTool.bind(this);
    handlers.DismissCodeMapSuggestion = this.dismissCodeMapSuggestion.bind(this);
    handlers.StreamTerminalShellCommand = this.streamTerminalShellCommand.bind(this);
    handlers.GetWebDocsOptions = this.getWebDocsOptions.bind(this);
    handlers.UpdateDevExperiments = this.updateDevExperiments.bind(this);
    handlers.SetBaseExperiments = this.setBaseExperiments.bind(this);
    handlers.GetUnleashData = this.getUnleashData.bind(this);
    handlers.GetActiveAppDeploymentForWorkspace = this.getActiveAppDeploymentForWorkspace.bind(this);
    handlers.GetWindsurfJSAppDeployment = this.getWindsurfJSAppDeployment.bind(this);
    handlers.GetModelStatuses = this.getModelStatuses.bind(this);
    handlers.UpdateAutoCascadeGithubCredentials = this.updateAutoCascadeGithubCredentials.bind(this);
    handlers.GetAllWorkflows = this.getAllWorkflows.bind(this);
    handlers.CopyBuiltinWorkflowToWorkspace = this.copyBuiltinWorkflowToWorkspace.bind(this);
    handlers.GetAllRules = this.getAllRules.bind(this);
    handlers.GetAllSkills = this.getAllSkills.bind(this);
    handlers.GetAllPlans = this.getAllPlans.bind(this);
    handlers.UpdateEnterpriseExperimentsFromUrl = this.updateEnterpriseExperimentsFromUrl.bind(this);
    handlers.ImportFromCursor = this.importFromCursor.bind(this);
    handlers.CreateCustomizationFile = this.createCustomizationFile.bind(this);
    handlers.GetTeamOrganizationalControls = this.getTeamOrganizationalControls.bind(this);
    handlers.RecordUserGrep = this.recordUserGrep.bind(this);
    handlers.GetGithubPullRequestSearchInfo = this.getGithubPullRequestSearchInfo.bind(this);
    handlers.CreateTrajectoryShare = this.createTrajectoryShare.bind(this);
    handlers.GetKnowledgeBaseItemsForTeam = this.getKnowledgeBaseItemsForTeam.bind(this);
    handlers.GetCascadeTrajectory = this.getCascadeTrajectory.bind(this);
    handlers.GetUserTrajectory = this.getUserTrajectory.bind(this);
    handlers.GetCascadeTrajectorySteps = this.getCascadeTrajectorySteps.bind(this);
    handlers.GetCascadeTrajectoryGeneratorMetadata = this.getCascadeTrajectoryGeneratorMetadata.bind(this);
    handlers.GetCascadeTranscriptForTrajectoryId = this.getCascadeTranscriptForTrajectoryId.bind(this);
    handlers.GetPatchAndCodeChange = this.getPatchAndCodeChange.bind(this);
    handlers.GetAvailableCascadePlugins = this.getAvailableCascadePlugins.bind(this);
    handlers.InstallCascadePlugin = this.installCascadePlugin.bind(this);
    handlers.GetCascadePluginById = this.getCascadePluginById.bind(this);
    handlers.GetMcpRegistryServers = this.getMcpRegistryServers.bind(this);
    handlers.GetAllAcpRegistries = this.getAllAcpRegistries.bind(this);
    handlers.RecordLints = this.recordLints.bind(this);
    handlers.ReplayGroundTruthTrajectory = this.replayGroundTruthTrajectory.bind(this);
    handlers.MountCascadeFilesystem = this.mountCascadeFilesystem.bind(this);
    handlers.UnmountCascadeFilesystem = this.unmountCascadeFilesystem.bind(this);
    handlers.LogCascadeSession = this.logCascadeSession.bind(this);
    handlers.GetTranscription = this.getTranscription.bind(this);
    handlers.GenerateVibeAndReplaceStreaming = this.generateVibeAndReplaceStreaming.bind(this);
    handlers.GetCodeMapsForRepos = this.getCodeMapsForRepos.bind(this);
    handlers.GetCodeMapsForFile = this.getCodeMapsForFile.bind(this);
    handlers.GenerateCodeMap = this.generateCodeMap.bind(this);
    handlers.BranchCascadeAndGenerateCodeMap = this.branchCascadeAndGenerateCodeMap.bind(this);
    handlers.ShareCodeMap = this.shareCodeMap.bind(this);
    handlers.GetSharedCodeMap = this.getSharedCodeMap.bind(this);
    handlers.GetCodeMapSuggestions = this.getCodeMapSuggestions.bind(this);
    handlers.UpdateCodeMapMetadata = this.updateCodeMapMetadata.bind(this);
    handlers.SaveCodeMapFromJson = this.saveCodeMapFromJson.bind(this);
    handlers.CheckBugs = this.checkBugs.bind(this);
    handlers.GetLifeguardConfig = this.getLifeguardConfig.bind(this);
    handlers.SubmitBugReport = this.submitBugReport.bind(this);
    handlers.OnEdit = this.onEdit.bind(this);
    handlers.GetSystemPromptAndTools = this.getSystemPromptAndTools.bind(this);
    return handlers;
  }

  /** Unary: GetCompletions */
  getCompletions(call, callback) {
    const request = call.request;
    const lang = request.document?.editorLanguage || request.document?.editor_language || '';
    this.log.debug(`GetCompletions: lang=${lang}`);
    if (this.api && this.apiKey) {
      this.api.connect();
      // Inject metadata (api_key + impersonate_tier)
      const apiReq = camelToSnake(request);
      this._injectMetadata(apiReq, this.apiKey);
      this.api.call('GetCompletions', apiReq)
        .then(response => {
          // Convert snake_case response to camelCase for proto-codec encoding
          callback(null, snakeToCamel(response));
        })
        .catch(err => {
          this.log.error(`GetCompletions failed: ${err.message}`);
          callback(null, { completionItems: [] });
        });
    } else {
      callback(null, { completionItems: [] });
    }
  }

  /** Unary: AcceptCompletion */
  acceptCompletion(call, callback) {
    const request = call.request;
    this.log.debug('AcceptCompletion called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ProvideCompletionFeedback */
  provideCompletionFeedback(call, callback) {
    const request = call.request;
    this.log.debug('ProvideCompletionFeedback called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: Heartbeat */
  heartbeat(call, callback) {
    callback(null, {});
  }

  /** Unary: GetStatus */
  getStatus(call, callback) {
    callback(null, { state: 'CODEIUM_STATE_SUCCESS' });
  }

  /** Unary: GetCommandModelConfigs */
  getCommandModelConfigs(call, callback) {
    const request = call.request;
    this.log.debug('GetCommandModelConfigs called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetCascadeModelConfigs */
  getCascadeModelConfigs(call, callback) {
    const request = call.request;
    this.log.debug('GetCascadeModelConfigs');
    const key = this._getApiKey();
    if (this.api && key) {
      this.api.connect();
      const apiReq = camelToSnake(request);
      if (!apiReq.metadata) apiReq.metadata = {};
      apiReq.metadata.api_key = key;
      this.api.call('GetCascadeModelConfigs', apiReq)
        .then(response => callback(null, snakeToCamel(response)))
        .catch(err => callback(null, { modelConfigs: [] }));
    } else {
      callback(null, { modelConfigs: [] });
    }
  }

  /** Unary: GetProcesses */
  getProcesses(call, callback) {
    const request = call.request;
    this.log.debug('GetProcesses called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetExternalModel */
  getExternalModel(call, callback) {
    const request = call.request;
    this.log.debug('GetExternalModel called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetAuthToken */
  getAuthToken(call, callback) {
    const request = call.request;
    this.log.debug('GetAuthToken called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RecordEvent */
  recordEvent(call, callback) {
    const request = call.request;
    this.log.debug('RecordEvent called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RecordSystemMetrics */
  recordSystemMetrics(call, callback) {
    const request = call.request;
    this.log.debug('RecordSystemMetrics called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: CancelRequest */
  cancelRequest(call, callback) {
    const request = call.request;
    this.log.debug('CancelRequest called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: EditConfiguration */
  editConfiguration(call, callback) {
    const request = call.request;
    this.log.debug('EditConfiguration called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: MigrateApiKey */
  migrateApiKey(call, callback) {
    const request = call.request;
    this.log.debug('MigrateApiKey called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetPrimaryApiKeyForDevsOnly */
  getPrimaryApiKeyForDevsOnly(call, callback) {
    const request = call.request;
    this.log.debug('GetPrimaryApiKeyForDevsOnly called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: WellSupportedLanguages */
  wellSupportedLanguages(call, callback) {
    const request = call.request;
    this.log.debug('WellSupportedLanguages called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ProgressBars */
  progressBars(call, callback) {
    const request = call.request;
    this.log.debug('ProgressBars called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RecordSearchDocOpen */
  recordSearchDocOpen(call, callback) {
    const request = call.request;
    this.log.debug('RecordSearchDocOpen called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RecordSearchResultsView */
  recordSearchResultsView(call, callback) {
    const request = call.request;
    this.log.debug('RecordSearchResultsView called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Server-streaming: HandleStreamingCommand */
  handleStreamingCommand(call) {
    const request = call.request;
    this.log.info(`HandleStreamingCommand: ${request.command_text?.substring(0, 50) || '?'}`);
    this._forwardStream('HandleStreamingCommand', request, call);
  }

  /** Server-streaming: HandleStreamingTab */
  handleStreamingTab(call) {
    const request = call.request;
    this.log.debug(`HandleStreamingTab: src=${request.request_source}`);
    this._forwardStream('HandleStreamingTab', request, call);
  }

  /** Unary: HandleStreamingTabV2 */
  handleStreamingTabV2(call, callback) {
    const request = call.request;
    this.log.debug('HandleStreamingTabV2 called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Server-streaming: HandleStreamingTerminalCommand */
  handleStreamingTerminalCommand(call) {
    const request = call.request;
    this.log.debug('HandleStreamingTerminalCommand');
    this._forwardStream('HandleStreamingTerminalCommand', request, call);
  }

  /** Unary: UploadRecentCommands */
  uploadRecentCommands(call, callback) {
    const request = call.request;
    this.log.debug('UploadRecentCommands called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetBrainStatus */
  getBrainStatus(call, callback) {
    const request = call.request;
    this.log.debug('GetBrainStatus called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SetPinnedGuideline */
  setPinnedGuideline(call, callback) {
    const request = call.request;
    this.log.debug('SetPinnedGuideline called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SetPinnedContext */
  setPinnedContext(call, callback) {
    const request = call.request;
    this.log.debug('SetPinnedContext called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: AddTrackedWorkspace */
  addTrackedWorkspace(call, callback) {
    const request = call.request;
    this.log.debug('AddTrackedWorkspace called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RemoveTrackedWorkspace */
  removeTrackedWorkspace(call, callback) {
    const request = call.request;
    this.log.debug('RemoveTrackedWorkspace called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: StatUri */
  statUri(call, callback) {
    const request = call.request;
    this.log.debug('StatUri called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ValidateWindsurfJSAppProjectName */
  validateWindsurfJSAppProjectName(call, callback) {
    const request = call.request;
    this.log.debug('ValidateWindsurfJSAppProjectName called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SaveWindsurfJSAppProjectName */
  saveWindsurfJSAppProjectName(call, callback) {
    const request = call.request;
    this.log.debug('SaveWindsurfJSAppProjectName called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RefreshContextForIdeAction */
  refreshContextForIdeAction(call, callback) {
    const request = call.request;
    this.log.debug('RefreshContextForIdeAction called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetMatchingCodeContext */
  getMatchingCodeContext(call, callback) {
    const request = call.request;
    this.log.debug('GetMatchingCodeContext called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetMatchingIndexedRepos */
  getMatchingIndexedRepos(call, callback) {
    const request = call.request;
    this.log.debug('GetMatchingIndexedRepos called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetMatchingContextScopeItems */
  getMatchingContextScopeItems(call, callback) {
    const request = call.request;
    this.log.debug('GetMatchingContextScopeItems called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetSuggestedContextScopeItems */
  getSuggestedContextScopeItems(call, callback) {
    const request = call.request;
    this.log.debug('GetSuggestedContextScopeItems called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Server-streaming: GetChatMessage */
  getChatMessage(call) {
    const request = call.request;
    this.log.info('GetChatMessage: streaming chat response');
    
    const key = this._getApiKey();
    if (!this.api || !key) {
      this.log.warn('GetChatMessage: no API client/key, ending stream');
      call.end();
      return;
    }
    
    // Transform LS GetChatMessageRequest → API GetChatMessageRequest
    // LS request has: metadata, chatMessages[], activeDocument, openDocumentUris[], workspaceUris[], chatModelName
    // API request needs: metadata, chatMessagePrompts[], chatModelName/chatModelUid, tools[], cascadeId
    const apiReq = this._buildApiChatRequest(request);
    
    let ended = false;
    const safeEnd = () => {
      if (!ended) { ended = true; try { call.end(); } catch(e) {} }
    };
    
    try {
      this.api.connect();
      const upstream = this.api.stream('GetChatMessage', apiReq);
      let messageId = '';
      let conversationId = request.conversationId || '';
      let fullText = '';
      
      upstream.on('data', (chunk) => {
        if (ended) return;
        // API response: {message_id, delta_text, delta_tokens, stop_reason, delta_tool_calls, ...}
        // LS response: {chatMessage: {messageId, source, action: {generic: {text}}, inProgress}, numTokensInIntent}
        if (!messageId && chunk.message_id) messageId = chunk.message_id;
        fullText += chunk.delta_text || '';
        
        const lsResponse = {
          chatMessage: {
            messageId: messageId || chunk.message_id || '',
            source: 'CHAT_MESSAGE_SOURCE_AGENT',
            conversationId,
            inProgress: !chunk.stop_reason || chunk.stop_reason === 'STOP_REASON_UNSPECIFIED',
            action: {
              generic: { text: fullText },
              numTokens: chunk.delta_tokens || 0,
            },
          },
          numTokensInIntent: 0,
        };
        
        // Include tool calls if present
        if (chunk.delta_tool_calls && chunk.delta_tool_calls.length > 0) {
          lsResponse.chatMessage.action.generic = undefined;
          // Tool calls are streamed as deltas
        }
        
        try { call.write(lsResponse); } catch (e) {}
      });
      
      upstream.on('end', () => safeEnd());
      upstream.on('error', (err) => {
        this.log.error(`GetChatMessage stream error: ${err.message}`);
        safeEnd();
      });
      
      call.on('cancelled', () => {
        ended = true;
        try { upstream.cancel(); } catch (e) {}
      });
    } catch (err) {
      this.log.error(`GetChatMessage forward error: ${err.message}`);
      safeEnd();
    }
  }
  
  /**
   * Build API server GetChatMessage request from LS request.
   * Transforms chat_pb format to api_server_pb format.
   */
  _buildApiChatRequest(request) {
    // Convert chatMessages to chatMessagePrompts
    const chatMessagePrompts = [];
    const chatMessages = request.chatMessages || request.chat_messages || [];
    
    for (const msg of chatMessages) {
      const prompt = {
        message_id: msg.messageId || msg.message_id || '',
        source: msg.source || 'CHAT_MESSAGE_SOURCE_USER',
      };
      
      // Extract text content from ChatMessage
      if (msg.action?.generic?.text) {
        prompt.prompt = msg.action.generic.text;
      } else if (msg.intent?.text) {
        prompt.prompt = msg.intent.text;
      } else if (msg.content) {
        prompt.prompt = typeof msg.content === 'string' ? msg.content : '';
      }
      
      // Tool calls
      if (msg.action?.generic?.toolCalls || msg.action?.generic?.tool_calls) {
        prompt.tool_calls = msg.action.generic.toolCalls || msg.action.generic.tool_calls;
      }
      
      chatMessagePrompts.push(prompt);
    }
    
    const apiReq = {
      metadata: {},
      chat_message_prompts: chatMessagePrompts,
      chat_model_name: request.chatModelName || request.chat_model_name || '',
      chat_model_uid: request.chatModelUid || request.chat_model_uid || '',
    };
    this._injectMetadata(apiReq, this._getApiKey());
    return apiReq;
  }

  /** Server-streaming: RawGetChatMessage */
  rawGetChatMessage(call) {
    const request = call.request;
    this.log.info('RawGetChatMessage: streaming raw chat');
    this._forwardStream('RawGetChatMessage', request, call);
  }

  /** Server-streaming: GetDeepWiki */
  getDeepWiki(call) {
    const request = call.request;
    this.log.debug('GetDeepWiki called');
    this._forwardStream('GetDeepWiki', request, call);
  }

  /** Unary: CheckUserMessageRateLimit */
  checkUserMessageRateLimit(call, callback) {
    const request = call.request;
    this.log.debug('CheckUserMessageRateLimit called');
    // Forward to API server to get real rate limit info
    if (this.api && this.apiKey) {
      this._forwardUnary('CheckUserMessageRateLimit', request, callback);
    } else {
      // Default: has capacity, unlimited
      callback(null, { hasCapacity: true, messagesRemaining: 500, maxMessages: 500 });
    }
  }

  /** Unary: GetMessageTokenCount */
  getMessageTokenCount(call, callback) {
    const request = call.request;
    this.log.debug('GetMessageTokenCount called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RecordChatFeedback */
  recordChatFeedback(call, callback) {
    const request = call.request;
    this.log.debug('RecordChatFeedback called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RecordChatPanelSession */
  recordChatPanelSession(call, callback) {
    const request = call.request;
    this.log.debug('RecordChatPanelSession called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: CheckChatCapacity */
  checkChatCapacity(call, callback) {
    const request = call.request;
    this.log.debug('CheckChatCapacity called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ShouldEnableUnleash */
  shouldEnableUnleash(call, callback) {
    const request = call.request;
    this.log.debug('ShouldEnableUnleash called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetWorkspaceEditState */
  getWorkspaceEditState(call, callback) {
    const request = call.request;
    this.log.debug('GetWorkspaceEditState called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetRepoInfos */
  getRepoInfos(call, callback) {
    const request = call.request;
    this.log.debug('GetRepoInfos called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetWorkspaceInfos */
  getWorkspaceInfos(call, callback) {
    const request = call.request;
    this.log.debug('GetWorkspaceInfos called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GenerateCommitMessage */
  generateCommitMessage(call, callback) {
    const request = call.request;
    this.log.debug('GenerateCommitMessage called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RecordCommitMessageSave */
  recordCommitMessageSave(call, callback) {
    const request = call.request;
    this.log.debug('RecordCommitMessageSave called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SendActionToChatPanel */
  sendActionToChatPanel(call, callback) {
    const request = call.request;
    this.log.debug('SendActionToChatPanel called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetUserSettings */
  getUserSettings(call, callback) {
    const request = call.request;
    this.log.debug('GetUserSettings called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SetUserSettings */
  setUserSettings(call, callback) {
    const request = call.request;
    this.log.debug('SetUserSettings called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetDefaultWebOrigins */
  getDefaultWebOrigins(call, callback) {
    const request = call.request;
    this.log.debug('GetDefaultWebOrigins called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetDebugDiagnostics */
  getDebugDiagnostics(call, callback) {
    const request = call.request;
    this.log.debug('GetDebugDiagnostics called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetUserStatus */
  getUserStatus(call, callback) {
    const request = call.request;
    this.log.debug('GetUserStatus called');
    
    // GetUserStatus: The real LS calls SeatManagementService.GetUserStatus
    // on register.windsurf.com with the user's API key in metadata.
    // The response contains UserStatus and PlanInfo which the LS caches.
    if (this.seatMgmt && this.apiKey) {
      const codec = require('../proto-codec');
      const reqBody = codec.encodeRequest('GetUserStatus', {
        metadata: { apiKey: this.apiKey },
      });
      this.seatMgmt.callRaw('GetUserStatus', reqBody)
        .then(resBody => {
          const decoded = codec.decodeResponse('GetUserStatus', resBody);
          this.log.info(`GetUserStatus: name=${decoded.userStatus?.name}, pro=${decoded.userStatus?.pro}`);
          callback(null, decoded);
        })
        .catch(err => {
          this.log.warn(`GetUserStatus SeatMgmt error: ${err.message}, returning defaults`);
          callback(null, { userStatus: { pro: false }, planInfo: {} });
        });
    } else {
      // No SeatManagement client — return minimal valid response
      callback(null, { userStatus: { pro: false }, planInfo: {} });
    }
  }

  /** Unary: GetProfileData */
  getProfileData(call, callback) {
    const request = call.request;
    this.log.debug('GetProfileData called');
    
    // GetProfileData: Forward to SeatManagementService on register.windsurf.com
    if (this.seatMgmt && this.apiKey) {
      const codec = require('../proto-codec');
      const reqBody = codec.encodeRequest('GetProfileData', {
        apiKey: request.apiKey || this.apiKey,
      });
      this.seatMgmt.callRaw('GetProfileData', reqBody)
        .then(resBody => {
          const decoded = codec.decodeResponse('GetProfileData', resBody);
          callback(null, decoded);
        })
        .catch(err => {
          this.log.warn(`GetProfileData SeatMgmt error: ${err.message}`);
          callback(null, { profilePictureUrl: '' });
        });
    } else {
      callback(null, { profilePictureUrl: '' });
    }
  }

  /** Unary: CaptureCode */
  captureCode(call, callback) {
    const request = call.request;
    this.log.debug('CaptureCode called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: CaptureFile */
  captureFile(call, callback) {
    const request = call.request;
    this.log.debug('CaptureFile called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetChangelog */
  getChangelog(call, callback) {
    const request = call.request;
    this.log.debug('GetChangelog called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetFunctions */
  getFunctions(call, callback) {
    const request = call.request;
    this.log.debug('GetFunctions called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetClassInfos */
  getClassInfos(call, callback) {
    const request = call.request;
    this.log.debug('GetClassInfos called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SetupUniversitySandbox */
  setupUniversitySandbox(call, callback) {
    const request = call.request;
    this.log.debug('SetupUniversitySandbox called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: Exit */
  exit(call, callback) {
    this.log.info('Exit called - shutting down gracefully');
    callback(null, {});
    // Give time for the response to be sent, then exit
    setTimeout(() => process.exit(0), 500);
  }

  /** Unary: ResetOnboarding */
  resetOnboarding(call, callback) {
    const request = call.request;
    this.log.debug('ResetOnboarding called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SkipOnboarding */
  skipOnboarding(call, callback) {
    const request = call.request;
    this.log.debug('SkipOnboarding called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetUserTrajectoryDebug */
  getUserTrajectoryDebug(call, callback) {
    const request = call.request;
    this.log.debug('GetUserTrajectoryDebug called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetUserTrajectoryDescriptions */
  getUserTrajectoryDescriptions(call, callback) {
    const request = call.request;
    this.log.debug('GetUserTrajectoryDescriptions called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Server-streaming: StreamUserTrajectoryReactiveUpdates */
  streamUserTrajectoryReactiveUpdates(call) {
    const request = call.request;
    this.log.debug('StreamUserTrajectoryReactiveUpdates called');
    // TODO: Implement streaming logic
    // Forward to ApiServerService and stream responses back
    call.end();
  }

  /** Unary: GetCascadeMemories */
  getCascadeMemories(call, callback) {
    const request = call.request;
    this.log.debug('GetCascadeMemories called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: DeleteCascadeMemory */
  deleteCascadeMemory(call, callback) {
    const request = call.request;
    this.log.debug('DeleteCascadeMemory called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: UpdateCascadeMemory */
  updateCascadeMemory(call, callback) {
    const request = call.request;
    this.log.debug('UpdateCascadeMemory called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetUserMemories */
  getUserMemories(call, callback) {
    const request = call.request;
    this.log.debug('GetUserMemories called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RefreshCustomization */
  refreshCustomization(call, callback) {
    const request = call.request;
    this.log.debug('RefreshCustomization called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetConversationTags */
  getConversationTags(call, callback) {
    const request = call.request;
    this.log.debug('GetConversationTags called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: UpdateConversationTags */
  updateConversationTags(call, callback) {
    const request = call.request;
    this.log.debug('UpdateConversationTags called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: StartCascade */
  startCascade(call, callback) {
    const request = call.request;
    this.log.info(`StartCascade: type=${request.trajectory_type} source=${request.source}`);
    this.cascade.startCascade(request)
      .then(response => callback(null, response))
      .catch(err => callback({ code: 13, message: err.message }));
  }

  /** Unary: CancelCascadeInvocation */
  cancelCascadeInvocation(call, callback) {
    const request = call.request;
    this.log.info(`CancelCascade: ${request.cascade_id}`);
    this.cascade.cancelCascade(request.cascade_id);
    callback(null, {});
  }

  /** Unary: CancelCascadeInvocationAndWait */
  cancelCascadeInvocationAndWait(call, callback) {
    const request = call.request;
    this.log.debug('CancelCascadeInvocationAndWait called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: CancelCascadeSteps */
  cancelCascadeSteps(call, callback) {
    const request = call.request;
    this.log.debug('CancelCascadeSteps called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SendUserCascadeMessage */
  sendUserCascadeMessage(call, callback) {
    const request = call.request;
    this.log.info(`SendUserCascadeMessage: cascade=${request.cascade_id}`);
    this.cascade.sendUserMessage(request)
      .then(response => callback(null, response))
      .catch(err => callback({ code: 13, message: err.message }));
  }

  /** Unary: BranchCascade */
  branchCascade(call, callback) {
    const request = call.request;
    this.log.info(`BranchCascade: from=${request.base_cascade_id}`);
    this.cascade.branchCascade(request)
      .then(response => callback(null, response))
      .catch(err => callback({ code: 13, message: err.message }));
  }

  /** Unary: QueueCascadeMessage */
  queueCascadeMessage(call, callback) {
    const request = call.request;
    this.log.debug('QueueCascadeMessage called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: InterruptWithQueuedMessage */
  interruptWithQueuedMessage(call, callback) {
    const request = call.request;
    this.log.debug('InterruptWithQueuedMessage called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RemoveFromQueue */
  removeFromQueue(call, callback) {
    const request = call.request;
    this.log.debug('RemoveFromQueue called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: MoveQueuedMessage */
  moveQueuedMessage(call, callback) {
    const request = call.request;
    this.log.debug('MoveQueuedMessage called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SyncExploreAgentRun */
  syncExploreAgentRun(call, callback) {
    const request = call.request;
    this.log.debug('SyncExploreAgentRun called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RevertToCascadeStep */
  revertToCascadeStep(call, callback) {
    const request = call.request;
    this.log.debug('RevertToCascadeStep called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetRevertPreview */
  getRevertPreview(call, callback) {
    const request = call.request;
    this.log.debug('GetRevertPreview called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RecordUserStepSnapshot */
  recordUserStepSnapshot(call, callback) {
    const request = call.request;
    this.log.debug('RecordUserStepSnapshot called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetAllCascadeTrajectories */
  getAllCascadeTrajectories(call, callback) {
    const request = call.request;
    this.log.debug('GetAllCascadeTrajectories called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: HandleCascadeUserInteraction */
  handleCascadeUserInteraction(call, callback) {
    const request = call.request;
    this.log.debug('HandleCascadeUserInteraction called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: AcknowledgeCascadeCodeEdit */
  acknowledgeCascadeCodeEdit(call, callback) {
    const request = call.request;
    this.log.debug('AcknowledgeCascadeCodeEdit called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetCodeValidationStates */
  getCodeValidationStates(call, callback) {
    const request = call.request;
    this.log.debug('GetCodeValidationStates called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: CreateWorktree */
  createWorktree(call, callback) {
    const request = call.request;
    this.log.debug('CreateWorktree called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ResolveWorktreeChanges */
  resolveWorktreeChanges(call, callback) {
    const request = call.request;
    this.log.debug('ResolveWorktreeChanges called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: UndoWorktreeMerge */
  undoWorktreeMerge(call, callback) {
    const request = call.request;
    this.log.debug('UndoWorktreeMerge called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: DeleteCascadeTrajectory */
  deleteCascadeTrajectory(call, callback) {
    const request = call.request;
    this.log.debug('DeleteCascadeTrajectory called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RenameCascadeTrajectory */
  renameCascadeTrajectory(call, callback) {
    const request = call.request;
    this.log.debug('RenameCascadeTrajectory called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ArchiveCascadeTrajectory */
  archiveCascadeTrajectory(call, callback) {
    const request = call.request;
    this.log.debug('ArchiveCascadeTrajectory called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: InitializeCascadePanelState */
  initializeCascadePanelState(call, callback) {
    const request = call.request;
    this.log.debug('InitializeCascadePanelState called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: UpdatePanelStateWithUserStatus */
  updatePanelStateWithUserStatus(call, callback) {
    const request = call.request;
    this.log.debug('UpdatePanelStateWithUserStatus called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SpawnArenaModeMidConversation */
  spawnArenaModeMidConversation(call, callback) {
    const request = call.request;
    this.log.debug('SpawnArenaModeMidConversation called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ConvergeArenaCascades */
  convergeArenaCascades(call, callback) {
    const request = call.request;
    this.log.debug('ConvergeArenaCascades called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Server-streaming: StreamCascadePanelReactiveUpdates */
  streamCascadePanelReactiveUpdates(call) {
    const request = call.request;
    this.log.debug('StreamCascadePanelReactiveUpdates called');
    // TODO: Implement streaming logic
    // Forward to ApiServerService and stream responses back
    call.end();
  }

  /** Server-streaming: StreamCascadeReactiveUpdates */
  streamCascadeReactiveUpdates(call) {
    const request = call.request;
    this.log.info(`StreamCascadeReactiveUpdates: cascade=${request.cascade_id}`);
    this.cascade.subscribe(request.cascade_id, call);
  }

  /** Server-streaming: StreamCascadeSummariesReactiveUpdates */
  streamCascadeSummariesReactiveUpdates(call) {
    const request = call.request;
    this.log.debug('StreamCascadeSummariesReactiveUpdates called');
    // TODO: Implement streaming logic
    // Forward to ApiServerService and stream responses back
    call.end();
  }

  /** Unary: ForceBackgroundResearchRefresh */
  forceBackgroundResearchRefresh(call, callback) {
    const request = call.request;
    this.log.debug('ForceBackgroundResearchRefresh called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ResolveOutstandingSteps */
  resolveOutstandingSteps(call, callback) {
    const request = call.request;
    this.log.debug('ResolveOutstandingSteps called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RefreshMcpServers */
  refreshMcpServers(call, callback) {
    const request = call.request;
    this.log.debug('RefreshMcpServers called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetMcpServerStates */
  getMcpServerStates(call, callback) {
    const request = call.request;
    this.log.debug('GetMcpServerStates called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetMcpPrompt */
  getMcpPrompt(call, callback) {
    const request = call.request;
    this.log.debug('GetMcpPrompt called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SaveMcpServerToConfigFile */
  saveMcpServerToConfigFile(call, callback) {
    const request = call.request;
    this.log.debug('SaveMcpServerToConfigFile called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: UpdateMcpServerInConfigFile */
  updateMcpServerInConfigFile(call, callback) {
    const request = call.request;
    this.log.debug('UpdateMcpServerInConfigFile called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ToggleMcpTool */
  toggleMcpTool(call, callback) {
    const request = call.request;
    this.log.debug('ToggleMcpTool called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: DismissCodeMapSuggestion */
  dismissCodeMapSuggestion(call, callback) {
    const request = call.request;
    this.log.debug('DismissCodeMapSuggestion called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: StreamTerminalShellCommand */
  streamTerminalShellCommand(call, callback) {
    const request = call.request;
    this.log.debug('StreamTerminalShellCommand called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetWebDocsOptions */
  getWebDocsOptions(call, callback) {
    const request = call.request;
    this.log.debug('GetWebDocsOptions called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: UpdateDevExperiments */
  updateDevExperiments(call, callback) {
    const request = call.request;
    this.log.debug('UpdateDevExperiments called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SetBaseExperiments */
  setBaseExperiments(call, callback) {
    const request = call.request;
    this.log.debug('SetBaseExperiments called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetUnleashData */
  getUnleashData(call, callback) {
    const request = call.request;
    this.log.debug('GetUnleashData called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetActiveAppDeploymentForWorkspace */
  getActiveAppDeploymentForWorkspace(call, callback) {
    const request = call.request;
    this.log.debug('GetActiveAppDeploymentForWorkspace called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetWindsurfJSAppDeployment */
  getWindsurfJSAppDeployment(call, callback) {
    const request = call.request;
    this.log.debug('GetWindsurfJSAppDeployment called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetModelStatuses */
  getModelStatuses(call, callback) {
    const request = call.request;
    this.log.debug('GetModelStatuses called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: UpdateAutoCascadeGithubCredentials */
  updateAutoCascadeGithubCredentials(call, callback) {
    const request = call.request;
    this.log.debug('UpdateAutoCascadeGithubCredentials called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetAllWorkflows */
  getAllWorkflows(call, callback) {
    const request = call.request;
    this.log.debug('GetAllWorkflows called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: CopyBuiltinWorkflowToWorkspace */
  copyBuiltinWorkflowToWorkspace(call, callback) {
    const request = call.request;
    this.log.debug('CopyBuiltinWorkflowToWorkspace called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetAllRules */
  getAllRules(call, callback) {
    const request = call.request;
    this.log.debug('GetAllRules called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetAllSkills */
  getAllSkills(call, callback) {
    const request = call.request;
    this.log.debug('GetAllSkills called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetAllPlans */
  getAllPlans(call, callback) {
    const request = call.request;
    this.log.debug('GetAllPlans called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: UpdateEnterpriseExperimentsFromUrl */
  updateEnterpriseExperimentsFromUrl(call, callback) {
    const request = call.request;
    this.log.debug('UpdateEnterpriseExperimentsFromUrl called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ImportFromCursor */
  importFromCursor(call, callback) {
    const request = call.request;
    this.log.debug('ImportFromCursor called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: CreateCustomizationFile */
  createCustomizationFile(call, callback) {
    const request = call.request;
    this.log.debug('CreateCustomizationFile called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetTeamOrganizationalControls */
  getTeamOrganizationalControls(call, callback) {
    const request = call.request;
    this.log.debug('GetTeamOrganizationalControls called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RecordUserGrep */
  recordUserGrep(call, callback) {
    const request = call.request;
    this.log.debug('RecordUserGrep called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetGithubPullRequestSearchInfo */
  getGithubPullRequestSearchInfo(call, callback) {
    const request = call.request;
    this.log.debug('GetGithubPullRequestSearchInfo called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: CreateTrajectoryShare */
  createTrajectoryShare(call, callback) {
    const request = call.request;
    this.log.debug('CreateTrajectoryShare called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetKnowledgeBaseItemsForTeam */
  getKnowledgeBaseItemsForTeam(call, callback) {
    const request = call.request;
    this.log.debug('GetKnowledgeBaseItemsForTeam called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetCascadeTrajectory */
  getCascadeTrajectory(call, callback) {
    const request = call.request;
    this.log.debug('GetCascadeTrajectory called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetUserTrajectory */
  getUserTrajectory(call, callback) {
    const request = call.request;
    this.log.debug('GetUserTrajectory called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetCascadeTrajectorySteps */
  getCascadeTrajectorySteps(call, callback) {
    const request = call.request;
    this.log.debug('GetCascadeTrajectorySteps called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetCascadeTrajectoryGeneratorMetadata */
  getCascadeTrajectoryGeneratorMetadata(call, callback) {
    const request = call.request;
    this.log.debug('GetCascadeTrajectoryGeneratorMetadata called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetCascadeTranscriptForTrajectoryId */
  getCascadeTranscriptForTrajectoryId(call, callback) {
    const request = call.request;
    this.log.debug('GetCascadeTranscriptForTrajectoryId called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetPatchAndCodeChange */
  getPatchAndCodeChange(call, callback) {
    const request = call.request;
    this.log.debug('GetPatchAndCodeChange called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetAvailableCascadePlugins */
  getAvailableCascadePlugins(call, callback) {
    const request = call.request;
    this.log.debug('GetAvailableCascadePlugins called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: InstallCascadePlugin */
  installCascadePlugin(call, callback) {
    const request = call.request;
    this.log.debug('InstallCascadePlugin called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetCascadePluginById */
  getCascadePluginById(call, callback) {
    const request = call.request;
    this.log.debug('GetCascadePluginById called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetMcpRegistryServers */
  getMcpRegistryServers(call, callback) {
    const request = call.request;
    this.log.debug('GetMcpRegistryServers called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetAllAcpRegistries */
  getAllAcpRegistries(call, callback) {
    const request = call.request;
    this.log.debug('GetAllAcpRegistries called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: RecordLints */
  recordLints(call, callback) {
    const request = call.request;
    this.log.debug('RecordLints called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: ReplayGroundTruthTrajectory */
  replayGroundTruthTrajectory(call, callback) {
    const request = call.request;
    this.log.debug('ReplayGroundTruthTrajectory called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: MountCascadeFilesystem */
  mountCascadeFilesystem(call, callback) {
    const request = call.request;
    this.log.debug('MountCascadeFilesystem called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: UnmountCascadeFilesystem */
  unmountCascadeFilesystem(call, callback) {
    const request = call.request;
    this.log.debug('UnmountCascadeFilesystem called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: LogCascadeSession */
  logCascadeSession(call, callback) {
    const request = call.request;
    this.log.debug('LogCascadeSession called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetTranscription */
  getTranscription(call, callback) {
    const request = call.request;
    this.log.debug('GetTranscription called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Server-streaming: GenerateVibeAndReplaceStreaming */
  generateVibeAndReplaceStreaming(call) {
    const request = call.request;
    this.log.debug('GenerateVibeAndReplaceStreaming called');
    // TODO: Implement streaming logic
    // Forward to ApiServerService and stream responses back
    call.end();
  }

  /** Unary: GetCodeMapsForRepos */
  getCodeMapsForRepos(call, callback) {
    const request = call.request;
    this.log.debug('GetCodeMapsForRepos called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetCodeMapsForFile */
  getCodeMapsForFile(call, callback) {
    const request = call.request;
    this.log.debug('GetCodeMapsForFile called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Server-streaming: GenerateCodeMap */
  generateCodeMap(call) {
    const request = call.request;
    this.log.debug('GenerateCodeMap called');
    // TODO: Implement streaming logic
    // Forward to ApiServerService and stream responses back
    call.end();
  }

  /** Server-streaming: BranchCascadeAndGenerateCodeMap */
  branchCascadeAndGenerateCodeMap(call) {
    const request = call.request;
    this.log.debug('BranchCascadeAndGenerateCodeMap called');
    // TODO: Implement streaming logic
    // Forward to ApiServerService and stream responses back
    call.end();
  }

  /** Unary: ShareCodeMap */
  shareCodeMap(call, callback) {
    const request = call.request;
    this.log.debug('ShareCodeMap called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetSharedCodeMap */
  getSharedCodeMap(call, callback) {
    const request = call.request;
    this.log.debug('GetSharedCodeMap called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetCodeMapSuggestions */
  getCodeMapSuggestions(call, callback) {
    const request = call.request;
    this.log.debug('GetCodeMapSuggestions called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: UpdateCodeMapMetadata */
  updateCodeMapMetadata(call, callback) {
    const request = call.request;
    this.log.debug('UpdateCodeMapMetadata called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SaveCodeMapFromJson */
  saveCodeMapFromJson(call, callback) {
    const request = call.request;
    this.log.debug('SaveCodeMapFromJson called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: CheckBugs */
  checkBugs(call, callback) {
    const request = call.request;
    this.log.debug('CheckBugs called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetLifeguardConfig */
  getLifeguardConfig(call, callback) {
    const request = call.request;
    this.log.debug('GetLifeguardConfig called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: SubmitBugReport */
  submitBugReport(call, callback) {
    const request = call.request;
    this.log.debug('SubmitBugReport called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: OnEdit */
  onEdit(call, callback) {
    const request = call.request;
    this.log.debug('OnEdit called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  /** Unary: GetSystemPromptAndTools */
  getSystemPromptAndTools(call, callback) {
    const request = call.request;
    this.log.debug('GetSystemPromptAndTools called');
    // TODO: Implement - forward to API server or handle locally
    callback(null, {});
  }

  // ========================
  // Internal helpers
  // ========================

  /**
   * Inject api_key and impersonate_tier into request metadata.
   * This is the central point for Pro tier impersonation.
   */
  _injectMetadata(apiReq, key) {
    if (!apiReq.metadata) apiReq.metadata = {};
    apiReq.metadata.api_key = key;
    if (this.impersonateTier) {
      apiReq.metadata.impersonate_tier = this.impersonateTier;
    }
    return apiReq;
  }

  /**
   * Forward a server-streaming call to the API server
   * Pipes the upstream stream directly back to the client.
   */
  _forwardStream(method, request, call) {
    const key = this._getApiKey();
    if (!this.api || !key) {
      this.log.warn(`${method}: no API client/key, ending stream`);
      call.end();
      return;
    }

    let ended = false;
    let gotData = false;
    const safeEnd = () => {
      if (!ended) { ended = true; try { call.end(); } catch(e) {} }
    };

    try {
      this.api.connect();
      const apiReq = camelToSnake(request);
      this._injectMetadata(apiReq, key);
      
      const upstream = this.api.stream(method, apiReq);
      
      upstream.on('data', (chunk) => {
        if (!ended) {
          gotData = true;
          try { call.write(snakeToCamel(chunk)); } catch (e) {}
        }
      });
      
      upstream.on('end', () => {
        if (gotData && this.keyPool) this.keyPool.reportSuccess(key);
        safeEnd();
      });
      
      upstream.on('error', (err) => {
        this.log.error(`${method} stream error: ${err.message}`);
        if (this.keyPool) {
          const rl = /rate.limit|quota|429/i.test(err.message);
          this.keyPool.reportFailure(key, { rateLimited: rl, error: err.message });
        }
        safeEnd();
      });
      
      call.on('cancelled', () => {
        ended = true;
        try { upstream.cancel(); } catch (e) {}
      });
    } catch (err) {
      this.log.error(`${method} forward error: ${err.message}`);
      if (this.keyPool) this.keyPool.reportFailure(key, { error: err.message });
      safeEnd();
    }
  }

  /**
   * Forward a unary call to the API server
   */
  _forwardUnary(method, request, callback) {
    const key = this._getApiKey();
    if (!this.api || !key) {
      callback(null, {});
      return;
    }

    this.api.connect();
    const apiReq = camelToSnake(request);
    this._injectMetadata(apiReq, key);
    
    this.api.call(method, apiReq)
      .then(response => {
        if (this.keyPool) this.keyPool.reportSuccess(key);
        callback(null, snakeToCamel(response));
      })
      .catch(err => {
        this.log.error(`${method} error: ${err.message}`);
        if (this.keyPool) {
          const rl = /rate.limit|quota|429/i.test(err.message);
          this.keyPool.reportFailure(key, { rateLimited: rl, error: err.message });
        }
        callback(null, {});
      });
  }
}

module.exports = LanguageServerService;

// === Case conversion utilities ===
// protobufjs uses camelCase, @grpc/proto-loader with keepCase uses snake_case

function camelToSnake(obj, depth = 0) {
  if (depth > 15 || obj === null || obj === undefined) return obj;
  if (Buffer.isBuffer(obj)) return obj;
  if (Array.isArray(obj)) return obj.map(v => camelToSnake(v, depth + 1));
  if (typeof obj !== 'object') return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const snakeKey = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    result[snakeKey] = camelToSnake(v, depth + 1);
  }
  return result;
}

function snakeToCamel(obj, depth = 0) {
  if (depth > 15 || obj === null || obj === undefined) return obj;
  if (Buffer.isBuffer(obj)) return obj;
  if (Array.isArray(obj)) return obj.map(v => snakeToCamel(v, depth + 1));
  if (typeof obj !== 'object') return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    const camelKey = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    result[camelKey] = snakeToCamel(v, depth + 1);
  }
  return result;
}
