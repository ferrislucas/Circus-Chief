<template>
  <div class="session-header">
    <!-- Main header row with status, name, and menu -->
    <div class="session-header-row">
      <!-- Session name -->
      <h3 class="session-name">{{ session.name }}</h3>

      <!-- Overflow menu with secondary actions -->
      <OverflowMenu
        aria-label="Session actions"
        :is-archived="session.archived"
        :is-deleting="isDeleting"
        copy-session-id-text="Copy ID"
        @duplicate="$emit('duplicate')"
        @copySessionId="$emit('copySessionId')"
        @archive="$emit('archive')"
        @delete="$emit('delete')"
      />
    </div>

    <!-- PR indicators and command button status bar -->
    <div class="branch-pr-indicators">
      <div class="left-indicators">
        <!-- Star button (icon only) -->
        <button
          class="btn-icon btn-star"
          :title="session?.starred ? 'Unstar session' : 'Star session'"
          :class="{ 'is-starred': session?.starred }"
          @click="$emit('star')"
        >
          <svg v-if="session?.starred" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2"></polygon>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2"></polygon>
          </svg>
        </button>
        <template v-if="isEditingPrUrl">
          <div class="pr-edit-form">
            <input
              :value="editPrUrlValue"
              @input="$emit('update:editPrUrlValue', $event.target.value)"
              type="url"
              class="pr-url-input"
              placeholder="https://github.com/owner/repo/pull/123"
              @keyup.enter="$emit('savePrUrl')"
              @keyup.escape="$emit('cancelEditPrUrl')"
            />
            <button class="btn-icon pr-edit-btn pr-save-btn" title="Save" @click="$emit('savePrUrl')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </button>
            <button class="btn-icon pr-edit-btn pr-cancel-btn" title="Cancel" @click="$emit('cancelEditPrUrl')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <button v-if="editPrUrlValue" class="btn-icon pr-edit-btn pr-clear-btn" title="Clear PR URL" @click="$emit('clearPrUrl')">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </template>
        <template v-else>
          <PrIndicators
            v-if="session.prUrl"
            :pr-url="session.prUrl"
            :summary="summary"
          />
          <button class="btn-link pr-edit-trigger" @click="$emit('startEditPrUrl')" :title="session.prUrl ? 'Edit PR URL' : 'Add PR URL'">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            <span v-if="!session.prUrl">Link PR</span>
          </button>
        </template>
      </div>

      <!-- Command button status indicators for real-time status updates -->
      <CommandButtonStatusBar :button-statuses="buttonStatusesToDisplay" />
    </div>
  </div>
</template>

<script setup>
import PrIndicators from './PrIndicators.vue';
import OverflowMenu from './OverflowMenu.vue';
import CommandButtonStatusBar from './CommandButtonStatusBar.vue';

defineProps({
  session: {
    type: Object,
    required: true,
  },
  isDeleting: {
    type: Boolean,
    default: false,
  },
  isEditingPrUrl: {
    type: Boolean,
    default: false,
  },
  editPrUrlValue: {
    type: String,
    default: '',
  },
  summary: {
    type: Object,
    default: null,
  },
  buttonStatusesToDisplay: {
    type: Array,
    default: () => [],
  },
});

defineEmits([
  'duplicate',
  'copySessionId',
  'archive',
  'delete',
  'star',
  'startEditPrUrl',
  'cancelEditPrUrl',
  'savePrUrl',
  'clearPrUrl',
  'update:editPrUrlValue',
]);
</script>

<style scoped>
.session-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 0.5rem;
  padding: 0 0.5rem; /* Ensure content doesn't touch screen edges */
}

.session-header-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.btn-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: var(--color-text-soft, #888);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  flex-shrink: 0;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text, #ccc);
}

.btn-icon:active {
  background: rgba(255, 255, 255, 0.15);
}

.btn-star {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
}

.btn-star svg {
  flex-shrink: 0;
}

.btn-star.is-starred {
  color: var(--color-warning, #f0ad4e);
}

.session-name {
  flex: 1;
  min-width: 0; /* Critical: allows wrapping to work in flexbox */
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  overflow: hidden;
  word-break: break-word;
  line-height: 1.4;
}

.branch-pr-indicators {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.left-indicators {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

@media (max-width: 768px) {
  .session-header-row {
    /* Allow flexbox to accommodate multi-line session names */
    align-items: flex-start;
    min-height: auto;
    padding-top: 0.25rem; /* Align star button with first line of text */
  }

  .session-name {
    font-size: 1rem; /* Slightly smaller on mobile */
  }
}

/* PR URL editing styles */
.pr-edit-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.pr-url-input {
  background: var(--color-bg-input, #1e1e1e);
  border: 1px solid var(--color-border, #333);
  border-radius: 4px;
  padding: 0.375rem 0.5rem;
  font-size: 0.8125rem;
  color: var(--color-text, #e0e0e0);
  min-width: 280px;
  max-width: 400px;
}

.pr-url-input:focus {
  outline: none;
  border-color: var(--color-primary, #00bcd4);
}

.pr-url-input::placeholder {
  color: var(--color-text-soft, #888);
}

.pr-edit-btn {
  width: 28px;
  height: 28px;
  border-radius: 4px;
}

.pr-save-btn {
  color: var(--color-success, #4caf50);
}

.pr-save-btn:hover {
  background: rgba(76, 175, 80, 0.1);
}

.pr-cancel-btn {
  color: var(--color-text-soft, #888);
}

.pr-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.pr-clear-btn {
  color: var(--color-error, #f44336);
}

.pr-clear-btn:hover {
  background: rgba(244, 67, 54, 0.1);
}

.pr-edit-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  color: var(--color-text-soft, #888);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.25rem 0.375rem;
  border-radius: 4px;
  transition: color 0.15s, background-color 0.15s;
}

.pr-edit-trigger:hover {
  color: var(--color-primary, #00bcd4);
  background: rgba(0, 188, 212, 0.1);
}

.btn-link {
  background: none;
  border: none;
  cursor: pointer;
}

@media (max-width: 480px) {
  .pr-url-input {
    min-width: 180px;
    max-width: 100%;
  }

  .pr-edit-form {
    flex-wrap: wrap;
  }
}
</style>
