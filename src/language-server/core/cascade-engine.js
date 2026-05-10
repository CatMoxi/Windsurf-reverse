'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * CascadeEngine - Core AI agent workflow.
 * 
 * Implements the Cascade conversation lifecycle:
 * 1. StartCascade → creates a new cascade session
 * 2. SendUserCascadeMessage → sends user message, triggers AI processing
 * 3. StreamCascadeReactiveUpdates → streams trajectory steps back
 * 4. Tool use (file edits, terminal commands) via ExtensionServer callbacks
 * 5. ResumeCascade / CancelCascade / BranchCascade
 * 
 * Architecture:
 *   Extension → LS.StartCascade/SendMessage → LS.CascadeEngine
 *     → API.GetChatCompletions (cloud AI)
 *     → ExtServer.ApplyDiff/RunTerminal (tool execution)
 *     → Stream trajectory updates back to Extension
 */
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
