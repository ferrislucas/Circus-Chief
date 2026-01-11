<template>
  <div class="overflow-menu-container" ref="containerRef">
    <button
      class="btn-kebab"
      :aria-label="ariaLabel"
      :aria-expanded="isOpen.toString()"
      aria-haspopup="menu"
      @click="toggleMenu"
    >
      ⋮
    </button>

    <Transition name="fade">
      <div
        v-if="isOpen"
        class="menu-overlay"
        @click="handleOutsideClick"
      ></div>
    </Transition>

    <Transition name="slide">
      <ul
        v-if="isOpen"
        class="menu-items"
        role="menu"
        @keydown="handleKeyDown"
      >
        <li
          v-for="(item, index) in items"
          :key="index"
          role="none"
        >
          <button
            :class="['menu-item', { 'is-danger': item.isDanger, 'is-highlighted': highlightedIndex === index }]"
            role="menuitem"
            @click="handleItemClick(item, index)"
            @mouseenter="highlightedIndex = index"
            @mouseleave="highlightedIndex = null"
          >
            <span v-if="item.icon" class="menu-item-icon">{{ item.icon }}</span>
            <span class="menu-item-text">{{ item.text }}</span>
          </button>
        </li>
        <li v-if="showDivider" role="none" class="menu-divider"></li>
        <li role="none">
          <button
            :class="['menu-item', 'is-danger', { 'is-highlighted': highlightedIndex === items.length }]"
            role="menuitem"
            @click="handleDelete"
            @mouseenter="highlightedIndex = items.length"
            @mouseleave="highlightedIndex = null"
          >
            <span class="menu-item-icon">🗑</span>
            <span class="menu-item-text">{{ deleteText }}</span>
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

const emit = defineEmits(['duplicate', 'archive', 'delete']);

const props = defineProps({
  ariaLabel: {
    type: String,
    default: 'More actions'
  },
  duplicateText: {
    type: String,
    default: 'Duplicate'
  },
  archiveText: {
    type: String,
    default: 'Archive'
  },
  deleteText: {
    type: String,
    default: 'Delete'
  },
  showDivider: {
    type: Boolean,
    default: true
  }
});

const isOpen = ref(false);
const containerRef = ref(null);
const highlightedIndex = ref(null);

const items = computed(() => [
  { text: props.duplicateText, icon: '⟳', isDanger: false },
  { text: props.archiveText, icon: '📦', isDanger: false }
]);

function toggleMenu() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    highlightedIndex.value = 0;
  }
}

function closeMenu() {
  isOpen.value = false;
  highlightedIndex.value = null;
}

function handleOutsideClick(event) {
  // Only close if click is outside the menu
  if (containerRef.value && !containerRef.value.contains(event.target)) {
    closeMenu();
  }
}

function handleItemClick(item, index) {
  if (item.text === props.duplicateText) {
    emit('duplicate');
  } else if (item.text === props.archiveText) {
    emit('archive');
  }
  closeMenu();
}

function handleDelete() {
  emit('delete');
  closeMenu();
}

function handleKeyDown(event) {
  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      const totalItems = items.value.length + 1; // +1 for delete button
      highlightedIndex.value = highlightedIndex.value === null ? 0 : (highlightedIndex.value + 1) % totalItems;
      break;
    case 'ArrowUp':
      event.preventDefault();
      const totalItemsUp = items.value.length + 1;
      highlightedIndex.value = highlightedIndex.value === null ? totalItemsUp - 1 : (highlightedIndex.value - 1 + totalItemsUp) % totalItemsUp;
      break;
    case 'Enter':
      event.preventDefault();
      if (highlightedIndex.value !== null) {
        if (highlightedIndex.value < items.value.length) {
          handleItemClick(items.value[highlightedIndex.value], highlightedIndex.value);
        } else {
          handleDelete();
        }
      }
      break;
    case 'Escape':
      event.preventDefault();
      closeMenu();
      break;
    case 'Tab':
      closeMenu();
      break;
  }
}

function handleDocumentClick(event) {
  if (containerRef.value && !containerRef.value.contains(event.target)) {
    closeMenu();
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
});
</script>

<style scoped>
.overflow-menu-container {
  position: relative;
  display: inline-block;
}

.btn-kebab {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--color-text-soft, #888);
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 1rem;
  line-height: 1;
  flex-shrink: 0;
}

.btn-kebab:hover {
  background: var(--color-bg-hover, #555);
  color: var(--color-text, #ccc);
}

.menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99;
}

.menu-items {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 160px;
  margin-top: 0.5rem;
  padding: 0.25rem 0;
  list-style: none;
  background: var(--color-bg-secondary, #222);
  border: 1px solid var(--color-border, #444);
  border-radius: 6px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
  z-index: 100;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.5rem 1rem;
  border: none;
  background: transparent;
  color: var(--color-text, #ccc);
  cursor: pointer;
  text-align: left;
  font-size: 0.875rem;
  transition: all 0.15s ease;
}

.menu-item:hover {
  background: var(--color-bg-hover, #333);
}

.menu-item.is-highlighted {
  background: var(--color-bg-hover, #333);
}

.menu-item.is-danger {
  color: var(--color-error, #f87171);
}

.menu-item.is-danger:hover {
  background: rgba(248, 113, 113, 0.1);
}

.menu-item-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.menu-item-text {
  flex: 1;
  font-weight: 500;
}

.menu-divider {
  height: 1px;
  background: var(--color-border, #444);
  margin: 0.25rem 0;
}

/* Transitions */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-enter-active,
.slide-leave-active {
  transition: all 0.15s ease;
}

.slide-enter-from {
  opacity: 0;
  transform: translateY(-4px);
}

.slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
