<template>
  <div class="resizable-textarea-wrapper">
    <textarea
      ref="textareaRef"
      v-bind="$attrs"
      :value="modelValue"
      :style="textareaStyle"
      @input="handleInput"
    />
    <div
      class="resize-handle"
      aria-hidden="true"
      @pointerdown="startResize"
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
import { computed, ref, watch, onMounted, onUnmounted } from 'vue';

defineOptions({
  inheritAttrs: false
});

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

const emit = defineEmits(['update:modelValue', 'input', 'focus', 'blur']);

function handleInput(event) {
  emit('update:modelValue', event.target.value);
  emit('input', event);
}

function handleFocus(event) {
  emit('focus', event);
}

function handleBlur(event) {
  emit('blur', event);
}

const textareaRef = ref(null);
let isResizing = false;

const textareaStyle = computed(() => ({
  minHeight: `${props.minHeight}px`
}));

// Watch for external modelValue changes and update textarea
watch(() => props.modelValue, (newValue) => {
  if (textareaRef.value && textareaRef.value.value !== newValue) {
    textareaRef.value.value = newValue;
  }
});

function startResize(event) {
  if (!textareaRef.value) return;

  event.preventDefault();
  const handle = event.currentTarget;
  handle.setPointerCapture?.(event.pointerId);
  isResizing = true;

  const startY = event.clientY;
  const startHeight = textareaRef.value.offsetHeight;

  const doResize = (e) => {
    if (!isResizing) return;

    e.preventDefault();
    const currentY = e.clientY;

    let newHeight = startHeight + (currentY - startY);

    // Apply constraints
    newHeight = Math.max(props.minHeight, newHeight);
    if (props.maxHeight) {
      newHeight = Math.min(props.maxHeight, newHeight);
    }

    // Directly manipulate DOM to avoid Vue re-render
    textareaRef.value.style.height = `${newHeight  }px`;
  };

  const stopResize = (e) => {
    isResizing = false;
    handle.releasePointerCapture?.(e.pointerId);
    document.removeEventListener('pointermove', doResize);
    document.removeEventListener('pointerup', stopResize);
    document.removeEventListener('pointercancel', stopResize);
  };

  document.addEventListener('pointermove', doResize);
  document.addEventListener('pointerup', stopResize);
  document.addEventListener('pointercancel', stopResize);
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
  textareaRef.value?.removeEventListener('focus', handleFocus);
  textareaRef.value?.removeEventListener('blur', handleBlur);
});

onMounted(() => {
  textareaRef.value?.addEventListener('focus', handleFocus);
  textareaRef.value?.addEventListener('blur', handleBlur);
});
</script>

<style scoped>
.resizable-textarea-wrapper {
  position: relative;
  display: flex;
  flex-direction: column;
}

.resizable-textarea-wrapper textarea {
  resize: vertical;
  /* Add padding at bottom for the resize handle */
  padding-bottom: 28px;
  /* Ensure textarea fills the wrapper */
  width: 100%;
  box-sizing: border-box;
}

.resize-handle {
  position: absolute;
  bottom: 4px;
  right: 4px;
  z-index: 1;
  width: 28px;
  height: 28px;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text, #c9d1d9);
  opacity: 0.85;
  transition:
    background-color 0.15s,
    border-color 0.15s,
    opacity 0.15s;
  user-select: none;
  -webkit-user-select: none;
  border-radius: 4px;
  border: 1px solid var(--color-border, #30363d);
  background: var(--color-background-soft, #161b22);
  touch-action: none;
}

.resize-handle:hover,
.resize-handle:active {
  opacity: 1;
  border-color: var(--color-primary, #58a6ff);
  background: var(--color-background-mute, #21262d);
}
</style>
