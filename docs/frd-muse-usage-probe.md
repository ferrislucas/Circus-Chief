# FRD: Muse Subscription-Usage Probe (MuseUsageProbe)

Status: Draft for review.

Design principles (per review): the feature has no flags or environment
knobs — it is always enabled and active only while Muse coding agents are
running. The single user-facing setting is the probe model, chosen in the
Settings UI: it defaults to the non-contributor model (`muse-spark-1.3`)
and may be switched to the contributor model
(`muse-spark-1.3-contributor`).

## 1. Goal

Feed the provider allowance indicator for the built-in `Meta (Official)`
provider (`meta-default`, kind `meta`) so it reports real quota instead of
`Unknown` / "No verified provider allowance data is available."

## 2. Background and validated evidence

All of the following were verified live against `muse` 1.4.2 on 2026-10-10
with the account logged in via `muse login`. Raw captures are described by
shape only; no credentials, tier ids, or account identifiers are recorded.

- The MSP wire schema (exported offline via `muse schema
  generate-json-schema`) defines `usage/read` → `{usage?}` and a
  `usage/changed` push notification, both carrying `SubscriptionUsage`:
  `{observedAtMs, tier, weekly {resetsAtMs, usedPercent}, window
  {resetsAtMs, usedPercent, windowDurationMins}}`. `usedPercent` is an
  integer ≥ 0 and may exceed 100; absence is truthful (`usage` omitted, never
  null).
- `usage/read` answers only what the serving host process itself has
  observed. A fresh `muse serve` host returns `{}` even with 49 Meta sessions
  with real turns on the machine, after 60s idle, after `session/list`,
  after `session/start`, and after a successful `session/resume` of a
  session with turn history.
- After that same host served one live `Hi` turn, it emitted
  `usage/changed` mid-turn and `usage/read` returned the full payload.
- No passive channel carries the data: `muse exec --json` stdout has no
  subscription frames; a machine-wide exact-match hunt found zero
  `usage/changed` records in ~800 view journals and all durable
  `session.jsonl` logs; no quota endpoint exists in the binary; no CLI
  command prints quota.
- Conclusion: the only obtainable signal is a host that serves live model
  traffic. A decoupled idle poller can never deliver and must not be built.

## 3. Approach

A `MuseUsageProbe` service spawns a short-lived `muse serve` process,
serves exactly one minimal turn through it, captures the resulting
`usage/changed` (falling back to `usage/read`), maps it to an allowance
candidate, observes it into `ProviderAllowanceService`, and tears the
process down. The agent execution path (`muse exec` per turn) is untouched.

## 4. Functional requirements

- FR-1: The probe runs `muse serve` (honoring `MUSE_BIN`), completes the
  `initialize` → `initialized` handshake, `session/start`s one session,
  submits one `turn/start` with input `[{type: 'text', text: 'Hi'}]`, and
  resolves with the first `usage/changed` params, or — if the turn ends
  without one — with `usage/read`'s `usage` member.
- FR-2: Active only while Muse agents run. Trigger on completion of any
  Muse-kind agent turn (fire-and-forget from the turn-completion path,
  currently `_executeSession`'s completion via `handleResultSuccess`; never
  blocks or delays the turn), plus a fixed 5-minute heartbeat that fires
  only while at least one non-archived Muse-agent session is in
  `starting`/`running` (same executing notion as
  `SessionRepository.getExecutingProviderIds`, filtered to agent type
  `muse`). At all other times the service is fully idle: no process, no
  timer effects, no traffic. Overlapping probes are serialized; a probe
  already in flight suppresses duplicates.
- FR-3: Map `SubscriptionUsage` to an allowance candidate with
  `providerKind: 'meta'`, `source: 'provider'`, `updatedAt` from
  `observedAtMs`, `staleAfterMs` from the shared stream-freshness window,
  and two `unit: 'other'` percentage allowances: 5-hour window
  (`remainingPercent = clamp(100 - window.usedPercent)`,
  `resetsAt = window.resetsAtMs`) and weekly window (same from `weekly`).
  The `tier` id is dropped at the boundary and never persisted, logged, or
  broadcast — mirroring how the Claude mapper drops uuid/session_id.
  Over-quota `usedPercent > 100` clamps to 0% remaining (`exhausted`).
- FR-4: Attribute the candidate to the built-in `meta` provider
  (`meta-default`), re-resolved per probe so disable/removal applies
  without restart (same pattern as `resolveCodexAllowanceProvider`).
