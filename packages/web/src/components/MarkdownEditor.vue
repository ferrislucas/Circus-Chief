<template>
  <div class="canvas-md-editor">
    <Suspense>
      <template #default>
        <MdEditorAsync
          v-model="editorContent"
          theme="dark"
          :preview="false"
          language="en-US"
          :no-upload-img="true"
          :show-code-row-number="true"
        />
      </template>
      <template #fallback>
        <div class="editor-loading">
          <span class="loading-spinner" />
          Loading editor...
        </div>
      </template>
    </Suspense>
  </div>
</template>

<script setup>
import { ref, watch, onUnmounted, defineAsyncComponent } from 'vue';
import { useCanvasStore } from '../stores/canvas.js';

const MdEditorAsync = defineAsyncComponent(() =>
  import('md-editor-v3').then(async (mod) => {
    // Import styles when the module loads
    await import('md-editor-v3/lib/style.css');
    return mod.MdEditor;
  })
);

const props = defineProps({
  content: {
    type: String,
    default: '',
  },
  sessionId: {
    type: String,
    required: true,
  },
  filename: {
    type: String,
    required: true,
  },
  itemId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['save']);

const canvasStore = useCanvasStore();
const editorContent = ref(props.content || '');

// ── Edit-session bookkeeping ──────────────────────────────────────────
// Tracks whether the user has modified the buffer since the last accepted
// external content. This lets us distinguish a background store refresh
// (which should be ignored) from a deliberate version switch via itemId
// change (which should replace the buffer).
let debounceTimer = null;
let lastSavedContent = props.content || '';
let lastEmittedContent = props.content || '';
let lastAcceptedItemId = props.itemId;
let lastAcceptedContent = props.content || '';
let userModified = false;
// Guard to prevent programmatic editorContent assignments from scheduling saves
let isProgrammaticChange = false;

watch(editorContent, (newVal) => {
  // Skip programmatic assignments (version switch, external content acceptance)
  if (isProgrammaticChange) return;
  // Skip no-op assignments
  if (newVal === lastSavedContent) return;

  // Mark buffer as user-modified
  userModified = true;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    lastSavedContent = newVal;
    lastEmittedContent = newVal;
    emit('save', newVal);
  }, 1000);
});

/**
 * Flush any pending unsaved content immediately.
 * Called before unmount so changes aren't lost when the user clicks "Done"
 * before the debounce timer fires.
 */
function flushPendingSave() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (editorContent.value !== lastSavedContent) {
    lastSavedContent = editorContent.value;
    lastEmittedContent = editorContent.value;
    emit('save', editorContent.value);
  }
}

defineExpose({ flushPendingSave });

// ── Combined watcher for itemId + content ─────────────────────────────
// Distinguishes between:
//   1. itemId change → deliberate version switch → always accept & replace buffer
//   2. Same itemId, content change, buffer NOT user-modified → accept new content
//   3. Same itemId, content change, buffer IS user-modified → ignore background churn
watch(
  () => ({ itemId: props.itemId, content: props.content }),
  ({ itemId: newItemId, content: newContent }) => {
    const normalizedContent = newContent || '';

    if (newItemId !== lastAcceptedItemId) {
      // ── Case 1: deliberate version switch ──
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      lastAcceptedItemId = newItemId;
      lastAcceptedContent = normalizedContent;
      lastSavedContent = normalizedContent;
      lastEmittedContent = normalizedContent;
      userModified = false;

      if (normalizedContent !== editorContent.value) {
        isProgrammaticChange = true;
        editorContent.value = normalizedContent;
        isProgrammaticChange = false;
      }
      return;
    }

    // Same itemId — content changed externally (WS echo, store refresh, etc.)
    if (normalizedContent === editorContent.value) {
      // Content already matches the buffer — just update bookkeeping
      lastAcceptedContent = normalizedContent;
      lastSavedContent = normalizedContent;
      return;
    }

    if (userModified) {
      // ── Case 3: buffer has been user-modified — ignore background churn ──
      // If the incoming content matches what we last emitted (self-originated
      // save echo), update bookkeeping but don't touch the buffer.
      if (normalizedContent === lastEmittedContent) {
        lastAcceptedContent = normalizedContent;
        lastSavedContent = normalizedContent;
      }
      // Otherwise it's a stale or stripped refresh — ignore entirely.
      return;
    }

    // ── Case 2: no local edits — accept external content ──
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    lastAcceptedContent = normalizedContent;
    lastSavedContent = normalizedContent;
    lastEmittedContent = normalizedContent;

    isProgrammaticChange = true;
    editorContent.value = normalizedContent;
    isProgrammaticChange = false;
  }
);

// No startEditing on mount — the store's saveMarkdownContent handles registering
// the editing session. This ensures that when the user returns to edit after
// navigating away, endEditing has cleared the map entry and the first save
// creates a NEW version (POST). The first-ever edit is handled by passing the
// current itemId to saveMarkdownContent.

onUnmounted(() => {
  flushPendingSave();
  canvasStore.endEditing(props.filename);
});
</script>

<style>
/* md-editor-v3 dark theme overrides — unscoped so they apply to the editor internals */
.canvas-md-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.canvas-md-editor .md-editor {
  flex: 1;
  --md-bk-color: rgb(17 24 39) !important;
  --md-border-color: var(--color-border, #374151) !important;
  --md-color: rgb(243 244 246) !important;
  border: none !important;
}

.canvas-md-editor .md-editor-dark {
  --md-bk-color: rgb(17 24 39) !important;
  --md-bk-color-outstand: rgb(31 41 55) !important;
  --md-bk-hover: rgb(55 65 81) !important;
  --md-border-color: var(--color-border, #374151) !important;
  --md-border-hover: rgb(75 85 99) !important;
  --md-border-active: rgb(34 211 238) !important;
  --md-color: rgb(243 244 246) !important;
  --md-modal-mask: rgba(0, 0, 0, 0.5) !important;
  --md-scrollbar-bg-color: rgb(55 65 81) !important;
  --md-scrollbar-thumb-color: rgb(107 114 128) !important;
  --md-scrollbar-thumb-hover-color: rgb(156 163 175) !important;
}

/* Toolbar background */
.canvas-md-editor .md-editor-toolbar-wrapper {
  background: rgb(31 41 55) !important;
}

.canvas-md-editor .md-editor-footer {
  background: rgb(31 41 55) !important;
}

/* Editor loading state */
.canvas-md-editor .editor-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
  color: var(--color-text-soft);
}

.canvas-md-editor .loading-spinner {
  display: inline-block;
  width: 1rem;
  height: 1rem;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
