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

    // Gracefully reschedule
    await schedulerService.rescheduleSession(
      sessionId,
      `Token threshold reached (${totalTokens.toLocaleString()} tokens)`
    );
    return true;
  }

  return false;
}