- FR-5: Freshness follows the in-stream policy: observations go stale after
  `PROVIDER_ALLOWANCE_STREAM_STALE_MS` without refresh; staleness is the
  overlay flag, never a status replacement.
- FR-6: Failure is non-critical and silent to users. Any step failing
  (spawn, handshake, start, turn, timeout, non-zero exit, unparseable
  frames, no usage observed) resolves to "no data": keep the previous
  snapshot to age into `stale`, never interrupt a session, never throw into
  the turn path. Consecutive failures back off with the same bounded
  kill + backoff + breaker shape as `CodexAppServerMeter`.
- FR-7: Minimal footprint per probe: `serve --no-session-log` (memory-only
  sessions leave no session list/journal pollution — to be validated, see
  §9), model is the configured probe model (FR-9), prompt is exactly `Hi`,
  turn timeout bounded (≈60s), SIGTERM→SIGKILL escalation on hang, all
  stdio drained.
- FR-9 (probe model setting): the probe turn uses the model chosen in the
  existing model settings — the "Built-in Provider Settings" modal
  (`ProviderForm.vue` in built-in-manage mode), in a new "Usage probe
  model" section rendered directly below `ProviderModelsList` and only
  when the provider kind is `meta`. Options are the built-in `meta`
  provider's enabled models. Default is the non-contributor model
  (`muse-spark-1.3`); the user may switch to the contributor model
  (`muse-spark-1.3-contributor`). An unset, disabled, or otherwise invalid
  stored value resolves to the default. This is the feature's only setting;
  there are no enable flags or environment knobs. The section is exclusive
  to the `meta` provider's model settings: the Settings modals for
  `anthropic`, `openai`, and `google` providers MUST NOT render the probe
  selector or any probe affordance. See §7 for the wireframe.
- FR-8 (accepted operating cost): each probe spends one contributor-model
  micro-turn of subscription quota. This is inherent to the only validated
  acquisition path (§2) and is bounded by FR-2 (turn-end triggers plus an
  activity-gated heartbeat, idle otherwise). There is no enable flag by
  design; the cost disclosure belongs in the feature's review, not in a
  setting.

## 5. Non-functional requirements

- NFR-1: Zero impact on agent turns. The probe never shares a process,
  session, or credential handle with turn execution; turn-end triggering is
  asynchronous and unobserved failures are swallowed with a
  credential-free log line only.
- NFR-2: Bounded resources. One probe process at a time; per-probe
  wall-clock cap; timers `unref`d so an orphaned probe never holds the
  server event loop open; no writes to the user's Muse home beyond what
  the CLI itself does (and none with `--no-session-log` once validated).
- NFR-3: Logging hygiene. Raw JSON-RPC frames, prompts, tier ids, and
  auth material are never logged. Outcomes are counters only
  (`ok`, `no-data`, `timeout`, `spawn-failed`, `protocol-error`), following
  the Codex meter's structured-outcome convention.
- NFR-4: No new dependencies. Node stdlib child_process/readline only,
  mirroring `codexAppServerMeter.js`.

## 6. Architecture

New modules (server package, following the Codex meter split):

- `src/agents/adapters/museUsageMapper.js` — pure `mapMuseUsageChanged`
  (FR-3) plus `MUSE_PROBE_STALE_MS` derivation from the shared freshness
  config. No I/O, fully unit-tested with sanitized fixtures.
- `src/services/museUsageProbe.js` — `MuseUsageProbe` class with
  injectable `spawnProcess`/`clock` (test seams identical to
  `CodexAppServerMeter`): handshake → start → turn → capture → destroy,
  single-flight guard, consecutive-failure breaker.
- `src/services/museUsageProbeInstance.js` — singleton
  start/stop/trigger wiring plus the heartbeat timer; `trigger()` is the
  turn-end entry point.

Wiring: `src/index.js` starts/stops the instance alongside the Codex meter
and z.ai poller; the turn-end hook calls `trigger()` for `muse`-agent
turns; `getProviderAllowanceObserver()` is the only sink. No changes to
`MuseExecAdapter` or the allowance contracts (`source: 'provider'`
already exists). The existing `MUSE_BIN` override is reused for the probe
spawn. The only UI change is the probe-model picker (FR-9): a settings
store entry (default `muse-spark-1.3`) exposed through the settings API
and rendered in the existing model settings described below (not a new
page), following the existing summary-model setting pattern server-side.

