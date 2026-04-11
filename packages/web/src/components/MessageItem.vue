<template>
  <div
    :class="['message', `message-${message.role}`]"
    :data-message-id="message.id"
    :data-testid="`message-${message.role}`"
  >
    <div class="message-header">
      <span class="message-role">{{ message.role }}</span>
      <!-- Show model for assistant messages -->
      <span
        v-if="message.role === 'assistant' && message.model"
        class="message-model"
      >
        {{ formatModelName(message.model) }}
      </span>
      <span class="message-time">{{ formatTime(message.timestamp) }}</span>
    </div>
    <div class="message-content">
      <MarkdownViewer
        v-if="message.role === 'assistant'"
        :content="message.content"
      />
      <template v-else>
        {{ message.content }}
      </template>
    </div>
    <!-- Attachments display for user messages -->
    <div
      v-if="message.attachments?.length"
      class="message-attachments"
    >
      <div
        v-for="att in message.attachments"
        :key="att.id"
        class="attachment-chip"
      >
        <span class="attachment-icon">{{ getAttachmentIcon(att.mimeType) }}</span>
        <span class="attachment-name">{{ att.filename }}</span>
        <span class="attachment-size">({{ formatFileSize(att.size) }})</span>
      </div>
    </div>
    <div
      v-if="message.toolUse?.length"
      class="message-tools"
    >
      <details
        v-for="(tool, idx) in message.toolUse"
        :key="idx"
      >
        <summary>Tool: {{ tool.name }}</summary>
        <pre>{{ JSON.stringify(tool.input, null, 2) }}</pre>
      </details>
    </div>
    <!-- Work Log Panel for assistant messages (collapsed by default) -->
    <WorkLogPanel
      v-if="message.role === 'assistant'"
      :work-logs="workLogs"
    />
  </div>
</template>

<script setup>
import { useMessageFormatting } from '../composables/useMessageFormatting.js';
import MarkdownViewer from './MarkdownViewer.vue';
import WorkLogPanel from './WorkLogPanel.vue';

const props = defineProps({
  message: { type: Object, required: true },
  workLogs: { type: Array, default: () => [] },
});

const { formatTime, formatModelName, formatFileSize, getAttachmentIcon } = useMessageFormatting();
</script>

<style scoped>
.message {
  padding: 1rem;
  margin-bottom: 1rem;
  border-radius: var(--border-radius);
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
}

.message-user {
  background-color: rgba(88, 166, 255, 0.1);
  border-color: rgba(88, 166, 255, 0.3);
}

.message-assistant {
  background-color: var(--color-background-soft);
}

.message-system {
  background-color: rgba(139, 148, 158, 0.1);
  border-color: rgba(139, 148, 158, 0.3);
}

.message-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.message-role {
  font-weight: 600;
  font-size: 0.875rem;
  text-transform: capitalize;
}

.message-time {
  margin-left: auto;
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.message-model {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  padding: 0.125rem 0.375rem;
  background: var(--color-background-mute);
  border-radius: 0.25rem;
  font-family: ui-monospace, monospace;
}

.message-content {
  white-space: pre-wrap;
  word-break: break-word;
}

/* Override pre-wrap for rendered markdown to prevent double line breaks */
.message-content :deep(.markdown-viewer) {
  white-space: normal;
}

.message-tools {
  margin-top: 0.75rem;
}

.message-tools details {
  margin-top: 0.5rem;
}

.message-tools summary {
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.message-tools pre {
  margin-top: 0.5rem;
  font-size: 0.75rem;
}

.message-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--color-border);
}

.attachment-chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  font-size: 0.75rem;
}

.attachment-icon {
  font-size: 0.875rem;
}

.attachment-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}

.attachment-size {
  color: var(--color-text-soft);
  font-size: 0.625rem;
}
</style>
