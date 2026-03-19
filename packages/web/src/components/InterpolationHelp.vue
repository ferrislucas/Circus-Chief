<template>
  <p class="form-help">
    Available variables: <code v-pre>{{parentSession.summary}}</code>, <code v-pre>{{parentSession.status}}</code>, <code v-pre>{{parentSession.name}}</code>, <code v-pre>{{rootSession.id}}</code>, <code v-pre>{{rootSession.name}}</code>, <code v-pre>{{rootSession.summary}}</code>, <code v-pre>{{rootSession.status}}</code>
  </p>
</template>

<script setup>
// No props or state needed - this is a simple static component
</script>

<style scoped>
.form-help {
  font-size: 0.85rem;
  color: var(--color-text-soft);
  margin: 0.25rem 0 0;
}

.form-help code {
  background: var(--color-bg-soft);
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
  font-size: 0.8rem;
}
</style>
