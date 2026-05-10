'use strict';

const { STEP_TYPE } = require('./cascade-engine');

/**
 * ToolExecutor - Executes Cascade tool steps via ExtensionServer callbacks.
 * 
 * Each tool step from the AI model is dispatched to the appropriate
 * ExtensionServer method. Results are populated back into the step.
 * 
 * This matches the real language_server behavior where it:
 * 1. Receives a tool call from the AI model
 * 2. Calls ExtensionServer to execute it in the IDE
 * 3. Collects the result
 * 4. Sends the result back to the model for the next step
 */
class ToolExecutor {
  constructor({ extensionClient, logger }) {
    this.ext = extensionClient;
    this.log = logger;
    
    // Map step type → executor function
    this.executors = {
      [STEP_TYPE.VIEW_FILE]: this.executeViewFile.bind(this),
      [STEP_TYPE.WRITE_TO_FILE]: this.executeWriteToFile.bind(this),
      [STEP_TYPE.CODE_ACTION]: this.executeCodeAction.bind(this),
      [STEP_TYPE.RUN_COMMAND]: this.executeRunCommand.bind(this),
      [STEP_TYPE.GREP_SEARCH]: this.executeGrepSearch.bind(this),
      [STEP_TYPE.LIST_DIRECTORY]: this.executeListDirectory.bind(this),
      [STEP_TYPE.SEARCH_WEB]: this.executeSearchWeb.bind(this),
      [STEP_TYPE.READ_URL_CONTENT]: this.executeReadUrlContent.bind(this),
      [STEP_TYPE.MCP_TOOL]: this.executeMcpTool.bind(this),
      [STEP_TYPE.GIT_COMMIT]: this.executeGitCommit.bind(this),
    };
  }

  /**
   * Execute a single tool step
   * @param {string} stepType - Step type key from STEP_TYPE
   * @param {object} stepData - Step parameters
   * @returns {object} Populated step with results
   */
  async execute(stepType, stepData) {
    const executor = this.executors[stepType];
    if (!executor) {
      this.log.debug(`No executor for step type: ${stepType}`);
      return stepData;
    }
    
    try {
      return await executor(stepData);
    } catch (err) {
      this.log.error(`Tool execution failed [${stepType}]: ${err.message}`);
      return { ...stepData, _error: err.message };
    }
  }

  /**
   * ViewFile: Read file contents via ExtensionServer
   */
  async executeViewFile(step) {
    if (!this.ext) return step;
    
    const response = await this.ext.call('ReadTextDocument', {
      uri: step.file_uri,
    });
    
    return {
      ...step,
      content_lines: response.content ? response.content.split('\n') : [],
      total_lines: response.content ? response.content.split('\n').length : 0,
    };
  }

  /**
   * WriteToFile: Apply file write via ExtensionServer
   */
  async executeWriteToFile(step) {
    if (!this.ext) return step;
    
    const content = Array.isArray(step.code_content) 
      ? step.code_content.join('\n') 
      : step.code_content || '';
    
    await this.ext.call('WriteTextDocument', {
      uri: step.target_file_uri,
      content,
    });
    
    return { ...step, file_created: true };
  }

  /**
   * CodeAction: Apply diff via ExtensionServer
   */
  async executeCodeAction(step) {
    if (!this.ext) return step;
    
    if (step.action_spec) {
      await this.ext.applyDiff({
        file_uri: step.action_spec.file_uri,
        diff: step.action_spec.diff,
      });
    }
    
    return {
      ...step,
      action_result: { success: true },
      acknowledgement_type: 'ACKNOWLEDGEMENT_TYPE_AUTO',
    };
  }

  /**
   * RunCommand: Execute terminal command via ExtensionServer
   */
  async executeRunCommand(step) {
    if (!this.ext) return step;
    
    const commandLine = step.command_line || step.proposed_command_line || step.command;
    if (!commandLine) return step;
    
    const response = await this.ext.runTerminalCommand({
      command_line: commandLine,
      cwd: step.cwd || '',
      blocking: step.blocking !== false,
      wait_ms_before_async: step.wait_ms_before_async || 0,
    });
    
    return {
      ...step,
      command_line: commandLine,
      exit_code: response.exit_code || 0,
      combined_output: response.output || '',
      terminal_id: response.terminal_id || '',
    };
  }

  /**
   * GrepSearch: Search files via ExtensionServer or local implementation
   */
  async executeGrepSearch(step) {
    if (!this.ext) return step;
    
    // The real LS uses its own ripgrep implementation, but we can 
    // proxy through the extension or fall back to RunCommand
    const response = await this.ext.call('SearchFiles', {
      query: step.query,
      directory: step.directory,
      case_sensitive: step.case_sensitive,
      include_patterns: step.include_patterns,
    });
    
    return {
      ...step,
      results: response.results || [],
      total_matches: response.total_matches || 0,
    };
  }

  /**
   * ListDirectory: List directory contents
   */
  async executeListDirectory(step) {
    if (!this.ext) return step;
    
    const response = await this.ext.call('ListDirectory', {
      uri: step.directory_uri,
    });
    
    return {
      ...step,
      entries: response.entries || [],
    };
  }

  /**
   * SearchWeb: Web search (forwarded to API server)
   */
  async executeSearchWeb(step) {
    // This is handled by ApiServerService.GetWebSearchResults, not ExtensionServer
    return step;
  }

  /**
   * ReadUrlContent: Fetch URL content (forwarded to API server)
   */
  async executeReadUrlContent(step) {
    // This is handled internally or via ApiServer
    return step;
  }

  /**
   * McpTool: Execute MCP tool
   */
  async executeMcpTool(step) {
    if (!this.ext) return step;
    
    const response = await this.ext.call('ExecuteMcpTool', {
      server_name: step.server_name,
      tool_name: step.tool_name,
      arguments_json: step.arguments_json,
    });
    
    return {
      ...step,
      result: response.result || '',
    };
  }

  /**
   * GitCommit: Create a git commit
   */
  async executeGitCommit(step) {
    if (!this.ext) return step;
    
    // Git operations can be done via RunTerminalCommand
    return step;
  }
}

module.exports = ToolExecutor;
