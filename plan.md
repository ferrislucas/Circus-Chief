# Implementation Plan: Mid-Session Automatic Tier Failover

Source of truth: `mid-session-tier-failover-frd.md` on canvas (v5).
Working method: **red → green → refactor on every phase**. No production code without a failing test first. Stop after planning — no code changes in this turn.

## 0. Baseline & guardrails

- Touchpoints: `tierResolutionService.resolveTierRefForContinue`, `sessionContinuation.buildContinueModelAndEnv / continueSessionCore`, `sessionAgentGuard.checkContinuationDispatchKind (+ new isTierFailoverLiftable)`, `sessionExecution` error path, `tierFailureHealth.reportTierMemberFailureHealth`, `tierAttemptOutcome` (reuse event emitter), `modelTiers` migration + `ModelTierRepository` + `contracts/modelTiers` + `api/modelTiers`, `web ModelTiersView` + `ConversationTab`.
- Invariants that must not regress: tight failover gate (`matchesStartFailoverEligibleError`, prompt-size excluded), exact `(providerId, modelId)` identity (`validateExactTierMember`), resume never crosses providers, Stop always wins (`isUserStopAbort`), gemini excluded from auto cross-kind.
- Commands: `yarn workspace @circuschief/server test <file>`, `yarn workspace @circuschief/web test <file>`, `yarn test`, `yarn lint`.

## Phase 1 — RED: failing contract tests for the tier flag (no prod code)

1. Add `packages/server/src/db/migrations/modelTiersAutoFailover.test.js` (new): asserts `model_tiers` has `auto_failover_enabled INTEGER NOT NULL DEFAULT 1`, legacy rows read as `autoFailoverEnabled: true`.
2. Extend `packages/server/src/db/ModelTierRepository.test.js`: create/update round-trip of `autoFailoverEnabled` true/false/default.
3. Extend `packages/shared/src/contracts/modelTiers.test.js` + `packages/server/src/api/modelTiers.test.js`: `CreateTierRequest`/`UpdateTierRequest` accept optional boolean `autoFailoverEnabled` (default true on create), PATCH toggles it, unknown keys still rejected.
4. Web: extend `ModelTiersView.test.js` (or new toggle test): toggle renders checked by default, PATCH persists on change.
5. Run all four — they must FAIL (red). This red surfaces the entire data-model/API/UI surface before any implementation.

## Phase 2 — GREEN: flag plumbing (migration → repo → contract → API → UI)

1. Migration `model-tiers-auto-failover-flag` with `addColumnIfMissing(db, 'model_tiers', 'auto_failover_enabled', 'INTEGER NOT NULL DEFAULT 1')`.
2. `ModelTierRepository`: map `auto_failover_enabled` ↔ `autoFailoverEnabled` in `#mapTier`, `getAllWithMembers`, `getByIdWithMembers`; `create`/`update` persist it (create defaults true).
3. Contracts: add `autoFailoverEnabled: z.boolean().optional()` to create/update (strict stays on); `TierResponse` gains required `autoFailoverEnabled: z.boolean()`.
4. API: `withManagementMembers` passes the field through; verify PATCH path calls `modelTiers.update` with it.
5. Web `ModelTiersView`: "Automatic failover" toggle per tier, copy `When a provider runs out, automatically switch to the next model in this tier`, persisted via tier PATCH.
6. Green: Phase 1 tests pass. Refactor: dedupe boolean coercion (`INTEGER 1/0 ↔ boolean`) in one mapper helper. Full `yarn test` + `yarn lint`.

## Phase 3 — RED: failing resolution tests for next-turn advance (§5.1)

1. Extend `tierResolutionService.test.js` / `sessionContinuation.test.js`:
   - cooled snapshot (`markUnhealthy(A)`) + healthy B → `resolveTierRefForContinue` returns B with `persist {resolvedModel: B, resolvedProviderId}` (FR2).
   - flag off → returns pinned A snapshot, no advance, no `TIER_FAILOVER` (FR0).
   - deleted/disabled snapshot member → live `resolveActiveModel` fallback.
   - cross-kind A→B (`claude-code→codex`) lifts via new `isTierFailoverLiftable`; gemini involvement stays blocked (NG3).
   - duplicate `modelId` across providers resolves by exact pair, never model-id lookup (E1).
