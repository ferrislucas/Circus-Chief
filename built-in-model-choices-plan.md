# Plan — Configurable Built-in Model Choices

**Companion FRD:** `FRD-built-in-model-choices.md`
**Workspace:** `2e1504f7-4f6a-4668-a603-c982d0b03869`
**Branch:** `circus-chief/f5bd-need-change-how-system`

> Implements the FRD. Decisions D1–D3 are taken at recommended defaults (documented in FRD §8); they can be revisited before implementation. **No code changes have been made yet — this is a plan only.**

---

## 0. Design summary

Generalize the existing "retired built-in OpenAI model" idea into first-class **per-model `enabled` + `sort_order`** on every `provider_models` row, surface congruent reorder/enable-disable management for built-in *and* custom providers via the existing `ProviderModelsList` family, and expand the built-in catalogs. Server-side model validation already accepts any id present in the table, so **disabled models stay valid/resolvable** for existing sessions automatically; the picker only needs to (a) hide disabled models for new selection and (b) force-show the session's currently-selected model even when disabled.

**Key correctness insight — idempotent ordering backfill:** migrations re-run every startup, so `sort_order` uses a **NULL sentinel** ("never explicitly ordered") and the one-time backfill only writes rows where `sort_order IS NULL`. This prevents startup re-runs from clobbering user reorders. `enabled` is a plain `INTEGER NOT NULL DEFAULT 1`.

---

## Phase 1 — Shared catalog & constants

**Files:**
- `packages/shared/src/types.js`

**Changes:**
1. Expand `CLAUDE_MODELS` and `OPENAI_MODELS` to the full supported sets (FRD §9). Keep existing fields (`id`, `name`, `description`, OpenAI `seedId`).
2. Add an optional `defaultEnabled` (default true) to entries that should seed disabled (e.g. OpenAI `gpt-5.5` → `defaultEnabled: false`).
3. Add optional `tier` to `CLAUDE_MODELS` entries (so Anthropic seeding can derive from the constant like OpenAI does).
4. Leave `RETIRED_BUILT_IN_OPENAI_MODEL_IDS` / `isRetiredBuiltInOpenAIModelSelection` in place for now (removed in Phase 6 after the picker stops using it).

**Why first:** everything else (seeding, picker, FR-1) depends on the canonical lists.

---

## Phase 2 — Schema migration (idempotent)

**Files:**
- `packages/server/src/db/migrations/providerMigrations.js`
- `packages/server/src/db/migrations/providerMigrationHelpers.js`
- `packages/server/src/db/migrations/migrationUtils.js` (reuse `addColumnIfMissing`)
- `packages/server/schema.sql` (keep fresh-DB DDL in parity)

**Changes — append migrations (each idempotent):**
1. `provider-models-add-enabled` → `addColumnIfMissing(db, 'provider_models', 'enabled', 'INTEGER NOT NULL DEFAULT 1')`.
2. `provider-models-add-sort-order` → `addColumnIfMissing(db, 'provider_models', 'sort_order', 'INTEGER')` (nullable).
3. `provider-models-backfill-sort-order` → one-time, NULL-guarded:
   ```sql
   UPDATE provider_models
   SET sort_order = (
     SELECT COUNT(*) FROM provider_models pm2
     WHERE pm2.provider_id = provider_models.provider_id
       AND (pm2.created_at < provider_models.created_at
            OR (pm2.created_at = provider_models.created_at AND pm2.id < provider_models.id))
   )
   WHERE sort_order IS NULL;
   ```
   Preserves today's `created_at` order; idempotent because it only touches `NULL` rows.
4. `providers-migrate-retired-gpt-5-5` → where a `gpt-5.5` built-in OpenAI row exists, set `enabled = 0`; ensure it's present as a disabled catalog row (via the OpenAI seed helper, which now reads `defaultEnabled`). Idempotent.
5. Update the two seed helpers (`seedBuiltInOpenAIProvider`, Anthropic seed in `seedBaselineData.js`, and `seedBuiltInGoogleProvider` if needed) so each inserted row sets `enabled = (defaultEnabled ? 1 : 0)` and `sort_order = (SELECT COALESCE(MAX(sort_order),-1)+1 FROM provider_models WHERE provider_id = ?)`. New models thus land at the end and don't collide with explicit user orders. `INSERT OR IGNORE` keeps existing rows (and their user state) untouched.
6. Refactor Anthropic seeding to derive from `CLAUDE_MODELS` (single source of truth — FR-1.2). Keep stable row ids (`anthropic-<slug>`) so `INSERT OR IGNORE` remains a correct upsert key.
7. Update `schema.sql` fresh-DB DDL for `provider_models` to include `enabled` and `sort_order`, and keep `seedBaselineData.js` in parity with the migration seed.

