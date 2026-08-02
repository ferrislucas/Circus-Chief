# FRD — Interactive Agent Prompts

**Feature:** Interactive question and permission handling for Claude Code sessions
**Status:** Draft for review
**Date:** 2026-07-31
**Applies to:** `@circuschief/server`, `@circuschief/web`, `@circuschief/shared`
**SDK baseline:** `@anthropic-ai/claude-agent-sdk@0.3.163` (CLI `2.1.163`)

---

## 1. Background

Circus Chief passes no interaction callbacks to the Claude Agent SDK. `buildClaudeCodeQueryParams`
(`packages/server/src/services/queryParamBuilder.js:25-42`) supplies `cwd`, `abortController`,
`includePartialMessages`, `permissionMode`, `settingSources`, `resume`, `env`,
`spawnClaudeCodeProcess`, `model`, `systemPrompt`, and `mcpServers` — and nothing else.

Two SDK capabilities are consequently unreachable:

1. **`AskUserQuestion`** — the CLI enables this tool in every session today (visible in the
   `system/init` `tools` array of every VCR cassette), but the model's structured questions
   can never reach the user.
2. **Tool permission prompts** — in `permissionMode: 'default'` the CLI gates Write, Edit,
   Bash, WebFetch, MCP tools, and out-of-cwd file access behind a `can_use_tool` control
   request. With no `canUseTool` callback the SDK throws outright:

   ```js
   // sdk.mjs:62
   if (e.request.subtype === "can_use_tool") {
     if (!this.canUseTool) throw Error("canUseTool callback is not provided.");
     ...
   }
   ```

