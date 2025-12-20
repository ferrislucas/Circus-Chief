<template>
  <div
    v-if="isVisible"
    class="slash-command-autocomplete"
    role="listbox"
    :aria-activedescendant="selectedCommand ? `cmd-${selectedIndex}` : undefined"
  >
    <div v-if="loading" class="autocomplete-loading">
      <span class="loading-spinner"></span>
      Loading commands...
    </div>

    <div v-else-if="filteredCommands.length === 0" class="autocomplete-empty">
      No matching commands
    </div>

    <div v-else class="autocomplete-list" ref="listRef">
      <div
        v-for="(command, index) in filteredCommands"
        :key="command.name"
        :id="`cmd-${index}`"
        :class="['autocomplete-item', { selected: index === selectedIndex }]"
        :ref="el => { if (index === selectedIndex) selectedEl = el }"
        role="option"
        :aria-selected="index === selectedIndex"
        @click="$emit('select', command)"
        @mouseenter="$emit('highlight', index)"
      >
        <div class="command-info">
          <span class="command-name">/{{ command.name }}</span>
          <span :class="['command-source', `source-${command.source}`]">
            {{ command.source }}
          </span>
        </div>
        <div v-if="command.description" class="command-description">
          {{ command.description }}
        </div>
        <div v-if="command.argumentHint" class="command-hint">
          Argument: {{ command.argumentHint }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue';

const props = defineProps({
  isVisible: {
    type: Boolean,
    required: true,
  },
  filteredCommands: {
    type: Array,
    required: true,
  },
  selectedIndex: {
    type: Number,
    default: 0,
  },
  loading: {
    type: Boolean,
    default: false,
  },
});

const selectedCommand = ref(null);
const selectedEl = ref(null);
const listRef = ref(null);

defineEmits(['select', 'highlight']);

// Watch for selected index changes to scroll into view
watch(() => props.selectedIndex, () => {
  nextTick(() => {
    if (selectedEl.value && listRef.value) {
      selectedEl.value.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });
});

// Update selected command when filtered commands or index changes
watch([() => props.filteredCommands, () => props.selectedIndex], () => {
  selectedCommand.value = props.filteredCommands[props.selectedIndex] || null;
}, { immediate: true });
</script>

<style scoped>
.slash-command-autocomplete {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  max-height: 300px;
  overflow-y: auto;
  background-color: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  margin-bottom: 0.5rem;
  z-index: 100;
}

.autocomplete-loading,
.autocomplete-empty {
  padding: 1rem;
  text-align: center;
  color: var(--color-text-soft);
  font-size: 0.875rem;
}

.autocomplete-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.autocomplete-list {
  max-height: 280px;
  overflow-y: auto;
}

.autocomplete-item {
  padding: 0.75rem 1rem;
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
  transition: background-color 0.1s;
}

.autocomplete-item:last-child {
  border-bottom: none;
}

.autocomplete-item.selected {
  background-color: var(--color-background-mute);
}

.autocomplete-item:hover {
  background-color: var(--color-background-mute);
}

.command-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.command-name {
  font-weight: 600;
  font-family: var(--font-mono);
  color: var(--color-primary);
}

.command-source {
  font-size: 0.625rem;
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  text-transform: uppercase;
  font-weight: 500;
}

.source-builtin {
  background-color: rgba(88, 166, 255, 0.2);
  color: var(--color-primary);
}

.source-project {
  background-color: rgba(63, 185, 80, 0.2);
  color: var(--color-success);
}

.source-user {
  background-color: rgba(210, 153, 34, 0.2);
  color: var(--color-warning);
}

.command-description {
  font-size: 0.875rem;
  color: var(--color-text-soft);
  margin-top: 0.25rem;
}

.command-hint {
  font-size: 0.75rem;
  font-family: var(--font-mono);
  color: var(--color-text-soft);
  margin-top: 0.25rem;
  opacity: 0.7;
}
</style>
