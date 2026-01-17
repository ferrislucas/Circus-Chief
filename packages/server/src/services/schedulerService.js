import { sessions, messages, projects, attachments } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

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

    const prompt = session.pendingPrompt.trim();

    // Get the session messages to determine if this is initial or continuation
    const sessionMessages = messages.getBySessionId(session.id);
    const hasAssistantResponses = sessionMessages.some((msg) => msg.role === 'assistant');

    // Get attachments for context
    const sessionAttachments = attachments.getBySessionId(session.id);

    // Update status from 'scheduled' to 'starting' and clear pendingPrompt
    sessions.update(session.id, {
      status: 'starting',
      scheduledAt: null,
      pendingPrompt: null,
    });
    broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId: session.id, status: 'starting' });

    // Determine if this is an initial run or a continuation
    if (hasAssistantResponses) {
      // Session has conversation history - this is a scheduled continuation
      await this.sessionManager.continueSession(
        session.id,
        prompt,
        workingDirectory,
        project.systemPrompt,
        sessionAttachments
      );
    } else {
      // Fresh session - initial run
      await this.sessionManager.runSession(
        session.id,
        prompt,
        workingDirectory,
        project.systemPrompt,
        sessionAttachments,
        session.model
      );
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

    // Calculate new scheduled time
    const newScheduledAt = Date.now() + session.rescheduleDelayMinutes * 60 * 1000;
    const delayMinutes = session.rescheduleDelayMinutes;
    const newRescheduleCount = session.rescheduleCount + 1;

    console.log(
      `[SchedulerService] Rescheduling session ${sessionId} for ${delayMinutes} minutes from now (attempt ${newRescheduleCount})`
    );

    // Update session to scheduled status with new time
    sessions.update(sessionId, {
      status: 'scheduled',
      scheduled_at: newScheduledAt,
      reschedule_count: newRescheduleCount,
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
