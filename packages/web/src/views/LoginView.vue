<template>
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <h1 class="login-title">
          Circus Chief
        </h1>
        <p class="login-subtitle">
          Sign in to continue
        </p>
      </div>

      <form @submit.prevent="handleSubmit">
        <div class="form-group">
          <label
            class="form-label"
            for="username"
          >Username</label>
          <input
            id="username"
            ref="usernameInput"
            v-model="username"
            type="text"
            class="form-input"
            autocomplete="username"
            required
            :disabled="loading"
          >
        </div>

        <div class="form-group">
          <label
            class="form-label"
            for="password"
          >Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            class="form-input"
            autocomplete="current-password"
            required
            :disabled="loading"
          >
        </div>

        <div
          v-if="error"
          class="error-message"
        >
          {{ error }}
        </div>

        <button
          type="submit"
          class="btn btn-primary login-btn"
          :disabled="loading"
        >
          <span
            v-if="loading"
            class="loading-spinner"
          />
          {{ loading ? 'Signing in...' : 'Sign in' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');
const loading = ref(false);
const error = ref(null);
const usernameInput = ref(null);

onMounted(() => {
  usernameInput.value?.focus();
});

async function handleSubmit() {
  loading.value = true;
  error.value = null;

  try {
    await authStore.login(username.value, password.value);
    router.push('/');
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 1rem;
}

.login-card {
  width: 100%;
  max-width: 380px;
  padding: 2rem;
  background: var(--color-bg-secondary, #1f2937);
  border-radius: 0.75rem;
  border: 1px solid var(--color-border, #374151);
}

.login-header {
  text-align: center;
  margin-bottom: 2rem;
}

.login-title {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--color-text, #f3f4f6);
  margin: 0;
}

.login-subtitle {
  color: var(--color-text-muted, #9ca3af);
  margin-top: 0.5rem;
  font-size: 0.875rem;
}

.form-group {
  margin-bottom: 1rem;
}

.form-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-text-muted, #9ca3af);
  margin-bottom: 0.375rem;
}

.form-input {
  display: block;
  width: 100%;
  padding: 0.625rem 0.75rem;
  background: var(--color-bg-primary, #111827);
  border: 1px solid var(--color-border, #374151);
  border-radius: 0.375rem;
  color: var(--color-text, #f3f4f6);
  font-size: 0.875rem;
  line-height: 1.25rem;
  box-sizing: border-box;
}

.form-input:focus {
  outline: none;
  border-color: var(--color-primary, #06b6d4);
  box-shadow: 0 0 0 1px var(--color-primary, #06b6d4);
}

.form-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-message {
  color: var(--color-error, #f87171);
  font-size: 0.875rem;
  margin-bottom: 1rem;
  padding: 0.5rem 0.75rem;
  background: rgba(248, 113, 113, 0.1);
  border-radius: 0.375rem;
}

.login-btn {
  width: 100%;
  margin-top: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.loading-spinner {
  width: 1rem;
  height: 1rem;
  border: 2px solid transparent;
  border-top-color: currentColor;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
