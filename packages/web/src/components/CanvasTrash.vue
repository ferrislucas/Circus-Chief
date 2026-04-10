<template>
  <div class="canvas-trash">
    <div class="trash-header">
      <h3>Trash</h3>
      <button
        v-if="groupedItems.length > 0"
        class="btn btn-sm"
        @click="$emit('close')"
      >
        Back to Canvas
      </button>
    </div>

    <div
      v-if="loading"
      class="loading-state"
    >
      <span class="loading-spinner" />
      Loading trash...
    </div>

    <div
      v-else-if="groupedItems.length === 0"
      class="empty-state"
    >
      <p>Trash is empty</p>
      <p class="empty-state-hint">
        Deleted files will appear here for recovery.
      </p>
    </div>

    <div v-else>
      <!-- Bulk action toolbar for trash -->
      <div
        v-if="canvasStore.selectedItemCount > 0"
        class="bulk-action-toolbar"
      >
        <div class="toolbar-left">
          <span class="selection-info">
            {{ canvasStore.selectedItemCount }} item{{ canvasStore.selectedItemCount > 1 ? 's' : '' }} selected
          </span>
        </div>
        <div class="toolbar-right">
          <button
            class="btn btn-sm"
            :disabled="canvasStore.bulkOperationInProgress"
            @click="handleSelectAll"
          >
            {{ canvasStore.isAllItemsSelected ? 'Deselect All' : 'Select All' }}
          </button>
          <button
            class="btn btn-sm btn-success"
            :disabled="canvasStore.bulkOperationInProgress"
            @click="handleBulkRecover"
          >
            {{ canvasStore.bulkOperationInProgress ? 'Recovering...' : 'Recover Selected' }}
          </button>
          <button
            class="btn btn-sm btn-danger"
            :disabled="canvasStore.bulkOperationInProgress"
            @click="handleBulkPermanentDelete"
          >
            {{ canvasStore.bulkOperationInProgress ? 'Deleting...' : 'Delete Forever' }}
          </button>
          <button
            class="btn btn-sm btn-secondary"
            :disabled="canvasStore.bulkOperationInProgress"
            @click="handleCancelSelection"
          >
            Cancel
          </button>
        </div>
      </div>

      <div class="trash-list">
        <div
          v-for="item in groupedItems"
          :key="item.id"
          class="trash-row"
          :class="{ selected: isItemSelected(item.id) }"
        >
          <!-- Checkbox for selection -->
          <input
            type="checkbox"
            class="item-checkbox"
            :checked="isItemSelected(item.id)"
            :disabled="canvasStore.bulkOperationInProgress"
            :aria-label="`Select ${item.filename || 'item'}`"
            @change="toggleItemSelection(item.id)"
            @click.stop
          >

          <span class="file-icon">{{ getTypeIcon(item.type) }}</span>
          <div class="file-info">
            <span class="file-name">{{ item.filename || 'Untitled' }}</span>
            <span class="file-meta">
              {{ item.versionCount }} version{{ item.versionCount > 1 ? 's' : '' }}
              &bull; Deleted {{ formatRelativeTime(item.deletedAt) }}
            </span>
          </div>

          <div class="trash-actions">
            <button
              class="btn btn-sm btn-success"
              :disabled="recovering === item.filename || canvasStore.selectedItemCount > 0"
              @click="handleRecover(item.filename)"
            >
              {{ recovering === item.filename ? 'Recovering...' : 'Recover' }}
            </button>
            <button
              class="btn btn-sm btn-danger"
              :disabled="deleting === item.id || canvasStore.selectedItemCount > 0"
              @click="handlePermanentDelete(item)"
            >
              Delete Forever
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useCanvasStore } from '../stores/canvas.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const emit = defineEmits(['close']);

const canvasStore = useCanvasStore();
const uiStore = useUiStore();

const loading = ref(true);
const recovering = ref(null);
const deleting = ref(null);

const groupedItems = computed(() => canvasStore.groupedTrashedItems);

onMounted(async () => {
  await canvasStore.fetchTrashedItems(props.sessionId);
  loading.value = false;
});

async function handleRecover(filename) {
  recovering.value = filename;
  try {
    await canvasStore.recoverFile(props.sessionId, filename);
    uiStore.success(`Recovered "${filename}"`);
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    recovering.value = null;
  }
}

