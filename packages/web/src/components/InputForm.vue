<template>
  <form @submit.prevent="handleSubmit" class="input-form">
    <ResizableTextarea
      ref="textareaRef"
      :modelValue="modelValue"
      class="form-input form-textarea"
      :placeholder="placeholderText"
      :min-height="80"
      @input="$emit('input', $event)"
      @keydown="handleKeydown"
    />

    <!-- Quick Responses Panel - shows below the textarea when not running or for draft sessions -->
    <QuickResponsesPanel
      v-if="(canSendMessage || isDraft) && !isScheduledForFuture"
      :show-empty="true"
      @insert="$emit('quickResponseInsert', $event)"
      @openSettings="$emit('openQuickResponseSettings')"
    />

    <!-- Auto-send checkbox - only during running with content -->
    <div v-if="isRunning && inputHasContent" class="auto-send-row">
      <label class="auto-send-label">
        <input
          type="checkbox"
          :checked="autoSendPendingPrompt"
          @change="$emit('autoSendToggle', $event.target.checked)"
          class="auto-send-checkbox"
        />
        <span class="auto-send-text">Send automatically when Claude finishes</span>
      </label>
    </div>

    <!-- Send button row -->
    <div v-if="!isScheduledForFuture && !isRunning" class="send-button-row">
      <div v-if="isDraft" class="draft-actions">
        <button type="submit" class="btn btn-primary btn-send-full" :disabled="restarting || saveStatus === 'saving'">
          <span v-if="restarting" class="loading-spinner"></span>
          {{ restarting ? 'Sending...' : 'Send' }}
        </button>
      </div>
      <template v-else>
        <button
          type="submit"
          class="btn btn-primary btn-send-full"
          :disabled="isSendDisabled"
          :title="sendButtonDisabledReason"
        >
          <span v-if="sending" class="loading-spinner"></span>
          {{ sending ? 'Sending...' : 'Send' }}
        </button>
      </template>
    </div>

    <div v-if="!isScheduledForFuture && !isRunning" class="input-controls">
      <div class="session-options">
        <div class="mode-switcher">
          <ModeSelector :sessionId="sessionId" />
        </div>

        <ModelSelector :modelValue="selectedModel" @update:modelValue="$emit('update:selectedModel', $event)" />

        <FileAttachment ref="fileAttachment" @update:files="$emit('update:attachedFiles', $event)" />
        <SlashCommandButton
          v-if="workingDirectory"
          @open="$emit('openSlashCommand')"
        />
        <div class="thinking-toggle">
          <label class="toggle-switch">
            <input
              type="checkbox"
              :checked="thinkingEnabled"
              @change="$emit('thinkingToggle', $event)"
              :disabled="togglingThinking"
            />
            <span class="toggle-slider"></span>
          </label>
          <span class="toggle-label">Thinking</span>
        </div>
      </div>
    </div>

    <!-- Orchestration Panel - shows after input controls -->
    <OrchestrationPanel
      v-if="(canSendMessage || isDraft || isRunning) && !isScheduledForFuture"
      :session-id="sessionId"
      :project-id="projectId"
      :current-template-id="currentTemplateId"
      :session-status="sessionStatus"
      :is-draft="isDraft"
      :input-has-content="inputHasContent"
      :auto-reschedule-enabled="autoRescheduleEnabled"
      @openSchedule="$emit('openSchedule')"
      @openAutoReschedule="$emit('openAutoReschedule')"
      @update:templateId="$emit('templateChange', $event)"
    />
  </form>
</template>

