<template>
  <div class="changes-tab">
    <div
      v-if="loading"
      class="loading-state"
    >
      <span class="loading-spinner" />
      Loading changes...
    </div>

    <div
      v-else-if="error"
      class="error-message"
    >
      {{ error }}
    </div>

    <template v-else>
      <!-- Toolbar: Show when there are changes OR a default branch exists -->
      <div
        v-if="hasChanges || defaultBranch"
        class="changes-toolbar"
      >
        <div class="mode-toggle">
          <button
            class="toggle-button"
            :class="{ active: compareMode === 'local' }"
            :disabled="loading"
            title="Show local changes (staged, unstaged, untracked)"
            @click="compareMode = 'local'"
          >
            Local Changes
          </button>
          <button
            v-if="defaultBranch"
            class="toggle-button"
            :class="{ active: compareMode === 'branch' }"
            :disabled="loading"
            :title="`Compare against ${defaultBranch}`"
            @click="compareMode = 'branch'"
          >
            {{ compareMode === 'branch' && loading ? '⟳' : '' }}
            Compare to {{ branchLabel }}
          </button>
        </div>
        <button
          v-if="hasChanges"
          class="btn-link"
          :disabled="loading"
          @click="toggleAllFiles"
        >
          {{ allExpanded ? 'Collapse All' : 'Expand All' }}
        </button>
      </div>

      <!-- Empty state: Show when no changes in current mode -->
      <div
        v-if="!hasChanges"
        class="empty-state"
      >
        <p v-if="compareMode === 'local'">
          No local git changes to show.
        </p>
        <p v-else>
          No differences from {{ branchLabel }}.
        </p>
      </div>

      <!-- Branch diff section (only in branch compare mode) -->
      <div
        v-if="compareMode === 'branch' && branchDiffFiles.length > 0"
        class="diff-section"
      >
        <h3>Changes vs {{ branchLabel }}</h3>
        <DiffViewer
          ref="branchDiffViewer"
          :files="branchDiffFiles"
          :external-expanded-state="getExpandedStateForSection('branch')"
          :default-expanded="false"
          :session-id="sessionId"
          @update:expanded-state="handleExpandedStateUpdate('branch', $event)"
        />
      </div>

      <!-- Local changes header (only show in branch mode when there are both branch and local changes) -->
      <div
        v-if="compareMode === 'branch' && branchDiffFiles.length > 0 && hasLocalChanges"
        class="local-changes-header"
      >
        <h3>Local Changes (uncommitted)</h3>
      </div>

      <!-- Diff sections: Only show when there are files -->
      <div
        v-if="stagedFiles.length > 0"
        class="diff-section"
      >
        <h3>Staged Changes</h3>
        <DiffViewer
          ref="stagedDiffViewer"
          :files="stagedFiles"
          :external-expanded-state="getExpandedStateForSection('staged')"
          :default-expanded="false"
          :session-id="sessionId"
          @update:expanded-state="handleExpandedStateUpdate('staged', $event)"
        />
      </div>

      <div
        v-if="unstagedFiles.length > 0"
        class="diff-section"
      >
        <h3>Unstaged Changes</h3>
        <DiffViewer
          ref="unstagedDiffViewer"
          :files="unstagedFiles"
          :external-expanded-state="getExpandedStateForSection('unstaged')"
          :default-expanded="false"
          :session-id="sessionId"
          @update:expanded-state="handleExpandedStateUpdate('unstaged', $event)"
        />
      </div>

      <div
        v-if="untrackedFiles.length > 0"
        class="diff-section"
      >
        <h3>Untracked Files</h3>
        <DiffViewer
          ref="untrackedDiffViewer"
          :files="untrackedFiles"
          :external-expanded-state="getExpandedStateForSection('untracked')"
          :default-expanded="false"
          :session-id="sessionId"
          @update:expanded-state="handleExpandedStateUpdate('untracked', $event)"
        />
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

const branchDiff = ref('');
const staged = ref('');
const unstaged = ref('');
const untracked = ref('');
const loading = ref(false);
const error = ref(null);
const compareMode = ref('local');
const defaultBranch = ref(null);

// Per-mode state tracking for expand/collapse
// Keys in expandedFiles are "section:filepath", e.g., "staged:src/api.js"
const modeState = ref({
  local: {
    hasBeenViewed: false,
    expandedFiles: {},
  },
  branch: {
    hasBeenViewed: false,
    expandedFiles: {},
  },
});

const branchDiffViewer = ref(null);
const stagedDiffViewer = ref(null);
const unstagedDiffViewer = ref(null);
const untrackedDiffViewer = ref(null);

