<template>
  <div class="diff-viewer">
    <div v-if="files.length === 0" class="diff-empty">
      No changes to display
    </div>

    <div v-for="(file, fileIndex) in files" :key="fileIndex" class="diff-file">
      <div class="diff-file-header" @click="toggleFile(fileIndex)">
        <span class="diff-file-toggle">{{ isFileExpanded(fileIndex) ? '▼' : '▶' }}</span>
        <span class="diff-file-icon">
          <span v-if="file.isNew" class="file-badge file-badge-new">A</span>
          <span v-else-if="file.isDeleted" class="file-badge file-badge-deleted">D</span>
          <span v-else-if="file.isRenamed" class="file-badge file-badge-renamed">R</span>
          <span v-else class="file-badge file-badge-modified">M</span>
        </span>
        <span class="diff-file-path">{{ file.displayPath }}</span>
        <span class="diff-file-stats">
          <span v-if="file.additions" class="stat-additions">+{{ file.additions }}</span>
          <span v-if="file.deletions" class="stat-deletions">-{{ file.deletions }}</span>
        </span>
        <!-- Copy filename button -->
        <button
          class="copy-button"
          :class="{ copied: copiedFileIndex === fileIndex }"
          @click.stop="copyFilePath(file.displayPath, fileIndex)"
          :title="copiedFileIndex === fileIndex ? 'Copied!' : 'Copy filename'"
          :aria-label="`Copy ${file.displayPath} to clipboard`"
        >
          <span class="copy-button-icon">
            {{ copiedFileIndex === fileIndex ? '✓' : '📋' }}
          </span>
        </button>
        <!-- Markdown preview toggle -->
        <button
          v-if="isMarkdownFile(file.displayPath)"
          class="preview-toggle"
          :class="{ active: previewMode[fileIndex] }"
          @click.stop="togglePreview(fileIndex)"
          :title="previewMode[fileIndex] ? 'Show diff' : 'Preview markdown'"
        >
          {{ previewMode[fileIndex] ? '📝 Diff' : '👁 Preview' }}
        </button>
      </div>

      <div v-if="isFileExpanded(fileIndex)" class="diff-file-content">
        <!-- Markdown preview mode -->
        <div v-if="previewMode[fileIndex] && isMarkdownFile(file.displayPath)" class="markdown-preview-container">
          <div v-if="!file.isDeleted && !file.isNew" class="markdown-preview-split">
            <div class="markdown-preview-pane">
              <div class="markdown-preview-label markdown-preview-label-old">Before</div>
              <MarkdownViewer :content="extractOldContentFromDiff(file)" />
            </div>
            <div class="markdown-preview-pane">
              <div class="markdown-preview-label markdown-preview-label-new">After</div>
              <MarkdownViewer :content="extractNewContentFromDiff(file)" />
            </div>
          </div>
          <div v-else-if="file.isNew" class="markdown-preview-single">
            <div class="markdown-preview-label markdown-preview-label-new">New file</div>
            <MarkdownViewer :content="extractNewContentFromDiff(file)" />
          </div>
          <div v-else-if="file.isDeleted" class="markdown-preview-single">
            <div class="markdown-preview-label markdown-preview-label-old">Deleted file</div>
            <MarkdownViewer :content="extractOldContentFromDiff(file)" />
          </div>
        </div>

        <!-- Standard diff view -->
        <template v-else>
          <div v-for="(hunk, hunkIndex) in file.hunks" :key="hunkIndex" class="diff-hunk">
            <div class="diff-hunk-header">{{ hunk.header }}</div>
            <div class="diff-table-wrapper">
              <table class="diff-table">
                <tbody>
                  <tr
                    v-for="(line, lineIndex) in hunk.lines"
                    :key="lineIndex"
                    :class="['diff-line', `diff-line-${line.type}`]"
                  >
                    <td class="diff-line-num diff-line-num-old">{{ line.oldLineNumber ?? '' }}</td>
                    <td class="diff-line-num diff-line-num-new">{{ line.newLineNumber ?? '' }}</td>
                    <td class="diff-line-prefix">{{ getLinePrefix(line.type) }}</td>
                    <td class="diff-line-content">{{ line.content }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed } from 'vue';
import MarkdownViewer from './MarkdownViewer.vue';
import {
  isMarkdownFile,
  extractOldContentFromDiff,
  extractNewContentFromDiff,
} from '../utils/markdown.js';

const props = defineProps({
  files: {
    type: Array,
    required: true,
    default: () => [],
  },
  expandAll: {
    type: Boolean,
    default: true,
  },
  // External state management (keyed by file path)
  externalExpandedState: {
    type: Object,
    default: null,
  },
  // Default expanded state for first-time viewing
  // When undefined, falls back to expandAll prop behavior
  defaultExpanded: {
    type: Boolean,
    default: undefined,
  },
});

