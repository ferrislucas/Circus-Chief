# Plan — PR #1074 Review Remediation (Interactive Agent Prompts)

**Branch:** `circus-chief/c958-are-familiar-question-tool`
**Compare against:** `origin/main`
**Scope:** review issues **1, 3, 4, 5, 6, 7, 8**

**Out of scope for this plan:** issue 2 (no TTL / unattended-session hang). That one changes
product behavior for scheduled sessions, kanban lane automation, and cron routines, and needs a
product decision on what an unanswered prompt should do. It is deliberately not addressed here.
Do not silently fold a timeout into any slice below.

---

## Working agreement — red → green → refactor, every slice

This is not advisory. Each numbered slice below is a full red → green → refactor cycle, and the
slices are ordered so that earlier ones do not have to be redone.

**Red.** Write the test first. Run it. **Observe it fail, and read the failure message to confirm
it fails for the intended reason** — not because of a typo, a missing import, an unmocked
dependency, or a fixture that does not exist yet. A test that fails for the wrong reason has
proven nothing. If a test passes the first time you run it, the test is wrong: it is not
exercising the defect. Fix the test before touching production code.

**Green.** Write the smallest production change that turns that specific test green. Do not
generalize ahead of the tests. Do not fix an adjacent bug you noticed — write it down and give it
its own red test.

**Refactor.** With the suite green, improve structure without changing behavior. Re-run the
focused tests plus the surrounding existing suites after each refactor.

**Never write production code for a slice before its red test has been observed failing.**

Run focused tests during a slice, then the package suite at the end of it:

```bash
yarn workspace @circuschief/server test src/services/promptStore.test.js
yarn workspace @circuschief/web test src/components/AgentPromptCard.test.js
./scripts/pw.sh test tests/e2e/agent-prompts.spec.ts
```

Never run E2E against port 5000. Always go through `./scripts/pw.sh`.

---

## Slice 1 — Issue #1 (BLOCKING): concurrent gated tool calls are silently auto-denied

**The defect.** `parkPrompt` (`packages/server/src/services/promptStore.js`) keys the store by
`sessionId` and holds exactly one prompt per session. A second arrival supersedes the first,
settling it as `{ behavior: 'deny', message: 'This interaction was superseded.' }` before the user
ever sees it.

