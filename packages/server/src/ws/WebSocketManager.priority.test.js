import { describe, it, expect, afterEach, vi } from 'vitest';
import { WebSocketManager } from './WebSocketManager.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';

// Socket-free coverage for the provider-priority invalidation path: the
// manager sends priority invalidations to every connected client, so a fake
// client in the client set observes the decision without binding a port.
describe('WebSocketManager provider priority invalidation', () => {
  let manager;
  let client;

  function connectFakeClient() {
    manager = new WebSocketManager();
    client = { readyState: 1, send: vi.fn() };
    manager.getClients().add(client);
  }

  afterEach(() => {
    manager?.close();
    vi.restoreAllMocks();
  });

  function priorityInvalidations() {
    return client.send.mock.calls.filter(([message]) => {
      try {
        return JSON.parse(message).type === WS_MESSAGE_TYPES.PROVIDER_ALLOWANCE_PRIORITY_INVALIDATED;
      } catch {
        return false;
      }
    });
  }

  function emitSessionUpdated(payload) {
    manager.broadcastToSessionAndProject('sess-1', 'proj-1', WS_MESSAGE_TYPES.SESSION_UPDATED, payload);
  }

  it.each([
    ['missing payload', undefined],
    ['empty payload', {}],
    ['session id without a session object', { sessionId: 'sess-1' }],
    ['null session', { session: null }],
    ['non-object session', { session: 'sess-1' }],
    ['session without an id', { session: { status: 'running', providerId: 'p1' } }],
  ])('malformed SESSION_UPDATED (%s) causes zero allowance refetches and logs a diagnostic', (_caseName, payload) => {
    connectFakeClient();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    emitSessionUpdated(payload);

    expect(priorityInvalidations()).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0].join(' ')).toContain('priority-invalidation-skipped');
  });

  it('still invalidates once for a usable session shape, then only on priority changes', () => {
    connectFakeClient();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const running = { session: { id: 'sess-1', status: 'running', providerId: 'p1' } };

    emitSessionUpdated(running);
    expect(priorityInvalidations()).toHaveLength(1);

    // Identical shape: memoized, no refetch.
    emitSessionUpdated(running);
    expect(priorityInvalidations()).toHaveLength(1);

    // Active-to-inactive transition changes priority: refetch.
    emitSessionUpdated({ session: { id: 'sess-1', status: 'stopped', providerId: 'p1' } });
    expect(priorityInvalidations()).toHaveLength(2);

    // Provider change refetches even while staying active.
    emitSessionUpdated({ session: { id: 'sess-1', status: 'running', providerId: 'p2' } });
    expect(priorityInvalidations()).toHaveLength(3);
    expect(warn).not.toHaveBeenCalled();
  });

  it('still invalidates on session creation and deletion membership changes', () => {
    connectFakeClient();

    manager.broadcastToSessionAndProject('sess-9', 'proj-1', WS_MESSAGE_TYPES.SESSION_CREATED, {
      session: { id: 'sess-9', status: 'running', providerId: 'p1' },
    });
    manager.broadcastToSessionAndProject('sess-9', 'proj-1', WS_MESSAGE_TYPES.SESSION_DELETED, {
      sessionId: 'sess-9',
    });

    expect(priorityInvalidations()).toHaveLength(2);
  });
});