**Definition of done:** a DB from the current version, after startup, has the new columns, existing order preserved, and `gpt-5.5` disabled; a fresh DB seeds the expanded catalogs with correct `enabled`/`sort_order`.

---

## Phase 3 — Repository layer

**File:** `packages/server/src/db/ProviderRepository.js`

**Changes:**
1. `#mapProviderModel`: add `enabled: row.enabled === 1`, `sortOrder: row.sort_order ?? null`.
2. `getModels`: `ORDER BY (sort_order IS NULL), sort_order ASC, created_at ASC`.
3. `addModel(providerId, data)`: insert `enabled` (default 1) and `sort_order` (default next index via the MAX+1 query). Return mapped row.
4. `updateModel(id, data)`: accept `enabled` and `sortOrder` in addition to current fields.
5. New `reorderModels(providerId, orderedRowIds)`: in a transaction, set `sort_order = idx` for each id (only ids belonging to `providerId`). Compacts gaps; ignores unknown ids.
6. **Built-in guards (D2):**
   - `addModel`: throw `Cannot add models to a built-in provider` when `provider.isBuiltIn`.
   - `removeModel`: throw `Cannot remove built-in provider models; disable them instead` when the owning provider `isBuiltIn`.
   - `updateModel`: allow reorder/enable/displayName/tier on built-in, but throw if attempting to change `modelId` on a built-in row (`Cannot change the model id of a built-in provider model`).
   - Provider-level `update()` restriction (`BUILT_IN_MUTABLE_FIELDS`) is **unchanged** — model edits go through the model endpoints, not provider update.
7. `getAllModelIds()`: unchanged (still reads all distinct `model_id` regardless of `enabled`) — this is what keeps disabled models valid for existing sessions (FR-2.3).

---

## Phase 4 — API + contracts

**Files:**
- `packages/shared/src/contracts/providers.js`
- `packages/server/src/api/providers.js`

**Changes:**
1. `CreateProviderModelRequest`: add `enabled: z.boolean().optional()`, `sortOrder: z.number().int().nullable().optional()` (so `.partial()` covers updates too).
2. `ProviderModelResponse`: add `enabled: z.boolean()`, `sortOrder: z.number().nullable()`.
3. `PATCH /api/providers/:id/models/:modelId` — already passes through `CreateProviderModelRequest.partial()`; now accepts `{ enabled, sortOrder, displayName, tier }`. Map 403 for the new built-in guards (`Cannot change the model id…`, etc.).
4. New `PUT /api/providers/:id/models/order` body `{ order: string[] }` (ordered model row ids) → `modelProviders.reorderModels(id, order)`. Validate: provider exists; every id belongs to it; 400/404 as appropriate.
5. `POST /api/providers/:id/models` (add) and `DELETE …/models/:modelId` (remove): surface 403 for built-in providers per the guards.

---

## Phase 5 — Frontend store

**File:** `packages/web/src/stores/providers.js`

**Changes:**
1. `updateModel(providerId, modelRowId, patch)`: ensure it sends `enabled`/`sortOrder` (likely already generic — verify the payload whitelist).
2. New action `reorderModels(providerId, orderedRowIds)` → `PUT /api/providers/:id/models/order`; on success, re-fetch providers (or optimistically reorder `state.providers[i].models`).
3. `fetchProviders`: no change needed beyond ensuring mapped models carry `enabled`/`sortOrder` (they will, from the contract).

---

## Phase 6 — Picker behavior (ModelSelector)

**File:** `packages/web/src/components/ModelSelector.vue`

**Changes:**
1. Replace `withRetiredModelsHidden` with `withDisabledModelsHidden(provider, keepModelIds)` — hide models where `enabled === false`, **except** keep a model whose `modelId` is in `keepModelIds`.
2. Compute `keepModelIds` from the session's current selection: `new Set([resolveModelId(props.modelValue)].filter(Boolean))`. This force-shows the session's disabled model as a selectable option (US5/FR-2.4) so the "unknown model" badge does **not** fire for a merely-disabled model.
3. Apply `withDisabledModelsHidden` in `visibleProviders` (same place retired filtering happens today).
4. `defaultModel` computed: skip disabled models when choosing the fallback (prefer an enabled sonnet, else first enabled).
5. Ordering is automatic — the store serves models in `sort_order`, and the `<optgroup>`/`<option>` loops already render in array order.
6. After this lands and tests are green, remove the `RETIRED_BUILT_IN_OPENAI_MODEL_IDS` / `isRetiredBuiltInOpenAIModelSelection` usage here (Phase 1 left them in shared; delete in the cleanup phase). The "unknown model" badge remains for **truly missing** ids only.

