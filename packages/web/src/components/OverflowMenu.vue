<template>
  <div
    ref="containerRef"
    class="overflow-menu-container"
  >
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
      />
    </Transition>

    <Transition name="slide">
      <ul
        v-if="isOpen"
        ref="menuRef"
        class="menu-items"
        role="menu"
        :style="menuStyle"
        @keydown="handleKeyDown"
      >
        <li
          v-for="(item, index) in items"
          :key="index"
          role="none"
        >
          <button
            :class="['menu-item', { 'is-danger': item.isDanger, 'is-highlighted': highlightedIndex === index, 'is-disabled': isDeleting }]"
            role="menuitem"
            :disabled="isDeleting"
            @click="handleItemClick(item, index)"
            @mouseenter="!isDeleting && (highlightedIndex = index)"
            @mouseleave="highlightedIndex = null"
          >
            <span
              v-if="item.icon"
              class="menu-item-icon"
            >{{ item.icon }}</span>
            <span class="menu-item-text">{{ item.text }}</span>
          </button>
        </li>
        <li
          v-if="showDivider"
          role="none"
          class="menu-divider"
        />
        <li role="none">
          <button
            :class="['menu-item', 'is-danger', { 'is-highlighted': highlightedIndex === items.length, 'is-disabled': isDeleting }]"
            role="menuitem"
            :disabled="isDeleting"
            @click="handleDelete"
            @mouseenter="!isDeleting && (highlightedIndex = items.length)"
            @mouseleave="highlightedIndex = null"
          >
            <span
              v-if="isDeleting"
              class="menu-item-spinner"
            />
            <span
              v-else
              class="menu-item-icon"
            >🗑</span>
            <span class="menu-item-text">{{ isDeleting ? 'Deleting...' : deleteText }}</span>
          </button>
        </li>
      </ul>
    </Transition>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick, defineExpose } from 'vue';

const emit = defineEmits(['duplicate', 'archive', 'copySessionId', 'delete']);

const props = defineProps({
  ariaLabel: {
    type: String,
    default: 'More actions'
  },
  duplicateText: {
    type: String,
    default: 'Duplicate'
  },
  copySessionIdText: {
    type: String,
    default: null
  },
  archiveText: {
    type: String,
    default: null
  },
  isArchived: {
    type: Boolean,
    default: false
  },
  isDeleting: {
    type: Boolean,
    default: false
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
const menuRef = ref(null);
const highlightedIndex = ref(null);
const menuStyle = ref({});

const archiveText = computed(() => {
  if (props.archiveText !== null) {
    return props.archiveText;
  }
  // Default behavior: show "Archive" or "Unarchive" based on archived state
  return props.isArchived ? 'Unarchive' : 'Archive';
});

const items = computed(() => {
  const baseItems = [
    { text: archiveText.value, icon: '📦', isDanger: false },
    { text: props.duplicateText, icon: '⟳', isDanger: false }
  ];
  if (props.copySessionIdText) {
    baseItems.push({ text: props.copySessionIdText, icon: '📋', isDanger: false });
  }
  return baseItems;
});

async function updateMenuPosition() {
  await nextTick();
  const menuEl = menuRef.value;
  if (!menuEl) return;

  // Get the menu's bounding rectangle
  const rect = menuEl.getBoundingClientRect();

  // Default: anchor right edge to container right edge
  const style = {};

  // If menu overflows left edge of viewport, flip to left-anchored
  if (rect.left < 0) {
    style.right = 'auto';
    style.left = '0';
  }

  // If menu overflows right edge of viewport, ensure right-anchored
  if (rect.right > window.innerWidth) {
    style.left = 'auto';
    style.right = '0';
  }

  menuStyle.value = style;
}

function toggleMenu() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    highlightedIndex.value = 0;
    updateMenuPosition();
  }
}

function closeMenu() {
  isOpen.value = false;
  highlightedIndex.value = null;
  menuStyle.value = {};
}

function handleOutsideClick() {
  // Overlay was clicked - close the menu
  closeMenu();
}

function handleItemClick(item, index) {
  if (index === 0) {
    // First item is always Archive/Unarchive
    emit('archive');
  } else if (index === 1) {
    // Second item is always Duplicate
    emit('duplicate');
  } else if (index === 2 && props.copySessionIdText) {
    // Third item is Copy Session ID (if provided)
    emit('copySessionId');
  }
  closeMenu();
}

function handleDelete() {
  emit('delete');
  closeMenu();
}

function handleKeyDown(event) {
  switch (event.key) {
    case 'ArrowDown': {
      event.preventDefault();
      const totalItems = items.value.length + 1; // +1 for delete button
      highlightedIndex.value = highlightedIndex.value === null ? 0 : (highlightedIndex.value + 1) % totalItems;
      break;
    }
    case 'ArrowUp': {
      event.preventDefault();
      const totalItemsUp = items.value.length + 1;
      highlightedIndex.value = highlightedIndex.value === null ? totalItemsUp - 1 : (highlightedIndex.value - 1 + totalItemsUp) % totalItemsUp;
      break;
    }
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

// Expose methods and state for testing
defineExpose({
  isOpen,
  highlightedIndex,
  menuStyle,
  toggleMenu,
  closeMenu,
  handleItemClick,
  handleOutsideClick,
  handleDelete,
  handleKeyDown
});
</script>

<style scoped>
.overflow-menu-container {
  position: relative;
  display: inline-block;
  margin-left: auto; /* Push to right side of flex container */
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

.menu-item.is-disabled {
  opacity: 0.5;
  cursor: not-allowed;
  pointer-events: none;
}

.menu-item.is-disabled:hover {
  background: transparent;
}

.menu-item-icon {
  font-size: 1rem;
  flex-shrink: 0;
}

.menu-item-spinner {
  display: inline-block;
  width: 1rem;
  height: 1rem;
  border: 2px solid rgba(248, 113, 113, 0.3);
  border-top-color: #f87171;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
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
