# Implementation Plan: User stop pauses a lane run instead of cancelling it

**Source FRD:** `frd-user-stop-pauses-lane-run.md` (FR-10.1 … FR-10.9)
**Approach:** Option A — stop moves only the `execution_state` dimension to `paused`
**Method:** Strict **red → green → refactor** for every phase. No production line is written
before a test that fails for the right reason.
**Date:** 2026-08-06

---

## 0. Executive summary

Nine phases. Each phase is a self-contained red/green/refactor cycle that can be committed
independently and leaves the suite green. Phases 1–2 build the primitive, 3–5 rewire the two
call sites and prove the resume path end-to-end, 6 pins the invariants against regression,
7 fixes the frontend coupling the FRD did not account for, 8–9 are docs and full-suite
verification.

**Two findings that change the FRD's scope** are described in §1 before the phases. Read
those first — Finding A is a G3 (never-interpret-a-stop-as-success) violation that the FRD's
implementation as written would introduce.

---

## 1. Findings from code review — read before implementing

### Finding A (blocker) — the graceful-break abort path can advance the card

`sessionExecution.js:137-141`:

```js
for await (const event of agent.execute(queryParams, agentCallMeta)) {
  if (controller.signal.aborted) break;
  await handleStreamEvent(sessionId, event);
}
const { wasRescheduled, heldForLimit } = await handleTurnCompletion(...);
...
if (interactive && workflowTurn?.executionStateBeforeTurn !== 'paused') return;
const reconciled = finalizeOwnWorkCompletion(sessionId);
```

An abort has **two** exits, not one:

1. The agent generator rejects → the `catch` block at line 158. This is the path FR-10.2
   describes (`controller.signal.aborted ? 'cancelled' : 'closed_failed'`).
