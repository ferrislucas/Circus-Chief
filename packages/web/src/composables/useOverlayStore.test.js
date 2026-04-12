import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { defineComponent, provide, h } from 'vue';

// Mock the API module (required by stores)
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSession: vi.fn(),
    getSessionMessages: vi.fn(),
    getConversationMessages: vi.fn(),
    getSessionWorkLogs: vi.fn(),
    stopSession: vi.fn(),
    restartSession: vi.fn(),
    startSession: vi.fn(),
    sendMessage: vi.fn(),
    updateSession: vi.fn(),
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    branchConversation: vi.fn(),
    getSessionTodos: vi.fn(),
    getActiveSessions: vi.fn(),
    getProjectSessions: vi.fn(),
    getScheduledSessions: vi.fn(),
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    archiveSession: vi.fn(),
    unarchiveSession: vi.fn(),
    toggleSessionStar: vi.fn(),
    duplicateSession: vi.fn(),
  },
}));

import {
  useInjectedSessionsStore,
  useInjectedTodosStore,
  useOverlayTeleportDisabled,
  SESSIONS_STORE_KEY,
  TODOS_STORE_KEY,
  TELEPORT_TARGET_KEY,
} from './useOverlayStore.js';
import { useSessionsStore } from '../stores/sessions.js';
import { useTodosStore } from '../stores/todos.js';

/**
 * Helper to call a composable inside a component setup context.
 * Optionally provides values via Vue's provide/inject.
 */
function withSetup(composable, provideMap = {}) {
  let result;
  const pinia = createPinia();
  setActivePinia(pinia);

  const Wrapper = defineComponent({
    setup() {
      Object.entries(provideMap).forEach(([key, val]) => {
        // provideMap keys are the actual Symbol keys
        provide(key, val);
      });
      result = composable();
      return () => h('div');
    },
  });
  mount(Wrapper, { global: { plugins: [pinia] } });
  return result;
}

/**
 * Helper that wraps composable in a child component with a parent provider.
 */
function withProviderAndChild(composable, provideKey, provideValue) {
  let result;
  const pinia = createPinia();
  setActivePinia(pinia);

  const Child = defineComponent({
    setup() {
      result = composable();
      return () => h('div');
    },
  });

  const Parent = defineComponent({
    setup() {
      provide(provideKey, provideValue);
      return () => h(Child);
    },
  });

  mount(Parent, { global: { plugins: [pinia] } });
  return result;
}

describe('useOverlayStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Symbol keys', () => {
    it('SESSIONS_STORE_KEY, TODOS_STORE_KEY, and TELEPORT_TARGET_KEY are unique symbols', () => {
      expect(typeof SESSIONS_STORE_KEY).toBe('symbol');
      expect(typeof TODOS_STORE_KEY).toBe('symbol');
      expect(typeof TELEPORT_TARGET_KEY).toBe('symbol');
      expect(SESSIONS_STORE_KEY).not.toBe(TODOS_STORE_KEY);
      expect(SESSIONS_STORE_KEY).not.toBe(TELEPORT_TARGET_KEY);
      expect(TODOS_STORE_KEY).not.toBe(TELEPORT_TARGET_KEY);
    });
  });

  describe('useInjectedSessionsStore', () => {
    it('returns global singleton when no provider exists', () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const injectedStore = withSetup(useInjectedSessionsStore);
      const globalStore = useSessionsStore();

      expect(injectedStore.$id).toBe(globalStore.$id);
    });

    it('returns provided instance when provider exists', () => {
      const mockStore = { $id: 'mock-sessions', isMock: true };

      const injectedStore = withProviderAndChild(
        useInjectedSessionsStore,
        SESSIONS_STORE_KEY,
        mockStore,
      );

      expect(injectedStore).toBe(mockStore);
      expect(injectedStore.isMock).toBe(true);
    });
  });

  describe('useInjectedTodosStore', () => {
    it('returns global singleton when no provider exists', () => {
      const pinia = createPinia();
      setActivePinia(pinia);

      const injectedStore = withSetup(useInjectedTodosStore);
      const globalStore = useTodosStore();

      expect(injectedStore.$id).toBe(globalStore.$id);
    });

    it('returns provided instance when provider exists', () => {
      const mockStore = { $id: 'mock-todos', isMock: true };

      const injectedStore = withProviderAndChild(
        useInjectedTodosStore,
        TODOS_STORE_KEY,
        mockStore,
      );

      expect(injectedStore).toBe(mockStore);
      expect(injectedStore.isMock).toBe(true);
    });
  });

  describe('useOverlayTeleportDisabled', () => {
    it('returns false when no provider exists (outside overlay)', () => {
      const result = withSetup(useOverlayTeleportDisabled);

      expect(result).toBe(false);
    });

    it('returns true when TELEPORT_TARGET_KEY provider is true (inside overlay)', () => {
      const result = withProviderAndChild(
        useOverlayTeleportDisabled,
        TELEPORT_TARGET_KEY,
        true,
      );

      expect(result).toBe(true);
    });

    it('returns the provided value when TELEPORT_TARGET_KEY is explicitly false', () => {
      const result = withProviderAndChild(
        useOverlayTeleportDisabled,
        TELEPORT_TARGET_KEY,
        false,
      );

      expect(result).toBe(false);
    });
  });
});
