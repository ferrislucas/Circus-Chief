# PR #157: Address error handling and test coverage concerns

## Summary

During review of PR #157, the following concerns were identified that should be addressed:

---

## 1. Missing error handling for `git fetch origin` (Medium Priority)

**Location:** `packages/server/src/services/gitService.js` lines 132 and 216

```javascript
await git(directory, 'fetch origin');
```

If there is no network connection or no origin remote configured, this will throw and fail the entire worktree creation operation.

**Suggestion:** Wrap in try/catch to fail gracefully:

```javascript
try {
  await git(directory, 'fetch origin');
} catch {
  // No origin or network unavailable, proceed without fetch
}
```

---

## 2. Performance impact (Medium Priority)

Every worktree creation now:
- Makes a network call (`fetch origin`)
- Potentially runs `gh repo view` (external process)

This could add significant latency, especially for large repos or slow networks.

**Suggestion:** Consider:
- Caching the default branch result
- Making fetch optional or configurable via options parameter

---

## 3. Incomplete test coverage (Medium Priority)

The updated tests add a bare repo as origin (good), but don't verify:

- The new `getOriginDefaultBranch()` function directly
- Fallback behavior when `gh` CLI is unavailable
- Behavior when `origin/main` doesn't exist but `origin/master` does
- That new worktrees are actually based on origin's default branch (not just that they're created)

**Suggested test:**

```javascript
it('bases new branches on origin default branch, not HEAD', async () => {
  // Create a commit in main repo that's ahead of origin
  execSync('git checkout -b main', { cwd: testDir });
  await writeFile(join(testDir, 'local-only.txt'), 'content');
  execSync('git add . && git commit -m "Local commit"', { cwd: testDir });

  const worktreePath = join(testDir, '.worktrees', 'test');
  await createWorktreeForBranch(testDir, 'new-branch', worktreePath);

  // Verify the new branch doesn't have the local-only commit
  const hasFile = existsSync(join(worktreePath, 'local-only.txt'));
  expect(hasFile).toBe(false);
});
```

---

## Related

- PR #157
