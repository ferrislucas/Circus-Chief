import { sessions, messages } from '../database.js';
import { schedulerService } from './schedulerService.js';

/**
 * Check if error message matches token limit patterns
 * @param {string} message - Error message to check
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
 * Check if an error should trigger automatic rescheduling
 * @param {object} session - Session object
 * @param {Error} error - Error that occurred
 * @param {string} sessionId - Session ID
 * @returns {boolean} True if should reschedule
 */
export function shouldRescheduleOnError(session, error, sessionId = null) {
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
 * Terminal-sounding phrases that indicate a provider genuinely ended a turn due to
 * a usage/token limit or an outage. Used to gate the broad, single-word matchers
 * (`matchesTokenLimitError` / `matchesServiceError`) on the completion path only,
 * so that ordinary successful-work prose (e.g. "increased the pagination limit to
 * 100", "implemented a token bucket rate limiter") doesn't get misclassified.
 *
 * Intentionally NOT exported: this is a completion-path-only conservative filter.
 * The error / auto-reschedule path continues to use the broad matchers directly
 * via `checkRescheduleTrigger`, unchanged.
 */
const TERMINAL_LIMIT_OR_OUTAGE_PHRASES = [
  'reached your usage limit',
  'reached my usage limit',
  'usage limit reached',
  'hit your token limit',
  'hit my token limit',
  'token limit reached',
  'quota exceeded',
  'quota reached',
  'rate limit reached',
  'rate limited',
  'too many requests',
  'context length exceeded',
  'context window exceeded',
  'service unavailable',
  'temporarily unavailable',
  'currently unavailable',
  'overloaded',
  '503',
  '529',
];

/**
 * Conservative pre-filter for the completion-path limit/outage check. Returns true
 * only when the text contains a terminal, provider-style phrase — never on bare
 * substrings like "token", "limit", "cap", "exceeded", or "unavailable" alone,
 * which appear naturally in ordinary descriptions of completed work.
 * @param {string} message - Already-lowercased text to check
 * @returns {boolean}
 */
function messageLooksLikeTerminalLimitOrOutage(message) {
  if (typeof message !== 'string') return false;
  const text = message.trim();
  if (text === '') return false;
  return TERMINAL_LIMIT_OR_OUTAGE_PHRASES.some(phrase => text.includes(phrase));
}

/**
 * Determine whether a single piece of candidate text (result text or an assistant
 * message) indicates a usage-limit/outage termination. Gates the existing, broader
 * `matchesTokenLimitError` / `matchesServiceError` matchers behind the conservative
 * terminal-phrase filter above, per FR-4: the source of truth for what counts as a
 * limit/outage pattern still lives solely in those two functions.
 * @param {string|undefined|null} text
 * @returns {boolean}
 */
function isLimitOrOutageText(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed === '') return false;
  const haystack = trimmed.toLowerCase();
  if (!messageLooksLikeTerminalLimitOrOutage(haystack)) return false;
  return matchesTokenLimitError(haystack) || matchesServiceError(haystack);
}

/**
 * Determine whether a turn ended due to a usage/token limit or provider outage,
 * so the caller can skip advancing a kanban card on the completion path.
 *
 * Detection is unconditional (ignores reschedule flags) and purely pattern-based,
 * reusing the existing matchers behind a conservative terminal-phrase filter (see
 * `messageLooksLikeTerminalLimitOrOutage`) so ordinary successful-work prose isn't
 * misclassified. Priority order: the captured `result` event's `resultText` (the
 * CLI's authoritative end-of-turn text) is checked first; the last assistant
 * message is checked as a fallback when the result text is empty or absent.
 * Never throws — returns false when there's no signal to check.
 *
 * @param {string} sessionId - Session ID
 * @param {{ resultText?: string } | null} [resultEvent] - Captured result event record (see streamEventHandler.getResultEvent)
 * @returns {boolean} True if the turn ended due to a usage limit or service outage
 */
export function turnEndedDueToLimitOrOutage(sessionId, resultEvent = null) {
  if (isLimitOrOutageText(resultEvent?.resultText)) {
    return true;
  }

  const lastAssistantMessage = getLastAssistantMessage(sessionId);
  if (isLimitOrOutageText(lastAssistantMessage?.content)) {
    return true;
  }

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