**Edge case to verify:** when a disabled model is also offered by a *custom* provider (enabled), the duplicate-hiding path should keep the enabled custom copy and select it; `keepModelIds` only matters when no enabled copy exists anywhere.

---

## Phase 7 — Provider management UI (congruent)

**Files:**
- `packages/web/src/views/ProvidersView.vue`
- `packages/web/src/components/ProviderForm.vue`
- `packages/web/src/components/ProviderModelsList.vue` (extend) — or extract a shared `ProviderModelsManager.vue`

**Changes:**
1. `ProvidersView.vue`: built-in providers' "Settings" button opens the form in a new **built-in manage** mode (not the old `attributionOnly`). Show commit-attribution (editable, as today) + the model manager. Connection fields stay hidden for built-ins.
2. `ProviderForm.vue`: add a mode flag (e.g. `builtInManage`) that renders the `ProviderModelsManager` for built-in providers and for custom providers. For built-ins, the manager is configured `readOnlyModelId`, `noAddRemove`. Persist via `emit` events handled by the form (store calls).
3. `ProviderModelsList.vue` (extended) — per row add:
   - **enable/disable toggle** (emits `toggle-enabled` → `updateModel({ enabled })`),
   - **up/down arrows** (emit `move-up`/`move-down`; the parent computes the new order array and calls `reorderModels`),
   - mode-driven visibility: built-in hides add/remove and locks `modelId`; custom keeps add/remove and editable `modelId`.
   - Show a subtle "(disabled)" / dimmed style for disabled rows.
4. Reuse the existing compact grid layout and CSS variables (NFR-4 / congruence).

---

## Phase 8 — Cleanup & legacy retirement removal

**Files:**
- `packages/shared/src/types.js` — remove `RETIRED_BUILT_IN_OPENAI_MODEL_IDS` and `isRetiredBuiltInOpenAIModelSelection` once Phase 6 no longer imports them. Grep for any other consumers first.

---

## Phase 9 — Tests

**Unit (server) — `yarn workspace @circuschief/server test`**
- `ProviderRepository`: getModels ordering + NULL-last; `reorderModels` (transaction, unknown ids ignored, gaps compacted); `updateModel({enabled},{sortOrder})`; built-in add/remove/modelId-change guards throw; `addModel` assigns next `sort_order`; `getAllModelIds` still includes disabled ids.
- Migrations: backfill preserves prior order and is idempotent across simulated re-runs; `gpt-5.5` ends disabled.
- API: `PUT …/models/order`; `PATCH` model `enabled`/`sortOrder`; 403 on built-in add/remove.

**Contract (shared)** — `ProviderModelResponse` shape with `enabled` + `sortOrder`; reorder request schema.

**Unit (web)**
- `ModelSelector`: disabled model hidden for new selection; disabled **selected** model force-shown and selected (no badge); custom order respected; `defaultModel` skips disabled.

**E2E — `./scripts/pw.sh test`** (never port 5000 directly)
- Disable a built-in model → not offered on new session / project defaults.
- Reorder built-in models → reflected in the new-session picker.
- Create a session on a model, disable that model → session still shows it selected and runnable.

---

## Phase 10 — Rollout / verification
- Run full `yarn test` and `./scripts/pw.sh test`.
- Smoke-test upgrade path against an existing DB (order preserved, `gpt-5.5` disabled, no session forced to switch).
- Update `CLAUDE.md` only if the providers/models section changes meaningfully (likely not needed).

---

## Risks & mitigations
| Risk | Mitigation |
|---|---|
| Startup re-run clobbers user order | NULL-sentinel backfill only writes `NULL` rows; reorder writes explicit values (Phase 0/2). |
| Removing built-in rows reappears via seed | D2: built-ins are not removable (guard in repo + 403 in API). |
| Disabled model breaks existing sessions | `getAllModelIds()` ignores `enabled`; picker force-shows selected disabled model (Phase 3/6). |
| Order tiebreak churn | Tiebreak by `created_at`; reorder compacts to `0..n`. |
| Duplicate id across built-in + custom | Existing duplicate-hiding path retained; force-show only when no enabled copy exists. |

## Out of scope
Runtime model resolution/env, provider `kind` immutability, provider-level enable/disable, SDK tier aliases, drag-and-drop (deferred — D3).
