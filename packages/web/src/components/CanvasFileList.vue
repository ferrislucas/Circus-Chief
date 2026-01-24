<template>
  <div class="canvas-file-list">
    <!-- Header with select all checkbox - hidden when bulk toolbar is showing -->
    <div class="list-header" v-if="showSelectionUI && selectedCount === 0">
      <input
        type="checkbox"
        class="select-all-checkbox"
        :checked="isAllSelected"
        :indeterminate="isPartialSelection"
        @change="toggleSelectAll"
        :disabled="isOperationInProgress"
        aria-label="Select all items"
      />
      <span class="header-label">Items</span>
    </div>

    <div
      v-for="item in items"
      :key="item.id"
      class="file-row"
      :class="{ selected: isItemSelected(item.id) }"
      @click="handleRowClick(item.id)"
    >
      <!-- Checkbox for selection -->
      <input
        v-if="showSelectionUI"
        type="checkbox"
        class="item-checkbox"
        :checked="isItemSelected(item.id)"
        @change="toggleItemSelection(item.id)"
        @click.stop
        :disabled="isOperationInProgress"
        :aria-label="`Select ${item.filename || 'item'}`"
      />

      <span class="file-icon">{{ getTypeIcon(item.type) }}</span>
      <span class="file-name">{{ item.filename || 'Untitled' }}</span>

      <!-- Copy button -->
      <button
        class="copy-button"
        :class="{ copied: copiedItemId === item.id }"
        @click.stop="copyFilename(item)"
        :title="copiedItemId === item.id ? 'Copied!' : 'Copy filename'"
        :aria-label="`Copy ${item.filename || 'filename'} to clipboard`"
      >
        <span class="copy-button-icon">
          {{ copiedItemId === item.id ? '✓' : '📋' }}
        </span>
      </button>

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
import { ref, computed } from 'vue';
import { useCanvasStore } from '../stores/canvas.js';

const canvasStore = useCanvasStore();

defineProps({
  items: {
    type: Array,
    required: true,
  },
  showSelectionUI: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['select']);

const isOperationInProgress = computed(() => canvasStore.bulkOperationInProgress);
const selectedCount = computed(() => canvasStore.selectedItemCount);
const isAllSelected = computed(() => canvasStore.isAllItemsSelected);
const isPartialSelection = computed(() => canvasStore.isPartialSelection);

function isItemSelected(itemId) {
  return canvasStore.selectedItemIds.has(itemId);
}

function toggleItemSelection(itemId) {
  canvasStore.toggleItemSelection(itemId);
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    canvasStore.deselectAllItems();
  } else {
    canvasStore.selectAllItems();
  }
}

function handleRowClick(itemId) {
  // Only emit select if item not already selected, or if shift/ctrl not held
  if (!isItemSelected(itemId) || !canvasStore.selectedItemCount) {
    // Clear selection when clicking item
    canvasStore.deselectAllItems();
    // Emit select to parent to view the item
    emit('select', itemId);
  }
}

const copiedItemId = ref(null);

// Copy filename to clipboard with fallback
async function copyFilename(item) {
  const filename = item.filename || 'Untitled';
  try {
    await navigator.clipboard.writeText(filename);
    showCopiedFeedback(item.id);
  } catch (err) {
    // Fallback for older browsers / mobile
    try {
      const textarea = document.createElement('textarea');
      textarea.value = filename;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showCopiedFeedback(item.id);
    } catch (fallbackErr) {
      console.error('Copy failed:', fallbackErr);
    }
  }
}

function showCopiedFeedback(itemId) {
  copiedItemId.value = itemId;
  setTimeout(() => {
    copiedItemId.value = null;
  }, 1500);
}

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
  min-width: 0;
  font-weight: 500;
  word-break: break-word;
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

/* Copy button styles */
.copy-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2.75rem;
  min-height: 2.75rem;
  padding: 0.25rem;
  border: none;
  background-color: transparent;
  color: var(--color-text-soft);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease-out;
  flex-shrink: 0;
}

.copy-button:hover {
  color: var(--color-text);
  background-color: rgba(255, 255, 255, 0.05);
}

.copy-button:active {
  background-color: rgba(255, 255, 255, 0.1);
}

.copy-button.copied {
  color: var(--color-success);
  animation: copySuccess 0.3s ease-out;
}

.copy-button-icon {
  font-size: 1rem;
  display: inline-block;
}

@keyframes copySuccess {
  0% { transform: scale(0.8); opacity: 0.7; }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); opacity: 1; }
}

/* List header styles for selection UI */
.list-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  margin-bottom: 0.5rem;
  font-weight: 600;
  font-size: 0.9rem;
}

.select-all-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}

.select-all-checkbox:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.header-label {
  flex: 1;
}

.selection-count {
  color: var(--color-text-soft);
  font-size: 0.85rem;
  font-weight: normal;
  margin-left: auto;
}

/* Checkbox styles */
.item-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
  margin: 0;
}

.item-checkbox:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Selected row styling */
.file-row.selected {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
}

.file-row.selected:hover {
  background: rgba(34, 197, 94, 0.15);
}

/* Mobile styles */
@media (max-width: 640px) {
  .file-row {
    padding: 0.875rem 1rem;
    flex-wrap: nowrap;
  }

  .file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-type {
    display: none;
  }

  .file-time {
    display: none;
  }

  .copy-button {
    min-width: 2.25rem;
    min-height: 2.25rem;
  }

  .item-checkbox {
    width: 16px;
    height: 16px;
  }

  .select-all-checkbox {
    width: 16px;
    height: 16px;
  }
}
</style>
