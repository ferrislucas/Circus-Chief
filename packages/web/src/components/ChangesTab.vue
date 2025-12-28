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
      <div class="changes-toolbar">
        <div class="mode-toggle">
          <button
            class="toggle-button"
            :class="{ active: compareMode === 'local' }"
            @click="compareMode = 'local'"
            :disabled="loading"
            title="Show local changes (staged, unstaged, untracked)"
          >
            Local Changes
          </button>
          <button
            v-if="defaultBranch"
            class="toggle-button"
            :class="{ active: compareMode === 'branch' }"
            @click="compareMode = 'branch'"
            :disabled="loading"
            :title="`Compare against ${defaultBranch}`"
          >
            {{ compareMode === 'branch' && loading ? '⟳' : '' }}
            Compare to {{ branchLabel }}
          </button>
        </div>
        <button class="btn-link" @click="toggleAllFiles" :disabled="loading">
          {{ allExpanded ? 'Collapse All' : 'Expand All' }}
        </button>
      </div>

      <div v-if="stagedFiles.length > 0" class="diff-section">
        <h3>Staged Changes</h3>
        <DiffViewer ref="stagedDiffViewer" :files="stagedFiles" />
      </div>

      <div v-if="unstagedFiles.length > 0" class="diff-section">
        <h3>Unstaged Changes</h3>
        <DiffViewer ref="unstagedDiffViewer" :files="unstagedFiles" />
      </div>

      <div v-if="untrackedFiles.length > 0" class="diff-section">
        <h3>Untracked Files</h3>
        <DiffViewer ref="untrackedDiffViewer" :files="untrackedFiles" />
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { api } from '../api/ApiClient.js';
import { parseDiff } from '../utils/diffParser.js';
import DiffViewer from './DiffViewer.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const emit = defineEmits(['update:fileCount']);

const staged = ref('');
const unstaged = ref('');
const untracked = ref('');
const loading = ref(false);
const error = ref(null);
const allExpanded = ref(true);
const compareMode = ref('local');
const defaultBranch = ref(null);

const stagedDiffViewer = ref(null);
const unstagedDiffViewer = ref(null);
const untrackedDiffViewer = ref(null);

const stagedFiles = computed(() => parseDiff(staged.value));
const unstagedFiles = computed(() => parseDiff(unstaged.value));
const untrackedFiles = computed(() => parseDiff(untracked.value));
const hasChanges = computed(() => staged.value || unstaged.value || untracked.value);
const fileCount = computed(
  () => stagedFiles.value.length + unstagedFiles.value.length + untrackedFiles.value.length
);
const branchLabel = computed(() => {
  if (!defaultBranch.value) return 'branch';
  // Extract branch name from 'origin/main' or 'origin/master'
  const parts = defaultBranch.value.split('/');
  return parts[parts.length - 1];
});

// Emit file count whenever it changes
watch(fileCount, (count) => emit('update:fileCount', count), { immediate: true });

function toggleAllFiles() {
  if (allExpanded.value) {
    stagedDiffViewer.value?.collapseAll();
    unstagedDiffViewer.value?.collapseAll();
    untrackedDiffViewer.value?.collapseAll();
  } else {
    stagedDiffViewer.value?.expandAll();
    unstagedDiffViewer.value?.expandAll();
    untrackedDiffViewer.value?.expandAll();
  }
  allExpanded.value = !allExpanded.value;
}

async function fetchChanges() {
  loading.value = true;
  error.value = null;
  try {
    const changes = await api.getSessionChanges(
      props.sessionId,
      compareMode.value,
      compareMode.value === 'branch' ? defaultBranch.value : null
    );
    staged.value = changes.staged || '';
    unstaged.value = changes.unstaged || '';
    untracked.value = changes.untracked || '';
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

// Fetch the default branch for comparison
async function fetchDefaultBranch() {
  try {
    const response = await api.getSessionDefaultBranch(props.sessionId);
    defaultBranch.value = response.branch;
  } catch (err) {
    // Silently fail - compare mode is optional
    console.warn('Failed to fetch default branch:', err.message);
  }
}

// Watch for compareMode changes and refetch
watch(compareMode, () => {
  fetchChanges();
});

onMounted(() => {
  // Fetch both default branch and initial changes
  Promise.all([fetchDefaultBranch(), fetchChanges()]);
});

// Expose for testing
defineExpose({
  fetchChanges,
  staged,
  unstaged,
  untracked,
  loading,
  error,
  hasChanges,
  stagedFiles,
  unstagedFiles,
  untrackedFiles,
  fileCount,
  compareMode,
  defaultBranch,
  branchLabel,
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

.changes-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.mode-toggle {
  display: flex;
  gap: 0.25rem;
  background-color: var(--color-background-soft);
  border-radius: 4px;
  padding: 0.25rem;
}

.toggle-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.75rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid transparent;
  background-color: transparent;
  color: var(--color-text-soft);
  cursor: pointer;
  font-size: 0.875rem;
  border-radius: 3px;
  transition: all 0.2s ease-out;
  white-space: nowrap;
  flex-shrink: 0;
}

.toggle-button:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.05);
  color: var(--color-text);
}

.toggle-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.toggle-button.active {
  background-color: var(--color-primary);
  color: var(--color-background);
  border-color: var(--color-primary);
  font-weight: 600;
}

.toggle-button.active:hover:not(:disabled) {
  background-color: var(--color-primary);
  filter: brightness(1.1);
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0.25rem 0.5rem;
  min-height: 2.75rem;
  display: flex;
  align-items: center;
}

.btn-link:hover:not(:disabled) {
  text-decoration: underline;
}

.btn-link:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.diff-section {
  margin-bottom: 1.5rem;
}

.diff-section h3 {
  font-size: 0.875rem;
  margin-bottom: 0.5rem;
  color: var(--color-text-soft);
}
</style>
