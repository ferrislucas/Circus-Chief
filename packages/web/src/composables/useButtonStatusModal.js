import { computed, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { ansiToHtml } from '../utils/ansi.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';

const DISPLAY_LINE_LIMIT = 200;

function debounce(fn, delay) {
  let timeoutId;
  return (...args) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function formatTime(timestamp) {
  if (!timestamp) return 'N/A';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

export function getStatusDisplay(latestRun) {
  if (!latestRun) {
    return { text: 'Never Run', color: 'pending' };
  }
  switch (latestRun.status) {
    case 'running':
      return { text: 'Running', color: 'running' };
    case 'success':
      return { text: 'Success', color: 'success' };
    case 'error':
      return { text: 'Error', color: 'error' };
    default:
      return { text: 'Unknown', color: 'pending' };
  }
}

export function computeDuration(latestRun) {
  if (!latestRun?.completedAt || !latestRun?.startedAt) {
    return null;
  }
  const durationMs = latestRun.completedAt - latestRun.startedAt;
  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

export function useOutputFormatting(props) {
  const showOutput = ref(false);
  const formattedOutput = ref('');
  const outputIsTruncatedForDisplay = ref(false);
  const outputContainerRef = ref(null);

  const updateFormattedOutput = () => {
    const output = props.latestRun?.output || '';
    if (!output) {
      formattedOutput.value = '';
      outputIsTruncatedForDisplay.value = false;
      return;
    }
    const lines = output.split('\n');
    if (lines.length > DISPLAY_LINE_LIMIT) {
      outputIsTruncatedForDisplay.value = true;
      const displayOutput = lines.slice(-DISPLAY_LINE_LIMIT).join('\n');
      formattedOutput.value = ansiToHtml(displayOutput);
    } else {
      outputIsTruncatedForDisplay.value = false;
      formattedOutput.value = ansiToHtml(output);
    }
  };

  const debouncedUpdateOutput = debounce(updateFormattedOutput, 250);

  let isFirstOutputUpdate = true;
  watch(
    () => props.latestRun?.output,
    () => {
      if (isFirstOutputUpdate) {
        isFirstOutputUpdate = false;
        updateFormattedOutput();
      } else {
        debouncedUpdateOutput();
      }
    },
    { immediate: true }
  );

  return { showOutput, formattedOutput, outputIsTruncatedForDisplay, outputContainerRef };
}

export function useElapsedTimer(props) {
  const elapsedTime = ref('0:00');
  let timerInterval = null;

  const updateElapsedTime = () => {
    if (!props.latestRun || props.latestRun.status !== 'running') {
      return;
    }
    const elapsed = Date.now() - props.latestRun.startedAt;
    const seconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    elapsedTime.value = `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const startTimer = () => {
    if (!props.latestRun || props.latestRun.status !== 'running') {
      return;
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
  };

  return { elapsedTime, startTimer, stopTimer };
}

export function useButtonStatusModal(props, emit) {
  const commandButtonsStore = useCommandButtonsStore();

  const showConfirmation = ref(false);
  const deleting = ref(false);

  const { showOutput, formattedOutput, outputIsTruncatedForDisplay, outputContainerRef } =
    useOutputFormatting(props);

  const { elapsedTime, startTimer, stopTimer } = useElapsedTimer(props);

  const canRemoveRun = computed(() => {
    return props.latestRun && props.latestRun.status !== 'running';
  });

  const statusDisplay = computed(() => getStatusDisplay(props.latestRun));
  const duration = computed(() => computeDuration(props.latestRun));

  const close = () => {
    emit('close');
  };

  const handleRemoveRun = async () => {
    deleting.value = true;
    try {
      await commandButtonsStore.deleteRun(props.sessionId, props.latestRun.runId);
      emit('close');
    } catch (err) {
      console.error('Failed to remove run:', err);
    } finally {
      deleting.value = false;
      showConfirmation.value = false;
    }
  };

  watch(
    () => props.isOpen,
    (newValue) => {
      if (newValue) {
        startTimer();
      } else {
        stopTimer();
      }
    }
  );

  watch(
    () => props.latestRun?.status,
    (newStatus) => {
      if (newStatus === 'running' && props.isOpen) {
        startTimer();
      } else {
        stopTimer();
      }
    }
  );

  onMounted(() => {
    if (props.isOpen && props.latestRun?.status === 'running') {
      startTimer();
    }
  });

  onBeforeUnmount(() => {
    stopTimer();
  });

  return {
    elapsedTime,
    showConfirmation,
    deleting,
    showOutput,
    formattedOutput,
    outputIsTruncatedForDisplay,
    outputContainerRef,
    canRemoveRun,
    statusDisplay,
    duration,
    formatTime,
    close,
    handleRemoveRun,
  };
}
