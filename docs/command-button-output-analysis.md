# Command Button Output UI Analysis

## Current Architecture Overview

### Data Flow

```
WebSocket (COMMAND_RUN_OUTPUT)
       ↓
useWebSocket.onCommandOutput()
       ↓
commandButtonsStore.appendOutput(runId, text)
       ↓
Buffered, flushed every 300ms via _flushOutput()
       ↓
CommandButtonItem.vue receives via props.run.output
       ↓
ansiToHtml() conversion (debounced 250ms via debounceLeading)
       ↓
v-html="formattedOutput" renders in output-text div
```

### Key Files

| File | Purpose |
|------|---------|
| `packages/web/src/components/CommandButtonItem.vue` | Main UI component for command output display |
| `packages/web/src/stores/commandButtons.js` | Pinia store with output buffering/truncation |
| `packages/web/src/utils/ansi.js` | ANSI escape code to HTML conversion |

---

## Identified UX Issues

### 1. "Processing Large Output" Message Shows Even When Output Pane is Hidden

**Location:** `CommandButtonItem.vue` lines 62-68

```vue
<div v-if="isRenderingLargeOutput" class="output-rendering-overlay">
  <div class="spinner-container">
    <div class="spinner-large"></div>
    <p class="rendering-text">Processing large output...</p>
  </div>
</div>
```

**Root Cause:** The `isRenderingLargeOutput` state is set in `showRenderingSpinner()` which is called when the watcher detects output changes (lines 309-325):

```javascript
watch(
  () => [props.run?.output, showOutput.value],
  ([newOutput, isVisible]) => {
    // ...
    if (isVisible) {
      showRenderingSpinner(newOutput);  // Sets isRenderingLargeOutput = true
      updateFormattedOutput(newOutput);
    }
  },
```

The problem is that `isRenderingLargeOutput` is rendered **inside** the `v-if="showOutput"` block (line 53), BUT the state may be set when transitioning from hidden to visible. The overlay is positioned absolute within `.output-content` which itself is within the conditional block.

**However**, the real issue may be the spinner showing briefly when the user opens the pane for already-processed large output.

---

### 2. Large Output Causes UI Hang

**Root Cause:** Multiple compounding factors:

#### A. ANSI to HTML conversion is expensive
```javascript
// ansi.js line 41-68
export function ansiToHtml(text) {
  const html = convert.toHtml(text);  // Can be slow for 2000+ lines
  const sanitized = DOMPurify.sanitize(html, { ... });  // Additional processing
  return sanitized;
}
```

#### B. v-html triggers full DOM replacement
```vue
<div v-html="formattedOutput || '(no output)'" ...></div>
```
When `formattedOutput` (potentially huge HTML string) changes, Vue replaces the entire innerHTML, causing browser layout/paint thrashing.

#### C. Reactivity cascade
1. Store updates `run.output` every 300ms
2. Vue re-renders component
3. `ansiToHtml()` processes 2000 lines of text
4. DOM updates with massive HTML string
5. Browser paints/layouts
6. Repeat every 300ms while output is streaming

#### D. Debouncing is insufficient
The `debounceLeading` allows immediate first render, then 250ms debounce. This means:
- First chunk: immediate render
- Rapid subsequent chunks: still render every 250ms
- Large output: 250ms is not enough to prevent UI blocking

---

### 3. Copy/Canvas Buttons Hidden Until Output Expanded

**Location:** Lines 77-90 - buttons are inside the collapsible `output-content` div:

```vue
<div v-if="showOutput" class="output-content">
  <!-- ... output display ... -->

  <!-- Output Actions (inside the collapsed section!) -->
  <div v-if="run.status !== 'running'" class="output-actions">
    <button @click="handleCopy">📋 Copy</button>
    <button @click="handleCanvas">🎨 Send to Canvas</button>
  </div>
</div>
```

User must click to expand output before accessing these actions.

---

### 4. UI Becomes Unusable with Large Output

**Symptoms:**
- Scrolling becomes laggy
- Button clicks are delayed
- Browser becomes unresponsive

**Root Causes:**
1. **Massive DOM nodes**: 2000 lines × multiple spans per line (ANSI styling) = potentially 10,000+ DOM elements
2. **No virtualization**: All lines rendered at once
3. **Expensive re-renders**: Every update re-processes and re-renders entire output
4. **Main thread blocking**: ANSI conversion runs on main thread

---

## Performance Mitigations Already in Place

| Mitigation | Implementation | Effectiveness |
|------------|---------------|---------------|
| Output truncation | Store limits to 2000 lines | Moderate - still a lot of content |
| Output buffering | 300ms flush interval | Moderate - reduces update frequency |
| ANSI debouncing | 250ms with leading edge | Minimal - still renders frequently |
| Lazy loading | Only process when expanded | Good - but problem persists when expanded |

---

## Implementation Plan

### Core Insight

**Decouple stored output from displayed output.**

- Store: Keep full output (2000 lines) for copy/canvas operations
- Display: Only render last 200 lines in the DOM
- This eliminates the performance problem without complex virtualization

Users need to COPY 2000 lines. They don't need to SEE 2000 lines rendered with ANSI styling in a tiny scrollable div.

---

### Step 1: Remove All Loading/Processing UI (Delete It)

The spinner and loading states are useless UX theater. Remove entirely:

**Template changes:**
- Delete the `.output-rendering-overlay` block (lines 62-68)
- Delete the `.output-skeleton` block (lines 58-61)

