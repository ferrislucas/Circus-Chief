<template>
  <div class="canvas-file-list">
    <!-- Header with select all checkbox - hidden when bulk toolbar is showing -->
    <div class="list-header" v-if="showSelectionUI && selectedCount === 0">
      <input
        type="checkbox"
        class="select-all-checkbox"
        :checked="isAllSelected"
        :indeterminate="isPartialSelection"
        @change="toggleSelectAll"
        :disabled="isOperationInProgress"
        aria-label="Select all items"
      />
      <span class="header-label">Items</span>
    </div>

    <div
      v-for="item in items"
      :key="item.id"
      class="file-row"
      :class="{ selected: isItemSelected(item.id) }"
      @click="handleRowClick(item.id)"
    >
      <!-- Checkbox for selection -->
      <input
        v-if="showSelectionUI"
        type="checkbox"
        class="item-checkbox"
        :checked="isItemSelected(item.id)"
        @change="toggleItemSelection(item.id)"
        @click.stop
        :disabled="isOperationInProgress"
        :aria-label="`Select ${item.filename || 'item'}`"
      />

      <span class="file-name">{{ item.filename || 'Untitled' }}</span>

      <!-- Three-dot menu -->
      <div class="file-menu-container" :ref="el => setMenuContainerRef(el, item.id)">
        <button
          class="btn-menu"
          aria-label="File actions"
          :aria-expanded="(openMenuItemId === item.id).toString()"
          aria-haspopup="menu"
          @click="toggleMenu(item.id, $event)"
        >
          ⋮
        </button>

        <Transition name="fade">
          <div v-if="openMenuItemId === item.id" class="menu-overlay" @click.stop="closeMenu"></div>
        </Transition>

        <Transition name="slide">
          <ul v-if="openMenuItemId === item.id" class="file-menu-items" role="menu">
            <li role="none">
              <button class="menu-item" role="menuitem" @click.stop="handleMenuCopyFilename(item)">
                <span class="menu-item-icon">📝</span>
                <span class="menu-item-text">Copy filename</span>
              </button>
            </li>
            <li role="none" class="menu-divider"></li>
            <li role="none">
              <button class="menu-item is-danger" role="menuitem" @click.stop="handleMenuDelete(item)">
                <span class="menu-item-icon">🗑</span>
                <span class="menu-item-text">Delete file</span>
              </button>
            </li>
          </ul>
        </Transition>
      </div>

      <span v-if="item.versionCount > 1" class="version-badge">
        v{{ item.versionCount }}
      </span>
      <span class="file-time">{{ formatRelativeTime(item.updatedAt) }}</span>
      <span class="file-arrow">&#8250;</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useCanvasStore } from '../stores/canvas.js';

const canvasStore = useCanvasStore();

const props = defineProps({
  items: {
    type: Array,
    required: true,
  },
  sessionId: {
    type: String,
    required: true,
  },
  showSelectionUI: {
    type: Boolean,
    default: true,
  },
});

const emit = defineEmits(['select', 'deleteItem']);

const isOperationInProgress = computed(() => canvasStore.bulkOperationInProgress);
const selectedCount = computed(() => canvasStore.selectedItemCount);
const isAllSelected = computed(() => canvasStore.isAllItemsSelected);
const isPartialSelection = computed(() => canvasStore.isPartialSelection);

function isItemSelected(itemId) {
  return canvasStore.selectedItemIds.has(itemId);
}

function toggleItemSelection(itemId) {
  canvasStore.toggleItemSelection(itemId);
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    canvasStore.deselectAllItems();
  } else {
    canvasStore.selectAllItems();
  }
}

function handleRowClick(itemId) {
  // Only emit select if item not already selected, or if shift/ctrl not held
  if (!isItemSelected(itemId) || !canvasStore.selectedItemCount) {
    // Clear selection when clicking item
    canvasStore.deselectAllItems();
    // Emit select to parent to view the item
    emit('select', itemId);
  }
}

