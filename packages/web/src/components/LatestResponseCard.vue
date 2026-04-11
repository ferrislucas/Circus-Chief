<template>
  <div
    v-if="latestResponse"
    class="latest-response card"
  >
    <div class="latest-response-header">
      <h3>Latest Response</h3>
      <div class="latest-response-meta">
        <span
          v-if="latestResponseModel"
          class="response-model"
        >
          {{ latestResponseModel }}
        </span>
        <span
          v-if="latestResponse.sessionName"
          class="response-session-name"
        >
          from {{ latestResponse.sessionName }}
        </span>
        <span class="response-timestamp">
          {{ formatRelativeTime(latestResponse.message.timestamp) }}
        </span>
      </div>
    </div>
    <div
      class="latest-response-content"
      :class="{ collapsed: !expanded && isContentLong }"
    >
      <MarkdownViewer :content="displayedContent" />
    </div>
    <button
      v-if="isContentLong"
      class="btn-link expand-toggle"
      @click="expanded = !expanded"
    >
      {{ expanded ? 'Show less' : 'Show full response' }}
    </button>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import MarkdownViewer from './MarkdownViewer.vue';
import { useModelInfo } from '../composables/useModelInfo.js';
import { formatRelativeTime } from '../composables/useSummaryHelpers.js';

const props = defineProps({
  latestResponse: {
    type: Object,
    default: null,
  },
  modelDisplayName: {
    type: String,
    default: null,
  },
});

const expanded = ref(false);
const { getModelDisplayName } = useModelInfo();

const latestResponseModel = computed(() =>
  props.modelDisplayName || (props.latestResponse?.message?.model ? getModelDisplayName(props.latestResponse.message.model) : null)
);

const isContentLong = computed(() =>
  props.latestResponse?.message?.content?.length > 500
);

const displayedContent = computed(() => {
  const content = props.latestResponse?.message?.content || '';
  if (expanded.value || content.length <= 500) {
    return content;
  }
  return `${content.slice(0, 500)}...`;
});
</script>

<style scoped>
.latest-response {
  margin-bottom: 1.5rem;
}

.latest-response-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.latest-response-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.latest-response-meta {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.response-model {
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  background: rgba(99, 179, 237, 0.1);
  color: var(--color-primary, #63b3ed);
  font-weight: 500;
  font-size: 0.6875rem;
}

.response-session-name {
  opacity: 0.8;
}

.latest-response-content {
  position: relative;
  font-size: 0.875rem;
  line-height: 1.5;
}

.latest-response-content.collapsed {
  max-height: 300px;
  overflow: hidden;
}

.latest-response-content.collapsed::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 60px;
  background: linear-gradient(transparent, var(--color-background-soft, #1e1e1e));
  pointer-events: none;
}

.expand-toggle {
  display: inline-block;
  margin-top: 0.5rem;
  padding: 0;
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.8125rem;
  font-weight: 500;
}

.expand-toggle:hover {
  text-decoration: underline;
}
</style>
