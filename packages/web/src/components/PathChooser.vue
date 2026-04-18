<template>
  <div class="path-chooser">
    <!-- Manual input with browse button -->
    <div class="path-input-group">
      <input
        v-model="inputValue"
        type="text"
        class="form-input"
        placeholder="/path/to/project"
        @input="emitUpdate"
      >
      <button
        type="button"
        class="btn"
        @click="openBrowser"
      >
        Browse
      </button>
    </div>

    <!-- Directory browser modal overlay -->
    <div
      v-if="showBrowser"
      class="path-browser-overlay"
      @click.self="closeBrowser"
    >
      <div class="path-browser">
        <div class="browser-header">
          <span class="browser-path">{{ currentBrowsePath }}</span>
          <button
            type="button"
            class="browser-close"
            @click="closeBrowser"
          >
            &times;
          </button>
        </div>
        <div class="browser-content">
          <div
            v-if="parentPath"
            class="browser-item parent"
            @click="navigateTo(parentPath)"
          >
            <span class="browser-item-icon">&larr;</span>
            Parent Directory
          </div>
          <div
            v-if="loading"
            class="browser-loading"
          >
            <span class="loading-spinner" />
            Loading...
          </div>
          <div
            v-else-if="browseError"
            class="browser-error"
          >
            {{ browseError }}
          </div>
          <template v-else>
            <div
              v-for="entry in entries"
              :key="entry.name"
              class="browser-item"
              @click="navigateTo(joinPath(currentBrowsePath, entry.name))"
            >
              <span class="browser-item-icon">&#128193;</span>
              {{ entry.name }}
            </div>
            <div
              v-if="entries.length === 0 && !parentPath"
              class="browser-empty"
            >
              No subdirectories
            </div>
            <div
              v-else-if="entries.length === 0"
              class="browser-empty"
            >
              No subdirectories in this folder
            </div>
          </template>
        </div>
        <div class="browser-footer">
          <button
            type="button"
            class="btn"
            @click="closeBrowser"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            @click="selectPath"
          >
            Select
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue';
import { api } from '../composables/useApi.js';

const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['update:modelValue']);

// Input value synced with v-model
const inputValue = ref(props.modelValue);

// Watch for external changes to modelValue
watch(
  () => props.modelValue,
  (newVal) => {
    inputValue.value = newVal;
  }
);

// Emit update when input changes
function emitUpdate() {
  emit('update:modelValue', inputValue.value);
}

// Browser state
const showBrowser = ref(false);
const currentBrowsePath = ref('');
const parentPath = ref(null);
const entries = ref([]);
const loading = ref(false);
const browseError = ref(null);

// Open the browser modal
async function openBrowser() {
  showBrowser.value = true;
  // Start browsing from current input value or home directory
  await navigateTo(inputValue.value || '');
}

// Close the browser modal
function closeBrowser() {
  showBrowser.value = false;
}

// Navigate to a directory
async function navigateTo(path) {
  loading.value = true;
  browseError.value = null;

  try {
    const result = await api.browseDirectory(path);
    currentBrowsePath.value = result.path;
    parentPath.value = result.parent;
    entries.value = result.entries;

    if (result.error) {
      browseError.value = result.error;
    }
  } catch (err) {
    browseError.value = err.message || 'Failed to browse directory';
  } finally {
    loading.value = false;
  }
}

// Select the current path and close
function selectPath() {
  inputValue.value = currentBrowsePath.value;
  emit('update:modelValue', currentBrowsePath.value);
  closeBrowser();
}

// Helper to join paths
function joinPath(base, name) {
  if (base === '/') {
    return `/${  name}`;
  }
  return `${base  }/${  name}`;
}
</script>

<style scoped>
.path-chooser {
  width: 100%;
}

.path-input-group {
  display: flex;
  gap: 0.5rem;
}

.path-input-group .form-input {
  flex: 1;
}

/* Modal overlay */
.path-browser-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

/* Browser panel */
.path-browser {
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.browser-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-background-mute);
  border-radius: var(--border-radius) var(--border-radius) 0 0;
}

.browser-path {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 1rem;
}

.browser-close {
  background: none;
  border: none;
  color: var(--color-text-soft);
  font-size: 1.5rem;
  line-height: 1;
  padding: 0;
  cursor: pointer;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--border-radius);
}

.browser-close:hover {
  background-color: var(--color-background);
  color: var(--color-text);
}

/* Content area */
.browser-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  min-height: 200px;
  max-height: 400px;
}

/* Directory items */
.browser-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem;
  cursor: pointer;
  border-radius: var(--border-radius);
  color: var(--color-text);
  font-size: 0.875rem;
}

.browser-item:hover {
  background-color: var(--color-background-mute);
}

.browser-item.parent {
  color: var(--color-primary);
  border-bottom: 1px solid var(--color-border);
  margin-bottom: 0.5rem;
  border-radius: 0;
}

.browser-item.parent:hover {
  background-color: var(--color-background);
}

.browser-item-icon {
  flex-shrink: 0;
}

/* Loading state */
.browser-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  color: var(--color-text-soft);
}

/* Error state */
.browser-error {
  padding: 1rem;
  color: var(--color-error);
  text-align: center;
}

/* Empty state */
.browser-empty {
  padding: 2rem;
  color: var(--color-text-soft);
  text-align: center;
}

/* Footer */
.browser-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 1rem;
  border-top: 1px solid var(--color-border);
  background-color: var(--color-background-mute);
  border-radius: 0 0 var(--border-radius) var(--border-radius);
}

@media (max-width: 480px) {
  .path-input-group {
    flex-direction: column;
  }

  .path-input-group .btn {
    width: 100%;
  }
}
</style>
