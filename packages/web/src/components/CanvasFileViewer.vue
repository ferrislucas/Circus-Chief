<template>
  <div class="canvas-file-viewer">
    <!-- Header -->
    <div class="viewer-header">
      <div class="viewer-header-left">
        <!-- Breadcrumb navigation - only visible when there are multiple items to go back to -->
        <button
          v-if="showBackButton"
          class="breadcrumb-back"
          @click="handleBack"
        >
          ← Canvas
        </button>
        <span v-if="showBackButton" class="breadcrumb-separator">/</span>
        <div class="viewer-filename-wrapper">
          <span class="viewer-filename">{{ item.filename || 'Untitled' }}</span>
          <span class="viewer-meta">{{ formatLastModified(item.updatedAt) }}</span>
        </div>
      </div>

      <div class="viewer-header-right">
        <!-- Version dropdown -->
        <details
          v-if="versions.length > 1"
          class="version-dropdown"
        >
          <summary class="version-badge">
            v{{ versions.length - currentVersionIndex }}
            <span class="dropdown-arrow">&#9662;</span>
          </summary>
          <ul class="version-list">
            <li
              v-for="(v, index) in versions"
              :key="v.id"
              :class="{ active: v.id === item.id }"
              @click="selectVersion(v.id)"
            >
              <span class="version-number">v{{ versions.length - index }}</span>
              <span class="version-time">{{ formatRelativeTime(v.createdAt) }}</span>
              <span v-if="v.id === item.id" class="version-current">(current)</span>
            </li>
          </ul>
        </details>

        <!-- Three-dot menu -->
        <div class="file-menu-container" ref="menuContainerRef">
          <button
            class="btn-menu"
            :aria-label="'File actions'"
            :aria-expanded="menuOpen.toString()"
            aria-haspopup="menu"
            @click="toggleMenu"
          >
            ⋮
          </button>

          <Transition name="fade">
            <div
              v-if="menuOpen"
              class="menu-overlay"
              @click="closeMenu"
            ></div>
          </Transition>

          <Transition name="slide">
            <ul
              v-if="menuOpen"
              class="file-menu-items"
              role="menu"
              @keydown="handleMenuKeyDown"
            >
              <li role="none">
                <button
                  :class="['menu-item', { 'is-highlighted': menuHighlightedIndex === 0 }]"
                  role="menuitem"
                  @click="handleMenuCopyFilename"
                  @mouseenter="menuHighlightedIndex = 0"
                  @mouseleave="menuHighlightedIndex = null"
                >
                  <span class="menu-item-icon">📝</span>
                  <span class="menu-item-text">Copy filename</span>
                </button>
              </li>
              <li role="none" class="menu-divider"></li>
              <li role="none">
                <button
                  :class="['menu-item', 'is-danger', { 'is-highlighted': menuHighlightedIndex === 1 }]"
                  role="menuitem"
                  @click="handleMenuDeleteAll"
                  @mouseenter="menuHighlightedIndex = 1"
                  @mouseleave="menuHighlightedIndex = null"
                >
                  <span class="menu-item-icon">🗑</span>
                  <span class="menu-item-text">Delete file</span>
                </button>
              </li>
            </ul>
          </Transition>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div class="viewer-content">
      <!-- Loading state while fetching content -->
      <div v-if="contentLoading" class="content-loading">
        <span class="loading-spinner"></span>
        Loading content...
      </div>

      <template v-else>
        <img
          v-if="item.type === 'image'"
          :src="`data:${item.mimeType};base64,${item.data}`"
          :alt="item.filename || 'Image'"
          class="viewer-image"
        />

        <MarkdownViewer
          v-if="item.type === 'markdown'"
          :content="item.content"
          class="viewer-markdown"
        />

        <pre v-else-if="item.type === 'json'" class="viewer-json">{{ formatJson(item.data) }}</pre>

        <div v-else-if="item.type === 'text'" class="viewer-text">{{ item.content }}</div>

        <pre v-else-if="item.type === 'code'" class="hljs viewer-code"><code v-html="highlightedCode"></code></pre>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import MarkdownViewer from './MarkdownViewer.vue';
