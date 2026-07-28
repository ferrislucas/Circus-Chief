# Implementation Plan: Scoped & Throttled Live Streaming on the Session List View

**Companion to:** `frd-session-list-streaming-subscriptions.md`
**Status:** Draft plan (no code written yet)
**Date:** 2026-07-27
**Methodology:** Strict **Red → Green → Refactor** TDD. Every workstream starts
with a failing test that encodes the FRD requirement, then the minimum code to
pass, then cleanup. Do not write production code before its failing test exists.

---

## 0. How to use this plan

- The work is split into five **independent workstreams (A–E)**, ordered by
  leverage/safety. Each can ship as its own PR.
- Each workstream lists its **RED** tests first (the failing tests that "surface
  the work"), then the **GREEN** change, then **REFACTOR**.
- **Recommended order:** A → B → C → D → E. A and B together resolve the reported
  symptom; C–E are hardening.
- Run unit tests per package:
  - `yarn workspace @circuschief/server test <file>`
  - `yarn workspace @circuschief/web test <file>`
- E2E (only where noted): `./scripts/pw.sh test ...` — never port 5000.

### Requirement → workstream traceability

| FRD Req | Workstream |
|---------|------------|
| R5, R6, R7 (delivery rate) | A |
| R1, R4 (subscribe to filtered list) | B |
| R2, R3, R10 (viewport + collapse gating, hydrate on entry) | C |
| R8 (per-key reactivity) | D |
| R9 (rendering cost) | E |
| AC1–AC6 | see each workstream's "Acceptance mapping" |

---

## Workstream A — Throttle & de-duplicate the server broadcast

**FRD:** R5, R6, R7 · **Acceptance:** AC3 (bounded msg rate), contributes AC5.
**Root-cause fix; highest leverage. Touches only the server.**

### Context / current behavior
- `packages/server/src/services/commandRunner.js`
  - `run()` registers `child.stdout/stderr.on('data', handleData)`.
  - `handleData` (≈ line 161) calls `onOutput(text)` **per chunk**.
  - There is already a per-run `entry.outputBuffer` + `entry.bufferFlushTimer`
    (`setInterval(..., this.outputBufferFlushInterval)` = **500ms**) whose
    `#flushOutputBuffer` currently only writes to the **DB** — it does **not**
    broadcast.
- `packages/server/src/api/sessions-commands.js`
  - `broadcastCommandOutput(ctx, output)` sends `COMMAND_RUN_OUTPUT` to **both**
    the session channel and the project channel (≈ lines 20–22).
- `child.on('close', ...)` flushes remaining processor text and calls
  `onComplete(exitCode, output)` with the **full** output.

### Target behavior
- During streaming, `onOutput` is invoked at most once per flush interval per run
  (coalesced), carrying the accumulated delta — **not** once per chunk.
- Completion still delivers full/remaining output promptly (unchanged semantics).
- Reduce duplicate delivery to a client subscribed to both channels (R6).

### RED — failing tests first
Add to `packages/server/src/services/commandRunner.test.js`:

1. **`it('coalesces rapid output into at most one onOutput per flush interval')`**
   - Use `vi.useFakeTimers()`. Construct `CommandRunner` with a small/injectable
     flush interval (see Green note — make interval injectable).
   - Drive `handleData` with many synchronous chunks (either via a fake child
     emitter, or by extracting `handleData` — see Refactor). Assert `onOutput`
     was **not** called per chunk; after advancing one interval it is called
     **once** with the concatenated text.
   - *Fails today* because `onOutput` fires per chunk.

2. **`it('still emits complete output on process close even if buffer pending')`**
   - Feed chunks, then close before a flush tick. Assert final `onComplete`
     output contains all chunks and no data is lost. Guards R7 against regressions
     from batching.

3. **`it('does not emit an onOutput after completion')`**
   - Ensures the flush timer is cleared on close (no post-complete stragglers).

Add to `packages/server/src/api/sessions-commands.test.js` (create if absent;
otherwise co-locate with existing command route tests):

4. **`it('broadcasts COMMAND_RUN_OUTPUT without double-delivering to a dual-subscribed client')`**
   - Mock `broadcastToSession`/`broadcastToProject`. Assert the throttled path
     results in a single logical delivery per flush (encodes R6). If we keep both
     channels, assert payloads carry a stable `seq`/`offset` the client can
     dedupe on (see Green option 2).

### GREEN — minimum changes
- Make the flush interval **injectable** via constructor option (default keeps
  current 500ms) so tests can shrink it: `new CommandRunner({ outputBufferFlushInterval })`.
- Route the **WS broadcast through the existing buffer/timer** rather than per
  chunk:
  - In `handleData`, keep appending to `entry.output` and `entry.outputBuffer`;
    **remove** the immediate `onOutput(text)` call.
  - In `#flushOutputBuffer` (or a sibling that runs on the same timer), after the
    DB append, call `onOutput(flushedDelta)` with the text that was flushed.
    (Thread `onOutput` into the entry, or flush from the interval closure that
    already has `onOutput` in scope.)
  - On `close`/failure paths, flush the remaining buffer **and** emit the final
    delta through `onOutput` before `onComplete`, preserving R7.
- For R6, choose one:
  - **Option 1 (simplest):** attach a monotonically increasing `seq` per run to
    each `COMMAND_RUN_OUTPUT` payload in `sessions-commands.js`; client dedupes by
    `(runId, seq)`. (Pairs with Workstream B/D client dedupe already present.)
  - **Option 2:** when a socket is subscribed to both the session and project
    channel, deliver on only one. (Larger change to the broadcast layer — defer
    unless Option 1 proves insufficient.)

### REFACTOR
- Extract `handleData` and the flush/broadcast logic into small named private
  methods so the test can exercise them without a real child process.
- Ensure a single source of truth for "flush = DB write + broadcast" so the two
  can't drift.
- Confirm `outputBufferFlushInterval` default unchanged for production.

### Acceptance mapping
- **AC3:** test 1 proves bounded emission; add an assertion that N chunks over T
  ms yields ≈ `T / interval` emissions.
- **AC5/AC6:** no behavior change to completion or detail view; covered by tests
  2–3 plus existing suite staying green.

---

## Workstream B — Subscribe to the *filtered* list, not the raw list

**FRD:** R1, R4 · **Acceptance:** AC1.
**Small, safe, immediate win. Client only.**

### Context / current behavior
- `packages/web/src/composables/useRunningSessionSubscriptions.js`
  - The `watch` source is
    `sessionsStore.sessions.filter(s => running/starting).map(id)` — the **raw**
    list.
- `packages/web/src/views/SessionListView.vue` renders
  `filteredGroupedSessions` (from `useSessionFiltering`), which applies status /
  starred / scheduled filters.
- Result: running sessions hidden by the active filter still stream.

### Target behavior
- The composable subscribes only to sessions that are **both** running/starting
  **and** present in the currently displayed (filtered) list.

### RED — failing tests first
Extend `packages/web/src/composables/useRunningSessionSubscriptions.test.js`
(reuses existing `mockSessionsStore`, `mockSubscriptionInstances`, mounted
test-component harness):

1. **`it('does not subscribe to a running session that is filtered out of the list')`**
   - Provide the composable a source of **visible** session IDs (see Green: pass
     a getter/ref of visible ids). Seed a running session that is *not* in the
     visible set. Assert `useSessionSubscription` was **not** called for it /
     `subscribe` not invoked. *Fails today* (subscribes to all running).

2. **`it('subscribes when a previously-filtered running session becomes visible')`**
   - Start filtered-out, then add it to the visible set; assert it subscribes and
     hydrates.

3. **`it('unsubscribes a running session that becomes filtered out')`**
   - Inverse of #2; assert `cleanup`/`unsubscribe` called, and pending
     hydration/clear timeouts cancelled (R4 race-safety).

### GREEN — minimum changes
- Change `useRunningSessionSubscriptions()` to derive its subscribe set from the
  **intersection of running status and visible IDs**. Options:
  - Pass a `visibleSessionIds` ref/getter into the composable from
    `SessionListView.vue` (which already computes `filteredGroupedSessions`); or
  - Move/duplicate the filtering selector into the store as a getter both the
    view and composable consume.
  - Prefer injecting `visibleSessionIds` to keep the composable pure and testable.
- Update the `watch` source to the intersection; keep existing
  subscribe/unsubscribe/hydrate/cleanup machinery intact.

### REFACTOR
- Factor the "visible running session IDs" selector so the view and composable
  share exactly one definition (avoid drift with `useSessionFiltering`).
- Verify `onUnmounted` still tears down all subscriptions.

### Acceptance mapping
- **AC1:** test 1 is the direct encoding (filtered-out running session has no
  active subscription).

---

## Workstream C — Gate subscriptions by collapse state & viewport

**FRD:** R2, R3, R10 · **Acceptance:** AC2, AC4.
**Builds on B. Client only. Includes hydrate-on-entry correctness.**

### Context / current behavior
- `packages/web/src/components/SessionLogStream.vue` renders
  `v-if="hasContent && !isCollapsed"`; collapse state lives in
  `sessionStreaming` store (`collapsedSessionLogs`, persisted to localStorage).
- Even when collapsed or off-screen, the store still processes/stores every
  incoming message for that session.
- Hydration already exists: `hydrateStreamingState()` fetches
  `/api/sessions/:id/streaming-state` and dedupes work logs by `id`.

### Target behavior
- **R3:** a collapsed panel's session is not subscribed (or its stream is dropped
  before store processing).
