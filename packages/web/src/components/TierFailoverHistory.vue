<template>
  <aside
    v-if="failovers.length"
    class="tier-failover-history"
    aria-label="Model tier failover history"
    data-testid="tier-failover-history"
  >
    <div class="tier-failover-history__title">
      Model tier failover{{ failovers.length === 1 ? '' : 's' }}
    </div>
    <ol class="tier-failover-history__list">
      <li
        v-for="failover in failovers"
        :key="failover.id"
        class="tier-failover-history__entry"
      >
        <span class="tier-failover-history__route">
          {{ modelLabel(failover.metadata?.fromProviderId, failover.metadata?.fromModel) }}
          <span aria-hidden="true">→</span>
          {{ modelLabel(failover.metadata?.toProviderId, failover.metadata?.toModel) }}
        </span>
        <span class="tier-failover-history__tier">
          Tier: {{ failover.metadata?.tierName || 'Model tier' }}
        </span>
        <span class="tier-failover-history__reason">
          {{ failover.metadata?.reason || failover.errorMessage || 'No failure reason recorded' }}
        </span>
      </li>
    </ol>
  </aside>
</template>

<script setup>
import { ref, watch } from 'vue';
import { api } from '../composables/useApi.js';

const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
});

const failovers = ref([]);
let requestVersion = 0;

function modelLabel(providerId, modelId) {
  if (providerId && modelId) return `${providerId}/${modelId}`;
  return modelId || providerId || 'Unknown model';
}

async function loadFailovers() {
  const version = ++requestVersion;
  if (!props.sessionId) {
    failovers.value = [];
    return;
  }

  try {
    const calls = await api.getSessionAgentCalls(props.sessionId, { limit: 100 });
    if (version !== requestVersion) return;
    failovers.value = calls.filter(call => call.callType === 'tierFailover');
  } catch (error) {
    // Failover history supplements the session view; do not hide the session if
    // an older server cannot provide its persisted call log.
    if (version !== requestVersion) return;
    console.debug('Failed to load model tier failover history:', error);
    failovers.value = [];
  }
}

watch(() => props.sessionId, loadFailovers, { immediate: true });
</script>

<style scoped>
.tier-failover-history {
  margin: 0 0.5rem 0.75rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid color-mix(in srgb, #f59e0b 45%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, #f59e0b 10%, transparent);
  color: var(--color-text, #e5e5e5);
}

.tier-failover-history__title {
  color: #fbbf24;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.tier-failover-history__list {
  display: grid;
  gap: 0.35rem;
  margin: 0.45rem 0 0;
  padding: 0;
  list-style: none;
}

.tier-failover-history__entry {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
}

.tier-failover-history__route {
  color: var(--color-text, #e5e5e5);
  font-size: 0.9rem;
  font-weight: 600;
}

.tier-failover-history__route > span {
  margin: 0 0.25rem;
  color: #fbbf24;
}

.tier-failover-history__reason {
  color: var(--color-text-soft, #a3a3a3);
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.tier-failover-history__tier {
  color: var(--color-text-soft, #a3a3a3);
  font-size: 0.8rem;
}
</style>
