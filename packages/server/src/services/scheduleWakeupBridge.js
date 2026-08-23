import { sessions } from '../database.js';
import { withActiveLaneRunOwnership } from './workflowSessionService.js';
import { createWorkLog } from './workLogService.js';

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
 *
 * When a wakeup is silently dropped, we say so
 * ---------------------------------------------
 * This bridge exists because the tool used to lie about success. Every path
 * that drops a captured wakeup therefore also writes a `tool_output` work log
 * (in addition to a console line for server-side debugging) so the drop is
 * visible in the session transcript, not just in server logs the operator
 * probably isn't watching.
 */

/** Documented by the SDK: the runtime clamps `delaySeconds` to this range. */
export const WAKEUP_MIN_DELAY_SECONDS = 60;
export const WAKEUP_MAX_DELAY_SECONDS = 3600;

/**
 * Sentinels the SDK resolves at fire time from its own loop state. Circus
 * Chief has no such state to resolve them against. Persisting one verbatim
 * would hand the resumed agent a literal `<<...>>` string as its prompt;
 * substituting a generic "Continue" is just as wrong in the other direction —
 * it silently discards the fact that the agent asked for a specific
 * (unavailable) instruction and fabricates a different one in its place. So
 * these are refused outright rather than resolved. See `resolveWakeupPrompt`.
 */
const UNRESOLVABLE_PROMPT_SENTINELS = new Set([
  '<<autonomous-loop-dynamic>>',
  '<<autonomous-loop>>',
]);

/** Fallback prompt matching what SchedulerService uses for its own retries. Only used when no prompt was supplied at all — never as a substitute for an unresolvable one. */
const FALLBACK_PROMPT = 'Continue';

/**
 * @typedef {{ delaySeconds: number, prompt: string, reason: string, capturedAt: number, capturedSeq: number }} PendingWakeup
 */

/** @type {Map<string, PendingWakeup>} sessionId -> most recent wakeup request this turn */
export const pendingWakeups = new Map();

/**
 * @type {Map<string, Set<string>>} sessionId -> tool_use ids already
 * considered for this turn. The Claude Code stream redelivers the full
 * content of a partial assistant message on each chunk, so the same
 * ScheduleWakeup tool_use block (same `id`) can arrive multiple times. Without
 * this, a redelivery would be treated as a fresh call, spuriously refreshing
 * `capturedAt` (delaying the fire time) and, worse, letting a stale redelivery
 * of an *earlier* call win over a genuinely later one if the two interleave.
 */
const seenWakeupToolUseIds = new Map();

/**
 * Monotonic counter used to order an explicit `POST /:id/schedule` call
 * against a ScheduleWakeup capture within the same turn. `Date.now()` isn't
 * fine-grained enough for this: two synchronous calls in the same turn can
 * land in the same millisecond, which would make "whichever happened later
 * wins" undefined. A shared incrementing counter has no ties.
 */
let turnSequenceCounter = 0;

/**
 * sessionId -> sequence number of the most recent explicit `POST
 * /:id/schedule` call observed while a turn was in flight (see
 * `recordExplicitSchedule`, called from the REST handler). Consulted — not
 * consumed — by `applyPendingWakeup` so that whichever mechanism was used
 * more recently within the turn wins, matching the last-call-wins semantics
 * `captureScheduleWakeup` already applies to repeated ScheduleWakeup calls.
 * Cleared at turn cleanup.
 * @type {Map<string, number>}
 */
const explicitScheduleSequence = new Map();

/**
 * Clamp to the SDK's documented bounds. Mirrors the runtime so the time we
 * persist matches the `scheduledFor` the agent was told about. Accepts a
 * numeric string (tool inputs arrive as parsed JSON, but a model can still
 * emit `"600"`) as long as it isn't blank.
 * @param {number|string} delaySeconds
 * @returns {number|null} Clamped seconds, or null if the input isn't usable.
 */
export function clampDelaySeconds(delaySeconds) {
  let num;
  if (typeof delaySeconds === 'number') {
    num = delaySeconds;
  } else if (typeof delaySeconds === 'string' && delaySeconds.trim() !== '') {
    num = Number(delaySeconds);
  } else {
    return null;
  }
  if (!Number.isFinite(num)) return null;
  return Math.min(WAKEUP_MAX_DELAY_SECONDS, Math.max(WAKEUP_MIN_DELAY_SECONDS, num));
}

/**
 * Resolve the prompt to persist as `pendingPrompt`.
 * @param {*} prompt
 * @returns {string|null} The prompt to persist, a fallback for a missing
 *   prompt, or `null` when the wakeup must be refused outright (an
 *   SDK loop-state sentinel we cannot dereference).
 */
