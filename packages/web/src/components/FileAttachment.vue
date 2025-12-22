<template>
  <div
    class="file-attachments"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <!-- Hidden file input -->
    <input
      type="file"
      ref="fileInput"
      multiple
      :accept="acceptTypes"
      @change="handleFileSelect"
      class="hidden-input"
    />

    <!-- Attach button -->
    <button
      type="button"
      @click="openFilePicker"
      class="attach-btn"
      title="Attach files (drag & drop supported)"
    >
      <span class="attach-icon">📎</span>
      <span class="attach-text">Attach</span>
    </button>

    <!-- Drop zone overlay -->
    <div v-if="isDragging" class="drop-zone">
      <span class="drop-text">Drop files here</span>
    </div>

    <!-- Attached files list -->
    <div v-if="files.length > 0" class="attached-files">
      <div v-for="(file, index) in files" :key="index" class="file-chip">
        <span class="file-icon">{{ getFileIcon(file) }}</span>
        <span class="file-name" :title="file.name">{{ truncateName(file.name) }}</span>
        <span class="file-size">({{ formatSize(file.size) }})</span>
        <button
          type="button"
          @click="removeFile(index)"
          class="remove-btn"
          title="Remove file"
        >
          ×
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, defineEmits, defineProps, defineExpose } from 'vue';

const props = defineProps({
  maxFiles: { type: Number, default: 10 },
  maxSize: { type: Number, default: 10 * 1024 * 1024 }, // 10MB
  acceptTypes: {
    type: String,
    default: 'image/*,text/*,.json,.md,.csv,.pdf,.js,.ts,.py,.java,.go,.rs,.c,.cpp,.h,.sh,.yaml,.yml,.xml,.html,.css',
  },
});

const emit = defineEmits(['update:files']);

const files = ref([]);
const isDragging = ref(false);
const fileInput = ref(null);

function openFilePicker() {
  fileInput.value?.click();
}

function handleFileSelect(e) {
  addFiles(Array.from(e.target.files));
  // Reset input so the same file can be selected again
  e.target.value = '';
}

function handleDragOver() {
  isDragging.value = true;
}

function handleDragLeave() {
  isDragging.value = false;
}

function handleDrop(e) {
  isDragging.value = false;
  addFiles(Array.from(e.dataTransfer.files));
}

function addFiles(newFiles) {
  for (const file of newFiles) {
    if (files.value.length >= props.maxFiles) {
      alert(`Maximum ${props.maxFiles} files allowed`);
      break;
    }
    if (file.size > props.maxSize) {
      alert(`File "${file.name}" exceeds maximum size of ${formatSize(props.maxSize)}`);
      continue;
    }
    // Check for duplicates
    if (files.value.some((f) => f.name === file.name && f.size === file.size)) {
      continue;
    }
    files.value.push(file);
  }
  emit('update:files', files.value);
}

function removeFile(index) {
  files.value.splice(index, 1);
  emit('update:files', files.value);
}

function clear() {
  files.value = [];
  emit('update:files', []);
}

function getFileIcon(file) {
  const type = file.type || '';
  if (type.startsWith('image/')) return '🖼️';
  if (type.startsWith('text/') || type === 'application/json') return '📄';
  if (type === 'application/pdf') return '📕';
  if (type.includes('javascript') || type.includes('typescript')) return '📜';
  return '📎';
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function truncateName(name, maxLength = 25) {
  if (name.length <= maxLength) return name;
  const ext = name.split('.').pop();
  const base = name.slice(0, name.length - ext.length - 1);
  const truncatedBase = base.slice(0, maxLength - ext.length - 4) + '...';
  return `${truncatedBase}.${ext}`;
}

defineExpose({ clear, files, addFiles });
</script>

<style scoped>
.file-attachments {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
}

.hidden-input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

.attach-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.375rem 0.625rem;
  font-size: 0.875rem;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  color: var(--color-text-soft);
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.attach-btn:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-border-hover);
}

.attach-icon {
  font-size: 1rem;
}

.attach-text {
  font-size: 0.75rem;
}

.drop-zone {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--color-accent-rgb, 88, 166, 255), 0.1);
  border: 2px dashed var(--color-accent);
  border-radius: 0.375rem;
  z-index: 10;
}

.drop-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--color-accent);
}

.attached-files {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.file-chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem 0.5rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  font-size: 0.75rem;
}

.file-icon {
  font-size: 0.875rem;
}

.file-name {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text);
}

.file-size {
  color: var(--color-text-soft);
  font-size: 0.625rem;
}

.remove-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1rem;
  height: 1rem;
  margin-left: 0.25rem;
  padding: 0;
  font-size: 0.875rem;
  font-weight: bold;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: var(--color-text-soft);
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s;
}

.remove-btn:hover {
  background: var(--color-danger, #ef4444);
  color: white;
}

/* Mobile responsive */
@media (max-width: 480px) {
  .attach-text {
    display: none;
  }

  .file-name {
    max-width: 100px;
  }
}
</style>
