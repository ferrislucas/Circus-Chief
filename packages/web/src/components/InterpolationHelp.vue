<template>
  <p class="form-help">
    Available variables: <code v-pre>{{workspace.id}}</code>, <code v-pre>{{workspace.name}}</code>, <code v-pre>{{workspace.status}}</code>, <code v-pre>{{workspace.summary}}</code>, <code v-pre>{{workspace.shortSummary}}</code>, <code v-pre>{{workspace.fullSummary}}</code>, <code v-pre>{{workspace.keyActions}}</code>, <code v-pre>{{workspace.filesModified}}</code>, <code v-pre>{{workspace.outcome}}</code>
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