export function resolveWakeupPrompt(prompt) {
  if (typeof prompt === 'string' && UNRESOLVABLE_PROMPT_SENTINELS.has(prompt.trim())) {
    return null;
  }
  if (typeof prompt !== 'string' || prompt.trim() === '') return FALLBACK_PROMPT;
  return prompt.trim();
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

  const seen = seenWakeupToolUseIds.get(sessionId) ?? new Set();
  const candidates = toolUseBlocks.filter((t) => t?.name === 'ScheduleWakeup');
  if (candidates.length === 0) return;

  // Ids already considered (in an earlier, possibly-partial delivery of this
  // same content) don't count as new calls. Everything we see here — winner
  // or not — gets marked seen so a later redelivery of this exact batch is a
  // full no-op.
  const freshCandidates = candidates.filter((t) => !t.id || !seen.has(t.id));
  for (const t of candidates) if (t.id) seen.add(t.id);
  seenWakeupToolUseIds.set(sessionId, seen);

  if (freshCandidates.length === 0) return;

  // Last call wins among the genuinely new candidates in this batch.
  const wakeup = freshCandidates[freshCandidates.length - 1];

  // A fresh call replaces any earlier request even when this new request is
  // invalid. Leaving the old entry armed would make the SDK report that the
  // latest call was dropped while silently scheduling a prompt the agent had
  // already superseded.
  pendingWakeups.delete(sessionId);

  const delaySeconds = clampDelaySeconds(wakeup.input?.delaySeconds);
  if (delaySeconds === null) {
    const message = `ScheduleWakeup requested a wakeup with a non-numeric delaySeconds (${JSON.stringify(wakeup.input?.delaySeconds)}); the wakeup was not scheduled.`;
    console.warn(`[ScheduleWakeup] Session ${sessionId}: ${message}`);
    createWorkLog(sessionId, 'tool_output', message, 'ScheduleWakeup');
    return;
  }

  const prompt = resolveWakeupPrompt(wakeup.input?.prompt);
  if (prompt === null) {
    const message = `ScheduleWakeup was called with the SDK's autonomous-loop sentinel prompt ("${wakeup.input?.prompt}"), which only resolves inside the SDK's own loop state. Circus Chief has no such state, so this wakeup was not scheduled. Call POST /api/sessions/:id/schedule with an explicit prompt instead.`;
    console.warn(`[ScheduleWakeup] Session ${sessionId}: ${message}`);
    createWorkLog(sessionId, 'tool_output', message, 'ScheduleWakeup');
    return;
  }

  pendingWakeups.set(sessionId, {
    delaySeconds,
    prompt,
    reason: typeof wakeup.input?.reason === 'string' ? wakeup.input.reason : '',
    capturedAt: Date.now(),
    capturedSeq: turnSequenceCounter++,
  });
}

/**
 * Record that an explicit `POST /:id/schedule` write happened while this
 * session's turn was in flight. Called only from the REST handler, and only
 * when the session was active (see `sessions-lifecycle.js`) — a schedule
 * written to an idle session has no wakeup to race against.
 * @param {string} sessionId
 */
export function recordExplicitSchedule(sessionId) {
  explicitScheduleSequence.set(sessionId, turnSequenceCounter++);
}

/**
 * Drop any turn-scoped wakeup state for a session without applying it:
 * the captured wakeup itself, its tool_use dedup set, and the explicit-
 * schedule recency marker. Safe to call unconditionally at turn cleanup.
 * @param {string} sessionId
 */
export function clearPendingWakeup(sessionId) {
  pendingWakeups.delete(sessionId);
  seenWakeupToolUseIds.delete(sessionId);
  explicitScheduleSequence.delete(sessionId);
}

/**
 * Whether a session already carries a schedule (of either origin).
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
 * safely be called from both the completion and error paths. Writes `status:
 * 'scheduled'` itself (not just `scheduledAt`/`pendingPrompt`) so the return
 * value's contract — "a schedule was written" — is actually true standalone;
 * callers that also re-derive status from the session row (as
 * `handleScheduledContinuationIfNeeded` does, to cover the explicit-REST-only
 * case where this function never ran) simply repeat a no-op write.
 *
 * Precedence: whichever of an explicit `POST /:id/schedule` call and a
 * ScheduleWakeup call happened later in the same turn wins (ordered by
 * `turnSequenceCounter`, not wall-clock time — two synchronous calls can
 * share a millisecond) — the same last-call-wins rule `captureScheduleWakeup`
 * applies to repeated wakeup calls. A schedule row with no recorded
 * explicit-write marker (i.e. nothing written by the REST endpoint during
 * this turn) is not treated as a competing claim, so a stale row left over
 * from an unrelated flow can't block a legitimate wakeup.
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

  const explicitSeq = explicitScheduleSequence.get(sessionId);
  if (hasExistingSchedule(session) && explicitSeq !== undefined && explicitSeq > wakeup.capturedSeq) {
    const message = 'ScheduleWakeup was superseded by an explicit POST /:id/schedule call made later in the same turn; the explicit schedule was kept.';
    console.log(`[ScheduleWakeup] Session ${sessionId}: ${message}`);
    createWorkLog(sessionId, 'tool_output', message, 'ScheduleWakeup');
    return false;
  }

  // Delay is measured from now (turn end / apply time), not from when the
  // tool was called. Anchoring to capturedAt would let a long-running turn
  // (agent asks for a 60s poll, then works for 10 more minutes) collapse the
  // requested delay to nothing, defeating the throttle the agent asked for.
  const scheduledAt = Date.now() + wakeup.delaySeconds * 1000;

  // Mirror the REST endpoint's lane-run fencing so a wakeup can't revive a
  // worker whose lane run was superseded mid-turn.
  const update = () => sessions.update(sessionId, {
    status: 'scheduled',
    scheduledAt,
    pendingPrompt: wakeup.prompt,
    pendingConversationId: null,
  });
  const updated = session.laneRunId ? withActiveLaneRunOwnership(sessionId, update) : update();

  if (!updated) {
    const message = `ScheduleWakeup requested a wakeup in ${wakeup.delaySeconds}s, but this session's lane run was superseded before the wakeup could be scheduled; the wakeup was dropped.`;
    console.log(`[ScheduleWakeup] Session ${sessionId}: ${message}`);
    createWorkLog(sessionId, 'tool_output', message, 'ScheduleWakeup');
    return false;
  }

  console.log(
    `[ScheduleWakeup] Session ${sessionId} scheduled for ${new Date(scheduledAt).toISOString()} `
    + `(${wakeup.delaySeconds}s): ${wakeup.reason}`
  );
  return true;
}
