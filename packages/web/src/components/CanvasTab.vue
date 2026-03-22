<template>
  <div
    class="canvas-tab"
    :class="{ 'drag-over': isDragOver }"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <!-- Upload header - only show in list view -->
    <div v-if="!shouldShowViewer || !selectedItem" class="canvas-header">
      <label v-if="!showTrash" class="btn btn-primary" :class="{ disabled: uploading }">
        {{ uploading ? 'Uploading...' : 'Upload File' }}
        <input
          type="file"
          @change="handleFileSelect"
          :disabled="uploading"
          style="display: none"
        />
      </label>

      <!-- Trash toggle button -->
      <button
        v-if="!showTrash && canvasStore.trashedItems.length > 0"
        class="btn btn-sm trash-toggle"
        @click="showTrash = true"
      >
        🗑️ Trash
        <span class="trash-count">{{ canvasStore.trashedItems.length }}</span>
      </button>

      <span v-if="isDragOver" class="drag-hint">Drop file to upload</span>
    </div>

    <!-- Bulk action toolbar -->
    <div v-if="canvasStore.selectedItemCount > 0 && !showTrash" class="bulk-action-toolbar">
      <div class="toolbar-left">
        <input
          type="checkbox"
          class="toolbar-checkbox"
          :checked="canvasStore.isAllItemsSelected"
          @change="handleSelectAll"
          :disabled="canvasStore.bulkOperationInProgress"
          aria-label="Select all items"
        />
        <span class="selection-info">
          {{ canvasStore.selectedItemCount }} item{{ canvasStore.selectedItemCount > 1 ? 's' : '' }} selected
        </span>
      </div>
      <div class="toolbar-right">
        <button
          class="btn btn-sm btn-danger"
          @click="handleBulkDelete"
          :disabled="canvasStore.bulkOperationInProgress"
        >
          {{ canvasStore.bulkOperationInProgress ? 'Deleting...' : 'Delete Selected' }}
        </button>
        <button
          class="btn btn-sm btn-secondary"
          @click="handleCancelSelection"
          :disabled="canvasStore.bulkOperationInProgress"
        >
          Cancel
        </button>
      </div>
    </div>

    <!-- Trash view -->
    <CanvasTrash
      v-if="showTrash"
      :sessionId="sessionId"
      @close="showTrash = false"
    />

    <!-- Canvas view -->
    <template v-else>
      <div v-if="canvasStore.loading && !uploading" class="loading-state">
        <span class="loading-spinner"></span>
        Loading canvas items...
      </div>

      <div v-else-if="canvasStore.items.length === 0" class="empty-state">
        <p>No canvas items yet. Upload a file or drag and drop here.</p>
        <p class="empty-state-hint">Claude can also add images, markdown, and JSON to the canvas.</p>
      </div>

      <!-- Detail view (single file OR selected file) -->
      <CanvasFileViewer
        v-else-if="shouldShowViewer && selectedItem"
        :item="selectedItem"
        :sessionId="sessionId"
        :versions="selectedVersions"
        :showBackButton="showBackButton"
        @back="handleBack"
        @selectVersion="handleSelectVersion"
        @deleteAll="handleDeleteAll"
      />

      <!-- List view (multiple files, none selected) -->
      <CanvasFileList
        v-else
        :items="groupedItems"
        :sessionId="sessionId"
        @select="handleSelect"
        @deleteItem="handleDeleteItem"
      />
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCanvasStore } from '../stores/canvas.js';
import { useUiStore } from '../stores/ui.js';
import CanvasFileList from './CanvasFileList.vue';
import CanvasFileViewer from './CanvasFileViewer.vue';
import CanvasTrash from './CanvasTrash.vue';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const props = defineProps({
  sessionId: { type: String, required: true },
});

const route = useRoute();
const router = useRouter();
const canvasStore = useCanvasStore();
const uiStore = useUiStore();

// Fetch canvas items when tab is mounted/navigated to
onMounted(() => {
  canvasStore.fetchItems(props.sessionId);
  canvasStore.fetchTrashedItems(props.sessionId);
});

const isDragOver = ref(false);
const uploading = ref(false);
const showTrash = ref(false);

// Get selected item ID from route query parameter
const selectedItemId = computed(() => route.query.item || null);

// Computed properties for list/detail view logic
const groupedItems = computed(() => canvasStore.groupedItems);

const selectedItem = computed(() => {
  // If an item is explicitly selected, find it
  if (selectedItemId.value) {
    return canvasStore.items.find((i) => i.id === selectedItemId.value);
  }
  return null;
});

const selectedVersions = computed(() => {
  if (!selectedItem.value) return [];
  const key = selectedItem.value.filename || selectedItem.value.id;
  return canvasStore.items
    .filter((i) => (i.filename || i.id) === key)
    .sort((a, b) => b.createdAt - a.createdAt);
});
const shouldShowViewer = computed(() => {
  // Show viewer only if an item is explicitly selected
  return selectedItemId.value !== null;
});

const showBackButton = computed(() => {
  return true; // Always show back button
});

// Auto-navigate to the latest version when a new version of the viewed file arrives
watch(
  () => canvasStore.items.length,
  () => {
    if (!selectedItem.value) return;

    const currentFilename = selectedItem.value.filename || selectedItem.value.id;

    // Find the latest item with the same filename
    const latest = canvasStore.items
      .filter(i => (i.filename || i.id) === currentFilename)
      .sort((a, b) => b.createdAt - a.createdAt)[0];

    // If the latest version is different from what we're viewing, navigate to it
    if (latest && latest.id !== selectedItemId.value) {
      router.replace({
        query: { ...route.query, item: latest.id }
      });
    }
  }
);

