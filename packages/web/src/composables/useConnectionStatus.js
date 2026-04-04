import { ref, watch, onUnmounted } from 'vue';
import { useWebSocket } from './useWebSocket.js';
import { WS_DISCONNECT_DISPLAY_DELAY } from '@claudetools/shared';

/**
 * Shared composable that debounces WebSocket connection status changes.
 * Exposes an `isStale` ref that becomes true after WS_DISCONNECT_DISPLAY_DELAY ms
 * of continuous disconnection, avoiding flicker on brief network blips.
 *
 * @returns {{ isStale: import('vue').Ref<boolean>, connectionStatus: import('vue').Ref<string>, reconnectAttempt: import('vue').Ref<number> }}
 */
export function useConnectionStatus() {
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

  onUnmounted(() => {
    clearTimeout(debounceTimer);
  });

  return { isStale, connectionStatus, reconnectAttempt };
}
