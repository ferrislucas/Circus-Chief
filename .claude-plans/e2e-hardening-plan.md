# E2E Test Hardening Plan

Goal: eliminate the hard failure and flakes observed in the latest Playwright run, and make the suite resilient to resource starvation caused by worker parallelism on a shared test server.

## Observed Problems (from playwright-tests-output.txt)

| # | Test | Result | Symptom | Root Cause |
|---|------|--------|---------|------------|
| 1 | `session-actions.spec.ts:477` — "shows empty state when no active sessions" | **FAILED (both attempts)** | `.empty-state` OR `.session-card` not visible after 10s | View is stuck in `skeleton-list` (`v-if="loading"`) or `.error-message` branch; test locator covers neither |
| 2 | `opus-4-7-model.spec.ts:109` — "can select Opus 4.7 model on a draft session" | Flaky (pass on retry) | `[data-testid="session-chat-handle"]` not visible in 10s | Session tree / websocket not ready when helper starts waiting |
| 3 | `opus-4-7-model.spec.ts:145` — "existing session with Opus 4.6 still shows correct model" | Flaky (pass on retry) | same as above | same as above |
| 4 | `session-actions.spec.ts:435` — "star filter works on active view" | Flaky (pass on retry) | seeded session not present in list in 8s + `waitForTimeout(500)` after click | Backend list-hydration lag under parallel load; star filter is client-side so a DOM signal (not network) is needed |

Common thread: **fixed 8–10s timeouts are too tight when workers saturate the shared server**, and several locators don't cover all legitimate UI states (loading / error).

## Baseline Facts (verified against the repo)

- `playwright.config.ts` sets `workers: 4`, `retries: 1` locally, `retries: 2` in CI, `expect.timeout: 10000`, `actionTimeout: 10000`, `navigationTimeout: 30000`.
- `tests/e2e/helpers.ts` **already exports** `waitForSessionStatus(sessionId, status, timeout)` at line 517 and `waitForSessionToExist(sessionId, timeout)` at line 171.
- `ActiveSessionsView.vue` has **two** `empty-state` branches: "no active sessions at all" (line 69) and "filter produced no matches" (line 82). It also renders `.skeleton-list` while loading and `.error-message` on error.
- `scripts/pw.sh` forwards all CLI args verbatim to `playwright test` — it does **not** parse `--workers`. No `PW_WORKERS` env is currently set.
- The star filter in `ActiveSessionsView.vue` is fully **client-side** (Pinia-derived `filteredSessions`) — clicking it produces no network request.

---

## Guiding Principles

1. **Cover every legitimate terminal state** in assertions — `.empty-state`, `.session-card`, `.error-message`, and explicitly wait for `.skeleton-list` to disappear.
2. **Wait on readiness signals, not wall-clock time** — replace `waitForTimeout(500)` with event-driven waits.
3. **Scale timeouts to worker count** — centralize timeout constants that grow when Playwright runs with more workers.
4. **Namespace test data aggressively** so parallel workers never look at each other's rows.
5. **Assert via API first, UI second** — use the REST API to confirm backend state before waiting on the DOM.
6. **Prove fixes with `retries: 0`** — local/CI `retries` currently masks flakes; verification must bypass them.

---

## Step-by-Step Plan

### Step 1 — Fix the hard failure: "shows empty state when no active sessions"

**File:** `tests/e2e/session-actions.spec.ts` (lines 477–510)

Actions (ordered):
1. After `navigateAndWait(page, '/sessions/active', …)`, wait for `.skeleton-list` to reach `state: 'hidden'` with `PAGE_READY_TIMEOUT` (Step 5).
2. Assert `.error-message` has count 0 with a short timeout; if it has count 1, read its text and fail with that text in the assertion message (no silent timeout).
3. Then assert the `.empty-state | .session-card` union is visible as today, but with `PAGE_READY_TIMEOUT` instead of 10s.

Explicit test coverage:
- Keep the existing test (`shows empty state when no active sessions`) — it becomes the regression test.
- Add a sibling test `renders page chrome even when loading takes long`: stub the sessions API to delay its response 5s and assert the skeleton shows, then disappears, then one of the terminal branches renders.

