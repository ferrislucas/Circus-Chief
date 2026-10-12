<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-gray-900">
    <form
      class="w-full max-w-sm rounded-lg bg-gray-800 p-6 shadow-xl"
      @submit.prevent="submit"
    >
      <h1 class="text-lg font-semibold text-gray-100">
        Server requires authentication
      </h1>
      <p class="mt-1 text-sm text-gray-400">
        This server was started with <code class="text-gray-200">--auth</code>.
        Enter your credentials to continue.
      </p>
      <label class="mt-4 block text-sm text-gray-400">
        Username
        <input
          v-model="username"
          type="text"
          autocomplete="username"
          class="mt-1 w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
        >
      </label>
      <label class="mt-3 block text-sm text-gray-400">
        Password
        <input
          v-model="password"
          type="password"
          autocomplete="current-password"
          class="mt-1 w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-gray-100"
        >
      </label>
      <p
        v-if="error"
        class="mt-3 text-sm text-red-400"
      >
        {{ error }}
      </p>
      <button
        type="submit"
        :disabled="busy || !username || !password"
        class="mt-4 w-full rounded bg-cyan-600 px-3 py-2 font-medium text-white disabled:opacity-50"
      >
        {{ busy ? 'Verifying…' : 'Log in' }}
      </button>
    </form>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { login } from '../api/auth.js';
import { api } from '../api/index.js';

const username = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  busy.value = true;
  error.value = '';
  try {
    // Verification doubles as the post-login retry: the same challenged
    // request is re-issued once, now carrying the stored Basic header.
    await login(username.value, password.value, () => api.getProjects());
    password.value = '';
  } catch {
    error.value = 'Invalid username or password.';
  } finally {
    busy.value = false;
  }
}
</script>