const emit = defineEmits(['update:expandedState']);

const expandedFiles = ref({});
const previewMode = ref({});
const copiedFileIndex = ref(null);

// Check if using external state management
// External state is in use when the prop is a non-null object
const useExternalState = computed(
  () => props.externalExpandedState !== null && typeof props.externalExpandedState === 'object'
);

// Get the effective expanded state for a file
function isFileExpanded(index) {
  const file = props.files[index];
  if (!file) return false;

  if (useExternalState.value) {
    // Use external state if available, fall back to defaultExpanded
    const filePath = file.displayPath;
    return props.externalExpandedState[filePath] ?? props.defaultExpanded;
  }
  // Use internal state
  return expandedFiles.value[index] ?? props.expandAll;
}

// Determine the default expanded state for new files
// Priority: defaultExpanded prop (if provided) > expandAll prop
function getDefaultExpandedState() {
  // If externalExpandedState is provided, this shouldn't be used
  // Otherwise, use defaultExpanded if explicitly set, otherwise fall back to expandAll
  if (props.defaultExpanded !== undefined) {
    return props.defaultExpanded;
  }
  return props.expandAll;
}

// Initialize expanded state (only for internal state mode)
watch(
  () => props.files,
  (newFiles) => {
    newFiles.forEach((file, index) => {
      // Only initialize internal state if not using external state
      if (!useExternalState.value && expandedFiles.value[index] === undefined) {
        expandedFiles.value[index] = getDefaultExpandedState();
      }
      // Initialize preview mode to true for markdown files (preview by default)
      if (previewMode.value[index] === undefined) {
        previewMode.value[index] = isMarkdownFile(file.displayPath);
      }
    });
  },
  { immediate: true }
);

function toggleFile(index) {
  const file = props.files[index];
  if (!file) return;

  const filePath = file.displayPath;
  const currentState = isFileExpanded(index);
  const newState = !currentState;

  if (useExternalState.value) {
    // Emit state update to parent
    const updatedState = { ...props.externalExpandedState, [filePath]: newState };
    emit('update:expandedState', updatedState);
  } else {
    // Update internal state
    expandedFiles.value[index] = newState;
  }
}

function togglePreview(index) {
  previewMode.value[index] = !previewMode.value[index];
}

async function copyFilePath(filePath, fileIndex) {
  try {
    await navigator.clipboard.writeText(filePath);
    // Show success feedback
    copiedFileIndex.value = fileIndex;
    // Reset after 1.5 seconds
    setTimeout(() => {
      copiedFileIndex.value = null;
    }, 1500);
  } catch (err) {
    console.error('Failed to copy file path:', err);
    // Fallback: try using execCommand
    try {
      const textarea = document.createElement('textarea');
      textarea.value = filePath;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      // Show success feedback
      copiedFileIndex.value = fileIndex;
      setTimeout(() => {
        copiedFileIndex.value = null;
      }, 1500);
    } catch (fallbackErr) {
      console.error('Fallback copy failed:', fallbackErr);
    }
  }
}

function collapseAllFiles() {
  if (useExternalState.value) {
    // Emit state update with all files collapsed
    const newState = {};
    props.files.forEach((file) => {
      newState[file.displayPath] = false;
    });
    emit('update:expandedState', newState);
  } else {
    props.files.forEach((_, index) => {
      expandedFiles.value[index] = false;
    });
  }
}

function expandAllFiles() {
  if (useExternalState.value) {
    // Emit state update with all files expanded
    const newState = {};
    props.files.forEach((file) => {
      newState[file.displayPath] = true;
    });
    emit('update:expandedState', newState);
  } else {
    props.files.forEach((_, index) => {
      expandedFiles.value[index] = true;
    });
  }
}

defineExpose({
  collapseAll: collapseAllFiles,
  expandAll: expandAllFiles,
  isFileExpanded,
});


function getLinePrefix(type) {
  switch (type) {
    case 'addition':
      return '+';
    case 'deletion':
      return '-';
    default:
      return ' ';
  }
}
</script>

<style scoped>
.diff-viewer {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.4;
}

.diff-empty {
  color: var(--color-text-soft);
  padding: 1rem;
  text-align: center;
}

.diff-file {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  margin-bottom: 1rem;
  overflow: hidden;
}

.diff-file-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background-color: var(--color-background-mute);
  cursor: pointer;
  user-select: none;
}

.diff-file-header:hover {
  background-color: var(--color-border);
}

.diff-file-toggle {
  color: var(--color-text-soft);
  font-size: 0.625rem;
  width: 1rem;
}

.diff-file-icon {
  display: flex;
  align-items: center;
}

