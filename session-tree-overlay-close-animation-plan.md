# Plan: Add Slide-Out Animation to SessionTreeOverlay Close Handle

## Current State Analysis

### Existing Animation (Opening)
The component already has a slide-in animation defined:
- Uses `<Transition name="slide-left" appear>` (line 3)
- Slides in from right: `translateX(100%)` → `translateX(0)`
- Duration: 0.4s with cubic-bezier easing
- Includes `prefers-reduced-motion` support

### The Problem
The close handle (lines 12-39) calls `close()` which immediately emits a 'close' event to the parent. The parent component (`SessionDetailView`) then unmounts the `SessionTreeOverlay` component entirely, which **bypasses the Vue Transition leave animation**.

The transition styles for leaving ARE already defined (lines 626-634):
```css
.slide-left-leave-from {
  opacity: 1;
  transform: translateX(0);
}

.slide-left-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
```

But the animation doesn't play because the component is destroyed immediately.

### Code Verification

**SessionTreeOverlay.vue assumptions verified:**
- ✅ Line 235: `const visible = ref(true);` - visible ref exists
- ✅ Line 5: `v-if="visible"` - template uses visible for conditional rendering
- ✅ Line 312-314: `close()` emits 'close' event immediately
- ✅ Lines 609-634: Transition CSS styles already defined for both enter and leave
- ✅ All close triggers (handle, X button, backdrop, Escape) call the same `close()` method

**SessionDetailView.vue assumptions verified:**
- ✅ Lines 66-70: Parent unmounts SessionTreeOverlay when `@close` fires
- ✅ Parent sets `treeOverlayOpen = false` - no changes needed to parent component
- ✅ This pattern will work with delayed close event emission

## Solution: Implement "Closing" State

We need to add an intermediate "closing" state that allows the Transition to play before the component is actually removed.

### Changes Required

#### 1. SessionTreeOverlay.vue

**Add a `closing` ref:**
- New ref to track when we're in the process of closing
- Guard against rapid close attempts during transition
- Modify `close()` to set this state instead of immediately emitting

**Update the template:**
- Change `v-if="visible"` to `v-if="visible || closing"`
- This keeps the component mounted during the leave transition
- Add `@after-leave` hook to Transition component

**Modified close logic with guard:**
```javascript
const closing = ref(false);

function close() {
  // Guard: don't re-trigger if already closing
  if (closing.value) {
    return;
  }
  closing.value = true;
  visible.value = false;  // This triggers the leave transition
}

function afterLeave() {
  emit('close');  // Only emit after transition completes
}
```

**Update defineExpose (around line 599):**
```javascript
defineExpose({
  activeSessionId,
  pickerOpen,
  isMobile,
  sessionChain,
  closing,  // Add this for testing
});
```

**Updated Transition element:**
```vue
<Transition name="slide-left" appear @after-leave="afterLeave">
```

#### 2. SessionDetailView.vue - No Changes Needed

Verified: Parent component (line 67-70) handles close correctly:
```vue
<SessionTreeOverlay
  v-if="treeOverlayOpen"
  :session-id="overlaySessionId"
  @close="treeOverlayOpen = false"
/>
```
The parent simply sets `treeOverlayOpen = false` which unmounts the component. No changes needed.

## Implementation Steps

1. ✅ Read SessionDetailView.vue to understand parent close handling
2. Modify SessionTreeOverlay.vue:
   - Add `closing` ref
   - Update `close()` method with guard to set `closing` and `visible` to false
   - Add `afterLeave()` method to emit close event
   - Add `@after-leave="afterLeave"` to Transition element
   - Update template condition to `v-if="visible || closing"`
   - Update `defineExpose` to include `closing` ref
3. Modify SessionTreeOverlay.test.js:
   - Add `waitForTransition()` helper function
   - Update 6 existing close behavior tests to use helper
   - Add new "close animation" test suite with 5 test cases
