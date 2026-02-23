<template>
  <!-- Git Options -->
  <div v-if="gitStatus?.isGitRepo" class="form-group">
    <label class="form-label">Git Options</label>
    <div class="quick-git-options">
      <label class="radio-option">
        <input type="radio" :value="'worktree'" :checked="quickGitMode === 'worktree'" @change="$emit('update:quickGitMode', 'worktree')" />
        <span class="radio-label">Create isolated worktree</span>
        <span class="radio-help">Separate working directory for this session</span>
      </label>
      <label class="radio-option">
        <input type="radio" :value="'branch'" :checked="quickGitMode === 'branch'" @change="$emit('update:quickGitMode', 'branch')" />
        <span class="radio-label">Create new branch</span>
        <span class="radio-help">Work in the project directory</span>
      </label>
      <label class="radio-option">
        <input type="radio" :value="''" :checked="quickGitMode === ''" @change="$emit('update:quickGitMode', '')" />
        <span class="radio-label">Use current branch</span>
        <span class="radio-help">{{ gitStatus.currentBranch }}</span>
      </label>
    </div>

    <!-- Branch name input (shown for branch or worktree) -->
    <div v-if="quickGitMode" class="quick-branch-section">
      <label class="form-label form-label-small">Branch Name</label>
      <div class="quick-branch-input">
        <input
          :value="quickWorktreeBranch"
          type="text"
          class="form-input"
          :placeholder="autoBranchName"
          @input="$emit('update:quickWorktreeBranch', $event.target.value)"
          @focus="$emit('branchEdit')"
        />
        <button
          v-if="editingBranch"
          type="button"
          class="btn btn-small"
          @click="$emit('resetBranch')"
        >
          Reset
        </button>
      </div>
      <p class="form-help">Auto-generated from session name/prompt</p>
    </div>

  </div>

  <div v-if="loadingGit" class="git-loading">
    <span class="loading-spinner"></span>
    Loading git info...
  </div>
</template>

<script setup>
defineProps({
  gitStatus: { type: Object, default: null },
  quickGitMode: { type: String, default: '' },
  quickWorktreeBranch: { type: String, default: '' },
  autoBranchName: { type: String, default: '' },
  editingBranch: { type: Boolean, default: false },
  loadingGit: { type: Boolean, default: false },
});

defineEmits([
  'update:quickGitMode',
  'update:quickWorktreeBranch',
  'branchEdit',
  'resetBranch',
]);
</script>

<style scoped>
.git-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

/* Quick git options */
.quick-git-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.radio-option {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  cursor: pointer;
  transition: border-color 0.15s, background-color 0.15s;
}

.radio-option:hover {
  border-color: var(--color-border-hover);
  background-color: var(--color-bg-hover);
}

.radio-option:has(input:checked) {
  border-color: var(--color-accent);
  background-color: var(--color-accent-bg);
}

.radio-option input[type="radio"] {
  margin-top: 0.125rem;
}

.radio-label {
  font-weight: 500;
  color: var(--color-text);
}

.radio-help {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.quick-branch-section {
  margin-top: 1rem;
  padding: 1rem;
  background-color: var(--color-bg-soft);
  border-radius: 0.375rem;
}

.form-label-small {
  font-size: 0.75rem;
  margin-bottom: 0.25rem;
}

.quick-branch-input {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.quick-branch-input input {
  flex: 1;
}

.btn-small {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

.form-help {
  margin: 0.5rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

/* Mobile responsive styles */
@media (max-width: 480px) {
  .radio-option {
    flex-wrap: wrap;
    padding: 0.5rem;
  }

  .radio-help {
    width: 100%;
    margin-left: 1.5rem;
    margin-top: 0.25rem;
  }

  .quick-branch-section {
    padding: 0.75rem;
  }
}
</style>
