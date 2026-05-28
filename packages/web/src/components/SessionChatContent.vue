<template>
  <div
    ref="contentRef"
    class="session-chat-content"
    :class="[
      'overlay-content',
      mode === 'embedded' ? 'session-chat-content--embedded' : 'session-chat-content--overlay session-chat-overlay',
      { 'session-chat-overlay--composer-focused': composerFocused }
    ]"
  >
    <div
      ref="headerRef"
      class="overlay-header"
      @touchmove="handleHeaderTouchmove"
    >
      <div
        v-if="hasDescendants"
        ref="pickerAreaRef"
        class="overlay-header-row overlay-header-selector"
        data-testid="session-tree-dropdown"
      >
        <button
          class="dropdown-trigger"
          data-testid="overlay-picker-trigger"
          :aria-expanded="pickerOpen ? 'true' : 'false'"
          @click="togglePicker"
        >
          <span class="dropdown-name">{{ activeSessionDisplayName }}</span>
          <span class="dropdown-chevron">{{ pickerOpen ? '&#9650;' : '&#9660;' }}</span>
        </button>
        <SessionChatPicker
          v-if="pickerOpen"
          :sessions="sessionChain"
          :active-session-id="activeSessionId"
          :summaries="summariesMap"
          @select="handlePickerSelect"
        />
      </div>

      <div class="overlay-header-row overlay-header-actions">
        <router-link
          v-if="mode !== 'embedded'"
          :to="backToSessionsUrl"
          class="back-to-sessions-link"
          title="Back to Sessions"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          <span class="back-to-sessions-text">Sessions</span>
        </router-link>
        <button
          class="add-session-btn"
          data-testid="overlay-add-session-btn"
          title="Create a new child session"
          :disabled="isCreatingSession"
          @click="addChildSession"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {{ isCreatingSession ? 'Creating...' : 'New Session' }}
        </button>
      </div>
    </div>

    <div
      ref="bodyRef"
      class="overlay-body"
    >
      <div
        v-if="switchingSession"
        class="session-switch-loading"
      >
        <span class="session-switch-spinner" />
        <span class="session-switch-text">Loading session...</span>
      </div>
      <ConversationTab
        v-else
        ref="conversationTabRef"
        :key="activeSessionId"
        :session-id="activeSessionId"
        :scroll-container-ref="bodyRef"
        :hide-new-conversation="true"
        initial-scroll-target="latest-agent-turn"
        @prompt-focus="handlePromptFocus"
        @prompt-blur="handlePromptBlur"
      />
    </div>
  </div>
</template>

<script setup>
/* eslint-disable max-lines */
import { ref, computed, provide, onMounted, onUnmounted, watch } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useSessionSubscription.js';
import { useSessionPolling } from '../composables/useSessionPolling.js';
import { api } from '../composables/useApi.js';
import { createOverlaySessionsStore } from '../stores/createOverlaySessionsStore.js';
import { createOverlayTodosStore } from '../stores/createOverlayTodosStore.js';
import { SESSIONS_STORE_KEY, TODOS_STORE_KEY } from '../composables/useOverlayStore.js';

import ConversationTab from './ConversationTab.vue';
import SessionChatPicker from './SessionChatPicker.vue';

const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
  sessionChain: {
    type: Array,
    default: () => [],
  },
  summariesMap: {
    type: Object,
    default: () => ({}),
  },
  mode: {
    type: String,
    default: 'overlay',
    validator: value => ['overlay', 'embedded'].includes(value),
  },
});

const emit = defineEmits([
  'session-created',
  'prompt-focus',
  'prompt-blur',
  'picker-open-change',
  'active-session-change',
]);

const mainSessionsStore = useSessionsStore();
const uiStore = useUiStore();

const overlaySessionsStore = createOverlaySessionsStore();
const overlayTodosStore = createOverlayTodosStore();

provide(SESSIONS_STORE_KEY, overlaySessionsStore);
provide(TODOS_STORE_KEY, overlayTodosStore);

const sessionsStore = overlaySessionsStore;
const todosStore = overlayTodosStore;

