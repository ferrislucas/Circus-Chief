<template>
  <Teleport to="body">
    <Transition name="slide-left" appear @after-leave="afterLeave">
      <div
        v-if="visible"
        class="overlay-backdrop"
        data-testid="session-tree-overlay"
        @click.self="close"
      >
        <div class="overlay-panel-wrapper" @click.stop>
          <!-- Close handle anchored to left edge of panel -->
          <div
            class="overlay-close-handle"
            tabindex="0"
            role="button"
            :aria-label="isOverlaySessionActive
              ? (overlaySessionStatus === 'starting' ? 'Session starting...' : 'Session running...')
              : 'Close session tree'"
            :title="isOverlaySessionActive
              ? (overlaySessionStatus === 'starting' ? 'Session starting...' : 'Session running...')
              : 'Close session tree'"
            data-testid="session-tree-overlay-close-handle"
            @click="close"
            @keydown.enter.prevent="close"
            @keydown.space.prevent="close"
          >
            <svg
              class="handle-icon"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 2v4h3v2H4v4h3M10 4h3M10 8h3M10 12h3"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span
              v-if="isOverlaySessionActive"
              class="active-spinner"
              :title="overlaySessionStatus === 'starting' ? 'Session starting...' : 'Session running...'"
            ></span>
          </div>

          <!-- Existing overlay-content -->
          <div class="overlay-content session-tree-overlay">
          <!-- Header (no padding constraints) -->
          <div class="overlay-header">
            <!-- Row 1: Session Name -->
            <div class="overlay-header-row">
              <!-- Editing mode -->
              <template v-if="isEditingName">
                <div class="name-edit-form">
                  <input
                    ref="nameEditInput"
                    v-model="editNameValue"
                    type="text"
                    class="name-edit-input"
                    placeholder="Session name"
                    @keyup.enter="saveSessionName"
                    @keyup.escape="cancelEditName"
                  />
                  <button class="btn-icon pr-edit-btn pr-save-btn" title="Save" @click="saveSessionName">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </button>
                  <button class="btn-icon pr-edit-btn pr-cancel-btn" title="Cancel" @click="cancelEditName">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                  <button v-if="editNameValue" class="btn-icon pr-edit-btn pr-clear-btn" title="Clear name" @click="clearSessionName">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </template>

              <!-- Display mode -->
              <template v-else>
                <div class="session-name-wrapper">
                  <span class="overlay-root-name">{{ rootSessionName }}</span>
                  <button class="btn-link name-edit-trigger" @click="startEditName" title="Edit session name">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                </div>
              </template>
            </div>

            <!-- Row 2: Session Selector -->
            <div v-if="hasDescendants" class="overlay-header-row overlay-header-selector" ref="pickerAreaRef" data-testid="session-tree-dropdown">
              <button
                class="dropdown-trigger"
                data-testid="overlay-picker-trigger"
                :aria-expanded="pickerOpen ? 'true' : 'false'"
                @click="togglePicker"
              >
                <span class="dropdown-name">{{ activeSessionDisplayName }}</span>
                <span class="dropdown-chevron">{{ pickerOpen ? '&#9650;' : '&#9660;' }}</span>
              </button>
              <SessionTreePicker
                v-if="pickerOpen"
                :sessions="sessionChain"
                :active-session-id="activeSessionId"
                :summaries="summariesMap"
                @select="handlePickerSelect"
              />
            </div>

            <!-- Row 3: Back to List + New Session -->
            <div class="overlay-header-row overlay-header-actions">
              <router-link
                :to="backToSessionsUrl"
                class="back-to-sessions-link"
                title="Back to Sessions"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <line x1="8" y1="6" x2="21" y2="6"></line>
                  <line x1="8" y1="12" x2="21" y2="12"></line>
                  <line x1="8" y1="18" x2="21" y2="18"></line>
                  <line x1="3" y1="6" x2="3.01" y2="6"></line>
                  <line x1="3" y1="12" x2="3.01" y2="12"></line>
                  <line x1="3" y1="18" x2="3.01" y2="18"></line>
                </svg>
              </router-link>
              <button
                class="add-session-btn"
                data-testid="overlay-add-session-btn"
                title="Create a new child session"
                :disabled="isCreatingSession"
                @click="addChildSession"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                {{ isCreatingSession ? 'Creating...' : 'New Session' }}
              </button>
            </div>
          </div>

          <!-- Content wrapper (with padding) -->
          <div class="overlay-body" ref="overlayBodyRef">
            <div v-if="switchingSession" class="session-switch-loading">
              <span class="session-switch-spinner"></span>
              <span class="session-switch-text">Loading session...</span>
            </div>
            <ConversationTab
              v-else
              ref="conversationTabRef"
              :session-id="activeSessionId"
              :key="activeSessionId"
              :scroll-container-ref="overlayBodyRef"
              :hide-new-conversation="true"
            />
          </div>
          </div><!-- end overlay-content -->
        </div><!-- end overlay-panel-wrapper -->
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
/* eslint-disable max-lines */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useTodosStore } from '../stores/todos.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useSessionSubscription.js';
import { useSessionPolling } from '../composables/useSessionPolling.js';
import { api } from '../composables/useApi.js';

