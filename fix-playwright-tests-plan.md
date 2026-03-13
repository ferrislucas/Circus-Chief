# Fix Playwright Test Failures

## Test Results Summary
- **745 passed**, **1 failed**, **1 flaky**, 5 skipped
- Total run time: 5.3 minutes

---

## Failure 1: `DELETE /settings/summary resets to defaults` (FAILED)

**File:** `tests/e2e/settings.spec.ts:383`

**Error:**
```
expect(resetResult.disableConversationSummaries).toBe(false)
// Expected: false
// Received: true
```

**Root Cause:** The test expectation is wrong. The server default for `disableConversationSummaries` is `true` (conversation summaries are disabled by default). Evidence:

- `SettingsRepository.resetSummarySettings()` (line 160-167) returns `disableConversationSummaries: true`
- `SettingsRepository.getSummarySettings()` (line 114-136) defaults to `true` in all three return paths (no value, parsed value, parse error)
- The `GET /settings/summary returns default settings` test in the same file (line 320) correctly expects `true`

**Fix:** Update the test at lines 383 and 389:

```typescript
// Line 383 — change .toBe(false) to .toBe(true)
expect(resetResult.disableConversationSummaries).toBe(true);

// Line 389 — change .toBe(false) to .toBe(true)
expect(settings.disableConversationSummaries).toBe(true);
```

**Files to change:**
- `tests/e2e/settings.spec.ts` — lines 383 and 389

---

## Failure 2: `attachments are displayed in conversation view` (FLAKY)

**File:** `tests/e2e/file-attachments.spec.ts:255`

**Error:**
```
Locator: locator('.attachment-chip .attachment-name').filter({ hasText: 'display-test.txt' })
Expected: visible
Error: element(s) not found
```

**Root Cause:** The error context file (`test-results/.../error-context.md`) reveals the page snapshot was:
```
ENOENT: no such file or directory, stat '.../packages/web/dist/index.html'
```

The `page.reload()` at line 250 hit the Express server at a moment when `dist/index.html` was not accessible. The SPA shell never loaded, so no Vue components rendered and no attachment chips existed. The bare `page.waitForLoadState('networkidle')` does not verify the app actually rendered — it only waits for network activity to settle, which it does immediately when the server returns an error response.

**Fix:** Replace `page.waitForLoadState('networkidle')` with `waitForPageReady(page)` after the reload, and then wait for the `.message-content` element to confirm the conversation view actually rendered before asserting attachment visibility. Apply this to **both** the `attachments are displayed in conversation view` test (line 250-251) **and** the `multiple attachments display correctly` test (line 283-284), which has the identical pattern.

In `tests/e2e/file-attachments.spec.ts`:

**Test 1 — "attachments are displayed in conversation view" (lines 250-251):**
```typescript
// Replace:
await page.reload();
await page.waitForLoadState('networkidle');

// With:
await page.reload();
await waitForPageReady(page);
await page.waitForSelector('.message-content', { timeout: 10000 });
```

**Test 2 — "multiple attachments display correctly" (lines 283-284):**
```typescript
// Replace:
await page.reload();
await page.waitForLoadState('networkidle');

// With:
await page.reload();
await waitForPageReady(page);
await page.waitForSelector('.message-content', { timeout: 10000 });
```

`waitForPageReady` is already imported via the helpers and waits for `networkidle` plus loading indicator dismissal. Adding the `.message-content` wait ensures the Vue conversation view has actually rendered its messages before we look for attachment chips.

**Files to change:**
- `tests/e2e/file-attachments.spec.ts` — lines 250-251 and lines 283-284

---

## Summary of Changes

| File | Lines | Change | Type |
|------|-------|--------|------|
| `tests/e2e/settings.spec.ts` | 383 | `.toBe(false)` -> `.toBe(true)` | Wrong expectation |
| `tests/e2e/settings.spec.ts` | 389 | `.toBe(false)` -> `.toBe(true)` | Wrong expectation |
| `tests/e2e/file-attachments.spec.ts` | 250-251 | Replace `waitForLoadState` with `waitForPageReady` + `.message-content` wait | Flaky fix |
| `tests/e2e/file-attachments.spec.ts` | 283-284 | Replace `waitForLoadState` with `waitForPageReady` + `.message-content` wait | Flaky fix (same pattern) |

All fixes are test-only changes — no application code modifications needed.

## Verification

After making changes, run the two affected test files:

```bash
./scripts/pw.sh test tests/e2e/settings.spec.ts
./scripts/pw.sh test tests/e2e/file-attachments.spec.ts
```

Both should pass without failures or flakiness.
