<template>
  <Teleport to="body">
    <Transition
      name="slide-left"
      appear
      @after-leave="afterLeave"
    >
      <div
        v-if="visible"
        class="overlay-backdrop"
        data-testid="session-chat-overlay"
        @click.self="close"
      >
        <div
          class="overlay-panel-wrapper"
          @click.stop
        >
          <div
            class="overlay-close-handle"
            tabindex="0"
            role="button"
            :aria-label="isOverlaySessionActive
              ? (effectiveOverlaySessionStatus === 'starting' ? 'Workspace starting...' : 'Workspace running...')
              : 'Close workspace chat'"
            :title="isOverlaySessionActive
              ? (effectiveOverlaySessionStatus === 'starting' ? 'Workspace starting...' : 'Workspace running...')
              : 'Close workspace chat'"
            data-testid="session-chat-overlay-close-handle"
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
              :title="effectiveOverlaySessionStatus === 'starting' ? 'Workspace starting...' : 'Workspace running...'"
            />
          </div>

          <SessionChatContent
            ref="contentRef"
            :session-id="sessionId"
            :session-chain="sessionChain"
            :summaries-map="summariesMap"
            mode="overlay"
            @session-created="$emit('session-created', $event)"
            @session-deleted="$emit('session-deleted', $event)"
            @prompt-focus="handleOverlayPromptFocus"
            @prompt-blur="handleOverlayPromptBlur"
            @picker-open-change="pickerOpen = $event"
            @active-session-change="handleActiveSessionChange"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import {
  requestVisualViewportSettle,
  requestVisualViewportUpdate,
  setSessionOverlayPromptFocus,
} from '../composables/useVisualViewport.js';
import SessionChatContent from './SessionChatContent.vue';

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
});

const emit = defineEmits(['close', 'session-created', 'session-deleted']);
const mainSessionsStore = useSessionsStore();

const visible = ref(true);
const closing = ref(false);
const pickerOpen = ref(false);
const contentRef = ref(null);
const overlaySessionStatus = ref('');
const isOverlayPromptFocused = ref(false);
let overlayPromptBlurTimer = null;
let promptVisibilityRaf = null;
let savedScrollY = 0;
let lockActive = false;

const currentOverlaySession = computed(() => mainSessionsStore.getSessionById(props.sessionId));
const effectiveOverlaySessionStatus = computed(() =>
  overlaySessionStatus.value || currentOverlaySession.value?.status || ''
);
const isOverlaySessionActive = computed(() =>
  effectiveOverlaySessionStatus.value === 'running' || effectiveOverlaySessionStatus.value === 'starting'
);

function close() {
  if (closing.value) return;
  closing.value = true;
  visible.value = false;
}

function afterLeave() {
  if (!closing.value) return;
  closing.value = false;
  emit('close');
}

function handleActiveSessionChange(session) {
  overlaySessionStatus.value = session?.status || '';
}

function handlePickerSelect(sessionId) {
  return contentRef.value?.handlePickerSelect?.(sessionId);
}

function handleEscape(event) {
  if (event.key !== 'Escape') return;
  if (pickerOpen.value) {
    contentRef.value?.closePicker?.();
    return;
  }
  close();
}

function clearPromptBlurTimer() {
  if (overlayPromptBlurTimer) {
    clearTimeout(overlayPromptBlurTimer);
    overlayPromptBlurTimer = null;
  }
}

function clearPromptVisibilityRaf() {
  if (promptVisibilityRaf) {
    cancelAnimationFrame(promptVisibilityRaf);
    promptVisibilityRaf = null;
  }
}

function requestPromptVisibilityCheck() {
  clearPromptVisibilityRaf();
  promptVisibilityRaf = requestAnimationFrame(() => {
    promptVisibilityRaf = null;
    const body = contentRef.value?.bodyRef;
    const textarea = body?.querySelector?.('.input-form textarea');
    const sendButton = body?.querySelector?.('.btn-send-full');
    const spacer = body?.querySelector?.('.session-overlay-keyboard-spacer');
    if (!body || !textarea) return;

    const bodyRect = body.getBoundingClientRect();
    const targetRect = (sendButton || textarea).getBoundingClientRect();
    const spacerHeight = spacer?.getBoundingClientRect?.().height || 0;
    const visibleBottom = bodyRect.bottom - spacerHeight;
    if (targetRect.bottom > visibleBottom) {
      body.scrollTop += targetRect.bottom - visibleBottom + 12;
    }
  });
}

