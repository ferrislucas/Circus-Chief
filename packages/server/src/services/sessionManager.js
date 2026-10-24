import { sessions, projects } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import * as summaryService from './summaryService.js';
import { checkAndTriggerNextTemplate } from './templateTriggerService.js';

import { pauseForUserStop, releaseLaneSlotForUserStop } from './workflowSessionService.js';
import { clearedPendingSchedule } from './pendingSchedule.js';
import {
  shouldRescheduleOnError,
  _checkProactiveReschedule,
  matchesTokenLimitError,
  matchesServiceError,
} from './sessionErrors.js';
import {
  buildSystemPromptConfig,
  PLAN_MODE_PROMPT,
  getPermissionModeForSession,
  getSessionAttachmentsContext,
  buildPromptWithAttachments,
} from './sessionPrompts.js';
import { getApiBaseUrl } from './apiBaseUrl.js';
import {
  cleanupSessionState,
  broadcastSessionStatus,
} from './streamEventHandler.js';
import {
  activeSessions,
  markSessionStopping,
} from './sessionExecutionOwnership.js';
import { cancelPrompt } from './promptStore.js';
import { clearPendingWakeup } from './scheduleWakeupBridge.js';
import { abortForUserStop } from './sessionAbort.js';
import { clearTierAttemptMember } from './tierMemberPin.js';
// Import execution helpers from sessionExecution.js
import {
  runSessionCore,
  continueSessionCore,
} from './sessionExecution.js';

// Re-export prompt-related functions for backward compatibility
export { buildSystemPromptConfig, PLAN_MODE_PROMPT, getPermissionModeForSession, getSessionAttachmentsContext, buildPromptWithAttachments, getApiBaseUrl };

// Re-export error detection and rescheduling functions for backward compatibility
export { shouldRescheduleOnError, _checkProactiveReschedule, matchesTokenLimitError, matchesServiceError };

/**
 * Handle template triggering if a session has a nextTemplateId configured
 * Called after Claude finishes any turn (runSession or continueSession)
 * @param {string} sessionId
 */
async function handleTemplateTriggerIfNeeded(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.nextTemplateId) {
    return;
  }

  // Wait for summary to be generated (templates use summary data)
  await summaryService.generateSummaryNow(sessionId);

  // Trigger the template to create a new session
  await checkAndTriggerNextTemplate(sessionId);

  // Clear the template from the session (it's been triggered)
  sessions.update(sessionId, { nextTemplateId: null });

  // Broadcast the update so UI reflects the cleared template
  broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    projectId: session.projectId,
    sessionId,
    session: { ...session, nextTemplateId: null }
  });
}

/**
 * Auto-send queued prompt if enabled after a model turn completes.
 * Exported for unit testing (same pattern as _checkProactiveReschedule).
 * @param {string} sessionId
 */
export async function handleAutoSendIfNeeded(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.autoSendPendingPrompt || !session.pendingPrompt) {
    return false;
  }

  // Clear the auto-send flag and pending prompt BEFORE sending
  // to prevent double-sends on race conditions. The queued model/provider
  // pair is captured and cleared together: the continuation below dispatches
  // the exact pair (finding #4), and clearing both halves keeps a consumed
  // identity from leaking into a later turn.
  const promptToSend = session.pendingPrompt;
  const modelToUse = session.pendingModel || null;
  const providerToUse = session.pendingProviderId || null;
  const updatedSession = sessions.update(sessionId, {
    autoSendPendingPrompt: false,
    pendingPrompt: null,
    pendingModel: null,
    pendingProviderId: null,
  });

  // Broadcast the cleared state so the UI updates
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
    sessionId,
    session: updatedSession,
  });

  // Re-check status — template trigger may have changed it
  const currentSession = sessions.getById(sessionId);
  if (currentSession?.status !== 'waiting') {
    return true;
  }

  // Clean up the current session's active state before calling continueSession.
  // handleAutoSendIfNeeded runs inside _executeSession's try block, so the session
  // is still in activeSessions. continueSession guards against this with
  // "Session is already processing". Cleaning up here is safe because:
  // 1. The agent stream has already ended
  // 2. cleanupSessionState just deletes Map entries (all idempotent)
  // 3. The finally block's redundant call is a harmless no-op
  cleanupSessionState(sessionId);

  // Finding 11: the originating attempt is complete — retire its tier-attempt
  // registration BEFORE the continuation dispatches. Otherwise the
  // continuation's durable activity still finds the stale member registered
  // and pins the new tier binding to the previous member, and the outer
  // success snapshot overwrites the continuation's identity on unwind.
  clearTierAttemptMember(sessionId);

  // Send the queued prompt (reuses existing continueSession logic)
  try {
    const project = projects.getById(session.projectId);
    const systemPrompt = project?.systemPrompt || null;
    await continueSession(sessionId, promptToSend, session.gitWorktree || project?.workingDirectory, { systemPrompt, model: modelToUse, providerId: providerToUse });
  } catch (error) {
    console.error(`[AUTO-SEND] Failed to auto-send for session ${sessionId}:`, error);
  }
  return true;
}