<script setup>
import { ref, computed } from 'vue';
import { formatDistanceToNow } from 'date-fns';
import { useSubmitShortcut } from '../composables/useSubmitShortcut.js';
import ResizableTextarea from './ResizableTextarea.vue';
import QuickResponsesPanel from './QuickResponsesPanel.vue';
import ModelSelector from './ModelSelector.vue';
import ModeSelector from './ModeSelector.vue';
import FileAttachment from './FileAttachment.vue';
import SlashCommandButton from './SlashCommandButton.vue';
import OrchestrationPanel from './OrchestrationPanel.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
  modelValue: { type: String, default: '' },
  selectedModel: { type: [String, null], default: null },
  canSendMessage: { type: Boolean, default: false },
  isDraft: { type: Boolean, default: false },
  isScheduledDraft: { type: Boolean, default: false },
  isScheduledForFuture: { type: Boolean, default: false },
  sending: { type: Boolean, default: false },
  restarting: { type: Boolean, default: false },
  togglingThinking: { type: Boolean, default: false },
  saveStatus: { type: String, default: 'saved' },
  inputHasContent: { type: Boolean, default: false },
  thinkingEnabled: { type: Boolean, default: false },
  workingDirectory: { type: String, default: null },
  projectId: { type: String, default: null },
  currentTemplateId: { type: String, default: null },
  sessionStatus: { type: String, default: null },
  autoRescheduleEnabled: { type: Boolean, default: false },
  scheduledAt: { type: String, default: null },
  sendButtonDisabledReason: { type: String, default: null },
  isSendDisabled: { type: Boolean, default: false },
  autoSendPendingPrompt: { type: Boolean, default: false },
});

const emit = defineEmits([
  'submit',
  'input',
  'quickResponseInsert',
  'openQuickResponseSettings',
  'update:attachedFiles',
  'openSlashCommand',
  'thinkingToggle',
  'openSchedule',
  'openAutoReschedule',
  'templateChange',
  'update:modelValue',
  'update:selectedModel',
  'autoSendToggle',
]);

const textareaRef = ref(null);
const fileAttachment = ref(null);

const placeholderText = computed(() => {
  if (props.isScheduledForFuture) return 'Edit your scheduled prompt...';
  if (props.isDraft || props.isScheduledDraft) return 'Edit your prompt...';
  return 'Send a follow-up message...';
});

const isRunning = computed(() => props.sessionStatus === 'running');

// Create keyboard shortcut handler
const handleKeydown = useSubmitShortcut(() => {
  handleSubmit();
});

function handleSubmit() {
  emit('submit');
}

/**
 * Clear the file attachment component.
 */
function clearFiles() {
  fileAttachment.value?.clear();
}

defineExpose({
  textareaRef,
  clearFiles,
});
</script>

<style scoped>
.input-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.input-form textarea {
  width: 100%;
}

.input-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.session-options {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
  flex: 1;
}

.thinking-toggle {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toggle-label {
  font-size: 0.875rem;
  color: var(--color-text-soft);
}

.mode-switcher {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 22px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-background-mute);
  border: 1px solid var(--color-border);
  border-radius: 22px;
  transition: 0.2s;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background-color: var(--color-text-soft);
  border-radius: 50%;
  transition: 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--color-primary);
  border-color: var(--color-primary);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(18px);
  background-color: #fff;
}

.toggle-switch input:disabled + .toggle-slider {
  opacity: 0.5;
  cursor: not-allowed;
}

.auto-send-row {
  padding: 0.5rem 0;
}

.auto-send-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
  color: var(--color-text-soft, #9ca3af);
}

.auto-send-checkbox {
  width: 1rem;
  height: 1rem;
  cursor: pointer;
  accent-color: var(--color-primary, #06b6d4);
}

.auto-send-text {
  user-select: none;
}

.send-button-row {
  padding-top: 0.75rem;
  margin-bottom: 14px;
  display: flex;
  justify-content: center;
}

.btn-send-full {
  width: 100%;
  min-height: 52px;
  padding: 1rem 1.5rem;
  font-size: 1.1rem;
  font-weight: 600;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.draft-actions {
  width: 100%;
}

/* Responsive styles for input controls */
@media (max-width: 600px) {
  .input-controls {
    flex-wrap: wrap;
  }

  .session-options {
    width: 100%;
    justify-content: flex-start;
  }
}

@media (max-width: 400px) {
  .mode-label {
    display: none;
  }
}
</style>
