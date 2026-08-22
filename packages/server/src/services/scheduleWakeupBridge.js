import { sessions } from '../database.js';
import { withActiveLaneRunOwnership } from './workflowSessionService.js';

/**
 * Bridges the Claude Agent SDK's built-in `ScheduleWakeup` tool onto Circus
 * Chief's own scheduler.
 *
 * Why this exists
 * ---------------
 * `ScheduleWakeup` is an SDK built-in, not something this app defines. When an
 * agent calls it, the SDK registers a *session-scoped cron* inside the Claude
 * Code CLI subprocess and returns success. But Circus Chief runs one-shot
 * `query()` per turn (see ClaudeCodeAdapter) — the subprocess exits at the end
 * of the turn and takes the cron with it. The agent is told it will be woken;
 * nothing wakes it.
 *
 * Rather than deny the tool, we translate it into the mechanism this app
 * already has: `scheduledAt` + `pendingPrompt` on the session row, which
 * SchedulerService's 30s poller picks up and resumes. The end state is
 * deliberately *identical* to what `POST /api/sessions/:id/schedule` produces,
 * so a wakeup and an explicit REST schedule flow through the exact same
 * downstream code (`handleScheduledContinuationIfNeeded`, the poller, lane-run
 * ownership fencing).
 *
 * Why we read the tool *input* and not its result
 * -----------------------------------------------
 * `ScheduleWakeupOutput` carries a ready-made `scheduledFor` epoch-ms value,
 * which would be the obvious thing to use. We can't: tool results for the
 * Claude Code path arrive as `user` messages, which `handleStreamEvent` has no
 * handler for, so the `tool_result` branch never fires for them. (Empirically:
 * every ScheduleWakeup work log in the DB is `tool_input`, zero are
 * `tool_output`.) So we recompute the fire time from `delaySeconds` and
 * replicate the runtime's documented clamp instead.
 *
 * If a future change starts surfacing tool results on this path, prefer
 * `scheduledFor` over recomputation and delete `clampDelaySeconds`.
 */

/** Documented by the SDK: the runtime clamps `delaySeconds` to this range. */
export const WAKEUP_MIN_DELAY_SECONDS = 60;
export const WAKEUP_MAX_DELAY_SECONDS = 3600;

/**
 * Sentinels the SDK resolves at fire time from its own loop state. Circus
 * Chief has no such state to resolve them against, so persisting one verbatim
 * would hand the resumed agent a literal `<<...>>` string as its prompt.
 */
const UNRESOLVABLE_PROMPT_SENTINELS = new Set([
  '<<autonomous-loop-dynamic>>',
  '<<autonomous-loop>>',
]);

/** Fallback prompt matching what SchedulerService uses for its own retries. */
const FALLBACK_PROMPT = 'Continue';

/**
 * Guarantees the persisted timestamp is strictly in the future, matching the
 * invariant `POST /:id/schedule` enforces. A long turn can outlive the
 * requested delay (agent asks for 60s, then works for 10 minutes), which would
 * otherwise persist an already-elapsed timestamp.
 */
const MIN_FUTURE_MS = 1000;

/**
 * @typedef {{ delaySeconds: number, prompt: string, reason: string, capturedAt: number }} PendingWakeup
 */

/** @type {Map<string, PendingWakeup>} sessionId -> most recent wakeup request this turn */
export const pendingWakeups = new Map();

/**
 * Clamp to the SDK's documented bounds. Mirrors the runtime so the time we
 * persist matches the `scheduledFor` the agent was told about.
 * @param {number} delaySeconds
 * @returns {number|null} Clamped seconds, or null if the input isn't usable.
 */
export function clampDelaySeconds(delaySeconds) {
  if (typeof delaySeconds !== 'number' || !Number.isFinite(delaySeconds)) return null;
  return Math.min(WAKEUP_MAX_DELAY_SECONDS, Math.max(WAKEUP_MIN_DELAY_SECONDS, delaySeconds));
}

/**
 * Resolve the prompt to persist as `pendingPrompt`.
 * @param {*} prompt
 * @returns {string}
 */
export function resolveWakeupPrompt(prompt) {
  if (typeof prompt !== 'string') return FALLBACK_PROMPT;
  const trimmed = prompt.trim();
  if (trimmed === '' || UNRESOLVABLE_PROMPT_SENTINELS.has(trimmed)) return FALLBACK_PROMPT;
  return trimmed;
}

