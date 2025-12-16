<template>
  <div class="changes-tab">
    <div v-if="loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading changes...
    </div>

    <div v-else-if="error" class="error-message">
      {{ error }}
    </div>

    <div v-else-if="!hasChanges" class="empty-state">
      <p>No git changes to show.</p>
    </div>

    <template v-else>
      <div v-if="staged" class="diff-section">
        <h3>Staged Changes</h3>
        <div v-for="file in parsedStaged" :key="'staged-' + file.path" class="file-diff">
          <div class="file-header">
            <span class="file-path">{{ file.path }}</span>
            <button
              v-if="file.isMarkdown"
              class="preview-toggle"
              @click="togglePreview('staged', file.path)"
            >
              {{ previewStates['staged-' + file.path] ? 'Show Diff' : 'Preview' }}
            </button>
          </div>
          <div v-if="previewStates['staged-' + file.path]" class="markdown-preview">
            <div v-if="previewLoading['staged-' + file.path]" class="preview-loading">
              Loading preview...
            </div>
            <div v-else-if="previewErrors['staged-' + file.path]" class="preview-error">
              {{ previewErrors['staged-' + file.path] }}
            </div>
            <MdPreview
              v-else
              :model-value="previewContent['staged-' + file.path] || ''"
              theme="dark"
              preview-theme="github"
              :show-code-row-number="true"
            />
          </div>
          <pre v-else class="diff-content">{{ file.diff }}</pre>
        </div>
      </div>

      <div v-if="unstaged" class="diff-section">
        <h3>Unstaged Changes</h3>
        <div v-for="file in parsedUnstaged" :key="'unstaged-' + file.path" class="file-diff">
          <div class="file-header">
            <span class="file-path">{{ file.path }}</span>
            <button
              v-if="file.isMarkdown"
              class="preview-toggle"
              @click="togglePreview('unstaged', file.path)"
            >
              {{ previewStates['unstaged-' + file.path] ? 'Show Diff' : 'Preview' }}
            </button>
          </div>
          <div v-if="previewStates['unstaged-' + file.path]" class="markdown-preview">
            <div v-if="previewLoading['unstaged-' + file.path]" class="preview-loading">
              Loading preview...
            </div>
            <div v-else-if="previewErrors['unstaged-' + file.path]" class="preview-error">
              {{ previewErrors['unstaged-' + file.path] }}
            </div>
            <MdPreview
              v-else
              :model-value="previewContent['unstaged-' + file.path] || ''"
              theme="dark"
              preview-theme="github"
              :show-code-row-number="true"
            />
          </div>
          <pre v-else class="diff-content">{{ file.diff }}</pre>
        </div>
      </div>

      <div v-if="untracked.length > 0" class="diff-section">
        <h3>Untracked Files</h3>
        <div v-for="file in untracked" :key="file" class="file-diff">
          <div class="file-header">
            <span class="file-path untracked-file">{{ file }}</span>
            <button
              v-if="isMarkdownFile(file)"
              class="preview-toggle"
              @click="togglePreview('untracked', file)"
            >
              {{ previewStates['untracked-' + file] ? 'Show Path' : 'Preview' }}
            </button>
          </div>
          <div v-if="previewStates['untracked-' + file]" class="markdown-preview">
            <div v-if="previewLoading['untracked-' + file]" class="preview-loading">
              Loading preview...
            </div>
            <div v-else-if="previewErrors['untracked-' + file]" class="preview-error">
              {{ previewErrors['untracked-' + file] }}
            </div>
            <MdPreview
              v-else
              :model-value="previewContent['untracked-' + file] || ''"
              theme="dark"
              preview-theme="github"
              :show-code-row-number="true"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue';
import { MdPreview } from 'md-editor-v3';
import 'md-editor-v3/lib/preview.css';
import { api } from '../api/ApiClient.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const staged = ref('');
const unstaged = ref('');
const untracked = ref([]);
const loading = ref(false);
const error = ref(null);

// Preview state management
const previewStates = reactive({});
const previewContent = reactive({});
const previewLoading = reactive({});
const previewErrors = reactive({});

const hasChanges = computed(() => staged.value || unstaged.value || untracked.value.length > 0);

