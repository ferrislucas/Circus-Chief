# FRD — Configurable Built-in Model Choices

**Status:** Draft for review
**Author:** Circus Chief planning session
**Last updated:** 2026-07-24
**Workspace:** `2e1504f7-4f6a-4668-a603-c982d0b03869`

---

## 1. Problem / Background

Circus Chief ships three **built-in providers** — Anthropic (Claude Code), OpenAI (Codex), and Google (Gemini) — each seeded with a fixed, hard-coded list of models from the `CLAUDE_MODELS` / `OPENAI_MODELS` / `GEMINI_MODELS` constants. Today these built-in model lists are:

- **Not exhaustive** — they don't represent the full set of models supported by Claude Code and Codex.
- **Not configurable** — users cannot reorder them or turn individual choices on/off. The only knob is the provider-level enable/disable for built-in providers.
- **Only partially "soft-deletable"** — a single hardcoded special case (`RETIRED_BUILT_IN_OPENAI_MODEL_IDS = ['gpt-5.5']`) hides one legacy OpenAI model from new selection while keeping it runnable for historical sessions.

Meanwhile, **custom providers** already let users add/remove model rows (`ProviderForm` → `ProviderModelsList`), but even there users cannot reorder or enable/disable individual models.

The existing "retired" mechanism proves the right shape: a model stays resolvable for sessions that already use it, but is hidden from new choices. This FRD generalizes that idea into a first-class **per-model enable/disable + reorder** capability, with a management UI congruent with the existing custom-model-management surface, and expands the built-in catalogs to the full supported set.

## 2. Goals & Non-Goals

### Goals
1. **Comprehensive built-in catalogs** — the built-in Anthropic (Claude Code) and OpenAI (Codex) providers expose every model supported by those agents.
2. **Per-model configurability** — users can **reorder** and **enable/disable** individual built-in model choices. The Gemini built-in inherits the same capability (same code path).
3. **Congruent management UI** — managing built-in model choices looks and behaves like managing custom provider model choices (shared components), extended with reorder + enable/disable.
4. **Smooth handling of disabled models on existing sessions** — a session already set to a model that later gets disabled keeps that model as a selectable, working choice in that session. No "unknown model" breakage, no forced switch.

### Non-Goals
- Changing how models are resolved/executed at runtime (env vars, agent adapter selection).
- Provider-level enable/disable (already exists).
- Changing the immutability of provider `kind`.
- Net-new model sources beyond Anthropic / OpenAI / Google.
- Replacing the SDK tier aliases (`opus`/`sonnet`/`haiku`/`fable`).

## 3. Stakeholders / Users
- **End users** configuring providers and picking models for sessions.
- **Session continuity** — any user with existing sessions must not be disrupted when a model is disabled.

## 4. User Stories

- **US1 — Comprehensive choices:** As a user, when I pick a model for a new session, the built-in Claude Code and Codex groups show every model those agents support, so I can choose the exact one I want.
- **US2 — Reorder:** As a user managing a provider's models, I can reorder the model choices (up/down), and every model picker in the app (new session, project defaults, active session, scheduled session, templates) reflects my order.
- **US3 — Enable/disable:** As a user managing a provider's models, I can disable a model I don't want to see, and re-enable it later. Disabled models disappear from new-selection pickers.
- **US4 — Congruent UI:** As a user, managing built-in provider models feels the same as managing custom provider models — same list layout, same reorder + toggle controls — differing only where built-ins must be protected (no adding/removing canonical rows, no changing the underlying model id).
- **US5 — Disabled but in use stays usable:** As a user with a session set to model X, if X is later disabled, that session still shows X as its selected model, X remains a selectable option in that session's picker, and the session continues to run normally. Other sessions no longer offer X as a new choice.
- **US6 — Retired model migrated:** The legacy `gpt-5.5` "retired" special case is absorbed into the new enable/disable mechanism (it becomes a disabled built-in row that can be re-enabled), removing the hardcoded retirement list.

## 5. Functional Requirements

### FR-1 Catalog completeness
- **FR-1.1** `CLAUDE_MODELS` and `OPENAI_MODELS` constants are expanded to the full set of models supported by Claude Code and Codex respectively (see §9 for the canonical seed list; exact ids confirmed against the live provider at implementation time).
- **FR-1.2** Built-in model seeding is driven by a single source of truth per kind (the constant), so adding a supported model in future is a one-line change. (Anthropic seeding currently duplicates the list in `seedBaselineData.js`; it should derive from `CLAUDE_MODELS` like OpenAI already derives from `OPENAI_MODELS`.)
- **FR-1.3** Re-running seed migrations on startup adds any newly-introduced catalog entries without resetting user reordering or enable/disable state.

### FR-2 Per-model enable/disable
- **FR-2.1** Each `provider_models` row has an `enabled` flag (default on).
- **FR-2.2** A disabled model is excluded from **new-selection** surfaces (every `ModelSelector` instance).
- **FR-2.3** A disabled model remains a **valid model id** server-side (`getAllModelIds()` still includes it), so existing sessions, templates, and provider rows referencing it continue to validate and execute.
- **FR-2.4** When a model is the **currently-selected model of the session** whose picker is being rendered, that disabled model is force-shown as a selectable option in that picker (satisfies US5).

### FR-3 Reordering
- **FR-3.1** Each `provider_models` row has a `sort_order`.
- **FR-3.2** Model lists everywhere are ordered by `sort_order` (then by `created_at` as a tiebreaker).
- **FR-3.3** Users can reorder models within a provider; the new order is persisted and reflected in all pickers.
- **FR-3.4** The order-respect semantics are identical for built-in and custom providers.