import hljs from 'highlight.js';
import { useCanvasStore } from '../stores/canvas.js';

// Map file extensions to highlight.js language names
const EXT_TO_LANG = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'javascript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  scala: 'scala',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  vue: 'xml',
  svelte: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  xml: 'xml',
  json: 'json',
};

const props = defineProps({
  item: {
    type: Object,
    required: true,
  },
  sessionId: {
    type: String,
    required: true,
  },
  versions: {
    type: Array,
    default: () => [],
  },
  showBackButton: {
    type: Boolean,
    default: true,
  },
});

const canvasStore = useCanvasStore();

const emit = defineEmits(['back', 'selectVersion', 'deleteAll']);

const menuOpen = ref(false);
const menuHighlightedIndex = ref(null);
const menuContainerRef = ref(null);
const contentLoading = ref(false);

// Watch the item's id to handle both initial load AND version switching.
// Cannot watch just a `needsContent` computed because switching between two
// content-less versions keeps needsContent=true — Vue watchers don't fire
// when the value doesn't change.
watch(() => props.item.id, async () => {
  const item = props.item;
  if (item.content === undefined && item.data === undefined) {
    contentLoading.value = true;
    try {
      await canvasStore.fetchItemContent(props.sessionId, item.filename);
    } finally {
      contentLoading.value = false;
    }
  }
}, { immediate: true });

// Copy content to clipboard with fallback
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

// Navigation functions
function handleBack() {
  emit('back');
}

// Menu functions
function toggleMenu() {
  menuOpen.value = !menuOpen.value;
  if (menuOpen.value) {
    menuHighlightedIndex.value = 0;
  }
}

function closeMenu() {
  menuOpen.value = false;
  menuHighlightedIndex.value = null;
}

async function handleMenuCopyFilename() {
  const filename = props.item.filename || 'Untitled';
  await copyToClipboard(filename);
  closeMenu();
}

function handleMenuDeleteAll() {
  const filename = props.item.filename || props.item.id;
  emit('deleteAll', filename);
  closeMenu();
}

function handleMenuKeyDown(event) {
  const itemCount = 2;

  switch (event.key) {
    case 'ArrowDown': {
      event.preventDefault();
      menuHighlightedIndex.value = menuHighlightedIndex.value === null ? 0 : (menuHighlightedIndex.value + 1) % itemCount;
      break;
    }
    case 'ArrowUp': {
      event.preventDefault();
      menuHighlightedIndex.value = menuHighlightedIndex.value === null ? itemCount - 1 : (menuHighlightedIndex.value - 1 + itemCount) % itemCount;
      break;
    }
    case 'Enter': {
      event.preventDefault();
      if (menuHighlightedIndex.value !== null) {
        if (menuHighlightedIndex.value === 0) {
          handleMenuCopyFilename();
        } else if (menuHighlightedIndex.value === 1) {
          handleMenuDeleteAll();
        }
      }
      break;
    }
    case 'Escape': {
      event.preventDefault();
      closeMenu();
      break;
    }
  }
}

function handleDocumentClick(event) {
  if (menuContainerRef.value && !menuContainerRef.value.contains(event.target)) {
    closeMenu();
  }
}

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
});

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick);
});

const currentVersionIndex = computed(() => {
  const idx = props.versions.findIndex((v) => v.id === props.item.id);
  return idx >= 0 ? idx : 0;
});

const highlightedCode = computed(() => {
  const content = props.item.content || '';
  const filename = props.item.filename || '';
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const lang = EXT_TO_LANG[ext];

  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
    }
    // Auto-detect language
    return hljs.highlightAuto(content).value;
  } catch {
    // Fallback to escaped plain text
    return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
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

function formatLastModified(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `Modified ${days}d ago`;
  if (hours > 0) return `Modified ${hours}h ago`;
  if (minutes > 0) return `Modified ${minutes}m ago`;
  return 'Modified just now';
}

function formatJson(data) {
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
  }
}

