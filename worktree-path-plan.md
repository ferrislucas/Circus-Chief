# Plan: Configurable Git Worktree Path per Project

## Overview

Allow users to specify where git worktrees are stored for a given project. The path is configurable in both project creation and project settings. Auto-detection inspects existing worktrees to suggest a path; falls back to `{workingDirectory}/.worktrees`.

---

## 1. Database Migration

**File:** `packages/server/src/db/migrations/projectsMigrations.js`

Add a new migration to the `projectsMigrations` array:

```js
{
  name: 'projects-add-worktree_path',
  up(db) { addColumnIfMissing(db, 'projects', 'worktree_path', 'TEXT'); },
}
```

**File:** `packages/server/src/db/migrations/index.js`

Register the migration at the end of the `allMigrations` array:

```js
p.get('projects-add-worktree_path'),
```

**Result:** `projects` table gets a nullable `worktree_path TEXT` column. `NULL` means use the default (`{workingDirectory}/.worktrees`).

---

## 2. Shared Contracts (Zod Schemas)

**File:** `packages/shared/src/contracts/projects.js`

- **`CreateProjectRequest`** — Add `worktreePath: z.string().nullable().optional()`
- **`UpdateProjectRequest`** — Add `worktreePath: z.string().nullable().optional()`
- **`ProjectResponse`** — Add `worktreePath: z.string().nullable().optional()`

---

## 3. Project Repository

**File:** `packages/server/src/db/ProjectRepository.js`

Three changes:

### 3a. `#mapProject()` — Add `worktreePath` mapping (line ~12-28)
The static `#mapProject(row)` method explicitly enumerates every field. Add:
```js
worktreePath: row.worktree_path ?? null,
```

### 3b. `create()` — Accept `worktreePath` in options (line ~30-59)
The method signature is `create(name, workingDirectory, systemPrompt, options)`. Add `worktreePath` to the destructured `options` object (alongside `onSessionCreated`, `repoUrl`, etc.) and include it in the `INSERT INTO` SQL and `.run()` values.

### 3c. `update()` — Add to `#FIELD_MAP` (line ~78-87)
Add entry:
```js
worktreePath: { column: 'worktree_path' },
```

---

## 4. Git Service — Auto-Detection

**File:** `packages/server/src/services/gitService.js`

Add and export a new function:

```js
export async function detectWorktreePath(directory) {
  const isRepo = await isGitRepo(directory);
  if (!isRepo) {
    return { worktreePath: path.join(directory, '.worktrees'), source: 'default' };
  }

  const worktrees = await getWorktrees(directory);
  // Filter out the main worktree (its path === directory or resolves to it)
  const externalWorktrees = worktrees.filter(wt => {
    return path.resolve(wt.path) !== path.resolve(directory);
  });

  if (externalWorktrees.length > 0) {
    // Use the parent directory of the first external worktree
    const parentDir = path.dirname(externalWorktrees[0].path);
    return { worktreePath: parentDir, source: 'detected' };
  }

  return { worktreePath: path.join(directory, '.worktrees'), source: 'default' };
}
```

Note: Use `path.resolve()` for the main-worktree comparison since `git worktree list --porcelain` can return resolved/canonical paths that may differ from the input directory string (e.g., symlinks).

---

## 5. Detect Endpoint (Git API)

**File:** `packages/server/src/api/git.js`

The git router is mounted at `/api/git` (see `api/index.js` line 26). Add a **non-project-scoped** route so it works during project creation (when no project ID exists yet):

```js
// GET /api/git/detect-worktree-path?directory=/path/to/repo
router.get('/detect-worktree-path', async (req, res) => {
  const { directory } = req.query;
  if (!directory) {
    return res.status(400).json({ error: 'directory query parameter is required' });
  }

  try {
    const result = await gitService.detectWorktreePath(directory);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

This route does NOT require a project ID, making it usable from both the project creation and project edit forms.

Full URL: `GET /api/git/detect-worktree-path?directory=...`

---

## 6. Worktree Path Validation

Validation is performed **inline** in the project create/update API handlers — no separate validation endpoint. This keeps it simple and ensures every save is validated.

**File:** `packages/server/src/api/projects.js`

Add a validation helper at the top of the file:

```js
import { access, constants } from 'fs/promises';
import { dirname, isAbsolute } from 'path';

