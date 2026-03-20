<template>
  <Teleport to="body">
    <Transition name="slide-left">
      <div
        v-if="visible"
        class="overlay-backdrop"
        data-testid="session-tree-overlay"
        @click.self="close"
      >
        <div class="overlay-content session-tree-overlay" @click.stop>
          <!-- Header -->
          <div class="overlay-header">
            <div class="overlay-header-left">
              <span class="overlay-root-name">{{ rootSessionName }}</span>
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
                <span v-if="index < activeSessionPath.length - 1" class="breadcrumb-separator">›</span>
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
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
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

// Internal state
const visible = ref(true);
const activeSessionId = ref(props.sessionId);
const pickerOpen = ref(false);
const isMobile = ref(false);
const summariesMap = ref({});
const sessionChain = ref([]);

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
    // Fetch session details if not in store
    const existing = sessionsStore.getSessionById(sessionId);
    if (!existing) {
      await sessionsStore.fetchSession(sessionId, false);
    }
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
    if (pickerOpen.value) {
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

// Lifecycle
onMounted(async () => {
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

<style scoped>
.overlay-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(17, 24, 39, 0.95);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  overflow-y: auto;
}

.overlay-content {
  width: 100%;
  max-width: 900px;
  min-height: 100vh;
  padding: 0 1rem;
}

.overlay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 0.5rem;
  background: var(--color-background-secondary, #1f2937);
  border-radius: var(--border-radius, 6px);
  margin-top: 1rem;
  height: 60px;
}

.overlay-header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.overlay-root-name {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-primary, #06b6d4);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  color: var(--color-primary, #06b6d4);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0;
  text-decoration: none;
  transition: color 0.15s;
}

.breadcrumb-link:hover {
  color: var(--color-primary-bright, #06ffff);
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

/* Slide-left transition */
.slide-left-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}

.slide-left-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.slide-left-enter-from {
  opacity: 0;
  transform: translateX(50px);
}

.slide-left-leave-to {
  opacity: 0;
  transform: translateX(50px);
}

/* ConversationMessages height override per wireframe spec */
.session-tree-overlay :deep(.messages) {
  max-height: 70vh;
}

@media (max-width: 1200px) {
  .session-tree-overlay :deep(.messages) {
    max-height: 65vh;
  }
}

@media (max-width: 768px) {
  .session-tree-overlay :deep(.messages) {
    max-height: 50vh;
  }

  .overlay-content {
    padding: 0 0.5rem;
  }
}
</style>
