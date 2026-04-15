import { sessions, messages, conversations, projects, attachments } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as slashCommandService from './slashCommandService.js';

/**
 * Service for managing scheduled session execution
 * Polls for due sessions every 30 seconds and handles rescheduling logic
 */
class SchedulerService {
  constructor() {
    this.pollInterval = 30000; // 30 seconds
    this.intervalId = null;
    this.sessionManager = null; // Will be set during initialization
  }

  /**
   * Initialize the scheduler with dependencies
   * @param {object} sessionManager - Session manager instance
   */
  initialize(sessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Start the scheduler polling
   */
  start() {
    if (this.intervalId) {
      console.log('[SchedulerService] Already running');
      return;
    }

    console.log('[SchedulerService] Starting scheduler with', this.pollInterval, 'ms interval');
    this.intervalId = setInterval(() => this.checkScheduledSessions(), this.pollInterval);

    // Also check immediately on startup
    this.checkScheduledSessions();
  }

  /**
   * Stop the scheduler polling
   */
  stop() {
    if (this.intervalId) {
      console.log('[SchedulerService] Stopping scheduler');
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Check for scheduled sessions that are due to start
   */
  async checkScheduledSessions() {
    const now = Date.now();
    const dueSessions = sessions.getScheduledSessionsDue(now);

    if (dueSessions.length > 0) {
      console.log(`[SchedulerService] Found ${dueSessions.length} session(s) due to start`);
    }

    for (const session of dueSessions) {
      try {
        await this.startScheduledSession(session);
      } catch (error) {
        console.error(`[SchedulerService] Error starting scheduled session ${session.id}:`, error);
        // Mark session as error
        sessions.update(session.id, {
          status: 'error',
          error: `Failed to start scheduled session: ${error.message}`,
        });
        broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId: session.id, status: 'error' });
      }
    }
  }

  /**
   * Resolve skill/command invocations in the prompt, returning the effective prompt and system prompt.
   * @param {object} session - Session object
   * @param {string} workingDirectory - Working directory
   * @param {string} projectSystemPrompt - Project-level system prompt
   * @returns {Promise<{prompt: string, effectivePrompt: string, effectiveSystemPrompt: string, sessionAttachments: Array}>}
   */
  async resolveScheduledPrompt(session, workingDirectory, projectSystemPrompt) {
    const prompt = session.pendingPrompt.trim();
    const sessionAttachments = attachments.getBySessionId(session.id);

    const resolved = await slashCommandService.resolvePromptSkillOrCommand(
      workingDirectory, prompt, projectSystemPrompt
    );

    return {
      prompt,
      effectivePrompt: resolved ? resolved.userMessage : prompt,
      effectiveSystemPrompt: resolved ? resolved.systemPrompt : projectSystemPrompt,
      sessionAttachments,
    };
  }

  /**
   * Handle the fresh-session branch of startScheduledSession.
   * Creates the initial user message, updates status, and starts the session.
   * @param {object} session - Session object
   * @param {string} prompt - Raw prompt text
   * @param {string} effectivePrompt - Prompt after slash command resolution
   * @param {string} effectiveSystemPrompt - System prompt after resolution
   * @param {string} workingDirectory - Working directory
   * @param {Array} sessionAttachments - Attachments for context
   */
  async startFreshScheduledSession({ session, prompt, effectivePrompt, effectiveSystemPrompt, workingDirectory, sessionAttachments }) {
    const activeConv = conversations.getActiveBySessionId(session.id);
    if (!activeConv) {
      throw new Error(`No active conversation found for session ${session.id}`);
    }

    // Create the initial user message
    const userMessage = messages.create(session.id, 'user', prompt, { toolUse: null, conversationId: activeConv.id });

    // Broadcast the new message so UI updates
    broadcastToSession(session.id, WS_MESSAGE_TYPES.MESSAGE_CREATED, {
      sessionId: session.id,
      message: userMessage,
    });

    // Update status from 'scheduled' to 'starting' and clear pendingPrompt
    sessions.update(session.id, {
      status: 'starting',
      scheduledAt: null,
      pendingPrompt: null,
    });
    broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId: session.id, status: 'starting' });