const branchDiffFiles = computed(() => parseDiff(branchDiff.value));
const stagedFiles = computed(() => parseDiff(staged.value));
const unstagedFiles = computed(() => parseDiff(unstaged.value));
const untrackedFiles = computed(() => parseDiff(untracked.value));
const hasLocalChanges = computed(() => staged.value || unstaged.value || untracked.value);
const hasChanges = computed(() => {
  if (compareMode.value === 'branch') {
    return branchDiff.value || hasLocalChanges.value;
  }
  return hasLocalChanges.value;
});
const fileCount = computed(() => {
  if (compareMode.value === 'branch') {
    // In branch mode, count branch diff files + local changes
    return (
      branchDiffFiles.value.length +
      stagedFiles.value.length +
      unstagedFiles.value.length +
      untrackedFiles.value.length
    );
  }
  // In local mode, only count local changes
  return stagedFiles.value.length + unstagedFiles.value.length + untrackedFiles.value.length;
});
const branchLabel = computed(() => {
  if (!defaultBranch.value) return 'branch';
  // Extract branch name from 'origin/main' or 'origin/master'
  const parts = defaultBranch.value.split('/');
  return parts[parts.length - 1];
});

// Computed: allExpanded based on actual file states in current mode
const allExpanded = computed(() => {
  const currentState = modeState.value[compareMode.value];
  if (!currentState.hasBeenViewed) return false; // First view = all collapsed

  const expandedStates = Object.values(currentState.expandedFiles);
  if (expandedStates.length === 0) return false;

  return expandedStates.every((isExpanded) => isExpanded);
});

// Get expanded state for a specific section's files
function getExpandedStateForSection(section) {
  const currentMode = compareMode.value;
  const state = modeState.value[currentMode];
  const sectionState = {};

  // Filter expandedFiles for this section
  Object.entries(state.expandedFiles).forEach(([key, value]) => {
    if (key.startsWith(`${section}:`)) {
      const filePath = key.substring(section.length + 1);
      sectionState[filePath] = value;
    }
  });

  return sectionState;
}

// Update expanded state for a file
function updateFileExpandedState(mode, key, isExpanded) {
  modeState.value[mode].expandedFiles[key] = isExpanded;
}

// Handle state updates from DiffViewer
function handleExpandedStateUpdate(section, newState) {
  const currentMode = compareMode.value;
  Object.entries(newState).forEach(([filePath, isExpanded]) => {
    const key = `${section}:${filePath}`;
    modeState.value[currentMode].expandedFiles[key] = isExpanded;
  });
}

// Initialize state for files in a section (if not already initialized)
function initializeFilesState(mode, section, files) {
  const state = modeState.value[mode];
  files.forEach((file) => {
    const key = `${section}:${file.displayPath}`;
    if (state.expandedFiles[key] === undefined) {
      // Default to collapsed on first view
      state.expandedFiles[key] = false;
    }
  });
}

// Initialize mode state after fetching changes
function initializeModeState(mode) {
  const state = modeState.value[mode];
  if (!state.hasBeenViewed) {
    state.hasBeenViewed = true;
  }

  // Initialize files based on mode
  if (mode === 'branch') {
    initializeFilesState(mode, 'branch', branchDiffFiles.value);
  }
  initializeFilesState(mode, 'staged', stagedFiles.value);
  initializeFilesState(mode, 'unstaged', unstagedFiles.value);
  initializeFilesState(mode, 'untracked', untrackedFiles.value);
}

// Emit file count whenever it changes
watch(fileCount, (count) => emit('update:fileCount', count), { immediate: true });

function toggleAllFiles() {
  const targetState = !allExpanded.value;
  const currentMode = compareMode.value;

  // Update all entries in current mode's expandedFiles
  const state = modeState.value[currentMode];
  Object.keys(state.expandedFiles).forEach((key) => {
    state.expandedFiles[key] = targetState;
  });

  // Also call expand/collapse on viewers for immediate UI update
  if (targetState) {
    branchDiffViewer.value?.expandAll();
    stagedDiffViewer.value?.expandAll();
    unstagedDiffViewer.value?.expandAll();
    untrackedDiffViewer.value?.expandAll();
  } else {
    branchDiffViewer.value?.collapseAll();
    stagedDiffViewer.value?.collapseAll();
    unstagedDiffViewer.value?.collapseAll();
    untrackedDiffViewer.value?.collapseAll();
  }
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
    branchDiff.value = changes.branchDiff || '';
    staged.value = changes.staged || '';
    unstaged.value = changes.unstaged || '';
    untracked.value = changes.untracked || '';

    // Initialize mode state for the current mode after data is available
    initializeModeState(compareMode.value);
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
  branchDiff,
  staged,
  unstaged,
  untracked,
  loading,
  error,
  hasChanges,
  hasLocalChanges,
  branchDiffFiles,
  stagedFiles,
  unstagedFiles,
  untrackedFiles,
  fileCount,
  compareMode,
  defaultBranch,
  branchLabel,
  modeState,
  allExpanded,
  toggleAllFiles,
  updateFileExpandedState,
  getExpandedStateForSection,
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

.local-changes-header {
  margin-top: 1.5rem;
  margin-bottom: 0.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--color-border);
}

.local-changes-header h3 {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-soft);
  margin: 0;
}
</style>
