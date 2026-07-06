import { sessions, messages } from '../database.js';
import { schedulerService } from './schedulerService.js';
import { isTierRef } from '@circuschief/shared';
import { hasNextHealthyMember } from './tierResolutionService.js';
import { sessionHasNoAssistantMessages } from './sessionAgentGuard.js';

/**
 * Check if error message matches token limit patterns.
 *
 * Intentionally broad: the patterns below also catch generic non-quota phrases
 * such as "limit", "cap", and "exceeded". This breadth is a deliberate choice
 * for auto-reschedule decisions — we prefer false-positive reschedules (retrying
 * a session that could have continued) over false-negative ones (not retrying
 * when we should).
 *
 * Note: do NOT use this function for start-time tier failover eligibility — it
 * is too broad and can match non-quota errors like "Unexpected token in JSON".
 * Use matchesStartFailoverEligibleError instead (Fix 4 / F16).
 *
 * @param {string} message - Error message to check (should be lowercased by caller)
 * @returns {boolean} True if matches token limit error
 */
export function matchesTokenLimitError(message) {
  const patterns = [
    'token',
    'context length',
    'max_tokens',
    'context window',
    'limit',           // catches "You've hit your limit"
    'quota',
    'rate limit',
    'exceeded',        // catches usage exceeded messages
    'cap',             // catches usage cap messages
  ];

  return patterns.some(pattern => message.includes(pattern));
}

/**
 * Check if an error qualifies for start-time tier failover (Fix 4 / F16).
 *
 * Uses a tighter pattern set than matchesTokenLimitError to avoid spurious
 * cross-provider failover on non-quota errors (e.g. "Unexpected token in JSON"
 * contains "token" but is a JSON parse error, not a capacity error).
 *
 * Covers the PRD-specified triggers: overload / 503 / 529 / rate limit / quota /
 * out of tokens / insufficient credit / billing — plus the matchesServiceError
 * patterns (service unavailability) which are already tight.
 *
 * Prompt-size errors (context length / context window / max_tokens) are
 * intentionally excluded: an oversized prompt is not an outage or quota
 * exhaustion, so failing over to another provider won't fix it and can mask
 * a real prompt-size bug by silently bouncing across providers. These stay
 * covered by matchesTokenLimitError for the broader auto-reschedule decision.
 *
 * @param {string} message - Error message to check (should be lowercased by caller)
 * @returns {boolean} True if the error should trigger start-time tier failover
 */
export function matchesStartFailoverEligibleError(message) {
  // Delegate to matchesServiceError for service-level outage patterns
  if (matchesServiceError(message)) return true;

  // Quota / billing patterns (tighter than matchesTokenLimitError)
  const quotaPatterns = [
    'quota',
    'rate limit',
    'out of tokens',
    'insufficient credit',
    'billing',
  ];
  return quotaPatterns.some(pattern => message.includes(pattern));
}

/**
 * Check if error message matches service error patterns
 * @param {string} message - Error message to check
 * @returns {boolean} True if matches service error
 */
export function matchesServiceError(message) {
  const patterns = [
    'overloaded',
    'rate limit',
    '503',
    '529',
    'unavailable',
    'service unavailable',
    'too many requests',
  ];

  return patterns.some(pattern => message.includes(pattern));
}

/**
 * Get the last assistant message for a session
 * @param {string} sessionId - Session ID
 * @returns {object|null} Last assistant message or null
 */
function getLastAssistantMessage(sessionId) {
  try {
    const sessionMessages = messages.getBySessionId(sessionId);
    const assistantMessages = sessionMessages.filter(msg => msg.role === 'assistant');
    return assistantMessages.length > 0 ? assistantMessages[assistantMessages.length - 1] : null;
  } catch (error) {
    console.error('[SessionManager] Error getting last assistant message:', error);
    return null;
  }
}

/**
 * Check if error message matches a rescheduling trigger and log the result
 * @param {object} session - Session object
 * @param {string} message - Message to check (lowercase)
 * @param {string} source - Source description for logging (e.g., "error", "assistant message")
 * @returns {boolean} True if matches a rescheduling trigger
 */
function checkRescheduleTrigger(session, message, source) {
  if (session.rescheduleOnTokenLimit && matchesTokenLimitError(message)) {
    console.log(`[SessionManager] Token limit detected in ${source}, rescheduling`);
    console.log(`[SessionManager] ${source}:`, message);
    console.log('[SessionManager] Session config: rescheduleOnTokenLimit=true, rescheduleDelayMinutes=', session.rescheduleDelayMinutes);
    return true;
  }

  if (session.rescheduleOnServiceError && matchesServiceError(message)) {
    console.log(`[SessionManager] Service error detected in ${source}, rescheduling`);
    console.log(`[SessionManager] ${source}:`, message);
    console.log('[SessionManager] Session config: rescheduleOnServiceError=true, rescheduleDelayMinutes=', session.rescheduleDelayMinutes);
    return true;
  }

  return false;
}

/**
 * Log when a rescheduling check is skipped
 * @param {string} setting - The setting name that was disabled
 */
function logSkippedReschedule(setting) {
  console.log(`[SessionManager] ${setting} is false, skipping ${setting.replace('reschedule', '').toLowerCase()} rescheduling`);
}

