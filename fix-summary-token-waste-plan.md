# Fix Excessive Summary Token Spending

## The Problem

Summary generation is burning excessive tokens. The debounce mechanism is broken: **75% of consecutive summary calls happen within 60 seconds of each other**, and many overlap *concurrently*.

### Evidence from the DB

| Metric | Value |
|--------|-------|
| Summary calls today alone | **113** (session + conversation + combined) |
| Tokens burned on summaries today | **5.78M** |
| Calls with gap < 15s (debounce should prevent) | **103** (58%) |
| Calls with gap < 60s (debounce FAILED) | **148** (84%) |
| Concurrent/overlapping calls found | **20+** pairs |
| Worst session today | 45 summary calls, many 3-15s apart |

### Root Causes

**1. No concurrency guard -- multiple `generateSummary()` calls run in parallel for the same session**

The debounce timer in `onSessionActivity()` properly resets, but `generateSummary()` itself has no lock. When the 60s timer fires, it starts an async API call (~6-10s duration). If another trigger fires during that API call (e.g., `onSessionComplete`, parent propagation, another debounce fire), a second `generateSummary` starts *concurrently* -- the staleness check passes for both because neither has written results yet.

**2. `onSessionComplete()` has TWO code paths, BOTH use `force=true` or no staleness check**

The function (lines 898-941 in summaryService.js) has two branches:
- **Combined path** (line 911): Calls `generateSessionAndConversationSummary()` which has **zero staleness check** -- it always makes an API call.
- **Session-only path** (line 923): Calls `generateSummary(sessionId, 0, true)` with `force=true`, which bypasses the staleness check.
- **Fallback path** (line 914): If the combined call fails, it *also* fires `generateSummary(sessionId, 0, true)` -- a redundant force call.

**3. `generateSessionAndConversationSummary()` has NO staleness check and NO concurrency guard**

This is a completely separate function (line 1057) that goes straight to the API with no deduplication whatsoever. The concurrency guard proposed in Change 1 would NOT protect this path unless we also guard it.

**4. `onSessionActivity()` is called from FOUR places per turn -- turn completion, per-message, AND template trigger**

- Line 1071/1283/1482: Called when session reaches `waiting` state (turn complete)
- Line 1697: Called on *every assistant message* during streaming
- Line 1080: `handleTemplateTriggerIfNeeded` calls `generateSummaryNow()` which calls `generateSummary()` immediately -- AND the debounce timer from line 1071 is still ticking, so it fires AGAIN 60s later.

**5. `onSessionComplete()` is called on EVERY terminal state transition**

Lines 1102, 1314, 1513, 1544, 1880 in sessionManager. Each fires an immediate, forced summary generation with no deduplication.

**6. Parent propagation (`propagateToParent`) triggers additional summary calls**

When a child session's summary updates, it calls `onSessionActivity(parentSessionId)`, which can cascade.

---

## The Fix -- 4 Changes

### Change 1: Add a per-session generation lock (concurrency guard)

**File:** `packages/server/src/services/summaryService.js`

Add an `activeGenerations` Map that tracks in-flight generation promises per session. The lock must guard ALL generation entry points:
- `generateSummary()`
- `generateSessionAndConversationSummary()`

When any generation function is called for a session that's already generating, it:
- Returns the existing promise (coalesces), OR
- Queues exactly ONE follow-up generation (so the latest data gets picked up after the current one finishes)

```js
// At top of file
const activeGenerations = new Map(); // sessionId -> Promise
const pendingRegenerations = new Set(); // sessionIds that need regeneration after current completes

// Wrap generateSummary
export async function generateSummary(sessionId, retryCount = 0, force = false, userInitiated = false) {
  if (activeGenerations.has(sessionId) && !userInitiated) {
    pendingRegenerations.add(sessionId);
    return activeGenerations.get(sessionId);
  }

  const promise = _doGenerateSummary(sessionId, retryCount, force, userInitiated);
  activeGenerations.set(sessionId, promise);

  try {
    return await promise;
  } finally {
    activeGenerations.delete(sessionId);
    if (pendingRegenerations.has(sessionId)) {
      pendingRegenerations.delete(sessionId);
      onSessionActivity(sessionId); // debounced, not immediate
    }
  }
}

// ALSO wrap generateSessionAndConversationSummary with the same lock
export async function generateSessionAndConversationSummary(sessionId, conversationId) {
  if (activeGenerations.has(sessionId)) {
    pendingRegenerations.add(sessionId);
    return activeGenerations.get(sessionId);
  }

  const promise = _doGenerateSessionAndConversationSummary(sessionId, conversationId);
  activeGenerations.set(sessionId, promise);

  try {
    return await promise;
  } finally {
    activeGenerations.delete(sessionId);
    if (pendingRegenerations.has(sessionId)) {
      pendingRegenerations.delete(sessionId);
      onSessionActivity(sessionId);
    }
  }
}
```

**Impact:** Eliminates ALL concurrent/overlapping calls, including the combined generation path.

### Change 2: Remove `force=true` from `onSessionComplete()` and add staleness check to combined path

**File:** `packages/server/src/services/summaryService.js`

Two sub-changes:

**2a.** In `onSessionComplete()`, change `generateSummary(sessionId, 0, true)` to `generateSummary(sessionId)` (no force) on both the session-only path (line 923) and the fallback path (line 914). The staleness check will correctly determine if new messages arrived since last summary.

**2b.** Add a staleness check at the top of `generateSessionAndConversationSummary()` so it also skips when the summary is current:
```js
// Add near the top of generateSessionAndConversationSummary, after getting existingSummary
if (!isSummaryStale(sessionId)) {
  console.log(`[SummaryService] Summary for ${sessionId} is current, skipping combined generation`);
  // Still generate conversation summary if needed (lightweight DB check)
  return { sessionSummary: existingSummary, conversationSummary: null };
}
```