Acceptance: both tests pass 5/5 runs at the config-default worker count (`workers: 4`) **with `retries: 0`**.

### Step 2 — Fix the Opus 4.7 overlay-handle flakes

**Files:** `tests/e2e/helpers.ts` (`openSessionOverlay`), `packages/web/src/views/SessionDetailView.vue`, `tests/e2e/opus-4-7-model.spec.ts`.

Readiness contract (added to the Vue view):
- Add `data-testid="session-detail"` on the view's root element.
- Add a reactive `data-ready` attribute that is `"true"` iff: `sessionsStore.loading === false` AND the route's session exists in `sessionsStore` AND the session-tree initial fetch has resolved. Otherwise `"false"`.

Helper changes:
- `openSessionOverlay(page, timeout = OVERLAY_TIMEOUT)`:
  1. `await page.locator('[data-testid="session-detail"][data-ready="true"]').waitFor({ state: 'visible', timeout })`.
  2. Then wait on `[data-testid="session-chat-handle"]`.
- Keep existing post-click waits.

Spec changes:
- In both opus-4.7 tests, call `await waitForSessionToExist(session.id)` and `await waitForSessionStatus(session.id, 'stopped' | 'waiting', API_READY)` *before* `page.goto(...)`.

Explicit test coverage:
- Add a regression test in a new file `tests/e2e/session-detail-readiness.spec.ts`: creates a session, navigates, asserts `data-testid="session-detail"` renders with `data-ready="true"` before any overlay interaction; asserts it starts `"false"` via `page.waitForFunction` immediately after navigation (documents the contract).

Acceptance: both opus-4.7 tests pass 5/5 runs at `workers: 4` **with `retries: 0`**.

### Step 3 — Fix the "star filter" flake

**File:** `tests/e2e/session-actions.spec.ts:435`

Actions:
1. Before `navigateAndWait`, call `await waitForSessionStatus(session1.id, 'waiting')` and the same for `session2` (uses the existing helper in helpers.ts).
2. Replace `page.waitForTimeout(500)` after the star-filter click with a DOM-based deterministic wait (the filter is client-side, so there is no network response to await):
   - `await expect(page.locator('.filter-btn.star-btn')).toHaveClass(/star-filter-active/)`.
3. Replace `toBeVisible`/`not.toBeVisible` pair with `toHaveCount`:
   - `await expect(page.locator('.session-name').filter({ hasText: session1.name })).toHaveCount(1, { timeout: LIST_HYDRATION })`.
   - `await expect(page.locator('.session-name').filter({ hasText: session2.name })).toHaveCount(0, { timeout: LIST_HYDRATION })`.

Explicit test coverage:
- Keep the existing test; it is the regression guard.
- Add `star filter button reflects state immediately (no network)` test: click star filter on a pre-populated list, assert `.star-filter-active` class change inside 1s (no API call required).

Acceptance: test passes 5/5 runs at `workers: 4` **with `retries: 0`**.

### Step 4 — Harden the ActiveSessionsView UI contract

**File:** `packages/web/src/views/ActiveSessionsView.vue` and its unit test.

Template contract:
- Add `data-testid="active-sessions-view"` on the root `.container`.
- Add reactive `data-state` attribute taking exactly one of:
  - `loading` — when `sessionsStore.loading` is true.
  - `error` — when `sessionsStore.error` is truthy.
  - `empty-all` — `activeSessions.length === 0`.
  - `empty-filtered` — `activeSessions.length > 0 && filteredSessions.length === 0`.
  - `results` — otherwise.
- Add `data-testid="active-sessions-empty"` on both empty-state `<div>`s; the `data-state` attribute disambiguates which variant is showing.

Unit test updates (`packages/web/src/views/ActiveSessionsView.test.js`):
- Update existing loading/error/empty tests to assert on `data-state` value instead of class presence.
- Add new test `exposes empty-filtered state when all sessions are filtered out` (sets store to have sessions + active filter that matches none).
- Add new test `exposes results state when at least one card renders`.

