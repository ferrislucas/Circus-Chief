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

    <div v-else class="canvas-grid">
      <div
        v-for="item in canvasStore.items"
        :key="item.id"
        class="canvas-item card"
      >
        <div class="canvas-item-header">
          <span class="canvas-item-type">{{ item.type }}</span>
          <button
            v-if="item.type === 'markdown'"
            class="preview-toggle"
            :class="{ active: previewMode[item.id] }"
            @click="togglePreview(item.id)"
            :title="previewMode[item.id] ? 'Show raw markdown' : 'Preview markdown'"
          >
            {{ previewMode[item.id] ? '📝 Raw' : '👁 Preview' }}
          </button>
          <button class="btn-icon" @click="handleDelete(item.id)" title="Delete">
            &times;
          </button>
        </div>

        <div class="canvas-item-label" v-if="item.label">{{ item.label }}</div>

        <div class="canvas-item-content">
          <img
            v-if="item.type === 'image'"
            :src="`data:${item.mimeType};base64,${item.data}`"
            :alt="item.label || 'Image'"
            class="canvas-image"
          />

          <template v-else-if="item.type === 'markdown'">
            <MarkdownViewer v-if="previewMode[item.id]" :content="item.content" class="canvas-markdown" />
            <pre v-else class="canvas-markdown-raw">{{ item.content }}</pre>
          </template>

          <pre v-else-if="item.type === 'json'" class="canvas-json">{{ formatJson(item.data) }}</pre>

          <div v-else-if="item.type === 'text'" class="canvas-text">{{ item.content }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { useCanvasStore } from '../stores/canvas.js';
import { useUiStore } from '../stores/ui.js';
import MarkdownViewer from './MarkdownViewer.vue';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const props = defineProps({
  sessionId: { type: String, required: true },
});

const canvasStore = useCanvasStore();
const uiStore = useUiStore();
const previewMode = ref({});
const fileInput = ref(null);
const isDragOver = ref(false);
const uploading = ref(false);

// Initialize preview mode to true (preview by default) for markdown items
watch(
  () => canvasStore.items,
  (items) => {
    items.forEach((item) => {
      if (item.type === 'markdown' && previewMode.value[item.id] === undefined) {
        previewMode.value[item.id] = true;
      }
    });
  },
  { immediate: true }
);

function togglePreview(itemId) {
  previewMode.value[itemId] = !previewMode.value[itemId];
}

function formatJson(data) {
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
  }
}

function triggerFileInput() {
  fileInput.value?.click();
}

function handleDragOver(event) {
  isDragOver.value = true;
}

function handleDragLeave(event) {
  // Only set to false if we're leaving the canvas-tab element
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
  // Reset file input so same file can be selected again
  event.target.value = '';
}

async function uploadFile(file) {
  // Check file size
  if (file.size > MAX_FILE_SIZE) {
    uiStore.error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    return;
  }

  uploading.value = true;
  try {
    await canvasStore.uploadItem(props.sessionId, file, file.name);
    uiStore.success(`Uploaded ${file.name}`);
  } catch (err) {
    uiStore.error(`Upload failed: ${err.message}`);
  } finally {
    uploading.value = false;
  }
}

async function handleDelete(itemId) {
  if (!confirm('Delete this canvas item?')) return;

  try {
    await canvasStore.deleteItem(props.sessionId, itemId);
    uiStore.success('Canvas item deleted');
  } catch (err) {
    uiStore.error(err.message);
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

.canvas-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1rem;
}

.canvas-item {
  overflow: hidden;
}

.canvas-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.canvas-item-type {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  text-transform: uppercase;
}

.btn-icon {
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.btn-icon:hover {
  color: var(--color-error);
}

.canvas-item-label {
  font-size: 0.875rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
}

.canvas-item-content {
  max-height: 400px;
  overflow: auto;
}

.canvas-image {
  max-width: 100%;
  height: auto;
  border-radius: var(--border-radius);
}

.canvas-markdown {
  font-size: 0.875rem;
}

.canvas-markdown-raw {
  font-size: 0.75rem;
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
}

/* Preview toggle button - layout only (base styles in main.css) */
.preview-toggle {
  margin-left: auto;
}

.canvas-json {
  font-size: 0.75rem;
  margin: 0;
}

.canvas-text {
  white-space: pre-wrap;
  font-size: 0.875rem;
}
</style>
