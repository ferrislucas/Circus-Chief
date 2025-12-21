<template>
  <div class="canvas-file-viewer">
    <!-- Header -->
    <div class="viewer-header">
      <div class="viewer-header-left">
        <button
          v-if="showBackButton"
          class="btn-back"
          @click="$emit('back')"
        >
          &#8249; Back
        </button>
        <span class="viewer-filename">{{ item.filename || item.label || 'Untitled' }}</span>
      </div>

      <div class="viewer-header-right">
        <!-- Version dropdown -->
        <details
          v-if="versions.length > 1"
          ref="versionDropdown"
          class="version-dropdown"
        >
          <summary class="version-badge">
            v{{ versions.length - currentVersionIndex }}
            <span class="dropdown-arrow">&#9662;</span>
          </summary>
          <ul class="version-list">
            <li
              v-for="(v, index) in versions"
              :key="v.id"
              :class="{ active: v.id === item.id }"
              @click="selectVersion(v.id)"
            >
              <span class="version-number">v{{ versions.length - index }}</span>
              <span class="version-time">{{ formatRelativeTime(v.createdAt) }}</span>
              <span v-if="v.id === item.id" class="version-current">(current)</span>
            </li>
          </ul>
        </details>

        <!-- Markdown preview toggle -->
        <button
          v-if="item.type === 'markdown'"
          class="preview-toggle"
          :class="{ active: previewMode }"
          @click="previewMode = !previewMode"
          :title="previewMode ? 'Show raw markdown' : 'Preview markdown'"
        >
          {{ previewMode ? 'Raw' : 'Preview' }}
        </button>

        <!-- Delete dropdown -->
        <details ref="deleteDropdown" class="delete-dropdown">
          <summary class="btn-delete" title="Delete">
            &#128465;
          </summary>
          <ul class="delete-options">
            <li @click="handleDeleteVersion">Delete this version</li>
            <li
              v-if="versions.length > 1"
              class="delete-all"
              @click="handleDeleteAll"
            >
              Delete all {{ versions.length }} versions
            </li>
          </ul>
        </details>
      </div>
    </div>

    <!-- Content -->
    <div class="viewer-content">
      <img
        v-if="item.type === 'image'"
        :src="`data:${item.mimeType};base64,${item.data}`"
        :alt="item.label || 'Image'"
        class="viewer-image"
      />

      <template v-else-if="item.type === 'markdown'">
        <MarkdownViewer
          v-if="previewMode"
          :content="item.content"
          class="viewer-markdown"
        />
        <pre v-else class="viewer-markdown-raw">{{ item.content }}</pre>
      </template>

      <pre v-else-if="item.type === 'json'" class="viewer-json">{{ formatJson(item.data) }}</pre>

      <div v-else-if="item.type === 'text'" class="viewer-text">{{ item.content }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import MarkdownViewer from './MarkdownViewer.vue';

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  versions: {
    type: Array,
    default: () => [],
  },
  showBackButton: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['back', 'selectVersion', 'delete', 'deleteAll']);

const previewMode = ref(true);
const versionDropdown = ref(null);
const deleteDropdown = ref(null);

const currentVersionIndex = computed(() => {
  const idx = props.versions.findIndex((v) => v.id === props.item.id);
  return idx >= 0 ? idx : 0;
});

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

function formatJson(data) {
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
  }
}

function selectVersion(itemId) {
  // Close dropdown
  if (versionDropdown.value) {
    versionDropdown.value.open = false;
  }
  emit('selectVersion', itemId);
}

function handleDeleteVersion() {
  // Close dropdown
  if (deleteDropdown.value) {
    deleteDropdown.value.open = false;
  }
  emit('delete', props.item.id);
}

function handleDeleteAll() {
  // Close dropdown
  if (deleteDropdown.value) {
    deleteDropdown.value.open = false;
  }
  const filename = props.item.filename || props.item.label || props.item.id;
  emit('deleteAll', filename);
}
</script>

<style scoped>
.canvas-file-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.viewer-header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  flex: 1;
}

.viewer-header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.btn-back {
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text);
  padding: 0.4rem 0.75rem;
  border-radius: var(--border-radius);
  cursor: pointer;
  font-size: 0.875rem;
  white-space: nowrap;
  min-height: 36px;
}

.btn-back:hover {
  background: var(--color-background-mute);
}

.viewer-filename {
  font-weight: 600;
  font-size: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Version dropdown */
.version-dropdown {
  position: relative;
}

.version-dropdown summary {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.35rem 0.6rem;
  background: var(--color-primary);
  color: white;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
  min-height: 28px;
}

.version-dropdown summary::-webkit-details-marker {
  display: none;
}

.dropdown-arrow {
  font-size: 0.6rem;
}

.version-list {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.25rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  list-style: none;
  padding: 0.25rem 0;
  min-width: 160px;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.version-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
}

.version-list li:hover {
  background: var(--color-background-mute);
}

.version-list li.active {
  background: var(--color-background-mute);
}

.version-number {
  font-weight: 600;
}

.version-time {
  color: var(--color-text-soft);
  font-size: 0.75rem;
}

.version-current {
  color: var(--color-primary);
  font-size: 0.75rem;
}

/* Preview toggle */
.preview-toggle {
  background: none;
  border: 1px solid var(--color-border);
  color: var(--color-text-soft);
  padding: 0.35rem 0.6rem;
  border-radius: var(--border-radius);
  cursor: pointer;
  font-size: 0.75rem;
  min-height: 28px;
}

.preview-toggle:hover {
  background: var(--color-background-mute);
}

.preview-toggle.active {
  background: var(--color-background-mute);
  color: var(--color-text);
}

/* Delete dropdown */
.delete-dropdown {
  position: relative;
}

.delete-dropdown summary {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  cursor: pointer;
  list-style: none;
  font-size: 1rem;
}

.delete-dropdown summary::-webkit-details-marker {
  display: none;
}

.delete-dropdown summary:hover {
  background: var(--color-background-mute);
  border-color: var(--color-error);
  color: var(--color-error);
}

.delete-options {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.25rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  list-style: none;
  padding: 0.25rem 0;
  min-width: 180px;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.delete-options li {
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
}

.delete-options li:hover {
  background: var(--color-background-mute);
}

.delete-options li.delete-all {
  color: var(--color-error);
}

.delete-options li.delete-all:hover {
  background: rgba(248, 81, 73, 0.1);
}

/* Content area */
.viewer-content {
  flex: 1;
  overflow: auto;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 1rem;
}

.viewer-image {
  max-width: 100%;
  height: auto;
  border-radius: var(--border-radius);
}

.viewer-markdown {
  font-size: 0.9375rem;
  line-height: 1.6;
}

.viewer-markdown-raw {
  font-size: 0.8125rem;
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: var(--font-mono);
}

.viewer-json {
  font-size: 0.8125rem;
  margin: 0;
  font-family: var(--font-mono);
}

.viewer-text {
  white-space: pre-wrap;
  font-size: 0.9375rem;
}

/* Mobile styles */
@media (max-width: 640px) {
  .viewer-header {
    padding: 0.5rem 0.75rem;
  }

  .btn-back {
    min-height: 44px;
    padding: 0.5rem 1rem;
  }

  .viewer-filename {
    font-size: 0.875rem;
  }

  .version-dropdown summary,
  .preview-toggle {
    min-height: 36px;
    padding: 0.5rem 0.75rem;
  }

  .delete-dropdown summary {
    width: 44px;
    height: 44px;
  }
}
</style>