const activeSessionId = ref(props.sessionId);
const isCreatingSession = ref(false);
const switchingSession = ref(true);
const composerFocused = ref(false);
const contentRef = ref(null);
const headerRef = ref(null);
const bodyRef = ref(null);
const conversationTabRef = ref(null);
const pickerOpen = ref(false);
const pickerAreaRef = ref(null);

let currentSubscription = null;
let wsCleanups = [];

const {
  startPolling,
  stopPolling,
  reset: resetPolling,
} = useSessionPolling({
  getSessionId: () => activeSessionId.value,
  getSessionStatus: () => {
    const session = mainSessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
    return session?.status;
  },
  sessionsStore: overlaySessionsStore,
});

const activeSessionDisplayName = computed(() => {
  const session = mainSessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  return session?.name || 'Session';
});

const hasDescendants = computed(() => props.sessionChain.length > 1);

const activeSessionStatus = computed(() => {
  const session = mainSessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  return session?.status || '';
});

const backToSessionsUrl = computed(() => {
  const session = mainSessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  if (session?.projectId) {
    return `/projects/${session.projectId}/sessions`;
  }
  return '/';
});

function emitActiveSessionChange() {
  emit('active-session-change', {
    id: activeSessionId.value,
    status: activeSessionStatus.value,
  });
}

function setPickerOpen(value) {
  if (pickerOpen.value === value) return;
  pickerOpen.value = value;
  emit('picker-open-change', value);
}

function togglePicker() {
  setPickerOpen(!pickerOpen.value);
}

function closePicker() {
  setPickerOpen(false);
}

function openPicker() {
  setPickerOpen(true);
}

function handlePickerSelect(sessionId) {
  closePicker();
  selectSession(sessionId);
}

function handleClickOutsidePicker(event) {
  if (!pickerOpen.value) return;
  const picker = document.querySelector('[data-testid="session-chat-picker"]');
  const trigger = document.querySelector('[data-testid="overlay-picker-trigger"]');
  if (picker && !picker.contains(event.target) &&
      (!trigger || !trigger.contains(event.target))) {
    closePicker();
  }
}

async function selectSession(sessionId) {
  await switchToSession(sessionId);
}

async function addChildSession() {
  if (isCreatingSession.value) return;

  const currentSession = mainSessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  if (!currentSession?.projectId) {
    uiStore.error('Cannot create session: no project context');
    return;
  }

  isCreatingSession.value = true;
  try {
    const gitMode = currentSession.gitWorktree ? 'worktree' : undefined;
    const gitBranch = currentSession.gitWorktree ? currentSession.gitBranch : undefined;

    const newSession = await api.createSession(currentSession.projectId, {
      prompt: ' ',
      name: 'New Session',
      parentSessionId: activeSessionId.value,
      startImmediately: false,
      ...(currentSession.model ? { model: currentSession.model } : {}),
      ...(gitMode && gitBranch ? { gitMode, gitBranch } : {}),
    });

    mainSessionsStore.addSessionToList(newSession);
    emit('session-created', newSession);
    await switchToSession(newSession.id);
  } catch (err) {
    uiStore.error(err.message || 'Failed to create child session');
  } finally {
    isCreatingSession.value = false;
  }
}

async function switchToSession(newSessionId) {
  if (!newSessionId || newSessionId === activeSessionId.value) {
    emitActiveSessionChange();
    return;
  }

  conversationTabRef.value?.flushDraft?.();
  switchingSession.value = true;

  try {
    sessionsStore.clearRunningUsage();
    sessionsStore.clearPartialText();
    sessionsStore.messages = [];
    sessionsStore.workLogs = {};
    todosStore.clearTodos();

    cleanupSubscription();
    activeSessionId.value = newSessionId;

    await loadSessionData(newSessionId);
    setupSubscription(newSessionId);
    emitActiveSessionChange();
  } finally {
    switchingSession.value = false;
  }
}

