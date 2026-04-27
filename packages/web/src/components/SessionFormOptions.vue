<template>
  <div class="form-group">
    <label class="form-label">Options</label>

    <div class="options-row">
      <div class="mode-selector-wrapper">
        <ModeSelector
          :model-value="mode"
          @update:model-value="$emit('update:mode', $event)"
        />
      </div>

      <div class="model-selector-wrapper">
        <ModelSelector
          :model-value="model"
          @update:model-value="$emit('update:model', $event)"
          @update:provider-id="$emit('update:providerId', $event)"
        />
        <span
          v-if="isCodexModel"
          class="agent-badge"
          data-agent-badge="codex"
        >Agent: Codex</span>
      </div>

      <div
        class="effort-selector-wrapper"
        :class="{ 'option-disabled': isEffortSelectorDisabled }"
        :title="effortSelectorTitle"
      >
        <EffortLevelSelector
          :model-value="effortLevel"
          :disabled="isEffortSelectorDisabled"
          @update:model-value="$emit('update:effortLevel', $event)"
        />
      </div>

      <div
        class="thinking-toggle"
        :class="{ 'option-disabled': isThinkingToggleDisabled }"
        :title="thinkingToggleTitle"
      >
        <div class="field-with-badge">
          <label class="toggle-switch">
            <input
              type="checkbox"
              :checked="thinkingEnabled"
              :disabled="isThinkingToggleDisabled"
              @change="$emit('update:thinkingEnabled', $event.target.checked)"
            >
            <span class="toggle-slider" />
          </label>
          <span class="toggle-label">Enable Thinking</span>
        </div>
      </div>

      <div
        v-if="!hideStartImmediately"
        class="thinking-toggle"
      >
        <div class="field-with-badge">
          <label class="toggle-switch">
            <input
              type="checkbox"
              :checked="startImmediately"
              @change="$emit('update:startImmediately', $event.target.checked)"
            >
            <span class="toggle-slider" />
          </label>
          <span class="toggle-label">Start Immediately</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import ModelSelector from './ModelSelector.vue';
import ModeSelector from './ModeSelector.vue';
import EffortLevelSelector from './EffortLevelSelector.vue';
import { useModelInfo } from '../composables/useModelInfo.js';

const props = defineProps({
  mode: {
    type: String,
    default: 'yolo',
  },
  model: {
    type: String,
    default: null,
  },
  effortLevel: {
    type: String,
    default: null,
  },
  thinkingEnabled: {
    type: Boolean,
    default: true,
  },
  startImmediately: {
    type: Boolean,
    default: true,
  },
  hideStartImmediately: {
    type: Boolean,
    default: false,
  },
});

defineEmits([
  'update:mode',
  'update:model',
  'update:providerId',
  'update:effortLevel',
  'update:thinkingEnabled',
  'update:startImmediately',
]);

const { getModelInfo, fetchAgentCapabilities } = useModelInfo();
const capabilitiesLoaded = ref(false);
const capabilityVersion = ref(0);

// Ensure the /api/agents capability map is fetched once so `isCodexModel`
// can reflect actual server-reported capabilities rather than an empty cache.
onMounted(async () => {
  await fetchAgentCapabilities();
  capabilitiesLoaded.value = true;
  capabilityVersion.value += 1;
});

const selectedModelInfo = computed(() => {
  if (capabilityVersion.value < 0) return getModelInfo(props.model);
  return getModelInfo(props.model);
});

// Derive agent-type of the currently-selected model. A true value here hides
// thinking-specific controls (which Codex does not support).
const isCodexModel = computed(() => {
  if (!props.model) return false;
  return selectedModelInfo.value.agentType === 'codex';
});

const supportsThinkingToggle = computed(() => {
  if (!capabilitiesLoaded.value) return false;
  return selectedModelInfo.value.capabilities?.thinking === true;
});

const supportsReasoningEffort = computed(() => {
  if (!capabilitiesLoaded.value) return false;
  return selectedModelInfo.value.capabilities?.reasoningEffort === true;
});

const isThinkingToggleDisabled = computed(() => isCodexModel.value || !supportsThinkingToggle.value);
const isEffortSelectorDisabled = computed(() => !supportsReasoningEffort.value);

const thinkingToggleTitle = computed(() => (
  isThinkingToggleDisabled.value ? 'Thinking toggle is not supported for this agent' : ''
));

const effortSelectorTitle = computed(() => (
  isEffortSelectorDisabled.value ? 'Reasoning effort is not supported for this agent' : ''
));
</script>

<style scoped>
.options-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1.5rem;
  align-items: flex-start;
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

.mode-selector-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.model-selector-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.agent-badge {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--color-text-soft);
  background-color: var(--color-background-mute);
  border: 1px solid var(--color-border);
  border-radius: 0.375rem;
  padding: 0.125rem 0.375rem;
  letter-spacing: 0.02em;
}

.option-disabled {
  opacity: 0.5;
  pointer-events: none;
}

.effort-selector-wrapper {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.field-with-badge {
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

@media (max-width: 480px) {
  .options-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  /* Let the last item span full width */
  .options-row > :last-child {
    grid-column: 1 / -1;
  }
}
</style>
