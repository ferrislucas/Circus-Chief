<template>
  <ProviderAllowanceIndicators />
</template>

<script setup>
import ProviderAllowanceIndicators from './ProviderAllowanceIndicators.vue';

// Allowance indicators ship to all users: no feature flag or server
// advertisement gate. The indicators degrade honestly to unknown when a
// provider has no verified allowance source.
</script>
