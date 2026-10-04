import { onMounted, onUnmounted } from 'vue';
import { useWebSocket } from './useWebSocket.js';
import { createCatalogSync } from './catalogSync.js';

/**
 * Shared canonical-intake wiring for the model/tier editors (project
 * defaults, template detail, summary settings) — the third leg of the item-3
 * refactor alongside `createCatalogSync` and `useSelectionGuard`, so the
 * three editors stop maintaining subtly different fetch/push/reconnect
 * implementations.
 *
 * One monotonic coordinator owns every intake source:
 * - `refresh(options)` — initial load, reconnect, and manual refreshes.
 *   Resolves with the fetched canonical record; only the newest overlapping
 *   response applies.
 * - websocket pushes — `selectPush(message)` maps an incoming message to
 *   either `{ notify: canonical }` (the message carries canonical data, e.g.
 *   defaults/settings updates) or `{ options }` (the message only names a
 *   resource that must be refetched, e.g. template updates). Returns
 *   `undefined`/`null` to ignore the message.
 * - unmount disposes the coordinator and removes both listeners, so late
 *   responses and reconnects can never write into a dead component.
 *
 * @param {Object} args
 * @param {() => Promise<unknown>} args.fetchCanonical
 * @param {(canonical: unknown, options?: unknown) => void} args.applyCanonical
 * @param {string} args.messageType - Websocket message type to subscribe to.
 * @param {(message: unknown) => ({ notify?: unknown, options?: unknown } | undefined | null)} args.selectPush
 * @param {() => void} [args.onSettled] - Called after every refresh settles.
 * @returns {{ refresh: (options?: unknown) => Promise<unknown> }}
 */
export function useCanonicalSync({ fetchCanonical, applyCanonical, messageType, selectPush, onSettled }) {
  const { on, off, onReconnect } = useWebSocket();
  const sync = createCatalogSync({ fetchCanonical, applyCanonical });
  let removeReconnectListener;

  function handleMessage(message) {
    const action = selectPush(message);
    if (!action) return;
    if (action.notify !== undefined) sync.notifyCanonical(action.notify, action.options);
    else refresh(action.options);
  }

  async function refresh(options) {
    try {
      return await sync.refresh(options);
    } finally {
      onSettled?.();
    }
  }

  onMounted(() => {
    on(messageType, handleMessage);
    removeReconnectListener = onReconnect(() => refresh({ preserveEdits: true }));
  });

  onUnmounted(() => {
    off(messageType, handleMessage);
    sync.dispose();
    removeReconnectListener?.();
  });

  return { refresh };
}
