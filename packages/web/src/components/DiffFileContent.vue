<template>
  <div class="diff-file-content">
    <!-- Image file preview -->
    <div
      v-if="isImageFile(file.displayPath)"
      class="image-preview-container"
    >
      <div
        v-if="imageLoading"
        class="image-loading"
      >
        <span class="loading-spinner" />
        Loading image...
      </div>
      <div
        v-else-if="imageError"
        class="image-error"
      >
        <span class="error-icon">&#x26A0;&#xFE0F;</span>
        {{ imageError }}
      </div>
      <div
        v-else-if="imageData"
        class="image-wrapper"
      >
        <img
          :src="`data:${imageData.mimeType};base64,${imageData.data}`"
          :alt="file.displayPath"
          class="diff-image"
        >
      </div>
      <div
        v-else-if="file.isDeleted"
        class="image-deleted"
      >
        <span class="deleted-icon">&#x1F5D1;&#xFE0F;</span>
        Image was deleted
      </div>
    </div>

    <!-- Non-image binary file notice -->
    <div
      v-else-if="isBinaryFile(file.displayPath)"
      class="binary-file-notice"
    >
      <div class="binary-icon">
        &#x1F512;
      </div>
      <div class="binary-message">
        <p>Binary file cannot be displayed as a diff</p>
      </div>
    </div>

    <!-- Markdown preview mode -->
    <div
      v-else-if="showPreview && isMarkdownFile(file.displayPath)"
      class="markdown-preview-container"
    >
      <div
        v-if="!file.isDeleted && !file.isNew"
        class="markdown-preview-split"
      >
        <div class="markdown-preview-pane">
          <div class="markdown-preview-label markdown-preview-label-old">
            Before
          </div>
          <MarkdownViewer :content="extractOldContentFromDiff(file)" />
        </div>
        <div class="markdown-preview-pane">
          <div class="markdown-preview-label markdown-preview-label-new">
            After
          </div>
          <MarkdownViewer :content="extractNewContentFromDiff(file)" />
        </div>
      </div>
      <div
        v-else-if="file.isNew"
        class="markdown-preview-single"
      >
        <div class="markdown-preview-label markdown-preview-label-new">
          New file
        </div>
        <MarkdownViewer :content="extractNewContentFromDiff(file)" />
      </div>
      <div
        v-else-if="file.isDeleted"
        class="markdown-preview-single"
      >
        <div class="markdown-preview-label markdown-preview-label-old">
          Deleted file
        </div>
        <MarkdownViewer :content="extractOldContentFromDiff(file)" />
      </div>
    </div>

    <!-- Standard diff view -->
    <template v-else>
      <div
        v-for="(hunk, hunkIndex) in file.hunks"
        :key="hunkIndex"
        class="diff-hunk"
      >
        <div class="diff-hunk-header">
          {{ hunk.header }}
        </div>
        <div class="diff-table-wrapper">
          <table class="diff-table">
            <tbody>
              <tr
                v-for="(line, lineIndex) in hunk.lines"
                :key="lineIndex"
                :class="['diff-line', `diff-line-${line.type}`]"
              >
                <td class="diff-line-num diff-line-num-old">
                  {{ line.oldLineNumber ?? '' }}
                </td>
                <td class="diff-line-num diff-line-num-new">
                  {{ line.newLineNumber ?? '' }}
                </td>
                <td class="diff-line-prefix">
                  {{ getLinePrefix(line.type) }}
                </td>
                <td class="diff-line-content">
                  {{ line.content }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import MarkdownViewer from './MarkdownViewer.vue';
import {
  isMarkdownFile,
  isImageFile,
  isBinaryFile,
  extractOldContentFromDiff,
  extractNewContentFromDiff,
} from '../utils/markdown.js';

defineProps({
  file: {
    type: Object,
    required: true,
  },
  showPreview: {
    type: Boolean,
    default: false,
  },
  imageData: {
    type: Object,
    default: null,
  },
  imageLoading: {
    type: Boolean,
    default: false,
  },
  imageError: {
    type: String,
    default: null,
  },
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

/* Binary file notice */
.binary-file-notice {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 2rem;
  background-color: var(--color-background-soft);
  border: 1px dashed var(--color-border);
  border-radius: var(--border-radius);
  text-align: center;
}

.binary-icon {
  font-size: 2rem;
  flex-shrink: 0;
}

.binary-message {
  flex: 1;
}

.binary-message p {
  margin: 0.25rem 0;
  color: var(--color-text-soft);
  font-family: var(--font-base);
  font-size: 0.9375rem;
}

.binary-message p:first-child {
  font-weight: 600;
  color: var(--color-text);
}

/* Image preview */
.image-preview-container {
  padding: 1rem;
  background-color: var(--color-background-soft);
  border-radius: var(--border-radius);
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 100px;
}

.image-loading,
.image-error,
.image-deleted {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-family: var(--font-base);
  font-size: 0.875rem;
}

.image-error {
  color: var(--color-error);
}

.image-deleted {
  color: var(--color-text-soft);
  font-style: italic;
}

.error-icon,
.deleted-icon {
  font-size: 1.25rem;
}

.image-wrapper {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}

.diff-image {
  max-width: 100%;
  max-height: 500px;
  height: auto;
  border-radius: var(--border-radius);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* Responsive image sizing */
@media (max-width: 768px) {
  .diff-image {
    max-height: 300px;
  }
}

@media (min-width: 1200px) {
  .diff-image {
    max-height: 600px;
  }
}
</style>