**Script changes:**
- Delete `isRenderingLargeOutput` ref
- Delete `isLoadingOutput` computed
- Delete `showRenderingSpinner()` function
- Delete `renderingTimeoutId` and `renderingFrameId` variables
- Delete cleanup code in `onBeforeUnmount` for these
- Remove from `defineExpose`

**Style changes:**
- Delete `.output-rendering-overlay` and children
- Delete `.output-skeleton` and `.skeleton-line`
- Delete `@keyframes fade-in`

---

### Step 2: Cap Displayed Output to 200 Lines

**The key fix.** Change `updateFormattedOutput` to only format the tail:

```javascript
const DISPLAY_LINE_LIMIT = 200;

const updateFormattedOutput = debounceLeading((output) => {
  const lines = output.split('\n');
  const displayOutput = lines.length > DISPLAY_LINE_LIMIT
    ? lines.slice(-DISPLAY_LINE_LIMIT).join('\n')
    : output;
  formattedOutput.value = ansiToHtml(displayOutput);
}, 250);
```

**Why this works:**
- 200 lines with ANSI conversion = ~10-20ms (fast)
- 200 lines in DOM = ~600 elements (manageable)
- Full output still in `props.run.output` for copy/canvas
- No virtualization complexity needed

**Add truncation indicator in template:**
```vue
<div v-if="outputIsTruncatedForDisplay" class="output-display-truncated">
  ↑ Showing last 200 lines. Use Copy to get full output.
</div>
```

---

### Step 3: Move Copy/Canvas Buttons to Header

Move buttons outside collapsible section. User can copy without expanding.

**In `.button-actions` div (after status indicator):**
```vue
<button
  v-if="run?.output && run.status !== 'running'"
  class="btn btn-sm btn-icon"
  @click="handleCopy"
  :title="isCopied ? 'Copied!' : 'Copy output to clipboard'"
>
  {{ isCopied ? '✓' : '📋' }}
</button>
<button
  v-if="run?.output && run.status !== 'running'"
  class="btn btn-sm btn-icon"
  @click="handleCanvas"
  title="Send output to canvas"
>
  🎨
</button>
```

**Delete the `.output-actions` div** from inside `.output-content`.

---

### Step 4: Simplify the Output Watcher

Current watcher is overcomplicated. Simplify:

```javascript
watch(
  () => [props.run?.output, showOutput.value],
  ([newOutput, isVisible]) => {
    if (!newOutput || !isVisible) {
      // Clear formatted output when hidden or empty
      if (!newOutput) formattedOutput.value = '';
      return;
    }
    updateFormattedOutput(newOutput);
  },
  { immediate: true }
);
```

No spinner logic, no loading states. Just format when visible.

---

### Step 5: Fix Auto-Scroll to Bottom

**Current bug:** `getOutputContainer()` uses `document.querySelector('[data-output-container]')` - a global selector that returns the FIRST matching element in the DOM. With multiple command buttons, this scrolls the wrong output pane.

**Fix: Use template ref instead of global querySelector**

```vue
<template>
  <div
    ref="outputContainerRef"
    class="output-text"
    @scroll="onScroll"
    v-html="formattedOutput || '(no output)'"
  ></div>
</template>

<script setup>
const outputContainerRef = ref(null);

// Delete getOutputContainer() function entirely
// Replace all getOutputContainer() calls with outputContainerRef.value
```

**Fix timing: Use requestAnimationFrame after nextTick**

`nextTick` waits for Vue reactivity but not browser paint. Scroll height may be stale.

```javascript
watch(
  () => props.run?.output,
  () => {
    if (userHasScrolledUp.value || !showOutput.value) return;

    nextTick(() => {
      // Wait for browser paint before scrolling
      requestAnimationFrame(() => {
        const el = outputContainerRef.value;
        if (el) {
          isProgrammaticScroll.value = true;
          el.scrollTop = el.scrollHeight;
        }
      });
    });
  }
);
```

**Simplify scroll tracking:**

The current `isProgrammaticScroll` flag approach has race conditions. Simpler approach - just check if we're near bottom before each scroll:

```javascript
const scrollToBottom = () => {
  const el = outputContainerRef.value;
  if (!el) return;

  // Only auto-scroll if already near bottom (within 100px)
  const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  if (isNearBottom) {
    nextTick(() => {
      requestAnimationFrame(() => {
        if (outputContainerRef.value) {
          outputContainerRef.value.scrollTop = outputContainerRef.value.scrollHeight;
        }
      });
    });
  }
};
```

This removes the need for `userHasScrolledUp`, `isProgrammaticScroll`, and `onScroll` handler complexity.

---

### Summary of Changes

| What | Action |
|------|--------|
| Loading spinner | DELETE |
| Loading skeleton | DELETE |
| `isRenderingLargeOutput` | DELETE |
| `isLoadingOutput` | DELETE |
| `showRenderingSpinner()` | DELETE |
| `getOutputContainer()` | DELETE (use template ref) |
| `userHasScrolledUp` | DELETE |
| `isProgrammaticScroll` | DELETE |
| `onScroll` handler | SIMPLIFY (just check near-bottom) |
| Display limit | ADD (200 lines) |
| Copy/Canvas buttons | MOVE to header |
| `.output-actions` div | DELETE |
| Auto-scroll | FIX (template ref + requestAnimationFrame) |

**Files to modify:**
- `packages/web/src/components/CommandButtonItem.vue` (all changes)

**Result:**
- No loading indicators
- UI never hangs (200 lines max in DOM)
- Copy/Canvas always accessible
- Full output available via copy/canvas
- Auto-scroll works correctly with multiple command buttons
- Scroll respects user position (doesn't force scroll if user scrolled up)
