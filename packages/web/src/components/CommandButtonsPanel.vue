<!--
  CommandButtonsPanel
  -------------------
  Admin grid showing every command button configured for a project.

  Staleness policy: this component takes a **snapshot on mount** and does
  NOT subscribe to WebSocket events (unlike `CommandsTab`). Users who want
  up-to-the-second data should use `CommandsTab`; the admin table is
  explicitly a historical summary.
-->
<template>
  <div class="command-buttons-panel">
    <!-- Header with New Button -->
    <div class="panel-header">
      <h3>Command Buttons</h3>
      <router-link
        :to="`/projects/${projectId}/command-buttons/new`"
        class="btn btn-primary btn-sm"
      >
        + New Command Button
      </router-link>
    </div>

    <!-- Loading State -->
    <div
      v-if="commandButtonsStore.loading"
      class="loading-state"
    >
      <span class="loading-spinner" />
      Loading command buttons...
    </div>

    <!-- Error State -->
    <div
      v-else-if="commandButtonsStore.error"
      class="error-message"
    >
      {{ commandButtonsStore.error }}
    </div>

    <!-- Empty State -->
    <div
      v-else-if="commandButtonsStore.buttons.length === 0"
      class="empty-state"
    >
      <p>No command buttons configured yet.</p>
      <router-link
        :to="`/projects/${projectId}/command-buttons/new`"
        class="btn btn-primary"
      >
        Create First Button
      </router-link>
    </div>

    <!-- Buttons Table -->
    <div
      v-else
      class="buttons-table"
    >
      <div class="table-header">
        <div class="col-label">
          Label
        </div>
        <div class="col-command">
          Command
        </div>
        <div class="col-order">
          Sort Order
        </div>
        <div class="col-started">
          Last Started
        </div>
        <div class="col-ended">
          Last Ended
        </div>
        <div class="col-actions">
          Actions
        </div>
      </div>

      <div
        v-for="button in commandButtonsStore.buttons"
        :key="button.id"
        class="table-row"
        @click="onRowClick(button)"
      >
        <div class="col-label">
          {{ button.label }}
        </div>
        <div class="col-command">
          <code>{{ truncateCommand(button.command) }}</code>
        </div>
        <div class="col-order">
          {{ button.sortOrder }}
        </div>
        <div class="col-started">
          <time
            v-if="lastStartedMs(button.id)"
            :datetime="toIso(lastStartedMs(button.id))"
            :title="absoluteTooltip(lastStartedMs(button.id))"
            :aria-label="`Last started ${absoluteTooltip(lastStartedMs(button.id))}`"
          >{{ formatTime(lastStartedMs(button.id)) }}</time>
          <span v-else>{{ EM_DASH }}</span>
        </div>
        <div class="col-ended">
          <time
            v-if="lastEndedMs(button.id)"
            :datetime="toIso(lastEndedMs(button.id))"
            :title="absoluteTooltip(lastEndedMs(button.id))"
            :aria-label="`Last ended ${absoluteTooltip(lastEndedMs(button.id))}`"
          >{{ formatTime(lastEndedMs(button.id)) }}</time>
          <span v-else>{{ EM_DASH }}</span>
        </div>
        <div
          class="col-actions"
          @click.stop
        >
          <button
            class="btn btn-sm btn-outline-danger"
            @click="onDeleteClick(button)"
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <!-- Delete Confirmation Dialog -->
    <div
      v-if="selectedButton"
      class="modal-overlay"
      @click="selectedButton = null"
    >
      <div
        class="modal-dialog"
        @click.stop
      >
        <div class="modal-header">
          <h4>Delete Command Button</h4>
        </div>
        <div class="modal-body">
          <p>Are you sure you want to delete the command button "<strong>{{ selectedButton.label }}</strong>"?</p>
        </div>
        <div class="modal-footer">
          <button
            class="btn btn-outline-secondary"
            @click="selectedButton = null"
          >
            Cancel
          </button>
          <button
            class="btn btn-danger"
            @click="confirmDelete"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { defineProps, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import {
  formatTime,
  toIso,
  absoluteTooltip,
  EM_DASH,
} from '../utils/time.js';

const props = defineProps({
  projectId: {
    type: String,
    required: true,
  },
});

const router = useRouter();
const commandButtonsStore = useCommandButtonsStore();
const selectedButton = ref(null);

// snapshot-on-mount; no WS subscription
onMounted(() => {
  // Fire both requests in parallel. Use allSettled so a failure of one
  // doesn't block the other.
  Promise.allSettled([
    commandButtonsStore.fetchButtons(props.projectId),
    commandButtonsStore.fetchLatestRunsForProject(props.projectId),
  ]);
});

const truncateCommand = (command) => {
  const maxLength = 50;
  if (command.length > maxLength) {
    return `${command.substring(0, maxLength)  }...`;
  }
  return command;
};

function lastStartedMs(buttonId) {
  const run = commandButtonsStore.getLatestRunForButtonInProject(buttonId);
  return run?.startedAt ?? null;
}

function lastEndedMs(buttonId) {
  const run = commandButtonsStore.getLatestRunForButtonInProject(buttonId);
  return run?.completedAt ?? null;
}

const onRowClick = (button) => {
  router.push(`/projects/${props.projectId}/command-buttons/${button.id}`);
};

const onDeleteClick = (button) => {
  selectedButton.value = button;
};

const confirmDelete = async () => {
  if (selectedButton.value) {
    try {
      await commandButtonsStore.deleteButton(props.projectId, selectedButton.value.id);
      selectedButton.value = null;
    } catch (err) {
      console.error('Failed to delete button:', err);
    }
  }
};
</script>

<style scoped>
.command-buttons-panel {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.panel-header h3 {
  margin: 0;
  font-size: 1.25rem;
  color: var(--color-text);
}

.loading-state,
.error-message,
.empty-state {
  padding: 2rem;
  text-align: center;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  color: var(--color-text-soft);
}

.error-message {
  color: var(--color-error);
  background-color: rgba(248, 81, 73, 0.1);
}

.loading-state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  align-items: center;
}

.buttons-table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  overflow: hidden;
}