## 7. UI placement and wireframe

Visual mockup: `docs/frd-muse-usage-probe-wireframe.svg` (posted alongside
this FRD on the canvas). The ASCII diagram below it describes the same
layout in text.

Entry point (unchanged): Providers view (`ProvidersView.vue`) →
`Meta (Official)` provider card → `Settings` button → "Built-in Provider
Settings" modal (`ProviderForm.vue`, built-in-manage mode). That modal
today contains the commit-attribution field followed by the models list
(`ProviderModelsList`, `.models-section`: one row per model with model
id, display name, and On/Off toggle). The probe picker is a new section
directly below the models list, rendered only for kind `meta`. It reuses
the modal's `.form-group` label/note styles and persists through the
modal's existing save path; no new route, no new page. For every other
provider kind the modal is byte-for-byte today's layout — no probe
section, no probe note, no placeholder.

```text
+----------------------------------------------------------+
| Built-in Provider Settings                           [x] |
+----------------------------------------------------------+
| Commit attribution override                            |
| [Blank uses agent default                      ]      |
|                                                        |
| Models                                                 |
|  muse-spark-1.3             Muse Spark 1.3        [On] |
|  muse-spark-1.3-contributor Muse Spark 1.3 ...   [On] |
|                                          [+ Add model] |
|                                                        |
| Usage probe model                          (meta only) |
|  ( ) Muse Spark 1.3              muse-spark-1.3  [DFLT]|
|  ( ) Muse Spark 1.3 Contributor muse-spark-1...        |
|  Note: each probe runs one micro-turn on this model    |
|  to refresh the usage indicator.                       |
|                                                        |
|                              [Cancel]  [Save]          |
+----------------------------------------------------------+
```

Behavior: radio group bound to the settings entry; options built from the
`meta` provider's currently enabled models (display name + model id);
selecting an option marks it pending until Save, consistent with the rest
of the modal. If the stored value names a model that is since disabled or
removed, the section renders with the default selected and saves the
default on next Save (fallback per FR-9).

## 8. Testing and validation

- Mapper unit tests from sanitized fixtures of the validated shape
  (percentages, over-100 clamp, missing weekly/window, absent usage,
  malformed frames) — checked in as tests per the repo's
  "validate before merge" rule (`docs/provider-allowances.md`).
- Probe tests with injected fake spawn: happy path (`usage/changed`
  mid-turn), fallback (`usage/read` after quiet turn), timeouts at each
  phase, non-zero exit, unparseable frames, single-flight suppression,
  breaker disablement. No test spends real quota or spawns `muse`.
- Pre-merge live validation (manual, maintainer's machine): enable the
  probe, complete one Muse turn, confirm the `meta-default` snapshot in
  `GET /api/providers/allowances` shows window + weekly percentages with
  resets; confirm `--no-session-log` leaves no new entries in the CLI
  session list; confirm a forced failure (e.g. bogus `MUSE_BIN`) degrades
  to stale/`Unknown` without touching sessions.
- Post-merge docs: add the source-matrix row to
  `docs/provider-allowances.md` (meta / Meta login / probe micro-turn /
  `provider`) with the freshness and billed-traffic notes.

## 9. Risks and open questions

- R-1 (accepted operating cost): continuous micro-spend of quota,
  bounded by FR-2 and minimized by the non-contributor default (FR-9). If
  the cost is unacceptable the recourse is removing the feature, not
  configuring it — keep `Unknown` (the per-turn token-usage fix already
  shipped separately).
- R-2: `--no-session-log` with serve-hosted turns is assumed from the flag
  help, not yet exercised. Validate pre-merge; fallback is accepting
  durable probe sessions (visible pollution) or stopping.
- R-3: CLI drift. The MSP schema is versioned per binary with a
  fingerprint; the probe must fail closed (no-data) on unknown frames,
  never guess. Pin the validated `muse --version` in the allowances doc.
- R-4: Quota burned by other clients (e.g. TUI) between probes is
  invisible until the next probe — inherent to polling, presented
  honestly via the stale flag and last-updated time.
- OQ-1: Fixed 5-minute heartbeat cadence vs. quota cost — confirm
  acceptable burn rate before merge (fixed value, not a setting).
- OQ-2: Should the probe turn use an even cheaper path (echo provider
  yields no observation — already disproven; no zero-cost probe exists).
