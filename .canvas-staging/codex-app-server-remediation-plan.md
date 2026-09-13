# Codex App Server Remediation Plan

## Objective

Make Codex App Server the reliable default CLI transport while preserving event visibility, accurate usage accounting, truthful capabilities, protocol-compatible structured questions, secure input handling, and clean PR scope.

Every implementation item follows **red, green, refactor**: first add a focused failing test that reproduces the production gap, then make the smallest change that passes it, then improve structure without changing behavior. Do not weaken assertions or encode fields absent from the pinned Codex 0.145.0 protocol.

## 1. Restore App Server event and usage parity

### Red

- Add runner/mapper integration tests using representative Codex 0.145.0 notifications.
- Prove camelCase `commandExecution` and `fileChange` items currently fail to emit expected application events.
- Prove `thread/tokenUsage/updated` currently fails to update token totals and `turn/completed` is not a valid usage source.
- Cover unknown item types so protocol additions are observable rather than silently discarded.

### Green

- Add explicit, version-aware App Server normalization for item types while preserving legacy `codex exec` mappings.
- Consume usage from `thread/tokenUsage/updated`, preserving the cumulative/delta semantics expected by existing accounting.

### Refactor

- Separate transport decoding from application event mapping and centralize item-type constants and unsupported-event diagnostics.

### Acceptance

- Command and file events remain visible end-to-end; token totals match protocol fixtures without double counting; legacy behavior is unchanged.

## 2. Make capabilities truthful in production routing

### Red

- Add gateway-level tests for default App Server mode and `USE_CODEX_DIRECT_API=1`.
- Demonstrate the production response incorrectly advertises `interactiveInput: true` in direct API mode.
- Prove an interaction-requiring turn can currently reach a transport without interactive input.

### Green

- Make `AgentGateway` resolve capabilities from the configured adapter instance.
- Ensure direct API reports `interactiveInput: false`, App Server reports `true`, and routing honors the distinction.

### Refactor

- Establish one authoritative capability path for API reporting and routing; remove or constrain drifting static metadata.

### Acceptance

- Capability output and routing agree in every supported Codex mode, satisfying FR-11.

## 3. Align choices with the pinned protocol

### Red

- Replace invented `isMultiSelect` fixtures with fixtures generated from or validated against Codex 0.145.0 definitions.
- Add failing round-trip tests for every choice shape the pinned protocol actually supports.
- Add a compatibility test that rejects assumptions about undeclared protocol fields.

### Green

- Derive behavior only from fields in the pinned contract, or reject unsupported multi-select requests clearly.
- If the FRD requires true multi-select but 0.145.0 cannot express it, either adopt a supporting protocol version or revise the contract before merge.

### Refactor

- Keep version-specific translation behind the codec and use protocol-derived types/schema validation.

### Acceptance

- Tests use the real wire format; supported choices round-trip exactly and unsupported semantics never silently degrade.

## 4. Preserve timeout and secret semantics

### Red

- Add tests showing request-level `autoResolutionMs` is dropped and questions outlive the requested timeout.
- Add UI/store tests showing `isSecret` is treated as ordinary visible text.
- Cover timeout, answer, cancellation, invalidation, interruption, and failure races, asserting one terminal resolution and no late-answer reuse.

### Green

- Carry `autoResolutionMs` through normalization and schedule expiry according to protocol semantics.
- Carry `isSecret` through the prompt model and render it with a masked control.
- Exclude secret values from logs, diagnostics, durable history, analytics, and error payloads; clear them promptly after delivery.
- Make competing terminal transitions atomic/idempotent.

### Refactor

- Centralize prompt termination/timer cleanup and isolate sensitive-value serialization boundaries.

### Acceptance

- Auto-resolution occurs on time and clears pending state; secrets are masked, minimally retained, never logged, and delivered once; lifecycle races leak no handlers or timers.

## 5. Clean scope and documentation

### Red

- Add or run a focused diff-hygiene check that flags unrelated `MoveCardModal.vue` whitespace and `SessionCard.test.js` mock churn.
- Check the PR description for transport migration, protocol pin, compatibility constraints, capability behavior, and remediation evidence.

### Green

- Revert only unrelated changes while preserving intentional user work.
- Update the PR description with the default transport, Codex 0.145.0 pin, compatibility decisions, security/lifecycle behavior, and merge-gate evidence.

### Refactor

- Consolidate fixtures/helpers and remove obsolete adapter code only after references and fallback requirements are verified.

### Acceptance

- The diff against `origin/main` contains only intentional work and the PR description accurately documents behavior, limitations, risks, and validation.

## Execution and final verification

Complete workstreams in this order: event/token parity; capabilities/routing; protocol choice semantics; timeout/secrets/lifecycle; hygiene/docs. Finish the full red–green–refactor cycle for each before proceeding. Then run focused suites, broader server/UI suites, and static checks; re-review the aggregate diff against `origin/main`; merge only after every acceptance condition has evidence.