/**
 * Record a ScheduleWakeup call seen in an assistant message's tool_use blocks.
 *
 * Deliberately does NOT write to the DB. The schedule is only applied once the
 * turn actually ends (see `applyPendingWakeup`) because:
 *   - an agent may call ScheduleWakeup and then keep working, superseding it
 *     with a later call — last one wins, matching the SDK's own semantics;
 *   - writing scheduledAt mid-turn would race SchedulerService, which clears
 *     those same fields when it claims a run;
 *   - a turn that aborts or hard-errors should not leave a schedule behind.
 *
 * @param {string} sessionId
 * @param {Array} toolUseBlocks
 */
export function captureScheduleWakeup(sessionId, toolUseBlocks) {
  if (!Array.isArray(toolUseBlocks) || toolUseBlocks.length === 0) return;

  // Last call wins: scan from the end.
  const wakeup = [...toolUseBlocks].reverse().find((t) => t?.name === 'ScheduleWakeup');
  if (!wakeup) return;

  const delaySeconds = clampDelaySeconds(wakeup.input?.delaySeconds);
  if (delaySeconds === null) {
    console.warn(
      `[ScheduleWakeup] Session ${sessionId} requested a wakeup with a non-numeric delaySeconds; ignoring`
    );
    return;
  }

  pendingWakeups.set(sessionId, {
    delaySeconds,
    prompt: resolveWakeupPrompt(wakeup.input?.prompt),
    reason: typeof wakeup.input?.reason === 'string' ? wakeup.input.reason : '',
    capturedAt: Date.now(),
  });
}

/**
 * Drop any captured wakeup for a session without applying it.
 * @param {string} sessionId
 */
export function clearPendingWakeup(sessionId) {
  pendingWakeups.delete(sessionId);
}

/**
 * Whether a session already carries an explicit schedule.
 * @param {object} session
 * @returns {boolean}
 */
function hasExistingSchedule(session) {
  const hasPendingPrompt = typeof session.pendingPrompt === 'string' && session.pendingPrompt.trim() !== '';
  return Number.isFinite(session.scheduledAt) && session.scheduledAt > 0 && hasPendingPrompt;
}

/**
 * Apply a captured wakeup to the session row, if one is pending.
 *
 * Consumes the entry on read, so this is idempotent within a turn and can
 * safely be called from both the completion and error paths.
 *
 * Precedence: an explicit `POST /api/sessions/:id/schedule` made during the
 * same turn wins. That call is Circus-Chief-native and carries a caller-chosen
 * timestamp and model; the wakeup is a best-effort translation of a tool whose
 * real backing store died with the subprocess. Overwriting the explicit
 * schedule with a recomputed one would be the more surprising failure.
 *
 * @param {string} sessionId
 * @returns {boolean} true if a schedule was written
 */
export function applyPendingWakeup(sessionId) {
  const wakeup = pendingWakeups.get(sessionId);
  if (!wakeup) return false;
  pendingWakeups.delete(sessionId);

  const session = sessions.getById(sessionId);
  if (!session) return false;

  if (hasExistingSchedule(session)) {
    console.log(
      `[ScheduleWakeup] Session ${sessionId} already has an explicit schedule; ignoring the wakeup requested via ScheduleWakeup`
    );
    return false;
  }

  const scheduledAt = Math.max(
    wakeup.capturedAt + wakeup.delaySeconds * 1000,
    Date.now() + MIN_FUTURE_MS
  );

  // Mirror the REST endpoint's lane-run fencing so a wakeup can't revive a
  // worker whose lane run was superseded mid-turn.
  const update = () => sessions.update(sessionId, {
    scheduledAt,
    pendingPrompt: wakeup.prompt,
    pendingConversationId: null,
  });
  const updated = session.laneRunId ? withActiveLaneRunOwnership(sessionId, update) : update();

  if (!updated) {
    console.log(
      `[ScheduleWakeup] Session ${sessionId} no longer owns an active lane run; wakeup dropped`
    );
    return false;
  }

  console.log(
    `[ScheduleWakeup] Session ${sessionId} scheduled for ${new Date(scheduledAt).toISOString()} `
    + `(${wakeup.delaySeconds}s): ${wakeup.reason}`
  );
  return true;
}
