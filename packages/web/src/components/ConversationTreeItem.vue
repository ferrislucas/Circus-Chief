<template>
  <div :class="['tree-item', { 'is-branch': isBranch, 'is-active': isActive }]">
    <div
      :class="['tree-item-row', { active: isActive }]"
      @click="$emit('select', conversation.id)"
    >
      <!-- Indent based on depth -->
      <span v-if="depth > 0" class="tree-indent" :style="{ width: `${depth * 12}px` }"></span>

      <!-- Branch indicator -->
      <span v-if="isBranch" class="branch-indicator" title="Branch">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
          <path d="M4 2v8M4 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM12 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM4 6c0 2 2 4 4 4h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>

      <!-- Expand/collapse toggle for items with children -->
      <button
        v-if="hasChildren"
        type="button"
        class="expand-toggle"
        @click.stop="toggleExpanded"
        :title="isExpanded ? 'Collapse' : 'Expand'"
      >
        <span :class="['expand-icon', { expanded: isExpanded }]">▶</span>
      </button>
      <span v-else-if="depth > 0" class="expand-placeholder"></span>

      <!-- Conversation name -->
      <span class="conv-name">{{ displayName }}</span>

      <!-- Metadata -->
      <span class="conv-meta">
        {{ conversation.messageCount || 0 }} msgs
        <span v-if="tokenDisplay" class="conv-tokens">
          · {{ tokenDisplay }}
        </span>
      </span>

      <!-- Children count badge -->
      <span v-if="childCount > 0" class="children-badge" :title="`${childCount} branch${childCount > 1 ? 'es' : ''}`">
        {{ childCount }}
      </span>

      <!-- Delete button -->
      <button
        v-if="canDelete"
        type="button"
        class="delete-btn"
        @click.stop="$emit('delete', conversation.id)"
        title="Delete conversation"
      >
        ×
      </button>
    </div>

    <!-- Children (recursive) -->
    <div v-if="isExpanded && hasChildren" class="tree-children">
      <ConversationTreeItem
        v-for="child in children"
        :key="child.id"
        :conversation="child"
        :index="getChildIndex(child)"
        :depth="depth + 1"
        :all-conversations="allConversations"
        :active-conversation-id="activeConversationId"
        @select="$emit('select', $event)"
        @delete="$emit('delete', $event)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  conversation: { type: Object, required: true },
  index: { type: Number, required: true },
  depth: { type: Number, default: 0 },
  allConversations: { type: Array, required: true },
  activeConversationId: { type: String, default: null },
});

defineEmits(['select', 'delete']);

const isExpanded = ref(true);

const isBranch = computed(() => !!props.conversation.parentConversationId);
const isActive = computed(() => props.conversation.id === props.activeConversationId);

const hasChildren = computed(() => {
  return props.allConversations.some(c => c.parentConversationId === props.conversation.id);
});

const children = computed(() => {
  return props.allConversations.filter(c => c.parentConversationId === props.conversation.id);
});

const childCount = computed(() => {
  return props.conversation.childCount || children.value.length;
});

// Convert number to ordinal (1→"1st", 2→"2nd", 3→"3rd", 4→"4th", etc.)
function toOrdinal(num) {
  const j = num % 10;
  const k = num % 100;
  if (j === 1 && k !== 11) return `${num}st`;
  if (j === 2 && k !== 12) return `${num}nd`;
  if (j === 3 && k !== 13) return `${num}rd`;
  return `${num}th`;
}

const displayName = computed(() => {
  return props.conversation.name || `${toOrdinal(props.index + 1)} conversation`;
});

// Format token count for display
function formatTokens(n) {
  if (!n || n === 0) return null;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

const tokenDisplay = computed(() => {
  const total = (props.conversation.inputTokens || 0) + (props.conversation.outputTokens || 0);
  return formatTokens(total);
});

// Can delete if not the only conversation and not the active one
const canDelete = computed(() => {
  return props.allConversations.length > 1 && !isActive.value;
});

function toggleExpanded() {
  isExpanded.value = !isExpanded.value;
}

function getChildIndex(child) {
  const siblings = children.value;
  return siblings.findIndex(c => c.id === child.id);
}
</script>

<style scoped>
.tree-item {
  user-select: none;
}

.tree-item-row {
  display: flex;
  align-items: center;
  padding: 0.5rem 0.75rem;
  cursor: pointer;
  transition: background-color 0.15s;
  gap: 0.375rem;
  border-radius: 0.25rem;
  margin-bottom: 1px;
}

.tree-item-row:hover {
  background: var(--color-background-soft);
}

.tree-item-row.active {
  background: rgba(88, 166, 255, 0.1);
  border-left: 3px solid var(--color-primary);
  padding-left: calc(0.75rem - 3px);
}

.tree-indent {
  flex-shrink: 0;
}

.branch-indicator {
  display: flex;
  align-items: center;
  color: rgba(139, 92, 246, 0.7);
  flex-shrink: 0;
}

.expand-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  background: transparent;
  border: none;
  color: var(--color-text-soft);
  cursor: pointer;
  flex-shrink: 0;
  border-radius: 2px;
}

.expand-toggle:hover {
  background: var(--color-background-mute);
  color: var(--color-text);
}

.expand-icon {
  font-size: 0.5rem;
  transition: transform 0.15s;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.expand-placeholder {
  width: 16px;
  flex-shrink: 0;
}

.conv-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}

.conv-meta {
  font-size: 0.75rem;
  color: var(--color-text-soft);
  white-space: nowrap;
  flex-shrink: 0;
}

.conv-tokens {
  font-family: var(--font-mono);
}

.children-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 0.25rem;
  background: rgba(139, 92, 246, 0.15);
  color: rgba(139, 92, 246, 0.9);
  border-radius: 9px;
  font-size: 0.6875rem;
  font-weight: 600;
  flex-shrink: 0;
}

.delete-btn {
  padding: 0.125rem 0.375rem;
  background: transparent;
  border: none;
  color: var(--color-text-soft);
  font-size: 1rem;
  cursor: pointer;
  border-radius: 0.25rem;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s, background-color 0.15s;
  flex-shrink: 0;
}

.tree-item-row:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: var(--color-danger, #ef4444);
  color: white;
}

.tree-children {
  margin-left: 0.25rem;
  border-left: 1px solid var(--color-border);
  padding-left: 0.25rem;
}
</style>