import ConversationTab from './ConversationTab.vue';
import SessionTreePicker from './SessionTreePicker.vue';

const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
  /** Session chain from parent (lifted from internal buildSessionChain) */
  sessionChain: {
    type: Array,
    default: () => [],
  },
  /** Summaries map from parent (lifted from internal summary fetching) */
  summariesMap: {
    type: Object,
    default: () => ({}),
  },
});

const emit = defineEmits(['close', 'session-created']);

const sessionsStore = useSessionsStore();
const todosStore = useTodosStore();
const uiStore = useUiStore();

// Internal state
const visible = ref(true);
const closing = ref(false);
const activeSessionId = ref(props.sessionId);
const isMobile = ref(false);
const isCreatingSession = ref(false);
// Start as true so ConversationTab doesn't mount until loadSessionData completes.
// This prevents a race condition where ConversationTab reads currentSession before
// it has been set to the overlay's target session.
const switchingSession = ref(true);

// Overlay body ref for scroll container override
const overlayBodyRef = ref(null);

// Template ref to the ConversationTab for flushing drafts before session switch
const conversationTabRef = ref(null);

// Picker state
const pickerOpen = ref(false);
const pickerAreaRef = ref(null);

const activeSessionDisplayName = computed(() => {
  const session = sessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  return session?.name || 'Session';
});

function togglePicker() {
  pickerOpen.value = !pickerOpen.value;
}

function handlePickerSelect(sessionId) {
  pickerOpen.value = false;
  selectSession(sessionId);
}

function handlePickerEscape(event) {
  if (event.key === 'Escape' && pickerOpen.value) {
    event.stopPropagation();
    pickerOpen.value = false;
  }
}

function handleClickOutsidePicker(event) {
  if (pickerOpen.value) {
    const picker = document.querySelector('[data-testid="session-tree-picker"]');
    const trigger = document.querySelector('[data-testid="overlay-picker-trigger"]');
    if (picker && !picker.contains(event.target) &&
        (!trigger || !trigger.contains(event.target))) {
      pickerOpen.value = false;
    }
  }
}

// Name editing state
const isEditingName = ref(false);
const editNameValue = ref('');
const nameEditInput = ref(null);

// WebSocket subscription management (NOT useSessionInitializer)
let currentSubscription = null;
let wsCleanups = [];

// Lightweight polling for the active session
const {
  startPolling,
  stopPolling,
  reset: resetPolling,
} = useSessionPolling({
  getSessionId: () => activeSessionId.value,
  getSessionStatus: () => {
    const session = sessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
    return session?.status;
  },
  sessionsStore,
});

// Computed
const rootSession = computed(() => {
  const root = sessionsStore.getRootSession(props.sessionId);
  if (root) return root;
  // Fallback: check currentSession if not found in sessions array
  const current = sessionsStore.currentSession;
  if (current?.id === props.sessionId) return current;
  return null;
});

const rootSessionName = computed(() => {
  // Always show the root (parent) session name in the overlay header.
  // This stays fixed regardless of which child session is currently viewed.
  // Priority 1: use the sessionChain prop (most reliable — contains the tree
  // with depth info, so the root is always the entry with depth === 0).
  const chainRoot = props.sessionChain.find(entry => entry.depth === 0);
  if (chainRoot?.session?.name) return chainRoot.session.name;
  // Priority 2: use getRootSession from the store
  if (rootSession.value?.name) return rootSession.value.name;
  // Priority 3: fallback to currentSession
  return sessionsStore.currentSession?.name || 'Session';
});

const hasDescendants = computed(() => {
  return props.sessionChain.length > 1;
});

const activeSessionName = computed(() => {
  const session = sessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  return session?.name || 'Session';
});

const overlaySessionStatus = computed(() => {
  const session = sessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  return session?.status || '';
});

const isOverlaySessionActive = computed(() => {
  return overlaySessionStatus.value === 'running' || overlaySessionStatus.value === 'starting';
});