- **R2:** a card scrolled out of view (beyond a margin) releases its subscription;
  re-entering re-subscribes.
- **R10:** on (re)entry, hydrate current state so nothing is missing and dedupe so
  nothing is duplicated.

### RED — failing tests first
1. In `useRunningSessionSubscriptions.test.js`:
   **`it('does not subscribe to a running session whose log panel is collapsed')`**
   - Mark session collapsed in the (mock) streaming store; assert no subscription.
   - **`it('re-subscribes and hydrates when a collapsed panel is expanded')`**
   - Toggle collapse off; assert `subscribe` + `hydrateStreamingState` (fetch)
     called, and that duplicate work-log ids are not double-counted (R10).

2. New composable `useElementVisibility` (or reuse if one exists — grep first):
   `packages/web/src/composables/useElementVisibility.test.js`
   **`it('reports not-visible when IntersectionObserver reports 0 intersection')`**
   and the inverse. Mock `IntersectionObserver`. *Fails until composable exists.*

3. `SessionLogStream` (or a thin wrapper) test:
   **`it('registers a live subscription only while visible and expanded')`**
   - Drive the mocked visibility + collapse; assert subscribe/unsubscribe calls.

### GREEN — minimum changes
- Extend the "should subscribe" predicate (from B) to also require
  `!isSessionLogCollapsed(id)` and `isVisible(id)`.