The SDK dispatches `can_use_tool` requests **concurrently**, not serially. From
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs`:

```js
processPendingPermissionRequests(e) {
  for (let t of e)
    if (t.request.subtype === "can_use_tool")
      this.handleControlRequest(t).catch(() => {})
}
```

An array of pending requests, all fired without awaiting. And `sdk.d.ts:225` states: *"Multiple
tool calls in the same assistant message will have different toolUseIDs."* Claude emits parallel
`tool_use` blocks routinely. So `standard` mode — the mode this PR exists to repair — produces
spurious denials the first time the model does two things at once.

Note this is a genuine correction to FRD **FR-102**, which assumed supersession is rare because
"the CLI blocks per call." The SDK source contradicts that. Record the correction wherever the
FRD's decisions are tracked so the next reader does not re-derive it.

### Red

Add to `packages/server/src/services/promptStore.test.js`:

- Park two permission prompts for the same session **without awaiting the first**. Assert both
  promises are still pending, that neither has settled as `superseded`, and that neither has
  written a work-log entry yet. This must fail today because the first is denied immediately.
- Assert `getPrompt(sessionId)` returns the **first** prompt (FIFO), not the second, so the user
  answers in arrival order.
- Respond to the first prompt. Assert its promise resolves with the user's decision, the second is
  *still* pending, and `getPrompt(sessionId)` now returns the second.
- Respond to the second. Assert it resolves and `getPrompt(sessionId)` is `null`.
- Assert the `SESSION_PROMPT` broadcast fires for the newly-surfaced prompt when the head is
  resolved, so a client that already rendered prompt 1 gets prompt 2 without polling.
- Assert `pendingAgentInput` stays `true` across the handoff and only flips to `false` when the
  queue drains — one prompt resolving must not clear the badge while another is queued.
- Park three prompts, then `cancelPrompt(sessionId)`. Assert **all three** resolve as cancelled,
  each writes exactly one work-log entry, and the queue is empty. Same for the abort-signal path.
- Assert per-prompt abort still works: park two, abort only the first's signal, assert the first
  cancels and the second survives and becomes the head.
- Assert `respondToPrompt` for a queued-but-not-head `promptId` behaves deterministically. Pick
  one and test it: either it resolves that specific prompt out of order, or it is rejected as
  not-current. **Decide explicitly and encode the decision in the test name** — do not leave it to
  fall out of the implementation.
- Keep a regression test proving genuine supersession still exists where it is correct: a
  duplicate-question-text prompt must still be rejected without settling the queue.

Run the file. Confirm the concurrency tests fail because the first prompt was denied on arrival.

### Green

- Change the store's value type from a single record to an **ordered queue per session**
  (`Map<sessionId, record[]>`). `getPrompt` / the `GET /prompt` route return the head.
- `settle()` currently guards with `prompts.get(record.sessionId)?.id !== record.id`. Replace with
  a queue-membership check that removes the record by identity from anywhere in the queue,
  preserving the delete-before-resolve ordering that makes double-resolution a no-op (FR-104).
- After settling the head, broadcast `SESSION_PROMPT` for the new head if one exists.
- `broadcastPendingInput` must derive from queue length, not from "a record was removed."
- `cancelPrompt` drains the whole queue; each record settles exactly once.
- Each record keeps its own `signal` + `abortListener`; removal detaches only that listener.

### Refactor

- Extract queue mechanics (`enqueue`, `head`, `removeById`, `drain`) behind small named helpers so
  `settle`/`parkPrompt` read as policy, not bookkeeping.
- Re-check every existing `prompts.get(sessionId)` call site — `getPrompt`, `hasPendingPrompt`,
  `cancelPrompt`, `respondToPrompt` — for the single-record assumption.
- Re-run `promptStore.test.js`, `packages/server/test/sessions-prompts.test.js`, and
  `streamEventHandler.test.js`.

---

## Slice 2 — Issue #3 (BLOCKING): `title` / `decisionReason` bypass the safe-summary boundary

**The defect.** `promptSafeSummary.js` is correct that only an allowlist is a valid boundary, and
its doc comment says so well. But `permissionHistoryLines()` in `promptStore.js` then writes
SDK-supplied presentation strings into durable history verbatim:

```js
record.payload.title && `Title: ${record.payload.title}`,
record.payload.blockedPath && `Blocked path: ${record.payload.blockedPath}`,
record.payload.decisionReason && `Decision context: ${record.payload.decisionReason}`,
```

Per `sdk.d.ts:209-212`, `title` is the *"Full permission prompt sentence rendered by the bridge
(e.g. 'Claude wants to read foo.txt')"*. For a Bash approval that sentence embeds the command.
The allowlist strips `input.command` and then `title` writes it straight back — including the
exact `curl -H "Authorization: Bearer sk-live-…"` case the module comment promises to prevent.

Compounding it: `promptStore.test.js:93-111` uses a synthetic `title: 'Deploy'` and **asserts the
title is persisted**, so the current suite locks the hole in. That existing assertion has to be
replaced, not worked around.

### Red

- Add a test parking a Bash permission prompt whose `title` is a realistic bridge-rendered
  sentence containing the full command with an embedded bearer token, and whose `decisionReason`
  also quotes the command. Assert the persisted work-log content contains **neither** the token
  nor the command text. This fails today.
- Same for `blockedPath` carrying a credential-bearing path or query string.
- Assert the **live** prompt payload still carries the untouched `title` / `description` /
  `decisionReason`, so the approval card loses nothing. The transient/durable split is the whole
  design; prove it holds in both directions.
- Assert ordinary history is still reconstructable and human-readable: tool name, decision,
  scope, and a safe headline. Denying every string is not an acceptable fix — the test must fail
  if history degrades to "Permission decision / Outcome: deny" with no context.
- Assert unbounded strings cannot be persisted at whatever length limit is chosen, so a
  multi-kilobyte bridge sentence cannot smuggle a payload past a substring check.
- **Replace** the `expect(content).toContain('Title: Deploy')` assertion at `promptStore.test.js:101`
  with one that reflects the new contract. Leaving it green means the hole is still there.

### Green

- Route `title`, `displayName`, `description`, `decisionReason`, and `blockedPath` through the
  same safe-by-default helper in `promptSafeSummary.js` rather than persisting them raw.
- Decide the safe representation per field and encode it in the helper. Candidates: derive the
  headline from `displayName` (a short noun phrase like "Read file", far less likely to embed
  input) plus the already-allowlisted summary; or length-cap and structurally sanitize. Whatever
  is chosen, **unknown/unsafe content is omitted, never truncated-and-kept** — a truncated secret
  is still a secret.
- For `blockedPath`, reuse the existing `stripUrlCredentials` idea: keep the path shape, drop
  query, fragment, and userinfo.
- One helper feeds the DB write, the REST history response, and the WS history broadcast. No
  second path may construct history strings.

### Refactor

- Rename the module if it now owns more than tool input (e.g. `promptDurableSummary.js`), and
  extend the doc comment to state that **all** SDK-supplied presentation strings are untrusted
  with respect to persistence, with the `title`-embeds-the-command example spelled out. That
  example is why this slice exists; make sure the next reader sees it.
- Re-run `promptStore.test.js` and `sessions-prompts.test.js`.

---

## Slice 3 — Issue #5: VCR replay is degenerate and discards the recorded result

Do this **before** slice 4 — the E2E specs in slice 4 depend on replay ordering being correct.

**The defect.** `VCRAgentAdapter.replay()`:

```js
for (const gatedCall of cassette.gatedToolCalls || []) {
  await queryParams.options?.canUseTool?.(gatedCall.toolName, gatedCall.input, gatedCall.opts || {});
}
for (const event of cassette.events) { ... }
```

Three problems. (a) Every gated call fires *before* any stream event, so `system/init` never
reaches the client before the card appears — nothing like the live ordering, and an E2E test
written against it would assert the wrong sequence. (b) `gatedCall.result` is recorded and never
compared, so replay cannot verify the host produced the recorded decision. (c) Prompts cannot be
interleaved between events, which is exactly what a realistic session does.

### Red

Extend `packages/server/src/agents/vcr/VCRAgentAdapter.test.js`:

- Record a run with a gated call occurring **between** two stream events. Assert the cassette
  records the position/ordering, not just the call. Fails today — position is not captured.
- Replay that cassette and assert the observed interleaving: `system/init` is yielded, *then*
  `canUseTool` is invoked, *then* the remaining events. Fails today — the callback fires first.
- Replay and assert the host's returned `PermissionResult` is compared against the recorded
  `result`, with a clear diagnostic when they diverge. Fails today — the return value is dropped.
- Cover a run with multiple gated calls (ordering preserved) and a run with none.
- Backward compatibility: an existing cassette with no `gatedToolCalls` replays unchanged. Assert
  against a real pre-existing fixture from `tests/e2e/cassettes/`, not a synthetic one.
- Record → replay round-trip with **no hand-editing** of the generated cassette.

### Green

- Capture ordering during record: index each gated call against the event stream position, or
  interleave gated calls into a single ordered timeline. Prefer whichever keeps old cassettes
  loadable without migration.
- Replay walks that timeline, yielding events and invoking `canUseTool` at the recorded points.
- Compare the awaited result to the recorded `result` and surface a readable mismatch.
- Keep the `signal`-stripping behavior in `instrumentCanUseTool` — that part is right.

### Refactor

- Share the cassette schema between record and replay so the two cannot drift. The remediation
  plan already asked for this; it is still open.
- Document the cassette version / backward-compatibility rule next to `CassetteStore`.
- Re-run the VCR adapter tests and the existing adapter suite.

---

## Slice 4 — Issue #4: two cassettes were added and no E2E spec consumes them

**The defect.** `tests/e2e/cassettes/runSession-bc8fc5cc196e4a64.json` and
`runSession-f464dd3f5d0ffcfc.json` exist and nothing references them. FRD §11 requires five E2E
scenarios; zero exist. The PR's "all 1180 tests pass" is true and says nothing about this feature.

These are precisely the tests that would have caught issues #1 and #7.

### Red

Create `tests/e2e/agent-prompts.spec.ts` using the existing cassettes (see
`tests/e2e/child-session-send.spec.ts` for the cassette-key derivation convention —
`runSession-{SHA256(prompt)[0:16]}`). Cover FRD §11:

1. **Question answered, session resumes.** Card appears, `Send answers` is disabled until every
   question is answered, selecting an option enables it, submitting clears the card and the
   session completes.
2. **Permission allowed once.** Card shows `title` as headline and the Edit rendered through
   `DiffViewer`, `Allow once` clears the card, session completes.
3. **Always-allow suppresses the second prompt** in the same session, with the session/project
   destination toggle exercised.
4. **Reload rehydrates a parked prompt** via `GET /prompt` — reload mid-prompt, card is still
   there with state intact.
5. **Stop clears a parked prompt** — card disappears and the session does not hang.

Add, because slices 1 and 7 need end-to-end proof:

6. **Two concurrent gated calls** (needs a new cassette written *after* slice 3, recorded not
   hand-edited): both are queued, the first is shown, answering it reveals the second, neither is
   auto-denied.
7. **Escape does not deny.** With a permission card visible, press Escape and assert no response
   is submitted and the card is still there.

Run `./scripts/pw.sh test tests/e2e/agent-prompts.spec.ts`. Scenarios 6 and 7 must fail before
slices 1 and 7 land — if they pass early, they are not testing what they claim.

### Green

Make each scenario pass. Scenarios 1–5 should already work once slice 3 fixes replay ordering; if
one does not, that is a real bug — give it its own focused unit test before fixing.

### Refactor

- Extract shared setup (create session, wait for card) into a helper alongside the existing
  `tests/e2e/kanbanLaneRunHelpers.ts` pattern.
- Prefer stable selectors over CSS-class coupling; add `data-testid` hooks to `AgentPromptCard.vue`
  if needed.

---

## Slice 5 — Issue #7: Escape denies a permission request globally, unconfirmed

**The defect.** `AgentPromptCard` registers **document-level** handlers through
`useKeyboardShortcuts` (module-scoped `Map`, `document.addEventListener`). While a permission
prompt is parked, pressing Escape *anywhere in the app* — the universal reflex for "close this
modal/overlay" — fires `respond({ action: 'deny', reason })` immediately. `isTypingTarget` only
guards inputs, textareas, selects, and contenteditable. A destructive, irreversible decision is
one reflexive keypress away, and the listener is global rather than scoped to the card.

FRD FR-709 does ask for "Esc to skip or deny," so this is a refinement of the requirement, not a
reversal: keep the affordance, remove the footgun.

### Red

In `packages/web/src/components/AgentPromptCard.test.js`:

- Permission prompt visible, Escape pressed once → assert **no** `respond` event is emitted.
- Assert Escape instead reveals the denial-reason affordance (same state as clicking `Deny`), and
  that a second explicit confirmation is what emits `{ action: 'deny' }`.
- Question prompt + Escape → assert the existing skip behavior is preserved (skip is non-
  destructive; the agent proceeds on best judgment).
- Assert the handler does not act when focus is outside the card, so an Escape aimed at an overlay
  or modal cannot reach the prompt.
- Assert handlers are removed on unmount and do not leak into the module-level shortcut map when
  two `AgentPromptCard` instances are mounted (main view + `SessionChatOverlay`).

### Green

- Escape on a permission prompt opens the deny-reason UI rather than submitting.
- Scope the listener to the card element (or gate on focus being within `card.value`) instead of
  relying on `document` plus a tag-name guard.
- Leave question-prompt Escape (skip) as is.

### Refactor

- If scoping is awkward through `useKeyboardShortcuts`, that composable's global-`Map` design is
  the real constraint — note it rather than fighting it, and keep the workaround local to this
  component.
- Re-run `AgentPromptCard.test.js` and E2E scenario 7.

---

## Slice 6 — Issue #6: kanban store merge broadened from allowlist to blind spread

**The defect.** `packages/web/src/stores/kanban.js` replaced an explicit 8-field copy with
`{ ...card.sessions[sessionIndex], ...session }`. That is a behavior change far beyond adding one
boolean: every field the server ever adds to a `session:updated` broadcast now lands in kanban card
state, bypassing `KanbanCardSessionResponse` entirely.

### Red

In `packages/web/src/stores/kanban.test.js`:

- Dispatch a `session:updated` payload containing `pendingAgentInput: true` plus an unexpected
  extra field. Assert `pendingAgentInput` is applied **and** the unexpected field is not copied
  onto the card. Fails today — the spread copies everything.
- Assert an update omitting `pendingAgentInput` does not clobber an existing `true`.

### Green

Restore the explicit allowlist and add `pendingAgentInput` to it.

### Refactor

Keep the allowlist adjacent to `KanbanCardSessionResponse` (or derive it from that schema's keys)
so the two cannot drift.

---

## Slice 7 — Issue #8: triple hydration on session open

**The defect.** `ConversationTab.onMounted`, `SessionChatContent.setupSubscription`, and
`useSessionInitializer.initializeSession` each call `promptsStore.hydrate(sessionId)` — three
`GET /prompt` round-trips per session view. The store's version guard makes this *correct*, not
*cheap*.

### Red

- Add a test asserting opening a session view issues exactly **one** `getSessionPrompt` call.
  Fails today with three.
- Assert the overlay path (`SessionChatOverlay` / `SessionChatContent`) still hydrates when it is
  the only mounted consumer — the fix must not leave the overlay with no hydration at all.
- Keep the existing stale-response-ordering tests in `sessionPrompts.test.js` green; the version
  guard stays regardless.

### Green

Pick one owner. `useSessionInitializer` already owns subscription lifecycle and calls
`promptsStore.clear(sessionId)` on cleanup, which makes it the natural home. Remove the
`ConversationTab` and `SessionChatContent` calls — but only after confirming the overlay path
actually routes through the initializer; if it does not, the overlay keeps its call and
`ConversationTab` loses its own.

### Refactor

- Collapse the duplicated `catch (error) => console.debug('Failed to load pending agent prompt')`
  blocks into the single surviving call site.
- Re-run `useSessionInitializer.test.js`, `SessionChatContent.test.js`, `sessionPrompts.test.js`.

---

## Cross-cutting validation

- Every slice keeps its regression tests permanently. None are temporary scaffolding.
- After all slices: `yarn test`, `yarn lint`, `./scripts/pw.sh test`.
- Re-read the final diff against `origin/main` as a whole. Slices 1 and 2 both touch
  `promptStore.js`; confirm queueing did not reopen a persistence path, and that durable-summary
  changes did not alter the transient payload the approval card reads.
- Confirm `yolo` behavior is unchanged by slices 1–7.
- Confirm no raw permission input reaches work logs, DB rows, REST history, WS broadcasts, server
  logs, or newly recorded cassettes — including via `title`, `displayName`, `description`,
  `decisionReason`, and `blockedPath`.
- Confirm old cassettes still replay and newly recorded gated cassettes replay without hand edits.

## Also worth folding in (cheap, low risk)

These were minor findings in the same review; fold them into whichever slice touches the file, each
with its own red test where behavior changes:

- **#9** — `hasValidQuestionAnswers` duplicates the `annotations` object-ness and key-membership
  checks that `hasKnownPromptKeys` already performs on the line above. Dead code in a
  security-relevant validator. (Slice 1 or 2.)
- **#10** — `PromptQuestion` / `PromptOption` in `packages/shared/src/contracts/prompts.js` are
  exported and never used; `PromptQuestion.header` is `.optional()` while the SDK schema makes
  `header` required. Delete them, or wire them up and fix `header`.
- **#12** — `handleSystemEvent` reads `event.error || event.message || event.reason`;
  `SDKPermissionDeniedMessage` defines none of `error`/`reason`. It has `message`, plus
  `decision_reason` and `agent_id`, both currently dropped. Also `record.reject` is stored on every
  prompt record and never called.
- **#11 / #13 / #14** — remove the file-wide `/* eslint-disable max-lines */` from
  `sessionExecution.js` (and restore the comments/blank lines that commit stripped); update the
  stale PR description, which still claims it ships `docs/frd-interactive-agent-prompts.md` that
  commit `75f2e8fb` removed; consider a single session-serialization helper instead of computing
  `pendingAgentInput` at seven separate call sites.

## Completion criteria

- Concurrent gated tool calls queue and are answered in order; none are auto-denied. Proven by
  both a server unit test and E2E scenario 6.
- No SDK-supplied presentation string can carry raw tool input into durable history; the old
  `Title: Deploy` assertion is replaced, not preserved.
- `tests/e2e/agent-prompts.spec.ts` exists, consumes the previously-orphaned cassettes, and covers
  all five FRD §11 scenarios plus concurrency and Escape.
- VCR replay reproduces recorded ordering and verifies recorded results; old cassettes still load.
- Kanban card state is updated through an explicit allowlist.
- Escape cannot deny a permission request without explicit confirmation.
- Exactly one `GET /prompt` per session open.
- Every one of the above has a test that was **observed failing first**.