// buildQueryParams and _executeSession moved to sessionExecution.js

/**
 * Run a Claude session
 * @param {string} sessionId
 * @param {string} prompt
 * @param {string} workingDirectory
 * @param {{ systemPrompt?: string|null, fileAttachments?: Array, model?: string|null }} options - Optional parameters
 */
/**
 * Callbacks shared by every execution entry point. `onUserStopSettled` fires
 * only after a user-stopped provider generator has settled, so summary
 * generation can never race output still arriving from the aborted provider.
 */
function executionCallbacks() {
  return {
    handleTemplateTriggerIfNeeded,
    handleAutoSendIfNeeded,
    onUserStopSettled: (settledSessionId) => summaryService.onSessionComplete(settledSessionId),
  };
}

export async function runSession(sessionId, prompt, workingDirectory, options = {}) {
  // Delegate to sessionExecution.js, passing callbacks to avoid circular imports
  return runSessionCore(sessionId, prompt, workingDirectory, {
    options,
    callbacks: executionCallbacks(),
  });
}

/**
 * Continue a session with a follow-up message
 * @param {string} sessionId
 * @param {string} content
 * @param {string} workingDirectory
 * @param {{ systemPrompt?: string|null, fileAttachments?: Array, model?: string|null }} options - Optional parameters
 */
export async function continueSession(sessionId, content, workingDirectory, options = {}) {
  // Delegate to sessionExecution.js, passing callbacks to avoid circular imports
  return continueSessionCore(sessionId, content, workingDirectory, {
    options,
    callbacks: executionCallbacks(),
  });
}

/** Whether a provider turn still owns this session's execution lifecycle. */
export function isSessionActive(sessionId) {
  return activeSessions.has(sessionId);
}

/**
 * Continue a session when the user message is already stored (e.g., from branching)
 * This triggers Claude's response without creating a new user message
 * @param {string} sessionId
 * @param {string} conversationId - The conversation to continue (must have an existing user message)
 * @param {string} workingDirectory
 * @param {{ systemPrompt?: string|null, model?: string|null }} options - Optional parameters
 */
/**
 * Validate and fetch the session, conversation, and last user message for continuing a session.
 * @returns {{ session: Object, conversation: Object, lastUserMessage: Object }}
 */
/**
 * Resolve the effective model, provider, and session env from a model override.
 * Detects model changes and updates the session record when needed.
 *
 * Defense in depth: when a new model arrives and the session has no assistant
 * messages yet (i.e. it is still effectively a draft), re-derive agent_type
 * and persist it together with model. Once the session has produced at least
 * one assistant message we MUST NOT mutate agent_type — that would corrupt
 * resume/context state across kinds.
 *
 * Tier-ref handling (Fix 2): delegates to the shared `resolveTierRefForContinue`
 * helper (also used by `sessionContinuation.buildContinueModelAndEnv`) so both
 * continuation paths share ONE tier-ref resolution/persistence contract.
 * Switching from one bound tier to a different one always resolves the NEW
 * tier live rather than reusing a snapshot captured for the old one, and an
 * explicit concrete-model override always clears any stored tier snapshot.
 *
 * @param {Object} session - Current session object
 * @param {string} sessionId - Session ID
 * @param {string|null} model - Requested model (null to keep current)
 * @returns {{ effectiveModel: string|null, sessionEnv: Object, modelChanged: boolean, session: Object }}
 */