function isMarkdownFile(path) {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function parseDiff(diffText) {
  if (!diffText) return [];

  const files = [];
  const diffParts = diffText.split(/(?=^diff --git)/m);

  for (const part of diffParts) {
    if (!part.trim()) continue;

    const match = part.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
    if (match) {
      const path = match[2];
      files.push({
        path,
        diff: part.trim(),
        isMarkdown: isMarkdownFile(path),
      });
    }
  }

  return files;
}

const parsedStaged = computed(() => parseDiff(staged.value));
const parsedUnstaged = computed(() => parseDiff(unstaged.value));

async function togglePreview(section, path) {
  const key = `${section}-${path}`;

  if (previewStates[key]) {
    previewStates[key] = false;
    return;
  }

  previewStates[key] = true;

  // Don't refetch if we already have content
  if (previewContent[key]) return;

  previewLoading[key] = true;
  previewErrors[key] = null;

  try {
    const result = await api.getSessionFile(props.sessionId, path);
    previewContent[key] = result.content;
  } catch (err) {
    previewErrors[key] = err.message;
  } finally {
    previewLoading[key] = false;
  }
}

async function fetchChanges() {
  loading.value = true;
  error.value = null;
  try {
    const changes = await api.getSessionChanges(props.sessionId);
    staged.value = changes.staged || '';
    unstaged.value = changes.unstaged || '';
    untracked.value = changes.untracked || [];
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  fetchChanges();
});
</script>

<style scoped>
.changes-tab {
  padding: 1rem 0;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
}

.error-message {
  color: var(--color-error);
  padding: 1rem;
  background-color: rgba(248, 81, 73, 0.1);
  border-radius: var(--border-radius);
}

.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-soft);
}

.diff-section {
  margin-bottom: 1.5rem;
}

.diff-section h3 {
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
  color: var(--color-text-soft);
}

.file-diff {
  margin-bottom: 1rem;
  border: 1px solid var(--color-border, #374151);
  border-radius: var(--border-radius, 0.375rem);
  overflow: hidden;
}

.file-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.75rem;
  background-color: var(--color-bg-secondary, #1f2937);
  border-bottom: 1px solid var(--color-border, #374151);
}

.file-path {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--color-text, #e5e7eb);
}

.untracked-file::before {
  content: '+ ';
  color: var(--color-success, #22c55e);
}

.preview-toggle {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  background-color: var(--color-bg-tertiary, #374151);
  color: var(--color-accent, #22d3ee);
  border: 1px solid var(--color-accent, #22d3ee);
  border-radius: 0.25rem;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.preview-toggle:hover {
  background-color: var(--color-accent, #22d3ee);
  color: var(--color-bg, #111827);
}

.diff-content {
  font-size: 0.75rem;
  max-height: 300px;
  overflow: auto;
  margin: 0;
  padding: 0.75rem;
  background-color: var(--color-bg, #111827);
}

.markdown-preview {
  padding: 1rem;
  background-color: var(--color-bg, #111827);
  max-height: 500px;
  overflow: auto;
}

.preview-loading,
.preview-error {
  padding: 1rem;
  text-align: center;
  font-size: 0.875rem;
}

.preview-loading {
  color: var(--color-text-soft, #9ca3af);
}

.preview-error {
  color: var(--color-error, #f87171);
}

/* Override md-editor-v3 dark theme styles */
:deep(.md-editor-preview-wrapper) {
  background-color: transparent !important;
}

:deep(.md-editor-preview) {
  color: var(--color-text, #e5e7eb) !important;
  background-color: transparent !important;
}

:deep(.md-editor-preview h1),
:deep(.md-editor-preview h2),
:deep(.md-editor-preview h3),
:deep(.md-editor-preview h4),
:deep(.md-editor-preview h5),
:deep(.md-editor-preview h6) {
  color: var(--color-text, #e5e7eb) !important;
  border-bottom-color: var(--color-border, #374151) !important;
}

:deep(.md-editor-preview code) {
  background-color: var(--color-bg-secondary, #1f2937) !important;
  color: var(--color-accent, #22d3ee) !important;
}

:deep(.md-editor-preview pre) {
  background-color: var(--color-bg-secondary, #1f2937) !important;
}

:deep(.md-editor-preview blockquote) {
  border-left-color: var(--color-accent, #22d3ee) !important;
  color: var(--color-text-soft, #9ca3af) !important;
}

:deep(.md-editor-preview a) {
  color: var(--color-accent, #22d3ee) !important;
}

:deep(.md-editor-preview table th),
:deep(.md-editor-preview table td) {
  border-color: var(--color-border, #374151) !important;
}

:deep(.md-editor-preview table tr:nth-child(2n)) {
  background-color: var(--color-bg-secondary, #1f2937) !important;
}
</style>
