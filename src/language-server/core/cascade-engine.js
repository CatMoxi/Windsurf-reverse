'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * CascadeEngine - Core AI agent workflow.
 * 
 * Implements the Cascade conversation lifecycle based on the real
 * CortexTrajectoryStep model extracted from the binary:
 * 
 * 1. StartCascade → creates cascade session
 * 2. SendUserCascadeMessage → user_input step → triggers AI
 * 3. StreamCascadeReactiveUpdates → streams trajectory steps
 * 4. AI response → tool steps (code_action, run_command, view_file, etc.)
 * 5. Tool execution via ExtensionServer callbacks
 * 6. Loop until finish step or cancellation
 * 
 * Tool Steps (from CortexTrajectoryStep.oneof):
 *   code_action(10), run_command(28), write_to_file(23), view_file(14),
 *   grep_search(13), list_directory(15), search_web(42), read_url_content(40),
 *   mcp_tool(47), memory(38), git_commit(11), etc.
 * 
 * Status: CASCADE_RUN_STATUS_{RUNNING, FINISHED, CANCELLED, ERROR, WAITING_FOR_USER, PAUSED}
 */

// Step type constants (matching proto field numbers)
const STEP_TYPE = {
  DUMMY: 'dummy',
  PLAN_INPUT: 'plan_input',
  MQUERY: 'mquery',
  CODE_ACTION: 'code_action',
  GIT_COMMIT: 'git_commit',
  FINISH: 'finish',
  GREP_SEARCH: 'grep_search',
  VIEW_FILE: 'view_file',
  LIST_DIRECTORY: 'list_directory',
  COMPILE: 'compile',
  INFORM_PLANNER: 'inform_planner',
  USER_INPUT: 'user_input',
  PLANNER_RESPONSE: 'planner_response',
  FILE_BREAKDOWN: 'file_breakdown',
  VIEW_CODE_ITEM: 'view_code_item',
  WRITE_TO_FILE: 'write_to_file',
  ERROR_MESSAGE: 'error_message',
  RUN_COMMAND: 'run_command',
  RELATED_FILES: 'related_files',
  CHECKPOINT: 'checkpoint',
  PROPOSE_CODE: 'propose_code',
  FIND: 'find',
  SEARCH_KNOWLEDGE_BASE: 'search_knowledge_base',
  SUGGESTED_RESPONSES: 'suggested_responses',
  COMMAND_STATUS: 'command_status',
  MEMORY: 'memory',
  READ_URL_CONTENT: 'read_url_content',
  VIEW_CONTENT_CHUNK: 'view_content_chunk',
  SEARCH_WEB: 'search_web',
  RETRIEVE_MEMORY: 'retrieve_memory',
  CUSTOM_TOOL: 'custom_tool',
  MCP_TOOL: 'mcp_tool',
  MANAGER_FEEDBACK: 'manager_feedback',
};

const STATUS = {
  RUNNING: 'CASCADE_RUN_STATUS_RUNNING',
  FINISHED: 'CASCADE_RUN_STATUS_FINISHED',
  CANCELLED: 'CASCADE_RUN_STATUS_CANCELLED',
  ERROR: 'CASCADE_RUN_STATUS_ERROR',
  WAITING: 'CASCADE_RUN_STATUS_WAITING_FOR_USER',
  PAUSED: 'CASCADE_RUN_STATUS_PAUSED',
};

class CascadeEngine {
  constructor({ apiClient, extensionClient, logger }) {
    this.api = apiClient;
    this.ext = extensionClient;
    this.log = logger;
    
    // Active cascade sessions
    this.sessions = new Map();
    
    // Reactive update subscribers (cascadeId → Set<call>)
    this.subscribers = new Map();
  }

  /**
   * Start a new Cascade session
   */
  async startCascade(request) {
    const cascadeId = uuidv4();
    
    const session = {
      id: cascadeId,
      source: request.source,
      trajectoryType: request.trajectory_type,
      metadata: request.metadata,
      trajectory: {
        steps: [],
        status: 'CASCADE_RUN_STATUS_RUNNING',
      },
      createdAt: Date.now(),
    };
    
    this.sessions.set(cascadeId, session);
    this.log.info(`Cascade started: ${cascadeId}`);
    
    return { cascade_id: cascadeId };
  }

  /**
   * Process a user message in a Cascade session
   */
  async sendUserMessage(request) {
    const session = this.sessions.get(request.cascade_id);
    if (!session) {
      throw new Error(`Unknown cascade: ${request.cascade_id}`);
    }

    // Add user message as a trajectory step
    const userStep = {
      type: 'USER_MESSAGE',
      content: request.items,
      images: request.images,
      timestamp: Date.now(),
    };
    session.trajectory.steps.push(userStep);

    // Notify reactive subscribers of the new step
    this.notifySubscribers(request.cascade_id, {
      trajectory: session.trajectory,
      status: session.trajectory.status,
      num_total_steps: session.trajectory.steps.length,
    });

    // Call API server for AI response
    try {
      await this.processWithAI(session, request);
    } catch (err) {
      this.log.error(`Cascade AI processing error: ${err.message}`);
      session.trajectory.status = 'CASCADE_RUN_STATUS_ERROR';
      this.notifySubscribers(request.cascade_id, {
        trajectory: session.trajectory,
        status: 'CASCADE_RUN_STATUS_ERROR',
      });
    }

    return {};
  }

