# Fix: WebSocket Wake-from-Sleep Recovery

## Problem
When a mobile phone wakes from sleep, the WebSocket connection is dead but the app doesn't detect it. The user sees an empty conversation, an error toast ("Failed to subscribe to session updates"), and then data eventually loads via REST API fallback.

## Root Cause
1. No `visibilitychange` listener to detect wake-from-sleep
2. `ensureSubscribed()` can't handle zombie sockets (socket object exists but TCP is dead)
3. No re-subscription or data re-fetch after WebSocket reconnects

---

## Changes

### 1. Add `visibilitychange` listener (`useWebSocket.js`)

Add a document-level listener in the module scope that fires when the page becomes visible. If the socket is null, not OPEN, or is a zombie, force a clean reconnect:

```js
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // Kill zombie socket so connect() creates a fresh one
      if (socket) {
        socket.onclose = null; // prevent reconnect loop from old socket
        socket.close();
        socket = null;
      }
      connect();
    }
  }
});
```

### 2. Re-subscribe to tracked sessions on reconnect (`useWebSocket.js`)

In the existing `socket.onopen` handler, iterate `sessionSubscriptionCounts` and re-send subscribe messages for all active sessions. Also fire any registered reconnect callbacks:

```js
socket.onopen = () => {
  isConnected.value = true;
  reconnectDelay = WS_RECONNECT_BASE_DELAY;

  // Flush queued outbound messages
  while (outboundQueue.length > 0) {
    const msg = outboundQueue.shift();
    socket.send(msg);
  }

  // Re-subscribe to all tracked sessions
  for (const sessionId of sessionSubscriptionCounts.keys()) {
    socket.send(createMessage(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId }));
  }

  // Notify reconnect listeners
  for (const cb of reconnectCallbacks) {
    cb();
  }
};
```

### 3. Expose `onReconnect` / `offReconnect` hooks (`useWebSocket.js`)

Add a simple callback set and registration functions:

```js
const reconnectCallbacks = new Set();

function onReconnect(callback) {
  reconnectCallbacks.add(callback);
  return () => reconnectCallbacks.delete(callback);
}
```

Export `onReconnect` from `useWebSocket()`.

### 4. Re-fetch data on reconnect (`SessionDetailView.vue`)

In `initializeSession()`, register a reconnect handler that re-fetches all critical data via REST API:

```js
const { onReconnect } = useWebSocket();

cleanups.push(
  onReconnect(async () => {
    await sessionsStore.fetchSession(sessionId);
    await sessionsStore.fetchConversations(sessionId);
    await sessionsStore.fetchMessages(sessionId, false, sessionsStore.activeConversationId);
    await sessionsStore.fetchWorkLogs(sessionId);
    await canvasStore.fetchItems(sessionId);
    checkForChanges();
  })
);
```

### 5. Fix `ensureSubscribed()` zombie socket handling (`useWebSocket.js`)

When socket exists but isn't OPEN or CONNECTING, kill it and create a fresh connection:

```js
export async function ensureSubscribed(sessionId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Subscription timeout for session ${sessionId}`));
    }, 5000);

    const sendSubscription = () => {
      send(WS_MESSAGE_TYPES.SUBSCRIBE_SESSION, { sessionId });
      clearTimeout(timeout);
      resolve();
    };

    if (socket?.readyState === WebSocket.OPEN) {
      sendSubscription();
      return;
    }

    // Kill zombie sockets - not OPEN and not actively CONNECTING
    if (socket && socket.readyState !== WebSocket.CONNECTING) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }

    if (!socket) {
      connect();
    }

    const originalOnOpen = socket.onopen;
    socket.onopen = (...args) => {
      originalOnOpen?.(...args);
      sendSubscription();
    };
  });
}
```

---

## Files Modified
- `packages/web/src/composables/useWebSocket.js` — changes 1, 2, 3, 5
- `packages/web/src/views/SessionDetailView.vue` — change 4

## Testing
- Unit tests for `useWebSocket.js` if they exist
- Manual test: open session detail on phone, lock phone for 30+ seconds, unlock, verify conversation loads without error toast
- Verify WebSocket reconnects cleanly on desktop by toggling network off/on in dev tools
