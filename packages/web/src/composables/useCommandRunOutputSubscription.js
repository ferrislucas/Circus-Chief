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
    if (!entry) return;
    if (entry.initializing) {
      entry.pending.set(message.sequence, message);
      return;
    }
    entry.applyChunk(message);
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
      initializing: true,
      pending: new Map(),
      syncing: null,
      resyncQueued: false,
      applyChunk(chunk) {
        // The store cursor records what is already rendered. A snapshot fetch
        // (expanding a collapsed pane) reads the same persisted stream from the
        // start and can land mid-catch-up, so adopt its progress before
        // deciding whether this chunk still needs to be appended.
        this.adoptRenderedCursor();
        if (chunk.sequence <= this.highWater) return true;
        // A missed sequence means the socket was backpressured. Re-read the
        // persisted stream instead of attempting to repair it from live events.
        if (chunk.sequence !== this.highWater + 1) {
          void this.sync();
          return false;
        }
        // Ordering and de-duplication are owned here (by sequence), so the run
        // completing mid-catch-up must not discard the remaining output.
        this.store.appendOutput(runId, chunk.content, { allowAfterCompletion: true });
        this.highWater = chunk.sequence;
        // Publish the cursor so a snapshot fetch, or a subscription created
        // later for the same run, resumes here instead of replaying output.
        this.store.advanceOutputHighWater?.(runId, chunk.sequence);
        return true;
      },
      /** Raise the in-memory cursor to the output already rendered by the store. */
      adoptRenderedCursor() {
        const rendered = this.store.runs[runId]?.outputHighWater || 0;
        if (rendered > this.highWater) this.highWater = rendered;
      },
      drainPending() {
        for (const chunk of [...this.pending.values()].sort((a, b) => a.sequence - b.sequence)) {
          this.pending.delete(chunk.sequence);
          if (!this.applyChunk(chunk)) break;
        }
      },
      sync() {
        // Lightweight component-store mocks and legacy embedding contexts may
        // not expose streaming yet; live output remains safely inactive there.
        if (typeof store.syncRunOutput !== 'function') {
          this.initializing = false;
          return Promise.resolve();
        }
        if (this.syncing) {
          // Chunks rejected while a read is already in flight may have been
          // persisted after that read started, so a follow-up pass is required
          // once it settles - otherwise their content is lost for good.
          this.resyncQueued = true;
          return this.syncing;
        }
        this.resyncQueued = false;
        this.adoptRenderedCursor();
        this.syncing = store.syncRunOutput(sessionId, runId, this.highWater, (chunk) => this.applyChunk(chunk))
          .then(({ hasMore }) => {
            this.initializing = false;
            this.drainPending();
            // Yield to the event loop between capped catch-up batches. This
            // preserves single-flight sync while a producer is still ahead.
            if (hasMore || this.resyncQueued) setTimeout(() => void this.sync(), 0);
          })
          .finally(() => { this.syncing = null; });
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
