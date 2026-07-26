# Remediation Plan — PR #1063 Review Findings

**PR:** #1063 — feat: make built-in model choices configurable
**Branch:** `circus-chief/f5bd-need-change-how-system`
**Companion:** `FRD-built-in-model-choices.md`
**Updated:** 2026-07-25

This plan addresses the five issues raised in the PR review. It does **not**
re-do the feature — the feature is implemented and both unit suites are green
(server 4800, web 4706). This is targeted remediation.

## Working method — red, green, refactor (mandatory)

For **every** item below, follow this order strictly:

1. **RED** — Write a focused, failing test that surfaces the defect first.
   Run it and capture the failure output showing the *wrong current behavior*
   (e.g. the alphabetical seed order, or a disabled model leaking into a
   non-session picker). Do not touch production code until the test fails for
   the right reason.
2. **GREEN** — Make the smallest production change that turns the test green.
3. **REFACTOR** — Clean up (dead code, naming, duplication) with the suite
   still green.

Do not batch production changes ahead of their tests. Each numbered issue is
its own red/green/refactor slice. Run `yarn workspace @circuschief/server test`
and `yarn workspace @circuschief/web test` after each slice; run the relevant
`./scripts/pw.sh test` specs before finishing.

---

## Issue 1 (High / blocker) — Fresh-install catalog order is alphabetical, not catalog order

**Symptom (verified against a real fresh DB):** because `seedBaselineData`
inserts every model with an identical `created_at`, and the
`provider-models-backfill-sort-order` migration tiebreaks equal timestamps on
the lexical row `id` (`pm2.id < provider_models.id`) rather than `rowid`, every
provider's `sort_order` ends up alphabetical by seed slug:

```
openai-default: 5.3-codex, 5.4, 5.4-mini, 5.5, luna, sol, terra   (default "sol" is NOT first)
anthropic-default: fable, haiku, opus-4-6, opus-4-7, opus-4-8, sonnet
google-default: flash, flash-lite, pro
```

Intended catalog order (FRD §9 / the `CLAUDE_MODELS` / `OPENAI_MODELS` /
`GEMINI_MODELS` arrays) is default-first and curated. This regresses Gemini/
OpenAI ordering vs `origin/main` and violates FR-3.2 and the plan's explicit
instruction: *"Use `rowid`, not lexical row id, as the insertion-order
tiebreak."*

**RED**
- Server test: init a fresh DB via `DatabaseManager`, read
  `getModels('openai-default')`, `getModels('anthropic-default')`,
  `getModels('google-default')`, and assert `sortOrder` order matches the
  declared catalog array order for each provider — including that the default
  model (`gpt-5.6-sol`, `claude-opus-4-8`, `gemini-2.5-flash` per
  `DEFAULT_*_MODEL`) sorts where the catalog puts it. This test fails today.
- Migration test: build a fixture with several rows sharing one `created_at`
  and assert the backfill preserves insertion (`rowid`) order, not lexical id.

**GREEN — pick one, prefer (a):**
- (a) Assign `sort_order` in catalog order at seed time: give each catalog
  entry an explicit ordinal (its array index) and have `seedBaselineData` /
  `syncBuiltInModelCatalogs` write it, so ordering never depends on the
  backfill tiebreak. This is the most robust fix (order is data, not an
  accident of insertion).
