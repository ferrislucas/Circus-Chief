<template>
  <div class="canvas-file-list">
    <div
      v-for="item in items"
      :key="item.id"
      class="file-row"
      @click="$emit('select', item.id)"
    >
      <span class="file-icon">{{ getTypeIcon(item.type) }}</span>
      <span class="file-name">{{ item.filename || item.label || 'Untitled' }}</span>
      <span class="file-type">{{ item.type }}</span>
      <span v-if="item.versionCount > 1" class="version-badge">
        v{{ item.versionCount }}
      </span>
      <span class="file-time">{{ formatRelativeTime(item.createdAt) }}</span>
      <span class="file-arrow">&#8250;</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  items: {
    type: Array,
    required: true,
  },
});

defineEmits(['select']);

function getTypeIcon(type) {
  const icons = {
    image: '📷',
    markdown: '📄',
    json: '📋',
    text: '📝',
    pdf: '📕',
    code: '💻',
  };
  return icons[type] || '📁';
}

function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}
</script>

<style scoped>
.canvas-file-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: background-color 0.15s;
  min-height: 48px;
}

.file-row:hover {
  background: var(--color-background-mute);
}

.file-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.file-name {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-type {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: var(--color-text-soft);
  flex-shrink: 0;
}

.version-badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.4rem;
  background: var(--color-primary);
  color: white;
  border-radius: 9999px;
  font-weight: 600;
  flex-shrink: 0;
}

.file-time {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  flex-shrink: 0;
}

.file-arrow {
  color: var(--color-text-soft);
  font-size: 1.25rem;
  flex-shrink: 0;
}

/* Mobile styles */
@media (max-width: 640px) {
  .file-row {
    padding: 0.875rem 1rem;
  }

  .file-type {
    display: none;
  }
}
</style>