  /**
   * Process AI response and execute tool calls
   */
  async processWithAI(session, request) {
    // Build context from workspace
    let context = {};
    if (this.ext) {
      try {
        const activeDoc = await this.ext.getActiveDocument();
        const folders = await this.ext.getWorkspaceFolders();
        context = { activeDoc, folders };
      } catch (e) {
        this.log.warn(`Failed to get context: ${e.message}`);
      }
    }

    // Call ApiServerService.GetChatCompletions
    if (this.api) {
      try {
        this.api.connect();
        const response = await this.api.getChatCompletions({
          metadata: request.metadata,
          cascade_id: session.id,
          // The actual request format would include conversation history,
          // model config, context, etc.
        });
        
        // Process AI response into trajectory steps
        if (response) {
          const aiStep = {
            type: 'AI_RESPONSE',
            content: response,
            timestamp: Date.now(),
          };
          session.trajectory.steps.push(aiStep);
          
          this.notifySubscribers(session.id, {
            trajectory: session.trajectory,
            num_total_steps: session.trajectory.steps.length,
          });
        }
      } catch (err) {
        this.log.error(`API GetChatCompletions failed: ${err.message}`);
        throw err;
      }
    }
    
    // Mark as complete
    session.trajectory.status = 'CASCADE_RUN_STATUS_FINISHED';
    this.notifySubscribers(session.id, {
      trajectory: session.trajectory,
      status: 'CASCADE_RUN_STATUS_FINISHED',
      num_total_steps: session.trajectory.steps.length,
    });
  }

  /**
   * Get cascade trajectory
   */
  getCascadeTrajectory(cascadeId) {
    const session = this.sessions.get(cascadeId);
    if (!session) return null;
    
    return {
      trajectory: session.trajectory,
      status: session.trajectory.status,
      num_total_steps: session.trajectory.steps.length,
      num_total_generator_metadata: 0,
    };
  }

  /**
   * Cancel an active cascade
   */
  cancelCascade(cascadeId) {
    const session = this.sessions.get(cascadeId);
    if (!session) return;
    
    session.trajectory.status = 'CASCADE_RUN_STATUS_CANCELLED';
    this.notifySubscribers(cascadeId, {
      status: 'CASCADE_RUN_STATUS_CANCELLED',
    });
    this.log.info(`Cascade cancelled: ${cascadeId}`);
  }

  /**
   * Subscribe to reactive updates for a cascade
   */
  subscribe(cascadeId, call) {
    if (!this.subscribers.has(cascadeId)) {
      this.subscribers.set(cascadeId, new Set());
    }
    this.subscribers.get(cascadeId).add(call);
    
    // Send current state immediately
    const session = this.sessions.get(cascadeId);
    if (session) {
      call.write({
        trajectory: session.trajectory,
        status: session.trajectory.status,
        num_total_steps: session.trajectory.steps.length,
      });
    }
    
    // Clean up on disconnect
    call.on('cancelled', () => {
      const subs = this.subscribers.get(cascadeId);
      if (subs) subs.delete(call);
    });
  }

  /**
   * Branch a cascade (create new session from a point in existing one)
   */
  async branchCascade(request) {
    const baseSession = this.sessions.get(request.base_cascade_id);
    if (!baseSession) {
      throw new Error(`Unknown base cascade: ${request.base_cascade_id}`);
    }

    const newId = uuidv4();
    const branchIdx = request.branch_from_step_index || baseSession.trajectory.steps.length;
    
    const newSession = {
      id: newId,
      source: baseSession.source,
      trajectoryType: baseSession.trajectoryType,
      metadata: request.metadata,
      trajectory: {
        steps: baseSession.trajectory.steps.slice(0, branchIdx),
        status: 'CASCADE_RUN_STATUS_RUNNING',
      },
      createdAt: Date.now(),
      branchedFrom: request.base_cascade_id,
    };
    
    this.sessions.set(newId, newSession);
    this.log.info(`Cascade branched: ${newId} from ${request.base_cascade_id}`);
    
    return { new_cascade_id: newId };
  }

  // Internal: notify all subscribers of a cascade
  notifySubscribers(cascadeId, update) {
    const subs = this.subscribers.get(cascadeId);
    if (!subs) return;
    
    for (const call of subs) {
      try {
        call.write(update);
      } catch (e) {
        subs.delete(call);
      }
    }
  }
}

module.exports = CascadeEngine;
module.exports.STEP_TYPE = STEP_TYPE;
module.exports.STATUS = STATUS;
