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
        <pre class="diff-content">{{ staged }}</pre>
      </div>

      <div v-if="unstaged" class="diff-section">
        <h3>Unstaged Changes</h3>
        <pre class="diff-content">{{ unstaged }}</pre>
      </div>

      <div v-if="untracked.length > 0" class="diff-section">
        <h3>Untracked Files</h3>
        <ul class="untracked-list">
          <li v-for="file in untracked" :key="file" class="untracked-file">
            {{ file }}
          </li>
        </ul>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../api/ApiClient.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const staged = ref('');
const unstaged = ref('');
const untracked = ref([]);
const loading = ref(false);
const error = ref(null);

const hasChanges = computed(() => staged.value || unstaged.value || untracked.value.length > 0);

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

.diff-content {
  font-size: 0.75rem;
  max-height: 300px;
  overflow: auto;
}

.untracked-list {
  list-style: none;
  padding: 0;
  margin: 0;
  font-family: monospace;
  font-size: 0.75rem;
}

.untracked-file {
  padding: 0.25rem 0.5rem;
  color: var(--color-success, #22c55e);
}

.untracked-file::before {
  content: '+ ';
  color: var(--color-success, #22c55e);
}
</style>