4. Test the animation manually:
   - Click the close handle
   - Verify overlay slides to the right (same as open animation, but reversed)
   - Ensure overlay is removed from DOM after animation completes

## Expected Behavior

- User clicks close handle (or ✕ button, or presses Escape)
- Overlay starts sliding to the right with opacity fade
- Animation takes 0.4s (same duration as open)
- After animation completes, component emits 'close' event
- Parent unmounts the component
- Body scroll is unlocked (already handled in onUnmounted)

## Edge Cases to Consider

1. **Multiple close triggers**: Handle, X button, backdrop click, Escape key - all use the same `close()` method, so they'll all work consistently
2. **Rapid close attempts**: The guard (`if (closing.value) return`) prevents re-triggering the close sequence if user clicks multiple times during the 0.4s transition
3. **Reduced motion**: The existing `@media (prefers-reduced-motion: reduce)` will still apply
4. **Component unmounting**: The `onUnmounted` hook cleanup will still fire after the transition completes (and after `afterLeave()` emits)
5. **Component mounted during transition**: The `v-if="visible || closing"` ensures component stays mounted during the 0.4s animation, then unmounts when parent receives the close event
6. **External unmount during transition**: If the parent unmounts the component during the transition (e.g., user navigates away), the `afterLeave` hook won't fire, which is fine - the parent is already cleaning up. The close event simply won't be emitted, which is acceptable since the component is being destroyed anyway.

## Files to Modify

- `packages/web/src/components/SessionTreeOverlay.vue` - Main changes
- `packages/web/src/components/SessionTreeOverlay.test.js` - Add new test cases

## Test Coverage (SessionTreeOverlay.test.js)

### Test Helper Function

Add this helper function after the `mountOverlay` function (around line 162):

```javascript
async function waitForTransition() {
  // Wait for slide-left transition to complete (0.4s + small buffer)
  await new Promise(r => setTimeout(r, 450));
  await nextTick();
}
```

### Update Existing Tests (lines 246-373)

**ALL existing "close behavior" tests must be updated** to wait for the transition. Each test currently expects immediate `onClose` emission, but with the new implementation it's delayed by 450ms.

For each test in the "close behavior" suite, add `await waitForTransition()` before the `expect(onClose)...` assertion.

**Example - update line 247-259:**
```javascript
it('emits close when close button is clicked', async () => {
  const onClose = vi.fn();
  const wrapper = mount(SessionTreeOverlay, {
    props: { sessionId: 'sess-root' },
    attrs: { onClose },
    attachTo: document.body,
  });
  await nextTick();
  document.querySelector('[data-testid="session-tree-close"]').click();
  await nextTick();
  await waitForTransition();  // ADD THIS LINE
  expect(onClose).toHaveBeenCalled();
  wrapper.unmount();
});
```

