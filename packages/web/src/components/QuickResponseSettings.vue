<template>
  <Teleport to="body">
    <div v-if="isOpen" class="settings-overlay" @click.self="$emit('close')">
      <div class="settings-panel" role="dialog" aria-modal="true">
        <div class="settings-header">
          <h2 class="settings-title">Quick Responses</h2>
          <button class="close-button" @click="$emit('close')" aria-label="Close settings">&times;</button>
        </div>

        <div class="settings-content">
          <!-- Project Responses Section -->
          <div class="section">
            <div class="section-header">
              <h3 class="section-title">Project Responses</h3>
              <button class="add-button" @click="openDialog(false)">+ Add</button>
            </div>

            <div v-if="loading" class="loading-state">Loading...</div>
            <div v-else-if="projectResponses.length === 0" class="empty-state">
              No project-specific quick responses yet.
            </div>
            <ul v-else class="response-list">
              <li
                v-for="(response, index) in projectResponses"
                :key="response.id"
                class="response-item"
              >
                <div class="response-info">
                  <span class="response-label">{{ response.label }}</span>
                  <span class="response-content">{{ truncateContent(response.content) }}</span>
                  <span v-if="response.autoSubmit" class="auto-badge">Auto-submit</span>
                </div>
                <div class="response-actions">
                  <button
                    class="action-button"
                    :disabled="index === 0"
                    @click="moveResponse(projectId, projectResponses, index, -1)"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    class="action-button"
                    :disabled="index === projectResponses.length - 1"
                    @click="moveResponse(projectId, projectResponses, index, 1)"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button class="action-button" @click="editResponse(response)" title="Edit">
                    ✏️
                  </button>
                  <button class="action-button action-danger" @click="confirmDelete(response)" title="Delete">
                    🗑️
                  </button>
                </div>
              </li>
            </ul>
          </div>

          <!-- Global Responses Section -->
          <div class="section">
            <div class="section-header">
              <h3 class="section-title">Global Responses</h3>
              <button class="add-button" @click="openDialog(true)">+ Add</button>
            </div>

            <div v-if="loading" class="loading-state">Loading...</div>
            <div v-else-if="globalResponses.length === 0" class="empty-state">
              No global quick responses yet. Global responses appear in all projects.
            </div>
            <ul v-else class="response-list">
              <li
                v-for="(response, index) in globalResponses"
                :key="response.id"
                class="response-item"
              >
                <div class="response-info">
                  <span class="response-label">{{ response.label }}</span>
                  <span class="response-content">{{ truncateContent(response.content) }}</span>
                  <span v-if="response.autoSubmit" class="auto-badge">Auto-submit</span>
                </div>
                <div class="response-actions">
                  <button
                    class="action-button"
                    :disabled="index === 0"
                    @click="moveResponse(null, globalResponses, index, -1)"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    class="action-button"
                    :disabled="index === globalResponses.length - 1"
                    @click="moveResponse(null, globalResponses, index, 1)"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button class="action-button" @click="editResponse(response)" title="Edit">
                    ✏️
                  </button>
                  <button class="action-button action-danger" @click="confirmDelete(response)" title="Delete">
                    🗑️
                  </button>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- Quick Response Dialog -->
  <QuickResponseDialog
    :isOpen="dialogOpen"
    :projectId="projectId"
    :editingResponse="editingResponse"
    :defaultIsGlobal="defaultIsGlobal"
    @close="closeDialog"
    @saved="handleSaved"
  />

  <!-- Delete Confirmation Dialog -->
  <Teleport to="body">
    <div v-if="deleteConfirm" class="confirm-overlay" @click.self="deleteConfirm = null">
      <div class="confirm-dialog">
        <p class="confirm-message">Are you sure you want to delete "{{ deleteConfirm.label }}"?</p>
        <div class="confirm-actions">
          <button class="btn btn-secondary" @click="deleteConfirm = null">Cancel</button>
          <button class="btn btn-danger" @click="handleDelete">Delete</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useQuickResponsesStore } from '../stores/quickResponses.js';
import QuickResponseDialog from './QuickResponseDialog.vue';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  projectId: {
    type: String,
    required: true,
  },
});

defineEmits(['close']);

const store = useQuickResponsesStore();

