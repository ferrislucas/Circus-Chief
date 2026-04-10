<template>
  <div
    class="markdown-viewer"
    v-html="renderedContent"
  />
</template>

<script setup>
import { computed } from 'vue';
import { renderMarkdown } from '../utils/markdown.js';

const props = defineProps({
  content: {
    type: String,
    default: '',
  },
});

const renderedContent = computed(() => renderMarkdown(props.content));
</script>

<style scoped>
.markdown-viewer {
  line-height: 1.6;
  word-wrap: break-word;
}

/* Headers */
.markdown-viewer :deep(h1),
.markdown-viewer :deep(h2),
.markdown-viewer :deep(h3),
.markdown-viewer :deep(h4),
.markdown-viewer :deep(h5),
.markdown-viewer :deep(h6) {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-text);
}

.markdown-viewer :deep(h1) {
  font-size: 1.75em;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.3em;
}

.markdown-viewer :deep(h2) {
  font-size: 1.5em;
  border-bottom: 1px solid var(--color-border);
  padding-bottom: 0.3em;
}

.markdown-viewer :deep(h3) {
  font-size: 1.25em;
}

.markdown-viewer :deep(h4) {
  font-size: 1em;
}

.markdown-viewer :deep(h5) {
  font-size: 0.875em;
}

.markdown-viewer :deep(h6) {
  font-size: 0.85em;
  color: var(--color-text-soft);
}

/* First heading should not have top margin */
.markdown-viewer :deep(> h1:first-child),
.markdown-viewer :deep(> h2:first-child),
.markdown-viewer :deep(> h3:first-child),
.markdown-viewer :deep(> h4:first-child),
.markdown-viewer :deep(> h5:first-child),
.markdown-viewer :deep(> h6:first-child) {
  margin-top: 0;
}

/* Paragraphs */
.markdown-viewer :deep(p) {
  margin-top: 0;
  margin-bottom: 1em;
}

/* Links */
.markdown-viewer :deep(a) {
  color: var(--color-primary);
  text-decoration: none;
}

.markdown-viewer :deep(a:hover) {
  text-decoration: underline;
}

/* Lists */
.markdown-viewer :deep(ul),
.markdown-viewer :deep(ol) {
  margin-top: 0;
  margin-bottom: 1em;
  padding-left: 2em;
}

.markdown-viewer :deep(ul) {
  list-style-type: disc;
}

.markdown-viewer :deep(ol) {
  list-style-type: decimal;
}

.markdown-viewer :deep(li) {
  margin-bottom: 0.25em;
}

.markdown-viewer :deep(li > ul),
.markdown-viewer :deep(li > ol) {
  margin-top: 0.25em;
  margin-bottom: 0;
}

/* Blockquotes */
.markdown-viewer :deep(blockquote) {
  margin: 0 0 1em 0;
  padding: 0.5em 1em;
  border-left: 4px solid var(--color-border);
  background-color: var(--color-background-soft);
  color: var(--color-text-soft);
}

.markdown-viewer :deep(blockquote p:last-child) {
  margin-bottom: 0;
}

/* Code - inline */
.markdown-viewer :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.875em;
  padding: 0.2em 0.4em;
  background-color: var(--color-background-mute);
  border-radius: 3px;
}

/* Code - blocks */
.markdown-viewer :deep(pre) {
  margin: 0 0 1em 0;
  padding: 1em;
  overflow-x: auto;
  background-color: var(--color-background-mute);
  border-radius: var(--border-radius);
  border: 1px solid var(--color-border);
}

.markdown-viewer :deep(pre code) {
  padding: 0;
  background-color: transparent;
  border-radius: 0;
  font-size: 0.8125em;
  line-height: 1.5;
}

/* Tables */
.markdown-viewer :deep(table) {
  width: 100%;
  margin-bottom: 1em;
  border-collapse: collapse;
  border-spacing: 0;
}

.markdown-viewer :deep(th),
.markdown-viewer :deep(td) {
  padding: 0.5em 1em;
  border: 1px solid var(--color-border);
  text-align: left;
}

.markdown-viewer :deep(th) {
  font-weight: 600;
  background-color: var(--color-background-soft);
}

.markdown-viewer :deep(tr:nth-child(even)) {
  background-color: var(--color-background-soft);
}

/* Horizontal rule */
.markdown-viewer :deep(hr) {
  height: 1px;
  margin: 1.5em 0;
  background-color: var(--color-border);
  border: none;
}

/* Images */
.markdown-viewer :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--border-radius);
}

/* Strong and emphasis */
.markdown-viewer :deep(strong) {
  font-weight: 600;
}

.markdown-viewer :deep(em) {
  font-style: italic;
}

.markdown-viewer :deep(del),
.markdown-viewer :deep(s) {
  text-decoration: line-through;
  color: var(--color-text-soft);
}

/* Highlight.js syntax highlighting theme (dark) */
.markdown-viewer :deep(.hljs) {
  color: #c9d1d9;
  background: var(--color-background-mute);
}

.markdown-viewer :deep(.hljs-comment),
.markdown-viewer :deep(.hljs-punctuation) {
  color: #8b949e;
}

.markdown-viewer :deep(.hljs-attr),
.markdown-viewer :deep(.hljs-attribute),
.markdown-viewer :deep(.hljs-meta),
.markdown-viewer :deep(.hljs-selector-attr),
.markdown-viewer :deep(.hljs-selector-class),
.markdown-viewer :deep(.hljs-selector-id) {
  color: #79c0ff;
}

.markdown-viewer :deep(.hljs-variable),
.markdown-viewer :deep(.hljs-literal),
.markdown-viewer :deep(.hljs-number),
.markdown-viewer :deep(.hljs-doctag) {
  color: #f2cc60;
}

.markdown-viewer :deep(.hljs-params) {
  color: #c9d1d9;
}

.markdown-viewer :deep(.hljs-function) {
  color: #d2a8ff;
}

.markdown-viewer :deep(.hljs-class),
.markdown-viewer :deep(.hljs-tag),
.markdown-viewer :deep(.hljs-title),
.markdown-viewer :deep(.hljs-built_in) {
  color: #7ee787;
}

.markdown-viewer :deep(.hljs-keyword),
.markdown-viewer :deep(.hljs-type),
.markdown-viewer :deep(.hljs-selector-tag),
.markdown-viewer :deep(.hljs-addition),
.markdown-viewer :deep(.hljs-template-tag),
.markdown-viewer :deep(.hljs-template-variable) {
  color: #ff7b72;
}

.markdown-viewer :deep(.hljs-string),
.markdown-viewer :deep(.hljs-bullet),
.markdown-viewer :deep(.hljs-subst),
.markdown-viewer :deep(.hljs-section),
.markdown-viewer :deep(.hljs-link),
.markdown-viewer :deep(.hljs-regexp) {
  color: #a5d6ff;
}

.markdown-viewer :deep(.hljs-name),
.markdown-viewer :deep(.hljs-selector-pseudo),
.markdown-viewer :deep(.hljs-symbol),
.markdown-viewer :deep(.hljs-quote) {
  color: #7ee787;
}

.markdown-viewer :deep(.hljs-deletion) {
  color: #ffa198;
  background-color: rgba(255, 129, 130, 0.15);
}

.markdown-viewer :deep(.hljs-emphasis) {
  font-style: italic;
}

.markdown-viewer :deep(.hljs-strong) {
  font-weight: bold;
}
</style>
