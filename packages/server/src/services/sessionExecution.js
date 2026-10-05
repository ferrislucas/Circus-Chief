import { sessions } from '../database.js';
export { buildAgentEnv } from './sessionAgentConfig.js';
export { buildQueryParams } from './queryParamBuilder.js';
// createAgentForSession moved to sessionTurnSetup.js; re-exported here so
// existing importers (sessionManager, tests) keep working.
export { createAgentForSession } from './sessionTurnSetup.js';
import {
  handleStreamEvent, handleTurnCompletion,
  handleSessionError, cleanupSessionState,
} from './streamEventHandler.js';
import { prepareContinueTurn, prepareRunTurn } from './sessionTurnSetup.js';
import { shouldRescheduleOnError, _checkProactiveReschedule } from './sessionErrors.js';
import { schedulerService } from './schedulerService.js';
import { beginWorkflowTurn, finalizeOwnWorkCompletion, finishWorkflowTurn, closeOwnWork, markExecutionState, markHeldForLimit, pauseForUserStop, activeLaneRunOwnsSession } from './workflowSessionService.js';
import { rejectedSessionExecution, startedSessionExecution } from './sessionStartResult.js';
import { isUserStopAbort } from './sessionAbort.js';
// W6: real cycle (kanbanService -> kanbanTriggers -> sessionManager ->
// sessionExecution), safe because this is only called at runtime inside
// _executeSession, long after the module graph is loaded (same pattern as
// session-helpers.js's database.js <-> SessionRepository cycle).
import { drainLaneEntryTrigger } from './kanbanService.js';
/** Execute the agent stream loop and handle post-turn completion, errors, and cleanup.
 * This is the shared core of runSession, continueSession, and continueSessionWithExistingMessage.
 * @param {Object} options
 * @param {string} options.sessionId - Session ID
 * @param {Object} options.agent - Agent instance with execute() method
 * @param {Object} options.queryParams - Query parameters for agent.execute()
 * @param {Object} options.agentCallMeta - Logging metadata for agent call tracking
 * @param {AbortController} options.controller - Abort controller
 * @param {string} options.workingDirectory - Session working directory
 * @param {Object} options.callbacks - Callback functions passed from sessionManager
 * @param {Function} options.callbacks.handleTemplateTriggerIfNeeded - Template trigger handler
 * @param {Function} options.callbacks.handleAutoSendIfNeeded - Auto-send handler
 * @param {Function} [options.callbacks.onUserStopSettled] - Fired after a user-stopped
 *   provider generator has settled (confirmed provider exit), e.g. to trigger
 *   summary generation without racing still-arriving output.
 * @param {boolean} [options.broadcastConversationStateOnError] - Whether to broadcast conversation state on error
 * @param {string} [options.errorLabel] - Label for error logging
 */