const backToSessionsUrl = computed(() => {
  const session = sessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  if (session?.projectId) {
    return `/projects/${session.projectId}/sessions`;
  }
  return '/';
});

// Methods
function close() {
  // Guard: don't re-trigger if already closing
  if (closing.value) {
    console.log('[SessionTreeOverlay] Already closing, ignoring close() call');
    return;
  }
  console.log('[SessionTreeOverlay] close() called, setting closing=true, visible=false');
  closing.value = true;
  visible.value = false;  // This triggers the leave transition
}

function afterLeave() {
  if (!closing.value) {
    console.log('[SessionTreeOverlay] afterLeave() called but not closing, ignoring');
    return;
  }
  console.log('[SessionTreeOverlay] afterLeave() called, emitting close event');
  closing.value = false; // Reset state
  emit('close');  // Only emit after transition completes
}

async function selectSession(sessionId) {
  await switchToSession(sessionId);
}

async function addChildSession() {
  if (isCreatingSession.value) return;

  const currentSession = sessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  if (!currentSession?.projectId) {
    uiStore.error('Cannot create session: no project context');
    return;
  }

  isCreatingSession.value = true;
  try {
    // Use api.createSession directly instead of sessionsStore.createSession to avoid
    // setting store.loading = true, which would cause SessionDetailView to unmount
    // the overlay (it conditionally renders based on !sessionsStore.loading).
    // prompt must be non-empty to pass Zod validation (z.string().min(1))
    // Only inherit git settings when the parent has an actual gitWorktree.
    // The server handles worktree inheritance for child sessions (checks parentSession.gitWorktree).
    // For branch-only or no-git parents, omit git params to avoid triggering
    // git checkout in directories that may not be git repos.
    const gitMode = currentSession.gitWorktree ? 'worktree' : undefined;
    const gitBranch = currentSession.gitWorktree ? currentSession.gitBranch : undefined;

    const newSession = await api.createSession(currentSession.projectId, {
      prompt: ' ',
      name: 'New Session',
      parentSessionId: activeSessionId.value,
      startImmediately: false,
      ...(gitMode && gitBranch ? { gitMode, gitBranch } : {}),
    });

    // Add to store manually (mirrors what sessionsStore.createSession does)
    sessionsStore.sessions.unshift(newSession);

    // Notify parent to rebuild session chain so it includes the new child
    emit('session-created', newSession.id);

    // Switch the overlay to the new session
    await switchToSession(newSession.id);
  } catch (err) {
    uiStore.error(err.message || 'Failed to create child session');
  } finally {
    isCreatingSession.value = false;
  }
}

// Name editing functions
function startEditName() {
  editNameValue.value = activeSessionName.value;
  isEditingName.value = true;
  nextTick(() => {
    nameEditInput.value?.focus();
  });
}

function cancelEditName() {
  isEditingName.value = false;
  editNameValue.value = '';
}

function clearSessionName() {
  editNameValue.value = '';
  nextTick(() => {
    nameEditInput.value?.focus();
  });
}

async function saveSessionName() {
  const newName = editNameValue.value.trim();
  const sessionId = activeSessionId.value;

  if (!newName) {
    uiStore.error('Session name cannot be empty');
    return;
  }

  try {
    const updated = await api.updateSession(sessionId, {
      name: newName,
      manuallyNamed: true
    });
    sessionsStore.updateSession({ ...updated, id: sessionId });
    uiStore.success('Session name updated');
    isEditingName.value = false;
    editNameValue.value = '';
  } catch (err) {
    uiStore.error(err.message || 'Failed to update session name');
  }
}

async function switchToSession(newSessionId) {
  if (newSessionId === activeSessionId.value) return;

  // Flush any pending draft save for the CURRENT session before switching.
  // This ensures that text typed within the debounce window is persisted.
  conversationTabRef.value?.flushDraft?.();

  // Show spinner immediately
  switchingSession.value = true;

  try {
    // Reset shared store state to avoid stale data from previous session
    sessionsStore.clearRunningUsage();
    sessionsStore.clearPartialText();
    todosStore.clearTodos();

    cleanupSubscription();
    activeSessionId.value = newSessionId;
    console.log('[switchToSession] activeSessionId SET to:', activeSessionId.value);

    await loadSessionData(newSessionId);
    setupSubscription(newSessionId);
  } finally {
    // Always hide spinner — even if something unexpected throws
    switchingSession.value = false;
  }
}

