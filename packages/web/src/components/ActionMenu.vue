<template>
  <div class="action-menu-container" ref="containerRef">
    <button
      class="btn-kebab"
      :aria-label="ariaLabel"
      :aria-expanded="isOpen.toString()"
      aria-haspopup="menu"
      @click="toggleMenu"
    >
      {{ triggerIcon }}
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
            @click="handleItemClick(item.action)"
            @mouseenter="highlightedIndex = index"
            @mouseleave="highlightedIndex = null"
          >
            <span v-if="item.icon" class="menu-item-icon">{{ item.icon }}</span>
            <span class="menu-item-text">{{ item.label }}</span>
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, defineExpose } from 'vue';

const emit = defineEmits(['action-click']);

const props = defineProps({
  items: {
    type: Array,
    required: true,
    validator: (items) => {
      return items.every(item =>
        Object.prototype.hasOwnProperty.call(item, 'icon') &&
        Object.prototype.hasOwnProperty.call(item, 'label') &&
        Object.prototype.hasOwnProperty.call(item, 'action')
      );
    }
  },
  ariaLabel: {
    type: String,
    default: 'More actions'
  },
  triggerIcon: {
    type: String,
    default: '⋮'
  }
});

const isOpen = ref(false);
const containerRef = ref(null);
const highlightedIndex = ref(null);

function toggleMenu() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    highlightedIndex.value = 0;
  } else {
    highlightedIndex.value = null;
  }
}

function closeMenu() {
  isOpen.value = false;
  highlightedIndex.value = null;
}

function handleOutsideClick() {
  // Overlay was clicked - close the menu
  closeMenu();
}

function handleItemClick(action) {
  emit('action-click', action);
  closeMenu();
}

function handleKeyDown(event) {
  switch (event.key) {
    case 'ArrowDown': {
      event.preventDefault();
      const totalItems = props.items.length;
      highlightedIndex.value = highlightedIndex.value === null ? 0 : (highlightedIndex.value + 1) % totalItems;
      break;
    }
    case 'ArrowUp': {
      event.preventDefault();
      const totalItems = props.items.length;
      highlightedIndex.value = highlightedIndex.value === null ? totalItems - 1 : (highlightedIndex.value - 1 + totalItems) % totalItems;
      break;
    }
    case 'Enter':
      event.preventDefault();
      if (highlightedIndex.value !== null && props.items[highlightedIndex.value]) {
        handleItemClick(props.items[highlightedIndex.value].action);
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

// Expose methods and state for testing
defineExpose({
  isOpen,
  highlightedIndex,
  toggleMenu,
  closeMenu,
  handleItemClick,
  handleOutsideClick,
  handleKeyDown
});
</script>

<style scoped>
.action-menu-container {
  position: relative;
  display: inline-block;
  flex-shrink: 0;
}

.btn-kebab {
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
  font-size: 1.25rem;
  line-height: 1;
  flex-shrink: 0;
}

.btn-kebab:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text, #ccc);
}

.btn-kebab:active {
  background: rgba(255, 255, 255, 0.15);
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
