# FRD: Subscription-Remaining UI — Most-Recently-Used Provider Ordering

Status: Draft for review.

## 1. Goal

Change the provider-usage ("subscription remaining") dialog so model
providers order by most-recently-used (MRU): the most recently used
provider is on top, remaining providers follow in decreasing recency
order. Never-used providers sort last.

## 2. Background and current behavior

The subscription-remaining UI is the `Provider usage` dialog in
`packages/web/src/components/ProviderAllowanceIndicators.vue`, fed by
`GET /api/providers/allowances` through
`packages/web/src/stores/providerAllowances.js` and
`packages/server/src/services/ProviderAllowanceService.js`.

Current ordering is priority-grouped, not recency-based:

1. Providers with an executing session (`starting`/`running`, via
   `SessionRepository.getExecutingProviderIds`) first.
2. Then providers needing attention (`warning` / `critical` /
   `exhausted`).
3. Then everything else (`available` / `unknown` / `stale`).

Within each group, order is stable (server/configured order), so the
list does not jitter between equivalent updates. The single battery
trigger summarizes the *worst* snapshot (severity, then lowest
remaining percent) — that summary is independent of list order.

Problem: a provider the user touched minutes ago can sit below a stale
`warning` on an untouched provider, forcing the user to hunt for the
number they care about. Recency matches the user's mental model ("what
did I just burn?") better than severity grouping for the dialog list.

## 3. Approach

Replace the priority-group comparator with a recency comparator on both
sides of the existing split:

- Server (`ProviderAllowanceService.getSnapshots`) remains the
  canonical orderer of the REST response.
- Client (`prioritizeSnapshots` in `providerAllowances.js`) mirrors the
  same comparator for websocket `replace()` / staleness refreshes so
  live updates converge without a refetch.

## 4. Functional requirements

- FR-1 (ordering): dialog snapshots sort by provider last-used time,
  descending. Most recent first; `null` (never used) last.
- FR-2 (definition of "used"): last-used for a provider is
  `MAX(sessions.updated_at)` over rows with that `provider_id`.
  Session create, turn completion, status transitions, and edits all
  bump `updated_at` today, so no write-path changes are needed. Active
  (`starting`/`running`) sessions naturally carry the freshest
  timestamps, so the old "active first" intent is preserved as a
  consequence of recency rather than as a special group.
- FR-3 (scope of history): all sessions count, including archived,
  stopped, completed, error, and scheduled rows. "Used" is historical,
  not liveness. Rows with `provider_id IS NULL` are ignored.
- FR-4 (ties and never-used): equal timestamps and all-`null`
  providers keep configured/server order via a stable sort — no
  jitter between equivalent updates.
- FR-5 (contract): each snapshot carries `lastUsedAt: number | null`
  (epoch ms, nullable). The list response keeps `activeProviderIds`
  unchanged for badge/trigger and probe-gating consumers; it is no
  longer an ordering input for the dialog.
- FR-6 (trigger unchanged): the battery trigger, attention badge
  count, live announcements, and worst-status summary keep today's
  severity-based logic. Only the dialog list order changes.
- FR-7 (real-time): session created/updated/deleted events that change
  recency re-reconcile (reuse the existing
  `PROVIDER_ALLOWANCE_PRIORITY_INVALIDATED` / session-reconcile
  refetch path with recency semantics). Allowance observations
  (`PROVIDER_ALLOWANCE_UPDATED`) re-sort with the snapshot's existing
  `lastUsedAt`, never resetting it to `null`.
- FR-8 (staleness unchanged): the stale overlay (`stale: true` keeps
  underlying `status`) is orthogonal; staleness never affects recency
  position.

## 5. Non-functional requirements

- NFR-1: Deterministic order — REST and websocket consumers converge
  on the same comparator; no per-render randomness or clock reads in
  the sort itself.
- NFR-2: Bounded query cost — recency is one `GROUP BY provider_id`
  projection (`MAX(updated_at)`), same shape as the existing
  `getExecutingProviderIds` distinct projection, with an index-friendly
  predicate.
