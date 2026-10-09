<template>
  <div class="mode-selector">
    <!-- Native (agent-initiated) plan mode: the agent switched the CLI into
         plan mode itself via EnterPlanMode, independent of the product mode
         above. Clears when the plan is approved or the CLI reports another
         permission mode. When the pending plan card is available, the badge
         is an action that jumps to it; otherwise it stays a status label. -->
    <button
      v-if="canJumpToPlan"
      type="button"
      class="planning-badge planning-badge--action"
      title="The agent entered plan mode on its own. Activate to jump to the pending plan approval."
      aria-label="Go to the pending plan approval"
      @click="scrollToPlanCard"
    >
      Planning
    </button>
    <span
      v-else-if="isNativePlanning"
      class="planning-badge"
      title="The agent entered plan mode on its own. It will present a plan for your approval before implementing."
    >Planning</span>
    <select
      id="mode-select"
      :value="selectedMode"
      :disabled="disabled || togglingMode"
      :title="currentModeDescription"
      class="mode-select"
      @change="handleModeChange($event.target.value)"
    >
      <option
        v-for="m in modes"
        :key="m.value"
        :value="m.value"
      >
        {{ m.label }}
      </option>
    </select>
  </div>
</template>

<script setup>
import { ref, computed, watch, toRef } from 'vue';
import { museSessionModeCopy } from '@circuschief/shared';
import { useInjectedSessionsStore } from '../composables/useOverlayStore.js';
import { useSessionPromptsStore } from '../stores/sessionPrompts.js';
import { useUiStore } from '../stores/ui.js';

const props = defineProps({
  sessionId: {
    type: String,
    default: null,
  },
  modelValue: {
    type: String,
    default: null,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  agentType: {
    type: String,
    default: null,
  },
});

const emit = defineEmits(['update:modelValue']);

const sessionsStore = useInjectedSessionsStore();
const promptsStore = useSessionPromptsStore();
const uiStore = useUiStore();
const togglingMode = ref(false);

const DEFAULT_MODES = [
  { value: 'plan', label: 'Plan', description: 'Plans first; tool approvals are requested as needed' },
  { value: 'standard', label: 'Standard', description: 'Requests approval for each gated tool' },
  { value: 'yolo', label: 'YOLO', description: 'Automatically approves tool use' },
];

// Muse runs on the headless `muse exec` transport: gated modes enforce
// approvals via CLI flags and denied tools fail the run — nothing ever
// prompts the user, and only yolo auto-approves. The copy shares the
// server's policy table via museSessionModeCopy so the UI wording cannot
// drift from the enforced posture.
const effectiveAgentType = computed(() => (
  props.agentType ?? sessionsStore.currentSession?.agentType ?? null
));

const modes = computed(() => {
  if (effectiveAgentType.value !== 'muse') return DEFAULT_MODES;
  return ['plan', 'standard', 'yolo'].map((value) => ({ value, ...museSessionModeCopy(value) }));
});

// Use store state when sessionId provided, otherwise use modelValue prop
const currentMode = computed(() => {
  if (props.sessionId) {
    return sessionsStore.currentSession?.mode;
  }
  return props.modelValue;
});

// Server-mirrored CLI permission mode — 'plan' here means the agent entered
// native plan mode on its own (EnterPlanMode), which is orthogonal to the
// product mode in the select.
const isNativePlanning = computed(() => Boolean(props.sessionId)
  && sessionsStore.currentSession?.agentPermissionMode === 'plan');

// Only the queue head is ever surfaced to the client, so the badge jumps
// exactly when the head is the plan card — a plan queued behind another
// prompt is not yet reviewable and keeps the badge a plain status label.
const canJumpToPlan = computed(() => Boolean(props.sessionId)
  && isNativePlanning.value
  && promptsStore.promptFor(props.sessionId)?.kind === 'plan');

function scrollToPlanCard(event) {
  // Scope the lookup to this badge's own conversation view. The page can
  // host a main conversation and a SessionChatOverlay simultaneously, each
  // rendering its own plan card through ConversationTab — a global
  // querySelector would return whichever card comes first in document order,
  // potentially another session's Approve button. Each ConversationTab
  // renders only its own session's prompt, so the container boundary is also
  // the session-identity boundary. A view with no matching card is a safe
  // no-op, never a jump into another view.
  const scope = event?.currentTarget?.closest?.('.conversation-tab, .session-chat-content');
  const card = scope?.querySelector('.agent-prompt-card--plan');
  if (!card) return;
  if (typeof card.scrollIntoView === 'function') card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.querySelector('.prompt-primary-action')?.focus?.();
}

// Local state for optimistic UI updates - provides immediate visual feedback
const selectedMode = ref(currentMode.value);
const currentModeDescription = computed(() => modes.value.find((mode) => mode.value === selectedMode.value)?.description || '');

// Watch for external changes to keep local selection in sync
// Create a ref from the modelValue prop for reliable reactivity tracking
const modelValueRef = toRef(props, 'modelValue');

// Watch both the computed and the prop ref to ensure we catch all changes
watch([currentMode, modelValueRef], ([newCurrentMode]) => {
  selectedMode.value = newCurrentMode;
}, { flush: 'sync' });

async function handleModeChange(value) {
  if (togglingMode.value) return;
  if (selectedMode.value === value) return;

  // Immediate visual feedback - update UI right away
  selectedMode.value = value;

  if (props.sessionId) {
    // Session context: update store asynchronously
    togglingMode.value = true;
    try {
      await sessionsStore.updateSessionMode(props.sessionId, value);
    } catch (err) {
      // Revert selection on error
      selectedMode.value = currentMode.value;
      uiStore.error(err.message);
    } finally {
      togglingMode.value = false;
    }
  } else {
    // Form context: emit for v-model
    emit('update:modelValue', value);
  }
}
</script>

<style scoped>
.mode-selector {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.planning-badge {
  padding: 0.2rem 0.5rem;
  border: 1px solid rgba(210, 153, 34, 0.46);
  border-radius: 999px;
  background: rgba(210, 153, 34, 0.13);
  color: #f2c462;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
  cursor: help;
}

.planning-badge--action {
  font: inherit;
  cursor: pointer;
}

.planning-badge--action:hover {
  background: rgba(210, 153, 34, 0.25);
}

.planning-badge--action:focus-visible {
  outline: 2px solid #f2c462;
  outline-offset: 2px;
}

.mode-select {
  appearance: none;
  padding: 0.375rem 2rem 0.375rem 0.5rem;
  font-size: 0.75rem;
  font-weight: 500;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  color: var(--color-text-soft);
  cursor: pointer;
  transition: all 0.15s;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M1.5 4.5l4.5 4 4.5-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.5rem center;
  background-size: 12px;
  padding-right: 2rem;
}

.mode-select:hover:not(:disabled) {
  border-color: var(--color-border-hover);
  background-color: var(--color-bg-hover);
}

.mode-select:focus {
  outline: none;
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px rgba(6, 182, 212, 0.1);
}

.mode-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.mode-select option {
  background-color: var(--color-background);
  color: var(--color-text);
}
</style>