**Tests to update (all in "close behavior" suite):**
- Line 247: "emits close when close button is clicked"
- Line 261: "emits close on Escape when picker is closed"
- Line 275: "closes picker instead of overlay on Escape when picker is open" (NO CHANGE - this test doesn't emit close)
- Line 294: "emits close when clicking the backdrop"
- Line 310: "does not emit close when clicking inside overlay content" (NO CHANGE - this test verifies close is NOT emitted)
- Line 326: "emits close when close handle is clicked"
- Line 342: "emits close when Enter is pressed on close handle"
- Line 358: "emits close when Space is pressed on close handle"

### New Test Suite: "close animation"

Add this describe block after the existing "close behavior" suite (after line 373):

```javascript
describe('close animation', () => {
  it('delays close event until after transition completes', async () => {
    const onClose = vi.fn();
    const wrapper = mount(SessionTreeOverlay, {
      props: { sessionId: 'sess-root' },
      attrs: { onClose },
      attachTo: document.body,
    });
    await nextTick();

    // Trigger close
    const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
    handle.click();
    await nextTick();

    // Immediately after click, close should NOT have been emitted yet
    expect(onClose).not.toHaveBeenCalled();

    // Wait for transition
    await waitForTransition();

    // Now close should have been emitted
    expect(onClose).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('sets closing state when close is triggered', async () => {
    const wrapper = mountOverlay();
    await nextTick();

    // Initially not closing
    expect(wrapper.vm.closing).toBe(false);

    // Trigger close
    const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
    handle.click();
    await nextTick();

    // Should be in closing state
    expect(wrapper.vm.closing).toBe(true);
    expect(wrapper.vm.visible).toBe(false);

    // Clean up
    document.querySelectorAll('[data-testid="session-tree-overlay"]').forEach(el => el.remove());
  });

  it('guards against rapid close attempts', async () => {
    const onClose = vi.fn();
    const wrapper = mount(SessionTreeOverlay, {
      props: { sessionId: 'sess-root' },
      attrs: { onClose },
      attachTo: document.body,
    });
    await nextTick();

    const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');

    // Click close multiple times rapidly
    handle.click();
    await nextTick();
    handle.click();
    await nextTick();
    handle.click();
    await nextTick();

    // Wait for transition
    await waitForTransition();

    // Should only emit close once
    expect(onClose).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('component remains mounted during transition', async () => {
    const wrapper = mountOverlay();
    await nextTick();

    const handle = document.querySelector('[data-testid="session-tree-overlay-close-handle"]');
    const backdrop = document.querySelector('[data-testid="session-tree-overlay"]');

    // Trigger close
    handle.click();
    await nextTick();

    // Component should still be in DOM
    expect(backdrop).toBeTruthy();

    // Wait for transition
    await waitForTransition();

    // After transition, parent would unmount, so we manually unmount here
    wrapper.unmount();
  });

  it('all close triggers use the same guarded close method', async () => {
    const onClose = vi.fn();

    // Test each close trigger
    const triggers = [
      () => document.querySelector('[data-testid="session-tree-close"]').click(),
      () => document.querySelector('[data-testid="session-tree-overlay-close-handle"]').click(),
      () => document.querySelector('[data-testid="session-tree-overlay"]').click(),
    ];

    for (const trigger of triggers) {
      const testWrapper = mount(SessionTreeOverlay, {
        props: { sessionId: 'sess-root' },
        attrs: { onClose },
        attachTo: document.body,
      });
      await nextTick();

      trigger();
      await nextTick();

      // Should not emit immediately
      expect(onClose).not.toHaveBeenCalled();

      // Wait for transition
      await waitForTransition();

      // Should emit once
      expect(onClose).toHaveBeenCalledTimes(1);

      // Clean up
      onClose.mockClear();
      document.querySelectorAll('[data-testid="session-tree-overlay"]').forEach(el => el.remove());
    }
  });
});
```

### Summary of Test Changes

**Add:** 1 helper function, 5 new test cases
**Update:** 6 existing test cases (add `await waitForTransition()`)
**Skip:** 2 existing tests (they verify close is NOT emitted)

## Testing Checklist

### Unit Tests (SessionTreeOverlay.test.js)
- [ ] Add `waitForTransition()` helper function
- [ ] Update 6 existing close behavior tests to use helper (add await before assertions)
- [ ] Add new "close animation" test suite with 5 test cases
- [ ] Update `defineExpose` to include `closing` ref (required for tests)
- [ ] Run all tests to ensure no regressions
- [ ] Verify all tests pass (existing + new)

### Manual Testing (Browser)
- [ ] Click close handle → overlay slides right with fade
- [ ] Click ✕ button → overlay slides right with fade
- [ ] Click backdrop → overlay slides right with fade
- [ ] Press Escape → overlay slides right with fade
- [ ] Animation duration matches open animation (0.4s)
- [ ] Overlay is removed from DOM after animation
- [ ] Body scroll is unlocked after animation
- [ ] Rapid clicks on close handle → only one close event emitted
- [ ] Reduced motion preference is respected (no slide, just fade)
- [ ] Test on mobile viewport (handle still works with animation)