- Add `useElementVisibility` wrapping `IntersectionObserver` with a root margin
  (e.g. `200px`) so subscriptions pre-warm just before scroll-in.
- Wire each `SessionLogStream`/`SessionCard` to report its visibility up to the
  subscription manager (via injected callback or a small registry ref).
- On (re)entry call the existing `hydrateStreamingState(id)`; rely on existing
  dedupe-by-id in `hydrateSessionState`.

### REFACTOR
- Centralize the subscribe predicate: `running && visible && !collapsed && inFilteredList`
  in one function used by tests and runtime.
- Ensure teardown paths cancel `clearTimeouts` and `hydrationRetries` (extend
  existing cleanup) to keep R4 guarantees.

### Acceptance mapping
- **AC2:** collapsed-session test — no per-message processing (assert store
  mutators not called for that id).
- **AC4:** off-screen release + on-screen restore-within-~1s test (fake timers +
  mocked hydration returning content).

---

## Workstream D — Trim reactivity storms in the streaming store

**FRD:** R8 · **Acceptance:** contributes AC5.
**Client only. Pure refactor guarded by tests.**

### Context / current behavior
- `packages/web/src/stores/sessionStreaming.js` reassigns whole maps on every
  message: `this.sessionWorkLogs = { ...this.sessionWorkLogs }`,
  `this.sessionPartialText = { ...this.sessionPartialText, [id]: v }`, etc.
- Whole-map reassignment invalidates every component depending on the map, not
  just the changed session.

### RED — failing tests first
Add to `packages/web/src/stores/sessionStreaming.test.js`:

1. **`it('updating one session's work logs does not change the identity of other sessions' entries')`**
   - Seed sessions A and B. Capture reference to `store.sessionWorkLogs['B']`.
   - `addSessionWorkLog('A', ...)`. Assert `store.sessionWorkLogs['B']` is the
     **same reference** (`toBe`). *Fails today* because of `{ ...spread }`.
