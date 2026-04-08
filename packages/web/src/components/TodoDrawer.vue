<template>
  <!-- Only render if todos exist -->
  <div v-if="todosStore.hasTodos" class="todo-drawer">
    <div class="todo-header" @click="todosStore.toggleExpanded">
      <span class="todo-label">Todos</span>
      <span v-if="!todosStore.expanded" class="todo-summary">
        <span
          v-for="todo in previewTodos"
          :key="todo.id"
          class="todo-chip"
        >
          <span :class="['status-icon', `status-${todo.status}`]"></span>
          <span class="todo-text">{{ truncate(todo.content, 20) }}</span>
        </span>
        <span v-if="todosStore.items.length > 4" class="todo-more">
          (+{{ todosStore.items.length - 4 }} more)
        </span>
      </span>
      <span v-else class="todo-counts">
        <span v-if="todosStore.completedCount" class="count completed">
          {{ todosStore.completedCount }} done
        </span>
        <span v-if="todosStore.inProgressCount" class="count in-progress">
          {{ todosStore.inProgressCount }} active
        </span>
        <span v-if="todosStore.pendingCount" class="count pending">
          {{ todosStore.pendingCount }} pending
        </span>
      </span>
      <button class="expand-toggle" :title="todosStore.expanded ? 'Collapse' : 'Expand'">
        {{ todosStore.expanded ? '▼' : '▲' }}
      </button>
    </div>

    <div v-if="todosStore.expanded" class="todo-list">
      <div
        v-for="todo in todosStore.items"
        :key="todo.id"
        :class="['todo-item', `todo-${todo.status}`]"
      >
        <span :class="['status-icon', `status-${todo.status}`]"></span>
        <span class="todo-content">{{ todo.content }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useInjectedTodosStore } from '../composables/useOverlayStore.js';

const todosStore = useInjectedTodosStore();

const previewTodos = computed(() => todosStore.items.slice(0, 4));

function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
</script>

<style scoped>
.todo-drawer {
  border-top: 1px solid var(--color-border);
  background-color: var(--color-background-soft);
}

.todo-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
  user-select: none;
}

.todo-header:hover {
  background-color: var(--color-background-mute);
}

.todo-label {
  font-weight: 600;
  font-size: 0.875rem;
  color: var(--color-text);
}

.todo-summary {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
  overflow: hidden;
}

.todo-chip {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.75rem;
  color: var(--color-text-soft);
  white-space: nowrap;
}

.todo-text {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.todo-more {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  white-space: nowrap;
}

.todo-counts {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex: 1;
}

.count {
  font-size: 0.75rem;
}

.count.completed {
  color: var(--color-success, #10b981);
}

.count.in-progress {
  color: var(--color-accent, #22d3ee);
}

.count.pending {
  color: var(--color-text-soft);
}

.expand-toggle {
  background: none;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  padding: 0.25rem;
  font-size: 0.75rem;
  line-height: 1;
}

.expand-toggle:hover {
  color: var(--color-text);
}

.todo-list {
  padding: 0.5rem 1rem 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  max-height: 200px;
  overflow-y: auto;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  font-size: 0.875rem;
  padding: 0.25rem 0;
}

.todo-item.todo-completed {
  opacity: 0.6;
}

.todo-item.todo-completed .todo-content {
  text-decoration: line-through;
}

.todo-content {
  flex: 1;
  color: var(--color-text);
}

/* Status icons */
.status-icon {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 2px;
}

.status-icon.status-pending {
  border: 2px solid var(--color-text-soft);
  background: transparent;
}

.status-icon.status-in_progress {
  border: 2px solid var(--color-accent, #22d3ee);
  background: linear-gradient(
    to right,
    var(--color-accent, #22d3ee) 50%,
    transparent 50%
  );
}

.status-icon.status-completed {
  border: 2px solid var(--color-success, #10b981);
  background-color: var(--color-success, #10b981);
}
</style>
