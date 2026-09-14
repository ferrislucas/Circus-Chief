<template>
  <div
    v-if="summary"
    class="session-summary"
  >
    <p class="summary-text">
      {{ summary.shortSummary }}
    </p>
    <div class="summary-meta">
      <span
        v-if="filesCount > 0"
        class="summary-files"
      >
        {{ filesCount }} {{ filesCount === 1 ? 'file' : 'files' }} modified
      </span>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';

const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
  summary: {
    type: Object,
    default: null,
  },
});

const filesCount = ref(0);

onMounted(async () => {
  try {
    const result = await api.getSessionFilesCount(props.sessionId);
    filesCount.value = result.count || 0;
  } catch (error) {
    console.warn('Failed to fetch files count:', error);
    if (props.summary?.filesModified?.length) {
      filesCount.value = props.summary.filesModified.length;
    }
  }
});
</script>

<style scoped>
.session-summary {
  padding-top: 0.5rem;
  border-top: 1px solid var(--color-border);
}





.summary-text {
  margin: 0 0 0.5rem;
  font-size: 0.875rem;
  color: var(--color-text-soft);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.summary-meta {
  display: flex;
  gap: 1rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.summary-files {
  opacity: 0.8;
}

</style>
