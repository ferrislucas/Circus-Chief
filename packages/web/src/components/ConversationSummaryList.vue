<template>
  <div class="conversations-section">
    <h3>Conversations</h3>

    <div v-if="loadingConversations" class="loading-state">
      <span class="loading-spinner"></span>
      Loading conversations...
    </div>

    <div v-else-if="conversations.length === 0" class="empty-conversations">
      <p>No conversations yet.</p>
    </div>

    <div v-else class="conversation-cards">
      <div
        v-for="conv in conversations"
        :key="conv.id"
        :class="['conversation-card card', { active: conv.isActive }]"
      >
        <div class="conv-header">
          <span class="conv-number">{{ getConversationNumber(conv.id) }}.</span>
          <span class="conv-name">{{ conv.name || 'Untitled' }}</span>
          <span v-if="conv.isActive" class="active-badge">Active</span>
          <span class="conv-meta">{{ conv.messageCount || 0 }} msgs</span>
        </div>

        <div class="conv-summary">
          <template v-if="conv.summary">
            {{ conv.summary }}
          </template>
          <template v-else-if="conv.isActive">
            <span class="pending-summary">Summary will generate when conversation ends</span>
          </template>
          <template v-else>
            <span class="pending-summary">No summary available</span>
          </template>
        </div>

        <div class="conv-footer">
          <button class="btn-link" @click="$emit('view-conversation', conv.id)">
            View Conversation
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
defineProps({
  conversations: { type: Array, required: true },
  loadingConversations: { type: Boolean, default: false },
  getConversationNumber: { type: Function, required: true },
});

defineEmits(['view-conversation']);
</script>

<style scoped>
.conversations-section {
  margin-bottom: 1.5rem;
}

.conversations-section h3 {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--color-text-soft);
  margin: 0 0 1rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
}

.empty-conversations {
  text-align: center;
  padding: 1.5rem;
  color: var(--color-text-soft);
  background: var(--color-background-soft);
  border-radius: var(--border-radius);
}

.empty-conversations p {
  margin: 0;
}

.conversation-cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.conversation-card {
  padding: 1rem;
  transition: border-color 0.15s;
}

.conversation-card.active {
  border-color: var(--color-primary);
  border-left: 3px solid var(--color-primary);
}

.conv-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.conv-number {
  font-weight: 600;
  color: var(--color-text-soft);
}

.conv-name {
  font-weight: 500;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.active-badge {
  padding: 0.125rem 0.5rem;
  background: rgba(88, 166, 255, 0.15);
  color: var(--color-primary);
  border-radius: 9999px;
  font-size: 0.625rem;
  font-weight: 600;
  text-transform: uppercase;
}

.conv-meta {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  white-space: nowrap;
}

.conv-summary {
  font-size: 0.875rem;
  color: var(--color-text);
  line-height: 1.5;
  margin-bottom: 0.75rem;
}

.pending-summary {
  color: var(--color-text-soft);
  font-style: italic;
}

.conv-footer {
  display: flex;
  justify-content: flex-end;
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.btn-link:hover {
  text-decoration: underline;
}

.btn-link:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