This is masked in normal use because the schema default session mode is `yolo`
(`schema.sql:26`, `:80`), which maps to `permissionMode: 'bypassPermissions'`
(`sessionPrompts.js:97`) and suppresses permission checks. **`standard` and `plan` modes are
therefore effectively non-functional** whenever the agent touches a gated tool — despite
`ModeSelector.vue:48-49` presenting them as first-class choices ("Plan — agent plans before
implementing", "Standard — balanced approach").

Both gaps share one transport (`can_use_tool`) and one interaction shape: park a promise
server-side, ask a human, resume the agent. This FRD covers them together.

---

## 2. Goals

| # | Goal |
|---|---|
| G-1 | The model can ask the user a structured multiple-choice question and receive the answer |
| G-2 | `standard` mode delivers real per-tool approval instead of erroring |
| G-3 | Users can grant durable permissions ("always allow") that persist across turns and sessions |
| G-4 | Unattended and scheduled sessions never hang indefinitely on a prompt |
| G-5 | Every interaction decision is visible in session history after the fact |
| G-6 | `yolo` mode behavior is unchanged |

## 3. Non-goals

- Codex and Gemini adapters. Neither has an equivalent control channel; their query builders
  are untouched.
- Elicitation (`onElicitation`, MCP-initiated prompts). Deferred; `onElicitation` will be
  registered as a stub that declines, matching current effective behavior.
- Replacing `~/.claude/settings.json` as the source of truth for permission rules. Circus Chief
  writes through the SDK's `updatedPermissions` mechanism rather than editing settings files itself.
- A permission policy editor UI (viewing/revoking granted rules). Tracked as a follow-up.

---

## 4. Glossary

| Term | Meaning |
|---|---|
| **Prompt** | A generic pending interaction requiring a human answer. Two kinds: `question` and `permission` |
| **Question prompt** | Originates from the model calling `AskUserQuestion` |
| **Permission prompt** | Originates from the CLI gating a tool call in `default` permission mode |
| **Parked** | State of a prompt: broadcast to clients, promise unresolved, agent process blocked |
| **Resolved** | Terminal state: answered, denied, skipped, timed out, or cancelled |
| **Unattended session** | A session with no connected WebSocket subscriber, or one started by the scheduler / kanban trigger / template chain |

---

## 5. Discovery spike (blocking)

Permission gating and prompt routing live inside the compiled `claude` binary
(`manifest.json` — a ~220 MB per-platform native binary), so the following cannot be
determined by reading source and **must be settled before implementation begins.**

| # | Question | Method | Blocks |
|---|---|---|---|
| D-1 | Does `AskUserQuestion` route through `can_use_tool`, or through `request_user_dialog`? | Register logging-only `canUseTool` + `onUserDialog`; run a session prompted to call the tool; observe which fires | FR-110, FR-120 |
| D-2 | Does `AskUserQuestion` still reach the host under `bypassPermissions`? **Critical** — `yolo` is the default mode, so a negative answer means the question feature is unavailable to most sessions | Same instrumentation, run once per mode | FR-501 |
| D-3 | Which tools actually emit `can_use_tool` under `default` mode, given `settingSources: ['user','project','local']` is loaded? | Instrumented standard-mode session exercising Write, Edit, Bash, WebFetch, out-of-cwd Read | FR-120, §10 |
| D-4 | What `suggestions` (`PermissionUpdate[]`) does the CLI supply, and are they per-tool or per-command-prefix? | Log the `suggestions` argument on each request | FR-124 |

**D-2 contingency.** If `bypassPermissions` suppresses the callback, the question feature is
unavailable in `yolo` mode. Mitigation options, in preference order: (a) accept the limitation
and surface it in `ModeSelector.vue`; (b) switch the default mode to `standard` once §6.3
makes it viable; (c) use `acceptEdits` for yolo instead of `bypassPermissions`, if it preserves
auto-approval of edits while still routing questions.

---

## 6. Functional requirements

### 6.1 Prompt store (FR-1xx)

| ID | Requirement |
|---|---|
| FR-101 | The server SHALL maintain an in-memory store of parked prompts keyed by session ID. Prompts SHALL NOT be persisted to SQLite — the awaiting agent process cannot survive a server restart, so a restored prompt would be unanswerable |
| FR-102 | A session SHALL hold at most one parked prompt at a time. A new prompt arriving while one is parked SHALL resolve the existing prompt as `superseded` |
| FR-103 | Each prompt SHALL carry: `id`, `sessionId`, `conversationId`, `kind` (`question` or `permission`), `toolUseId`, `agentId`, `createdAt`, and a kind-specific payload |
| FR-104 | Resolution SHALL be idempotent. The store SHALL remove the record before settling its promise, so a duplicate or stale resolution is a no-op rather than a double-resolve |
| FR-105 | A resolution request naming a `promptId` that is not currently parked SHALL be rejected with HTTP 409 |
| FR-106 | The store SHALL resolve a parked prompt as `cancelled` when: the session's `AbortController` fires, `cleanupSessionState` runs, `stopSession` is called, or the session is deleted |
| FR-107 | Every resolution SHALL emit a work-log entry recording the prompt and the outcome, so decisions are reconstructable from session history (G-5) |

### 6.2 Question prompts (FR-11x)

| ID | Requirement |
|---|---|
| FR-110 | When the host receives an interaction request for the `AskUserQuestion` tool, it SHALL park a `question` prompt carrying the tool input's `questions[]` array |
| FR-111 | On answer, the host SHALL resume the agent with `{ behavior: 'allow', updatedInput: { ...input, answers, annotations? } }`. `answers` maps question text to answer string; multi-select values SHALL be joined with `", "` per the SDK's documented convention (`sdk-tools.d.ts:2956`) |
| FR-112 | On skip, the host SHALL resume with `{ behavior: 'deny', message }` instructing the model to proceed on best judgment and state the assumption it made |
| FR-113 | The session SHALL be configured with `toolConfig: { askUserQuestion: { previewFormat: 'markdown' } }`. HTML previews SHALL NOT be used — the app has no sanitization path for agent-generated HTML |
| FR-114 | The UI SHALL always offer an "Other" free-text choice per question. The SDK tool description states the host is responsible for supplying it; free-text SHALL be passed through as the answer string |
| FR-115 | Per-question free-text notes and the selected option's `preview` SHALL be returned in `annotations[questionText]` |

### 6.3 Permission prompts (FR-12x)

| ID | Requirement |
|---|---|
| FR-120 | For any non-`AskUserQuestion` tool interaction request, the host SHALL park a `permission` prompt |
| FR-121 | The prompt payload SHALL carry the SDK-supplied presentation fields — `title`, `displayName`, `description`, `blockedPath`, `decisionReason`, `suggestions`, `toolUseID`, `agentID` (`sdk.d.ts:188-230`). `title` SHALL be used as the primary prompt text when present, rather than reconstructing it from tool name and input |
| FR-122 | The prompt payload SHALL include the raw tool input so the UI can show what the agent is about to do (e.g. the full Bash command, the file path and diff for an Edit) |
| FR-123 | On allow, the host SHALL resume with `{ behavior: 'allow' }`; on deny, `{ behavior: 'deny', message }` carrying the user's reason if supplied, otherwise a default |
| FR-124 | On "always allow", the host SHALL resume with `{ behavior: 'allow', updatedPermissions }` set to the full `suggestions` array from the request, per the SDK's documented contract |
| FR-125 | The destination for "always allow" SHALL be user-selectable between session-scoped and project-scoped, mapping to `PermissionUpdateDestination` values `'session'` and `'projectSettings'` |
| FR-126 | The host SHALL register `onUserDialog` returning `{ behavior: 'cancelled' }` for unrecognized `dialogKind` values, as the SDK requires, and log the kind for future support |
| FR-127 | The host SHALL register `onElicitation` returning `{ action: 'decline' }`, matching current effective behavior explicitly rather than by omission |
| FR-128 | `system` / `permission_denied` events (`SDKPermissionDeniedMessage`) SHALL be rendered in the session work log so auto-denials are visible, not silently swallowed as error tool results |

### 6.4 Unattended sessions and timeouts (FR-2xx)

Circus Chief runs sessions autonomously — via `schedulerService`, kanban triggers, template
chains, and the sessions API. A parked prompt in an unattended session blocks an agent
process indefinitely. This is the single largest operational risk in the feature.

| ID | Requirement |
|---|---|
| FR-201 | Each project SHALL have a configurable **prompt timeout** (default: 30 minutes) and **timeout action** (default: `deny`) |
| FR-202 | Timeout action `deny` SHALL resume the agent with a deny result explaining that no human responded |
| FR-203 | Timeout action `allow` SHALL be available for permission prompts only, and SHALL be clearly labeled as equivalent to delayed auto-approval |
| FR-204 | For question prompts, timeout SHALL always resolve as skipped (FR-112) regardless of the configured action. Auto-selecting an option on the user's behalf SHALL NOT be implemented |
| FR-205 | The timeout SHALL be suspended while at least one client is subscribed to the session over WebSocket, and SHALL start or resume when the last subscriber disconnects |
| FR-206 | A parked prompt SHALL move its workspace card to the **Needs attention** kanban lane via the existing `kanbanTriggers` service |
| FR-207 | A parked prompt SHALL be eligible for push notification, using the SDK's documented notification hook for "a permission prompt or question is waiting" (`sdk.d.ts:5650`) |

### 6.5 Session mode semantics (FR-5xx)

| ID | Requirement |
|---|---|
| FR-501 | `yolo` SHALL continue to map to `permissionMode: 'bypassPermissions'` with no behavior change |
| FR-502 | `standard` SHALL continue to map to `permissionMode: 'default'` and SHALL now surface interactive permission prompts. This makes the "Balanced approach" label truthful for the first time |
| FR-503 | `plan` SHALL be evaluated for migration from its current prompt-injection approach (`permissionMode: 'default'` plus `PLAN_MODE_PROMPT`) to the SDK's native `permissionMode: 'plan'`. This is an **open question**, not a committed requirement — see §12 |
| FR-504 | The mode selector SHALL describe each mode's actual permission behavior, replacing the current vague copy |
| FR-505 | The host SHALL NOT auto-allow tools silently. If a build of this feature ever needs a fallback, it SHALL deny with an explanatory message rather than allow, so that a broken prompt path fails closed |

### 6.6 Transport and API (FR-6xx)

| ID | Requirement |
|---|---|
| FR-601 | Two WebSocket message types SHALL be added: `session:prompt` (a prompt was parked) and `session:prompt_resolved` (a prompt reached a terminal state) |
| FR-602 | `session:prompt_resolved` SHALL carry the `promptId` and outcome. Clients SHALL ignore it when the `promptId` does not match their currently displayed prompt, preventing an out-of-order event from clearing a newer prompt |
| FR-603 | `GET /api/sessions/:id/prompt` SHALL return the currently parked prompt or `null`, enabling hydration on page load and in additional browser tabs |
| FR-604 | `POST /api/sessions/:id/prompt/:promptId/respond` SHALL accept a kind-appropriate response body, validated by a Zod contract in `@circuschief/shared` |
| FR-605 | Session list and workspace payloads SHALL expose a boolean indicating a parked prompt, so the sessions list and kanban board can badge sessions needing attention without subscribing to each one |

### 6.7 User interface (FR-7xx)

| ID | Requirement |
|---|---|
| FR-701 | Prompts SHALL render as an inline card between the message list and the input form in `ConversationTab.vue`, occupying the same layout slot as `TodoDrawer` and `RunningState`. A modal SHALL NOT be used — the user needs the conversation visible to make an informed decision |
| FR-702 | The card SHALL use the amber accent (`text-amber-400`) already established for warning and attention states |
| FR-703 | The card SHALL scroll itself into view and focus its first actionable control on appearance |
| FR-704 | **Question variant:** one block per question (1–4), each with the `header` as a chip, the question text, and 2–4 option buttons showing `label` prominently and `description` in `text-gray-400`. `multiSelect: true` renders checkboxes, otherwise radios |
| FR-705 | Option `preview` content SHALL render in a collapsible block when its option is focused or selected, using the app's existing sanitized markdown renderer |
| FR-706 | Submit SHALL be disabled until every question has an answer. Skip SHALL always be enabled |
| FR-707 | **Permission variant:** SHALL show `title` as the headline, `description` as subtext, and the tool input in a monospace block — for Edit and Write, rendered through the existing `DiffViewer` component rather than as raw JSON |
| FR-708 | The permission variant SHALL offer: **Allow once**, **Always allow** (with a session/project destination toggle), and **Deny** with an optional reason field |
| FR-709 | Keyboard shortcuts SHALL be provided via the existing `useKeyboardShortcuts` composable: `1`–`4` to select, `Enter` to submit, `Esc` to skip or deny |
| FR-710 | All controls SHALL be disabled while a response is in flight, preventing double-submission |
| FR-711 | When the timeout is active (no other subscriber), the card SHALL display the remaining time |
| FR-712 | Resolved prompts SHALL remain visible in session history through their work-log entries (FR-107), not vanish without trace |

---

## 7. Data model

No schema migration is required for prompts themselves (FR-101). Two additions:

**`project_defaults`** — new columns:

- `prompt_timeout_minutes INTEGER DEFAULT 30`
- `prompt_timeout_action TEXT DEFAULT 'deny' CHECK (prompt_timeout_action IN ('deny','allow'))`

**Session status** — the existing `waiting` status means *turn complete, awaiting the user's
next message* (`streamEventCallbacks.js:74`) and SHALL NOT be reused. A session with a parked
prompt remains `running`, because the agent process is alive and mid-turn. The parked-prompt
flag (FR-605) is the discriminator, not a new status value. This avoids a `CHECK` constraint
migration across `schema.sql`, two migration files, and a schema fixture.

---

## 8. Architecture

```
                  ClaudeCodeAdapter -> SDK query()
                              ^ canUseTool / onUserDialog / onElicitation
                              |
    +-------------------------+-------------------------+
    |           promptStore  (in-memory, per session)   |
    |  park() -> Promise   respond()   cancel()   get() |
    +------+--------------------------------------+-----+
           | broadcast                            | HTTP
           v                                      v
    WebSocketManager                    /api/sessions/:id/prompt
           |                                      |
           v                                      v
    useSessionSubscription  ----->  sessionPrompts (Pinia)  <-- hydration
                                             |
                                             v
                                    AgentPromptCard.vue
                             +-- QuestionPromptBody.vue
                             +-- PermissionPromptBody.vue
```

This mirrors the existing todos feature (server store, WS broadcast, REST hydration, Pinia
store, component), with one structural difference: a parked prompt owns a live Promise that
a blocked agent process is awaiting.

---

## 9. Phasing

| Phase | Contents | Rationale |
|---|---|---|
| **0** | Discovery spike D-1 through D-4 | Blocking; design depends on the answers |
| **1** | Prompt store, `canUseTool` wiring, question prompts, question UI, cancellation hooks | Delivers G-1; the permission path denies with an explanatory message until Phase 2 (fail-closed per FR-505) |
| **2** | Permission prompt payload, permission UI, allow/deny/always-allow, `updatedPermissions` | Delivers G-2 and G-3; makes `standard` mode viable |
| **3** | Timeout policy, project defaults, kanban integration, notifications, parked-prompt badge | Delivers G-4; required before `standard` is safe for scheduled sessions |
| **4** | `permission_denied` event rendering, mode selector copy, plan-mode migration decision | Polish and truthfulness |

---

## 10. Edge cases

| Case | Required behavior |
|---|---|
| Two browser tabs open, both answer | First wins; second receives 409 and re-fetches (FR-104, FR-105) |
| Server restarts while a prompt is parked | Agent process died with it. `GET /prompt` returns `null`; card clears. No recovery needed |
| Session stopped while parked | Prompt cancelled *before* `controller.abort()`, so the agent receives a clean deny rather than a mid-flight abort (FR-106) |
| Prompt raised inside a subagent | `agentID` is present on the request. Displayed as context; handling is otherwise identical |
| Model calls `AskUserQuestion` twice in one turn | Store holds one per session; the second supersedes the first (FR-102). Expected to be rare — the CLI blocks per call |
| `suggestions` absent on a permission request | "Always allow" is hidden for that prompt; only allow-once and deny are offered |
| Session deleted while parked | `cleanupActiveSession` cancels the prompt before aborting (FR-106) |
| Prompt arrives in a `yolo` session (pending D-2) | If reachable, handled identically. If not, the feature is documented as `standard` and `plan` only |
| Client subscribes mid-prompt | Hydrates via `GET /prompt` (FR-603); timeout suspends on subscribe (FR-205) |

---

## 11. Testing requirements

**Unit — server:** prompt store lifecycle (park, respond, cancel, supersede, timeout);
idempotency under double-response; stale-`promptId` no-op; abort-signal cancellation;
`canUseTool` routing for question vs. permission vs. unknown tool kinds; multi-select
`", "` joining; `updatedPermissions` pass-through; verification that codex and gemini query
params contain none of the new callbacks.

**Unit — web:** prompt store `promptId` guard on resolve; question card select modes, Other
input, submit gating; permission card allow/always-allow/deny paths and destination toggle;
countdown rendering.

**Integration:** REST route status codes (200 / 404 / 409 / 422).

**E2E (`./scripts/pw.sh test`):** requires cassette support. The `VCRAgentAdapter` must be
extended to invoke `queryParams.options.canUseTool` when replaying a gated tool call, since
prompts are parked server-side rather than being replayed stream events. Scenarios: question
answered and session resumes; permission allowed once; always-allow suppresses the second
prompt in the same session; page reload rehydrates a parked prompt; stop clears it.

**Manual:** standard-mode session prompted to write a file (permission path) and to call
`AskUserQuestion` (question path), plus one unattended session verifying timeout behavior.

---

## 12. Open questions

| # | Question | Owner |
|---|---|---|
| OQ-1 | Should `plan` mode migrate to the SDK's native `permissionMode: 'plan'`? It would give real read-only enforcement plus an `ExitPlanMode` approval flow, but changes established behavior and interacts with the `PLAN_MODE_PROMPT` injection and the canvas-based plan presentation convention | Product |
| OQ-2 | Should the default session mode change from `yolo` to `standard` once Phase 2 lands? Depends on D-2 and on whether interactive prompting is acceptable for the project's autonomous-session workflows | Product |
| OQ-3 | Should granted "always allow" rules be viewable and revocable in the UI, or is deferring to `~/.claude/settings.json` acceptable for v1? | Product |
| OQ-4 | Should the timeout be per-project only, or also per-session-template? Scheduled sessions created from templates may warrant stricter policy than interactive ones | Engineering |

---

## 13. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `AskUserQuestion` unreachable in `yolo`, the default mode (D-2) | **High** | Resolve in Phase 0 before committing to design; contingencies in §5 |
| Parked prompt blocks an agent process indefinitely | **High** | FR-201 through FR-205; cancellation from four independent paths (FR-106) |
| Enabling prompts makes `standard` mode unusable for autonomous workflows that currently rely on it | Medium | Timeout defaults to deny; `yolo` remains the default mode; badge and notification surface blocked sessions |
| Registering `canUseTool` changes behavior for every tool at once | Medium | Fail-closed default (FR-505); Phase 1 denies rather than allows; explicit unit coverage |
| Permission prompt fatigue in `standard` mode | Medium | "Always allow" with `suggestions` (FR-124); existing `settingSources` allowlists already suppress common cases |
| `previewFormat: 'html'` XSS if ever enabled | Low | FR-113 fixes the format to markdown through the existing sanitized renderer |
| Double-resolve corrupting agent state | Low | Delete-before-resolve, `promptId` matching, 409 on stale (FR-104, FR-105) |
