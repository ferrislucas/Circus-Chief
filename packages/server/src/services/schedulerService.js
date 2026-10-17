/* eslint-disable max-lines -- legacy scheduler service; split in a dedicated refactor. */
import { sessions, messages, conversations, projects, attachments } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as slashCommandService from './slashCommandService.js';
import { claimWorkflowSessionStart, withActiveLaneRunOwnership, activeLaneRunOwnsSession, closeOwnWork } from './workflowSessionService.js';
import { didSessionExecutionStart, rejectedSessionExecution, startedSessionExecution } from './sessionStartResult.js';
import { broadcastSessionStatus } from './streamEventHandler.js';
import { clearedPendingSchedule } from './pendingSchedule.js';
import { MIN_QUOTA_WAIT_MS, MAX_QUOTA_WAIT_MS } from './quotaResetHint.js';

/**
 * Resolve a quota-derived wait into a clamped schedule.
 * @param {{ resetsAt?: number, scheduledAt?: unknown } | undefined} quotaWait
 * @param {number} now - Epoch ms
 * @returns {{ scheduledAt: number, capped: boolean, resetsAt: unknown } | null}
 *   Null when no usable hint was provided (legacy path applies).
 */
function _resolveQuotaSchedule(quotaWait, now) {
  const scheduledAt = quotaWait && typeof quotaWait === 'object' ? quotaWait.scheduledAt : NaN;
  if (typeof scheduledAt !== 'number' || !Number.isFinite(scheduledAt)) return null;
  const capped = scheduledAt > now + MAX_QUOTA_WAIT_MS;
  return {
    scheduledAt: Math.min(Math.max(scheduledAt, now + MIN_QUOTA_WAIT_MS), now + MAX_QUOTA_WAIT_MS),
    capped,
    resetsAt: quotaWait.resetsAt,
  };
}

/**
 * Error text for a quota-wait reschedule. A quota-wait is a hold, not an
 * attempt, so the text never reuses the reschedule attempt counter (a first
 * wait would otherwise render the confusing "Rescheduled (0x)"). A
 * beyond-ceiling cap additionally names the known reset so the display
 * shows a distant wait instead of silent failure.
 */
function quotaRetryAtText(quotaSchedule) {
  return new Date(quotaSchedule.scheduledAt).toISOString();
}

function quotaCapNoteText(quotaSchedule) {
  return quotaSchedule.capped && Number.isFinite(quotaSchedule.resetsAt)
    ? `; capped, quota resets ${new Date(quotaSchedule.resetsAt).toISOString()}`
    : '';
}

