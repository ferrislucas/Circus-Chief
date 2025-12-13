<template>
  <div class="canvas-tab">
    <div v-if="canvasStore.loading" class="loading-state">
      <span class="loading-spinner"></span>
      Loading canvas items...
    </div>

    <div v-else-if="canvasStore.items.length === 0" class="empty-state">
      <p>No canvas items yet. Claude can add images, markdown, and JSON to the canvas.</p>
    </div>

    <div v-else class="canvas-grid">
      <div
        v-for="item in canvasStore.items"
        :key="item.id"
        class="canvas-item card"
      >
        <div class="canvas-item-header">
          <span class="canvas-item-type">{{ item.type }}</span>
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

          <div v-else-if="item.type === 'markdown'" class="canvas-markdown" v-html="item.content">
          </div>

          <pre v-else-if="item.type === 'json'" class="canvas-json">{{ formatJson(item.data) }}</pre>

          <div v-else-if="item.type === 'text'" class="canvas-text">{{ item.content }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { useCanvasStore } from '../stores/canvas.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const canvasStore = useCanvasStore();
const uiStore = useUiStore();

function formatJson(data) {
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
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

.canvas-json {
  font-size: 0.75rem;
  margin: 0;
}

.canvas-text {
  white-space: pre-wrap;
  font-size: 0.875rem;
}
</style>
