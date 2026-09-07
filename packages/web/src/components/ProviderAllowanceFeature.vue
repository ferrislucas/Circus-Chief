<template>
  <ProviderAllowanceIndicators v-if="enabled" />
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../composables/useApi.js';
import ProviderAllowanceIndicators from './ProviderAllowanceIndicators.vue';

// Default false prevents fetches, WebSocket listeners, layout space, dialogs,
// and live-region announcements until the server advertises this rollout.
const enabled = ref(false);

onMounted(async () => {
  try {
    const info = await api.getServerInfo();
    enabled.value = info?.providerAllowancesEnabled === true;
  } catch {
    enabled.value = false;
  }
});
</script>
