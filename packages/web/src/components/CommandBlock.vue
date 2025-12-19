<template>
  <div class="command-block" :class="`command-${log.type}`">
    <div class="command-header">
      <span class="command-icon">
        <svg v-if="log.type === 'tool_input'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6"/>
          <polyline points="8 6 2 12 8 18"/>
        </svg>
      </span>
      <span class="command-label">{{ log.type === 'tool_input' ? 'Input' : 'Output' }}</span>
      <span v-if="log.toolName" class="command-tool-name">{{ log.toolName }}</span>
      <span v-if="log.timestamp" class="command-time">{{ formatTime(log.timestamp) }}</span>
    </div>
    <div class="command-content">
      <!-- Tool input: show command summary with collapsible raw JSON -->
      <template v-if="commandSummary">
        <div class="command-summary">
          <code>{{ commandSummary }}</code>
        </div>
        <details class="raw-json-details">
          <summary>Show raw JSON</summary>
          <pre class="command-pre">{{ displayContent }}</pre>
        </details>
      </template>

      <!-- Fallback: Original display for outputs or when no summary available -->
      <template v-else>
        <pre class="command-pre" :class="{ expanded: isExpanded }">{{ displayContent }}</pre>
        <button v-if="shouldTruncate && !isExpanded" class="show-more-btn" @click="isExpanded = true">
          Show more ({{ lineCount }} lines)
        </button>
        <button v-if="isExpanded && shouldTruncate" class="show-more-btn" @click="isExpanded = false">
          Show less
        </button>
      </template>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  log: { type: Object, required: true },
});

const MAX_LINES = 10;
const isExpanded = ref(false);

const lines = computed(() => props.log.content.split('\n'));
const lineCount = computed(() => lines.value.length);
const shouldTruncate = computed(() => lineCount.value > MAX_LINES);

const displayContent = computed(() => {
  if (isExpanded.value || !shouldTruncate.value) {
    return props.log.content;
  }
  return lines.value.slice(0, MAX_LINES).join('\n') + '\n...';
});

/**
 * Extracts a human-readable command summary from tool input JSON.
 * Returns null for tool outputs or when parsing fails (falls back to raw JSON display).
 */
const commandSummary = computed(() => {
  if (props.log.type !== 'tool_input') return null;

  try {
    const input = JSON.parse(props.log.content);
    const toolName = props.log.toolName?.toLowerCase();

    switch (toolName) {
      case 'bash':
        return input.command;
      case 'read':
        return input.file_path;
      case 'edit':
        return input.file_path;
      case 'write':
        return input.file_path;
      case 'grep':
        return `"${input.pattern}"${input.path ? ` in ${input.path}` : ''}`;
      case 'glob':
        return input.pattern;
      case 'task':
        return input.description || input.prompt?.slice(0, 100);
      case 'webfetch':
        return input.url;
      case 'websearch':
        return input.query;
      default:
        return null;
    }
  } catch {
    return null;
  }
});

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}
</script>

<style scoped>
.command-block {
  background: var(--color-background-soft);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 0.625rem;
  font-size: 0.8125rem;
}

.command-tool_input {
  border-left: 3px solid var(--color-warning, #d29922);
}

.command-tool_output {
  border-left: 3px solid var(--color-success, #3fb950);
}

.command-header {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-bottom: 0.5rem;
}

.command-icon {
  display: flex;
  align-items: center;
  opacity: 0.7;
}

.command-tool_input .command-icon {
  color: var(--color-warning, #d29922);
}

.command-tool_output .command-icon {
  color: var(--color-success, #3fb950);
}

.command-label {
  font-weight: 500;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  color: var(--color-text-soft);
}

.command-tool-name {
  background: var(--color-background-mute);
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  font-size: 0.6875rem;
  font-family: var(--font-mono, monospace);
  color: var(--color-text);
}

.command-time {
  margin-left: auto;
  font-size: 0.6875rem;
  color: var(--color-text-soft);
}

.command-content {
  position: relative;
}

.command-summary {
  margin-bottom: 0.5rem;
}

.command-summary code {
  display: block;
  padding: 0.5rem;
  background: var(--color-background);
  border-radius: 4px;
  font-size: 0.8125rem;
  font-family: var(--font-mono, 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace);
  color: var(--color-text);
  word-break: break-word;
  white-space: pre-wrap;
}

.raw-json-details {
  margin-top: 0.25rem;
}

.raw-json-details summary {
  cursor: pointer;
  font-size: 0.75rem;
  color: var(--color-text-soft);
  user-select: none;
  padding: 0.25rem 0;
}

.raw-json-details summary:hover {
  color: var(--color-primary);
}

.raw-json-details[open] summary {
  margin-bottom: 0.375rem;
}

.command-pre {
  margin: 0;
  padding: 0.5rem;
  background: var(--color-background);
  border-radius: 4px;
  font-size: 0.75rem;
  font-family: var(--font-mono, 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-text);
  line-height: 1.4;
  max-height: 300px;
  overflow-y: auto;
}

.command-pre.expanded {
  max-height: none;
}

.show-more-btn {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  padding: 0.25rem 0;
  font-size: 0.75rem;
  text-decoration: underline;
  opacity: 0.8;
}

.show-more-btn:hover {
  opacity: 1;
}
</style>
