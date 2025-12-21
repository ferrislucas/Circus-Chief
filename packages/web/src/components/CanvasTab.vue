<template>
  <div
    class="canvas-tab"
    :class="{ 'drag-over': isDragOver }"
    @dragover.prevent="handleDragOver"
    @dragleave="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <!-- Upload header -->
    <div class="canvas-header">
      <button class="btn btn-primary" @click="triggerFileInput" :disabled="uploading">
        {{ uploading ? 'Uploading...' : 'Upload File' }}
      </button>
      <input
        type="file"
        ref="fileInput"
        @change="handleFileSelect"
        hidden
      />
      <span v-if="isDragOver" class="drag-hint">Drop file to upload</span>
    </div>

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
      :versions="selectedVersions"
      :showBackButton="showBackButton"
      @back="handleBack"
      @selectVersion="handleSelectVersion"
      @delete="handleDelete"
      @deleteAll="handleDeleteAll"
    />

    <!-- List view (multiple files, none selected) -->
    <CanvasFileList
      v-else
      :items="groupedItems"
      @select="handleSelect"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useCanvasStore } from '../stores/canvas.js';
import { useUiStore } from '../stores/ui.js';
import CanvasFileList from './CanvasFileList.vue';
import CanvasFileViewer from './CanvasFileViewer.vue';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const props = defineProps({
  sessionId: { type: String, required: true },
});

const canvasStore = useCanvasStore();
const uiStore = useUiStore();

// Fetch canvas items when tab is mounted/navigated to
onMounted(() => {
  canvasStore.fetchItems(props.sessionId);
});
const fileInput = ref(null);
const isDragOver = ref(false);
const uploading = ref(false);

// Computed properties for list/detail view logic
const groupedItems = computed(() => canvasStore.groupedItems);
const selectedItem = computed(() => canvasStore.selectedItem);
const selectedVersions = computed(() => canvasStore.selectedItemVersions);

const shouldShowViewer = computed(() => {
  return groupedItems.value.length === 1 || canvasStore.selectedItemId !== null;
});

const showBackButton = computed(() => {
  return groupedItems.value.length > 1;
});

// Auto-select when only one file group exists
watch(
  () => groupedItems.value,
  (groups) => {
    if (groups.length === 1 && !canvasStore.selectedItemId) {
      canvasStore.selectItem(groups[0].id);
    }
    // Clear selection if the selected item no longer exists
    if (canvasStore.selectedItemId && !canvasStore.selectedItem) {
      canvasStore.clearSelection();
    }
  },
  { immediate: true }
);

// Navigation handlers
function handleSelect(itemId) {
  canvasStore.selectItem(itemId);
}

function handleBack() {
  canvasStore.clearSelection();
}

function handleSelectVersion(itemId) {
  canvasStore.selectItem(itemId);
}

// Delete handlers
async function handleDelete(itemId) {
  if (!confirm('Delete this version?')) return;

  try {
    // Get next version to select before deleting
    const versions = selectedVersions.value;
    const currentIndex = versions.findIndex((v) => v.id === itemId);
    let nextItemId = null;

    if (versions.length > 1) {
      // Select next version (or previous if deleting last)
      const nextIndex = currentIndex < versions.length - 1 ? currentIndex + 1 : currentIndex - 1;
      nextItemId = versions[nextIndex]?.id;
    }

    await canvasStore.deleteItem(props.sessionId, itemId);

    if (nextItemId) {
      canvasStore.selectItem(nextItemId);
    }

    uiStore.success('Version deleted');
  } catch (err) {
    uiStore.error(err.message);
  }
}

async function handleDeleteAll(filename) {
  if (!confirm(`Delete all versions of "${filename}"?`)) return;

  try {
    await canvasStore.deleteGroup(props.sessionId, filename);
    uiStore.success('All versions deleted');
  } catch (err) {
    uiStore.error(err.message);
  }
}

// File upload handlers
function triggerFileInput() {
  fileInput.value?.click();
}

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
      const selectedFilename = selectedItem.value.filename || selectedItem.value.label || selectedItem.value.id;
      const uploadedFilename = item.filename || item.label || item.id;
      if (selectedFilename === uploadedFilename) {
        canvasStore.selectItem(item.id);
      }
    }
  } catch (err) {
    uiStore.error(`Upload failed: ${err.message}`);
  } finally {
    uploading.value = false;
  }
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
}

/* Hide drag hint on touch devices */
@media (hover: none) {
  .drag-hint {
    display: none;
  }
}
</style>