- NFR-3: No new dependencies; no migration (projection over existing
  `sessions.updated_at` / `provider_id` columns).

## 6. Architecture

New repository projection (server, following the
`getExecutingProviderIds` pattern):

- `SessionRepository.getProviderLastUsedAt()` → `Map<providerId,
  epochMs>` (or plain object) from `SELECT provider_id,
  MAX(updated_at) ... WHERE provider_id IS NOT NULL GROUP BY
  provider_id`.

Service changes:

- `ProviderAllowanceService.getSnapshots()` stamps each snapshot with
  `lastUsedAt` from the projection and sorts descending (stable).
- `observe()` preserves the stored snapshot's `lastUsedAt`; recency
  is a session-domain fact, never derived from allowance frames.

Contract changes (`@circuschief/shared/contracts/providers.js`):

- `ProviderAllowanceSnapshot` gains `lastUsedAt: z.number().finite()
  .nullable()`.
- `ProviderAllowanceListResponse.activeProviderIds` retained (badge,
  trigger, probe gating), documented as not-an-ordering-input.

Client changes:

- `prioritizeSnapshots(snapshots)` sorts by `lastUsedAt` descending,
  `null` last, stable; drops the `activeProviderIds` parameter (or
  keeps it ignored with a deprecation note — reviewer to pick).
- `ProviderAllowanceIndicators.vue` session-reconcile comments updated
  from "active-session ordering" to "recency ordering"; no template
  changes (the existing `v-for="snapshot in snapshots"` renders the
  new order).

## 7. UI placement

No layout, copy, or control changes. Entry point unchanged: battery
trigger → `Provider usage` dialog → one `article.provider-detail` per
provider in `snapshots` order. The only observable change is list
order: most recently used provider's article renders first.

```text
BEFORE (priority groups)          AFTER (recency)
+--------------------------+      +--------------------------+
| Provider usage             |      | Provider usage             |
+--------------------------+      +--------------------------+
| 1. Active provider       |      | 1. Last-used 2 min ago   |
| 2. Warning (idle 3 days) |  --> | 2. Last-used 1 hour ago  |
| 3. Used 2 min ago        |      | 3. Warning (idle 3 days) |
| 4. Never used            |      | 4. Never used            |
+--------------------------+      +--------------------------+
```

## 8. Testing and validation

- Service unit tests: MRU order over fabricated `lastUsedAt` values;
  never-used last; tie preserves configured order; `observe()` keeps
  prior `lastUsedAt`; archived/stopped sessions still count (repo
  projection test with mixed statuses).
- Repository test: `getProviderLastUsedAt` returns per-provider
  `MAX(updated_at)`, ignores `NULL` provider rows.
- Contract test: snapshot with `lastUsedAt` parses; legacy payload
  without it fails closed (strict) — or defaults, reviewer to pick
  with migration policy.
- Store test: `replace()` with an attention snapshot on an idle
  provider does NOT jump above a more recently used healthy provider
  (inverts today's "attention jumps queue" test — update, don't
  delete: keep the old expectations as regression evidence of the
  intentional change).
- E2E: seed two providers with sessions of known `updated_at`, open
  the dialog, assert article order; start a session on the older
  provider, assert it moves to top without reload.

## 9. Risks and open questions

- R-1: Users who relied on "warnings float up" lose that affordance
  in the dialog. Mitigation: badge count, trigger color, and live
  announcements still surface severity; the dialog header could
  optionally carry a one-line severity summary (out of scope unless
  review asks).
- R-2: `updated_at` bumps on any session edit, not just model
  traffic — an edit-only touch counts as "use". Accepted: any touch
  signals user attention to that provider.
- OQ-1: Should `lastUsedAt` consider only non-archived sessions?
  Proposal says no (history is history), but review may narrow it.
- OQ-2: Contract migration — strict-required vs. defaulted-null
  `lastUsedAt` for old cached payloads. Pick during implementation.
