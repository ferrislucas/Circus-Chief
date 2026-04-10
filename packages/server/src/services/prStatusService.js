import { sessions, sessionSummaries } from '../database.js';
import { webSocketManager, broadcastToSession } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import * as ghService from './ghService.js';

// Default polling interval in milliseconds (1 minute)
const DEFAULT_POLL_INTERVAL_MS = 60000;

// PR states that don't need further polling (PR is done)
const FINAL_PR_STATES = ['merged', 'closed'];

// Session states that should have their PRs polled (allowlist for future-proofing)
// Includes stopped because CI may still be running after session ends
// When 'archived' is added, it won't be in this list
const POLLABLE_SESSION_STATES = ['running', 'waiting', 'stopped'];

// Time-based filtering constants
// Sessions updated within this time are polled regardless of subscribers
const RECENT_ACTIVITY_MS = 2 * 60 * 60 * 1000; // 2 hours
// Maximum age for polling sessions (even with pending CI)
const MAX_POLL_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// Polling interval handle
let pollIntervalId = null;

/**
 * Start the PR status polling service
 */
export function start() {
  if (pollIntervalId) {
    console.log('[PrStatusService] Already running');
    return;
  }

  console.log('[PrStatusService] Starting PR status polling');
  pollIntervalId = setInterval(pollLoop, DEFAULT_POLL_INTERVAL_MS);

  // Run immediately on start
  pollLoop();
}

/**
 * Stop the PR status polling service
 */
export function stop() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
    console.log('[PrStatusService] Stopped PR status polling');
  }
}

/**
 * Get all sessions with PRs that should be checked
 * Uses time-based filtering to poll recently active sessions without requiring subscribers
 * @returns {Array<{sessionId: string, prUrl: string}>}
 */
export function getSessionsToCheck() {
  // Get all sessions that have PR URLs
  const sessionsWithPrs = sessions.getSessionsWithPrUrls();
  const subscriptions = webSocketManager.getSessionSubscriptions();
  const now = Date.now();
  const result = [];

  for (const session of sessionsWithPrs) {
    // Skip if session is not in a pollable state (future-proofs for 'archived')
    if (!POLLABLE_SESSION_STATES.includes(session.status)) continue;

    // Skip if PR is in a final state (merged/closed)
    const summary = sessionSummaries.getBySessionId(session.id);
    if (summary?.prState && FINAL_PR_STATES.includes(summary.prState)) continue;

    // Calculate session age based on updatedAt
    const sessionAge = now - new Date(session.updatedAt).getTime();
    const hasSubscribers = subscriptions.get(session.id)?.size > 0;

    // Always poll sessions with active subscribers
    if (hasSubscribers) {
      result.push({ sessionId: session.id, prUrl: session.prUrl });
      continue;
    }

    // Skip sessions older than max poll age
    if (sessionAge > MAX_POLL_AGE_MS) continue;

    // For sessions within recent activity window, poll without subscribers
    if (sessionAge <= RECENT_ACTIVITY_MS) {
      result.push({ sessionId: session.id, prUrl: session.prUrl });
      continue;
    }

    // For older sessions without subscribers, only poll if CI is pending
    if (summary?.ciStatus === 'pending') {
      result.push({ sessionId: session.id, prUrl: session.prUrl });
    }
  }

  return result;
}

/**
 * Immediately check CI status for a specific session
 * Used for on-demand checks when a session completes or PR URL is set
 * @param {string} sessionId
 * @returns {Promise<boolean>} Whether status was updated
 */
export async function checkSessionCiStatusNow(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session?.prUrl) return false;
  return checkPrStatus(sessionId, session.prUrl);
}

/**
 * Normalize boolean values for comparison (handles null/undefined/false equivalence)
 * SQLite stores booleans as 0/1, and the repository maps 0 to null in some cases.
 * This ensures null, undefined, and false are all treated as equivalent.
 * @param {boolean|null|undefined} value
 * @returns {boolean}
 */
function normalizeBool(value) {
  return Boolean(value);
}

/**
 * Check and update PR status for a single session
 * @param {string} sessionId
 * @param {string} prUrl
 * @returns {Promise<boolean>} Whether status was updated
 */
export async function checkPrStatus(sessionId, prUrl) {
  try {
    const prInfo = await ghService.getPrInfo(prUrl);
    if (!prInfo) return false;

    const currentSummary = sessionSummaries.getBySessionId(sessionId);

    // Check if anything changed
    // Note: Use normalizeBool for boolean fields because SQLite stores 0/1 and
    // the repository maps 0 to null, so we need to treat null/false as equivalent
    const hasChanged =
      currentSummary?.prState !== prInfo.state ||
      normalizeBool(currentSummary?.prMerged) !== normalizeBool(prInfo.merged) ||
      normalizeBool(currentSummary?.hasMergeConflicts) !== normalizeBool(prInfo.hasMergeConflicts) ||
      currentSummary?.ciStatus !== prInfo.ciStatus ||
      JSON.stringify(currentSummary?.ciFailures || []) !== JSON.stringify(prInfo.ciFailures || []);

    if (!hasChanged) return false;

    // Build update data
    const updateData = {
      prState: prInfo.state,
      prMerged: prInfo.merged,
      hasMergeConflicts: prInfo.hasMergeConflicts,
      ciStatus: prInfo.ciStatus,
      ciFailures: prInfo.ciFailures,
    };

    // Don't create a summary just for PR tracking - only track if summary already exists
    if (!currentSummary) {
      return false;
    }

    // Update database
    const updatedSummary = sessionSummaries.upsert(sessionId, updateData);

    // Broadcast change
    broadcastToSession(sessionId, WS_MESSAGE_TYPES.SESSION_SUMMARY_UPDATED, {
      sessionId,
      summary: updatedSummary,
    });

    console.log(`[PrStatusService] Updated PR status for session ${sessionId}: ${prInfo.state}`);
    return true;
  } catch (error) {
    console.error(`[PrStatusService] Error checking PR for session ${sessionId}:`, error.message);
    return false;
  }
}

/**
 * Main polling loop - called every interval
 */
async function pollLoop() {
  const sessionsToCheck = getSessionsToCheck();

  if (sessionsToCheck.length === 0) return;

  console.log(`[PrStatusService] Checking ${sessionsToCheck.length} session(s) with PRs`);

  // Check sequentially to avoid hammering GitHub API
  for (const { sessionId, prUrl } of sessionsToCheck) {
    await checkPrStatus(sessionId, prUrl);
  }
}

// Export for testing
export {
  DEFAULT_POLL_INTERVAL_MS,
  FINAL_PR_STATES,
  POLLABLE_SESSION_STATES,
  RECENT_ACTIVITY_MS,
  MAX_POLL_AGE_MS,
  pollLoop,
};
