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
        <button class="btn-link" @click="toggleAllFiles">
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
    const changes = await api.getSessionChanges(props.sessionId);
    staged.value = changes.staged || '';
    unstaged.value = changes.unstaged || '';
    untracked.value = changes.untracked || '';
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  fetchChanges();
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
  justify-content: flex-end;
  margin-bottom: 0.75rem;
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.875rem;
  padding: 0.25rem 0.5rem;
}

.btn-link:hover {
  text-decoration: underline;
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