E2E usage:
- `tests/e2e/session-actions.spec.ts` tests that currently wait for `.empty-state | .session-card` can switch to `[data-testid="active-sessions-view"][data-state]:not([data-state="loading"])` once this step lands.

Acceptance: existing Vitest + E2E suites pass; new unit tests added.

### Step 5 — Centralized, worker-aware timeout constants

**New file:** `tests/e2e/timeouts.ts`

Approach (works without changes to `pw.sh`):
```ts
import playwrightConfig from '../../playwright.config';

function detectWorkers(): number {
  // 1) Honor explicit env override (CI can set this)
  if (process.env.PW_WORKERS) return Number(process.env.PW_WORKERS);
  // 2) Sniff --workers from argv when run via npx playwright
  const arg = process.argv.find(a => a.startsWith('--workers'));
  if (arg) {
    const v = arg.includes('=') ? arg.split('=')[1] : process.argv[process.argv.indexOf(arg) + 1];
    const n = Number(v);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  // 3) Fall back to config
  // @ts-expect-error — defineConfig returns an object whose `workers` is typed optional
  return Number(playwrightConfig?.workers ?? 4);
}

const workers = detectWorkers();
const scale = Math.max(1, workers / 4);

export const PAGE_READY_TIMEOUT = Math.round(15000 * scale);
export const OVERLAY_TIMEOUT    = Math.round(20000 * scale);
export const LIST_HYDRATION     = Math.round(10000 * scale);
export const API_READY          = Math.round(5000  * scale);
```

Actions:
- Adopt these constants in `helpers.ts` (`openSessionOverlay` default), `session-actions.spec.ts`, and `opus-4-7-model.spec.ts`.
- **No change to `scripts/pw.sh` is required.** The argv sniff covers both `npx playwright test --workers=N` and the docker wrapper.
- Optionally, document `PW_WORKERS` in `CLAUDE.md`'s E2E section as a manual override.

Acceptance: increasing `--workers` at the CLI automatically scales waits; baseline behavior at `workers: 4` is unchanged.

### Step 6 — Test-isolation audit for `/sessions/active`

**Files:** `tests/e2e/session-actions.spec.ts`, `tests/e2e/helpers.ts`.

Actions:
- Audit every assertion under `Active Sessions View` that matches `.session-card` or `.session-name` without a unique-name filter; replace with name-scoped locators.
- Add a `scopedSessionCard(page, name)` helper:
  ```ts
  export function scopedSessionCard(page: Page, name: string) {
    return page.locator('.session-card').filter({ hasText: name });
  }
  ```
- Add a `scopedSessionName(page, name)` helper mirroring this for `.session-name`.

Explicit test coverage:
- Add a new test `two parallel-style seeds do not cross-match`: seed two sessions with names sharing a common prefix, assert that `scopedSessionCard` returns exactly one for each full name.

Acceptance: grep confirms no bare `.session-card` or `.session-name` `toBeVisible` assertion remains on Active-view specs.

### Step 7 — API-first preconditions (adopt existing helper, don't add one)

**File:** `tests/e2e/helpers.ts` (no new helper), all specs that currently navigate immediately after `updateSessionStatus`.

Actions:
- Reuse the existing `waitForSessionStatus` helper (already present at `helpers.ts:517`) consistently.
- In every place that calls `updateSessionStatus(...)` and is immediately followed by `page.goto(...)`, insert `await waitForSessionStatus(sessionId, status, API_READY)` between them.
- Document this pattern at the top of `helpers.ts` in a short comment block.

Explicit test coverage:
- `waitForSessionStatus` is already exercised implicitly by several existing tests; add a unit-style test in a new `tests/e2e/helpers.spec.ts` that asserts the helper resolves only after the API confirms the status change.

Acceptance: grep finds zero direct `updateSessionStatus` → `page.goto` sequences in `tests/e2e/` without an intervening `waitForSessionStatus`.

### Step 8 — Verification loop (with retries disabled)

Plan:
1. Run each of the four originally-failing specs 10 times at `workers: 4`, `retries: 0`:
   ```
   ./scripts/pw.sh test --repeat-each=10 --retries=0 tests/e2e/session-actions.spec.ts
   ./scripts/pw.sh test --repeat-each=10 --retries=0 tests/e2e/opus-4-7-model.spec.ts
   ```