async function handlePermanentDelete(item) {
  const count = item.versionCount;
  const message = count > 1
    ? `Permanently delete all ${count} versions of "${item.filename}"? This cannot be undone.`
    : `Permanently delete "${item.filename}"? This cannot be undone.`;

  if (!confirm(message)) return;

  deleting.value = item.id;
  try {
    // Delete all versions
    for (const version of item.allVersions) {
      await canvasStore.permanentlyDeleteItem(props.sessionId, version.id);
    }
    uiStore.success('Permanently deleted');
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    deleting.value = null;
  }
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
  if (!timestamp) return 'unknown';
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

// Selection helpers
function isItemSelected(itemId) {
  return canvasStore.selectedItemIds.has(itemId);
}

function toggleItemSelection(itemId) {
  canvasStore.toggleItemSelection(itemId);
}

function handleSelectAll() {
  if (canvasStore.isAllItemsSelected) {
    canvasStore.deselectAllItems();
  } else {
    canvasStore.selectAllItems();
  }
}

function handleCancelSelection() {
  canvasStore.deselectAllItems();
}

// Bulk action handlers
async function handleBulkRecover() {
  const count = canvasStore.selectedItemCount;
  if (!confirm(`Recover ${count} item${count > 1 ? 's' : ''}?`)) return;

  try {
    const itemIds = Array.from(canvasStore.selectedItemIds);
    await canvasStore.bulkRecoverItems(props.sessionId, itemIds);
    uiStore.success(`${count} item${count > 1 ? 's' : ''} recovered`);
  } catch (err) {
    uiStore.error(err.message);
  }
}

async function handleBulkPermanentDelete() {
  const count = canvasStore.selectedItemCount;
  if (!confirm(`Permanently delete ${count} item${count > 1 ? 's' : ''}? This cannot be undone.`)) return;

  try {
    const itemIds = Array.from(canvasStore.selectedItemIds);
    await canvasStore.bulkPermanentlyDeleteItems(props.sessionId, itemIds);
    uiStore.success(`${count} item${count > 1 ? 's' : ''} permanently deleted`);
  } catch (err) {
    uiStore.error(err.message);
  }
}
</script>

<style scoped>
.canvas-trash {
  padding: 1rem 0;
}

.trash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.trash-header h3 {
  margin: 0;
  font-size: 1.125rem;
}

.loading-state,
.empty-state {
  text-align: center;
  padding: 2rem;
  color: var(--color-text-soft);
}

.empty-state-hint {
  font-size: 0.875rem;
  margin-top: 0.5rem;
  opacity: 0.8;
}

.trash-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.trash-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  min-height: 56px;
}

.file-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.file-name {
  font-weight: 500;
  word-break: break-word;
}

.file-meta {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.trash-actions {
  display: flex;
  gap: 0.5rem;
  flex-shrink: 0;
}

/* Buttons */
.btn {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s ease-out;
  font-weight: 500;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-sm {
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
}

.btn-success {
  background: var(--color-success);
  color: white;
}

.btn-success:hover:not(:disabled) {
  background: #2ea043;
}

.btn-danger {
  background: transparent;
  border: 1px solid var(--color-error);
  color: var(--color-error);
}

.btn-danger:hover:not(:disabled) {
  background: rgba(248, 81, 73, 0.1);
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
.trash-row.selected {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
}

.trash-row.selected:hover {
  background: rgba(34, 197, 94, 0.15);
}

/* Bulk action toolbar styles */
.bulk-action-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: var(--border-radius);
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex: 1;
  min-width: 0;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.selection-info {
  color: var(--color-text);
  font-weight: 500;
  font-size: 0.9rem;
  white-space: nowrap;
}

.btn-secondary {
  background-color: var(--color-background-mute);
  color: var(--color-text-soft);
  border: 1px solid var(--color-border);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--color-background-soft);
  color: var(--color-text);
}

/* Mobile */
@media (max-width: 640px) {
  .trash-row {
    flex-wrap: wrap;
  }

  .trash-actions {
    width: 100%;
    margin-top: 0.5rem;
  }

  .trash-actions .btn {
    flex: 1;
    min-height: 44px;
  }

  .item-checkbox {
    width: 16px;
    height: 16px;
  }

  .bulk-action-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .toolbar-left {
    justify-content: center;
  }

  .toolbar-right {
    justify-content: center;
  }

  .toolbar-right .btn {
    flex: 1;
    min-height: 44px;
  }
}
</style>
