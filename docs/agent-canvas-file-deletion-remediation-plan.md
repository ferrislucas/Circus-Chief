# Remediation Plan: Agent Canvas Whole-File Deletion (PR #1067)

## Context

PR #1067 implements `DELETE /api/workspaces/:id/canvas/file/:filename`, which moves
every active version of a filename to **recoverable canvas trash** (soft-delete),
returning `{ filename, trashedCount }`. The implementation is faithful to the FRD
and all affected server tests pass.

Code review surfaced issues that block a clean merge. This plan addresses them.
Every code/test task follows **red → green → refactor**: write a failing test that
surfaces the missing behavior first, watch it fail, then make it pass, then tidy up.

---

## Issue 1 (High): PR description contradicts the implemented behavior

The PR Summary claims the endpoint *"permanently delete[s] all versions ... (including
trashed ones)"* and returns `deletedCount`. The code does the opposite: recoverable
soft-delete to trash, **excluding** already-trashed rows, returning `trashedCount`.
Permanent deletion is an explicit FRD non-goal. Anyone merging on the strength of the
description would be misled.

### Fix (documentation only — no red/green needed)

- Rewrite the PR #1067 description so it accurately states:
  - The endpoint moves **all active versions** of the named file to **recoverable
    canvas trash** (soft-delete), not permanent deletion.
  - Already-trashed versions are left untouched and excluded from the count.
  - The success body is `{ filename, trashedCount }`.
  - A `404 { error: "File not found on canvas" }` is returned when no active version exists.
- Keep the test-plan section, but correct any wording that implies permanence.

---

## Issue 2 (Medium): Missing websocket-event test (FR-6 / acceptance #6)

FR-6, acceptance criterion 6, and the FRD Test Requirements all explicitly require
verifying that the endpoint emits exactly **one `canvas:remove` event per newly
trashed version**, and **none** on a 404. The broadcast is implemented in
`packages/server/src/api/canvas.js` but has zero test coverage.

### Fix — red / green / refactor

1. **Red:** In `packages/server/src/api/canvas.test.js`, add tests using the existing
   websocket test seam (or a narrowly scoped spy/mock on `broadcastToSession`) that
   assert:
   - Deleting a file with N active versions produces exactly N `CANVAS_REMOVE`
     (`canvas:remove`) broadcasts to the **root** session, one per trashed item ID,
     with payload `{ sessionId: rootSessionId, itemId }`.
   - A 404 (absent / already-fully-trashed filename) produces **zero** broadcasts.
   - Run the suite and confirm these new tests **fail** (no assertion existed before,
     so they must be written to genuinely exercise the broadcast path).
2. **Green:** The production broadcast already exists; ensure the tests pass against
   the current implementation. If the test seam requires wiring, add only what is
   needed to observe the broadcasts at the route boundary.
3. **Refactor:** Keep the assertion at the route boundary — do not couple it to
   websocket delivery internals. De-duplicate any setup with the existing delete tests.

---

## Issue 3 (Low): Dead-code guard in `trashAllActiveVersionsByFilename`

In `packages/server/src/db/CanvasItemRepository.js`, the
`result.changes !== rows.length` check can never trigger: the `SELECT` and `UPDATE`
run in a single synchronous `better-sqlite3` transaction with identical `WHERE`
clauses and no interleaving writer, so the counts always match.

### Fix (choose one; keep the change small)

- **Preferred:** Simplify to a single `UPDATE ... RETURNING id` (better-sqlite3
  supports `RETURNING`), deriving `trashedIds`/`trashedCount` directly from the
  affected rows. This removes the redundant `SELECT` and the unreachable guard in
  one step.
- **Alternative:** If `RETURNING` is avoided for consistency with the rest of the
  repo, add a brief comment documenting that the guard is a defensive belt-and-
  suspenders check, and leave it.

### Red / green / refactor

1. **Red:** Add/extend a repository test in
   `packages/server/src/db/CanvasItemRepository.test.js` asserting the returned
   `trashedIds` are exactly the IDs of the rows that were active before the call
   (independent of how they're gathered). If switching to `RETURNING`, this test
   pins the contract before refactoring.
2. **Green:** Implement the simplification so the test passes.
3. **Refactor:** Ensure existing `trashAllActiveVersionsByFilename` tests still pass
   and behavior is unchanged (atomicity, ordering, exclusion of trashed rows).

---

## Issue 4 (Low, optional): `updated_at` consistency on soft-delete

`trashAllActiveVersionsByFilename` sets `deleted_at` but not `updated_at`. This
matches the single `softDelete`, but `softDeleteBatch` and the recover methods do
touch `updated_at`. This is a pre-existing inconsistency, not introduced by this PR.

### Fix (only if we want repo-wide consistency)

- Decide the convention (recommend: soft-delete operations set `updated_at` too).
- If adopted: **Red** — add a test asserting `updated_at` is bumped on trash;
  **Green** — set `updated_at = ?` in the `UPDATE`; **Refactor** — align `softDelete`
  for consistency. Otherwise, explicitly note it as out of scope for this PR.

---

## Validation

Run the focused suites while iterating, then the full server suite:

```bash
yarn workspace @circuschief/server test src/db/CanvasItemRepository.test.js src/api/canvas.test.js src/services/sessionPrompts.test.js
yarn workspace @circuschief/server test
```

Optionally re-run the E2E suite (`./scripts/pw.sh test`) since canvas behavior is
touched.

## Completion criteria

- PR description accurately describes recoverable-trash semantics and `trashedCount`.
- New websocket tests prove one `canvas:remove` per trashed version and none on 404
  (written red-first).
- The repository dead-code guard is removed via a `RETURNING`-based simplification
  (or explicitly documented), covered by a test.
- All server unit tests pass; no regressions in existing canvas behavior.
