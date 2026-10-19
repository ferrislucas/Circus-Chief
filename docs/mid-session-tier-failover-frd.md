# FRD: Mid-Session Automatic Tier Failover

Status: Draft — 2026-10-18
Scope: tier-bound sessions (`session.model = tier::<id>`) whose active member hits quota/capacity exhaustion mid-conversation.

## 1. Problem

Start-time tier failover exists (`runSessionWithTierFailover`): a new session tries tier members in order, skipping cooled members, on eligible quota/service errors.

Continuations are pinned: `resolveTierRefForContinue` reuses the `resolvedModel / resolvedProviderId` snapshot, `buildTierHealthContext` reports health with `allowFailover: false`, and `checkContinuationDispatchKind` blocks cross-kind moves. Net effect: once a session is talking to member A and A runs out (429 / quota / usage-limit / billing), every follow-up turn keeps failing on A even though member B in the same tier is healthy. The user must manually pick a new model.

## 2. Goals

- G1: A tier-bound session automatically advances to the next healthy tier member when the active member fails with an eligible exhaustion signal — without user action.
- G2: Preserve conversation continuity: full text history is passed to the new provider; native resume chain is never reused across providers.
- G3: Always fail over: advance to the next healthy tier member even if the failed turn already produced durable agent activity (assistant messages, tool calls/results, work logs). Partial work is carried forward as context, marked incomplete, never silently dropped.
- G4: Observability: the switch appears inline in the conversation history at the point it happened (system timeline entry); agent-call log remains the audit trail. No session-header badge.

## 3. Non-goals

- NG1: No tool re-execution by the new provider. Partial tool calls are reported as history, not replayed; the successor continues from the persisted transcript.
- NG2: No changes to tier authoring, cooldown durations, or reschedule policy flags.
- NG3: No manual cross-kind rule changes. Gemini (`gemini` kind) stays excluded from automatic cross-kind switches, same as manual switches.

## 4. Current behavior (baseline)

- Start: `runSessionWithTierFailover` freezes members, skips `isUnhealthy`, classifies via `matchesStartFailoverEligibleError` (tight gate: overload / 429 / 503 / 529 / rate-limit / quota / usage-limit / insufficient-credit / billing; prompt-size errors excluded), requires `sessionHasNoObservableAgentActivity`, emits `TIER_FAILOVER` WS event, snapshots winner via `pinSessionToTierMember`.
- Continue: `continueSessionCore → buildContinueModelAndEnv → resolveTierRefForContinueWithStaleFallback` reuses snapshot; `prepareContinueDispatch` builds `allowFailover: false` context; `reportTierMemberFailureHealth` only cools the failed member for future sessions.

## 5. Proposed behavior

### 5.1 Next-turn advance (required, ships first)

When a follow-up turn starts on a tier binding whose snapshotted member is now in cooldown (or deleted/disabled), resolve live to the first healthy member instead of reusing the stale snapshot:

- `resolveTierRefForContinue`, no-override branch: after `snapshotResolution`, check `isUnhealthy(snapshot.providerId, snapshot.model)` (and exact-identity validity). If cooled/stale, fall through to `resolveActiveModel(tierRef)` and persist `{ resolvedModel, resolvedProviderId }`.
- Treat as a provider switch: compute `hasDispatchPairChanged` against `lastExecutedModel/ProviderId`, set `modelChanged = true`, clear `conversations.claudeSessionId`, inject `buildConversationContextForModelSwitch`, rebuild env via `resolveDispatchProvider` + `buildSessionEnv`, re-derive `agentType`.
- Lift `checkContinuationDispatchKind` for this path only (new `isTierFailoverLiftable`: concrete tier member, both kinds in `['claude-code','codex','muse']`). Anything else keeps today's block.

### 5.2 Same-turn retry (optional fast-follow)

Wrap the continuation dispatch in a bounded (max 1 retry) loop:

1. On failure matching `matchesStartFailoverEligibleError` with `findNextHealthyTierMember` non-null: `markUnhealthy` current member, emit `TIER_FAILOVER`, update snapshot + `agentType` + env + adapter, clear resume chain, retry the same prompt once — regardless of durable activity in the failed turn.
2. The retry prompt carries the failed turn's persisted transcript (assistant messages, tool calls/results, work logs) plus a boundary marker: work before the marker is already done / partially done and must not be re-executed, only continued.
3. Otherwise (ineligible error, no healthy successor, user abort): fail the turn normally (existing error / auto-reschedule path) — the 5.1 rule advances the *next* turn.

### 5.3 UX (G4 — inline history marker, no session-header badge)

