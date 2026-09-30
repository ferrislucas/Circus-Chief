<template>
  <div class="container">
    <div class="page-header">
      <div>
        <h2>Muse Environment Diagnostics</h2>
        <p class="page-description">
          Whether the Muse agent shell resolves binaries, identity, and credentials
          the same way your terminal does. Only pass/fail status and remediation
          hints are shown — never secret values.
        </p>
      </div>
      <button
        class="btn btn-secondary"
        data-testid="muse-diag-recheck"
        :disabled="loading"
        @click="recheck"
      >
        Re-check
      </button>
    </div>

    <div
      v-if="loading"
      class="skeleton-list"
    >
      <div
        v-for="i in 3"
        :key="i"
        class="skeleton card"
        style="height: 80px"
      />
    </div>

    <div
      v-else-if="error"
      class="error-message"
    >
      {{ error }}
    </div>

    <div v-else>
      <div
        v-if="probe && !probe.ok"
        class="warning-message"
      >
        Login-shell probe fell back to the server snapshot env.
        {{ probe.reason }}
      </div>

      <div class="signal-list">
        <div
          v-for="signal in signals"
          :key="signal.signal"
          class="signal-card card"
          :data-testid="`muse-diag-signal-${signal.signal}`"
        >
          <div class="signal-header">
            <strong>{{ signal.signal }}</strong>
            <span
              class="status-badge"
              :class="signal.ok ? 'status-pass' : 'status-fail'"
            >
              {{ signal.ok ? 'Pass' : 'Fail' }}
            </span>
          </div>
          <div class="signal-origin">
            Source: {{ signal.origin }}
          </div>
          <div
            v-if="!signal.ok && signal.remediation"
            class="signal-remediation"
          >
            {{ signal.remediation }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

const loading = ref(true);
const error = ref(null);
const signals = ref([]);
const probe = ref(null);

async function fetchDiagnostics(reprobe) {
  loading.value = true;
  error.value = null;
  try {
    const report = await api.getMuseEnvDiagnostics(reprobe);
    signals.value = Array.isArray(report?.signals) ? report.signals : [];
    probe.value = report?.probe || null;
  } catch (err) {
    error.value = err?.message || 'Failed to load Muse environment diagnostics.';
  } finally {
    loading.value = false;
  }
}

function recheck() {
  fetchDiagnostics(true);
}

onMounted(() => fetchDiagnostics(false));
</script>

<style scoped>
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.page-header h2 {
  margin: 0 0 0.5rem 0;
}

.signal-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.signal-card {
  padding: 0.9rem 1rem;
}

.signal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.status-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.15rem 0.6rem;
  border-radius: 9999px;
}

.status-pass {
  color: var(--color-success, #34d399);
  background: rgba(52, 211, 153, 0.12);
}

.status-fail {
  color: var(--color-error, #f87171);
  background: rgba(248, 113, 113, 0.12);
}

.signal-origin {
  color: var(--color-text-secondary, #9ca3af);
  font-size: 0.85rem;
  margin-top: 0.35rem;
}

.signal-remediation {
  margin-top: 0.5rem;
  font-size: 0.9rem;
}

.warning-message {
  margin-bottom: 1rem;
}
</style>
