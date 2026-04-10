<template>
  <div
    v-if="gitStatus?.isGitRepo"
    class="form-group"
  >
    <label class="form-label">Git Options</label>
    <div class="segmented-control">
      <button
        type="button"
        class="segment-btn"
        :class="{ 'segment-btn--active': modelValue === 'worktree' }"
        @click="$emit('update:modelValue', 'worktree')"
      >
        <span class="segment-label-full">Worktree</span>
        <span class="segment-label-short">WT</span>
      </button>
      <button
        type="button"
        class="segment-btn"
        :class="{ 'segment-btn--active': modelValue === 'branch' }"
        @click="$emit('update:modelValue', 'branch')"
      >
        Branch
      </button>
      <button
        type="button"
        class="segment-btn"
        :class="{ 'segment-btn--active': modelValue === '' }"
        @click="$emit('update:modelValue', '')"
      >
        Current
      </button>
    </div>

    <!-- Branch name input (shown for branch or worktree) -->
    <div
      v-if="modelValue"
      class="branch-input-row"
    >
      <label class="form-label form-label-small">Branch Name</label>
      <div class="quick-branch-input">
        <input
          :value="branchName"
          type="text"
          class="form-input"
          :placeholder="autoBranchName"
          @input="$emit('update:branchName', $event.target.value)"
          @focus="$emit('branchEdit')"
        >
        <button
          v-if="editingBranch"
          type="button"
          class="btn btn-small"
          @click="$emit('resetBranch')"
        >
          Reset
        </button>
      </div>
      <p class="form-help">
        Auto-generated from prompt
      </p>
    </div>

    <p
      v-if="modelValue === ''"
      class="current-branch-hint"
    >
      On: {{ gitStatus.currentBranch }}
    </p>
  </div>

  <div
    v-if="loadingGit"
    class="git-loading"
  >
    <span class="loading-spinner" />
    Loading git info...
  </div>
</template>

<script setup>
defineProps({
  gitStatus: {
    type: Object,
    default: null,
  },
  modelValue: {
    type: String,
    default: '',
  },
  branchName: {
    type: String,
    default: '',
  },
  autoBranchName: {
    type: String,
    default: '',
  },
  editingBranch: {
    type: Boolean,
    default: false,
  },
  loadingGit: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['update:modelValue', 'update:branchName', 'branchEdit', 'resetBranch']);
</script>

<style scoped>
.form-help {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.git-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--color-text-soft);
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

/* Segmented control (pill selector) */
.segmented-control {
  display: flex;
  background: var(--color-background-mute, var(--color-bg-soft, #2a2a3e));
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  padding: 0.1875rem;
  gap: 0.125rem;
}

.segment-btn {
  flex: 1;
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--color-text-soft);
  background: transparent;
  border: none;
  border-radius: 0.375rem;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
  white-space: nowrap;
}

.segment-btn:hover {
  color: var(--color-text);
}

.segment-btn--active {
  background-color: var(--color-primary, var(--color-accent, #22c55e));
  color: #fff;
}

.segment-btn--active:hover {
  color: #fff;
}

/* Show full label by default, hide short label */
.segment-label-short {
  display: none;
}

.branch-input-row {
  margin-top: 0.5rem;
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

.current-branch-hint {
  margin-top: 0.375rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

@media (max-width: 480px) {
  .segment-btn {
    padding: 0.375rem 0.5rem;
    font-size: 0.75rem;
  }

  /* On small screens, show abbreviated "WT" instead of "Worktree" */
  .segment-label-full {
    display: none;
  }
  .segment-label-short {
    display: inline;
  }
}
</style>
