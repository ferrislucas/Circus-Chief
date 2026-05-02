<template>
  <div class="resizable-textarea-wrapper">
    <textarea
      ref="textareaRef"
      v-bind="$attrs"
      :value="modelValue"
      @input="handleInput"
    />
    <div
      class="resize-handle"
      aria-hidden="true"
      @mousedown="startResize"
      @touchstart.prevent="startResize"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path
          d="M14 10L10 14M14 6L6 14"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
        />
      </svg>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  minHeight: {
    type: Number,
    default: 80
  },
  maxHeight: {
    type: Number,
    default: null
  }
});

const emit = defineEmits(['update:modelValue', 'input']);

function handleInput(event) {
  emit('update:modelValue', event.target.value);
  emit('input', event);
}

const textareaRef = ref(null);
let isResizing = false;

// Watch for external modelValue changes and update textarea
watch(() => props.modelValue, (newValue) => {
  if (textareaRef.value && textareaRef.value.value !== newValue) {
    textareaRef.value.value = newValue;
  }
});

function startResize(event) {
  if (!textareaRef.value) return;

  isResizing = true;

  const startY = event.type.startsWith('touch')
    ? event.touches[0].clientY
    : event.clientY;
  const startHeight = textareaRef.value.offsetHeight;

  const doResize = (e) => {
    if (!isResizing) return;

    const currentY = e.type.startsWith('touch')
      ? e.touches[0].clientY
      : e.clientY;

    let newHeight = startHeight + (currentY - startY);

    // Apply constraints
    newHeight = Math.max(props.minHeight, newHeight);
    if (props.maxHeight) {
      newHeight = Math.min(props.maxHeight, newHeight);
    }

    // Directly manipulate DOM to avoid Vue re-render
    textareaRef.value.style.height = `${newHeight  }px`;
  };

  const stopResize = () => {
    isResizing = false;
    document.removeEventListener('mousemove', doResize);
    document.removeEventListener('mouseup', stopResize);
    document.removeEventListener('touchmove', doResize);
    document.removeEventListener('touchend', stopResize);
    document.removeEventListener('touchcancel', stopResize);
  };

  document.addEventListener('mousemove', doResize);
  document.addEventListener('mouseup', stopResize);
  document.addEventListener('touchmove', doResize, { passive: false });
  document.addEventListener('touchend', stopResize);
  document.addEventListener('touchcancel', stopResize);
}

// Expose imperative DOM operations for parent components.
//
// NOTE ON `value` getter/setter: ConversationTab no longer writes to this
// setter — imperative writes from the parent caused the "ghost prompt" bug
// (see Fix 4 in the ghost-prompt-textarea plan). New code should update the
// reactive `modelValue` binding and let `watch(modelValue)` above sync the
// DOM. The getter/setter remains only as a backwards-compatibility shim
// for NewSessionView / `useNewSessionForm`, which still treats the ref as
// a DOM-ish handle. Remove once those callers migrate to the bound ref.
defineExpose({
  // DEPRECATED: prefer updating the reactive `modelValue` / bound ref.
  get value() {
    return textareaRef.value?.value || '';
  },
  set value(val) {
    if (textareaRef.value) {
      textareaRef.value.value = val;
    }
  },
  focus() {
    textareaRef.value?.focus();
  },
  blur() {
    textareaRef.value?.blur();
  },
  select() {
    textareaRef.value?.select();
  },
  // Expose selection properties (reading cursor position, placing caret)
  get selectionStart() {
    return textareaRef.value?.selectionStart || 0;
  },
  set selectionStart(val) {
    if (textareaRef.value) {
      textareaRef.value.selectionStart = val;
    }
  },
  get selectionEnd() {
    return textareaRef.value?.selectionEnd || 0;
  },
  set selectionEnd(val) {
    if (textareaRef.value) {
      textareaRef.value.selectionEnd = val;
    }
  },
  // Allow dispatching events on the textarea (e.g. synthetic 'input' for
  // slash-command insert to re-trigger the parent's debounced save).
  dispatchEvent(event) {
    return textareaRef.value?.dispatchEvent(event);
  }
});

onUnmounted(() => {
  // Cleanup any lingering event listeners
  isResizing = false;
});
</script>

<style scoped>
.resizable-textarea-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
}

.resizable-textarea-wrapper textarea {
  /* Disable native resize since we're handling it */
  resize: none;
  /* Add padding at bottom for the resize handle */
  padding-bottom: 24px;
  /* Ensure textarea fills the wrapper */
  width: 100%;
  box-sizing: border-box;
}

.resize-handle {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-soft, #6b7280);
  opacity: 0.5;
  transition: opacity 0.15s;
  touch-action: none; /* Critical for mobile - prevents scroll interference */
  user-select: none;
  -webkit-user-select: none;
  border-radius: 4px;
}

.resize-handle:hover,
.resize-handle:active {
  opacity: 1;
  background: rgba(255, 255, 255, 0.05);
}

/* Ensure the handle is visible on mobile */
@media (pointer: coarse) {
  .resize-handle {
    width: 32px;
    height: 32px;
    bottom: 2px;
    right: 2px;
    opacity: 0.6;
  }
}
</style>
