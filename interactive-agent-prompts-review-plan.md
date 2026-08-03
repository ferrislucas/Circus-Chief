# Remediation Plan — Interactive Agent Prompts (PR #1074, round 3)

**Source:** Review findings #1–#10 from the round-3 review of PR #1074.
**Feature branch:** `circus-chief/c958-are-familiar-question-tool`
**Applies to:** `@circuschief/server`, `@circuschief/web`, `@circuschief/shared`, `tests/e2e`
**FRD of record:** `frd-interactive-agent-prompts.md` (on the canvas)

---

## Working method — MANDATORY for every task below

Follow strict **Red → Green → Refactor** for each task. **No production code may be
written before a failing test exists that surfaces the actual gap.**

1. **Red** — Write the test(s) that describe the desired behavior *first*, and run them to
   watch them fail **for the right reason**. The failing assertion must expose the real gap
   (missing wiring, wrong value, absent route/field/handler/branch), not a trivial
   always-fail. Make the failing test demonstrable (commit it or capture the run) before
   writing any production code.
2. **Green** — Write the minimum production code to make the failing test pass.
3. **Refactor** — With tests green, clean up names, duplication, and structure.

Run `yarn test` (unit) and `./scripts/pw.sh test` (E2E). **Never use port 5000 for E2E** —
`pw.sh` handles server isolation. Run `yarn lint` before calling any task done.

Each task names the **test file to touch first**. If a task turns out to be genuinely
untestable, stop and document why in the FRD rather than skipping the Red step.

---

## Ordering rationale