async function validateWorktreePath(worktreePath) {
  if (!worktreePath) return null; // null is valid (means use default)

  if (!isAbsolute(worktreePath)) {
    return 'Worktree path must be an absolute path';
  }

  const parent = dirname(worktreePath);
  try {
    await access(parent, constants.W_OK);
  } catch {
    return `Parent directory does not exist or is not writable: ${parent}`;
  }

  return null; // valid
}
```

### POST `/api/projects` (Create) — lines 34-46
Currently destructures: `const { name, workingDirectory, systemPrompt, onSessionCreated, onSessionDeleted } = result.data;`

Update to also destructure `worktreePath`, validate it, and pass it to `projects.create()`:

```js
const { name, workingDirectory, systemPrompt, onSessionCreated, onSessionDeleted, worktreePath } = result.data;

const pathError = await validateWorktreePath(worktreePath);
if (pathError) {
  return res.status(400).json({ error: pathError });
}

const project = projects.create(name, workingDirectory, systemPrompt || null, {
  onSessionCreated: onSessionCreated || null,
  onSessionDeleted: onSessionDeleted || null,
  worktreePath: worktreePath || null,
});
```

Note: The route handler must become `async` since `validateWorktreePath` is async.

### PUT `/api/projects/:id` (Update) — lines 58-71
Add validation before calling `projects.update()`:

```js
if (result.data.worktreePath !== undefined) {
  const pathError = await validateWorktreePath(result.data.worktreePath);
  if (pathError) {
    return res.status(400).json({ error: pathError });
  }
}