async function loadSessionData(sessionId) {
  try {
    sessionsStore.viewedSessionId = sessionId;
    await sessionsStore.fetchSession(sessionId, false);
    await sessionsStore.fetchConversations(sessionId);
    await sessionsStore.fetchMessages(sessionId, false, sessionsStore.activeConversationId);
    await sessionsStore.fetchWorkLogs(sessionId);

    if (sessionsStore.activeConversationId) {
      todosStore.fetchTodos(sessionId, sessionsStore.activeConversationId);
    }
  } catch (err) {
    console.error('[SessionChatContent] Failed to load session data:', err);
  }
}

function setupSubscription(sessionId) {
  currentSubscription = useSessionSubscription(sessionId);
  currentSubscription.subscribe();

  wsCleanups.push(
    currentSubscription.onStatus((status) => {
      sessionsStore.updateSessionStatus(sessionId, status);
      emitActiveSessionChange();
      if (status === 'running' || status === 'starting') {
        startPolling();
      } else {
        stopPolling();
      }
    })
  );

  wsCleanups.push(currentSubscription.onMessage((message) => {
    sessionsStore.addMessage(message);
    sessionsStore.clearPartialText();
  }));
  wsCleanups.push(currentSubscription.onPartial((text) => sessionsStore.setPartialText(text)));
  wsCleanups.push(currentSubscription.onSessionUpdate((session) => {
    sessionsStore.updateSession(session);
    emitActiveSessionChange();
  }));
  wsCleanups.push(currentSubscription.onConversationCreated((conversation) => sessionsStore.addConversation(conversation)));
  wsCleanups.push(currentSubscription.onConversationUpdated((conversation) => sessionsStore.updateConversation(conversation)));

  const session = mainSessionsStore.getSessionById(sessionId) || sessionsStore.currentSession;
  if (session?.status === 'running' || session?.status === 'starting') {
    startPolling();
  }
}

function cleanupSubscription() {
  resetPolling();
  wsCleanups.forEach((cleanup) => cleanup());
  wsCleanups = [];
  if (currentSubscription) {
    currentSubscription.unsubscribe();
    currentSubscription = null;
  }
}

function handleHeaderTouchmove(event) {
  if (event.target.closest('[data-testid="session-chat-picker"]')) return;
  event.preventDefault();
}

function handlePromptFocus(event) {
  composerFocused.value = true;
  emit('prompt-focus', event);
}

function handlePromptBlur(event) {
  emit('prompt-blur', event);
}

function setComposerFocused(value) {
  composerFocused.value = value;
}

watch(
  () => props.sessionId,
  async (newSessionId) => {
    if (!newSessionId || newSessionId === activeSessionId.value) return;
    await switchToSession(newSessionId);
  }
);

onMounted(async () => {
  document.addEventListener('click', handleClickOutsidePicker, true);
  try {
    await loadSessionData(activeSessionId.value);
    setupSubscription(activeSessionId.value);
    emitActiveSessionChange();
  } finally {
    switchingSession.value = false;
  }
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutsidePicker, true);
  cleanupSubscription();
  overlaySessionsStore.$cleanup();
  overlayTodosStore.$cleanup();
});

defineExpose({
  activeSessionId,
  isCreatingSession,
  switchingSession,
  pickerOpen,
  handlePickerSelect,
  openPicker,
  closePicker,
  contentRef,
  headerRef,
  bodyRef,
  overlayContentRef: contentRef,
  overlayHeaderRef: headerRef,
  overlayBodyRef: bodyRef,
  setComposerFocused,
});
</script>

<style scoped>
.session-chat-content {
  width: 100%;
  max-width: 100vw;
  min-width: 0;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  padding: 0;
  position: relative;
  background: rgb(17, 24, 39);
}

.session-chat-content--overlay {
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.5);
}

.session-chat-content--embedded {
  height: min(760px, calc(100vh - 260px));
  min-height: 520px;
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-radius: 8px;
}

.overlay-body {
  width: 100%;
  max-width: 100%;
  padding: 0 1rem;
  padding-bottom: max(0px, env(safe-area-inset-bottom));
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  touch-action: pan-y;
  background: rgb(17, 24, 39);
}