/**
 * Determine whether an error occurring on a tier-bound session's start attempt
 * should trigger failover to the next tier member, rather than the normal
 * error/auto-reschedule handling.
 *
 * All of the following must hold:
 *  - `session.model` is a tier ref (`tier::<id>`)
 *  - `tierContext` was supplied (i.e. this attempt is part of the tier failover loop)
 *  - the error matches a failover-eligible pattern (service error or token/limit error)
 *  - the session has produced no assistant messages yet (start-only boundary)
 *  - there is another healthy member to advance to
 *
 * @param {object} session - Session object
 * @param {Error} error - Error that occurred
 * @param {string|null} sessionId - Session ID
 * @param {{ currentMemberId?: string, currentMemberProviderId?: string }|null} tierContext
 * @returns {boolean}
 */
export function isTierFailoverEligibleError(session, error, sessionId = null, tierContext = null) {
  if (!isTierRef(session.model) || !tierContext || tierContext.currentMemberId === undefined) {
    return false;
  }

  const errorMessage = error.message.toLowerCase();
  // Use the tighter failover-specific matcher (Fix 4) rather than the broad
  // matchesTokenLimitError to avoid spurious cross-provider failover on
  // non-quota errors such as JSON parse errors containing "token".
  const isEligible = matchesStartFailoverEligibleError(errorMessage);
  if (!isEligible || !sessionId || !sessionHasNoAssistantMessages(sessionId)) {
    return false;
  }

  return hasNextHealthyMember(session.model, {
    excludeModelId: tierContext.currentMemberId,
    excludeProviderId: tierContext.currentMemberProviderId,
  });
}

/**
 * Check if an error should trigger automatic rescheduling
 * @param {object} session - Session object
 * @param {Error} error - Error that occurred
 * @param {string} sessionId - Session ID
 * @param {{ currentMemberId?: string, currentMemberProviderId?: string }} [tierContext]
 *   - When provided and session is tier-bound, used to determine failover eligibility.
 * @returns {boolean} True if should reschedule
 */
export function shouldRescheduleOnError(session, error, sessionId = null, tierContext = null) {
  // Tier failover interception:
  // If the session is bound to a tier AND the error is failover-eligible AND
  // the conversation has not started yet AND there's a next healthy member,
  // suppress auto-reschedule so the failover loop can throw and advance.
  if (isTierFailoverEligibleError(session, error, sessionId, tierContext)) {
    console.log(
      '[SessionManager] Tier failover eligible: suppressing auto-reschedule to advance to next member'
    );
    return false;
  }

  // Check if auto-reschedule is enabled first (master switch)
  if (!session.autoRescheduleEnabled) {
    console.log('[SessionManager] autoRescheduleEnabled is false, skipping all rescheduling');
    return false;
  }

  const errorMessage = error.message.toLowerCase();

  // Log skipped checks for debugging
  if (!session.rescheduleOnTokenLimit) logSkippedReschedule('rescheduleOnTokenLimit');
  if (!session.rescheduleOnServiceError) logSkippedReschedule('rescheduleOnServiceError');

  // Check error message for rescheduling triggers
  if (checkRescheduleTrigger(session, errorMessage, 'error')) {
    return true;
  }

  // Also check last assistant message if available
  if (sessionId) {
    const lastAssistantMessage = getLastAssistantMessage(sessionId);
    if (lastAssistantMessage) {
      const messageContent = lastAssistantMessage.content.toLowerCase();
      if (checkRescheduleTrigger(session, messageContent, 'assistant message')) {
        return true;
      }
    }
  }

  console.log('[SessionManager] Error does not match any rescheduling triggers');
  console.log('[SessionManager] Session config: rescheduleOnTokenLimit=', session.rescheduleOnTokenLimit, ', rescheduleOnServiceError=', session.rescheduleOnServiceError);
  return false;
}

/**
 * Check if session should be proactively rescheduled based on token count
 * Called after processing each message to check token thresholds
 * @param {string} sessionId - Session ID
 * @returns {Promise<boolean>} True if rescheduled
 */
export async function _checkProactiveReschedule(sessionId) {
  const session = sessions.getById(sessionId);
  if (!session || !session.rescheduleAtTokenCount) {
    return false;
  }

  // Check if auto-reschedule is enabled first (master switch)
  if (!session.autoRescheduleEnabled) {
    console.log('[SessionManager] autoRescheduleEnabled is false, skipping proactive rescheduling');
    return false;
  }

  const totalTokens = session.inputTokens + session.outputTokens;
  if (totalTokens >= session.rescheduleAtTokenCount) {
    console.log(
      `[SessionManager] Proactive token threshold reached: ${totalTokens.toLocaleString()}/${session.rescheduleAtTokenCount.toLocaleString()}`
    );

    // Check if we've reached limits
    if (schedulerService.hasReachedLimits(session)) {
      console.log('[SessionManager] Cannot reschedule - limits reached');
      return false;
    }

    // Gracefully reschedule — proactive rescheduling always continues
    // (turn completed, so "Continue" is the correct next prompt)
    await schedulerService.rescheduleSession(
      sessionId,
      `Token threshold reached (${totalTokens.toLocaleString()} tokens)`,
      { retryExistingMessage: false }
    );
    return true;
  }

  return false;
}
