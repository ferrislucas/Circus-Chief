<template>
  <div class="session-header-actions">
    <div class="session-date">
      {{ formatDate(dateToShow) }}
    </div>
    <!-- Action buttons (always visible on root sessions, not on child sessions) -->
    <div v-if="!isChild" class="archive-actions">
      <!-- Add to Board button (only show if kanban is enabled and session is not already on board) -->
      <button
        v-if="kanbanEnabled && !isOnBoard"
        class="add-to-board-btn"
        title="Add to kanban board"
        @click.stop.prevent="$emit('addToBoard')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="9" y1="3" x2="9" y2="21"></line>
          <line x1="15" y1="3" x2="15" y2="21"></line>
        </svg>
      </button>
      <button
        v-if="showArchive && canArchive"
        class="archive-btn"
        title="Archive session"
        @click.stop.prevent="onArchiveClick"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="4" width="20" height="5" rx="1" ry="1"></rect>
          <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"></path>
          <path d="M10 13h4"></path>
        </svg>
      </button>
      <button
        v-if="showUnarchive"
        class="archive-btn"
        title="Unarchive session"
        @click.stop.prevent="onUnarchiveClick"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="4" width="20" height="5" rx="1" ry="1"></rect>
          <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9"></path>
          <path d="M12 11v6"></path>
          <path d="M9 14l3-3 3 3"></path>
        </svg>
      </button>
      <!-- Star button in actions (for mobile layout) -->
      <button
        class="star-btn star-btn-mobile"
        :title="starred ? 'Unstar session' : 'Star session'"
        @click.stop.prevent="$emit('star')"
      >
        <svg v-if="starred" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2"></polygon>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 10.26 24 10.5 17.18 16.34 19.34 24.5 12 18.92 4.66 24.5 6.82 16.34 0 10.5 8.91 10.26 12 2"></polygon>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { formatDate } from '../utils/formatters.js';

const props = defineProps({
  dateToShow: {
    type: String,
    default: null,
  },
  isChild: {
    type: Boolean,
    default: false,
  },
  isOnBoard: {
    type: Boolean,
    default: false,
  },
  kanbanEnabled: {
    type: Boolean,
    default: true,
  },
  showArchive: {
    type: Boolean,
    default: false,
  },
  showUnarchive: {
    type: Boolean,
    default: false,
  },
  sessionStatus: {
    type: String,
    default: '',
  },
  starred: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['archive', 'unarchive', 'star', 'addToBoard']);

const canArchive = computed(() => {
  return props.sessionStatus !== 'running' && props.sessionStatus !== 'starting';
});

const onArchiveClick = () => {
  emit('archive');
};

const onUnarchiveClick = () => {
  if (confirm('Restore this session to active?')) {
    emit('unarchive');
  }
};
</script>

<style scoped>
.session-header-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.5rem;
  flex-shrink: 0;
}

.session-date {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.archive-actions {
  display: flex;
  gap: 0.25rem;
}

.archive-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-soft);
  border-radius: var(--border-radius);
  transition: color 0.15s, background-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.archive-btn:hover {
  color: var(--color-primary);
  background-color: var(--color-bg-soft);
}

.add-to-board-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-soft);
  border-radius: var(--border-radius);
  transition: color 0.15s, background-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.add-to-board-btn:hover {
  color: var(--color-primary);
  background-color: var(--color-bg-soft);
}

.star-btn {
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--color-text-soft);
  border-radius: var(--border-radius);
  transition: color 0.15s, background-color 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.star-btn:hover {
  color: var(--color-primary);
  background-color: var(--color-bg-soft);
}

/* Hide mobile star button on desktop */
.star-btn-mobile {
  display: none;
}

@media (max-width: 480px) {
  /* Group archive actions and mobile star button together */
  .archive-actions {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  /* Show star button in actions area on mobile */
  .star-btn-mobile {
    display: flex !important;
  }

  /* Compact date display */
  .session-date {
    font-size: 0.75rem;
  }

  .session-header-actions {
    flex-direction: row;
    align-items: center;
    width: 100%;
    justify-content: space-between;
  }
}
</style>