The three blockers (#1–#3) gate everything else: the SDK contract must be verified before
its consumers can be trusted, and the autonomous-hang fix changes the park path that the E2E
scenarios exercise. Do them first, in order. Then close the high-severity FR-605 gap (#4),
then the medium correctness/coverage items (#5, #6, #7), and finish with hygiene (#8, #9,
#10). Re-run the full suite and tick the PR's manual-test box at the end.

---

## Task 1 — Resolve the blocking discovery spike + verify the real SDK contract (Issue #1) — **DO FIRST**

**Problem:** The whole permission path in `promptCallbacks.js` assumes the shape of the SDK
`canUseTool(toolName, input, opts)` callback — `opts.title / displayName / description /
blockedPath / decisionReason / suggestions / toolUseID / agentID / signal` — and that
`AskUserQuestion` routes through it. FRD §5 (D-1/D-3/D-4) declared this a **blocking**
discovery spike because the routing lives in the compiled `claude` binary and cannot be read
from source. It is still unresolved. If the real shape differs, permission cards render blank
and "Always allow" produces malformed `updatedPermissions`.

- **Red (discovery, non-shipping):** Per FRD §5, run instrumented `standard`-mode sessions
  against the real SDK/CLI baseline (`@anthropic-ai/claude-agent-sdk@0.3.163`) with a
  **logging-only** `canUseTool` + `onUserDialog` and confirm:
  - (D-1) `AskUserQuestion` routes through `canUseTool` (not `request_user_dialog`).
  - (D-3) which tools actually emit `can_use_tool` under `default` mode given
    `settingSources: ['user','project','local']`.
  - (D-4) the exact keys/shape of `opts` and of each `suggestions` entry
    (`PermissionUpdate` — per-tool vs. per-command-prefix, and its `destination` field).
  Record the findings by updating FRD §5.
- **Green:** Correct `promptCallbacks.js` and the wire payload projection in `promptStore.js`
  to match the verified contract. In particular, verify that
  `permissionResult`'s `updatedPermissions` mapping (spreading each suggestion + a
  `destination`) matches the SDK's real `PermissionUpdate` shape.
- **Refactor:** None beyond keeping the callback and payload projection readable.
- **Note:** This task's output is the ground truth the rest of the plan builds on. Do not
  proceed to Task 2's E2E specs until the contract is confirmed.

---

## Task 2 — Real end-to-end coverage of the prompt flow (Issue #2)

**Problem:** No cassette and no E2E spec exercise the feature. `VCRAgentAdapter` now invokes
`queryParams.options.canUseTool(...)` for `cassette.gatedToolCalls`, but nothing populates
`gatedToolCalls`, so the wiring is untested. The PR's "1180 tests pass" never touches this
path, and the manual-test checkbox is unchecked.

- **Red (E2E):** Add Playwright specs under `tests/e2e/` (e.g. `agent-prompts.spec.ts`) with
  cassettes carrying `gatedToolCalls` whose `opts` match the Task 1 findings. Each scenario
  fails until the flow works end-to-end:
  1. Question parked → answered → session resumes with `updatedInput.answers`.
  2. Permission **Allow once** resumes the agent.
  3. **Always allow** suppresses a second identical prompt in the same session
     (`updatedPermissions` applied).
  4. Page reload rehydrates a parked prompt via `GET /sessions/:id/prompt`.
  5. **Stop** clears a parked prompt as a clean deny (not a mid-flight abort).
- **Green:** Make each scenario pass against the finished behavior.
- **Refactor:** Fold the VCR `gatedToolCalls` setup into a reusable cassette helper. Keep the
  existing assertion that **codex and gemini** query params contain none of the new callbacks.
- **Manual:** Run a real `standard`-mode session that (i) writes a file (permission path) and
  (ii) calls `AskUserQuestion` (question path); tick the PR's manual-test checkbox.

---

## Task 3 — Fail-closed handling for unattended/autonomous sessions (Issue #3, FR-505)

**Problem:** `buildInteractionCallbacks` registers `canUseTool` for **every** session,
including `yolo`. `AskUserQuestion` routes through `canUseTool` regardless of permission mode,
so an autonomous/scheduled session whose model asks a question **parks indefinitely** with no
human to answer, blocking the agent until reschedule/token limits. FR-505 requires the feature
to fail closed.

- **Red (server):** Test in `promptStore.test.js` — when a prompt is parked for a session
  flagged autonomous/unattended (no interactive client; reuse whatever flag drives scheduled
  runs, e.g. `scheduledAt`/reschedule state), it resolves automatically as a fail-closed
  skip/deny (`{ behavior: 'deny', message: '<states the assumption to make>' }`) and emits a
  work log, rather than parking. Fails today (always parks).
- **Green:** Detect the autonomous/unattended condition in the park path and short-circuit to
  the fail-closed response, emitting a work log so the auto-skip is visible in history.
- **Refactor:** Centralize the decision in the prompt store, not scattered across callbacks;
  keep the interactive path unchanged.
- **Note:** If Product decides unattended sessions should still block, update the FRD to state
  the known-hang behavior explicitly rather than leaving it implicit.

---

## Task 4 — FR-605 parked-prompt flag + remove dead code (Issue #4)

**Problem:** `hasPendingPrompt()` is exported from `promptStore.js` but has **zero callers**.
FR-605 (badge sessions with a parked prompt in the sessions list and kanban) is unimplemented,
so users watching the list get no signal that an agent is blocked on them.

- **Red (server):** Test the session/workspace serializer (the object returned by the sessions
  list + workspace detail endpoints) asserting it exposes a boolean such as `hasParkedPrompt`
  that is `true` when a prompt is parked and `false` otherwise. Fails today (field absent).
- **Green (server):** Wire `hasPendingPrompt(sessionId)` into the serializer. Trigger a list
  refresh/broadcast on `session:prompt` and `session:prompt_resolved` so the list updates
  without per-session subscription.
- **Red (web):** Store/component test asserting the sessions list and kanban card render an
  attention badge when `hasParkedPrompt` is true.
- **Green (web):** Render the amber attention badge (`text-amber-400`, per FR-702).
- **Refactor / cleanup:** `hasPendingPrompt` is now consumed. If any decision leaves it
  genuinely unused, delete it instead (grep-confirm zero references first) — do not ship both
  an unfinished feature and its orphaned helper.

---

## Task 5 — Return annotations and preview to the model (Issue #5, FR-115)

**Problem:** `questionResult` passes through `response.annotations`, but
`AgentPromptCard.collectAnswers()` never builds them, so per-question free-text notes and the
selected option's `preview` never reach the model.

- **Red (web):** `AgentPromptCard.test.js` — answering a question with a note / selected
  option that has a `preview` produces a `respond` payload whose `annotations[questionText]`
  carries the note and preview. Fails today.
- **Green:** Build `annotations` in the card and include them in the `answer` response.
- **Refactor:** Keep annotation assembly alongside `collectAnswers`; confirm the server's
  `updatedInput.annotations` pass-through still holds (add/keep a server test).

---

## Task 6 — Supersede before validating duplicate questions (Issue #6)

**Problem:** In `parkPrompt`, the duplicate-question guard returns the deny response **before**
superseding an existing parked prompt. If a prompt is already parked and a new question with
duplicate text arrives, the stale prompt stays parked and its agent promise never resolves.

- **Red:** `promptStore.test.js` — with a prompt already parked, calling `parkPrompt` with a
  duplicate-question payload settles the existing prompt as `superseded` (removed from the
  store) and still returns the deny for the new call. Fails today (existing prompt leaks).
- **Green:** Reorder so the existing prompt is superseded first, then validate.
- **Refactor:** Keep supersede/validation ordering obvious; confirm idempotency tests stay
  green.

---

## Task 7 — Clarify "always allow" with no suggestions (Issue #9)

**Problem:** `permissionResult` treats `{ action: 'always' }` with no `suggestions` as a plain
deny with the message "Permission denied by user." The UI hides the button in that case, but a
scripted/stray request produces a confusing outcome.

- **Red:** `promptStore.test.js` — an `always` action with empty/absent `suggestions` resolves
  with a message that explains "always allow" was unavailable (not a generic user-deny).
  Fails today.
- **Green:** Return a dedicated explanatory deny message for that branch.
- **Refactor:** None; message-only change.

---

## Task 8 — Correct diff preview line accounting (Issue #10)

**Problem:** `permissionDiffFiles` in `AgentPromptCard.vue` filters blank lines with
`.filter(Boolean)` when computing additions/deletions and hunk lines, so edits whose content
contains blank lines show misleading line numbers/counts in the approval preview.

- **Red:** `AgentPromptCard.test.js` — a permission prompt for an Edit whose `old_string`/
  `new_string` contain blank lines renders a diff with correct line numbers and add/delete
  counts. Fails today.
- **Green:** Stop dropping blank lines; compute counts and line numbers over the real line
  arrays.
- **Refactor:** Keep the diff-projection helper small and covered.

---

## Task 9 — Hygiene: test-only export surface (Issue #8)

**Problem:** `describePromptOutcome` is exported from `promptStore.js` only so a unit test can
call it directly, widening the module's public surface.

- **Red/Green:** Prefer asserting outcome wording through the public
  `respondToPrompt`/`cancelPrompt` paths (assert the `createWorkLog` content) and drop the
  standalone export. If keeping the export is deliberate, add a one-line comment stating it's
  an intentional testing seam.
- **Refactor:** No behavior change; only the export surface.

---

## Task 10 — Hygiene: unbundle unrelated E2E-flakiness fixes (Issue #7)

**Problem:** `circusCommands.spec.ts` (retry-safe assertions) and `opus-5-model.spec.ts`
(`serial` mode) changes are unrelated to this feature and inflate the diff.

- **Action:** Split these into a separate commit/PR so the feature PR reviews cleanly. If the
  team prefers to keep them bundled, note it in the PR description; do not silently mix.
- No Red→Green needed (test-infra changes), but keep `./scripts/pw.sh test` green.

---

## Definition of done

- [ ] Every task landed via Red→Green→Refactor with the failing-test step demonstrable.
- [ ] Task 1 discovery findings recorded in the FRD (§5 updated); `promptCallbacks.js` and the
      `promptStore` payload projection match the verified `canUseTool` contract.
- [ ] `yarn test` green; `yarn lint` clean.
- [ ] `./scripts/pw.sh test` green, including the 5 new prompt E2E scenarios (never port 5000).
- [ ] Autonomous/unattended sessions fail closed on a parked prompt (Task 3) with a visible
      work-log entry.
- [ ] FR-605 badge implemented; `hasPendingPrompt` either consumed or removed (no dead code).
- [ ] Annotations/preview reach the model; duplicate-question supersede leaks nothing.
- [ ] PR manual-test checkbox ticked after the real `standard`-mode run.
