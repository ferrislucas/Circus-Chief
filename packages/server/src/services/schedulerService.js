/* eslint-disable max-lines -- legacy scheduler service; split in a dedicated refactor. */
import { sessions, messages, conversations, projects, attachments } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as slashCommandService from './slashCommandService.js';
import { claimWorkflowSessionStart, withActiveLaneRunOwnership, activeLaneRunOwnsSession, closeOwnWork } from './workflowSessionService.js';
import { didSessionExecutionStart, rejectedSessionExecution, startedSessionExecution } from './sessionStartResult.js';

function clearedPendingSelection(session, extra = {}) {
  return {
    ...extra,
    pendingModel: null,
    ...(Object.hasOwn(session, 'pendingProviderId') ? { pendingProviderId: null } : {}),
  };
}
import { broadcastSessionStatus } from './streamEventHandler.js';

function broadcastRescheduledSession(sessionId, updated) {
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status: 'scheduled' });
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, { sessionId, session: updated });
  if (updated?.projectId) {
    broadcastToProject(updated.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: updated.projectId,
      sessionId,
      session: updated,
    });
  }
}

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
   * Check whether the scheduler is currently polling.
   * @returns {boolean}
   */
  isRunning() {
    return this.intervalId !== null;
  }

  /**
   * Start the scheduler unless the environment opts out (e.g. VCR_MODE).
   *
   * This gate lives on the service so unit tests can exercise the decision
   * without booting the whole server. The env parameter defaults to
   * process.env but is injectable for tests.
   *
   * Note: an empty VCR_MODE string is treated the same as unset, matching
   * the /api/server-info contract.
   *
   * @param {object} sessionManager - Session manager instance
   * @param {object} [env=process.env] - Env-like object (for tests)
   * @returns {boolean} true if started, false if gated off
   */
  startIfEnabled(sessionManager, env = process.env) {
    // Keep the execution dependency available even when periodic polling is
    // disabled (notably in VCR-backed E2E runs). Explicit "run now" requests
    // still need to use the exact same scheduler hand-off as a due session.
    this.initialize(sessionManager);
    if (env.VCR_MODE && env.VCR_MODE.length > 0) {
      console.log('[SchedulerService] VCR_MODE set, scheduler disabled');
      return false;
    }
    this.start();
    return true;
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
        const result = await this.startScheduledSession(session);
        if (result && result.claimed === false) {
          // Another caller (a manual "Start Now" request, or another poll
          // tick racing this one) already claimed the session first. That's
          // a successful outcome from the poller's point of view — nothing
          // further to do here.
          console.log(`[SchedulerService] Session ${session.id} was not claimed (already started elsewhere, or no longer eligible); skipping`);
        }
      } catch (error) {
        // startScheduledSession has already recorded any pre-launch failure
        // on the session record itself (see `_recoverFromPrelaunchFailure`).
        // Errors from an in-flight turn are recorded by the normal turn
        // error-handling path (sessionExecution.js), not here. This catch
        // only exists to keep one session's failure from stopping the rest
        // of the due-session sweep.
        console.error(`[SchedulerService] Error starting scheduled session ${session.id}:`, error);
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
   * Creates the initial user message and starts the session. By this point
   * the claim has already transitioned the session to 'starting' and the
   * caller has already cleared the scheduling fields — this only performs
   * the actual launch work.
   * @param {object} session - Claimed session snapshot
   * @param {string} prompt - Raw prompt text
   * @param {string} effectivePrompt - Prompt after slash command resolution
   * @param {string} effectiveSystemPrompt - System prompt after resolution
   * @param {string} workingDirectory - Working directory
   * @param {Array} sessionAttachments - Attachments for context
   * @param {string} activeConversationId - Conversation to attach the initial message to
   */
  async startFreshScheduledSession({ session, prompt, effectivePrompt, effectiveSystemPrompt, workingDirectory, sessionAttachments, activeConversationId }) {
    // Create the initial user message
    const userMessage = messages.create(session.id, 'user', prompt, { toolUse: null, conversationId: activeConversationId });

    // Link any pending file attachments to the user message
    if (sessionAttachments && sessionAttachments.length > 0) {
      attachments.updateMessageIdForSession(session.id, userMessage.id);
    }

    // Broadcast the new message so UI updates
    broadcastToSession(session.id, WS_MESSAGE_TYPES.MESSAGE_CREATED, {
      sessionId: session.id,
      message: userMessage,
    });

    return this.sessionManager.runSession(
      session.id,
      effectivePrompt,
      workingDirectory,
      { systemPrompt: effectiveSystemPrompt, fileAttachments: sessionAttachments, model: session.pendingModel, providerId: session.pendingProviderId }
    );
  }

  /**
   * Resolve and validate everything needed to launch a claimed scheduled
   * session, without mutating anything. Kept separate from the actual
   * launch so a failure here can be recovered without having discarded the
   * claimed session's scheduling data (see `_recoverFromPrelaunchFailure`).
   * @param {object} claimed - Session snapshot returned by `sessions.claimScheduled`
   */
  async _prepareScheduledLaunch(claimed) {
    const project = projects.getById(claimed.projectId);
    if (!project) {
      throw new Error(`Project not found for session ${claimed.id}`);
    }

    const workingDirectory = claimed.gitWorktree || project.workingDirectory;

    const { prompt, effectivePrompt, effectiveSystemPrompt, sessionAttachments } =
      await this.resolveScheduledPrompt(claimed, workingDirectory, project.systemPrompt);

    const hasAssistantResponses = !claimed.pendingConversationId
      && messages.getBySessionId(claimed.id).some((msg) => msg.role === 'assistant');

    let activeConversationId = null;
    if (!claimed.pendingConversationId && !hasAssistantResponses) {
      // Fresh scheduled session: validate the conversation to attach the
      // initial user message to exists before committing to the launch.
      const activeConv = conversations.getActiveBySessionId(claimed.id);
      if (!activeConv) {
        throw new Error(`No active conversation found for session ${claimed.id}`);
      }
      activeConversationId = activeConv.id;
    }

    return { workingDirectory, prompt, effectivePrompt, effectiveSystemPrompt, sessionAttachments, hasAssistantResponses, activeConversationId };
  }

  /**
   * Recover a session whose claim succeeded but failed before reaching the
   * durable launch boundary (i.e. before any message was created or the
   * session manager was invoked). The claim never cleared `scheduledAt` /
   * `pendingPrompt` / `pendingConversationId`, so they are still intact in
   * the DB — this only needs to record the failure, not restore data.
   * @param {object} claimed - Session snapshot returned by `sessions.claimScheduled`
   * @param {Error} error - The pre-launch failure
   */
  _recoverFromPrelaunchFailure(claimed, error) {
    console.error(`[SchedulerService] Pre-launch failure for scheduled session ${claimed.id}:`, error);
    sessions.update(claimed.id, {
      status: 'error',
      error: `Failed to start scheduled session: ${error.message}`,
    });
    broadcastToSession(claimed.id, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId: claimed.id, status: 'error' });
  }

  /** Clear a stale start after its executor re-checks lane-run ownership. */
  rejectScheduledStart(session) {
    const updated = sessions.update(session.id, clearedPendingSelection(session, {
      status: 'stopped', scheduledAt: null, pendingPrompt: null,
      pendingConversationId: null,
    }));
    broadcastToSession(session.id, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId: session.id, status: 'stopped' });
    if (updated?.projectId) {
      broadcastToProject(updated.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
        projectId: updated.projectId, sessionId: session.id, session: updated,
      });
    }
  }

  static didExecutorStart(result, expectedSessionId) {
    return didSessionExecutionStart(result, expectedSessionId);
  }

  finishScheduledStart(session, executorResult) {
    // Existing non-workflow executors historically resolve without a receipt.
    // Lane workers require the explicit contract because their durable event
    // acknowledgement depends on proving the provider handoff occurred.
    if (!session.laneRunId && executorResult === undefined) {
      return startedSessionExecution(session.id);
    }
    if (!SchedulerService.didExecutorStart(executorResult, session.id)) {
      this.rejectScheduledStart(session);
      return rejectedSessionExecution(session.id, executorResult?.started === false && executorResult.reason
        ? executorResult.reason : 'invalid_executor_response');
    }
    return startedSessionExecution(session.id);
  }

  scheduledStartResult(session, executorResult) {
    const result = this.finishScheduledStart(session, executorResult);
    if (!session.laneRunId && result.started) return { claimed: true };
    if (!result.started) return result;
    return { claimed: true, ...result };
  }

  _refuseLaunchPastBudget(sessionId) {
    const row = sessions.getById(sessionId);
    if (!row || !this.hasReachedLaunchBudget(row)) return null;
    const error = `Scheduled launch refused: max total tokens reached (${row.maxTotalTokens.toLocaleString()}).`;
    sessions.update(sessionId, clearedPendingSelection(row, {
      status: 'stopped', scheduledAt: null, pendingPrompt: null,
      pendingConversationId: null,
      error,
    }));
    // The token cap is a hard terminal limit, not a retryable hold. A
    // participating worker therefore must close its durable obligation and
    // reconcile its lane run; otherwise the cleared schedule would strand an
    // open run with no executable owner. This is intentionally idempotent for
    // ordinary sessions and for a worker concurrently superseded or closed.
    closeOwnWork(sessionId, 'closed_failed', error);
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status: 'stopped' });
    return { claimed: false, started: false, reason: 'launch_budget_exhausted', sessionId };
  }

  async _dispatchScheduledLaunch(claimed, launch) {
    const { workingDirectory, prompt, effectivePrompt, effectiveSystemPrompt, sessionAttachments, hasAssistantResponses, activeConversationId } = launch;
    if (claimed.pendingConversationId) {
      return this.sessionManager.continueSessionWithExistingMessage(
        claimed.id,
        claimed.pendingConversationId,
        workingDirectory,
      { systemPrompt: effectiveSystemPrompt, model: claimed.pendingModel, providerId: claimed.pendingProviderId }
      );
    }
    if (hasAssistantResponses) {
      return this.sessionManager.continueSession(
        claimed.id,
        effectivePrompt,
        workingDirectory,
      { systemPrompt: effectiveSystemPrompt, fileAttachments: sessionAttachments, model: claimed.pendingModel, providerId: claimed.pendingProviderId }
      );
    }
    return this.startFreshScheduledSession({
      session: claimed, prompt, effectivePrompt, effectiveSystemPrompt, workingDirectory, sessionAttachments, activeConversationId,
    });
  }

  /**
   * Start a scheduled session — the single entry point used by both the
   * 30s poller (`checkScheduledSessions`) and the manual
   * `POST /:id/run-scheduled-now` endpoint.
   *
   * Atomically claims the session first (`sessions.claimScheduled`) so the
   * two entry points — or two overlapping manual requests — can never both
   * launch an agent for the same due session. A lost race is not an error:
   * it means another caller already started the session, so this resolves
   * to `{ claimed: false }` rather than throwing.
   *
   * @param {object} session - Session to start (only `session.id` is used;
   *   the authoritative data comes from the claim itself)
   * @param {{ promptOverride?: string }} [options] - Optional prompt text to
   *   use instead of the persisted `pendingPrompt`, applied atomically with
   *   the claim (see `SessionRepository.claimScheduled`).
   * @returns {Promise<{ claimed: boolean }>}
   */
  async startScheduledSession(session, { promptOverride } = {}) {
    if (!this.sessionManager) {
      throw new Error('SchedulerService not initialized with sessionManager');
    }

    // A ScheduleWakeup may become due while its originating turn is still
    // completing summaries, broadcasts, or workflow bookkeeping. Do not claim
    // (and therefore clear) that durable schedule until the old controller has
    // actually been deregistered. A later poll will pick it up normally.
    if (this.sessionManager.isSessionActive?.(session.id)) {
      return { claimed: false, started: false, reason: 'session_still_active', sessionId: session.id };
    }

    if (!claimWorkflowSessionStart(session.id)) {
      return { claimed: false, started: false, reason: 'lane_run_ownership_lost', sessionId: session.id };
    }

    // Re-read the row so a poller snapshot cannot undercount current usage.
    const budgetRefusal = this._refuseLaunchPastBudget(session.id);
    if (budgetRefusal) return budgetRefusal;

    const claimed = sessions.claimScheduled(session.id, { promptOverride });
    if (!claimed) {
      return { claimed: false };
    }

    console.log(`[SchedulerService] Starting scheduled session ${claimed.id}: ${claimed.name}`);
    // broadcastSessionStatus sends both the session-scoped SESSION_STATUS frame
    // and the project-scoped SESSION_UPDATED frame, so a sibling session's
    // dropdown row in another view also flips out of "⏰ Scheduled" for the
    // `starting` transition (previously only the `running` transition was
    // project-broadcast).
    broadcastSessionStatus(claimed.id, 'starting');

    let launch;
    try {
      launch = await this._prepareScheduledLaunch(claimed);
    } catch (error) {
      this._recoverFromPrelaunchFailure(claimed, error);
      throw error;
    }

    // Prompt resolution may yield to disk IO while a manual move supersedes
    // this lane run. Fence the durable clear and provider handoff.
    if (claimed.laneRunId && !activeLaneRunOwnsSession(claimed.id)) {
      return { claimed: true, ...this.finishScheduledStart(claimed, rejectedSessionExecution(claimed.id, 'lane_run_ownership_lost')) };
    }

    // Durable boundary: everything needed to launch has resolved
    // successfully, so it's now safe to clear the scheduling fields. Any
    // failure past this point is a normal in-flight turn failure, handled
    // by the existing turn error-handling path rather than by this method.
    sessions.update(claimed.id, clearedPendingSelection(claimed, {
      scheduledAt: null, pendingPrompt: null, pendingConversationId: null,
    }));

    const startResult = await this._dispatchScheduledLaunch(claimed, launch);
    return this.scheduledStartResult(claimed, startResult);
  }

  /**
   * Reschedule a session with a delay
   * @param {string} sessionId - Session ID to reschedule
   * @param {string} reason - Reason for rescheduling
   * @param {{ retryExistingMessage?: boolean, conversationId?: string|null }} [options]
   *   - retryExistingMessage: if true, retry the existing user message instead of sending "Continue"
   *   - conversationId: the active conversation to retry (required when retryExistingMessage is true)
   * @returns {boolean} True if rescheduled, false if limits reached
   */
  async rescheduleSession(sessionId, reason, { retryExistingMessage = false, conversationId = null } = {}) {
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

    const { pendingPrompt, pendingConversationId } = this._resolvePendingPrompt(sessionId, retryExistingMessage, conversationId);

    // Update session to scheduled status with new time and pendingPrompt
    const update = () => sessions.update(sessionId, {
      status: 'scheduled',
      scheduledAt: newScheduledAt,
      rescheduleCount: newRescheduleCount,
      pendingPrompt,
      pendingConversationId,
      error: `Rescheduled (${newRescheduleCount}x): ${reason}`,
    });
    const updated = session.laneRunId ? withActiveLaneRunOwnership(sessionId, update) : update();
    if (!updated) return false;

    broadcastRescheduledSession(sessionId, updated);

    return true;
  }

  /**
   * Resolve the pending prompt and conversation ID for a reschedule attempt.
   * @param {string} sessionId - Session ID (used for logging)
   * @param {boolean} retryExistingMessage - Whether to retry the existing user message
   * @param {string|null} conversationId - Active conversation to retry
   * @returns {{ pendingPrompt: string, pendingConversationId: string|null }}
   */
  _resolvePendingPrompt(sessionId, retryExistingMessage, conversationId) {
    if (retryExistingMessage && conversationId) {
      const convMessages = messages.getByConversationId(conversationId);
      const lastUserMessage = [...convMessages].reverse().find(msg => msg.role === 'user');

      if (!lastUserMessage) {
        console.warn(`[SchedulerService] No user message found in conversation ${conversationId}, falling back to Continue`);
        return { pendingPrompt: 'Continue', pendingConversationId: null };
      }

      console.log(`[SchedulerService] Existing-message retry for session ${sessionId}, conversation ${conversationId}`);
      return { pendingPrompt: lastUserMessage.content, pendingConversationId: conversationId };
    }

    console.log(`[SchedulerService] Continue retry for session ${sessionId}`);
    return { pendingPrompt: 'Continue', pendingConversationId: null };
  }

  /**
   * Governance check for a scheduled launch. Applies the durable budget caps
   * (maxTotalTokens) to every scheduled start, regardless of which mechanism
   * wrote the schedule (explicit REST, error-retry, or the ScheduleWakeup bridge).
   *
   * Unlike rescheduleSession's use of hasReachedLimits, this intentionally does
   * NOT gate on maxRescheduleCount: an explicit REST schedule is a durable user
   * instruction that must still fire even when past the retry cap. Only the
   * hard token budget is enforced here, because token spend is cumulative and
   * cannot be undone, whereas a missed retry is recoverable.
   *
   * @param {object} session
   * @returns {boolean} true when the launch must be refused.
   */
  hasReachedLaunchBudget(session) {
    if (session.maxTotalTokens !== null) {
      const totalTokens = session.inputTokens + session.outputTokens;
      if (totalTokens >= session.maxTotalTokens) {
        console.warn(
          `[SchedulerService] Max total tokens reached at scheduled launch: `
          + `${totalTokens.toLocaleString()}/${session.maxTotalTokens.toLocaleString()} for session ${session.id}`
        );
        return true;
      }
    }
    return false;
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
