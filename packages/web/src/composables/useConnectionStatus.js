import { ref, watch } from 'vue';
import { useWebSocket } from './useWebSocket.js';

/**
 * Delay (ms) before showing disconnection UI.
 * Avoids flicker on brief network blips.
 * Frontend-only concern — not exported from the shared package.
 */
export const WS_DISCONNECT_DISPLAY_DELAY = 2000;

// ---- Singleton state ----
// A single debounce timer and `isStale` ref shared by every consumer.
// This prevents staggered UI transitions when multiple components call
// useConnectionStatus() independently.
const { connectionStatus, reconnectAttempt } = useWebSocket();
const isStale = ref(false);
let debounceTimer = null;

watch(connectionStatus, (status) => {
  if (status === 'connected') {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    isStale.value = false;
  } else if (!debounceTimer) {
    debounceTimer = setTimeout(() => {
      isStale.value = true;
    }, WS_DISCONNECT_DISPLAY_DELAY);
  }
}, { immediate: true });

/**
 * Shared composable that debounces WebSocket connection status changes.
 * Exposes an `isStale` ref that becomes true after WS_DISCONNECT_DISPLAY_DELAY ms
 * of continuous disconnection, avoiding flicker on brief network blips.
 *
 * All callers share the same singleton refs and a single debounce timer,
 * so every component transitions at exactly the same moment.
 *
 * @returns {{ isStale: import('vue').Ref<boolean>, connectionStatus: import('vue').Ref<string>, reconnectAttempt: import('vue').Ref<number> }}
 */
export function useConnectionStatus() {
  return { isStale, connectionStatus, reconnectAttempt };
}