- (b) Minimal fix: change the backfill's `OR (created_at = ... AND pm2.id <
  provider_models.id)` to use `rowid` (`pm2.rowid < provider_models.rowid`),
  matching the dedupe helper and the plan. Keep `seedBaselineData` inserting
  rows in catalog-array order so `rowid` follows the catalog.

**REFACTOR** — Ensure the `getModels` ORDER BY (`(sort_order IS NULL),
sort_order ASC, created_at ASC`) has a final `rowid` tiebreak for full
determinism. Confirm upgrade fixtures still preserve *existing user* order
(only NULL `sort_order` is backfilled).

---

## Issue 2 (Low–Medium) — Disabled models un-hidden by `modelValue` in every picker

**Symptom:** `withDisabledModelsHidden(provider, keepModelIds)` in
`ModelSelector.vue` builds `keepModelIds` from `resolveModelId(props.modelValue)`
unconditionally, so a disabled-but-not-removed model is shown in *any* picker
whose bound value happens to equal it — including project-defaults, template,
and scheduling pickers holding a stale value. The plan (Phase 7) explicitly
forbids using `modelValue` alone as the exception key; the historical exception
must be session-scoped and provider-aware.

**RED**
- Component test: render `ModelSelector` **without** `sessionScoped` and with
  `modelValue` set to a disabled built-in model id; assert that disabled model
  does **not** appear in the options. Then render **with** `sessionScoped=true`
  and the owning `providerId`, and assert it **does** appear and stays
  selectable. The first assertion fails today.

**GREEN** — Gate the "keep the current value visible" exception behind the same
session-scoped + provider-aware path already used for soft-removed rows (the
`historicalEntry` merge), rather than the unconditional `keepModelIds` set.
A disabled row for a session's own model should be surfaced only when
`sessionScoped` is true and the `providerId` matches.

**REFACTOR** — Unify the disabled-but-present and soft-removed continuity logic
so there is one session-scoped exception mechanism, not two.

---

## Issue 3 (Low) — Dead code from the removed attribution modal

**Symptom:** `openAttributionModal` was deleted from `ProvidersView.vue`, so
`attributionOnly` is now permanently `false`. The `attributionOnly ? 'Commit
Attribution'` title branch, the `attributionOnly` prop on `ProviderForm`, and
the `attributionOnlyRef` path in `useProviderForm` are unreachable. Built-in
providers now correctly route through the "Built-in Provider Settings" modal
(which still exposes commit attribution).

**RED** — This is dead-code removal, so the "test" is the guardrail: confirm no
spec references `attributionOnly` / `openAttributionModal` as a real path
(search first). If a test still asserts the old attribution-only behavior,
update it to assert the built-in-manage modal path (which is the current E2E
expectation `commit-attribution-settings.spec.ts` already covers). Keep those
green while removing the code.

**GREEN / REFACTOR** — Remove `attributionOnly` prop, ref, and the dead title
branch and `saveLimitedProvider` `attributionOnly` handling **only if** truly
unused after the search. If commit-attribution editing for built-ins now flows
solely through `builtInManage`, collapse the two limited-save branches into
one. Re-run unit + the attribution E2E spec.

---

## Issue 4 (Low) — Repo-level `reorderModels` silently drops foreign/duplicate ids

**Symptom:** `providerModelOperations.reorderModels` filters unknown ids
(`orderedRowIds.filter(id => validIds.has(id))`) instead of rejecting. The API
route validates ownership + duplicates and returns 400, so HTTP callers are
safe, but the repository itself would silently corrupt order for any non-HTTP
caller. The plan asks the repository to reject.

**RED** — Repository test: call `reorderModels(providerId, [validId,
'foreign-id'])` and a duplicate list, and assert it throws (or returns a clear
error), not that it silently drops. This fails today.

**GREEN** — Make `reorderModels` throw on foreign or duplicate row ids (mirror
the API's checks) before writing. Keep the "append omitted active rows"
behavior for the legitimate partial-order case.

**REFACTOR** — Share one validation helper between the API route and the
repository so the rule is defined once.

---

## Issue 5 (Informational) — Catalog "first-party evidence" is self-referential

**Symptom:** `types.js` sets every entry's `evidence` to the FRD itself,
because the shipped model ids are fictional/forward-dated for this environment.
FRD §0's requirement for dated, first-party *external* documentation is
therefore not literally met.

**Action (no code):** Get explicit product-owner sign-off that citing the FRD's
canonical seed list is acceptable evidence of record for this environment, and
record that decision in the catalog matrix comment / release notes. No test
required; do not silently treat the AC as satisfied.

---

## Definition of done

1. Each issue above landed as its own red→green→refactor commit, with the
   RED test committed and now passing.
2. New tests specifically assert: catalog-order seeding for all three
   providers (incl. default-first), disabled-model picker gating by session
   scope, and repository reorder rejection of foreign/duplicate ids.
3. `yarn workspace @circuschief/server test` and
   `yarn workspace @circuschief/web test` both green.
4. `./scripts/pw.sh test` green for the model-selection / provider-settings
   specs (`opus-4-7-model`, `draft-session-model-ui`,
   `commit-attribution-settings`).
5. Issue 5 decision recorded.
6. PR description updated to reflect the full scope actually implemented
   (soft-removal, lifecycle, built-in add/remove, Gemini, gpt-5.5 migration),
   since the current description undersells it.
