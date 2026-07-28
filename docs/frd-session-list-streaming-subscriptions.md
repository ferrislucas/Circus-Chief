# FRD: Scoped & Throttled Live Streaming on the Session List View

**Status:** Draft
**Author:** Circus Chief team
**Date:** 2026-07-27
**Area:** `packages/web` (session list streaming) + `packages/server` (command output broadcast)

---

## 1. Summary

The project **session list view** currently subscribes to the live WebSocket
stream of **every running session in the project**, and the server broadcasts
command output **per stdout/stderr chunk on two channels**. When a session runs
a high-output command (e.g. a unit-test run), this produces a flood of messages
and re-renders. On mobile this manifests as the **device heating up** and the
**UI becoming sluggish/unresponsive**.

We want the list view to stream only what it is actually **displaying** (visible,
un-filtered, expanded), and we want output delivery to be **rate-limited** so a
single noisy command cannot saturate a client — especially a phone.

---

## 2. Background & Context

### 2.1 What the session list view does today

- `SessionListView.vue` calls `useRunningSessionSubscriptions()`, which opens a
  per-session WebSocket subscription for **all** sessions whose status is
  `running` or `starting`.
- Each running `SessionCard` renders a `SessionLogStream` ("Live Output") panel
  showing work logs, streaming text, and thinking.
- Command runs (Circus Commands) stream their stdout/stderr into the same view
  via `COMMAND_RUN_OUTPUT` WebSocket messages, routed through
  `useProjectSessionSubscription` → `commandButtons` store.

### 2.2 Where the cost comes from

1. **Server broadcasts per chunk, on two channels.**
   `commandRunner.js` calls `onOutput(text)` on every `data` event from the
   child process; `sessions-commands.js` then broadcasts each chunk to **both**
   the session channel and the project channel. A test runner emits hundreds of
   chunks/sec → hundreds of WS frames/sec × 2. (An existing `outputBuffer` /
   `bufferFlushTimer` only batches DB persistence, **not** the WS broadcast.)

2. **The list subscribes to the superset, not what's shown.**
   The subscription watches the **unfiltered** session list
   (`sessionsStore.sessions`), while the list actually renders
   `filteredGroupedSessions`. As a result the client streams sessions that are:
   - filtered out of view (e.g. "idle only" filter hides running sessions,
     but they keep streaming),
   - collapsed (`collapsedSessionLogs` — panel renders nothing but store still
     processes every message),
   - scrolled off-screen / below the fold.

3. **Reactivity storms.**
   `sessionStreaming` store reassigns entire maps on every message
   (`this.sessionWorkLogs = { ...this.sessionWorkLogs }`, etc.), invalidating
   every dependent component rather than the one card that changed.

4. **Layout-heavy rendering.**
   Output renders into `<pre>` with `white-space: pre-wrap; word-break: break-word`,
   which forces full re-layout on each update — disproportionately expensive on
   mobile browsers, and the most direct contributor to sustained heat.

### 2.3 Why it wasn't caught

When sessions stream only a trickle of work-log entries, subscribing to all of
them is cheap. The design only falls over under the **high-output command**
case, and primarily on **mobile**, where CPU/GPU headroom and thermal limits are
much tighter than on desktop.

---

## 3. Problem Statement

> On the session list view, a single high-output command run (or several running
> sessions at once) overwhelms the client with WebSocket traffic and re-renders,
> causing mobile devices to heat up and the UI to become slow to respond.

Two root issues:

- **Scope:** the client streams more than it displays.
- **Rate:** each stream delivers output faster than a client needs (or can
  comfortably render), unthrottled, and duplicated across two channels.

---

## 4. Goals

- **G1 — Stream only what is displayed.** The list view should maintain live
  subscriptions only for sessions that are currently **visible** (pass the active
  filter, panel expanded, in/near the viewport).
- **G2 — Bound the delivery rate.** Command output (and ideally all streaming)
  should be coalesced/throttled so message volume is roughly constant regardless
  of how chatty the underlying command is.
- **G3 — Preserve correctness.** When a card becomes visible (scrolled into view,
  filter cleared, panel expanded), it must quickly backfill and show current
  live output with no missing or duplicated content.
- **G4 — Mobile stays cool and responsive.** A running test suite on a phone
  should not cause noticeable heat or input lag on the session list view.