// eslint-disable-next-line max-statements, max-lines-per-function, complexity, sonarjs/cognitive-complexity -- lifecycle boundaries must remain adjacent.
export async function _executeSession({
  sessionId,
  agent,
  queryParams,
  agentCallMeta,
  controller,
  workingDirectory,
  callbacks,
  broadcastConversationStateOnError = false,
  cleanupConversationId = false, interactive = false,
  errorLabel = 'Session error',
}) {
  const { handleTemplateTriggerIfNeeded, handleAutoSendIfNeeded, onUserStopSettled } = callbacks;
  const notifyUserStopSettled = () => {
    // The provider generator has settled at every call site below (the
    // for-await loop only exits once the adapter iterator has finished, and a
    // `break` awaits its return()), so this is confirmed provider exit — the
    // only moment a summary may safely read the turn's output.
    try { onUserStopSettled?.(sessionId); } catch (error) {
      console.error(`[SessionManager] onUserStopSettled failed for session ${sessionId}:`, error?.message || error);
    }
  };
  const workflowTurn = beginWorkflowTurn(sessionId);
  // Last ownership fence before the irreversible provider call.
  if (!interactive && !workflowTurn && !activeLaneRunOwnsSession(sessionId)) {
    cleanupSessionState(sessionId, cleanupConversationId, controller);
    return rejectedSessionExecution(sessionId, 'lane_run_ownership_lost');
  }
  // The provider is about to start. The token is generated durably by
  // beginWorkflowTurn and lets the agent's card-move API identify this exact
  // execution, not merely this reusable session row.
  const providerQueryParams = workflowTurn?.turnToken && queryParams?.options?.env
    ? {
      ...queryParams,
      options: {
        ...queryParams.options,
        env: {
          ...queryParams.options.env,
          CIRCUSCHIEF_WORKFLOW_TURN_TOKEN: workflowTurn.turnToken,
        },
      },
    }
    : queryParams;
  try {
    // Run the query with the agent (SDK via gateway, or mock).
    // This loop is the ownership barrier's settlement point: it only exits
    // once the provider's async generator has finished, so the `finally`
    // below (the sole ownership-release point) cannot run while the provider
    // still holds its native session.
    for await (const event of agent.execute(providerQueryParams, agentCallMeta)) {
      if (controller.signal.aborted) break;
      // Thread the turn's session env so tool-input/tool-output scrubbing
      // (finding #1) can redact provider-supplied secret values.
      await handleStreamEvent(sessionId, event, { controller, env: providerQueryParams?.options?.env });
    }
    if (controller.signal.aborted) {
      if (isUserStopAbort(controller)) {
        pauseForUserStop(sessionId, { turnToken: workflowTurn?.turnToken });
        notifyUserStopSettled();
        return;
      }
      throw controller.signal.reason || new Error('Session execution was aborted');
    }
    // Handle post-turn completion (work log association, status transition, summary, etc.)
    const { wasRescheduled, heldForLimit, terminalError } = await handleTurnCompletion(
      sessionId,
      workingDirectory,
      { handleTemplateTriggerIfNeeded, checkProactiveReschedule: _checkProactiveReschedule, handleAutoSendIfNeeded },
      { controller },
    );
  // A stop invalidates the completion pipeline; stale work must not close the paused obligation.
    if (controller.signal.aborted) {
      if (isUserStopAbort(controller)) {
        pauseForUserStop(sessionId, { turnToken: workflowTurn?.turnToken });
        notifyUserStopSettled();
        return;
      }
      throw controller.signal.reason || new Error('Session execution was aborted');
    }
    // Some providers report terminal failures as a final stream event and then
    // close their generator normally. Route that outcome through the same retry
    // policy as a rejected execute() call; otherwise the normal completion path
    // would incorrectly close the workflow obligation as successful.
    if (terminalError) {
      const rescheduled = await handleSessionError(sessionId, terminalError, {
        controller,
        shouldRescheduleOnError,
        schedulerService,
        broadcastConversationState: broadcastConversationStateOnError,
        errorLabel,
        handleTemplateTriggerIfNeeded,
        errorAlreadyRecorded: true,
        interactive,
      });
      if (rescheduled) {
        markExecutionState(sessionId, 'retrying');
        return;
      }
      closeOwnWork(sessionId, 'closed_failed', terminalError.message, {
        turnToken: workflowTurn?.turnToken,
      });
      return;
    }
    // FR-4/FR-5: a self-scheduled continuation is an open obligation, not success.
    if (wasRescheduled) {
      markExecutionState(sessionId, 'scheduled');
      return;
    }
    // FR-9.8: a graceful provider limit/outage leaves the lane obligation open.
    if (heldForLimit) {
      markHeldForLimit(sessionId);
      return;
    }
    // W6/FR-8: finish target-lane automation after a successful, non-continuing turn.
    if (interactive && workflowTurn?.executionStateBeforeTurn !== 'paused') {
      finishWorkflowTurn(sessionId, workflowTurn?.turnToken);
      return;
    }
    const reconciled = finalizeOwnWorkCompletion(sessionId, { turnToken: workflowTurn?.turnToken });
    // The successor run can be committed by finalization, but it is never
    // dispatched until this provider has genuinely returned and this turn has
    // relinquished its running lifecycle state.
    finishWorkflowTurn(sessionId, workflowTurn?.turnToken);
    if (reconciled?.pendingTargetLaneTrigger) await drainLaneEntryTrigger(reconciled.pendingTargetLaneTrigger.laneEntryEventId);
  } catch (error) {
    const rescheduled = await handleSessionError(sessionId, error, {
      controller,
      shouldRescheduleOnError,
      schedulerService,
      broadcastConversationState: broadcastConversationStateOnError,
      errorLabel,
      handleTemplateTriggerIfNeeded,
      interactive,
    });
    if (rescheduled) {
      // FR-9.1/FR-9.5: a transient error with an automatic retry/reschedule
      // keeps the session (and its lane run) open — only the execution_state
      // dimension moves, own_work_state is untouched.
      markExecutionState(sessionId, 'retrying');
      return; // Don't throw - session was rescheduled
    }
    // User aborts pause the obligation; permanent errors terminally fail it.
    if (isUserStopAbort(controller)) {
      pauseForUserStop(sessionId, { turnToken: workflowTurn?.turnToken });
      notifyUserStopSettled();
    } else {
      closeOwnWork(sessionId, 'closed_failed', error.message, { turnToken: workflowTurn?.turnToken });
    }
    throw error;
  } finally {
    // Sole ownership-release point: runs only after the provider generator
    // above has settled, and only clears this turn's own entry (controller
    // fence). A replacement turn can never be admitted before this runs.
    cleanupSessionState(sessionId, cleanupConversationId, controller);
  }
}
/**
 * Continue a session with a follow-up message (core implementation)
 * @param {string} sessionId
 * @param {string} content
 * @param {string} workingDirectory
 * @param {Object} config - Session options and callbacks
 * @param {Object} [config.options] - Session options (systemPrompt, fileAttachments, model)
 * @param {Object} config.callbacks - Callback functions from sessionManager
 */
