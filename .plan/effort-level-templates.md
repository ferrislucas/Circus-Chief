# Plan: Add Effort Level to Template System

## Step 0 — Merge Latest `origin/main`

Before starting any work, merge the latest `origin/main` into the working branch to avoid conflicts and ensure we're building on top of the most recent code.

```bash
git fetch origin
git merge origin/main
```

Resolve any merge conflicts before proceeding.

---

## Step 1 — Database Schema & Migration

### 1a. Update `schema.sql`

Add `effort_level` column to the `session_templates` table:

```sql
effort_level TEXT CHECK(effort_level IN ('low', 'medium', 'high', 'max', 'auto'))
```

**File:** `packages/server/src/schema.sql`

### 1b. Add Migration

Create a new migration entry in the template migrations file to add the column to existing databases:

```js
{
  name: 'session_templates-add-effort_level',
  up(db) {
    addColumnIfMissing(
      db, 'session_templates', 'effort_level',
      "TEXT CHECK(effort_level IN ('low', 'medium', 'high', 'max', 'auto'))"
    );
  },
}
```

**File:** `packages/server/src/db/migrations/` (template migrations file)

---

## Step 2 — Repository Layer

Update `SessionTemplateRepository` to handle `effortLevel`:

- **`#mapTemplate(row)`** — Add `effortLevel: row.effort_level || null`
- **`create()`** — Accept and persist `effort_level`
- **`update()`** — Accept and persist `effort_level`

**File:** `packages/server/src/db/SessionTemplateRepository.js`

---

## Step 3 — Shared Contracts (Zod)

Add `effortLevel` to all three Zod schemas:

- **`CreateSessionTemplateRequest`** — `effortLevel: z.enum(['low', 'medium', 'high', 'max', 'auto']).nullable().optional()`
- **`UpdateSessionTemplateRequest`** — same as above
- **`SessionTemplateResponse`** — `effortLevel: z.string().nullable()`

**File:** `packages/shared/src/contracts/templates.js`

---

## Step 4 — API: Template Override Logic

Update `applyTemplateOverrides()` in the session creation route to apply `effortLevel` from the template when present:

```js
if (template.effortLevel) {
  config.effortLevel = template.effortLevel === 'auto' ? null : template.effortLevel;
}
```

**File:** `packages/server/src/api/projects.js`

---

## Step 5 — Frontend: Template Detail View (Edit/Create Form)

Add an effort level selector to the template edit form (`TemplateDetailView.vue`):

- Import and use the existing `EffortLevelSelector` component
- Bind it to the template's `effortLevel` field
- Normalize `'auto'` to `null` before saving (consistent with session behavior)

**File:** `packages/web/src/views/TemplateDetailView.vue`

---

## Step 6 — Frontend: New Session View (Template Pre-fill)

Update `handleStartFromTemplateChange()` to apply the template's `effortLevel` to the session form when a template is selected:

```js
if (template.effortLevel !== null && template.effortLevel !== undefined) {
  effortLevel.value = template.effortLevel;
}
```

**File:** `packages/web/src/views/NewSessionView.vue`

---

## Step 7 — Unit Tests

Add/update tests for:

- **Repository test** — Verify `effortLevel` is persisted and retrieved correctly via `create()`, `update()`, and `getById()`
- **Contract test** — Verify Zod schemas accept valid effort levels and reject invalid ones

**Files:**
- `packages/server/src/db/SessionTemplateRepository.test.js`
- `packages/shared/src/contracts/templates.test.js` (if exists)

---

## Step 8 — Run Full Test Suite & Lint

```bash
yarn test
yarn lint
```

Fix any failures before considering the work complete.

---

## Summary of Files to Change

| # | File | Change |
|---|------|--------|
| 1 | `packages/server/src/schema.sql` | Add `effort_level` column to `session_templates` |
| 2 | `packages/server/src/db/migrations/` | New migration for `effort_level` |
| 3 | `packages/server/src/db/SessionTemplateRepository.js` | Map, create, update `effortLevel` |
| 4 | `packages/shared/src/contracts/templates.js` | Add `effortLevel` to Zod schemas |
| 5 | `packages/server/src/api/projects.js` | Apply `effortLevel` in `applyTemplateOverrides()` |
| 6 | `packages/web/src/views/TemplateDetailView.vue` | Add effort level selector to form |
| 7 | `packages/web/src/views/NewSessionView.vue` | Pre-fill `effortLevel` from template |
| 8 | Test files | Unit tests for new behavior |
