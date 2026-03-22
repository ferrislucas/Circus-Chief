<template>
  <Teleport to="body">
    <Transition name="slide-left" appear>
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
            aria-label="Close session tree"
            title="Close session tree"
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
          </div>

          <!-- Existing overlay-content -->
          <div class="overlay-content session-tree-overlay">
          <!-- Header (no padding constraints) -->
          <div class="overlay-header">
            <div class="overlay-header-left">
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
                  <span class="overlay-root-name">{{ activeSessionName }}</span>
                  <button class="btn-link name-edit-trigger" @click="startEditName" title="Edit session name">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                </div>
              </template>
            </div>
            <div class="overlay-header-right">
              <button
                v-if="hasDescendants && !isMobile"
                class="tree-icon-btn"
                data-testid="session-tree-icon"
                :title="pickerOpen ? 'Close session tree' : 'Open session tree'"
                @click="togglePicker"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path
                    d="M4 2v4h3v2H4v4h3M10 4h3M10 8h3M10 12h3"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button
                class="close-btn"
                data-testid="session-tree-close"
                aria-label="Close overlay"
                @click="close"
              >
                ✕
              </button>
            </div>
          </div>

          <!-- Content wrapper (with padding) -->
          <div class="overlay-body">
            <!-- Breadcrumb (inline) -->
            <nav
              v-if="activeSessionPath.length > 1"
              class="overlay-breadcrumb"
              aria-label="Session hierarchy"
              data-testid="session-tree-breadcrumb"
            >
              <ol class="breadcrumb-list">
                <li
                  v-for="(session, index) in activeSessionPath"
                  :key="session.id"
                  class="breadcrumb-item"
                >
                  <button
                    v-if="session.id !== activeSessionId"
                    class="breadcrumb-link"
                    :title="session.name"
                    @click="selectSession(session.id)"
                  >
                    {{ truncateName(session.name) }}
                  </button>
                  <span
                    v-else
                    class="breadcrumb-current"
                    :title="session.name"
                  >
                    {{ truncateName(session.name) }}
                  </span>
                  <span v-if="index < activeSessionPath.length - 1" class="breadcrumb-separator">/</span>
                </li>
              </ol>
            </nav>

            <!-- Dropdown trigger -->
            <div
              v-if="hasDescendants"
              class="overlay-dropdown"
              data-testid="session-tree-dropdown"
            >
              <button
                class="dropdown-trigger"
                :aria-expanded="pickerOpen ? 'true' : 'false'"
                @click="togglePicker"
              >
                <span class="dropdown-name">{{ activeSessionName }}</span>
                <span class="dropdown-chevron">{{ pickerOpen ? '▲' : '▼' }}</span>
              </button>
            </div>

            <!-- Picker -->
            <SessionTreePicker
              v-if="pickerOpen"
              :sessions="sessionChain"
              :active-session-id="activeSessionId"
              :summaries="summariesMap"
              @select="handlePickerSelect"
            />

            <!-- Conversation -->
            <ConversationTab
              :session-id="activeSessionId"
              :key="activeSessionId"
            />
          </div>
          </div><!-- end overlay-content -->
        </div><!-- end overlay-panel-wrapper -->
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useSessionSubscription } from '../composables/useSessionSubscription.js';
import { useSessionPolling } from '../composables/useSessionPolling.js';
import { api } from '../composables/useApi.js';
import SessionTreePicker from './SessionTreePicker.vue';
import ConversationTab from './ConversationTab.vue';

const props = defineProps({
  sessionId: {
    type: String,
    required: true,
  },
});

const emit = defineEmits(['close']);

const sessionsStore = useSessionsStore();
const uiStore = useUiStore();

// Internal state
const visible = ref(true);
const activeSessionId = ref(props.sessionId);
const pickerOpen = ref(false);
const isMobile = ref(false);
const summariesMap = ref({});
const sessionChain = ref([]);

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
  // Use sessionChain root if available (most reliable after buildSessionChain)
  if (sessionChain.value.length > 0) return sessionChain.value[0].name || 'Session';
  return rootSession.value?.name || sessionsStore.currentSession?.name || 'Session';
});

const hasDescendants = computed(() => {
  return sessionChain.value.length > 1;
});

const activeSessionName = computed(() => {
  const session = sessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  return session?.name || 'Session';
});

const activeSessionPath = computed(() => {
  return sessionsStore.getSessionPath(activeSessionId.value);
});

