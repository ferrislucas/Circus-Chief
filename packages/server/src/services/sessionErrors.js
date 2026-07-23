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
 * Normalize candidate text before matching against the completion-path terminal
 * patterns: lowercase, collapse `_`/`-` runs to a single space (so
 * "overloaded_error" and "service-unavailable" normalize the same as their
 * space-separated forms), collapse other punctuation-adjacent separators like a
 * stray colon (e.g. "Error 529: overloaded_error") the same way, then collapse
 * whitespace and trim.
 * @param {string} text
 * @returns {string}
 */
function normalizeTerminalText(text) {
  return text
    .toLowerCase()
    .replace(/[_:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Terminal-sounding regex patterns that indicate a provider genuinely ended a turn
 * due to a usage/token limit or an outage. Used to gate the broad, single-word
 * matchers (`matchesTokenLimitError` / `matchesServiceError`) on the completion
 * path only, so that ordinary successful-work prose (e.g. "increased the
 * pagination limit to 100", "implemented a token bucket rate limiter", "Fixed the
 * HTTP 503 error handling in the proxy") doesn't get misclassified. Each pattern
 * describes a terminal provider condition, not ordinary prose that happens to
 * contain a bare word like "token", "limit", "503", "529", "overload", or
 * "unavailable".
 *
 * Intentionally NOT exported: this is a completion-path-only conservative filter.
 * The error / auto-reschedule path continues to use the broad matchers directly
 * via `checkRescheduleTrigger`, unchanged.
 */
const TERMINAL_LIMIT_OR_OUTAGE_PATTERNS = [
  /\b(?:you(?:'ve| have)|i(?:'ve| have)) reached (?:your|my|the)?\s*usage limit\b/,
  /\busage limit (?:reached|exceeded)\b/,
  /\b(?:you(?:'ve| have)|i(?:'ve| have)) hit (?:your|my|the)?\s*(?:token|usage) limit\b/,
  /\b(?:token|context) (?:limit|window|length) (?:reached|exceeded)\b/,
  /\b(?:quota|usage cap) (?:reached|exceeded|exhausted)\b/,
  /\brate limit(?:ed| reached| exceeded)?\b/,
  /\btoo many requests\b/,
  /\b(?:service|server|api|provider) (?:is )?(?:temporarily |currently )?unavailable\b/,
  /\b(?:service|server|api|provider) (?:is )?overloaded\b/,
  /\boverloaded error\b/,
  /\b(?:http |error |status )?503 service unavailable\b/,
  /\b(?:http |error |status )?529 (?:overloaded error|too many requests)\b/,
  /\b429 too many requests\b/,
];

/**
 * Conservative pre-filter for the completion-path limit/outage check. Returns true
 * only when the (already-normalized) text matches one of the framed terminal
 * patterns above — never on bare substrings like "token", "limit", "cap",
 * "exceeded", "503", "529", "overloaded", or "unavailable" alone, which appear
 * naturally in ordinary descriptions of completed work.
 * @param {string} message - Already-normalized (lowercased, `_`/`-`/`:` folded to space) text
 * @returns {boolean}
 */
function messageLooksLikeTerminalLimitOrOutage(message) {
  if (typeof message !== 'string') return false;
  const text = message.trim();
  if (text === '') return false;
  return TERMINAL_LIMIT_OR_OUTAGE_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Shape guard applied only to the last-assistant-message fallback (never to a
 * captured `result` event — see `isLimitOrOutageText`). Ordinary completion
 * summaries can legitimately contain terminal-sounding substrings in passing
 * (e.g. "Fixed HTTP 503 Service Unavailable handling in the proxy", "The service
 * is unavailable branch is now covered by a test"), so this guard rejects
 * anything that reads like normal implementation prose rather than a short,
 * terminal provider failure message: text over 500 characters, or text
 * containing common completion-summary verbs/nouns.
 * @param {string} message - Already-normalized text
 * @returns {boolean}
 */
function looksLikeTerminalAssistantMessage(message) {
  const text = normalizeTerminalText(message);
  if (text.length > 500) return false;
  if (/\b(implemented|added|fixed|refactored|updated|covered|tested|handling|handler|constructor)\b/.test(text)) {
    return false;
  }
  return true;
}

/**
 * Determine whether a single piece of candidate text (result text or an assistant
 * message) indicates a usage-limit/outage termination. Gates the existing, broader
 * `matchesTokenLimitError` / `matchesServiceError` matchers behind the conservative
 * terminal-pattern filter above, per FR-4: the source of truth for what counts as a
 * limit/outage pattern still lives solely in those two functions.
 *
 * The `result` event is the provider/CLI's authoritative end-of-turn signal, so
 * only text sourced from the last assistant message (`source: 'assistant'`) is
 * additionally required to look like a short, terminal failure message via
 * `looksLikeTerminalAssistantMessage` — captured `result` text is not subjected to
 * that shape guard.
 *
 * @param {string|undefined|null} text
 * @param {{ source?: 'result' | 'assistant' }} [options]
 * @returns {boolean}
 */
function isLimitOrOutageText(text, { source = 'result' } = {}) {
  if (typeof text !== 'string') return false;
  const haystack = normalizeTerminalText(text);
  if (haystack === '') return false;
  if (source === 'assistant' && !looksLikeTerminalAssistantMessage(haystack)) return false;
  if (!messageLooksLikeTerminalLimitOrOutage(haystack)) return false;
  return matchesTokenLimitError(haystack) || matchesServiceError(haystack);
}

/**
 * Determine whether a turn ended due to a usage/token limit or provider outage,
 * so the caller can skip advancing a kanban card on the completion path.
 *
 * Detection is unconditional (ignores reschedule flags) and purely pattern-based,
 * reusing the existing matchers behind a conservative terminal-pattern filter (see
 * `messageLooksLikeTerminalLimitOrOutage`) so ordinary successful-work prose isn't
 * misclassified. Priority order: the captured `result` event's `resultText` (the
 * CLI's authoritative end-of-turn text) is checked first; the last assistant
 * message is checked as a fallback — subject to the additional
 * `looksLikeTerminalAssistantMessage` shape guard — when the result text is empty
 * or absent. Never throws — returns false when there's no signal to check.
 *
 * @param {string} sessionId - Session ID
 * @param {{ resultText?: string } | null} [resultEvent] - Captured result event record (see streamEventHandler.getResultEvent)
 * @returns {boolean} True if the turn ended due to a usage limit or service outage
 */
export function turnEndedDueToLimitOrOutage(sessionId, resultEvent = null) {
  if (isLimitOrOutageText(resultEvent?.resultText, { source: 'result' })) {
    return true;
  }

  const lastAssistantMessage = getLastAssistantMessage(sessionId);
  if (isLimitOrOutageText(lastAssistantMessage?.content, { source: 'assistant' })) {
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