2. The generator yields one more event after the abort → the loop `break`s **normally**,
   falls through to `handleTurnCompletion`, and — for a non-interactive lane worker
   (`runSession`, which is exactly how a lane's on-entry root is started) — reaches
   `finalizeOwnWorkCompletion`.

Today path 2 is harmless only because `stopSession` has already set
`own_work_state='cancelled'`, so `finalizeOwnWorkCompletion`'s `own_work_state !== 'open'`
guard makes it a no-op. **Under Option A that guard stops firing**: own work stays `open`, so
a user stop that happens to exit via path 2 would close own work `closed_successfully` and
**advance the card** — a direct violation of G3.

The FRD's §7 "Affected code" table only lists line 179 (the catch branch). It must also cover
the post-loop fall-through. This plan adds **FR-10.2b** to Phase 4 and a dedicated red test
for it.

### Finding B — `useLaneRunStatus.js` string-matches the paused label

`packages/web/src/composables/useLaneRunStatus.js:16`:

```js
export function isPausedLaneRun(run) {
  return run?.status === 'open' && run.blockingReason === 'Paused — provider limit or outage';
}
```

`KanbanBoard.vue:202-204` uses this to render a **"Resume"** link instead of "View blocker" on
a paused card. FR-10.6 changes the label for user-stop pauses, which would silently degrade
the Resume affordance to "View blocker" for exactly the case the FRD is trying to make
recoverable — and G4 says recovery must work through existing affordances.

Rather than adding a second string to match, this plan exposes a machine-readable
`pauseKind` (`'user_stop' | 'provider_limit' | null`) from `getRun()` and keys the composable
off that. `blockingReason` stays a purely human-facing string. Phase 7.

### Finding C — stale `workflow_reason` on resume

`attachRootSession` nulls `workflow_reason`, but nothing clears it afterwards while a session
stays open. Once pauses write a reason, a session that is user-stopped, resumed, and then hits
a provider limit would still carry `'Stopped by user'` and be mislabeled. `beginWorkflowTurn`
must clear it. Phase 5.

### Open questions — decisions taken

| OQ | Decision | Rationale |
|---|---|---|
| OQ-1 premature advancement on a conversational reply | **(a) Accept** | Matches the FRD recommendation and the pre-existing FR-9.8 tradeoff on the same line-155 branch. Phase 6 adds an explicit *characterization* test so the behavior is documented, not accidental. |
| OQ-2 sessions with a pending schedule | **Leave `scheduled`** | Reuse `markHeldForLimit`'s existing `scheduled_at IS NULL AND pending_prompt IS NULL` guard verbatim in the generalized primitive. Test in Phase 1. |
| OQ-3 indefinitely paused runs | **Verify only** | Phase 6 greps/asserts no scheduler or reconciliation loop treats a long-open run as a fault. No code change expected. |
| OQ-4 deleted participating sessions | **Out of scope** | Pre-existing, orthogonal to the pause mechanism. Recorded as follow-up in §11. |
| OQ-5 recovery for already-cancelled runs | **No migration** | Recover manually by moving the card (FR-10.8). Documented in §11. |

> These are defaults chosen to keep the change reviewable. Flag now if OQ-1 or OQ-4 should go
> the other way — OQ-1 (b)/(c) would add a phase between 4 and 5; OQ-4 would add a phase after 6.

---

## 2. Target design

### The pause primitive

Generalize `markHeldForLimit` (`workflowSessionService.js:224`) into a single reason-carrying
primitive, with `markHeldForLimit` retained as a thin wrapper so FR-9.8 call sites and their
tests are untouched:

```js
export const PAUSE_KINDS = { USER_STOP: 'user_stop', PROVIDER_LIMIT: 'provider_limit' };

/**
 * FR-9.8 / FR-10.1: suspend a participating session's execution without
 * discharging its own-work obligation. Idempotent: a session already paused
 * is not re-paused and emits no second audit event (FR-10.3).
 */
export function pauseOwnWork(sessionId, { kind, reason, auditEvent, auditDetails }) { … }

export function markHeldForLimit(sessionId) {
  return pauseOwnWork(sessionId, {
    kind: PAUSE_KINDS.PROVIDER_LIMIT,
    reason: 'Paused — provider limit or outage',
    auditEvent: 'own_work_held_for_limit',
    auditDetails: () => ({ heldAt: now(), turnId: id() }),   // preserve FR-9.8 per-turn nonce
  });
}

export function pauseForUserStop(sessionId) {
  return pauseOwnWork(sessionId, {
    kind: PAUSE_KINDS.USER_STOP,
    reason: 'Stopped by user',
    auditEvent: 'own_work_paused_by_user',
    auditDetails: (time) => ({ pausedAt: time }),
  });
}
```

Guarded UPDATE (this is what makes FR-10.3 idempotency free):

```sql
UPDATE sessions
   SET execution_state='paused', workflow_reason=?, workflow_updated_at=?
 WHERE id=? AND lane_run_id IS NOT NULL AND own_work_state='open'
   AND scheduled_at IS NULL AND pending_prompt IS NULL
   AND execution_state <> 'paused'          -- NEW: idempotency guard (FR-10.3)
```

`changes !== 1` → return `false` **before** the audit insert, so a duplicate pause never emits
a second event. Distinct pause *cycles* still emit distinct events because
`beginWorkflowTurn` moves `execution_state` back to `'running'` on resume, and the details
carry a fresh timestamp so `audit()`'s `operation_key` differs.

The `execution_state <> 'paused'` guard is additive and cannot regress FR-9.8: the existing
"records a distinct audit event for each separately held turn" test flips the state to
`'running'` between the two calls.

### Reason-aware blocker label + `pauseKind`

`blockerDetails` (line 430) gains a paused-label resolver driven by the first paused session's
`workflow_reason`; `getRun()` gains `pauseKind`:

```js
function pausedLabel(session) {
  return session?.workflow_reason === 'Stopped by user'
    ? 'Paused — stopped by user'
    : 'Paused — provider limit or outage';
}
// getRun(): pauseKind: paused.length
//   ? (paused[0].workflow_reason === 'Stopped by user' ? 'user_stop' : 'provider_limit')
//   : null
```

`pauseKind` is reported whenever a paused member exists, independent of whether pause is the
*winning* blocker — the "Resume" affordance should appear even if a scheduled sibling
outranks it in `blockerDetails` precedence. (Confirm this reading in Phase 2's test; the
alternative — tie it to the winning blocker — is a one-line change either way.)

### Call-site rewiring

| File | Line | Change |
|---|---|---|
| `sessionManager.js` | 8, 382 | Import `pauseForUserStop`; replace `closeOwnWork(sessionId, 'cancelled', 'Stopped by user')` |
| `sessionExecution.js` | 179 | Abort branch → `pauseForUserStop(sessionId)`; non-aborted error branch unchanged |
| `sessionExecution.js` | ~142 (new) | **FR-10.2b**: after the stream loop, `if (controller.signal.aborted) { pauseForUserStop(sessionId); return; }` — before `handleTurnCompletion` |
| `workflowSessionService.js` | 140-153 | `beginWorkflowTurn` clears `workflow_reason` (Finding C) |
| `workflowSessionService.js` | 224 | `markHeldForLimit` → `pauseOwnWork` wrapper |
| `workflowSessionService.js` | 430, 441 | Reason-aware label + `pauseKind` |
| `workflowSessionService.js` | 293-296 | W4 comment: `closeOwnWork` is no longer the user-stop path |
| `useLaneRunStatus.js` | 15-17 | `isPausedLaneRun` keys off `pauseKind` |

---

## 3. Phase 0 — Baseline (no code change)

**Goal:** know the starting state so a "red" is unambiguous.

```bash
yarn workspace @circuschief/server test src/services/workflowSessionService.test.js
yarn workspace @circuschief/server test src/services/sessionManager.test.js
yarn workspace @circuschief/server test src/services/sessionExecution.workflowFailure.test.js
yarn workspace @circuschief/server test src/services/sessionExecution.workflowTransition.test.js
yarn workspace @circuschief/web test src/composables/useLaneRunStatus.test.js
yarn workspace @circuschief/web test src/components/KanbanBoard.test.js
```

Record pass counts. **Exit criterion:** all six green.

---

## 4. Phase 1 — The pause primitive (FR-10.1, FR-10.3, OQ-2)

**File under test:** `packages/server/src/services/workflowSessionService.js`
**Test file:** `packages/server/src/services/workflowSessionService.test.js`, new
`describe('pauseForUserStop (FR-10.1/FR-10.3)')` block, placed after the existing
`markHeldForLimit` block and reusing its `participatingWorker()` helper.

### 🔴 Red — write these first, run, confirm each fails with `pauseForUserStop is not a function`

1. **pauses without discharging the obligation** — after `beginWorkflowTurn` +
   `pauseForUserStop(worker.id)`: `executionState === 'paused'`,
   `ownWorkState === 'open'`, `subtreeOutcome === 'open'`, `getRun(run.id).status === 'open'`,
   `kanbanCards.getById(card.id).laneId === source.id`. *(FR-10.1, FR-10.5)*
2. **persists the reason** — `sessions.getById(worker.id).workflowReason === 'Stopped by user'`.
   *(FR-10.6 storage half)*
3. **emits `own_work_paused_by_user` and neither cancel event** — query
   `kanban_lane_run_audit_events` for the run: contains exactly one
   `own_work_paused_by_user`; contains zero `own_work_cancelled` and zero `run_cancelled`.
   *(FR-10.7, AC-4)*
4. **is idempotent** — call `pauseForUserStop` twice in a row: second returns `false`,
   audit rows for `own_work_paused_by_user` still `toHaveLength(1)`. *(FR-10.3)*
5. **records a distinct event across separate pause cycles** — pause, `beginWorkflowTurn`
   (resume), pause again → two `own_work_paused_by_user` rows. Proves the idempotency guard
   is per-transition, not per-run. *(FR-10.7)*
6. **is a no-op for a non-participating session** — plain session: returns `false`,
   `executionState` stays `'idle'`, `ownWorkState` stays `'open'`. *(FR-10.9)*
7. **does not open a transaction for a non-participating session** — mirror the existing
   `supersedeRunForCard` hot-path test: `vi.spyOn(databaseManager, 'transaction')`,
   `expect(transaction).not.toHaveBeenCalled()`. *(FR-10.9, explicit "no transaction merely
   to discover non-participation")*
8. **leaves a scheduled continuation scheduled** — set
   `{ scheduledAt: Date.now() + 60_000, pendingPrompt: 'continue' }`, then
   `pauseForUserStop` → returns `false`, `executionState !== 'paused'`. *(OQ-2)*
9. **does not reopen closed work** — `closeOwnWork(worker.id, 'closed_failed', 'boom')` then
   `pauseForUserStop` → `false`, `ownWorkState` still `'closed_failed'`.

### 🟢 Green

Implement `pauseOwnWork` / `PAUSE_KINDS` / `pauseForUserStop`, and re-express
`markHeldForLimit` as the wrapper. Add the `execution_state <> 'paused'` guard.

### 🔵 Refactor

- Verify the four pre-existing `markHeldForLimit` tests still pass **unmodified** — that is
  the proof the generalization is behavior-preserving (AC-8).
- Collapse any duplicated SQL between the two wrappers into `pauseOwnWork` alone.
- Confirm `pauseOwnWork` is the only place that writes `execution_state='paused'`.

---

## 5. Phase 2 — Reason-aware blocker label + `pauseKind` (FR-10.6)

**Test file:** same, extend the Phase 1 `describe`.

### 🔴 Red

1. **user-stop pause reports the user-stop label** —
   `getRun(run.id)` matches `objectContaining({ pausedCount: 1, blockingSessionId: worker.id,
   blockingReason: 'Paused — stopped by user', pauseKind: 'user_stop' })`. *(AC-3)*
2. **provider-limit pause is unchanged** — `markHeldForLimit` → `blockingReason` is still
   `'Paused — provider limit or outage'`, `pauseKind === 'provider_limit'`. This is the
   existing FR-9.8 test extended with `pauseKind`; the label assertion must stay byte-identical.
3. **`pauseKind` is null with no paused member** — a plain open run.
4. **`pauseKind` survives blocker-precedence loss** — pause the worker, then add a *scheduled*
   child so `blockingReason` becomes `'Waiting for scheduled work'`; assert `pauseKind` is
   still `'user_stop'`. Locks in the design decision from §2.
5. **precedence itself is unchanged** — the existing "keeps scheduled work ahead of paused
   work" test still passes unmodified.

### 🟢 Green

`pausedLabel()` helper in `blockerDetails`; `pauseKind` in the `getRun()` return object.

### 🔵 Refactor

Extract the `'Stopped by user'` literal into an exported constant
(`USER_STOP_REASON`) shared by `pauseForUserStop` and `pausedLabel` so the two can never drift.
Consider whether `pauseKind` should be persisted rather than derived from the reason string —
**no** for now: derivation keeps the schema untouched, and the constant removes the drift risk.

---

## 6. Phase 3 — `stopSession` pauses (FR-10.1, FR-10.9)

**File under test:** `packages/server/src/services/sessionManager.js:365-386`
**Test file:** `packages/server/src/services/sessionManager.test.js`, the existing
`describe('stopSession workflow cancellation (W4, FR-9.4)')` block — **rename** it to
`describe('stopSession workflow pause (FR-10.1)')`.

### 🔴 Red

1. **Rewrite** the existing `'closes the own-work obligation as cancelled …'` test into
   `'pauses the own-work obligation for a lane-run participant, without moving its card'`.
   Same fixture (board / lanes / workspace / card / root / run / `attachRootSession`), new
   assertions after `await stopSession(root.id)`:
   - `updated.ownWorkState === 'open'` *(was `'cancelled'`)* — **AC-2**
   - `updated.executionState === 'paused'` — **AC-2**
   - `updated.workflowReason === 'Stopped by user'`
   - `getRun(run.id).status === 'open'` *(was `'cancelled'`)* — **AC-2**
   - `getRun(run.id).blockingReason === 'Paused — stopped by user'` — **AC-3**
   - `cardRepo.getById(card.id).laneId === source.id`
   This test **fails red against current code** (it will observe `'cancelled'`) — that is
   exactly the FRD's §1.1 bug, surfaced as a test.
2. **audit trail** — after the stop, the run's audit events contain `own_work_paused_by_user`
   and contain neither `own_work_cancelled` nor `run_cancelled`. **AC-4**
3. **non-participant unchanged** — keep the existing
   `'is a no-op for a session that does not participate in a lane run'` test verbatim.
   **AC-6**
4. **status still becomes `stopped`** — `sessionRepo.getById(root.id).status === 'stopped'`
   for the participating session. Pins FR-10.1's "the two dimensions are independent".
5. **summary still fires** — the existing `stopSession summary integration` test must keep
   passing unmodified.

### 🟢 Green

Swap the import and the single call at `sessionManager.js:382`; update the FR-9.4 comment
above it to reference FR-10.1.

### 🔵 Refactor

Check whether `closeOwnWork` still has any `'cancelled'` caller. If Phase 4 removes the last
one, **do not** delete the `'cancelled'` branch — `computeSubtreeOutcome` and
`reconcileLaneRun` still consume `own_work_state='cancelled'`, and the outcome is reachable
via data written by older versions. Leave a comment saying so.

---

## 7. Phase 4 — Abort paths pause (FR-10.2, FR-10.2b, FR-10.3)

**File under test:** `packages/server/src/services/sessionExecution.js`
**Test file:** new `packages/server/src/services/sessionExecution.workflowPause.test.js`,
modeled on `sessionExecution.workflowFailure.test.js` (same repo/fixture setup, same
`stubThrowingAgent` pattern, real `runSession` entry point).

### 🔴 Red

1. **catch-path abort pauses instead of cancelling (FR-10.2)** — stub an agent whose
   generator rejects, with the session's controller already aborted (grab it from
   `activeSessions`, or drive the whole thing through `stopSession` — prefer driving
   `stopSession` so the test matches production ordering). Assert
   `ownWorkState === 'open'`, `executionState === 'paused'`, `getRun(run.id).status === 'open'`,
   card did not move.
2. **🔥 graceful-break abort does not advance the card (FR-10.2b — Finding A)** — stub an
   agent that yields one event, has the test abort the controller mid-stream, then yields a
   second event and returns **cleanly** (no throw). Drive via `runSession` (non-interactive).
   Assert `ownWorkState === 'open'`, `executionState === 'paused'`,
   `cardRepo.getById(card.id).laneId === source.id`, `getRun(run.id).status === 'open'`, and
   `drainLaneEntryTriggerMock` not called.
   **This test must be written and confirmed red before touching line 142** — against
   current `main` it passes only by accident (via the pre-existing `closeOwnWork` cancel),
   so **write it as the very first commit of this phase, run it against unmodified code to
   see it pass, then run it again immediately after Phase 3's green** — it will flip to red.
   That red is the whole point of the phase. Note this ordering explicitly in the commit
   message.
3. **non-aborted permanent error still fails (FR-10.2, AC-5)** — the existing
   `sessionExecution.workflowFailure.test.js` test
   `'a permanent execution failure fails the run and does not move the card (AC-8)'` must
   pass **unmodified**. Add a companion assertion in the new file that no
   `own_work_paused_by_user` event was emitted on that path.
4. **transient retry still keeps the run open (AC-7)** — existing test unmodified.
5. **stop + abort together emit one pause event (FR-10.3)** — drive a real
   `stopSession` against a running stubbed agent so *both* the `stopSession` pause and the
   `_executeSession` catch-path pause run for one user action. Assert exactly one
   `own_work_paused_by_user` audit row. This is the integration-level counterpart to
   Phase 1 test 4.

### 🟢 Green

- `sessionExecution.js:179` → `pauseForUserStop(sessionId)` when
  `controller.signal.aborted`, else `closeOwnWork(sessionId, 'closed_failed', error.message)`.
  Keep the `throw error` after either.
- New post-loop guard before `handleTurnCompletion`:
  ```js
  // FR-10.2b: an abort can also exit the stream loop cleanly (the `break`
  // above). Own work stays open under FR-10.1, so falling through to
  // finalizeOwnWorkCompletion would close a user-stopped turn as a success
  // and advance the card — G3 violation. Pause and bail out here instead.
  if (controller.signal.aborted) { pauseForUserStop(sessionId); return; }
  ```
- Rewrite the FR-9.2/FR-9.4 doc comment at lines 174-178.

### 🔵 Refactor

- Both abort exits now call the same one-liner — consider a local
  `handleAbortedTurn(sessionId)` if it reads better; do not over-abstract two call sites.
- Re-read the `finally { cleanupSessionState(...) }` block: confirm it touches no workflow
  columns (verified — it only clears in-memory maps).

---

## 8. Phase 5 — Resume restores supervision (FR-10.4, Finding C)

**Test files:** `workflowSessionService.test.js` (unit) and
`sessionExecution.workflowTransition.test.js` (integration, extends the existing
`markHeldForLimit` resume test).

### 🔴 Red

**Unit — `beginWorkflowTurn`:**
1. **reports `executionStateBeforeTurn: 'paused'` after a user stop** — `pauseForUserStop`
   then `beginWorkflowTurn(worker.id)` returns `{ executionStateBeforeTurn: 'paused' }` and
   sets `execution_state='running'`. *(FR-10.4)*
2. **clears the stale reason (Finding C)** — after that `beginWorkflowTurn`,
   `sessions.getById(worker.id).workflowReason` is `null`; then `markHeldForLimit` →
   `blockingReason === 'Paused — provider limit or outage'`, `pauseKind === 'provider_limit'`
   (not the stale `'Stopped by user'`).
3. **records the turn** — a `turn_started` audit event exists for the resumed turn, proving
   the resumed session is no longer detached (the §1.1 failure).

**Integration — `sessionExecution.workflowTransition.test.js`:**
4. **`stopSession` → `continueSession('continue', { interactive: true })` advances the card
   (AC-1)** — the headline acceptance test. Mirror the existing
   `'allows an interactive follow-up to complete a worker held for a provider limit'` test,
   substituting a real `stopSession(root.id)` for `markHeldForLimit(root.id)`. Assert
   `ownWorkState === 'closed_successfully'`, `getRun(run.id).status === 'succeeded'`,
   `cardRepo.getById(card.id).laneId === target.id`,
   `drainLaneEntryTriggerMock` called once.
5. **resume via a non-interactive path also advances** — same fixture, resume via
   `runSession`/scheduled continuation instead of an interactive continue.
   *(FR-10.4's "regardless of how the session is resumed")*
6. **the existing FR-9.8 provider-limit resume test passes unmodified** — **AC-8**.

### 🟢 Green

Add `workflow_reason=NULL` to `beginWorkflowTurn`'s UPDATE. **Expect tests 1, 3, 4, 5 to
already be green** once Phases 1–4 land — `own_work_state` never leaves `'open'`, so the
existing line-155 machinery does all the work. That "no new control flow" result is the
central claim of Option A; if any of them is still red, the Option A rationale has a hole and
that must be resolved before proceeding.

### 🔵 Refactor

Update `beginWorkflowTurn`'s doc comment to state that a turn start clears the pause reason.

---

## 9. Phase 6 — Invariant pins (FR-10.5, FR-10.8, OQ-1, OQ-3)

Regression fences. Expect these **green on first run** — they exist to fail if someone later
reintroduces cancel-on-stop.

### 🔴/🟢 Tests

1. **a paused member blocks its run (FR-10.5)** — paused worker → `getRun` reports
   `status: 'open'`, `pausedCount: 1`, `blockingSessionIds` contains the worker; card unmoved.
2. **card move while paused still supersedes (FR-10.8, AC-7)** — `pauseForUserStop`, then
   `supersedeRunForCard(card.id, 'manual_move')` → run `'superseded'`,
   `card.activeLaneRunId === null`, worker's `ownWorkState` still `'open'`, `run_superseded`
   audited.
3. **card removal while paused still supersedes (FR-10.8)** — same via the removal path.
4. **OQ-1 characterization test** — `stopSession`, then a *conversational* interactive
   continue, and assert the card **does** advance, with a comment naming OQ-1(a) and pointing
   at `sessionExecution.js:155`. Documents the accepted tradeoff; makes any future change
   to it a deliberate, visible test edit rather than a silent behavior shift.
5. **OQ-3 verification (analysis, not a test)** — grep `schedulerService.js`,
   `sessionStartupRecovery.js`, and `kanbanService.js` for any age-based or status-based
   sweep over `kanban_lane_runs` / `execution_state='paused'`. Expect none. Record the finding
   in the PR description. Add a test only if a sweep is found.

### 🔵 Refactor

Fold Phases 1–2's and 6's user-stop tests into one coherent `describe` tree; make sure
`participatingWorker()` is the single fixture helper.

---

## 10. Phase 7 — Frontend Resume affordance (Finding B)

**Files:** `packages/web/src/composables/useLaneRunStatus.js`,
`packages/web/src/composables/useLaneRunStatus.test.js`,
`packages/web/src/components/KanbanBoard.test.js`

### 🔴 Red

1. **`isPausedLaneRun` is true for a user-stop pause** —
   `{ status: 'open', pauseKind: 'user_stop', blockingReason: 'Paused — stopped by user' }`
   → `true`. Fails today (string mismatch).
2. **still true for a provider-limit pause** —
   `{ status: 'open', pauseKind: 'provider_limit', … }` → `true`.
3. **false for a non-paused open run** — `{ status: 'open', pauseKind: null }` → `false`.
4. **false for a terminal run** — `{ status: 'cancelled', pauseKind: 'user_stop' }` → `false`.
5. **KanbanBoard renders "Resume" for a user-stopped card** — extend the existing
   `KanbanBoard.test.js` paused fixture (line ~210) with a `pauseKind: 'user_stop'` variant
   and assert the link text is `Resume`, with the `lane-run-resume-link` class.
6. **the card shows the user-stop reason text** — `'Paused — stopped by user'` appears in the
   rendered blocker line (`KanbanBoard.vue:189`).

### 🟢 Green

```js
export function isPausedLaneRun(run) {
  return run?.status === 'open' && Boolean(run.pauseKind);
}
```

### 🔵 Refactor

Grep the web package for any other `blockingReason` string comparison. Note in the composable's
doc comment that `blockingReason` is display-only and `pauseKind` is the machine-readable
discriminator.

> **G4 check:** this adds no new UI. It keeps the *existing* Resume link working for a second
> pause cause. If that reads as scope creep, the fallback is Phase 7 option "match both
> strings" — same tests 1–6, weaker implementation.

---

## 11. Phase 8 — Documentation and comment revisions

No behavior change; the suite must stay green throughout.

- `workflowSessionService.js:176-188` — `closeOwnWork` doc: remove "user stops/cancellations";
  state that `'cancelled'` now only arrives from legacy data and non-stop cancellation paths.
- `workflowSessionService.js:293-296` — W4 comment: `closeOwnWork` is no longer the user-stop
  path; `pauseForUserStop` is, and it is deliberately non-terminal.
- `workflowSessionService.js:218-223` — generalize the FR-9.8 header over `pauseOwnWork`.
- `sessionExecution.js:174-178` — rewrite for FR-10.2/FR-10.2b.
- `sessionManager.js:379-381` — FR-9.4 → FR-10.1.
- **Follow-ups to record in the PR body, not to implement:**
  - OQ-4 — `cleanupSessionForDeletion` does not reconcile a deleted participating session's
    run. More reachable now that sessions can sit paused indefinitely.
  - OQ-5 — runs already cancelled by this bug (e.g. `74365d3d-2cf2-4a3a-b1a5-1a7403e51ff9`)
    stay terminal; recover by moving the card.
  - OQ-1 — accepted tradeoff, pinned by the Phase 6 characterization test.

---

## 12. Phase 9 — Full verification

```bash
yarn workspace @circuschief/server test
yarn workspace @circuschief/web test
yarn lint
```

Optional end-to-end confirmation of AC-1 through the real UI:

```bash
./scripts/pw.sh test --grep="kanban"
```

**Acceptance-criteria traceability:**

| AC | Covered by |
|---|---|
| AC-1 stop → continue → card advances | Phase 5 test 4 (+ optional E2E) |
| AC-2 run open / own work open / execution paused | Phase 3 test 1 |
| AC-3 `blockingReason` identifies a user stop | Phase 2 test 1, Phase 3 test 1 |
| AC-4 pause event, no cancel events | Phase 1 test 3, Phase 3 test 2 |
| AC-5 genuine error still fails the run | Phase 4 test 3 |
| AC-6 non-participant stop unchanged | Phase 1 tests 6-7, Phase 3 test 3 |
| AC-7 move while paused supersedes | Phase 6 test 2 |
| AC-8 existing FR-9.8 coverage passes | Phase 1 refactor, Phase 2 test 2, Phase 5 test 6 |
| (new) G3 preserved on the graceful-break abort | Phase 4 test 2 |

---

## 13. Risk register

| Risk | Mitigation |
|---|---|
| **Graceful-break abort advances the card (Finding A)** | Phase 4 test 2, written *before* the fix and explicitly re-run after Phase 3 to observe the flip to red. Highest-priority test in the plan. |
| Stop/abort double-pause emits duplicate audit events | `execution_state <> 'paused'` guard returns before the audit insert; Phase 1 test 4 + Phase 4 test 5. |
| Generalizing `markHeldForLimit` regresses FR-9.8 | All four existing FR-9.8 tests must pass **unmodified**; `markHeldForLimit` keeps its exact signature, label, and per-turn audit nonce. |
| Stale `workflow_reason` mislabels a later pause (Finding C) | `beginWorkflowTurn` clears it; Phase 5 test 2. |
| Frontend Resume link silently lost (Finding B) | `pauseKind` + Phase 7. |
| Run stays open forever with no resume | Intended (FR-10.8 escape hatch); OQ-3 verification in Phase 6 test 5. |
| Conversational reply advances the card (OQ-1) | Accepted; pinned by the Phase 6 characterization test so it can never change silently. |

---

## 14. Suggested commit sequence

1. `test: pin graceful-break abort behavior on a lane-run session` *(Phase 4 test 2, green on main)*
2. `feat: add reason-carrying pause primitive to workflowSessionService` *(Phase 1)*
3. `feat: distinguish user-stop from provider-limit pauses in getRun` *(Phase 2)*
4. `fix: stopSession pauses a lane run instead of cancelling it` *(Phase 3 — commit 1's test goes red here and is fixed in commit 5)*
5. `fix: both abort exits pause instead of closing own work` *(Phase 4)*
6. `fix: clear the pause reason when a workflow turn begins` *(Phase 5)*
7. `test: pin FR-10.5/FR-10.8 invariants and the OQ-1 tradeoff` *(Phase 6)*
8. `fix: keep the card Resume link working for user-stop pauses` *(Phase 7)*
9. `docs: revise cancel-on-stop contract comments` *(Phase 8)*

> Commit 4 knowingly leaves commit 1's test red for one commit. If a bisectable-green history
> is required, squash commits 4 and 5.
