/**
 * Per-turn output/continuation tracking for the empty-turn guard.
 *
 * An automated lane run must not count as successful solely because a
 * provider stream ended cleanly: the stream must have produced substantive
 * output or an explicit verifiable continuation artifact. These Sets record
 * that evidence per turn with consume-on-read semantics (plus deletion in
 * cleanupSessionState), so a later turn can never inherit a previous turn's
 * flag. This module has no imports by design — streamEventHandler,
 * streamEventCallbacks, and the execution layer all depend on it.
 */

/** Sessions whose current turn produced substantive provider output. @type {Set<string>} */
export const turnsWithSubstantiveOutput = new Set();

/** Sessions whose turn dispatched an explicit continuation outside its stream. @type {Set<string>} */
export const turnsContinuedExternally = new Set();

/**
 * Whether a stream_event wrapper carries real content (text or thinking).
 * @param {Object} event - Raw provider stream event
 * @returns {boolean}
 */
function hasStreamContentDelta(event) {
  const delta = event.event?.delta;
  if (!delta) return false;
  return Boolean(
    (delta.type === 'text_delta' && delta.text)
    || (delta.type === 'thinking_delta' && delta.thinking),
  );
}

/**
 * Whether a result event carries evidence of work (text, usage, or cost).
 * A bare success close proves the stream ended, not that work was produced.
 * @param {Object} event - Raw provider stream event
 * @returns {boolean}
 */
function hasResultPayload(event) {
  if (typeof event.result === 'string' && event.result.trim() !== '') return true;
  return event.total_cost_usd !== undefined || Boolean(event.usage || event.modelUsage);
}

/**
 * Whether a single provider stream event represents substantive turn output.
 * Assistant messages, tool activity, content deltas, and payload-bearing
 * results count. System/init handshakes, stream bookkeeping, and bare
 * success-result events do not.
 * @param {Object} event - Raw provider stream event
 * @returns {boolean}
 */
export function isSubstantiveTurnEvent(event) {
  if (!event || typeof event.type !== 'string') return false;
  if (event.type === 'assistant' || event.type === 'tool_result') return true;
  if (event.type === 'stream_event') return hasStreamContentDelta(event);
  if (event.type === 'result') return hasResultPayload(event);
  return false;
}

/**
 * Read and consume the substantive-output flag for a session's turn.
 * @param {string} sessionId
 * @returns {boolean}
 */
export function consumeTurnHadSubstantiveOutput(sessionId) {
  const had = turnsWithSubstantiveOutput.has(sessionId);
  turnsWithSubstantiveOutput.delete(sessionId);
  return had;
}

/**
 * Mark a turn as explicitly continued outside its provider stream (an
 * auto-send follow-up dispatch or a template trigger that created a child).
 * @param {string} sessionId
 */
export function markTurnContinuedExternally(sessionId) {
  turnsContinuedExternally.add(sessionId);
}

/**
 * Read and consume the external-continuation flag for a session's turn.
 * @param {string} sessionId
 * @returns {boolean}
 */
export function consumeTurnContinuedExternally(sessionId) {
  const had = turnsContinuedExternally.has(sessionId);
  turnsContinuedExternally.delete(sessionId);
  return had;
}

/**
 * Drop all turn-guard state for a session. Called from cleanupSessionState so
 * unconsumed flags (error/abort paths) can never leak into a later turn.
 * @param {string} sessionId
 */
export function clearTurnGuardState(sessionId) {
  turnsWithSubstantiveOutput.delete(sessionId);
  turnsContinuedExternally.delete(sessionId);
}