    await this.sessionManager.runSession(
      session.id,
      effectivePrompt,
      workingDirectory,
      { systemPrompt: effectiveSystemPrompt, fileAttachments: sessionAttachments, model: session.pendingModel }
    );
  }

  /**
   * Start a scheduled session
   * @param {object} session - Session to start
   */
  async startScheduledSession(session) {
    if (!this.sessionManager) {
      throw new Error('SchedulerService not initialized with sessionManager');
    }

    console.log(`[SchedulerService] Starting scheduled session ${session.id}: ${session.name}`);

    // Get the project for working directory and system prompt
    const project = projects.getById(session.projectId);
    if (!project) {
      throw new Error(`Project not found for session ${session.id}`);
    }

    // Determine working directory
    const workingDirectory = session.gitWorktree || project.workingDirectory;

    // Use pendingPrompt as the message to send
    if (!session.pendingPrompt || session.pendingPrompt.trim() === '') {
      throw new Error(`No pendingPrompt found for session ${session.id}`);
    }

    // Resolve skill/command invocations
    const { prompt, effectivePrompt, effectiveSystemPrompt, sessionAttachments } =
      await this.resolveScheduledPrompt(session, workingDirectory, project.systemPrompt);

    // Get the session messages to determine if this is initial or continuation
    const sessionMessages = messages.getBySessionId(session.id);
    const hasAssistantResponses = sessionMessages.some((msg) => msg.role === 'assistant');

    // Determine if this is an initial run or a continuation
    if (hasAssistantResponses) {
      // Session has conversation history - this is a scheduled continuation
      sessions.update(session.id, {
        status: 'starting',
        scheduledAt: null,
        pendingPrompt: null,
      });
      broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId: session.id, status: 'starting' });

      await this.sessionManager.continueSession(
        session.id,
        effectivePrompt,
        workingDirectory,
        { systemPrompt: effectiveSystemPrompt, fileAttachments: sessionAttachments, model: session.pendingModel }
      );
    } else {
      // Fresh session - initial run
      await this.startFreshScheduledSession({ session, prompt, effectivePrompt, effectiveSystemPrompt, workingDirectory, sessionAttachments });
    }
  }

  /**
   * Reschedule a session with a delay
   * @param {string} sessionId - Session ID to reschedule
   * @param {string} reason - Reason for rescheduling
   * @returns {boolean} True if rescheduled, false if limits reached
   */
  async rescheduleSession(sessionId, reason) {
    const session = sessions.getById(sessionId);
    if (!session) {
      console.error(`[SchedulerService] Session not found: ${sessionId}`);
      return false;
    }

    // Check reschedule limits
    if (this.hasReachedLimits(session)) {
      console.log(`[SchedulerService] Session ${sessionId} has reached reschedule limits`);
      sessions.update(sessionId, {
        status: 'error',
        error: `Reschedule limits reached. ${reason}`,
      });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status: 'error' });
      return false;
    }

    // Get the last user message to use as pendingPrompt for restart
    const sessionMessages = messages.getBySessionId(sessionId);
    const lastUserMessage = [...sessionMessages].reverse().find(msg => msg.role === 'user');

    if (!lastUserMessage) {
      console.error(`[SchedulerService] No user message found for session ${sessionId}`);
      sessions.update(sessionId, {
        status: 'error',
        error: `Cannot reschedule: No user message found. ${reason}`,
      });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status: 'error' });
      return false;
    }

    // Calculate new scheduled time
    const newScheduledAt = Date.now() + session.rescheduleDelayMinutes * 60 * 1000;
    const delayMinutes = session.rescheduleDelayMinutes;
    const newRescheduleCount = session.rescheduleCount + 1;

    console.log(
      `[SchedulerService] Rescheduling session ${sessionId} for ${delayMinutes} minutes from now (attempt ${newRescheduleCount})`
    );

    // Update session to scheduled status with new time and pendingPrompt
    sessions.update(sessionId, {
      status: 'scheduled',
      scheduledAt: newScheduledAt,           // Fixed: camelCase
      rescheduleCount: newRescheduleCount,   // Fixed: camelCase
      pendingPrompt: lastUserMessage.content, // Set prompt for scheduler
      error: `Rescheduled (${newRescheduleCount}x): ${reason}`,
    });

    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status: 'scheduled' });

    return true;
  }

  /**
   * Check if a session has reached its reschedule limits
   * @param {object} session - Session to check
   * @returns {boolean} True if limits reached
   */
  hasReachedLimits(session) {
    // Check max reschedule count
    if (session.maxRescheduleCount !== null && session.rescheduleCount >= session.maxRescheduleCount) {
      console.log(
        `[SchedulerService] Max reschedule count reached: ${session.rescheduleCount}/${session.maxRescheduleCount}`
      );
      return true;
    }

    // Check max total tokens
    if (session.maxTotalTokens !== null) {
      const totalTokens = session.inputTokens + session.outputTokens;
      if (totalTokens >= session.maxTotalTokens) {
        console.log(
          `[SchedulerService] Max total tokens reached: ${totalTokens.toLocaleString()}/${session.maxTotalTokens.toLocaleString()}`
        );
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a session should be proactively rescheduled based on token threshold
   * @param {object} session - Session to check
   * @returns {boolean} True if should reschedule
   */
  shouldProactivelyReschedule(session) {
    if (!session.rescheduleAtTokenCount) {
      return false;
    }

    const totalTokens = session.inputTokens + session.outputTokens;
    return totalTokens >= session.rescheduleAtTokenCount;
  }
}

// Singleton instance
export const schedulerService = new SchedulerService();

// Export class for testing
export { SchedulerService };
