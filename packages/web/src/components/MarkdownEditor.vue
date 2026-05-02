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

// Debounced save — 1 second after last edit
let debounceTimer = null;
let lastSavedContent = props.content || '';

watch(editorContent, (newVal) => {
  // Skip no-op assignments and externally-driven updates (version switch) —
  // otherwise a programmatic editorContent.value = props.content would trigger
  // a spurious save that creates a new version of the old content.
  if (newVal === lastSavedContent) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    lastSavedContent = newVal;
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
    emit('save', editorContent.value);
  }
}

defineExpose({ flushPendingSave });

// Watch for external content changes (e.g., version switch). We update
// lastSavedContent BEFORE mutating editorContent.value so both the
// editorContent watcher's next-tick run and any concurrent flushPendingSave
// call see editorContent.value === lastSavedContent and exit without emitting.
watch(() => props.content, (newContent) => {
  if (newContent === editorContent.value) return;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  lastSavedContent = newContent || '';
  editorContent.value = newContent || '';
});

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