2. Analogous tests for `setSessionPartialText` and `setPartialThinking`
   (unrelated sessions' values keep identity).
3. **Regression:** existing behavioral tests (cap at 15 work logs, hydrate merge,
   clear ephemeral) must remain green.

### GREEN — minimum changes
- Mutate per key instead of reassigning the container:
  - `this.sessionWorkLogs[id].push(log)` (arrays are reactive in Vue 3 / Pinia);
    for a new id, assign `this.sessionWorkLogs[id] = [...]` once.
  - `this.sessionPartialText[id] = v`, `this.partialThinkingBySession[id] = v`.
- Remove the trailing `this.x = { ...this.x }` "trigger reactivity" lines that
  were compensating for the spread pattern.

### REFACTOR
- Sweep the store for the whole-map-reassignment idiom and normalize to per-key
  updates. Keep getters stable.
- Confirm no component relied on map identity changing (search usages).

### Acceptance mapping
- **AC5:** fewer invalidations per message; validated qualitatively via
  before/after DevTools trace plus the identity tests as a proxy.

---

## Workstream E — Reduce per-update layout cost of the output render

**FRD:** R9 · **Acceptance:** contributes AC5.
**Client only. Lower priority; mostly CSS/render strategy.**

### Context / current behavior
- `packages/web/src/components/CommandBlock.vue` and the log panes render output
  into `<pre>` with `white-space: pre-wrap; word-break: break-word` and
  `max-height` scroll. `pre-wrap` + `word-break` forces full re-layout on each
  content change — expensive on mobile and a direct heat contributor.

### RED — failing tests first
(Rendering perf is hard to unit-assert; keep tests behavioral + guard the knobs.)
1. In `CommandBlock.test.js`:
   **`it('caps rendered lines and exposes show-more without re-rendering full output when collapsed')`**
   - Assert only `MAX_LINES` (+ ellipsis) render until expanded — protects the
     existing truncation so E doesn't regress it.
2. **`it('applies the low-reflow output class')`** — assert the `<pre>` uses the
   chosen class (e.g. `content-visibility: auto` / `contain` styling) so the CSS
   contract is locked by a test.

### GREEN — minimum changes
- Apply CSS containment to output blocks: `contain: content;` and/or
  `content-visibility: auto` with `contain-intrinsic-size` so off-screen and
  unchanged blocks skip layout/paint.
- Evaluate dropping `word-break: break-word` in favor of `overflow-x: auto` on a
  non-wrapping `<pre>` for the streaming pane (wrapping is the costly part);
  confirm horizontal scroll UX is acceptable on mobile.

### REFACTOR
- If containment is insufficient under stress, spike list virtualization for the
  live log pane (windowed render). Track as a follow-up, not required for AC5.

### Acceptance mapping
- **AC5:** before/after DevTools Performance trace should show reduced
  Recalculate Style / Layout time; tests lock the render contract.

---

## Cross-cutting validation (do after A + B, repeat after C–E)

Reproduce the FRD baseline (§8 of the FRD) and confirm the acceptance criteria:

- **AC1** — filter to hide a running session → no active subscription (unit +
  manual).
- **AC3** — high-output run → client WS message rate bounded to ≈ flush cadence
  (server unit test + manual Network tab count).
- **AC4** — scroll a running card off/on screen → releases/restores within ~1s,
  no duplicate/missing output.
- **AC5** — manual mobile (or throttled emulation) run of a unit-test suite on the
  list view: no prior heat/lag; capture a DevTools Performance trace showing
  reduced WS tasks and style/layout time vs. a captured baseline.
- **AC6** — single session **detail** view streaming unaffected (regression run of
  its existing tests + a manual smoke).

Optional E2E (`./scripts/pw.sh test`): a spec that starts a chatty command in one
session, asserts the list view stays responsive and that a filtered-out running
session shows no live-output panel / receives no stream.

---

## Risks & mitigations

- **Batching could feel less "live."** Mitigate by keeping the flush interval
  modest (200–300ms target per FRD Q3) and emitting the final delta immediately
  on completion (R7).
- **Visibility gating races** (rapid scroll/filter). Mitigate via the centralized
  predicate + existing timeout-cancellation cleanup; cover with R4 tests.
- **Hydration gaps on re-entry.** Rely on the existing REST snapshot + dedupe-by-id
  and add the explicit re-entry test (AC4/R10).
- **Dedupe seq drift (Option 1).** Keep `seq` per-run and reset on run start;
  client tolerates gaps (ordering, not exactly-once).

## Out of scope (per FRD §5)
Circus Commands redesign, detail-view streaming changes, full terminal/log
virtualization rewrite, and WebSocket transport/protocol changes.
