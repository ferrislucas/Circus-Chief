<template>
  <div class="canvas-file-viewer">
    <!-- Header -->
    <CanvasFileViewerHeader
      :item="item"
      :versions="versions"
      :show-back-button="showBackButton"
      :is-editing="isEditing"
      @back="handleBack"
      @select-version="selectVersion"
      @delete-all="handleDeleteAll"
      @edit="toggleEditing"
    />

    <!-- Content -->
    <div
      v-if="isEditing && item.type === 'markdown'"
      class="viewer-content viewer-content-editing"
    >
      <MarkdownEditor
        :content="item.content || ''"
        :session-id="sessionId"
        :filename="item.filename"
        :item-id="item.id"
        @save="handleSave"
      />
    </div>
    <div
      v-else
      class="viewer-content"
    >
      <!-- Loading state while fetching content -->
      <div
        v-if="contentLoading"
        class="content-loading"
      >
        <span class="loading-spinner" />
        Loading content...
      </div>

      <template v-else>
        <img
          v-if="item.type === 'image'"
          :src="`data:${item.mimeType};base64,${item.data}`"
          :alt="item.filename || 'Image'"
          class="viewer-image"
        >

        <MarkdownViewer
          v-if="item.type === 'markdown'"
          :content="item.content"
          class="viewer-markdown"
        />

        <pre
          v-else-if="item.type === 'json'"
          class="viewer-json"
        >{{ formatJson(item.data) }}</pre>

        <div
          v-else-if="item.type === 'text'"
          class="viewer-text"
        >
          {{ item.content }}
        </div>

        <!-- eslint-disable vue/no-v-html -->
        <pre
          v-else-if="item.type === 'code'"
          class="hljs viewer-code"
        ><code v-html="highlightedCode" /></pre>
        <!-- eslint-enable vue/no-v-html -->
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onBeforeUnmount, defineAsyncComponent } from 'vue';
import MarkdownViewer from './MarkdownViewer.vue';
import CanvasFileViewerHeader from './CanvasFileViewerHeader.vue';
import hljs from 'highlight.js';
import { useCanvasStore } from '../stores/canvas.js';

const MarkdownEditor = defineAsyncComponent(() =>
  import('./MarkdownEditor.vue')
);

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

const contentLoading = ref(false);
const isEditing = ref(false);

// Watch the item's id to handle both initial load AND version switching.
// Cannot watch just a `needsContent` computed because switching between two
// content-less versions keeps needsContent=true — Vue watchers don't fire
// when the value doesn't change.
watch(() => props.item.id, async () => {
  const item = props.item;
  if (item.content === undefined && item.data === undefined) {
    contentLoading.value = true;
    try {
      await canvasStore.fetchItemContent(props.sessionId, item.filename, item.id);
    } finally {
      contentLoading.value = false;
    }
  }
}, { immediate: true });

function toggleEditing() {
  isEditing.value = !isEditing.value;
}

function handleSave(content) {
  canvasStore.saveMarkdownContent(props.sessionId, props.item.filename, content, props.item.id);
}

function handleBack() {
  emit('back');
}

function handleDeleteAll(filename) {
  emit('deleteAll', filename);
}

// Ensure endEditing is called when navigating away while editing
onBeforeUnmount(() => {
  if (isEditing.value && props.item.filename) {
    canvasStore.endEditing(props.item.filename);
  }
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

.viewer-content-editing {
  padding: 0;
  display: flex;
  flex-direction: column;
  min-height: 400px;
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
</style>