**2c.** When the session transitions to a terminal state but messages haven't changed, do a lightweight outcome-only DB update instead of a full LLM regeneration:
```js
export function onSessionComplete(sessionId) {
  // Cancel debounce
  if (debounceTimers.has(sessionId)) {
    clearTimeout(debounceTimers.get(sessionId));
    debounceTimers.delete(sessionId);
  }

  // Lightweight outcome update: if summary exists and is current,
  // just update the outcome field without calling the LLM
  const existingSummary = sessionSummaries.getBySessionId(sessionId);
  const session = sessions.getById(sessionId);
  if (existingSummary && !isSummaryStale(sessionId) && session) {
    const newOutcome = session.status === 'error' ? 'failed'
      : session.status === 'stopped' ? 'partial'
      : 'completed';
    if (existingSummary.outcome !== newOutcome) {
      sessionSummaries.upsert(sessionId, { ...existingSummary, outcome: newOutcome });
      // Broadcast the updated summary
    }
    return; // No LLM call needed
  }

  // Summary is stale or doesn't exist -- generate
  // ... (combined or session-only path, same branching as before but without force=true)
}
```

**Impact:** Eliminates the biggest source of redundant calls. Sessions that complete right after a debounce-triggered summary won't regenerate via LLM.

### Change 3: Remove the per-message `onSessionActivity` call -- keep only turn-completion

**File:** `packages/server/src/services/sessionManager.js`

Remove line 1697: `summaryService.onSessionActivity(sessionId)` from the per-assistant-message handler. Keep only the turn-completion calls (lines 1071, 1283, 1482).

**Rationale:** The per-message call is redundant. During an active session, messages arrive rapidly. The turn-completion call already fires when the session reaches "waiting" state. The per-message call just resets the debounce timer repeatedly for no benefit -- and in edge cases, it can start generation during an active turn.

**Impact:** Reduces debounce timer churn during active sessions.

### Change 4: Cancel debounce timer in `generateSummaryNow` before it fires redundantly

**File:** `packages/server/src/services/summaryService.js`

`generateSummaryNow()` already cancels the debounce timer (line 885-887) -- this is correct. BUT when called from `handleTemplateTriggerIfNeeded()` at line 1080 in sessionManager, the debounce timer was JUST set at line 1071 (`onSessionActivity`), so the cancel in `generateSummaryNow` correctly prevents the double-fire. No code change needed here, but this interaction needs a test to prevent regression.

---

## Expected Results

| Metric | Before | After (estimated) |
|--------|--------|-----|
| Summary calls per active session-hour | ~15-45 | ~2-4 |
| Token waste from summaries (daily) | 5.78M | ~500K-1M |
| Concurrent summary calls | Common | Impossible |
| Summary % of total tokens | ~11% | ~1-2% |

---

## Testing Plan

### New tests to add to `summaryService.test.js`

**Concurrency guard tests (Change 1):**

1. `it('does not start a second generation while one is in-flight for the same session')` -- call `generateSummary` twice rapidly for the same sessionId, assert `callClaude` is invoked only once during the first call
2. `it('queues exactly one follow-up generation when calls arrive during in-flight generation')` -- start `generateSummary`, call it 3 more times while in-flight, assert only 1 follow-up fires after the first completes (not 3)
3. `it('allows concurrent generation for DIFFERENT sessions')` -- call `generateSummary` for sessionA and sessionB simultaneously, assert both proceed
4. `it('userInitiated=true bypasses the concurrency guard')` -- start a non-user generation, then call with `userInitiated=true`, assert both run
5. `it('concurrency guard protects generateSessionAndConversationSummary')` -- call combined generation while `generateSummary` is in-flight for the same session, assert the combined call is queued
6. `it('follow-up after concurrency guard uses debounce path, not immediate')` -- verify the pending regeneration calls `onSessionActivity` (debounced) not `generateSummary` directly

**Staleness/force tests (Change 2):**

7. `it('onSessionComplete skips LLM call when summary is current')` -- generate a summary, then call `onSessionComplete`, assert no second `callClaude` invocation
8. `it('onSessionComplete updates outcome via DB when summary is current but status changed')` -- generate summary with outcome "ongoing", change session status to "completed", call `onSessionComplete`, assert outcome is updated in DB without calling `callClaude`
9. `it('onSessionComplete generates via LLM when summary is stale')` -- generate summary, add a new message, call `onSessionComplete`, assert `callClaude` IS invoked
10. `it('generateSessionAndConversationSummary skips when summary is not stale')` -- generate summary, call combined generation, assert no API call
11. `it('onSessionComplete fallback path does not use force=true')` -- mock combined generation to throw, assert the fallback `generateSummary` call does NOT pass `force=true`

**Per-message removal tests (Change 3):**

12. `it('onSessionActivity is not called from assistant message handler')` -- this is more of a sessionManager integration test. Verify that during streaming, `onSessionActivity` is only called once (on turn completion), not on each message.

**Template interaction test (Change 4):**

13. `it('generateSummaryNow cancels pending debounce timer')` -- call `onSessionActivity`, then immediately call `generateSummaryNow`, advance timers past debounce delay, assert `callClaude` was called only once (from `generateSummaryNow`, not from the timer)

### Existing tests to update

14. `it('onSessionComplete forces regeneration regardless of staleness')` (line 1101) -- this test currently ASSERTS `force=true` behavior. It needs to be updated to assert the NEW behavior: skip LLM when current, do lightweight outcome update instead.

### Verification after deploy

15. Query `agent_call_logs` table: confirm gap distribution shifts to 60s+ range
16. Monitor total summary token usage over 24h: should drop 80%+
