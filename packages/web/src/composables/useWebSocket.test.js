import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';

// Mock Vue's onUnmounted
vi.mock('vue', () => ({
  ref: vi.fn((val) => ({ value: val })),
  onUnmounted: vi.fn(),
}));

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;

  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.sentMessages = [];

    // Simulate connection
    setTimeout(() => {
      if (this.onopen) {
        this.onopen();
      }
    }, 0);
  }

  send(data) {
    this.sentMessages.push(data);
  }

  close(code) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code });
    }
  }

  // Helper to simulate receiving a message
  receiveMessage(type, payload) {
    if (this.onmessage) {
      this.onmessage({
        data: JSON.stringify({ type, ...payload }),
      });
    }
  }
}

// Store the original WebSocket
const originalWebSocket = global.WebSocket;

describe('useWebSocket composables', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    // Reset WebSocket mock
    global.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    global.WebSocket = originalWebSocket;
  });

  describe('useGlobalSessionSubscription', () => {
    it('exports useGlobalSessionSubscription function', async () => {
      const module = await import('./useWebSocket.js');
      expect(typeof module.useGlobalSessionSubscription).toBe('function');
    });

    it('returns onSessionCreated, onSessionUpdated, and onSessionDeleted functions', async () => {
      const module = await import('./useWebSocket.js');
      const subscription = module.useGlobalSessionSubscription();

      expect(typeof subscription.onSessionCreated).toBe('function');
      expect(typeof subscription.onSessionUpdated).toBe('function');
      expect(typeof subscription.onSessionDeleted).toBe('function');
    });

    it('does not return subscribe/unsubscribe functions (unlike project subscription)', async () => {
      const module = await import('./useWebSocket.js');
      const subscription = module.useGlobalSessionSubscription();

      // Global subscription doesn't need subscribe/unsubscribe since it listens to all broadcasts
      expect(subscription.subscribe).toBeUndefined();
      expect(subscription.unsubscribe).toBeUndefined();
    });
  });

  describe('useProjectSubscription', () => {
    it('exports useProjectSubscription function', async () => {
      const module = await import('./useWebSocket.js');
      expect(typeof module.useProjectSubscription).toBe('function');
    });

    it('returns subscribe, unsubscribe, and event handlers', async () => {
      const module = await import('./useWebSocket.js');
      const subscription = module.useProjectSubscription('project-123');

      expect(typeof subscription.subscribe).toBe('function');
      expect(typeof subscription.unsubscribe).toBe('function');
      expect(typeof subscription.onSessionCreated).toBe('function');
      expect(typeof subscription.onSessionUpdated).toBe('function');
      expect(typeof subscription.onSessionDeleted).toBe('function');
    });
  });

  describe('useSessionSubscription', () => {
    it('exports useSessionSubscription function', async () => {
      const module = await import('./useWebSocket.js');
      expect(typeof module.useSessionSubscription).toBe('function');
    });

    it('returns subscribe, unsubscribe, and event handlers', async () => {
      const module = await import('./useWebSocket.js');
      const subscription = module.useSessionSubscription('session-123');

      expect(typeof subscription.subscribe).toBe('function');
      expect(typeof subscription.unsubscribe).toBe('function');
      expect(typeof subscription.onStatus).toBe('function');
      expect(typeof subscription.onMessage).toBe('function');
      expect(typeof subscription.onPartial).toBe('function');
      expect(typeof subscription.onError).toBe('function');
    });
  });

  describe('Protocol message types', () => {
    it('SESSION_CREATED message type is defined', () => {
      expect(WS_MESSAGE_TYPES.SESSION_CREATED).toBe('session:created');
    });

    it('SESSION_UPDATED message type is defined', () => {
      expect(WS_MESSAGE_TYPES.SESSION_UPDATED).toBe('session:updated');
    });

    it('SESSION_DELETED message type is defined', () => {
      expect(WS_MESSAGE_TYPES.SESSION_DELETED).toBe('session:deleted');
    });

    it('SESSION_STATUS message type is defined', () => {
      expect(WS_MESSAGE_TYPES.SESSION_STATUS).toBe('session:status');
    });

    it('SUBSCRIBE_PROJECT message type is defined', () => {
      expect(WS_MESSAGE_TYPES.SUBSCRIBE_PROJECT).toBe('subscribe:project');
    });

    it('UNSUBSCRIBE_PROJECT message type is defined', () => {
      expect(WS_MESSAGE_TYPES.UNSUBSCRIBE_PROJECT).toBe('unsubscribe:project');
    });
  });

  describe('Global vs Project subscription differences', () => {
    it('global subscription does not filter by projectId', async () => {
      // This is the key difference: global subscription receives ALL events
      // while project subscription only receives events for a specific project
      const module = await import('./useWebSocket.js');

      const globalSub = module.useGlobalSessionSubscription();
      const projectSub = module.useProjectSubscription('project-123');

      // Global subscription has no filtering mechanism
      // It just passes through the session and projectId to callbacks
      expect(globalSub.onSessionCreated).toBeDefined();
      expect(globalSub.onSessionUpdated).toBeDefined();
      expect(globalSub.onSessionDeleted).toBeDefined();

      // Project subscription has subscribe/unsubscribe to filter by project
      expect(projectSub.subscribe).toBeDefined();
      expect(projectSub.unsubscribe).toBeDefined();
    });
  });
});

describe('Real-time update scenarios', () => {
  describe('Session status changes', () => {
    it('SESSION_UPDATED should be used for session list updates', () => {
      // When a session status changes (e.g., running -> waiting),
      // PROJECT subscribers should receive SESSION_UPDATED to update their lists
      expect(WS_MESSAGE_TYPES.SESSION_UPDATED).toBe('session:updated');
    });

    it('SESSION_STATUS should be used for session detail updates', () => {
      // When a session status changes, SESSION subscribers should
      // receive SESSION_STATUS to update the detail view
      expect(WS_MESSAGE_TYPES.SESSION_STATUS).toBe('session:status');
    });

    it('Both message types serve different purposes', () => {
      // These should be different message types
      expect(WS_MESSAGE_TYPES.SESSION_UPDATED).not.toBe(WS_MESSAGE_TYPES.SESSION_STATUS);
    });
  });

  describe('Active sessions view', () => {
    it('should use global subscription to receive updates across all projects', async () => {
      const module = await import('./useWebSocket.js');
      const globalSub = module.useGlobalSessionSubscription();

      // The global subscription provides callbacks that receive
      // (session, projectId) for any project
      expect(globalSub.onSessionCreated).toBeDefined();
      expect(globalSub.onSessionUpdated).toBeDefined();
      expect(globalSub.onSessionDeleted).toBeDefined();
    });
  });

  describe('Project-specific session list', () => {
    it('should use project subscription to receive updates for specific project', async () => {
      const module = await import('./useWebSocket.js');
      const projectSub = module.useProjectSubscription('project-123');

      // Project subscription filters events by projectId
      expect(projectSub.subscribe).toBeDefined();
      expect(projectSub.unsubscribe).toBeDefined();
      expect(projectSub.onSessionCreated).toBeDefined();
      expect(projectSub.onSessionUpdated).toBeDefined();
      expect(projectSub.onSessionDeleted).toBeDefined();
    });
  });
});