const copiedItemId = ref(null);
const openMenuItemId = ref(null);
const menuHighlightedIndex = ref(null);
const menuContainerRefs = ref({});

function setMenuContainerRef(el, itemId) {
  if (el) menuContainerRefs.value[itemId] = el;
}

// Copy to clipboard with fallback
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback for older browsers / mobile
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch (fallbackErr) {
      console.error('Copy failed:', fallbackErr);
      return false;
    }
  }
}

function showCopiedFeedback(itemId) {
  copiedItemId.value = itemId;
  setTimeout(() => {
    copiedItemId.value = null;
  }, 1500);
}

// Menu functions
function toggleMenu(itemId, event) {
  event.stopPropagation();
  openMenuItemId.value = openMenuItemId.value === itemId ? null : itemId;
  menuHighlightedIndex.value = openMenuItemId.value ? 0 : null;
}

function closeMenu() {
  openMenuItemId.value = null;
  menuHighlightedIndex.value = null;
}

async function handleMenuCopyFilename(item) {
  await copyToClipboard(item.filename || 'Untitled');
  showCopiedFeedback(item.id);
  closeMenu();
}

function handleMenuDelete(item) {
  emit('deleteItem', item);
  closeMenu();
}

function handleDocumentClick(event) {
  if (openMenuItemId.value) {
    const container = menuContainerRefs.value[openMenuItemId.value];
    if (container && !container.contains(event.target)) {
      closeMenu();
    }
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
});

function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

// Expose functions for testing
defineExpose({
  toggleMenu,
  closeMenu,
  handleMenuCopyFilename,
  handleMenuDelete,
  handleDocumentClick,
});
</script>

<style scoped>
.canvas-file-list {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  cursor: pointer;
  transition: background-color 0.15s;
  min-height: 48px;
}

.file-row:hover {
  background: var(--color-background-mute);
}

.file-name {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  word-break: break-word;
}

.version-badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.4rem;
  background: var(--color-primary);
  color: white;
  border-radius: 9999px;
  font-weight: 600;
  flex-shrink: 0;
}

.file-time {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  flex-shrink: 0;
}

.file-arrow {
  color: var(--color-text-soft);
  font-size: 1.25rem;
  flex-shrink: 0;
}

/* File menu container and button */
.file-menu-container {
  position: relative;
  display: inline-block;
  flex-shrink: 0;
}

.btn-menu {
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

.btn-menu:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text, #ccc);
}

.btn-menu:active {
  background: rgba(255, 255, 255, 0.15);
}

/* Menu overlay and items */
.menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 99;
}

.file-menu-items {
  position: absolute;
  top: 100%;
  right: 0;
  min-width: 200px;
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
  list-style: none;
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

/* List header styles for selection UI */
.list-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  margin-bottom: 0.5rem;
  font-weight: 600;
  font-size: 0.9rem;
}

.select-all-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
}

.select-all-checkbox:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.header-label {
  flex: 1;
}

.selection-count {
  color: var(--color-text-soft);
  font-size: 0.85rem;
  font-weight: normal;
  margin-left: auto;
}

/* Checkbox styles */
.item-checkbox {
  width: 18px;
  height: 18px;
  cursor: pointer;
  flex-shrink: 0;
  margin: 0;
}

.item-checkbox:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Selected row styling */
.file-row.selected {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
}

.file-row.selected:hover {
  background: rgba(34, 197, 94, 0.15);
}

/* Mobile styles */
@media (max-width: 640px) {
  .file-row {
    padding: 0.875rem 1rem;
    flex-wrap: nowrap;
  }

  .file-name {
    flex: 1;
    min-width: 0;
    word-break: break-word;
  }

  .file-time {
    font-size: 0.6875rem;
  }

  .btn-menu {
    width: 44px;
    height: 44px;
  }

  .file-menu-items {
    min-width: 180px;
  }

  .item-checkbox {
    width: 16px;
    height: 16px;
  }

  .select-all-checkbox {
    width: 16px;
    height: 16px;
  }
}
</style>
