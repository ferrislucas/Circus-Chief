import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { ansiToHtml, stripAnsi } from '../utils/ansi.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useUiStore } from '../stores/ui.js';

const DISPLAY_LINE_LIMIT = 200;

function debounceLeading(fn, delay) {
  let timeoutId = null;
  let lastCalled = 0;
  return (...args) => {
    const now = Date.now();
    if (timeoutId) clearTimeout(timeoutId);
    if (now - lastCalled >= delay) {
      lastCalled = now;
      fn(...args);
    } else {
      timeoutId = setTimeout(() => {
        lastCalled = Date.now();
        fn(...args);
      }, delay);
    }
  };
}

export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error('Clipboard API failed:', err);
    }
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  } catch (fallbackErr) {
    console.error('Fallback copy failed:', fallbackErr);
    return false;
  }
}

export function useCommandOutputFormatting(props) {
  const commandButtonsStore = useCommandButtonsStore();
  const formattedOutput = ref('');
  const outputIsTruncatedForDisplay = ref(false);
  const outputContainerRef = ref(null);

  const showOutput = computed({
    get() {
      if (!props.run?.runId) {
        return false;
      }
      return !commandButtonsStore.isOutputCollapsed(props.run.runId);
    },
    set(value) {
      if (props.run?.runId) {
        commandButtonsStore.setOutputCollapsed(props.run.runId, !value);
      }
    }
  });

  const updateFormattedOutput = debounceLeading((output) => {
    const lines = output.split('\n');
    if (lines.length > DISPLAY_LINE_LIMIT) {
      outputIsTruncatedForDisplay.value = true;
      const displayOutput = lines.slice(-DISPLAY_LINE_LIMIT).join('\n');
      formattedOutput.value = ansiToHtml(displayOutput);
    } else {
      outputIsTruncatedForDisplay.value = false;
      formattedOutput.value = ansiToHtml(output);
    }
  }, 250);

  watch(
    () => [props.run?.output, showOutput.value],
    ([newOutput, isVisible]) => {
      if (isVisible && !newOutput && props.run?.runId && props.run?.status !== 'running') {
        commandButtonsStore.fetchRunOutput(props.sessionId, props.run.runId);
        return;
      }
      if (!newOutput) {
        formattedOutput.value = '';
        outputIsTruncatedForDisplay.value = false;
        return;
      }
      if (isVisible) {
        updateFormattedOutput(newOutput);
      }
    },
    { immediate: true }
  );

  return { showOutput, formattedOutput, outputIsTruncatedForDisplay, outputContainerRef };
}

export function useCommandOutputScroll(props, showOutput, outputContainerRef) {
  const isNearBottom = () => {
    const el = outputContainerRef.value;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  };

  const scrollToBottom = () => {
    nextTick(() => {
      requestAnimationFrame(() => {
        const el = outputContainerRef.value;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    });
  };

  watch(
    () => props.run?.output,
    () => {
      nextTick(() => {
        if (showOutput.value && isNearBottom()) {
          scrollToBottom();
        }
      });
    },
    { immediate: false }
  );

  watch(
    () => props.run?.runId,
    () => {
      if (showOutput.value) {
        scrollToBottom();
      }
    },
    { immediate: false }
  );
}

export function useCommandTimer(props) {
  const elapsedTime = ref('0:00');
  let timerInterval = null;

  const updateElapsedTime = () => {
    if (!props.run || props.run.status !== 'running') {
      return;
    }
    const elapsed = Date.now() - props.run.startedAt;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    elapsedTime.value = `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const startTimer = () => {
    if (!props.run || props.run.status !== 'running') {
      return;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
    }
    updateElapsedTime();
    timerInterval = setInterval(() => {
      updateElapsedTime();
    }, 1000);
  };

  const stopTimer = () => {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    elapsedTime.value = '0:00';
  };

  watch(
    () => props.run?.status,
    (newStatus) => {
      if (newStatus === 'running') {
        startTimer();
      } else {
        stopTimer();
      }
    },
    { immediate: false }
  );

  onMounted(() => {
    if (props.run?.status === 'running') {
      startTimer();
    }
  });

  onBeforeUnmount(() => {
    stopTimer();
  });

  return { elapsedTime };
}

export function useCommandActions(props, emit) {
  const commandButtonsStore = useCommandButtonsStore();
  const uiStore = useUiStore();
  const isSubmitting = ref(false);

  const handleRun = async () => {
    if (isSubmitting.value) return;
    isSubmitting.value = true;
    try {
      emit('run');
    } finally {
      setTimeout(() => {
        isSubmitting.value = false;
      }, 100);
    }
  };

  const handleKill = () => {
    emit('kill');
  };

  const handleCopyOutput = async () => {
    if (!props.run?.output && props.run?.runId) {
      await commandButtonsStore.fetchRunOutput(props.sessionId, props.run.runId);
    }
    const runData = commandButtonsStore.runs[props.run?.runId];
    const output = runData?.output;
    if (!output) return;
    const copySucceeded = await copyTextToClipboard(stripAnsi(output));
    if (copySucceeded) {
      uiStore.success('Output copied to clipboard');
    }
  };

  const handleSendToCanvas = async () => {
    if (!props.run?.output && props.run?.runId) {
      await commandButtonsStore.fetchRunOutput(props.sessionId, props.run.runId);
    }
    const runData = commandButtonsStore.runs[props.run?.runId];
    const output = runData?.output;
    if (!output) return;
    emit('send-to-canvas', props.button.label, output);
  };

  const handleCopyCommand = async () => {
    if (!props.button?.command) return;
    const copySucceeded = await copyTextToClipboard(props.button.command);
    if (copySucceeded) {
      uiStore.success('Command copied to clipboard');
    }
  };

  const handleMenuAction = async (action) => {
    switch (action) {
      case 'copy-output':
        await handleCopyOutput();
        break;
      case 'send-to-canvas':
        await handleSendToCanvas();
        break;
      case 'copy-command':
        await handleCopyCommand();
        break;
    }
  };

  return {
    isSubmitting,
    handleRun,
    handleKill,
    handleMenuAction,
    handleCopyOutput,
    handleSendToCanvas,
    handleCopyCommand,
  };
}