- No badge on the session detail view. The switch is surfaced inline in the conversation history, at the point where it happened: a system timeline entry such as `Switched from <fromProvider/fromModel> to <toProvider/toModel> — <reason>`, rendered between the failed turn's last message and the first message from the new member.
- Data source (existing, reused): every automatic switch keeps emitting the `TIER_FAILOVER` WS payload and writing a `tierFailover` agent-call log entry via `_logFailoverEvent` (`fromModel/ProviderId → toModel/ProviderId`, `reason`, `tierRef`, timestamp). The conversation view interleaves these entries chronologically with messages (live via the WS event, persisted via the agent-call log) — this is new rendering work in `ConversationTab`, not a new backend event.
- The existing `TierFailoverHistory` panel is not required for this FRD and should not be extended as the primary signal; the inline marker is the contract. (Whether to keep/remove that panel is a separate cleanup decision.)
- Failure message when tier is fully exhausted: keep `MODEL_TIER_EXHAUSTED` with ordered attempt list; do not silently fall back to SDK defaults.

## 6. Tier setting: automatic failover on/off

- Each model tier has `autoFailoverEnabled` (boolean, default `true`).
- When `true`: §5 behavior applies — eligible exhaustion advances to the next healthy member automatically, same-turn and next-turn.
- When `false`: no automatic member advance at any time. Behavior is today's pinned behavior: the turn fails visibly (existing error / auto-reschedule path), the failed member is still cooled via `reportTierMemberFailureHealth` so future *new* sessions skip it, but continuations stay on the same member until the user manually switches. No `TIER_FAILOVER` event is emitted for an automatic switch (none happens).
- Data model: new `model_tiers.auto_failover_enabled INTEGER NOT NULL DEFAULT 1` via migration (`addColumnIfMissing`); repository maps to `autoFailoverEnabled`; tier API (`GET/POST/PATCH /model-tiers`) accepts/returns it; validation is boolean-coercible; seed data uses the default.
- UI: Model Tiers view exposes an "Automatic failover" toggle per tier (default on), with copy: "When a provider runs out, automatically switch to the next model in this tier." Persisted via the tier PATCH endpoint.
- Enforcement points must all consult the flag: start-time loop (`runSessionWithTierFailover` — disabled means attempt only the resolved member / snapshot, then surface the error), next-turn advance (§5.1), and same-turn retry (§5.2). A disabled tier never calls `findNextHealthyTierMember` for dispatch.

## 6b. Functional requirements

- FR0: Automatic advance happens only when the bound tier's `autoFailoverEnabled` is true (default true). When false, no automatic advance occurs on any path.
- FR1: Eligible signals reuse the tight gate (`matchesStartFailoverEligibleError`) only. Prompt-size errors never trigger member advance.
- FR2: Advance target is the next healthy member in tier position order (`findNextHealthyTierMember` / `resolveActiveModel`); cooled members are skipped, never hammered.
- FR3: Every advance cools the failed member (`markUnhealthy`) exactly once.
- FR4: Cross-provider advance always discards the old native resume handle and never sends `resumeSessionId`; history is replayed as text.
- FR5: Durable `lastExecutedModel/ProviderId` + tier snapshot are updated atomically with the switch so a later provider-only PATCH cannot erase the evidence.
- FR6: A turn that produced durable activity still retries in place on an eligible exhaustion signal; the retry replays history (never re-executes tools) with an explicit failed-turn boundary marker.
- FR7: Fully-cooled / emptied tiers surface exhaustion (not a stale silent success); stale bindings keep the existing `applyStaleTierFallback` degradation.
- FR8: Non-interactive paths (scheduled, auto-send, lane runs) get the same advance semantics — no separate manual-confirm path.

## 7. Edge cases

- E1: Same `modelId` registered under two providers — identity is the exact `(providerId, modelId)` pair (`validateExactTierMember`), never model-id lookup.
- E2: Tier edited mid-run — the in-flight turn keeps its frozen candidate; the next turn resolves against the new membership.
- E3: Stop pressed mid-retry — user abort wins; no successor dispatch after `isUserStopAbort`.
- E4: Provider-only switch (same model id, different provider) is still a switch: resume off, history replay on.
- E5: Single-member tier exhaustion cools the member and returns the terminal error (no self-retry).

## 8. Testing

- Unit: flag on/off matrix (advance vs. pinned + no `TIER_FAILOVER` when off, default-on for legacy rows); cooled-snapshot advance in `resolveTierRefForContinue`; liftable vs. blocked kinds (gemini stays blocked); retry-after-activity with boundary marker; exact-pair identity with duplicate model ids; migration default (`auto_failover_enabled = 1`).
- Conformance: new quota strings added to `sessionErrorFixtures.js` + `sessionErrors.conformance.test.js` (tight gate passes, broad reschedule gate unchanged).
- E2E: tier `[A-quota-fail, B-healthy]` — fail turn on A, assert auto-advance to B on next turn with history intact and `TIER_FAILOVER` event emitted.

## 9. Open questions

- Q1: Ship 5.1 only, or 5.1 + 5.2 together? Recommendation: 5.1 first (no in-turn retry risk).
- Q2: Should auto-switch across kinds require an opt-in flag per session/tier, or default on? Recommendation: default on for tier-bound sessions (tiers already imply failover consent), with cooldown as the backstop.