function quotaWaitErrorText(reason, quotaSchedule) {
  return `Waiting on quota reset (${reason}, retry at ${quotaRetryAtText(quotaSchedule)}${quotaCapNoteText(quotaSchedule)})`;
}

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
    // Consecutive quota-waits per session (sessionId -> count). Quota-waits
    // never consume rescheduleCount, so the legacy count gate cannot bound
    // them — this streak is the bound. Reset on any legacy counted retry.
    this._consecutiveQuotaWaits = new Map();
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
      { systemPrompt: effectiveSystemPrompt, fileAttachments: sessionAttachments, model: session.pendingModel, interactive: Boolean(session.pendingInteractive) }
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
    const updated = sessions.update(session.id, {
      status: 'stopped', ...clearedPendingSchedule,
    });
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
    sessions.update(sessionId, {
      status: 'stopped', ...clearedPendingSchedule,
      error,
    });
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
        { systemPrompt: effectiveSystemPrompt, model: claimed.pendingModel, interactive: Boolean(claimed.pendingInteractive) }
      );
    }
    if (hasAssistantResponses) {
      return this.sessionManager.continueSession(
        claimed.id,
        effectivePrompt,
        workingDirectory,
        { systemPrompt: effectiveSystemPrompt, fileAttachments: sessionAttachments, model: claimed.pendingModel, interactive: Boolean(claimed.pendingInteractive) }
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
    if (claimed.laneRunId && !claimed.pendingInteractive && !activeLaneRunOwnsSession(claimed.id)) {
      return { claimed: true, ...this.finishScheduledStart(claimed, rejectedSessionExecution(claimed.id, 'lane_run_ownership_lost')) };
    }

    // Durable boundary: everything needed to launch has resolved
    // successfully, so it's now safe to clear the scheduling fields. Any
    // failure past this point is a normal in-flight turn failure, handled
    // by the existing turn error-handling path rather than by this method.
    sessions.update(claimed.id, clearedPendingSchedule);

    const startResult = await this._dispatchScheduledLaunch(claimed, launch);
    return this.scheduledStartResult(claimed, startResult);
  }

  /**
   * Record a refused reschedule (limits reached) on the session.
   * @param {string} sessionId - Session ID that was refused
   * @param {string} reason - Reason for rescheduling
   * @returns {boolean} Always false
   */
  _refuseReschedulePastLimits(sessionId, reason) {
    console.log(`[SchedulerService] Session ${sessionId} has reached reschedule limits`);
    sessions.update(sessionId, {
      status: 'error',
      error: `Reschedule limits reached. ${reason}`,
    });
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status: 'error' });
    return false;
  }

  /**
   * Record a consecutive quota-wait for the streak check in rescheduleSession.
   * Invariant: quota-waits never consume `rescheduleCount`, but consecutive
   * quota-waits are bounded by `maxRescheduleCount` so a session always
   * terminates. A `null` cap (explicit retry-forever) leaves quota-waits
   * uncapped, matching the operator's choice. The streak resets on any
   * legacy counted retry and on refusal.
   * @param {object} session - Session row (only `id` and `maxRescheduleCount` are read)
   * @returns {boolean} True when the streak passed the cap and the caller must refuse.
   */
  _recordQuotaWait(session) {
    const streak = (this._consecutiveQuotaWaits.get(session.id) || 0) + 1;
    this._consecutiveQuotaWaits.set(session.id, streak);
    return session.maxRescheduleCount !== null && streak > session.maxRescheduleCount;
  }

  /**
   * Reschedule a session with a delay
   * @param {string} sessionId - Session ID to reschedule
   * @param {string} reason - Reason for rescheduling
   * @param {{ retryExistingMessage?: boolean, conversationId?: string|null, interactive?: boolean, quotaWait?: { resetsAt: number, scheduledAt: number } }} [options]
   *   - retryExistingMessage: if true, retry the existing user message instead of sending "Continue"
   *   - conversationId: the active conversation to retry (required when retryExistingMessage is true)
   *   - quotaWait: quota-derived wait (`scheduledAt = resetsAt + buffer`, computed
   *     at the call site). When present and finite it is clamped to
   *     `[now + MIN_QUOTA_WAIT_MS, now + MAX_QUOTA_WAIT_MS]` and does not
   *     consume a reschedule attempt. Absent/malformed → legacy fixed-delay path.
   * @returns {boolean} True if rescheduled, false if limits reached
   */
  async rescheduleSession(sessionId, reason, { retryExistingMessage = false, conversationId = null, interactive = false, quotaWait = undefined } = {}) {
    const session = sessions.getById(sessionId);
    if (!session) {
      console.error(`[SchedulerService] Session not found: ${sessionId}`);
      return false;
    }

    const now = Date.now();
    const quotaSchedule = _resolveQuotaSchedule(quotaWait, now);

    if (quotaSchedule) {
      // Quota-waits are holds, not attempts: a fresh hint bypasses the
      // reschedule-count gate (hasReachedLimits is untouched so its contract
      // and tests are unchanged) while the token budget is still enforced.
      // The consecutive-quota-wait streak below is the termination backstop
      // for this path: without it a session with maxTotalTokens: null and
      // endlessly refreshed hints would hop every MAX_QUOTA_WAIT_MS forever.
      if (this.hasReachedLaunchBudget(session)) {
        return this._refuseReschedulePastLimits(sessionId, reason);
      }
      if (this._recordQuotaWait(session)) {
        this._consecutiveQuotaWaits.delete(sessionId);
        return this._refuseReschedulePastLimits(sessionId, reason);
      }
    } else {
      this._consecutiveQuotaWaits.delete(sessionId);
      if (this.hasReachedLimits(session)) {
        // Check reschedule limits
        return this._refuseReschedulePastLimits(sessionId, reason);
      }
    }

    const plan = this._resolveReschedulePlan(session, reason, quotaSchedule, now);
    const { pendingPrompt, pendingConversationId } = this._resolvePendingPrompt(sessionId, retryExistingMessage, conversationId);

    // Update session to scheduled status with new time and pendingPrompt
    const update = () => sessions.update(sessionId, {
      status: 'scheduled',
      scheduledAt: plan.scheduledAt,
      rescheduleCount: plan.rescheduleCount,
      pendingPrompt,
      pendingConversationId,
      pendingInteractive: interactive || Boolean(session.pendingInteractive),
      error: plan.error,
    });
    const updated = session.laneRunId && !interactive && !session.pendingInteractive
      ? withActiveLaneRunOwnership(sessionId, update) : update();
    if (!updated) return false;

    broadcastRescheduledSession(sessionId, updated);

    return true;
  }

  /**
   * Compute the schedule write for a reschedule: a quota-derived plan keeps
   * the attempt count and records the quota wait, otherwise the legacy
   * fixed-delay plan applies (increment + byte-identical legacy text).
   * @param {object} session - Session row
   * @param {string} reason - Reason for rescheduling
   * @param {{ scheduledAt: number, capped: boolean, resetsAt: unknown } | null} quotaSchedule
   * @param {number} now - Epoch ms
   * @returns {{ scheduledAt: number, rescheduleCount: number, error: string }}
   */
  _resolveReschedulePlan(session, reason, quotaSchedule, now) {
    if (quotaSchedule) {
      console.log(
        `[SchedulerService] Rescheduling session ${session.id} for quota reset at ${new Date(quotaSchedule.scheduledAt).toISOString()} (quota-wait, count unchanged at ${session.rescheduleCount})`
      );
      return {
        scheduledAt: quotaSchedule.scheduledAt,
        rescheduleCount: session.rescheduleCount,
        error: quotaWaitErrorText(reason, quotaSchedule),
      };
    }
    const scheduledAt = now + session.rescheduleDelayMinutes * 60 * 1000;
    const rescheduleCount = session.rescheduleCount + 1;
    console.log(
      `[SchedulerService] Rescheduling session ${session.id} for ${session.rescheduleDelayMinutes} minutes from now (attempt ${rescheduleCount})`
    );
    return { scheduledAt, rescheduleCount, error: `Rescheduled (${rescheduleCount}x): ${reason}` };
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