const updated = projects.update(req.params.id, result.data);
```

Note: The route handler must become `async`.

---

## 7. Session Creation — Use Project's Worktree Path

Two files need changes:

### 7a. `packages/server/src/services/gitSessionSetup.js`

Update the function signature to accept `worktreeBasePath`:

```js
export async function setupGitForSession({ projectDir, gitMode, gitBranch, sessionId, worktreeBasePath }) {
```

In the worktree mode block (line 31-41), change:
```js
// Before:
const worktreePath = join(projectDir, '.worktrees', sessionId);

// After:
const worktreePath = join(worktreeBasePath || join(projectDir, '.worktrees'), sessionId);
```

### 7b. `packages/server/src/api/projects-session-helpers.js`

In `setupAndStartSession()` (line 233+), update the call to `setupGitForSession` to pass the project's worktree path. The `project` object is already available as a parameter:

```js
// Before (line 244-249):
const gitSetup = await setupGitForSession({
  projectDir: project.workingDirectory,
  gitMode: config.gitMode || null,
  gitBranch: config.gitBranch || null,
  sessionId: session.id,
});

// After:
const gitSetup = await setupGitForSession({
  projectDir: project.workingDirectory,
  gitMode: config.gitMode || null,
  gitBranch: config.gitBranch || null,
  sessionId: session.id,
  worktreeBasePath: project.worktreePath || null,
});
```

---

## 8. Frontend API Client

**File:** `packages/web/src/api/resources/MiscApi.js`

This is where git-related API methods already live (`getGitStatus`, `getWorktrees`). Add the detect method in the Git section:

```js
/**
 * Detect the worktree path for a directory
 * @param {string} directory - Working directory path
 * @returns {Promise<{worktreePath: string, source: 'detected' | 'default'}>}
 */
async detectWorktreePath(directory) {
  return this._get(this._buildQueryPath('/git/detect-worktree-path', { directory }));
},
```

---

## 9. Frontend — Project Creation Form

**File:** `packages/web/src/views/ProjectNewView.vue`

### Template Changes
Add a **"Worktree Path"** field inside the `<details class="advanced-settings">` section, before the system prompt:

```html
<div class="form-group">
  <label class="form-label" for="worktreePath">Worktree Path</label>
  <div class="input-with-button">
    <input
      id="worktreePath"
      v-model="worktreePath"
      type="text"
      class="form-input"
      placeholder="/path/to/.worktrees"
    >
    <button
      type="button"
      class="btn btn-secondary btn-sm"
      :disabled="!workingDirectory || detectingWorktreePath"
      @click="detectWorktreePath"
    >
      Detect
    </button>
  </div>
  <p class="form-help">
    Directory where git worktrees will be created for sessions. Leave empty to use the default.
  </p>
</div>
```

### Script Changes
- Import `api` from the API client
- Add refs: `const worktreePath = ref('')` and `const detectingWorktreePath = ref(false)`
- Add a `detectWorktreePath()` async function that calls `api.detectWorktreePath(workingDirectory.value)` and sets `worktreePath.value`
- Update the `watch(workingDirectory, ...)` watcher to also auto-detect the worktree path when the working directory changes
- Update `handleSubmit()` to include `worktreePath: worktreePath.value || null` in the create payload

### Style Changes
Add CSS for the `.input-with-button` container (flex row with gap).

---

## 10. Frontend — Project Settings Form

**File:** `packages/web/src/views/ProjectEditView.vue`

### Template Changes
Add a **"Worktree Path"** field after the Working Directory field (line ~38), before the Repository URL field:

```html
<div class="form-group">
  <label class="form-label" for="worktreePath">Worktree Path</label>
  <div class="input-with-button">
    <input
      id="worktreePath"
      v-model="worktreePath"
      type="text"
      class="form-input"
      :placeholder="workingDirectory + '/.worktrees'"
    >
    <button
      type="button"
      class="btn btn-secondary btn-sm"
      :disabled="!workingDirectory || detectingWorktreePath"
      @click="detectWorktreePath"
    >
      Detect
    </button>
  </div>
  <p class="form-help">
    Where git worktrees are created for sessions. Changing this only affects new sessions.
  </p>
</div>
```

### Script Changes
- Import `api` from the API client
- Add refs: `const worktreePath = ref('')` and `const detectingWorktreePath = ref(false)`
- Add `detectWorktreePath()` async function (same as in ProjectNewView)
- Update the `watch(() => projectsStore.currentProject, ...)` watcher (line ~406) to populate: `worktreePath.value = project.worktreePath || ''`
- Update `handleSubmit()` (line ~442) to include `worktreePath: worktreePath.value || null` in the update payload

### Style Changes
Add CSS for `.input-with-button` (same as ProjectNewView).

---

## File Change Summary

| File | Change |
|------|--------|
| `packages/server/src/db/migrations/projectsMigrations.js` | Add `projects-add-worktree_path` migration |
| `packages/server/src/db/migrations/index.js` | Register migration at end of `allMigrations` |
| `packages/server/src/db/ProjectRepository.js` | Add `worktreePath` to `#mapProject`, `create()` options, and `#FIELD_MAP` |
| `packages/shared/src/contracts/projects.js` | Add `worktreePath` to `CreateProjectRequest`, `UpdateProjectRequest`, `ProjectResponse` |
| `packages/server/src/api/projects.js` | Destructure `worktreePath`, validate with `validateWorktreePath()`, pass to create/update. Make POST/PUT handlers async. |
| `packages/server/src/api/git.js` | Add `GET /detect-worktree-path?directory=...` route |
| `packages/server/src/services/gitService.js` | Add and export `detectWorktreePath()` function |
| `packages/server/src/services/gitSessionSetup.js` | Accept `worktreeBasePath` param, use it instead of hardcoded `.worktrees` |
| `packages/server/src/api/projects-session-helpers.js` | Pass `project.worktreePath` through to `setupGitForSession()` as `worktreeBasePath` |
| `packages/web/src/api/resources/MiscApi.js` | Add `detectWorktreePath()` method |
| `packages/web/src/views/ProjectNewView.vue` | Add worktree path field with auto-detect on directory change |
| `packages/web/src/views/ProjectEditView.vue` | Add worktree path field with detect button |

---

## Tests

### `packages/server/src/db/ProjectRepository.test.js`
Add to `describe('create')`:
- `it('creates project with worktreePath in options')` — verify it's stored and returned
- `it('creates project with null worktreePath by default')` — verify default behavior

Add to `describe('update')`:
- `it('updates worktreePath')` — set a worktree path and verify
- `it('clears worktreePath when set to null')` — set then clear

### `packages/server/src/services/gitService.test.js`
Add `describe('detectWorktreePath')`:
- `it('returns default path when directory is not a git repo')` — mock `isGitRepo` → false
- `it('returns default path when no external worktrees exist')` — mock `getWorktrees` → [main only]
- `it('detects parent directory of existing external worktrees')` — mock `getWorktrees` → [main, external1, external2]
- `it('uses path.resolve for comparison to handle symlinks')` — test edge case

### `packages/server/src/services/gitSessionSetup.test.js`
Update existing worktree mode tests:
- `it('uses worktreeBasePath when provided')` — pass `worktreeBasePath: '/custom/path'`, verify `createWorktreeForBranch` called with `/custom/path/session-1`
- `it('falls back to projectDir/.worktrees when worktreeBasePath is null')` — pass `worktreeBasePath: null`, verify current default behavior
- Update existing test assertions that hardcode `/project/.worktrees/session-1` to account for the new parameter

### `packages/server/src/api/projects.test.js`
- `it('creates project with worktreePath')` — POST with `worktreePath`, verify response
- `it('rejects non-absolute worktreePath on create')` — POST with relative path, expect 400
- `it('updates worktreePath')` — PUT with new path, verify
- `it('rejects invalid worktreePath on update')` — PUT with path whose parent doesn't exist, expect 400

### `packages/web/src/api/resources/MiscApi.test.js`
- `it('calls detect-worktree-path with directory param')` — verify correct URL construction

### E2E Tests

#### Test helper update: `tests/e2e/helpers.ts`

Update `seedProject()` to support `worktreePath` in its options:

```typescript
export async function seedProject(
  name: string,
  workingDirectory: string,
  options?: {
    onSessionCreated?: string;
    onSessionDeleted?: string;
    worktreePath?: string;       // ← Add this
  }
) {
  // ...existing code...
  if (options?.worktreePath) {
    body.worktreePath = options.worktreePath;
  }
  // ...
}
```

#### `tests/e2e/projects.spec.ts` — New tests

Add a new `test.describe('Worktree Path')` block:

**Project Creation:**

- `test('can create a project with worktree path via advanced settings')`:
  1. Navigate to `/projects/new`
  2. Fill working directory via `.path-chooser input`
  3. Expand advanced settings: `page.click('details.advanced-settings summary')`
  4. Fill worktree path: `page.fill('input[id="worktreePath"]', '/tmp/custom-worktrees')`
  5. Click "Add Repository"
  6. Verify redirect to `/projects/{id}/sessions`
  7. Extract project ID from URL, call `getProject(projectId)`, assert `project.worktreePath === '/tmp/custom-worktrees'`

- `test('can create a project without worktree path (uses default)')`:
  1. Navigate to `/projects/new`
  2. Fill working directory, do NOT fill worktree path
  3. Click "Add Repository"
  4. Verify redirect, extract project ID, call `getProject(projectId)`, assert `project.worktreePath` is null

**Project Edit:**

- `test('can edit worktree path in project settings')`:
  1. `seedProject('Test', '/tmp')`
  2. Navigate to `/projects/{id}/edit`
  3. Fill worktree path: `page.fill('input[id="worktreePath"]', '/tmp/new-worktrees')`
  4. Click Save
  5. Verify redirect to sessions page
  6. Call `getProject(id)`, assert `project.worktreePath === '/tmp/new-worktrees'`

- `test('can clear worktree path in project settings')`:
  1. `seedProject('Test', '/tmp', { worktreePath: '/tmp/existing-worktrees' })`
  2. Navigate to `/projects/{id}/edit`
  3. Verify input has value `/tmp/existing-worktrees`
  4. Clear the input: `page.fill('input[id="worktreePath"]', '')`
  5. Click Save
  6. Verify redirect, call `getProject(id)`, assert `project.worktreePath` is null

- `test('worktree path field shows placeholder based on working directory')`:
  1. `seedProject('Test', '/tmp/my-project')`
  2. Navigate to `/projects/{id}/edit`
  3. Assert `page.locator('input[id="worktreePath"]')` has placeholder `/tmp/my-project/.worktrees`

**Detect Button:**

- `test('detect button populates worktree path on project edit')`:
  1. `seedProject('Test', '/tmp')` (a non-git directory, so detect returns default)
  2. Navigate to `/projects/{id}/edit`
  3. Click the Detect button next to worktree path
  4. Wait for the input value to be populated
  5. Assert `page.locator('input[id="worktreePath"]')` has value `/tmp/.worktrees`

**Validation:**

- `test('rejects relative worktree path on project create')`:
  1. Navigate to `/projects/new`
  2. Fill working directory
  3. Expand advanced settings
  4. Fill worktree path with a relative path: `page.fill('input[id="worktreePath"]', 'relative/path')`
  5. Click "Add Repository"
  6. Assert error message is visible: `page.locator('.error-message')` contains "absolute path"

---

## Implementation Order

1. **Database migration** — Add column
2. **Shared contracts** — Update Zod schemas
3. **Repository** — Handle new field in CRUD (+ unit tests)
4. **Git service** — Add `detectWorktreePath()` (+ unit tests)
5. **API routes** — Add detect endpoint, update create/update with validation (+ unit tests)
6. **Session setup** — Use project's worktree path via `projects-session-helpers.js` (+ unit tests)
7. **Frontend API client** — Add detect method in `MiscApi.js` (+ unit test)
8. **Project creation UI** — Add field with auto-detect
9. **Project settings UI** — Add field with detect button
10. **E2E test helper** — Update `seedProject()` to support `worktreePath`
11. **E2E tests** — Add worktree path tests to `projects.spec.ts`
