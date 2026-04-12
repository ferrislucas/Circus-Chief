# Rebrand Plan: claudetools → Circus Chief

**Display name:** "Circus Chief" (two words, for titles, docs, UI, human-readable text)
**Code name:** `circuschief` (one word, for packages, imports, filenames, CLI)

## Scope

**328+ occurrences** across **151 files** need updating.

---

## Phase 1: Package Identity (Critical)

Update package names and workspace references — everything else depends on this.

| File | Change |
|------|--------|
| `package.json` (root) | `claudetools-monorepo` → `circuschief-monorepo`; update workspace script refs |
| `packages/server/package.json` | `@claudetools/server` → `@circuschief/server`; `"claudetools"` bin → `"circuschief"` |
| `packages/web/package.json` | `@claudetools/web` → `@circuschief/web`; dep `@claudetools/shared` → `@circuschief/shared` |
| `packages/shared/package.json` | `@claudetools/shared` → `@circuschief/shared` |

After renaming, run `yarn install` to re-link workspaces.

---

## Phase 2: All Source Imports (~166 occurrences)

Global find-and-replace across all `.js`, `.ts`, `.vue` files:

```
@claudetools/shared  →  @circuschief/shared
@claudetools/server  →  @circuschief/server
@claudetools/web     →  @circuschief/web
```

**Directories affected:**
- `packages/server/src/**` (services, api, db, ws)
- `packages/web/src/**` (stores, components, composables, views)
- `packages/server/test/**`
- `tests/e2e/**`
- Config files (`vitest.config.js`, etc.)

---

## Phase 3: Database Filename

| File | Change |
|------|--------|
| `packages/server/src/index.js` | `'claudetools.db'` → `'circuschief.db'` |
| `packages/server/src/db/DatabaseManager.js` | `'claudetools.db'` → `'circuschief.db'` |
| `tests/e2e/helpers.ts` | `'claudetools.db'` → `'circuschief.db'` |

Also update the `DB_PATH` default documented in README and CLAUDE.md.

---

## Phase 4: HTML Title & Frontend Branding

| File | Change |
|------|--------|
| `packages/web/index.html` | `<title>Vibehive</title>` → `<title>Circus Chief</title>` |

Check for any other UI-visible branding strings in Vue components — these should use "Circus Chief" (two words).

---

## Phase 5: Shell Scripts & CLI

| File | Change |
|------|--------|
| `scripts/start-server.sh` | Comment: "claudetools.io" → "Circus Chief" |
| `scripts/start-package-server.sh` | Package name → `circuschief`; db path → `circuschief.db`; bin → `circuschief` |
| `scripts/build-package.js` | 13 occurrences of "claudetools" → `circuschief` |

---

## Phase 6: Documentation

Use "Circus Chief" as the display name throughout all human-readable text.
Use `circuschief` only for code/command references (e.g., `npx circuschief`, `circuschief.db`).

| File | Change |
|------|--------|
| `README.md` | Title → "Circus Chief"; prose → "Circus Chief"; code examples → `circuschief` |
| `CLAUDE.md` | Project description → "Circus Chief"; code examples → `circuschief` |
| `PUBLISHING.md` | Display name → "Circus Chief"; package refs → `circuschief` |
| `docs/e2e-testing.md` | Domain/project reference → "Circus Chief" |
| `LICENSE` | Header metadata → "Circus Chief" |

---

## Phase 7: CI/CD & Config

| File | Change |
|------|--------|
| `.github/workflows/test.yml` | 6 workspace namespace references → `@circuschief/` |
| `tests/integration/vitest.config.js` | 2 namespace references → `@circuschief/` |
| `packages/server/vitest.config.js` | 2 namespace references → `@circuschief/` |

---

## Phase 8: Test Cassettes (Low Priority)

- `tests/e2e/cassettes/` — 24+ JSON files with "claudetools.io" domain refs
- These are recorded HTTP interactions; update selectively if tests break

---

## Phase 9: Quality Baseline & Misc

| File | Change |
|------|--------|
| `docs/quality-baseline-2026-04-09.json` | Domain reference |

---

## Naming Convention Summary

| Context | Use |
|---------|-----|
| Page titles, headings, UI labels | **Circus Chief** |
| Prose in docs ("...is a tool for...") | **Circus Chief** |
| Package names (`@scope/pkg`) | `@circuschief/` |
| CLI commands | `circuschief` |
| Database filename | `circuschief.db` |
| Monorepo name | `circuschief-monorepo` |
| Domain (if applicable) | `circuschief.io` |

---

## Execution Strategy

1. **Batch replacements** in order (most specific first to avoid partial matches):
   - `@claudetools/` → `@circuschief/` (all source files)
   - `claudetools-monorepo` → `circuschief-monorepo`
   - `claudetools.db` → `circuschief.db` (config/runtime)
   - `claudetools.io` → `circuschief.io` (docs/comments — review each for display name)
   - `Vibehive` → `Circus Chief` (HTML title — leftover from prior rebrand)
   - `claudetools` (remaining standalone, e.g. CLI bin name) → `circuschief`
2. **Manual pass** on docs/UI: replace prose references with "Circus Chief" (two words)
3. **Re-link workspaces** with `yarn install`
4. **Run `yarn test`** to verify nothing broke
5. **Run `yarn build`** to confirm compilation
6. **Run `yarn lint`** to catch any issues
7. **Spot-check UI** for any remaining visible branding