const dialogOpen = ref(false);
const editingResponse = ref(null);
const defaultIsGlobal = ref(false);
const deleteConfirm = ref(null);

const loading = computed(() => store.loading);
const projectResponses = computed(() => store.projectResponses);
const globalResponses = computed(() => store.globalResponses);

function truncateContent(content) {
  if (content.length <= 60) return content;
  return content.substring(0, 60) + '...';
}

function openDialog(isGlobal) {
  editingResponse.value = null;
  defaultIsGlobal.value = isGlobal;
  dialogOpen.value = true;
}

function editResponse(response) {
  editingResponse.value = response;
  defaultIsGlobal.value = response.projectId === null;
  dialogOpen.value = true;
}

function closeDialog() {
  dialogOpen.value = false;
  editingResponse.value = null;
}

function handleSaved() {
  // Dialog will close itself, list will update from store
}

function confirmDelete(response) {
  deleteConfirm.value = response;
}

async function handleDelete() {
  if (!deleteConfirm.value) return;

  try {
    await store.deleteResponse(deleteConfirm.value.id);
    deleteConfirm.value = null;
  } catch (err) {
    console.error('Failed to delete response:', err);
  }
}

async function moveResponse(projectId, list, index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= list.length) return;

  const reordered = [...list];
  [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];

  const orderedIds = reordered.map(r => r.id);

  try {
    await store.reorderResponses(projectId, orderedIds);
  } catch (err) {
    console.error('Failed to reorder responses:', err);
  }
}

// Expose for testing
defineExpose({
  moveResponse,
});

</script>

<style scoped>
.settings-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
}

.settings-panel {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg, 12px);
  width: 100%;
  max-width: 600px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
}

.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
  flex-shrink: 0;
}

.settings-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text);
}

.close-button {
  background: none;
  border: none;
  font-size: 1.5rem;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0.25rem;
  line-height: 1;
}

.close-button:hover {
  color: var(--color-text);
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem 1.25rem;
}

.section {
  margin-bottom: 1.5rem;
}

.section:last-child {
  margin-bottom: 0;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.section-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text);
}

.add-button {
  background: var(--color-accent, #22d3ee);
  color: #000;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: var(--border-radius);
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.add-button:hover {
  background: var(--color-accent-hover, #06b6d4);
  transform: translateY(-1px);
}

.loading-state,
.empty-state {
  padding: 1rem;
  text-align: center;
  color: var(--color-text-soft);
  font-size: 0.875rem;
  background: var(--color-background-soft);
  border-radius: var(--border-radius);
}

.response-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.response-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  gap: 1rem;
}

.response-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.response-label {
  font-weight: 600;
  color: var(--color-text);
  font-size: 0.875rem;
}

.response-content {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auto-badge {
  display: inline-flex;
  align-items: center;
  padding: 0.125rem 0.375rem;
  background: rgba(245, 158, 11, 0.15);
  color: rgb(245, 158, 11);
  border-radius: 4px;
  font-size: 0.625rem;
  font-weight: 500;
  text-transform: uppercase;
  width: fit-content;
}

.response-actions {
  display: flex;
  gap: 0.375rem;
  flex-shrink: 0;
}

.action-button {
  background: var(--color-background-mute);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 0.375rem;
  cursor: pointer;
  color: var(--color-text-soft);
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.action-button:hover {
  color: var(--color-text);
  background: var(--color-background);
}

.action-button:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  pointer-events: none;
}

.action-button.action-danger:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

.action-icon {
  width: 1rem;
  height: 1rem;
}

/* Delete confirmation dialog */
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1001;
}

.confirm-dialog {
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius-lg, 12px);
  padding: 1.5rem;
  max-width: 400px;
  width: 100%;
}

.confirm-message {
  margin: 0 0 1rem;
  color: var(--color-text);
  font-size: 0.9375rem;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn {
  padding: 0.625rem 1rem;
  border-radius: var(--border-radius);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-secondary {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  color: var(--color-text);
}

.btn-secondary:hover {
  background: var(--color-background-mute);
}

.btn-danger {
  background: #ef4444;
  border: 1px solid #ef4444;
  color: white;
}

.btn-danger:hover {
  background: #dc2626;
  border-color: #dc2626;
}
</style>
