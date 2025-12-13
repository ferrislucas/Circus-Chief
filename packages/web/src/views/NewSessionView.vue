<template>
  <div class="container">
    <router-link :to="`/projects/${route.params.id}/sessions`" class="back-link">
      &larr; Sessions
    </router-link>
    <h1>New Session</h1>

    <form @submit.prevent="handleSubmit" class="form card">
      <div class="form-group">
        <label class="form-label" for="name">Session Name (optional)</label>
        <input
          id="name"
          v-model="name"
          type="text"
          class="form-input"
          placeholder="My Session"
        />
      </div>

      <div class="form-group">
        <label class="form-label" for="prompt">Initial Prompt</label>
        <textarea
          id="prompt"
          v-model="prompt"
          class="form-input form-textarea"
          placeholder="What would you like Claude to help you with?"
          rows="5"
          required
        ></textarea>
      </div>

      <div class="form-group">
        <label class="form-label" for="mode">Mode</label>
        <select id="mode" v-model="mode" class="form-input">
          <option value="standard">Standard</option>
          <option value="plan">Plan</option>
          <option value="yolo">YOLO</option>
        </select>
      </div>

      <div v-if="gitStatus" class="form-group">
        <label class="form-label" for="gitBranch">Git Branch (optional)</label>
        <select id="gitBranch" v-model="gitBranch" class="form-input">
          <option value="">Use current branch</option>
          <option v-for="branch in gitStatus.branches" :key="branch.name" :value="branch.name">
            {{ branch.name }}
          </option>
        </select>
        <p v-if="gitStatus.currentBranch" class="form-help">
          Current branch: {{ gitStatus.currentBranch }}
        </p>
      </div>

      <div v-if="loadingGit" class="git-loading">
        <span class="loading-spinner"></span>
        Loading git info...
      </div>

      <div v-if="error" class="error-message">{{ error }}</div>

      <div class="form-actions">
        <router-link :to="`/projects/${route.params.id}/sessions`" class="btn">Cancel</router-link>
        <button type="submit" class="btn btn-primary" :disabled="loading">
          <span v-if="loading" class="loading-spinner"></span>
          Start Session
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { api } from '../composables/useApi.js';

const route = useRoute();
const router = useRouter();
const sessionsStore = useSessionsStore();
const uiStore = useUiStore();

const name = ref('');
const prompt = ref('');
const mode = ref('standard');
const gitBranch = ref('');
const gitStatus = ref(null);
const loading = ref(false);
const loadingGit = ref(false);
const error = ref(null);

onMounted(async () => {
  loadingGit.value = true;
  try {
    gitStatus.value = await api.getGitStatus(route.params.id);
  } catch {
    // Git status is optional
  } finally {
    loadingGit.value = false;
  }
});

async function handleSubmit() {
  loading.value = true;
  error.value = null;

  try {
    const session = await sessionsStore.createSession(route.params.id, {
      name: name.value || undefined,
      prompt: prompt.value,
      mode: mode.value,
      gitBranch: gitBranch.value || undefined,
    });
    uiStore.success('Session started');
    router.push(`/sessions/${session.id}`);
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.back-link {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  display: inline-block;
  margin-bottom: 0.5rem;
}

h1 {
  margin-bottom: 2rem;
}

.form {
  max-width: 600px;
}

.form-help {
  margin: 0.5rem 0 0;
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

.form-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.error-message {
  color: var(--color-error);
  margin-bottom: 1rem;
}
</style>