function selectVersion(itemId) {
  emit('selectVersion', itemId);
}
</script>

<style scoped>
.canvas-file-viewer {
  display: flex;
  flex-direction: column;
  /* Removed height: 100% - causes layout issues on iPad Safari when combined with
     sticky positioning. The natural document flow works correctly without it. */
}

.viewer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.viewer-header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  flex: 1;
}

.viewer-header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.breadcrumb-back {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 500;
  padding: 0;
  white-space: nowrap;
  transition: text-decoration 0.15s ease;
}

.breadcrumb-back:hover {
  text-decoration: underline;
}

.breadcrumb-separator {
  color: var(--color-text-soft);
  margin: 0 0.5rem;
  font-size: 0.875rem;
}

.viewer-filename-wrapper {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.viewer-filename {
  font-weight: 600;
  font-size: 1rem;
  word-break: break-word;
  overflow: hidden;
  text-overflow: ellipsis;
}

.viewer-meta {
  color: var(--color-text-soft);
  font-size: 0.75rem;
  font-weight: 400;
  margin-top: 0.125rem;
}

@media (max-width: 640px) {
  .viewer-meta {
    font-size: 0.6875rem;
  }
}

/* Version dropdown */
.version-dropdown {
  position: relative;
}

.version-dropdown summary {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.35rem 0.6rem;
  background: var(--color-primary);
  color: white;
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  list-style: none;
  min-height: 28px;
}

.version-dropdown summary::-webkit-details-marker {
  display: none;
}

.dropdown-arrow {
  font-size: 0.6rem;
}

.version-list {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 0.25rem;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  list-style: none;
  padding: 0.25rem 0;
  min-width: 160px;
  z-index: 100;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.version-list li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  font-size: 0.875rem;
}

.version-list li:hover {
  background: var(--color-background-mute);
}

.version-list li.active {
  background: var(--color-background-mute);
}

.version-number {
  font-weight: 600;
}

.version-time {
  color: var(--color-text-soft);
  font-size: 0.75rem;
}

.version-current {
  color: var(--color-primary);
  font-size: 0.75rem;
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
  list-style: none;
}

/* Content loading */
.content-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  justify-content: center;
  padding: 2rem;
  color: var(--color-text-soft);
}

.loading-spinner {
  display: inline-block;
  width: 1rem;
  height: 1rem;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Content area */
.viewer-content {
  flex: 1;
  overflow: auto;
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  padding: 1rem;
}

.viewer-image {
  max-width: 100%;
  height: auto;
  border-radius: var(--border-radius);
}

.viewer-markdown {
  font-size: 0.9375rem;
  line-height: 1.6;
}

.viewer-markdown-raw {
  font-size: 0.8125rem;
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: var(--font-mono);
}

.viewer-json {
  font-size: 0.8125rem;
  margin: 0;
  font-family: var(--font-mono);
}

.viewer-text {
  white-space: pre-wrap;
  font-size: 0.9375rem;
}

.viewer-code {
  font-size: 0.8125rem;
  margin: 0;
  font-family: var(--font-mono);
  overflow-x: auto;
  white-space: pre;
  line-height: 1.5;
}

.viewer-code code {
  display: block;
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

/* Mobile styles */
@media (max-width: 640px) {
  .viewer-header {
    padding: 0.5rem 0.5rem;
    gap: 0.5rem;
  }

  .viewer-header-left {
    gap: 0.5rem;
  }

  .breadcrumb-back {
    font-size: 0.875rem;
  }

  .breadcrumb-separator {
    margin: 0 0.25rem;
  }

  .viewer-filename {
    font-size: 0.875rem;
    min-width: 0;
    flex: 1;
  }

  .version-dropdown summary {
    min-height: 44px;
    padding: 0.5rem 0.75rem;
  }

  .btn-menu {
    width: 44px;
    height: 44px;
  }

  .file-menu-items {
    min-width: 180px;
  }
}
</style>
