# Plan: Fix File Attachment UI Hang

## Problem Summary

When a real user attempts to create a session with a file attachment through the UI, the interface hangs. However, all E2E tests pass because they **bypass the UI entirely** and call the API directly.

## Root Cause Analysis

### What the E2E Tests Actually Test

The file attachment tests in `tests/e2e/file-attachments.spec.ts` use the `seedSessionWithFiles()` helper which directly calls the API:

```javascript
// From tests/e2e/helpers.ts (lines 752-780)
export async function seedSessionWithFiles(projectId, data, files) {
  const formData = new FormData();
  formData.append('prompt', data.prompt);
  // ... append files ...
  const response = await fetch(`${API_URL}/api/projects/${projectId}/sessions`, {
    method: 'POST',
    body: formData,
  });
  return response.json();
}
```

**This tests:**
- ✅ API accepts FormData with file attachments
- ✅ Backend stores attachments in database
- ✅ Attachments display in UI after creation

**This does NOT test:**
- ❌ User clicking "Attach" button in NewSessionView
- ❌ Browser file picker interaction (`<input type="file">`)
- ❌ Files stored in Vue component state (`attachedFiles` ref)
- ❌ Form submission building FormData from browser File objects
- ❌ Complete request/response cycle through the actual UI

### The Untested Code Path

When a real user creates a session with files, this code path executes:

1. **`FileAttachment.vue`** - User clicks attach, selects files via `<input type="file">`
2. **`NewSessionView.vue`** - Captures files in `attachedFiles` ref via `@update:files`
3. **`handleSubmit()`** - Calls `buildSessionPayload()` with `files: attachedFiles.value`
4. **`sessionsStore.createSession()`** - Passes payload to API client
5. **`SessionsApi.createSession()`** - Extracts `files`, builds FormData, calls `_uploadFormData()`
6. **`ApiClient._uploadFormData()`** - Sends `fetch()` request with FormData

**None of these steps are exercised by the current E2E tests.**

### Potential Bug Locations

Based on code review, here are the most likely places for bugs:

1. **Missing FormData fields in `SessionsApi.createSession()`** (lines 69-78):
   - Only these fields are appended: `name`, `mode`, `model`, `effortLevel`, `gitBranch`, `gitMode`, `templateId`
   - Missing: `providerId`, `parentSessionId`, and all scheduling fields
   - This could cause backend validation issues when files are attached

2. **File object handling differences**:
   - E2E tests use `new Blob([content], { type })`
   - Real UI uses actual browser `File` objects
   - There could be subtle differences in how these are serialized

3. **Async/await issues in the request chain**:
   - The `_uploadFormData()` method looks correct, but there could be issues with error handling

---

## Implementation Plan

### Phase 1: Add E2E Tests for Real UI Flow

Add new tests to `tests/e2e/file-attachments.spec.ts` that test the actual UI:

```typescript
test.describe('File Attachments - UI Workflow', () => {
  test('creates session with file attachment through UI', async ({ page }) => {
    // 1. Navigate to new session page
    await page.goto(`/projects/${project.id}/sessions/new`);

    // 2. Fill in prompt
    await page.fill('textarea', 'Analyze this file');

    // 3. Attach file using Playwright's setInputFiles
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'test.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Test file content'),
    });

    // 4. Verify file chip appears
    await expect(page.locator('.file-chip')).toContainText('test.txt');

    // 5. Submit form
    await page.click('button[type="submit"]');

    // 6. Verify navigation and session creation
    await expect(page).toHaveURL(/\/sessions\/[a-f0-9-]+/);

    // 7. Verify attachment was stored
    const sessionId = page.url().match(/sessions\/([a-f0-9-]+)/)?.[1];
    const attachments = await getSessionAttachments(sessionId);
    expect(attachments.length).toBe(1);
    expect(attachments[0].filename).toBe('test.txt');
  });

  test('loading state shows during file upload submission', async ({ page }) => {
    // Test that the UI shows loading state and doesn't hang
  });

  test('error handling when file upload fails', async ({ page }) => {
    // Test error display when upload fails
  });
});
```