const backToSessionsUrl = computed(() => {
  const session = sessionsStore.getSessionById(activeSessionId.value) || sessionsStore.currentSession;
  if (session?.projectId) {
    return `/projects/${session.projectId}/sessions`;
  }
  return '/';
});

// Methods
function truncateName(name, maxLength = 30) {
  if (!name) return 'Unnamed';
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + '...';
}

function close() {
  emit('close');
}

function togglePicker() {
  pickerOpen.value = !pickerOpen.value;
}

function selectSession(sessionId) {
  switchToSession(sessionId);
}

function handlePickerSelect(sessionId) {
  pickerOpen.value = false;
  switchToSession(sessionId);
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

  // Cleanup old subscription
  cleanupSubscription();

  // Switch
  activeSessionId.value = newSessionId;

  // Load data for new session
  await loadSessionData(newSessionId);
  setupSubscription(newSessionId);
}

async function loadSessionData(sessionId) {
  try {
    // Always fetch session to ensure currentSession is set to the overlay's active session.
    // This is critical because ConversationTab reads sessionsStore.currentSession for
    // isDraft checks, status watchers, etc. Without this, currentSession could remain
    // pointed at the parent session after switching to a child in the overlay.
    await sessionsStore.fetchSession(sessionId, false);
    // Fetch conversations for this session
    await sessionsStore.fetchConversations(sessionId);
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

async function buildSessionChain() {
  // Ensure the current session is fetched first to populate the hierarchy
  const currentSession = sessionsStore.getSessionById(props.sessionId) || sessionsStore.currentSession;
  if (!currentSession) {
    try {
      await sessionsStore.fetchSession(props.sessionId, false);
    } catch {
      return;
    }
  }

  // Fetch the project's sessions directly via API to avoid setting store.loading = true
  // which would interfere with the main SessionDetailView rendering
  const session = sessionsStore.getSessionById(props.sessionId) || sessionsStore.currentSession;
  if (session?.projectId) {
    try {
      const projectSessions = await api.getProjectSessions(session.projectId, false, null);
      // Merge into store without triggering loading state
      for (const s of projectSessions) {
        if (!sessionsStore.getSessionById(s.id)) {
          sessionsStore.sessions.push(s);
        }
      }
    } catch {
      // Not critical if project sessions fail to load
    }
  }

  // Find root
  const root = sessionsStore.getRootSession(props.sessionId);
  if (!root) {
    // Current session is the root itself
    const current = sessionsStore.getSessionById(props.sessionId) || sessionsStore.currentSession;
    if (current) {
      sessionChain.value = [current];
    }
    return;
  }

  // Walk the chain from root through descendants
  const chain = [root];
  let currentId = root.id;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const children = sessionsStore.getChildSessions(currentId);
    if (children.length === 0) break;

    // Follow the first child (linear chain)
    const child = children[0];
    chain.push(child);
    currentId = child.id;
  }

  sessionChain.value = chain;

  // Fetch summaries for all sessions in the chain (non-blocking)
  for (const sess of chain) {
    if (!summariesMap.value[sess.id]) {
      api.getSessionSummary(sess.id)
        .then(summary => {
          if (summary) {
            summariesMap.value = { ...summariesMap.value, [sess.id]: summary };
          }
        })
        .catch(() => { /* Summaries are not critical */ });
    }
  }
}

function checkMobile() {
  isMobile.value = window.innerWidth < 768;
}

function handleEscape(event) {
  if (event.key === 'Escape') {
    if (isEditingName.value) {
      cancelEditName();
    } else if (pickerOpen.value) {
      pickerOpen.value = false;
    } else {
      close();
    }
  }
}

function handleClickOutsidePicker(event) {
  if (pickerOpen.value) {
    const picker = document.querySelector('[data-testid="session-tree-picker"]');
    const dropdown = document.querySelector('[data-testid="session-tree-dropdown"]');
    const treeIcon = document.querySelector('[data-testid="session-tree-icon"]');
    if (picker && !picker.contains(event.target) &&
        (!dropdown || !dropdown.contains(event.target)) &&
        (!treeIcon || !treeIcon.contains(event.target))) {
      pickerOpen.value = false;
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

  // Load data and build chain
  await loadSessionData(activeSessionId.value);
  setupSubscription(activeSessionId.value);
  await buildSessionChain();
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
  pickerOpen,
  isMobile,
  sessionChain,
});
</script>

<!-- Transition styles must be unscoped because Teleport moves the DOM outside this component's scope -->
<style>
/* Slide-left transition (unscoped for Teleport compatibility) */
.slide-left-enter-active,
.slide-left-leave-active {
  transition: opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1),
              transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.slide-left-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.slide-left-enter-to {
  opacity: 1;
  transform: translateX(0);
}

.slide-left-leave-from {
  opacity: 1;
  transform: translateX(0);
}

.slide-left-leave-to {
  opacity: 0;
  transform: translateX(100%);
}

/* Respect user's motion preferences */
@media (prefers-reduced-motion: reduce) {
  .slide-left-enter-active,
  .slide-left-leave-active {
    transition: opacity 0.15s ease;
  }

  .slide-left-enter-from,
  .slide-left-leave-to {
    transform: none;
  }
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
}

.overlay-panel-wrapper {
  position: relative;
  display: flex;
  height: 100vh;
  height: 100dvh;
  max-width: 900px;
  width: 100%;
}

.overlay-close-handle {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translate(-100%, -50%);
  width: 40px;
  height: 100px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(55, 65, 81, 0.8);
  border-radius: 8px 0 0 8px;
  cursor: pointer;
  z-index: 10;
  transition: background-color 0.2s ease, transform 0.2s ease;
  min-width: 44px;
  min-height: 44px;
  border: none;
}

.overlay-close-handle:hover {
  background: rgba(8, 145, 178, 0.9);
  transform: translate(calc(-100% - 4px), -50%);
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
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: var(--color-background-secondary, #1f2937);
  border-radius: 0;
  border-bottom: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  min-height: 60px;
  flex-shrink: 0;
  z-index: 10;
  width: 100%;
}

.overlay-header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex: 1;
  min-width: 0;
}

.overlay-root-name {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-primary, #06b6d4);
  word-break: break-word;
}

.overlay-header-right {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.tree-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  border-radius: var(--border-radius, 6px);
  cursor: pointer;
  color: var(--color-text-soft, #9ca3af);
  transition: color 0.15s, background-color 0.15s;
}

.tree-icon-btn:hover {
  color: var(--color-primary, #06b6d4);
  background: rgba(255, 255, 255, 0.05);
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  background: none;
  border-radius: var(--border-radius, 6px);
  cursor: pointer;
  color: var(--color-text-soft, #9ca3af);
  font-size: 1rem;
  transition: color 0.15s, background-color 0.15s;
}

.close-btn:hover {
  color: var(--color-text, #e5e7eb);
  background: rgba(255, 255, 255, 0.1);
}

/* Breadcrumb (inline) */
.overlay-breadcrumb {
  padding: 0.5rem;
  margin-top: 0.5rem;
  background: var(--color-background-secondary, rgba(0, 0, 0, 0.1));
  border-radius: var(--border-radius, 6px);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
}

.breadcrumb-list {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
  flex-wrap: wrap;
}

.breadcrumb-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
}

.breadcrumb-link {
  background: none;
  border: none;
  color: var(--color-text-soft, #9ca3af);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0;
  text-decoration: none;
  transition: color 0.15s;
}

.breadcrumb-link:hover {
  color: var(--color-primary, #06b6d4);
  text-decoration: underline;
}

.breadcrumb-current {
  color: var(--color-text, #e5e7eb);
  font-weight: 500;
}

.breadcrumb-separator {
  color: var(--color-text-soft, #9ca3af);
  margin: 0 0.25rem;
}

/* Dropdown trigger */
.overlay-dropdown {
  margin-top: 0.5rem;
}

.dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: var(--color-background-secondary, #1f2937);
  border: 1px solid var(--color-border, rgba(255, 255, 255, 0.1));
  border-radius: var(--border-radius, 6px);
  color: var(--color-text, #e5e7eb);
  cursor: pointer;
  font-size: 0.875rem;
  transition: background-color 0.15s;
}

.dropdown-trigger:hover {
  background: rgba(255, 255, 255, 0.05);
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

/* Ensure messages container scrolls within the overlay */
.session-tree-overlay :deep(.messages) {
  max-height: none !important;
  overflow-y: auto;
  flex: 1;
}

@media (max-width: 768px) {
  .overlay-body {
    padding: 0 0.5rem;
  }

  .overlay-header {
    padding: 1rem 0.5rem;
  }

  .overlay-close-handle {
    display: none;
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
  margin-right: 0.75rem;
  flex-shrink: 0;
}

.back-to-sessions-link:hover {
  color: var(--color-primary, #06b6d4);
}
</style>
