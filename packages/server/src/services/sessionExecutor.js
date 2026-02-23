import { query } from '@anthropic-ai/claude-agent-sdk';
import { sessions } from '../database.js';
import { broadcastToSession, broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as summaryService from './summaryService.js';
import { checkAndTriggerNextTemplate } from './templateTriggerService.js';
import * as diffService from './diffService.js';
import { schedulerService } from './schedulerService.js';
import { shouldRescheduleOnError, _checkProactiveReschedule } from './errorRescheduler.js';
import { activeSessions, thinkingAccumulators, textAccumulators, currentModels, lastMessageIds } from './sessionState.js';
import { handleStreamEvent, associateAndBroadcastWorkLogs } from './streamEventRouter.js';
import { mockQuery } from './sessionMocks.js';
import { isMockMode } from './providerConfig.js';

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
    sessionId: sessionId,
    session: { ...session, nextTemplateId: null }
  });
}

/**
 * Broadcast session status update
 * @param {string} sessionId
 * @param {string} status
 */
export function broadcastSessionStatus(sessionId, status) {
  // Broadcast to session subscribers (for session detail view)
  broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_STATUS, { sessionId, status });

  // Also broadcast SESSION_UPDATED to project subscribers (for session list updates)
  const session = sessions.getById(sessionId);
  if (session) {
    broadcastToProject(session.projectId, WS_MESSAGE_TYPES.SESSION_UPDATED, {
      projectId: session.projectId,
      sessionId,
      session: { ...session, status },
    });
  }
}

/**
 * Compute and broadcast changes state when turn completes
 * Called after status is set to "waiting" to provide real-time changes update
 * @param {string} sessionId
 * @param {string} projectId
 * @param {string} workingDirectory
 */
async function broadcastChangesUpdate(sessionId, projectId, workingDirectory) {
  try {
    const changes = await diffService.getChanges(workingDirectory);
    const hasChanges = !!(changes.staged || changes.unstaged || changes.untracked);

    // Count total files with changes
    // Parse diff output to count unique files
    const parseFilesFromDiff = (diff) => {
      if (!diff) return 0;
      const matches = diff.match(/^diff --git a\/(.+) b\//gm) || [];
      return matches.length;
    };

    const stagedCount = parseFilesFromDiff(changes.staged);
    const unstagedCount = parseFilesFromDiff(changes.unstaged);
    const untrackedCount = parseFilesFromDiff(changes.untracked);
    const changeCount = stagedCount + unstagedCount + untrackedCount;

    // Broadcast to session subscribers
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.CHANGES_UPDATE, {
      sessionId,
      hasChanges,
      changeCount,
    });
  } catch (error) {
    // Silently fail - changes indicator is not critical
    // This handles cases like non-git directories or permission errors
    console.error(`Failed to compute changes for session ${sessionId}:`, error.message);
  }
}

/**
 * Shared session query execution loop.
 * Handles: stream iteration, work log association, post-completion logic, error handling, and cleanup.
 *
 * @param {Object} params
 * @param {string} params.sessionId
 * @param {string} params.workingDirectory
 * @param {AbortController} params.controller
 * @param {Object} params.queryParams - Parameters for the query function
 * @param {string} params.errorLabel - Label for error logging (e.g. 'Session error', 'Continue session error')
 */
export async function executeSessionQuery({ sessionId, workingDirectory, controller, queryParams, errorLabel }) {
  try {
    const queryFn = isMockMode() ? mockQuery : query;

    for await (const event of queryFn(queryParams)) {
      if (controller.signal.aborted) break;
      await handleStreamEvent(sessionId, event);
    }

    // Associate work logs with the last message now that the turn is complete
    const lastMessageId = lastMessageIds.get(sessionId);
    if (lastMessageId) {
      associateAndBroadcastWorkLogs(sessionId, lastMessageId);
      lastMessageIds.delete(sessionId);
    }

    // Session ready for follow-up - set to waiting instead of completed
    const activeSession = activeSessions.get(sessionId);
    if (activeSession && !controller.signal.aborted) {
      sessions.update(sessionId, { status: 'waiting' });
      broadcastSessionStatus(sessionId, 'waiting');

      // Check if session should be proactively rescheduled based on token threshold
      const wasRescheduled = await _checkProactiveReschedule(sessionId);
      if (wasRescheduled) {
        return; // Session was rescheduled, don't continue with normal completion
      }

      // Extract PR URL immediately (lightweight, no API call)
      summaryService.extractPrUrlIfNeeded(sessionId);
      // Trigger summary generation when session completes a turn
      summaryService.onSessionComplete(sessionId);

      // Broadcast changes update when turn completes (real-time indicator)
      const currentSession = sessions.getById(sessionId);
      if (currentSession) {
        await broadcastChangesUpdate(sessionId, currentSession.projectId, workingDirectory);
      }

      // Check if template should be triggered after turn completion
      await handleTemplateTriggerIfNeeded(sessionId);
    }
  } catch (error) {
    console.error(`${errorLabel}:`, error);
    console.error('Error stack:', error.stack);
    if (!controller.signal.aborted) {
      // Check if we should reschedule instead of marking as error
      const session = sessions.getById(sessionId);
      if (session && shouldRescheduleOnError(session, error, sessionId)) {
        const rescheduled = await schedulerService.rescheduleSession(sessionId, error.message);
        if (rescheduled) {
          console.log(`[SessionManager] Session ${sessionId} rescheduled due to error`);
          // Don't throw error or set error status - session is rescheduled
          return;
        }
        // If rescheduling failed (limits reached), fall through to error handling
      }

      // Normal error handling (no reschedule or reschedule limits reached)
      sessions.update(sessionId, { status: 'error', error: error.message });
      broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_ERROR, { sessionId, error: error.message });
      // Trigger summary generation on error
      summaryService.onSessionComplete(sessionId);
    }
    throw error;
  } finally {
    textAccumulators.delete(sessionId);
    thinkingAccumulators.delete(sessionId);
    currentModels.delete(sessionId);
    activeSessions.delete(sessionId);
  }
}