export async function continueSessionCore(sessionId, content, workingDirectory, config = {}) {
  const { options = {}, callbacks } = config;
  const { interactive = false } = options;
  // Get the session to retrieve the Claude session ID and settings
  const session = sessions.getById(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }
  // A closed lane run only blocks system-owned work. Human follow-ups must
  // remain available after a workflow completes or a card is manually moved.
  if (!interactive && session.laneRunId && !activeLaneRunOwnsSession(sessionId)) {
    return rejectedSessionExecution(sessionId, 'lane_run_ownership_lost');
  }

  const controller = new AbortController();
  const { queryParams, agentCallMeta, agent } = await prepareContinueTurn({
    session, sessionId, content, workingDirectory, options, controller,
  });
  const execution = await _executeSession({
    sessionId,
    agent,
    queryParams,
    agentCallMeta,
    controller,
    workingDirectory,
    callbacks,
    broadcastConversationStateOnError: true,
    cleanupConversationId: true,
    interactive,
    errorLabel: 'Continue session error',
  });
  return execution || startedSessionExecution(sessionId);
}

/**
 * Run a Claude session (initial session start)
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {Object} config - Session options and callbacks
 * @param {Object} [config.options] - Session options (systemPrompt, fileAttachments, model)
 * @param {Object} config.callbacks - Callback functions from sessionManager
 */
export async function runSessionCore(sessionId, prompt, workingDirectory, config = {}) {
  const { options = {}, callbacks } = config;
  const { interactive = false, abortController = null } = options;
  // Get session for settings
  const session = sessions.getById(sessionId);
  if (!session) throw new Error('Session not found');
  if (!interactive && session.laneRunId && !activeLaneRunOwnsSession(sessionId)) {
    return rejectedSessionExecution(sessionId, 'lane_run_ownership_lost');
  }
  const controller = abortController || new AbortController();
  if (controller.signal.aborted) return rejectedSessionExecution(sessionId, 'dispatch_aborted');
  const { queryParams, agentCallMeta, agent } = await prepareRunTurn({
    session, sessionId, prompt, workingDirectory, options, controller,
  });

  return _executeSession({
    sessionId,
    agent,
    queryParams,
    agentCallMeta,
    controller,
    workingDirectory,
    callbacks,
    errorLabel: 'Session error',
  }).then((execution) => execution || startedSessionExecution(sessionId));
}