async function loadSessionData(sessionId) {
  try {
    // Always fetch session to ensure currentSession is set to the overlay's active session.
    // This is critical because ConversationTab reads sessionsStore.currentSession for
    // isDraft checks, status watchers, etc. Without this, currentSession could remain
    // pointed at the parent session after switching to a child in the overlay.
    // Update viewedSessionId so the fetchSession guard allows setting currentSession.
    sessionsStore.viewedSessionId = sessionId;
    await sessionsStore.fetchSession(sessionId, false);
    // Fetch conversations for this session
    await sessionsStore.fetchConversations(sessionId);

    // Fetch todos for the new active conversation
    if (sessionsStore.activeConversationId) {
      todosStore.fetchTodos(sessionId, sessionsStore.activeConversationId);
    }
  } catch (err) {
    console.error('[SessionTreeOverlay] Failed to load session data:', err);
  }
}

function setupSubscription(sessionId) {
  currentSubscription = useSessionSubscription(sessionId);
  currentSubscription.subscribe();

  // Register key handlers
  wsCleanups.push(
    currentSubscription.onStatus((status) => {
      sessionsStore.updateSessionStatus(sessionId, status);
      if (status === 'running' || status === 'starting') {
        startPolling();
      } else {
        stopPolling();
      }
    })
  );

  wsCleanups.push(
    currentSubscription.onMessage((message) => {
      sessionsStore.addMessage(message);
      sessionsStore.clearPartialText();
    })
  );

  wsCleanups.push(
    currentSubscription.onPartial((text) => {
      sessionsStore.setPartialText(text);
    })
  );

  wsCleanups.push(
    currentSubscription.onSessionUpdate((session) => {
      sessionsStore.updateSession(session);
    })
  );

  wsCleanups.push(
    currentSubscription.onConversationCreated((conversation) => {
      sessionsStore.addConversation(conversation);
    })
  );

  wsCleanups.push(
    currentSubscription.onConversationUpdated((conversation) => {
      sessionsStore.updateConversation(conversation);
    })
  );

  // Start polling if session is active
  const session = sessionsStore.getSessionById(sessionId) || sessionsStore.currentSession;
  if (session?.status === 'running' || session?.status === 'starting') {
    startPolling();
  }
}

function cleanupSubscription() {
  resetPolling();
  wsCleanups.forEach((c) => c());
  wsCleanups = [];
  if (currentSubscription) {
    currentSubscription.unsubscribe();
    currentSubscription = null;
  }
}

function checkMobile() {
  isMobile.value = window.innerWidth < 768;
}

function handleEscape(event) {
  if (event.key === 'Escape') {
    if (pickerOpen.value) {
      pickerOpen.value = false;
    } else if (isEditingName.value) {
      cancelEditName();
    } else {
      close();
    }
  }
}

// Body scroll lock to prevent horizontal layout shift when overlay is open
let savedBodyOverflow = '';

function lockBodyScroll() {
  savedBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
  document.body.style.overflow = savedBodyOverflow;
}

// Lifecycle
onMounted(async () => {
  lockBodyScroll();
  document.addEventListener('keydown', handleEscape);
  document.addEventListener('click', handleClickOutsidePicker, true);
  window.addEventListener('resize', checkMobile);
  checkMobile();

  // Load data for the active session, then reveal ConversationTab.
  // switchingSession starts as true, so ConversationTab won't mount until
  // currentSession is set to the correct overlay session.
  try {
    await loadSessionData(activeSessionId.value);
    setupSubscription(activeSessionId.value);
  } finally {
    switchingSession.value = false;
  }
});

onUnmounted(() => {
  unlockBodyScroll();
  document.removeEventListener('keydown', handleEscape);
  document.removeEventListener('click', handleClickOutsidePicker, true);
  window.removeEventListener('resize', checkMobile);
  cleanupSubscription();
});

// Expose for testing
defineExpose({
  activeSessionId,
  isMobile,
  closing,
  visible,
  afterLeave,
  isCreatingSession,
  switchingSession,
  pickerOpen,
  handlePickerSelect,
});
</script>

<!-- Transition styles must be unscoped because Teleport moves the DOM outside this component's scope -->
<style>
/* Slide-left transition (unscoped for Teleport compatibility) */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-left-enter-from {
  transform: translateX(100%);
}

.slide-left-enter-to {
  transform: translateX(0);
}

.slide-left-leave-from {
  transform: translateX(0);
}

.slide-left-leave-to {
  transform: translateX(100%);
}

/* Respect user's motion preferences */
@media (prefers-reduced-motion: reduce) {
  .slide-left-enter-active,
  .slide-left-leave-active {
    transition: transform 0.15s ease;
  }
}

/* Session switch loading spinner */
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
</style>