.table-header {
  display: grid;
  grid-template-columns: 180px 1fr 70px 130px 130px 90px;
  gap: 1rem;
  padding: 1rem;
  background-color: var(--color-background-mute);
  border-bottom: 1px solid var(--color-border);
  font-weight: 500;
  color: var(--color-text);
  font-size: 0.875rem;
  text-transform: uppercase;
}

.table-row {
  display: grid;
  grid-template-columns: 180px 1fr 70px 130px 130px 90px;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
  background-color: var(--color-background);
  cursor: pointer;
  transition: background-color 0.2s;
}

.table-row:last-child {
  border-bottom: none;
}

.table-row:hover {
  background-color: var(--color-background-soft);
}

.col-label {
  color: var(--color-text);
  font-weight: 500;
  word-break: break-word;
}

.col-command {
  color: var(--color-text-soft);
  font-size: 0.875rem;
  word-break: break-all;
}

.col-command code {
  background-color: rgba(0, 0, 0, 0.2);
  padding: 0.25rem 0.5rem;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.col-order {
  color: var(--color-text-soft);
  font-size: 0.875rem;
}

.col-started,
.col-ended {
  color: var(--color-text-soft);
  font-size: 0.875rem;
  font-family: var(--font-mono);
}

.col-actions {
  display: flex;
  justify-content: flex-end;
}

/* Modal Styles */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-dialog {
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  max-width: 400px;
  width: 90%;
  overflow: hidden;
}

.modal-header {
  padding: 1rem;
  border-bottom: 1px solid var(--color-border);
}

.modal-header h4 {
  margin: 0;
  color: var(--color-text);
}

.modal-body {
  padding: 1.5rem 1rem;
  color: var(--color-text-soft);
}

.modal-footer {
  padding: 1rem;
  border-top: 1px solid var(--color-border);
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

/* Responsive Design */
@media (max-width: 640px) {
  .table-header,
  .table-row {
    grid-template-columns: 1fr;
    gap: 0.5rem;
  }

  .col-label::before { content: 'Label: '; font-weight: bold; color: var(--color-text-soft); }
  .col-command::before { content: 'Command: '; font-weight: bold; color: var(--color-text-soft); }
  .col-order::before { content: 'Order: '; font-weight: bold; color: var(--color-text-soft); }
  .col-started::before { content: 'Last Started: '; font-weight: bold; color: var(--color-text-soft); }
  .col-ended::before { content: 'Last Ended: '; font-weight: bold; color: var(--color-text-soft); }
  .col-actions::before { content: 'Actions: '; font-weight: bold; color: var(--color-text-soft); }

  .col-label,
  .col-command,
  .col-order,
  .col-started,
  .col-ended,
  .col-actions {
    display: block;
  }
}
</style>
