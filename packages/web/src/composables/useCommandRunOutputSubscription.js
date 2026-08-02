import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { useWebSocket } from './useWebSocket.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';

const subscriptions = new Map();
let listenersInstalled = false;

function installListeners() {
  if (listenersInstalled) return;
  listenersInstalled = true;
  const { on } = useWebSocket();

  on(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT, (message) => {
    const entry = subscriptions.get(message.runId);
    if (!entry || message.sequence <= entry.highWater) return;
    // A missed sequence means the socket was backpressured. Re-read the
    // persisted stream instead of attempting to repair it from live events.
    if (message.sequence !== entry.highWater + 1) {
      void entry.sync();
      return;
    }
    entry.store.appendOutput(message.runId, message.content);
    entry.highWater = message.sequence;
  });

  on(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT_SUBSCRIBED, (message) => {
    const entry = subscriptions.get(message.runId);
    if (entry) void entry.sync();
  });

  on(WS_MESSAGE_TYPES.COMMAND_RUN_OUTPUT_RESYNC_REQUIRED, (message) => {
    const entry = subscriptions.get(message.runId);
    if (entry) void entry.sync();
  });
}

/** Subscribe while a command output pane is visible. Multiple viewers share one socket subscription. */
export function subscribeCommandRunOutput(sessionId, runId) {
  if (!sessionId || !runId) return () => {};
  installListeners();
  const ws = useWebSocket();
  let entry = subscriptions.get(runId);
  if (entry) {
    entry.count += 1;
  } else {
    const store = useCommandButtonsStore();
    entry = {
      count: 1,
      store,
      highWater: store.runs[runId]?.outputHighWater || 0,
      syncing: null,
      sync() {
        if (!this.syncing) {
          this.syncing = store.syncRunOutput(sessionId, runId, this.highWater)
            .then((highWater) => { this.highWater = Math.max(this.highWater, highWater); })
            .finally(() => { this.syncing = null; });
        }
        return this.syncing;
      },
    };
    subscriptions.set(runId, entry);
    ws.send(WS_MESSAGE_TYPES.SUBSCRIBE_COMMAND_RUN_OUTPUT, { sessionId, runId });
    void entry.sync();
  }

  return () => {
    const current = subscriptions.get(runId);
    if (!current || --current.count > 0) return;
    subscriptions.delete(runId);
    ws.send(WS_MESSAGE_TYPES.UNSUBSCRIBE_COMMAND_RUN_OUTPUT, { runId });
  };
}