2. Run each of those specs 5 times at `workers: 8` (stress), `retries: 0`, to validate the Step 5 timeout scaling. Note: `--workers=8` is a stress run only — the committed config stays at 4.
3. Run the full suite twice at `workers: 4`, `retries: 0`.
4. Capture output; attach to the PR.

Acceptance: 0 failures, 0 flakes across all four runs.

---

## File Change Summary

| File | Change | Step |
|------|--------|------|
| `tests/e2e/session-actions.spec.ts` | Harden empty-state + star-filter tests, adopt `scopedSessionCard`, `toHaveCount`, new timeouts | 1, 3, 6, 7 |
| `tests/e2e/opus-4-7-model.spec.ts` | Add `waitForSessionToExist` + `waitForSessionStatus` preconditions, use `OVERLAY_TIMEOUT` | 2, 7 |
| `tests/e2e/helpers.ts` | `openSessionOverlay` readiness signal, `scopedSessionCard`/`scopedSessionName`, import timeouts | 2, 5, 6 |
| `tests/e2e/timeouts.ts` | **New** — worker-aware timeout constants (argv-sniff + config fallback) | 5 |
| `tests/e2e/session-detail-readiness.spec.ts` | **New** — regression test for `data-ready` contract | 2 |
| `tests/e2e/helpers.spec.ts` | **New** — asserts `waitForSessionStatus` resolves only on matching status | 7 |
| `packages/web/src/views/ActiveSessionsView.vue` | Add `data-testid="active-sessions-view"` + `data-state` (`loading | error | empty-all | empty-filtered | results`), `data-testid="active-sessions-empty"` on both empty branches | 4 |
| `packages/web/src/views/ActiveSessionsView.test.js` | Update existing loading/error/empty assertions to check `data-state`; add `empty-filtered` and `results` tests | 4 |
| `packages/web/src/views/SessionDetailView.vue` | Add `data-testid="session-detail"` + reactive `data-ready` attribute tied to store readiness | 2 |

## Explicit Test Coverage Matrix

| Concern | New or updated test | Location |
|---------|---------------------|----------|
| Empty-state locator covers skeleton transitions | `renders page chrome even when loading takes long` (new) | `session-actions.spec.ts` |
| Empty-state hard failure regression | existing `shows empty state when no active sessions` (hardened) | `session-actions.spec.ts` |
| Overlay-handle readiness contract | `session-detail exposes data-ready once stores hydrate` (new) | `session-detail-readiness.spec.ts` |
| Opus-4.7 model selection under load | existing `can select Opus 4.7 model on a draft session` (hardened) | `opus-4-7-model.spec.ts` |
| Opus-4.6 dropdown regression | existing `existing session with Opus 4.6 still shows correct model in dropdown` (hardened) | `opus-4-7-model.spec.ts` |
| Star filter is deterministic, not network-bound | existing `star filter works on active view` (hardened) + `star filter button reflects state immediately (no network)` (new) | `session-actions.spec.ts` |
| `data-state=empty-filtered` vs `empty-all` | `exposes empty-filtered state when all sessions are filtered out` + `exposes results state when at least one card renders` (new) | `ActiveSessionsView.test.js` |
| Parallel-worker cross-match | `two parallel-style seeds do not cross-match` (new) | `session-actions.spec.ts` |
| `waitForSessionStatus` semantics | `waitForSessionStatus resolves only after API confirms status` (new) | `helpers.spec.ts` |

## Risk & Rollback

- All UI changes are purely additive (`data-testid` + `data-state` + `data-ready`). Zero behavioral risk.
- Timeout scaling only *increases* waits when worker count rises; at the default `workers: 4` it's a no-op.
- `ActiveSessionsView.test.js` assertions change — they are updated in the same commit.

## Out of Scope

- Refactoring `sessionManager` or backend hot paths for performance.
- Changing the committed `workers: 4` default — only used as a stress-run parameter in Step 8.
- Rewriting the overlay component itself.