<style scoped>
.overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgb(17, 24, 39);
  display: flex;
  justify-content: flex-end;
  align-items: flex-start;
  overflow: hidden;
  overflow-y: hidden;
}

.overlay-panel-wrapper {
  position: relative;
  display: flex;
  height: 100vh;
  height: 100dvh;
  max-width: 900px;
  width: 100%;
  overflow: visible;
}

.overlay-close-handle {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: rgba(55, 65, 81, 0.4);
  border-radius: 8px;
  cursor: pointer;
  z-index: 10;
  transition: background-color 0.2s ease;
  min-width: 44px;
  min-height: 44px;
  border: none;
}

.overlay-close-handle:hover {
  background: rgba(8, 145, 178, 0.7);
}

.overlay-close-handle:focus-visible {
  outline: 2px solid var(--color-primary, #06b6d4);
  outline-offset: 2px;
}

.overlay-close-handle .handle-icon {
  color: var(--color-text-soft, #9ca3af);
  transition: color 0.2s ease;
}

.overlay-close-handle:hover .handle-icon {
  color: #fff;
}

.overlay-close-handle .active-spinner {
  width: 0.75rem;
  height: 0.75rem;
  border: 2px solid rgba(6, 182, 212, 0.3);
  border-top-color: #06b6d4;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.overlay-content {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  box-shadow: -4px 0 20px rgba(0, 0, 0, 0.5);
}

.overlay-body {
  padding: 0 1rem;
  flex: 1;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
}

.overlay-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1rem;
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  flex-shrink: 0;
  z-index: 10;
  width: 100%;
}

.overlay-header-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.overlay-header-selector {
  position: relative;
}

.overlay-header-actions {
  justify-content: space-between;
}

.overlay-root-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-primary, #06b6d4);
  word-break: break-word;
}

.dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-chevron {
  color: var(--color-text-soft, #9ca3af);
  margin-left: 0.5rem;
  flex-shrink: 0;
}

/* Ensure messages container does NOT independently scroll within the overlay.
   The .overlay-body is the sole scroll container; .messages just flows inside it.
   This prevents two nested scroll containers from fighting each other during
   streaming auto-scroll (useMessageScroll targets .overlay-body via scrollContainerRef). */
.session-tree-overlay :deep(.messages) {
  max-height: none !important;
  overflow-y: visible;
  flex: 1;
}

@media (max-width: 768px) {
  .overlay-body {
    padding: 0 0.5rem;
  }

  .overlay-header {
    padding: 1rem 0.5rem;
  }
}

@media (min-width: 769px) and (max-width: 1024px) {
  .overlay-panel-wrapper {
    max-width: 700px;
  }
}

/* Session name editing styles */
.session-name-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.name-edit-form {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
}

.name-edit-input {
  background: var(--color-bg-input, #1e1e1e);
  border: 1px solid var(--color-border, #333);
  border-radius: 4px;
  padding: 0.375rem 0.5rem;
  font-size: 0.8125rem;
  color: var(--color-text, #e0e0e0);
  min-width: 200px;
  max-width: 400px;
  flex: 1;
}

.name-edit-input:focus {
  outline: none;
  border-color: var(--color-primary, #00bcd4);
}

.name-edit-input::placeholder {
  color: var(--color-text-soft, #888);
}

.btn-icon {
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
  flex-shrink: 0;
}

.btn-icon:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--color-text, #ccc);
}

.btn-icon:active {
  background: rgba(255, 255, 255, 0.15);
}

.pr-edit-btn {
  width: 28px;
  height: 28px;
}

.pr-save-btn {
  color: var(--color-success, #4caf50);
}

.pr-save-btn:hover {
  background: rgba(76, 175, 80, 0.1);
}

.pr-cancel-btn {
  color: var(--color-text-soft, #888);
}

.pr-cancel-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.pr-clear-btn {
  color: var(--color-error, #f44336);
}

.pr-clear-btn:hover {
  background: rgba(244, 67, 54, 0.1);
}

.name-edit-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  background: none;
  border: none;
  color: var(--color-text-soft, #888);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.25rem 0.375rem;
  border-radius: 4px;
  transition: color 0.15s, background-color 0.15s;
}

.name-edit-trigger:hover {
  color: var(--color-primary, #00bcd4);
  background: rgba(0, 188, 212, 0.1);
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

.btn-link {
  background: none;
  border: none;
  cursor: pointer;
}

.back-to-sessions-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--color-text-soft, #9ca3af);
  text-decoration: none;
  transition: color 0.15s;
  flex-shrink: 0;
  margin-right: 0.75rem;
}

.back-to-sessions-link:hover {
  color: var(--color-primary, #06b6d4);
}
</style>