### Phase 2: Fix Missing FormData Fields

Update `packages/web/src/api/resources/SessionsApi.js` to include all fields:

```javascript
async createSession(projectId, data) {
  const { files, ...jsonData } = data;

  if (files && files.length > 0) {
    const formData = new FormData();
    formData.append('prompt', jsonData.prompt);

    // All optional string/null fields
    const optionalFields = [
      'name', 'mode', 'model', 'effortLevel', 'gitBranch', 'gitMode',
      'templateId', 'providerId', 'parentSessionId',  // <-- ADD THESE
    ];
    for (const field of optionalFields) {
      if (jsonData[field] !== undefined && jsonData[field] !== null) {
        formData.append(field, jsonData[field]);
      }
    }

    // Boolean fields (need String conversion)
    const booleanFields = ['thinkingEnabled', 'startImmediately'];
    for (const field of booleanFields) {
      if (jsonData[field] !== undefined) {
        formData.append(field, String(jsonData[field]));
      }
    }

    // Scheduling fields (numeric, need handling)  // <-- ADD THIS BLOCK
    const numericFields = [
      'scheduledAt', 'rescheduleDelayMinutes', 'maxRescheduleCount',
      'maxTotalTokens', 'rescheduleAtTokenCount',
    ];
    for (const field of numericFields) {
      if (jsonData[field] !== undefined && jsonData[field] !== null) {
        formData.append(field, String(jsonData[field]));
      }
    }

    // Scheduling boolean fields  // <-- ADD THIS BLOCK
    const schedulingBooleans = [
      'autoRescheduleEnabled', 'rescheduleOnTokenLimit', 'rescheduleOnServiceError',
    ];
    for (const field of schedulingBooleans) {
      if (jsonData[field] !== undefined) {
        formData.append(field, String(jsonData[field]));
      }
    }

    for (const file of files) {
      formData.append('files', file);
    }

    return this._uploadFormData(`/projects/${projectId}/sessions`, formData);
  }

  return this._post(`/projects/${projectId}/sessions`, jsonData);
}
```

### Phase 3: Debug the Actual Hang

If the issue persists after Phase 2, add debugging to identify the hang:

1. **Add console logging** to trace the request:
   ```javascript
   async _uploadFormData(path, formData) {
     console.log('[DEBUG] Starting upload to:', path);
     console.log('[DEBUG] FormData entries:', [...formData.entries()].map(([k, v]) => [k, v instanceof File ? v.name : v]));

     const response = await fetch(`${this.#baseUrl}${path}`, {
       method: 'POST',
       body: formData,
     });

     console.log('[DEBUG] Response status:', response.status);
     // ...
   }
   ```

2. **Check browser devtools Network tab** while reproducing the issue:
   - Is the request being sent?
   - Is the request stuck in "pending"?
   - Is there a CORS error?
   - Is the response received but not processed?

3. **Check for infinite loops** in Vue watchers or computed properties

---

## Testing Strategy

| Test Type | What to Test | Expected Result |
|-----------|--------------|-----------------|
| E2E (new) | Full UI flow: attach file → submit → verify | Session created with attachment |
| E2E (new) | Loading spinner during submission | Spinner shows, then navigates |
| E2E (new) | Multiple files through UI | All files attached correctly |
| E2E (new) | Cancel/remove file before submit | File removed from list |
| Unit | `SessionsApi.createSession` with files | FormData has all fields |

---

## Files to Modify

1. **`tests/e2e/file-attachments.spec.ts`** - Add UI workflow tests
2. **`packages/web/src/api/resources/SessionsApi.js`** - Fix missing FormData fields
3. **`packages/web/src/api/ApiClient.js`** - Add debugging (temporary)

---

## Success Criteria

1. New E2E tests pass that exercise the full UI workflow
2. Real users can attach files and create sessions without the UI hanging
3. All existing E2E tests continue to pass
4. FormData includes all necessary fields when files are attached