### FR-4 Congruent management UI
- **FR-4.1** Built-in providers gain a model-management surface (today they only expose commit-attribution settings). It reuses the same list component as custom providers.
- **FR-4.2** For **built-in** provider models, users may: reorder, enable/disable, and edit display name + tier. Users may **not** add rows, remove rows, or change a row's underlying `model_id` (the canonical id is protected).
- **FR-4.3** For **custom** provider models, users gain reorder + enable/disable in addition to today's add/remove/edit.
- **FR-4.4** The reorder UX is up/down arrow buttons on each row (congruent with the compact existing rows; no new dependencies). *(Decision point — see §8.)*

### FR-5 Backwards compatibility & continuity
- **FR-5.1** On upgrade, existing databases preserve their current model ordering (backfilled from current `created_at` order) and all models default to enabled.
- **FR-5.2** The legacy `gpt-5.5` retired model is migrated to a disabled built-in row (if/where present) and added to the OpenAI catalog as disabled-by-default, so it is re-enableable.
- **FR-5.3** No session is forced to change model as a side effect of this work.

## 6. Non-Functional Requirements
- **NFR-1 Performance** — picker rendering and provider fetch remain O(models); reorder is a single bulk update.
- **NFR-2 Idempotent migrations** — all schema/seed migrations are safe to re-run every startup (they already are; new ones must preserve this).
- **NFR-3 No new runtime dependencies** for the recommended up/down reorder UX.
- **NFR-4 Consistency** — one shared component drives model management for built-in and custom providers.

## 7. Data Model (target)

`provider_models` gains two columns:

| column | type | default | notes |
|---|---|---|---|
| `enabled` | INTEGER | `1` | `0` = disabled (hidden from new selection, still valid/resolvable). |
| `sort_order` | INTEGER | `NULL` | Nullable sentinel. `NULL` = "never explicitly ordered"; ordering falls back to `created_at`. Explicit reordering assigns `0,1,2,…`. Nullable keeps the one-time backfill idempotent across startup re-runs. |

Ordering query: `ORDER BY (sort_order IS NULL), sort_order ASC, created_at ASC`.

API model object gains: `enabled: boolean`, `sortOrder: number | null`.

## 8. Key Decisions (recommended defaults; flagged for confirmation)
- **D1 Scope (recommended: both)** — reorder + enable/disable apply to **built-in and custom** provider models (shared table/components → DRY + congruent). *Alternative: built-in only.*
- **D2 Built-in mutability (recommended: reorder + toggle + label/tier, no add/remove)** — protects the canonical "all supported models" set and avoids seed/backfill conflicts where removed rows would reappear via `INSERT OR IGNORE`. *Alternatives: toggle-only; or full CRUD.*
- **D3 Reorder UX (recommended: up/down arrows)** — congruent with existing compact rows, no new deps. *Alternative: drag-and-drop.*

## 9. Canonical Seed Lists (initial; configurable afterward)

> Exact ids must be confirmed against the live provider at implementation. The mechanism makes any list configurable; these are the starting defaults.

**Anthropic — Claude Code** (tier in parens):
- `claude-fable-5` — Fable 5 (fable)
- `claude-opus-4-8` — Opus 4.8 **(default)** (opus)
- `claude-opus-4-7` — Opus 4.7 (opus)
- `claude-opus-4-6` — Opus 4.6 (opus)
- `claude-sonnet-5` — Sonnet 5 (sonnet)
- `claude-haiku-4-5-20251001` — Haiku 4.5 (haiku)

SDK tier aliases `opus` / `sonnet` / `haiku` / `fable` continue to be handled separately (not picker rows).

**OpenAI — Codex**:
- `gpt-5.6-sol` — GPT-5.6 Sol **(default)**
- `gpt-5.6-terra` — GPT-5.6 Terra
- `gpt-5.6-luna` — GPT-5.6 Luna
- `gpt-5.4` — GPT-5.4
- `gpt-5.4-mini` — GPT-5.4 mini
- `gpt-5.3-codex` — GPT-5.3-Codex
- `gpt-5.5` — GPT-5.5 (legacy, **disabled by default** — replaces the retired mechanism)

**Google — Gemini** (inherits the capability; unchanged list):
- `gemini-2.5-pro`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`

## 10. Acceptance Criteria
- **AC1** Every `ModelSelector` surface lists the full built-in Claude Code and Codex catalogs.
- **AC2** A user can disable a built-in model; it then disappears from new-session/default/scheduled pickers.
- **AC3** A user can reorder built-in and custom models; all pickers reflect the new order.
- **AC4** A session whose model is disabled still shows that model selected and selectable, with no "unknown model" badge, and runs without error.
- **AC5** Disabling/reordering a model does not change any other session's model.
- **AC6** The built-in management UI is the same component family as the custom model management UI.
- **AC7** `gpt-5.5` is a disabled, re-enableable built-in choice; `RETIRED_BUILT_IN_OPENAI_MODEL_IDS` is no longer the source of truth.
- **AC8** Upgrade from current DB preserves existing order and leaves all models enabled (except the migrated legacy row).
- **AC9** Unit, contract, and E2E tests (via `./scripts/pw.sh`) pass for the above.

## 11. Open Questions
- Exact, current canonical id list per provider (confirm at implementation).
- Whether to also expose a per-model description edit in the built-in UI (currently description is display-only).
- Whether drag-and-drop is desired later (deferred per D3).
