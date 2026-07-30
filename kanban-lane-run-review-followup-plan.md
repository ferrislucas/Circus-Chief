# Plan: Address PR #1066 Review Findings (Kanban Lane-Run Phase 1 — Follow-up)

**Scope:** Close the gaps found in the second review of PR #1066
(`circus-chief/02c8-take-look-workspace-2e1504f74f`). The F1–F8 remediation
landed correct *production* code, but one blocker (F2) shipped its fix **without
the mandated regression test**, and a few Phase-1 limitations should be recorded
or hardened. This plan does **not** re-implement the whole FRD — it makes the
Phase-1 foundation trustworthy before later phases build on it.

**Source of truth:** the review findings (#1–#5 below), cross-checked against
`kanban-lane-run-structured-completion-frd.md` (still on the canvas).

---

## 0. How we work: Red → Green → Refactor (MANDATORY)

**No production line — and no "fix" — lands without a test that failed first.**
For every item:

1. **RED** — Write the named test(s) first. Run them. **Confirm they fail for
   the stated reason** — assert on the *real* failure (a missing index after an
   upgrade, an un-failed run, an accepted non-legacy mode), not a generic throw.
   A test that passes on first write is a broken test: rewrite it until it
   genuinely surfaces the missing behavior. **For F1 specifically, the test MUST
   build from a pre-release-shaped DB, not a fresh `schema.sql` — a fresh build
   passes trivially and proves nothing (that blindness is exactly how the
   original index-drop bug slipped through).**
2. **GREEN** — Write the minimum production code (or, where the production code
   is already correct, just land the guarding test) to make the red test pass.
   Add no behavior a test does not demand.
3. **REFACTOR** — With tests green, clean up (extract helpers, dedupe, tighten
   naming, remove dead code). Re-run the full package suite; it must stay green.

**Global rules**

- Commit at each green step (small, reviewable commits); one item ≈ one or a
  few commits.
- Upgrade-path tests must run `allMigrations` end-to-end against a
  **pre-release-shaped** database (an old snapshot / `buildDbFromSnapshot`
  harness), **never** a fresh `schema.sql` build. On a fresh build the sessions
  FK is already `NO ACTION`, so `migrateSessionsImmutableParentage` skips
  `recreateSessionsTable` entirely and the drift path is never exercised.
- Before marking any item done, run:
  `yarn workspace @circuschief/server test`,
  `yarn workspace @circuschief/web test`, and `yarn lint`.
  Run E2E via `./scripts/pw.sh test` before closing the plan.
- Never weaken an existing test to make it pass.
- `legacy` behavior (default `completion_mode='legacy'`) must remain
  byte-for-byte unchanged throughout.

---

## 1. Priority ordering

1. **F1 — Upgrade-path + index-parity test for `idx_sessions_lane_run`**
   (**Medium; blocker**). The production fix is correct, but no test exercises
   the `recreateSessionsTable` upgrade path or locks recreate to `schema.sql`.
   This is the review's blocking finding — do it first.
2. **F2 — Record/guard the un-implemented failure & cancellation propagation**
   (Low). `own_work_state` is never set to `closed_failed`/`cancelled`, so the
   run-failure path is dead code today.
3. **F3 — Document the `attemptLaneRunTransition` activation gaps** (Low). Raw
   card `UPDATE`: no broadcast, no `sort_order`, no target on-enter automation.
4. **F4 — Skip `supersedeRunForCard` work for non-participating (legacy) cards**
   (Nit). Avoid an extra transaction on the legacy hot path.
5. **F5 — Expand the PR description to match the true scope** (Nit; docs only).

---

## F1 — Lock the sessions-index set across the upgrade path (Review #1 — BLOCKER)

**Finding:** `idx_sessions_lane_run` was correctly added to
`SESSIONS_INDEX_DDL` and `schema.sql`, but **no test proves it survives an
actual upgrade.** Every current test builds from a fresh `schema.sql`, where the
FK is already `NO ACTION`, so `migrateSessionsImmutableParentage` skips
`recreateSessionsTable` and the "recreate drops indexes" code path never runs.
`schemaBaseline.test.js` asserting the index "exists after a fresh init" and
`registration.test.js` asserting migration *ordering* both pass without ever
exercising the drift. The remediation plan's own exit criterion — *"an
index-parity test locks recreate to `schema.sql`"* — is unmet. A future index
added to `schema.sql` but forgotten in `SESSIONS_INDEX_DDL` would be silently
dropped on every upgraded install with zero test failures.

- **RED**
  - **Upgrade-path test** (new `migrations.upgrade.test.js` or equivalent
    harness): build a **pre-release-shaped** sessions table — one whose
    `parent_session_id` FK is the old `ON DELETE SET NULL` (so
    `migrateSessionsImmutableParentage` actually calls `recreateSessionsTable`)
    and which has `idx_sessions_lane_run` present. Run `allMigrations`
    end-to-end. Assert `idx_sessions_lane_run` **still exists** afterward via
    `PRAGMA index_list(sessions)` / `sqlite_master`. **Confirm it fails if you
    temporarily remove `idx_sessions_lane_run` from `SESSIONS_INDEX_DDL`** — that
    proves the test truly covers the recreate path, not a fresh build.
  - **Anti-drift parity test:** parse the `idx_sessions_*` index names declared
    in `schema.sql` and assert that set **equals** both (a) the set produced by
    a full upgrade of the pre-release snapshot, and (b) the set in
    `SESSIONS_INDEX_DDL`. Set-equality, so it catches *any* future index that
    lives in `schema.sql` but not in the recreate list (and vice-versa).
- **GREEN**
  - The production code is already correct, so ideally no change is needed. If
    the parity test surfaces a *different* drifted index (audit
    `idx_sessions_scheduled`'s partial `WHERE scheduled_at IS NOT NULL` clause,
    `idx_sessions_starred`, etc.), fix `SESSIONS_INDEX_DDL` to match
    `schema.sql`.
- **REFACTOR**
  - Prefer deriving the sessions-index DDL from a **single exported constant**
    consumed by both `schema.sql` verification and `recreateSessionsTable`, so
    the two physically cannot diverge; keep the parity test as belt-and-braces.

---

## F2 — Record (and fence) the un-implemented failure/cancellation propagation (Review #2)

**Finding:** `reconcileLaneRun` has branches for members in `closed_failed` /
`cancelled`, but **nothing in the shipped code ever sets those states.** So
FRD FR-9 / AC-8 (a permanent failure fails the run) is dead code. This is
acceptable for a fenced, dormant Phase-1 engine, but it must be explicit so a
future flag-flip doesn't silently ship an engine that can never fail a run.

- **RED**
  - Unit test on `reconcileLaneRun`: given a lane run whose member is
    `own_work_state='closed_failed'` (set directly in the test), assert the run
    transitions to `failed` and the card does **not** move. This documents and
    locks the *intended* semantics that later phases must wire up.
  - Add a test asserting there is currently **no production call path** that sets
    `closed_failed`/`cancelled` (e.g. grep-guard or an explicit
    `it.todo`/skipped integration test named for the missing wiring) so the gap
    is visible in the suite, not just in prose.
- **GREEN**
  - No behavior change required now. Add an inline `TODO` in
    `workflowSessionService.js` (and reference it from the `STRUCTURED_LANE_RUNS
    _ENABLED` gate comment) stating that failure/cancellation propagation
    (own-work → `closed_failed`/`cancelled`) is a prerequisite for un-fencing
    the engine.
- **REFACTOR**
  - Ensure the gate comment lists this alongside the existing B1/C1/C2
    prerequisites so "what must land before activation" lives in exactly one
    place.

---

## F3 — Document `attemptLaneRunTransition` activation gaps (Review #3)

**Finding:** on success `attemptLaneRunTransition` moves the card with a raw
`UPDATE kanban_cards SET lane_id=...` — **no `KANBAN_CARD_MOVED` broadcast, no
`sort_order` assignment in the target lane, and no target-lane on-enter
automation.** Correctly fenced by `STRUCTURED_LANE_RUNS_ENABLED=false`, so it is
not a live bug, but flipping the flag is **not** a one-line activation.

- **RED**
  - Test documenting current behavior: a (test-forced) successful structured run
    updates `card.lane_id` but emits **no** broadcast and starts **no** target
    session — asserted explicitly so the limitation is captured in the suite.
- **GREEN**
  - No behavior change now. Add a `TODO` at `attemptLaneRunTransition` listing
    the three missing pieces (broadcast, `sort_order`, target on-enter trigger)
    and linking them to the activation gate.
- **REFACTOR**
  - Keep the activation checklist in the single gate comment.

---

## F4 — Skip `supersedeRunForCard` work for legacy cards (Review #4 — nit)

**Finding:** `moveCard` calls `supersedeRunForCard` on **every** move, opening a
transaction even for legacy cards that never have an `active_lane_run_id`. Small
overhead on the 100%-of-current-cards legacy path.

- **RED**
  - Test asserting `moveCard` on a legacy card (no `active_lane_run_id`) opens
    **no** write transaction / performs **no** superseding write (spy/count on
    the DB path).
- **GREEN**
  - Cheap guard: read `active_lane_run_id` first (single indexed SELECT) and
    return early before opening the transaction when it is null.
- **REFACTOR**
  - Keep the early-out inside `supersedeRunForCard` so all callers benefit.

---

## F5 — Expand the PR description to the true scope (Review #5 — docs only)

**Finding:** the PR title/body mention only `parentSessionId` + the FK fix, but
the branch ships the entire Phase-1 lane-run schema, the dormant/fenced workflow
engine, and 8 remediation fixes across ~54 files. A reviewer reading only the
description would miss the engine.

- **GREEN** (no test)
  - Rewrite the PR description to summarize: (1) required-`parentSessionId`
    contract + removal of the silent workspace-root fallback, (2) deferred
    `NO ACTION` FK + immutable-parentage trigger, (3) Phase-1 lane-run schema and
    **dormant, flag-fenced** structured engine (explicitly note it is inert while
    `completion_mode='legacy'`), and (4) the F1–F8 remediation. Link the FRD.

---

## Exit criteria

Done when, each proven by a test that was **red before it was green** (or, for
docs-only items, landed and verified):

- An upgrade-path test builds a **pre-release-shaped** DB, runs `allMigrations`,
  and proves `idx_sessions_lane_run` survives the `recreateSessionsTable` path;
  a parity test locks the `idx_sessions_*` set across `schema.sql`,
  `SESSIONS_INDEX_DDL`, and the post-upgrade DB. Both fail if the index is
  removed from `SESSIONS_INDEX_DDL` (F1).
- `reconcileLaneRun`'s failure/cancellation semantics are locked by a test, and
  the missing own-work → `closed_failed`/`cancelled` wiring is recorded as an
  activation prerequisite in the gate comment (F2).
- `attemptLaneRunTransition`'s activation gaps (broadcast, `sort_order`, target
  automation) are captured by a test and a gate-linked `TODO` (F3).
- `moveCard`/`supersedeRunForCard` performs no write for legacy cards, proven by
  test (F4).
- The PR description reflects the full scope, including the dormant fenced engine
  (F5).
- `legacy` behavior is byte-for-byte unchanged; server + web unit suites and
  `./scripts/pw.sh test` are green; `yarn lint` clean.