.file-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  border-radius: 3px;
  font-size: 0.625rem;
  font-weight: 600;
}

.file-badge-new {
  background-color: rgba(63, 185, 80, 0.2);
  color: var(--color-success);
}

.file-badge-deleted {
  background-color: rgba(248, 81, 73, 0.2);
  color: var(--color-error);
}

.file-badge-renamed {
  background-color: rgba(210, 153, 34, 0.2);
  color: var(--color-warning);
}

.file-badge-modified {
  background-color: rgba(88, 166, 255, 0.2);
  color: var(--color-primary);
}

.diff-file-path {
  flex: 1;
  min-width: 0;
  color: var(--color-text);
  word-break: break-word;
}

.diff-file-stats {
  display: flex;
  gap: 0.5rem;
  font-size: 0.75rem;
}

.stat-additions {
  color: var(--color-success);
}

.stat-deletions {
  color: var(--color-error);
}

.diff-file-content {
  background-color: var(--color-background);
}

.diff-hunk {
  border-top: 1px solid var(--color-border);
}

.diff-hunk-header {
  padding: 0.5rem 0.75rem;
  background-color: rgba(88, 166, 255, 0.1);
  color: var(--color-text-soft);
  font-size: 0.75rem;
}

.diff-table-wrapper {
  overflow-x: auto;
}

.diff-table {
  min-width: 100%;
  border-collapse: collapse;
}

.diff-line {
  height: 1.5rem;
}

.diff-line-context {
  background-color: var(--color-background);
}

.diff-line-addition {
  background-color: rgba(63, 185, 80, 0.15);
}

.diff-line-deletion {
  background-color: rgba(248, 81, 73, 0.15);
}

.diff-line-num {
  width: 3rem;
  min-width: 3rem;
  padding: 0 0.5rem;
  text-align: right;
  color: var(--color-text-soft);
  background-color: var(--color-background-soft);
  border-right: 1px solid var(--color-border);
  user-select: none;
  vertical-align: top;
}

.diff-line-addition .diff-line-num {
  background-color: rgba(63, 185, 80, 0.2);
}

.diff-line-deletion .diff-line-num {
  background-color: rgba(248, 81, 73, 0.2);
}

.diff-line-prefix {
  width: 1.5rem;
  min-width: 1.5rem;
  text-align: center;
  user-select: none;
  vertical-align: top;
}

.diff-line-addition .diff-line-prefix {
  color: var(--color-success);
}

.diff-line-deletion .diff-line-prefix {
  color: var(--color-error);
}

.diff-line-content {
  padding: 0 0.5rem;
  white-space: pre;
  vertical-align: top;
}

/* Copy button - always visible, mobile-friendly */
.copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0.25rem;
  margin: 0 0.25rem;
  border: none;
  background-color: transparent;
  color: var(--color-text-soft);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease-out;
  flex-shrink: 0;
}

.copy-button:hover {
  color: var(--color-text);
  background-color: rgba(255, 255, 255, 0.05);
}

.copy-button:active {
  background-color: rgba(255, 255, 255, 0.1);
}

.copy-button.copied {
  color: var(--color-success);
  animation: copySuccess 0.3s ease-out;
}

.copy-button-icon {
  font-size: 1rem;
  display: inline-block;
}

@keyframes copySuccess {
  0% {
    transform: scale(0.8);
    opacity: 0.7;
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

/* Markdown preview toggle button - layout only (base styles in main.css) */
.preview-toggle {
  margin-left: auto;
}

/* Markdown preview container */
.markdown-preview-container {
  padding: 1rem;
  background-color: var(--color-background);
  border-top: 1px solid var(--color-border);
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
  font-size: 0.875rem;
}

/* Split view for modified files (before/after) */
.markdown-preview-split {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.markdown-preview-pane {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.markdown-preview-pane > :deep(.markdown-viewer) {
  padding: 1rem;
  max-height: 400px;
  overflow-y: auto;
}

/* Single pane for new/deleted files */
.markdown-preview-single {
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.markdown-preview-single > :deep(.markdown-viewer) {
  padding: 1rem;
  max-height: 400px;
  overflow-y: auto;
}

/* Labels for before/after panes */
.markdown-preview-label {
  padding: 0.5rem 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.markdown-preview-label-old {
  background-color: rgba(248, 81, 73, 0.1);
  color: var(--color-error);
  border-bottom: 1px solid rgba(248, 81, 73, 0.2);
}

.markdown-preview-label-new {
  background-color: rgba(63, 185, 80, 0.1);
  color: var(--color-success);
  border-bottom: 1px solid rgba(63, 185, 80, 0.2);
}

/* Responsive: stack panes on small screens */
@media (max-width: 768px) {
  .markdown-preview-split {
    grid-template-columns: 1fr;
  }
}
</style>
