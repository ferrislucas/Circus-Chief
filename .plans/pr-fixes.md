# PR Fix Plan: Provider Refactor Issues

## 1. Remove `CLAUDETOOLS_ENCRYPTION_KEY` env var — auto-generate only
**File:** `packages/server/src/services/encryption.js`

- Remove the `process.env.CLAUDETOOLS_ENCRYPTION_KEY` branch (lines 18–26)
- `getEncryptionKey()` should only use the `~/.claudetools/secret.key` auto-generation path
- Remove the JSDoc comment referencing the env var (line 14)

## 2. Support updating existing models (not just add/remove)
**Files:**
- `packages/server/src/db/ProviderRepository.js` — add `updateModel(modelId, data)` method
- `packages/server/src/api/providers.js` — add `PATCH /:id/models/:modelId` route
- `packages/web/src/components/ProviderForm.vue` — update `reconcileModels()` to call update for existing models whose fields changed

**Approach:**
- Add `updateModel(id, data)` to `ProviderRepository` that updates `model_id`, `display_name`, `description`, and `tier` for a given model row ID
- Add a `PATCH /api/providers/:id/models/:modelId` API route
- In `reconcileModels()`, track which existing models have been modified by comparing against original values (`props.provider.models`). For each changed model with a `_serverId`, call the update API.

## 3. Delete the old `ModelProviderRepository.js` file
**File:** `packages/server/src/db/ModelProviderRepository.js`

- Delete the file entirely — it's dead code
- The backward-compat alias in `db/index.js` already re-exports `ProviderRepository as ModelProviderRepository`

## 4. Harden `decrypt()` heuristic for legacy plaintext detection
**File:** `packages/server/src/services/encryption.js`

- After the `parts.length !== 3` check, add hex format/length validation:
  - `parts[0]` should be exactly 24 hex chars (12-byte IV)
  - `parts[1]` should be exactly 32 hex chars (16-byte auth tag)
- If either fails, return the value as plaintext (legacy)

## 5. Validate encryption key file on read
**File:** `packages/server/src/services/encryption.js`

- After reading `~/.claudetools/secret.key`, validate it's a 64-char hex string
- If invalid, log a warning and regenerate the key (or throw a clear error)

## 6. Add `_resetKeyForTesting()` export
**File:** `packages/server/src/services/encryption.js`

- Export a `_resetKeyForTesting()` function that sets `_key = null`
- Only intended for test isolation

## 7. Remove the `.attachments` binary from the branch
- `git rm` the PNG file from `.attachments/` — it's a session artifact, not part of the feature

## 8. Update `ProviderResponse` Zod contract to include `models`
**File:** `packages/shared/src/contracts/providers.js`

- Add a `models` array field to `ProviderResponse` schema matching the shape returned by `ProviderRepository.getById()`:
  ```
  models: z.array(z.object({
    id: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    displayName: z.string(),
    description: z.string().nullable(),
    tier: z.enum(['opus', 'sonnet', 'haiku', 'custom']),
    createdAt: z.number(),
  }))
  ```

---

## Execution Order
1 → 3 → 7 (quick deletions, no dependencies)
4 → 5 → 6 → 1 (all in encryption.js, do together)
8 (contract update, standalone)
2 (model update support — largest change, do last)

Run `yarn workspace @claudetools/server test` after each group to verify.