2. Run — must FAIL. This red is the §5.1 work order.

## Phase 4 — GREEN: next-turn advance

1. `tierResolutionService.resolveTierRefForContinue` no-override branch: after `snapshotResolution`, validate exact identity + `isUnhealthy`; on cooled/stale, `resolveActiveModel(tierRef)` + persist new snapshot. Consult tier flag first (off → return snapshot path unchanged).
2. `sessionContinuation.buildContinueModelAndEnv`: on tier-driven advance, `hasDispatchPairChanged` → `modelChanged=true`, clear `claudeSessionId`, `buildConversationContextForModelSwitch`, `resolveDispatchProvider` + `buildSessionEnv`, re-derive `agentType` via liftable path.
3. Add `sessionAgentGuard.isTierFailoverLiftable` (concrete tier member, both kinds in `['claude-code','codex','muse']`); `checkContinuationDispatchKind` consults it only for tier-driven candidates.
4. Green + refactor: keep `resolveTierRefForContinueWithStaleFallback` as the single entry; no forked resolvers. Re-run Phase 3 + `sessionAgentGuard.test.js` + continuation suites.

## Phase 5 — RED: failing same-turn retry tests (§5.2, G3-always)

1. New `sessionContinuation.failoverRetry.test.js`: eligible error (from `sessionErrorFixtures` quota corpus) + healthy B → same prompt retried once on B with boundary marker, snapshot + `lastExecuted*` updated, `TIER_FAILOVER` emitted; ineligible error / no successor / Stop → no retry; single-member tier → terminal error (E5); retry carries prior transcript and never re-executes tools (NG1/G3 marker assertion).
2. Run — must FAIL.

## Phase 6 — GREEN: same-turn retry (max 1)

1. Wrap continuation dispatch in a bounded single-retry loop in `continueSessionCore` (or `prepareContinueDispatch` caller): on `matchesStartFailoverEligibleError` + `findNextHealthyTierMember` non-null + flag on + kind liftable → `markUnhealthy`, emit event (reuse `emitTierFailoverEvent` — export it), update snapshot/agentType/env/adapter, clear resume, retry once with `buildConversationContextForModelSwitch` + boundary marker (`already done — do not re-execute, continue from transcript`).
2. Flag off → skip loop entirely (pinned failure path). `isUserStopAbort` checked before any successor dispatch (E3).
3. Green + refactor: share the switch-application helper between §5.1 and §5.2 so snapshot/agentType/env/resume handling cannot drift.

## Phase 7 — RED then GREEN: inline history marker (G4)

1. RED first: new `ConversationTab.failoverMarker.test.js`: given persisted `tierFailover` agent-call entries + messages, timeline renders `Switched from X to Y — reason` between the failed turn and the next member's first message; live `TIER_FAILOVER` WS event inserts it without reload; no session-header badge asserted.
2. GREEN: `ConversationTab` interleaves `tierFailover` entries chronologically (fetch via `api.getSessionAgentCalls({callType:'tierFailover'})` like `TierFailoverHistory`, subscribe to `TIER_FAILOVER` in `useSessionSubscription`). Do not extend `TierFailoverHistory` as the primary signal (FRD decision).

## Phase 8 — Conformance, E2E, rollout

1. Conformance (TDD too): add real quota strings to `sessionErrorFixtures.js` first (red in `sessionErrors.conformance.test.js`), then adjust only if the tight gate misses them — never widen to prompt-size wording.
2. E2E: tier `[A-quota-fail, B-healthy]` — fail turn on A, assert auto-advance to B with history intact, inline marker visible, `TIER_FAILOVER` emitted; repeat with flag off (pinned failure, no marker).
3. Full gates: `yarn test`, `yarn lint`, relevant Playwright suite via `./scripts/pw.sh`.
4. Rollout: default-on flag means existing tiers gain mid-session failover on deploy; document the toggle in the tier settings copy. Open question from FRD §9 (ship §5.1 before §5.2) is preserved by phase order — §5.1 is independently shippable after Phase 4.
