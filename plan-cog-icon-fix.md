# Fix: Cog Icon in Quick Responses Panel (Session Overlay)

## Root Cause

The Quick Response Settings modal opens **behind** the Session Tree Overlay due to a z-index conflict:

| Component | z-index | File |
|-----------|---------|------|
| `SessionTreeOverlay` backdrop | **1000** | `SessionTreeOverlay.vue:716` |
| `QuickResponseSettings` overlay | **999** | `QuickResponseSettings.vue:243` |
| `QuickResponseDialog` overlay | **1000** | `QuickResponseDialog.vue:268` |
| `QuickResponseSettings` confirm dialog | **1001** | `QuickResponseSettings.vue:452` |

When the user clicks the cog icon from within the session overlay, the `QuickResponseSettings` modal is rendered via `<Teleport to="body">` and appears at z-index 999 — **below** the session overlay at z-index 1000. The modal is in the DOM and "visible" per CSS, but is completely obscured and unreachable.

## Why Existing Tests Don't Catch It

The existing E2E test at line 404 (`settings gear opens settings modal from conversation view`) uses Playwright's `toBeVisible()` assertion, which checks CSS `display`/`visibility`/`opacity` — **not** whether the element is obscured by a higher z-index sibling. The modal is technically "visible" in the DOM but hidden behind the overlay.

## Plan

### Step 1: Write an E2E test that surfaces the bug

Add a new test to `tests/e2e/quick-responses.spec.ts` that proves the settings modal is **interactable** (not just visible) when opened from the session overlay:

- Open a session in the overlay view
- Expand the quick responses panel
- Click the cog icon to open settings
- **Try to click the "+ Add" button** inside the settings modal
- Assert the Add Quick Response dialog opens

This test will **fail** before the fix because the settings modal is behind the overlay, so clicking "+ Add" will either:
- Not register (click hits the overlay instead)
- Time out waiting for the dialog

### Step 2: Fix the z-index values

Update z-index values in `QuickResponseSettings.vue` so that both the settings overlay and its sub-dialogs render above the session overlay:

| Component | Current | New |
|-----------|---------|-----|
| `.settings-overlay` (QuickResponseSettings) | 999 | **1010** |
| `.confirm-overlay` (QuickResponseSettings) | 1001 | **1020** |

Also verify `QuickResponseDialog.vue`:

| Component | Current | New |
|-----------|---------|-----|
| `.dialog-overlay` (QuickResponseDialog) | 1000 | **1015** |

This creates a clean stacking order:
1. Session Tree Overlay: 1000
2. Quick Response Settings modal: 1010
3. Quick Response Add/Edit dialog: 1015
4. Delete confirmation dialog: 1020

### Step 3: Run the new E2E test to verify the fix

Run the new test and the existing "settings gear" tests to confirm:
- New test passes (modal is interactable)
- Existing tests still pass (no regression)

### Files Modified

- `tests/e2e/quick-responses.spec.ts` — new E2E test
- `packages/web/src/components/QuickResponseSettings.vue` — fix z-index (999 → 1010, 1001 → 1020)
- `packages/web/src/components/QuickResponseDialog.vue` — fix z-index (1000 → 1015)
