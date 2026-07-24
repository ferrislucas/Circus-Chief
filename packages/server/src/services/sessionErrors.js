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
  // Terminal suffix is required (non-optional) so the bare noun phrase "a rate
  // limit" — common in legitimate work summaries like "configured the rate
  // limit at 100 rps" — does not match on its own (Issue 2).
  /\brate ?limit(?:ed| reached| exceeded| error)\b/,
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
 * only when the text matches one of the framed terminal patterns above — never on
 * bare substrings like "token", "limit", "cap", "exceeded", "503", "529",
 * "overloaded", or "unavailable" alone, which appear naturally in ordinary
 * descriptions of completed work.
 *
 * Single normalization boundary (Issue 5): this helper receives text that has
 * already been normalized and validated (non-empty string) by the sole caller,
 * `isLimitOrOutageText` — it does not re-normalize or re-trim.
 * @param {string} text - Already-normalized (lowercased, `_`/`-`/`:` folded to space, trimmed) text
 * @returns {boolean}
 */
function messageLooksLikeTerminalLimitOrOutage(text) {
  return TERMINAL_LIMIT_OR_OUTAGE_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Word-stem alternation for common completion-summary verbs/nouns, matched as
 * prefixes (not whole words) so inflections are covered without listing every
 * form — e.g. `handl` catches "handle", "handled", "handling", "handler";
 * `add` catches "add", "added", "adding". Used by `looksLikeTerminalAssistantMessage`
 * to reject ordinary implementation prose (Issue 2).
 */
const COMPLETION_VERB_STEM_PATTERN =
  /\b(?:implement|add|fix|refactor|updat|cover|test|handl|configur|creat|increas|reduc|remov|chang|introduc|adjust|wrote|set up|wired|bumped|construct|return)/;

/**
 * Shape guard applied to both candidate sources (a captured `result` event's text
 * and the last-assistant-message fallback — see `isLimitOrOutageText`). For Claude
 * Code, the SDK `result` event's text IS the final assistant message, so it can
 * just as easily be an ordinary completion summary that happens to mention a
 * terminal-sounding phrase in passing (e.g. "Fixed HTTP 503 Service Unavailable
 * handling in the proxy", "The service is unavailable branch is now covered by a
 * test"). This guard rejects anything that reads like normal implementation prose
 * rather than a short, terminal provider failure message: text over 500
 * characters, or text containing common completion-summary verb/noun stems.
 * @param {string} text - Already-normalized text
 * @returns {boolean}
 */
function looksLikeTerminalAssistantMessage(text) {
  if (text.length > 500) return false;
  if (COMPLETION_VERB_STEM_PATTERN.test(text)) return false;
  return true;
}

/**
 * Determine whether a single piece of candidate text (result text or an assistant
 * message) indicates a usage-limit/outage termination. Gates the existing, broader
 * `matchesTokenLimitError` / `matchesServiceError` matchers behind the conservative
 * terminal-pattern filter above, per FR-4: the source of truth for what counts as a
 * limit/outage pattern still lives solely in those two functions — the framed
 * patterns and the shape guard here are only a completion-path *shape gate* (see
 * the "framed patterns ⊆ shared matchers" invariant test in sessionErrors.test.js).
 *
 * Both candidate sources are treated as assistant-authored prose and therefore
 * shape-guarded identically: for Claude Code the `result` event's text IS the
 * final assistant message, so it must not bypass `looksLikeTerminalAssistantMessage`
 * (Issue 1) — a genuine graceful limit/outage message is short and free of
 * completion verbs, so the shape guard preserves true positives while rejecting
 * long work-summary prose that merely mentions a limit phrase.
 *
 * @param {string|undefined|null} text
 * @returns {boolean}
 */
function isLimitOrOutageText(text) {
  if (typeof text !== 'string') return false;
  const haystack = normalizeTerminalText(text);
  if (haystack === '') return false;
  if (!looksLikeTerminalAssistantMessage(haystack)) return false;
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
 * CLI's authoritative end-of-turn text, but still assistant-authored prose for
 * Claude Code) is checked first; the last assistant message is checked as a
 * fallback when the result text is empty or absent. Both are subject to the same
 * `looksLikeTerminalAssistantMessage` shape guard. Never throws — returns false
 * when there's no signal to check.
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