export async function continueSessionWithExistingMessage(sessionId, conversationId, workingDirectory, options = {}) {
  // Branch-continue orchestration (resolution, prompt building, the §5.2
  // same-turn retry) lives in sessionBranchContinue.js, resolved lazily per
  // turn: that module imports sessionExecution.js, which is reachable from
  // here through `kanbanService -> kanbanTriggers -> sessionManager`, so a
  // static edge back would close that cycle (see the
  // `triggerStructuredTransitionAutomation` docs in kanbanService.js).
  const { continueSessionWithExistingMessage: runBranchContinue } = await import('./sessionBranchContinue.js');
  return runBranchContinue(sessionId, conversationId, workingDirectory, {
    options,
    callbacks: executionCallbacks(),
  });
}

/**
 * Stop a running or waiting session
 * @param {string} sessionId
 */
export async function stopSession(sessionId) {
  cancelPrompt(sessionId);
  const sessionData = activeSessions.get(sessionId);
  // A live execution owns the session until its own finalizer releases it —
  // even across a user Stop. The entry is marked `stopping` (never deleted
  // here) so a Continue issued while the provider is still shutting down is
  // rejected instead of starting a second provider execution against the same
  // native session.
  const hadActiveExecution = Boolean(sessionData);

  if (sessionData) {
    // Session is actively processing - abort it
    abortForUserStop(sessionData.controller);
    clearPendingWakeup(sessionId, sessionData.controller);
    markSessionStopping(sessionId, sessionData.controller);
    console.warn(
      `[sessionManager] stop requested for session ${sessionId}; provider shutdown pending (phase=stopping)`
    );
  }
  // If not in activeSessions, session may have crashed or be waiting
  // Either way, we can still update the status to stopped

  // A user-initiated stop must also cancel any pending scheduled continuation.
  // Otherwise handleScheduledContinuationIfNeeded's status-agnostic predicate
  // (deliberately unguarded, see its doc comment) will resurrect the schedule on
  // the next completed chat turn — flipping the session back to 'scheduled',
  // suppressing auto-send/template triggers for that turn, and firing a prompt
  // the user believed they had cancelled.
  sessions.update(sessionId, {
    status: 'stopped',
    ...clearedPendingSchedule,
  });
  broadcastSessionStatus(sessionId, 'stopped');

  // A user stop pauses an active structured-lane obligation rather than
  // cancelling it. Non-participating and already-closed sessions are no-ops.
  pauseForUserStop(sessionId);
  // ...except in a concurrency-limited lane, where the paused open run would
  // hold its slot forever (FR-9): the explicit stop terminally releases it so
  // the next queued card starts. Unlimited lanes keep the resumable pause.
  releaseLaneSlotForUserStop(sessionId);

  if (!hadActiveExecution) {
    // No provider turn is unwinding, so the session is truly complete now.
    summaryService.onSessionComplete(sessionId);
  }
  // Otherwise summary generation is deferred to the user-stop settlement path
  // in _executeSession, which fires only after the provider generator has
  // settled — summaries must never race output still arriving from the
  // aborted provider.
}

/**
 * Restart a completed or errored session (set back to stopped so it can receive messages)
 * @param {string} sessionId
 */
export function restartSession(sessionId) {
  // Clear any error and set status to stopped (allows sending new messages)
  sessions.update(sessionId, { status: 'stopped', error: null });
  broadcastSessionStatus(sessionId, 'stopped');
}

/**
 * Clean up an active session before deletion
 *
 * Unlike stopSession(), this path also deletes the session row immediately
 * after, so no replacement turn can ever be admitted — admission requires
 * the row to exist. The entry is therefore dropped (rather than marked
 * `stopping`) so the still-unwinding provider turn cannot write work
 * logs/messages against the deleted row; its late events are discarded by
 * the missing-entry guard in handleStreamEvent, and its finalizer becomes a
 * harmless no-op. A bounded asynchronous deletion (await a termination grace
 * period, then answer 409/202 while shutdown is pending) remains follow-up
 * work; it needs an async delete route the current sync call chain cannot
 * provide.
 * @param {string} sessionId
 * @returns {boolean} true if session was active and cleaned up
 */
export function cleanupActiveSession(sessionId) {
  const sessionData = activeSessions.get(sessionId);
  if (sessionData) {
    cancelPrompt(sessionId);
    sessionData.controller.abort();
    clearPendingWakeup(sessionId, sessionData.controller);
    activeSessions.delete(sessionId);
    return true;
  }
  return false;
}