// Navigation handlers
function handleSelect(itemId) {
  router.push({
    query: { ...route.query, item: itemId }
  });
}

function handleBack() {
  const { item, ...rest } = route.query;
  router.push({ query: rest });
}

function handleSelectVersion(itemId) {
  router.push({
    query: { ...route.query, item: itemId }
  });
}

// Delete handler
async function handleDeleteAll(filename) {
  if (!confirm(`Delete all versions of "${filename}"?`)) return;

  try {
    await canvasStore.deleteGroup(props.sessionId, filename);
    // Go back to list view
    const { item, ...rest } = route.query;
    router.push({ query: rest });
    uiStore.success('All versions deleted');
  } catch (err) {
    uiStore.error(err.message);
  }
}

async function handleDeleteItem(item) {
  const filename = item.filename || item.id;
  if (!confirm(`Delete all versions of "${filename}"?`)) return;

  try {
    await canvasStore.deleteGroup(props.sessionId, filename);
    uiStore.success('All versions deleted');
  } catch (err) {
    uiStore.error(err.message);
  }
}

// File upload handlers
function handleDragOver() {
  isDragOver.value = true;
}

function handleDragLeave(event) {
  if (!event.currentTarget.contains(event.relatedTarget)) {
    isDragOver.value = false;
  }
}

async function handleDrop(event) {
  isDragOver.value = false;
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    await uploadFile(files[0]);
  }
}

async function handleFileSelect(event) {
  const files = event.target.files;
  if (files && files.length > 0) {
    await uploadFile(files[0]);
  }
  event.target.value = '';
}

async function uploadFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    uiStore.error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    return;
  }

  uploading.value = true;
  try {
    const item = await canvasStore.uploadItem(props.sessionId, file, file.name);
    uiStore.success(`Uploaded ${file.name}`);

    // If we're viewing a file with the same name, stay on viewer with the new version
    if (selectedItem.value) {
      const selectedFilename = selectedItem.value.filename || selectedItem.value.id;
      const uploadedFilename = item.filename || item.id;
      if (selectedFilename === uploadedFilename) {
        router.push({
          query: { ...route.query, item: item.id }
        });
      }
    }
  } catch (err) {
    uiStore.error(`Upload failed: ${err.message}`);
  } finally {
    uploading.value = false;
  }
}

// Bulk action handlers
async function handleBulkDelete() {
  const count = canvasStore.selectedItemCount;
  if (!confirm(`Delete ${count} item${count > 1 ? 's' : ''}?`)) return;

  try {
    const itemIds = Array.from(canvasStore.selectedItemIds);
    await canvasStore.bulkDeleteItems(props.sessionId, itemIds);
    uiStore.success(`${count} item${count > 1 ? 's' : ''} deleted`);
  } catch (err) {
    uiStore.error(err.message);
  }
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
</script>

<style scoped>
.canvas-tab {
  padding: 1rem 0;
  min-height: 200px;
  transition: background-color 0.2s, border-color 0.2s;
}

.canvas-tab.drag-over {
  background-color: rgba(88, 166, 255, 0.1);
  border: 2px dashed var(--color-primary);
  border-radius: var(--border-radius);
}

.canvas-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.canvas-header label.disabled {
  opacity: 0.6;
  cursor: not-allowed;
  pointer-events: none;
}

.trash-toggle {
  background: var(--color-background-mute);
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  padding: 0.375rem 0.75rem;
  border-radius: var(--border-radius);
  cursor: pointer;
  font-size: 0.8125rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
  transition: all 0.2s ease-out;
}

.trash-toggle:hover {
  color: var(--color-text);
  background: var(--color-background-soft);
}

.trash-count {
  display: inline-block;
  background: var(--color-error);
  color: white;
  border-radius: 9999px;
  padding: 0.125rem 0.4rem;
  font-size: 0.75rem;
  font-weight: 600;
  min-width: 1.25rem;
  text-align: center;
}

.drag-hint {
  color: var(--color-primary);
  font-weight: 500;
}

.loading-state {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
}

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

.toolbar-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
  margin: 0;
}

.toolbar-checkbox:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.selection-info {
  color: var(--color-text);
  font-weight: 500;
  font-size: 0.9rem;
  white-space: nowrap;
}

.btn-danger {
  background-color: var(--color-error);
  color: white;
  border-color: var(--color-error);
}

.btn-danger:hover:not(:disabled) {
  background-color: #dc2626;
  border-color: #dc2626;
}

.btn-secondary {
  background-color: var(--color-background-mute);
  color: var(--color-text-soft);
  border-color: var(--color-border);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--color-background-soft);
  color: var(--color-text);
}

/* Mobile styles */
@media (max-width: 640px) {
  .canvas-header {
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .canvas-header .btn-primary {
    flex: 1;
    min-height: 44px;
  }

  .drag-hint {
    display: none;
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

  .toolbar-checkbox {
    width: 16px;
    height: 16px;
  }
}

/* Hide drag hint on touch devices */
@media (hover: none) {
  .drag-hint {
    display: none;
  }
}
</style>