.overlay-header {
  --overlay-header-base-padding-top: 0.75rem;
  position: relative;
  top: auto;
  z-index: 20;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: max(var(--overlay-header-base-padding-top), env(safe-area-inset-top)) 1rem 0.375rem;
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  overflow: visible;
}

.overlay-header-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.overlay-header-selector {
  position: relative;
  min-width: 0;
}

.overlay-header-actions {
  justify-content: space-between;
  gap: 0.5rem;
}

.dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-width: 0;
  padding: 0.625rem 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-radius: var(--border-radius, 6px);
  color: var(--color-text, #e5e7eb);
  cursor: pointer;
  font-size: 0.8125rem;
  transition: background-color 0.15s;
}

.dropdown-trigger:hover {
  background: rgba(255, 255, 255, 0.1);
}

.dropdown-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-chevron {
  color: var(--color-text-soft, #9ca3af);
  margin-left: 0.5rem;
  flex-shrink: 0;
}

.session-chat-content :deep(.messages) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  max-height: none !important;
  overflow-x: hidden !important;
  overflow-y: visible !important;
  flex: 1;
}

.session-chat-content :deep(.conversation-tab) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.session-chat-content :deep(.message),
.session-chat-content :deep(.message-content),
.session-chat-content :deep(.markdown-viewer) {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  overflow-x: hidden;
}

.session-chat-content :deep(.markdown-viewer code:not(pre code)) {
  display: inline;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-all;
  line-break: anywhere;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

.session-chat-content :deep(.conversation-controls-row) {
  position: sticky;
  bottom: 0;
  z-index: 10;
  background: rgb(17, 24, 39);
  pointer-events: none;
}

.session-chat-content :deep(.conversation-controls-row > *) {
  pointer-events: auto;
}

.session-chat-overlay--composer-focused :deep(.session-overlay-keyboard-spacer) {
  flex-basis: var(--session-overlay-keyboard-bottom-inset, 0px);
  height: var(--session-overlay-keyboard-bottom-inset, 0px);
}

.session-switch-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 3rem;
  gap: 0.75rem;
  flex: 1;
}

.session-switch-spinner {
  display: inline-block;
  width: 1.5rem;
  height: 1.5rem;
  border: 2px solid rgba(6, 182, 212, 0.2);
  border-top-color: #06b6d4;
  border-radius: 50%;
  animation: session-switch-spin 0.8s linear infinite;
}

@keyframes session-switch-spin {
  to {
    transform: rotate(360deg);
  }
}

.session-switch-text {
  color: #9ca3af;
  font-size: 0.8125rem;
}

.add-session-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.75rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-radius: var(--border-radius, 6px);
  color: var(--color-text-soft, #9ca3af);
  font-size: 0.8125rem;
  white-space: nowrap;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 50%;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
  transition: background-color 0.15s, color 0.15s, border-color 0.15s;
}

.add-session-btn:hover:not(:disabled) {
  background: rgba(6, 182, 212, 0.1);
  color: var(--color-primary, #06b6d4);
  border-color: rgba(6, 182, 212, 0.3);
}

.add-session-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.back-to-sessions-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--color-text-soft, #9ca3af);
  text-decoration: none;
  transition: color 0.15s, background-color 0.15s;
  flex-shrink: 0;
  min-width: 44px;
  max-width: 50%;
  margin-right: 1.5rem;
  padding: 0.25rem 0.75rem;
  min-height: 44px;
  border-radius: 6px;
}

.back-to-sessions-link:hover {
  color: var(--color-primary, #06b6d4);
  background: rgba(6, 182, 212, 0.1);
}

.back-to-sessions-text {
  font-size: 0.8125rem;
  margin-left: 0.25rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 768px) {
  .overlay-body {
    padding-left: 0.5rem;
    padding-right: 0.5rem;
  }

  .overlay-header {
    --overlay-header-base-padding-top: 1rem;
    padding-right: 0.5rem;
    padding-bottom: 0.375rem;
    padding-left: 0.5rem;
  }
}
</style>
