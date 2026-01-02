# Diagnosis: iPad Heat & Lag in Session Detail View

## Problem
- iPad gets **hot** when viewing session details
- Typing is laggy in both session detail and new session views
- iPhone and macOS don't have this issue

## Root Cause: Streaming Updates + Expensive Markdown Rendering

### The Performance Disaster Chain

When a session is streaming (or even when just typing), here's what happens:

```
WebSocket message arrives (partialText)
    ↓
partialText.value = text  (Vue reactivity triggers)
    ↓
MarkdownViewer re-renders
    ↓
renderMarkdown() computed runs
    ↓
markdown-it parses the content
    ↓
highlight.js runs on EVERY code block
    ↓
hljs.highlightAuto() - EXTREMELY EXPENSIVE! 🔥
    ↓
DOMPurify sanitizes HTML
    ↓
Vue diffs and updates DOM
    ↓
CSS animations run (dots pulsing, borders pulsing)
```

**This happens 10-30+ times per second during streaming.**

---

## Culprit #1: `hljs.highlightAuto()` (MAIN ISSUE)

In `packages/web/src/utils/markdown.js`:

```javascript
// Use auto-detection for unknown languages
try {
  const result = hljs.highlightAuto(str);  // ← 🔥 EXTREMELY EXPENSIVE
  return `<pre class="hljs"><code>${result.value}</code></pre>`;
}
```

`highlightAuto()` tests the code against **every registered language grammar** to guess the language. This is CPU-intensive even on desktop, but devastating on iPad.

During streaming:
- Partial code blocks are sent frequently
- Each update triggers full markdown re-parse
- `highlightAuto()` runs on every code block, every time

---

## Culprit #2: No Throttling on Streaming Updates

In `ConversationTab.vue`:
```javascript
unsubPartial = onPartial((text) => {
  partialText.value = text;  // ← Direct update, no throttle
  scrollToBottom();
});
```

WebSocket partial updates can come in **multiple times per second**. Each one triggers the full render chain.

---

## Culprit #3: CSS Animations During High-Load

In `ThinkingBlock.vue`:
```css
.thinking-streaming {
  animation: streamPulse 2s ease-in-out infinite;
}

.streaming-dots .dot {
  animation: pulse 1.4s ease-in-out infinite;
}
```

In `LiveWorkLogPanel.vue`:
```css
.live-log-item {
  animation: slideIn 0.2s ease;
}
```

These animations run **constantly** and use GPU/compositor resources while the CPU is already overwhelmed.

---

## Culprit #4: Sync Watchers Force Immediate Execution

In `LiveWorkLogPanel.vue`:
```javascript
watch(() => props.partialThinking, () => {
  scrollToBottom();
}, { flush: 'sync' });  // ← Forces immediate, synchronous execution
```

Sync watchers bypass Vue's batching optimizations.

---

## Why iPad is More Affected

1. **Single-thread JS performance** - iPad's A-series chips prioritize efficiency over single-thread speed
2. **Safari's JS engine** - Less optimized than V8
3. **Thermal throttling** - Once it heats up, performance drops further (death spiral)
4. **Lower memory bandwidth** - More GC pressure from all the string allocations

---

## Proposed Fixes (Priority Order)

### Fix 1: DISABLE `highlightAuto()` - Critical

Replace auto-detection with a fast fallback:

```javascript
// Before
try {
  const result = hljs.highlightAuto(str);
  return `<pre class="hljs"><code>${result.value}</code></pre>`;
}

// After - just escape and display, skip auto-detection
return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
```

Or better: only highlight when language is explicitly specified:
```javascript
highlight: function (str, lang) {
  if (lang && hljs.getLanguage(lang)) {
    try {
      return `<pre class="hljs"><code class="language-${lang}">${
        hljs.highlight(str, { language: lang, ignoreIllegals: true }).value
      }</code></pre>`;
    } catch { /* fall through */ }
  }
  // NO auto-detection - just escape
  return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
}
```

### Fix 2: Throttle Streaming Updates

Add throttling to partial message updates:

```javascript
import { throttle } from 'lodash-es';

// Throttle to max 5 updates per second (200ms)
const throttledSetPartial = throttle((text) => {
  partialText.value = text;
}, 200, { leading: true, trailing: true });

unsubPartial = onPartial((text) => {
  throttledSetPartial(text);
  // Don't auto-scroll on every update
});
```

### Fix 3: Disable CSS Animations During Streaming

Add a class to disable animations when streaming:

```css
/* Reduce motion when streaming to save resources */
.streaming-active .thinking-streaming,
.streaming-active .streaming-dots .dot {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  .thinking-streaming,
  .streaming-dots .dot,
  .live-log-item {
    animation: none;
  }
}
```

### Fix 4: Change Sync Watchers to Post

```javascript
// Before
watch(() => props.partialThinking, () => {
  scrollToBottom();
}, { flush: 'sync' });

// After
watch(() => props.partialThinking, () => {
  scrollToBottom();
}, { flush: 'post' });  // Let Vue batch updates
```

### Fix 5: Use Simpler Streaming Display

For the streaming message, skip markdown rendering entirely and use plain text:

```html
<!-- During streaming, show plain text (fast) -->
<div v-if="partialText" class="message message-assistant message-streaming">
  <div class="message-content">
    <pre class="streaming-text">{{ partialText }}</pre>
  </div>
</div>

<!-- Only render markdown for completed messages -->
<div v-for="message in sessionsStore.messages" ...>
  <MarkdownViewer v-if="message.role === 'assistant'" :content="message.content" />
</div>
```

---

## Implementation Plan

1. **Immediate** - Fix 1: Remove `highlightAuto()` (~5 min, biggest impact)
2. **High Priority** - Fix 2: Add throttling to streaming (~10 min)
3. **Medium** - Fix 5: Plain text during streaming (~15 min)
4. **Low** - Fixes 3 & 4: Animation and watcher cleanup (~10 min)

---

## Files to Modify

| File | Change |
|------|--------|
| `packages/web/src/utils/markdown.js` | Remove `highlightAuto()` |
| `packages/web/src/components/ConversationTab.vue` | Throttle streaming, plain text streaming |
| `packages/web/src/components/LiveWorkLogPanel.vue` | Remove sync watchers, reduce animations |
| `packages/web/src/components/ThinkingBlock.vue` | Reduce/disable animations |

---

## Expected Impact

| Fix | CPU Reduction | Heat Reduction |
|-----|---------------|----------------|
| Remove highlightAuto | ~60-70% | Major |
| Throttle streaming | ~20-30% | Moderate |
| Plain text streaming | ~10-15% | Minor |
| Animation cleanup | ~5-10% | Minor |

**Combined: Should eliminate the heat issue and make iPad usable.**
