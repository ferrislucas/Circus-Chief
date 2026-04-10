<template>
  <div class="notes-tab">
    <form
      class="add-note-form"
      @submit.prevent="handleAddNote"
    >
      <textarea
        v-model="newNote"
        class="form-input form-textarea"
        placeholder="Add a note..."
        rows="3"
      />
      <button
        type="submit"
        class="btn btn-primary"
        :disabled="!newNote.trim() || adding"
      >
        <span
          v-if="adding"
          class="loading-spinner"
        />
        Add Note
      </button>
    </form>

    <div
      v-if="loading"
      class="loading-state"
    >
      <span class="loading-spinner" />
      Loading notes...
    </div>

    <div
      v-else-if="notes.length === 0"
      class="empty-state"
    >
      <p>No notes yet. Add notes to keep track of important information.</p>
    </div>

    <div
      v-else
      class="notes-list"
    >
      <div
        v-for="note in notes"
        :key="note.id"
        class="note card"
      >
        <div
          v-if="editingId === note.id"
          class="note-edit"
        >
          <textarea
            v-model="editContent"
            class="form-input form-textarea"
            rows="3"
          />
          <div class="note-edit-actions">
            <button
              class="btn"
              @click="cancelEdit"
            >
              Cancel
            </button>
            <button
              class="btn btn-primary"
              :disabled="saving"
              @click="saveEdit(note.id)"
            >
              Save
            </button>
          </div>
        </div>
        <template v-else>
          <div class="note-content">
            {{ note.content }}
          </div>
          <div class="note-footer">
            <span class="note-date">{{ formatDate(note.createdAt) }}</span>
            <div class="note-actions">
              <button
                class="btn-link"
                @click="startEdit(note)"
              >
                Edit
              </button>
              <button
                class="btn-link btn-link-danger"
                @click="handleDelete(note.id)"
              >
                Delete
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../composables/useApi.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  sessionId: { type: String, required: true },
});

const uiStore = useUiStore();

const notes = ref([]);
const newNote = ref('');
const loading = ref(false);
const adding = ref(false);
const editingId = ref(null);
const editContent = ref('');
const saving = ref(false);

onMounted(async () => {
  loading.value = true;
  try {
    notes.value = await api.getSessionNotes(props.sessionId);
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    loading.value = false;
  }
});

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function handleAddNote() {
  if (!newNote.value.trim() || adding.value) return;

  adding.value = true;
  try {
    const note = await api.createNote(props.sessionId, newNote.value);
    notes.value.unshift(note);
    newNote.value = '';
    uiStore.success('Note added');
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    adding.value = false;
  }
}

function startEdit(note) {
  editingId.value = note.id;
  editContent.value = note.content;
}

function cancelEdit() {
  editingId.value = null;
  editContent.value = '';
}

async function saveEdit(noteId) {
  if (!editContent.value.trim() || saving.value) return;

  saving.value = true;
  try {
    const updated = await api.updateNote(props.sessionId, noteId, editContent.value);
    const index = notes.value.findIndex((n) => n.id === noteId);
    if (index !== -1) {
      notes.value[index] = updated;
    }
    cancelEdit();
    uiStore.success('Note updated');
  } catch (err) {
    uiStore.error(err.message);
  } finally {
    saving.value = false;
  }
}

async function handleDelete(noteId) {
  if (!confirm('Delete this note?')) return;

  try {
    await api.deleteNote(props.sessionId, noteId);
    notes.value = notes.value.filter((n) => n.id !== noteId);
    uiStore.success('Note deleted');
  } catch (err) {
    uiStore.error(err.message);
  }
}
</script>

<style scoped>
.notes-tab {
  padding: 1rem 0;
}

.add-note-form {
  display: flex;
  gap: 0.5rem;
  align-items: flex-end;
  margin-bottom: 1.5rem;
}

.add-note-form textarea {
  flex: 1;
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

.notes-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.note-content {
  white-space: pre-wrap;
  margin-bottom: 0.75rem;
}

.note-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.note-date {
  font-size: 0.75rem;
  color: var(--color-text-soft);
}

.note-actions {
  display: flex;
  gap: 0.75rem;
}

.btn-link {
  background: none;
  border: none;
  color: var(--color-primary);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0;
}

.btn-link:hover {
  text-decoration: underline;
}

.btn-link-danger {
  color: var(--color-error);
}

.note-edit {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.note-edit-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}
</style>