## 5. Non-Goals

- Redesigning the Circus Commands feature or its output storage/persistence.
- Changing the single **session detail** view's streaming (it watches one
  session and is not the source of this problem).
- Full log virtualization / terminal emulator rewrite (may be a follow-up; not
  required to resolve the reported symptom).
- Changing WebSocket transport/protocol fundamentals.

---

## 6. Desired Behavior (Requirements)

### 6.1 Subscription scope

- **R1.** The list view MUST only hold a live subscription for a session when
  that session is part of the currently **rendered/filtered** list
  (`filteredGroupedSessions`), not the raw session list.
- **R2.** A session's live subscription SHOULD be gated by viewport visibility:
  when its card is scrolled out of view (beyond a small pre-fetch margin), the
  subscription MAY be released; when it re-enters, it MUST re-subscribe and
  backfill.
- **R3.** When a card's Live Output panel is **collapsed**, the client SHOULD NOT
  process/store streaming output for that session (no subscription, or an
  immediately-dropped stream).
- **R4.** Subscribing/unsubscribing MUST be race-safe: rapid filter changes,
  scrolling, or status flips must not leak subscriptions or drop the wrong one.

### 6.2 Delivery rate

- **R5.** The server MUST coalesce command output and broadcast on an interval
  (target: one flush per ~200–300ms per run) rather than per stdout/stderr chunk.
- **R6.** The server SHOULD avoid delivering the same output twice to a client
  that is subscribed to both the session and project channels (dedupe at the
  source, or send on a single channel per client).
- **R7.** Final/complete output MUST still be delivered in full and promptly when
  a run finishes (throttling applies to the streaming phase, not completion).

### 6.3 Rendering & reactivity

- **R8.** Incoming streaming updates SHOULD invalidate only the affected card,
  not all cards (avoid whole-map reassignment patterns in the streaming store).
- **R9.** Output rendering SHOULD avoid layout modes that force full re-layout on
  every update where a cheaper alternative exists.

### 6.4 Correctness on (re)entry

- **R10.** When a session becomes visible/expanded, the client MUST hydrate
  current streaming state (existing REST snapshot mechanism) so no content is
  missing, and MUST dedupe against any live messages to avoid duplication.

---

## 7. Acceptance Criteria

- **AC1.** With the list filtered to hide a running session, that session's
  WebSocket stream is **not** active (verifiable: no subscription / no incoming
  messages for it).
- **AC2.** A running session whose Live Output panel is collapsed produces no
  per-message store processing for that session.
- **AC3.** During a high-output command run, client-received WS message rate for
  that run is bounded (≈ 3–5 msg/sec target), not proportional to raw output
  volume.
- **AC4.** A session scrolled off-screen releases its subscription; scrolling it
  back into view restores live output within ~1s with correct, non-duplicated
  content.
- **AC5.** Manual mobile check: running a unit-test suite from a session while on
  the list view does not cause the previously observed heat/lag (qualitative,
  plus a DevTools Performance trace showing reduced WS tasks and
  style/layout time vs. baseline).
- **AC6.** No regression in the single session detail view's live streaming.

---

## 8. How to Reproduce (Baseline)

1. Open a project's session list view on a phone (or throttled mobile emulation).
2. Start a Circus Command that produces heavy output (e.g. a full unit-test run)
   in one running session.
3. Observe: device heats up, list UI becomes sluggish.
4. In desktop DevTools → Performance, record ~5s and note the dense WebSocket
   message tasks and long Recalculate Style / Layout bars; Network tab shows the
   per-chunk × 2-channel message volume.

---

## 9. Open Questions

- **Q1.** Viewport gating granularity: `IntersectionObserver` per card vs. a
  simpler "filtered list only" scope for a first cut? (Filtered-list scope is a
  small, safe first step; viewport gating is the fuller fix.)
- **Q2.** Should throttling live in the command runner (per-run) or a shared
  broadcast layer that also covers agent work-log/partial streams?
- **Q3.** Target flush interval and max message rate — confirm 200–300ms /
  ~3–5 msg/sec meets UX expectations for "feels live."
- **Q4.** Do we want a hard client-side cap on concurrent live subscriptions
  regardless of visibility (safety valve on very large projects)?