function handleOverlayPromptFocus() {
  clearPromptBlurTimer();
  isOverlayPromptFocused.value = true;
  contentRef.value?.setComposerFocused?.(true);
  setSessionOverlayPromptFocus(true);
  requestVisualViewportUpdate();
  requestVisualViewportSettle({ maxDurationMs: 700, minDurationMs: 200 });
  requestPromptVisibilityCheck();
}

function handleOverlayPromptBlur(event) {
  clearPromptBlurTimer();
  requestVisualViewportSettle({ maxDurationMs: 350, minDurationMs: 100 });
  overlayPromptBlurTimer = setTimeout(() => {
    overlayPromptBlurTimer = null;
    if (document.activeElement === event?.target) return;
    isOverlayPromptFocused.value = false;
    contentRef.value?.setComposerFocused?.(false);
    setSessionOverlayPromptFocus(false);
    requestVisualViewportSettle({ maxDurationMs: 350, minDurationMs: 100 });
  }, 80);
}

function lockPageForOverlay() {
  savedScrollY = window.scrollY || window.pageYOffset || 0;
  lockActive = true;
  document.documentElement.classList.add('session-overlay-open');
  document.body.classList.add('session-overlay-open');
}

function unlockPageForOverlay() {
  document.documentElement.classList.remove('session-overlay-open');
  document.body.classList.remove('session-overlay-open');

  const currentScrollY = window.scrollY || window.pageYOffset || 0;
  if (lockActive && Math.abs(currentScrollY - savedScrollY) > 1) {
    window.scrollTo(0, savedScrollY);
  }

  lockActive = false;
}

onMounted(() => {
  lockPageForOverlay();
  requestVisualViewportUpdate();
  requestVisualViewportSettle();
  document.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
  clearPromptBlurTimer();
  clearPromptVisibilityRaf();
  isOverlayPromptFocused.value = false;
  setSessionOverlayPromptFocus(false);
  unlockPageForOverlay();
  document.removeEventListener('keydown', handleEscape);
});

watch(pickerOpen, (open) => {
  if (open) {
    contentRef.value?.openPicker?.();
  } else {
    contentRef.value?.closePicker?.();
  }
});

defineExpose({
  activeSessionId: computed(() => contentRef.value?.activeSessionId),
  isCreatingSession: computed(() => contentRef.value?.isCreatingSession),
  switchingSession: computed(() => contentRef.value?.switchingSession),
  closing,
  visible,
  afterLeave,
  pickerOpen,
  handlePickerSelect,
  contentRef,
  overlayContentRef: computed(() => contentRef.value?.overlayContentRef),
  overlayHeaderRef: computed(() => contentRef.value?.overlayHeaderRef),
  overlayBodyRef: computed(() => contentRef.value?.overlayBodyRef),
});
</script>

<style>
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

@media (prefers-reduced-motion: reduce) {
  .slide-left-enter-active,
  .slide-left-leave-active {
    transition: transform 0.15s ease;
  }
}
</style>

<style scoped>
.overlay-backdrop {
  position: fixed;
  inset: 0;
  width: 100vw;
  max-width: 100vw;
  z-index: 1200;
  background: rgb(17, 24, 39);
  display: block;
  overflow: hidden;
  overscroll-behavior: none;
  touch-action: none;
}

.overlay-panel-wrapper {
  position: absolute;
  inset: 0 0 0 auto;
  width: 100%;
  max-width: 900px;
  min-width: 0;
  height: 100%;
  min-height: 0;
  display: flex;
  overflow: hidden;
  overscroll-behavior: none;
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
  z-index: 30;
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

@media (min-width: 769px) and (max-width: 1024px) {
  .overlay-panel-wrapper {
    max-width: 700px;
  }
}
</style>
