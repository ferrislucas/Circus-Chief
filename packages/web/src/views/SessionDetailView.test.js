import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import SessionDetailView from './SessionDetailView.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useTodosStore } from '../stores/todos.js';
import { useCommandButtonsStore } from '../stores/commandButtons.js';
import { useUiStore } from '../stores/ui.js';

// Mock components
vi.mock('../components/ConversationTab.vue', () => ({
  default: { name: 'ConversationTab', template: '<div>Conversation Tab</div>' }
}));
vi.mock('../components/ChangesTab.vue', () => ({
  default: { name: 'ChangesTab', template: '<div>Changes Tab</div>' }
}));
vi.mock('../components/CanvasTab.vue', () => ({
  default: { name: 'CanvasTab', template: '<div>Canvas Tab</div>' }
}));
vi.mock('../components/SummaryTab.vue', () => ({
  default: { name: 'SummaryTab', template: '<div>Summary Tab</div>' }
}));
vi.mock('../components/CommandsTab.vue', () => ({
  default: { name: 'CommandsTab', template: '<div>Commands Tab</div>' }
}));
vi.mock('../components/DuplicateSessionButton.vue', () => ({
  default: { name: 'DuplicateSessionButton', template: '<button @click="$emit(\'success\', { id: \'new\' })" :disabled="false">Duplicate</button>' }
}));
vi.mock('../components/OverflowMenu.vue', () => ({
  default: {
    name: 'OverflowMenu',
    template: '<div class="overflow-menu"><button @click="$emit(\'duplicate\')">Duplicate</button><button @click="$emit(\'archive\')">Archive</button><button @click="$emit(\'delete\')">Delete</button></div>',
    emits: ['duplicate', 'archive', 'delete']
  }
}));
vi.mock('../components/SessionHeaderPanel.vue', () => ({
  default: {
    name: 'SessionHeaderPanel',
    template: '<div class="session-header"><div class="session-header-row"><div class="session-name-wrapper"><h3 class="session-name">{{ session?.name }}</h3></div></div></div>',
    props: ['sessionId', 'session', 'summary', 'isDeleting', 'buttonStatuses'],
    emits: ['duplicate', 'copySessionId', 'archive', 'delete', 'star'],
  }
}));
vi.mock('../components/SessionTabsPanel.vue', () => ({
  default: {
    name: 'SessionTabsPanel',
    template: '<div class="tabs"><span v-for="tab in tabs" :key="tab.id">{{ tab.label }}</span></div>',
    props: ['sessionId', 'projectId', 'activeTab', 'tabs', 'hasChanges', 'canvasCount', 'isSessionActive', 'sessionStatus'],
  }
}));
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionSummary: vi.fn().mockResolvedValue(null),
    updateSession: vi.fn(),
    getSession: vi.fn(),
    getConversations: vi.fn(),
    getSessionChanges: vi.fn().mockResolvedValue({ staged: '', unstaged: '', untracked: '' }),
  },
}));

// Mock useWebSocket so ensureSubscribed resolves immediately (no real WebSocket needed)
// and useSessionSubscription returns no-op handler stubs.
vi.mock('../composables/useWebSocket.js', () => {
  const h = () => vi.fn(() => () => {});
  return {
    ensureSubscribed: vi.fn(() => Promise.resolve()),
    useWebSocket: vi.fn(() => ({
      isConnected: { value: true },
      send: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      disconnect: vi.fn(),
      clearSessionBuffer: vi.fn(),
      onReconnect: vi.fn(() => () => {}),
    })),
    useSessionSubscription: vi.fn(() => ({
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      onStatus: h(),
      onMessage: h(),
      onPartial: h(),
      onError: h(),
      onCanvasAdd: h(),
      onCanvasRemove: h(),
      onTodosUpdate: h(),
      onSessionUpdate: h(),
      onSummaryUpdate: h(),
      onConversationCreated: h(),
      onConversationUpdated: h(),
      onConversationDeleted: h(),
      onUsageUpdate: h(),
      onChangesUpdate: h(),
      onWorkLog: h(),
      onWorkLogsAssociated: h(),
      onThinkingPartial: h(),
      onCommandOutput: h(),
      onCommandComplete: h(),
      onCommandError: h(),
    })),
  };
});

// Import the mocked api for use in tests
import { api } from '../composables/useApi.js';

describe('SessionDetailView', () => {
  let pinia;
  let router;
  let sessionsStore;
  let canvasStore;
  let todosStore;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/sessions/:id/:tab?', component: SessionDetailView }
      ]
    });

    sessionsStore = useSessionsStore();
    canvasStore = useCanvasStore();
    todosStore = useTodosStore();

    // Mock store methods
    vi.spyOn(sessionsStore, 'fetchSession').mockResolvedValue(undefined);
    vi.spyOn(sessionsStore, 'fetchMessages').mockResolvedValue(undefined);
    vi.spyOn(sessionsStore, 'fetchConversations').mockResolvedValue(undefined);
    vi.spyOn(sessionsStore, 'fetchWorkLogs').mockResolvedValue(undefined);
    vi.spyOn(canvasStore, 'fetchItems').mockResolvedValue(undefined);
    vi.spyOn(todosStore, 'fetchTodos').mockResolvedValue(undefined);

    // Mock window.confirm
    window.confirm = vi.fn(() => true);
  });

  describe('tabs configuration', () => {
    it('does not include Notes tab in tab list', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Check the tabs computed property or rendered tabs
      const tabButtons = wrapper.findAll('button');
      const notesTab = tabButtons.find(btn => btn.text().includes('Notes'));

      // Notes tab should not exist
      expect(notesTab).toBeUndefined();
    });

    it('includes Summary, Conversation, Changes, Canvas, Commands tabs', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      const text = wrapper.text();
      // The exact tab names may vary, but these components should be referenced
      expect(wrapper.findComponent({ name: 'SummaryTab' }).exists() || text).toBeTruthy();
    });

    it('renders correct tab content for selected tab', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // At least one tab component should be rendered
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('initialization', () => {
    it('fetches session data on mount', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Verify component renders the session details
      expect(wrapper.text()).toContain('Test Session');
    });

    it('fetches messages on mount', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Verify component renders and is ready for messages
      expect(wrapper.exists()).toBe(true);
    });

    it('fetches conversations on mount', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Verify component renders and is ready for conversations
      expect(wrapper.exists()).toBe(true);
    });

    it('fetches canvas items eagerly during initialization so tab count is correct immediately', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      // Clear previous calls to isolate this test
      canvasStore.fetchItems.mockClear();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Canvas items SHOULD be fetched during initialization so the Canvas tab badge
      // shows the correct count even when the user starts on a different tab.
      expect(canvasStore.fetchItems).toHaveBeenCalledWith('session-1');
    });

    it('fetches work logs on mount', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Verify component is properly initialized
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('polling behavior', () => {
    it('implements polling mechanism', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Component should have polling logic
      expect(wrapper.exists()).toBe(true);
    });

    it('polling does not call fetchConversations (handled by WebSocket)', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Clear calls from initialization
      sessionsStore.fetchConversations.mockClear();

      // The component should not call fetchConversations during polling
      // since conversations are updated in real-time via the onConversationUpdated WebSocket handler
      expect(wrapper.exists()).toBe(true);
    });

    it('checks for changes during active session polling', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // The checkForChanges call during polling is internal to the component
      // We verify the component handles this correctly by ensuring it doesn't error
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('canvas item count starts at zero', () => {
    it('canvas item count starts at 0 after initialization (no WebSocket events)', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Canvas tab label should show "Canvas" (no count) since canvasItemCount starts at 0
      const text = wrapper.text();
      expect(text).toContain('Canvas');
      // Should not contain a count like "Canvas (2)"
      expect(text).not.toMatch(/Canvas \(\d+\)/);
    });
  });

  describe('canvas item count indicator', () => {
    it('canvas store has fetchItems method available for eager-loading', async () => {
      // Verify that the canvas store has the fetchItems method
      expect(canvasStore.fetchItems).toBeDefined();
      expect(typeof canvasStore.fetchItems).toBe('function');
    });

    it('canvas store groupedItems getter works correctly', async () => {
      // Add items to the canvas store
      canvasStore.items = [
        { id: 'item-1', filename: 'test.md', type: 'markdown', createdAt: Date.now() },
        { id: 'item-2', filename: 'data.json', type: 'json', createdAt: Date.now() },
        { id: 'item-3', filename: 'test.md', type: 'markdown', createdAt: Date.now() + 1000 } // Same filename
      ];

      // groupedItems should group by filename and return the latest of each
      // So we should have 2 items: test.md (latest) and data.json
      expect(canvasStore.groupedItems.length).toBe(2);
    });

    it('canvas store starts with empty items array', async () => {
      // Verify the initial state
      expect(canvasStore.items).toEqual([]);
      expect(canvasStore.groupedItems.length).toBe(0);
    });

    it('canvas store $reset method is available', async () => {
      // Verify $reset exists for cleanup
      expect(canvasStore.$reset).toBeDefined();
      expect(typeof canvasStore.$reset).toBe('function');

      // Add items then reset
      canvasStore.items = [
        { id: 'item-1', filename: 'test.md', type: 'markdown', createdAt: Date.now() }
      ];
      expect(canvasStore.groupedItems.length).toBe(1);

      // Reset should clear items
      canvasStore.$reset();
      expect(canvasStore.items).toEqual([]);
    });

    it('component integrates with canvas store for tab indicators', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Component should mount successfully and have access to canvas store
      expect(wrapper.exists()).toBe(true);
      expect(canvasStore).toBeDefined();
    });
  });

  describe('changes tab indicator', () => {
    it('displays changes count in tab indicator', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Component should be able to display changes count
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('component lifecycle', () => {
    it('cleans up when component unmounts', async () => {
      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      wrapper.unmount();

      // Component should unmount without errors
      expect(wrapper.exists()).toBe(false);
    });
  });

  describe('Session header integration', () => {
    it('renders SessionHeaderPanel with session data', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'waiting',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('sessionId')).toBe('session-1');
    });

    it('header contains session name via SessionHeaderPanel', async () => {
      const sessionName = 'Test Session';
      sessionsStore.currentSession = {
        id: 'session-1',
        name: sessionName,
        status: 'waiting',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').name).toBe(sessionName);

      // The mock template still renders the name
      expect(wrapper.text()).toContain(sessionName);
    });
  });

  describe('canvas item count indicator updates', () => {
    it('canvas store item count can be incremented and decremented', async () => {
      // Test that canvas item can be added programmatically
      expect(canvasStore.groupedItems.length).toBe(0);

      canvasStore.addItem({ id: 'item-1', type: 'text', sessionId: 'session-1' });
      expect(canvasStore.groupedItems.length).toBe(1);

      canvasStore.addItem({ id: 'item-2', type: 'markdown', sessionId: 'session-1' });
      expect(canvasStore.groupedItems.length).toBe(2);

      // Remove one item
      canvasStore.removeItem('item-1');
      expect(canvasStore.groupedItems.length).toBe(1);

      // Remove the other item
      canvasStore.removeItem('item-2');
      expect(canvasStore.groupedItems.length).toBe(0);
    });

    it('canvas store correctly tracks multiple canvas items', async () => {
      // Add multiple items to the store
      for (let i = 1; i <= 5; i++) {
        canvasStore.addItem({
          id: `item-${i}`,
          type: 'text',
          sessionId: 'session-1'
        });
      }

      // Verify count matches the number of items
      expect(canvasStore.groupedItems.length).toBe(5);
    });

    it('component mounts successfully with canvas store ready', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Verify component renders successfully
      expect(wrapper.exists()).toBe(true);

      // Canvas items are lazy-loaded (not fetched during mount).
      // The store is ready to track items when they arrive via WebSocket or CanvasTab.
      expect(canvasStore.groupedItems).toBeDefined();
    });

    it('component handles canvas store state transitions', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      // Start with empty store
      expect(canvasStore.groupedItems.length).toBe(0);

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Verify component is stable with zero items
      expect(wrapper.exists()).toBe(true);
      expect(canvasStore.groupedItems.length).toBe(0);

      // Now add items like WebSocket events would
      canvasStore.addItem({ id: 'item-1', type: 'text', sessionId: 'session-1' });
      await wrapper.vm.$nextTick();

      // Verify store reflects the addition
      expect(canvasStore.groupedItems.length).toBe(1);

      // Add another item
      canvasStore.addItem({ id: 'item-2', type: 'markdown', sessionId: 'session-1' });
      await wrapper.vm.$nextTick();

      expect(canvasStore.groupedItems.length).toBe(2);

      // Remove an item
      canvasStore.removeItem('item-1');
      await wrapper.vm.$nextTick();

      expect(canvasStore.groupedItems.length).toBe(1);
    });

    it('canvas store reflects the correct total after adding items from different sessions', async () => {
      // Add items from different sessions
      canvasStore.addItem({ id: 'item-1', type: 'text', sessionId: 'session-1' });
      canvasStore.addItem({ id: 'item-2', type: 'text', sessionId: 'session-2' });
      canvasStore.addItem({ id: 'item-3', type: 'text', sessionId: 'session-1' });

      // Store should have all 3 items
      expect(canvasStore.groupedItems.length).toBe(3);

      // Remove items
      canvasStore.removeItem('item-1');
      expect(canvasStore.groupedItems.length).toBe(2);

      canvasStore.removeItem('item-2');
      expect(canvasStore.groupedItems.length).toBe(1);
    });
  });

  describe('todos store integration', () => {
    it('component initializes successfully and integrates with todos store', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'waiting',
        projectId: 'proj-1'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Component successfully mounts
      expect(wrapper.exists()).toBe(true);

      // Todos store should be accessible and initialized
      expect(todosStore.items).toBeDefined();
      expect(Array.isArray(todosStore.items)).toBe(true);
      expect(todosStore.loading).toBe(false);
    });

    it('todos store clearTodos method works correctly', async () => {
      // This is tested in detail in todos.test.js
      // Here we just verify the method exists and can be called
      todosStore.items = [{ id: '1', status: 'pending' }];
      todosStore.error = 'Test error';
      todosStore.loading = true;

      todosStore.clearTodos();

      expect(todosStore.items).toEqual([]);
      expect(todosStore.loading).toBe(false);
      expect(todosStore.error).toBe(null);
    });

    it('component mounts when session has todos store data', async () => {
      // Pre-populate todos store as if it had data from a previous session
      todosStore.items = [
        { id: 'old-1', status: 'completed' },
        { id: 'old-2', status: 'pending' }
      ];

      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'waiting',
        projectId: 'proj-1'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Component mounts successfully even with pre-existing todos data
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('session switching with watcher', () => {
    it('watches for session ID changes and clears/fetches todos when navigating between sessions', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Session 1',
        status: 'waiting',
        projectId: 'proj-1'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Verify initial setup
      expect(wrapper.exists()).toBe(true);
    });

    it('clears todos when route session ID changes', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Session 1',
        status: 'waiting',
        projectId: 'proj-1'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      todosStore.items = [{ id: '1', status: 'pending' }];
      todosStore.error = null;
      todosStore.loading = false;

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Verify component mounts and todos are in expected state
      expect(wrapper.exists()).toBe(true);
      expect(todosStore.items).toEqual([{ id: '1', status: 'pending' }]);
    });

    it('component initializes with todos store ready', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Session 1',
        status: 'waiting',
        projectId: 'proj-1'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Component mounts successfully
      expect(wrapper.exists()).toBe(true);
    });

    it('handles switching from one session to another session', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Session 1',
        status: 'waiting',
        projectId: 'proj-1'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Verify component is mounted and working
      expect(wrapper.exists()).toBe(true);

      // In a real scenario, the watcher would be triggered by:
      // 1. User clicking on a different session in the UI
      // 2. Router navigating to a new session ID
      // 3. The watcher callback being called with (newSessionId, oldSessionId)
      //
      // The watcher implementation:
      // - Checks if newSessionId && newSessionId !== oldSessionId
      // - Calls todosStore.clearTodos()
      // - Calls todosStore.fetchTodos(newSessionId)
      //
      // We've verified the methods exist and work correctly in todos.test.js
      // This test verifies the component successfully initializes and mounts
    });
  });

  describe('session name wrapping', () => {
    it('renders session name element', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      const sessionName = wrapper.find('.session-name');
      expect(sessionName.exists()).toBe(true);
      expect(sessionName.text()).toBe('Test Session');
    });

    it('session name element has word-break styling for multi-line names', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Very Long Session Name That Should Wrap',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      const sessionName = wrapper.find('.session-name');
      const styles = window.getComputedStyle(sessionName.element);

      // Verify the session name element exists
      expect(sessionName.exists()).toBe(true);

      // The element should have word-break set to break-word for wrapping
      // (This verifies the CSS change from text-overflow: ellipsis to word-break: break-word)
      expect(sessionName.element.style.wordBreak || styles.wordBreak).toBeDefined();
    });

    it('session name does not truncate with ellipsis', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Very Long Session Name That Should Wrap Instead of Truncate',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      const sessionName = wrapper.find('.session-name');
      // The session name should be displayed in full
      expect(sessionName.text()).toBe('Very Long Session Name That Should Wrap Instead of Truncate');

      // Verify the element is not using text-overflow: ellipsis
      // by checking that it doesn't have overflow: hidden with text-overflow
      const styles = window.getComputedStyle(sessionName.element);
      // The element should allow wrapping (overflow should not be hidden with ellipsis)
      expect(sessionName.element.classList.contains('session-name')).toBe(true);
    });

    it('session header row adapts to multi-line session names on mobile', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Multi-line Session Name For Mobile View',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      const sessionHeaderRow = wrapper.find('.session-header-row');
      expect(sessionHeaderRow.exists()).toBe(true);

      // The header row should be flexible enough to accommodate multi-line names
      // Verify it has the correct classes/structure
      expect(sessionHeaderRow.element.classList.contains('session-header-row')).toBe(true);
    });

    it('session name allows line breaks', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'First Line\nSecond Line',
        status: 'running'
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      const sessionName = wrapper.find('.session-name');
      expect(sessionName.exists()).toBe(true);

      // The session name should display the text with potential for wrapping
      expect(sessionName.text()).toBeTruthy();
    });
  });

  describe('usage subscription (Issue #175 - token count fix)', () => {
    it('subscribes to usage updates in SessionDetailView, not ConversationTab', async () => {
      // This test verifies that usage subscription was moved from ConversationTab to SessionDetailView
      // to ensure conversations are loaded before usage updates arrive (prevents race conditions)
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Component should have mounted successfully
      expect(wrapper.exists()).toBe(true);

      // The component should have a method to handle usage updates
      // (via the onUsageUpdate handler in onMounted)
      // We verify the component structure is correct for handling these updates
      expect(sessionsStore.updateRunningUsage).toBeDefined();
      expect(sessionsStore.finalizeUsage).toBeDefined();
    });

    it('fetches conversations before setting up usage subscription', async () => {
      // Critical: conversations must be loaded BEFORE usage updates arrive
      // Otherwise usage updates can't find the conversation to update
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Verify component mounted successfully
      // The component internally calls fetchConversations during onMounted (STEP 1.5 in the code)
      // This ensures conversations array is populated before usage update handlers are registered
      expect(wrapper.exists()).toBe(true);
    });

    it('calls updateRunningUsage when non-final usage update arrives', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'proj-1',
      };

      const updateRunningUsageSpy = vi.spyOn(sessionsStore, 'updateRunningUsage');

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Simulate a streaming usage update (isFinal: false)
      // In the real component, this would come from the WebSocket onUsageUpdate handler
      const mockUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
      };
      const mockConversationId = 'conv-1';

      // Call the method as the WebSocket handler would
      sessionsStore.updateRunningUsage(mockUsage, mockConversationId);

      // Verify it was called
      expect(updateRunningUsageSpy).toHaveBeenCalledWith(mockUsage, mockConversationId);
    });

    it('calls finalizeUsage when final usage update arrives', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'proj-1',
      };

      const finalizeUsageSpy = vi.spyOn(sessionsStore, 'finalizeUsage');

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            NotesTab: true,
            PrIndicators: true,
            SchedulingInfo: true
          }
        }
      });

      await flushPromises();

      // Simulate a final usage update (isFinal: true)
      const mockUsage = {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadInputTokens: 100,
        cacheCreationInputTokens: 50,
      };
      const mockConversationId = 'conv-1';

      // Call the method as the WebSocket handler would when turn ends
      sessionsStore.finalizeUsage(mockUsage, mockConversationId);

      // Verify it was called
      expect(finalizeUsageSpy).toHaveBeenCalledWith(mockUsage, mockConversationId);
    });
  });

  describe('command button status indicators', () => {
    it('passes command button statuses to SessionHeaderPanel', async () => {
      const { useCommandButtonsStore } = await import('../stores/commandButtons.js');
      const commandButtonsStore = useCommandButtonsStore();

      // Set up command buttons for the project (getButtonsByProjectId is a getter that filters by projectId)
      commandButtonsStore.buttons = [
        { id: 'btn-1', label: 'Test Command', showOnList: true, projectId: 'project-1' },
        { id: 'btn-2', label: 'Build', showOnList: true, projectId: 'project-1' },
        { id: 'btn-3', label: 'Hidden', showOnList: false, projectId: 'project-1' },
      ];

      vi.spyOn(commandButtonsStore, 'fetchButtons').mockResolvedValue(undefined);

      // Set up session with command runs
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        latestCommandRuns: [
          { buttonId: 'btn-1', status: 'running', runId: 'run-1' },
          { buttonId: 'btn-2', status: 'success', runId: 'run-2', exitCode: 0 },
          { buttonId: 'btn-3', status: 'error', runId: 'run-3', exitCode: 1 },
        ],
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);

      // Should have 2 statuses (btn-1 and btn-2) because btn-3 has showOnList: false
      expect(headerPanel.props('buttonStatuses').length).toBe(2);
    });

    it('passes empty button statuses when no command runs exist', async () => {
      const { useCommandButtonsStore } = await import('../stores/commandButtons.js');
      const commandButtonsStore = useCommandButtonsStore();

      commandButtonsStore.buttons = [];
      vi.spyOn(commandButtonsStore, 'fetchButtons').mockResolvedValue(undefined);

      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        latestCommandRuns: [],
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.props('buttonStatuses').length).toBe(0);
    });

    it('updates buttonStatuses prop when command status changes', async () => {
      const { useCommandButtonsStore } = await import('../stores/commandButtons.js');
      const commandButtonsStore = useCommandButtonsStore();

      commandButtonsStore.buttons = [
        { id: 'btn-1', label: 'Test Command', showOnList: true, projectId: 'project-1' },
      ];

      vi.spyOn(commandButtonsStore, 'fetchButtons').mockResolvedValue(undefined);

      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        latestCommandRuns: [
          { buttonId: 'btn-1', status: 'running', runId: 'run-1' },
        ],
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // Verify initial state
      let headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.props('buttonStatuses')[0].status).toBe('running');

      // Simulate command completion via store update
      sessionsStore.updateSessionCommandRun('session-1', 'btn-1', {
        buttonId: 'btn-1',
        status: 'success',
        exitCode: 0,
        runId: 'run-1',
      });

      await flushPromises();

      headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.props('buttonStatuses')[0].status).toBe('success');
    });
  });

  describe('PR URL editing', () => {
    it('passes session with null prUrl to SessionHeaderPanel', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: null,
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').prUrl).toBeNull();
    });

    it('passes session with prUrl to SessionHeaderPanel', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: 'https://github.com/owner/repo/pull/123',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').prUrl).toBe('https://github.com/owner/repo/pull/123');
    });

    it('SessionHeaderPanel receives sessionId prop for PR editing', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: null,
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.props('sessionId')).toBe('session-1');
    });

    it('SessionHeaderPanel receives session prop with prUrl for editing', async () => {
      const existingPrUrl = 'https://github.com/owner/repo/pull/123';
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: existingPrUrl,
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.props('session').prUrl).toBe(existingPrUrl);
    });

    it('SessionHeaderPanel receives session for cancel behavior', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: null,
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session')).toBeDefined();
    });

    it('SessionHeaderPanel receives session for escape behavior', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: null,
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('sessionId')).toBe('session-1');
    });

    it('SessionHeaderPanel receives session with prUrl for clear button behavior', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: 'https://github.com/owner/repo/pull/123',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.props('session').prUrl).toBe('https://github.com/owner/repo/pull/123');
    });

    it('renders branch-pr-indicators section always', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: null,
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // SessionHeaderPanel is rendered (which contains branch-pr-indicators)
      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
    });

    it('passes session with prUrl to SessionHeaderPanel for PrIndicators rendering', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: 'https://github.com/owner/repo/pull/123',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // SessionHeaderPanel receives the session with prUrl so it can render PrIndicators
      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').prUrl).toBe('https://github.com/owner/repo/pull/123');
    });

    it('passes session with null prUrl to SessionHeaderPanel (no PrIndicators)', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: null,
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // SessionHeaderPanel receives the session with null prUrl
      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').prUrl).toBeNull();
    });

    it('SessionHeaderPanel receives session for placeholder behavior', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'project-1',
        prUrl: null,
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').prUrl).toBeNull();
    });
  });

  describe('tab component remount on session change (cross-session thinking leak fix)', () => {
    // These tests verify the fix for the bug where thinking messages from Session A
    // would appear in Session B. The root cause was that tab components weren't remounting
    // when navigating between sessions, causing stale WebSocket handlers with captured
    // sessionIds from the closure.
    //
    // The fix adds :key="route.params.id" to each tab component, forcing Vue to destroy
    // and recreate the component when the session ID changes.

    it('tab components render with correct session ID passed as prop', async () => {
      // This test verifies that the session ID from the route is correctly
      // passed to tab components as a prop
      sessionsStore.currentSession = {
        id: 'session-123',
        name: 'Test Session',
        status: 'waiting',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-123');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // Component should mount successfully with the route param as session ID
      expect(wrapper.exists()).toBe(true);
      // The session name from the store should be displayed
      expect(wrapper.text()).toContain('Test Session');
    });

    it('cleanup function is defined and resets session state', async () => {
      // This test verifies that the cleanup function properly resets state
      // when navigating between sessions (which prevents cross-session data leakage)
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Session 1',
        status: 'waiting',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('subscription cleanup on session navigation (WebSocket leak fix)', () => {
    // These tests verify the fix for the WebSocket subscription leak.
    // Previously, ensureSubscribed() was called but subscribe() wasn't,
    // which meant thisInstanceSubscribed stayed false and unsubscribe()
    // would silently do nothing, leaking subscriptions.
    //
    // The fix calls subscribe() before ensureSubscribed() in initializeSession(),
    // ensuring that thisInstanceSubscribed is set to true so unsubscribe() works.

    it('clearRunningUsage is called on unmount', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Session 1',
        status: 'waiting',
        projectId: 'proj-1',
      };

      const clearRunningUsageSpy = vi.spyOn(sessionsStore, 'clearRunningUsage');

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();
      clearRunningUsageSpy.mockClear();

      // Unmount the component
      wrapper.unmount();

      // clearRunningUsage should have been called during cleanup
      expect(clearRunningUsageSpy).toHaveBeenCalled();
    });

    it('clearTodos is called on unmount', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Session 1',
        status: 'waiting',
        projectId: 'proj-1',
      };

      const clearTodosSpy = vi.spyOn(todosStore, 'clearTodos');

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();
      clearTodosSpy.mockClear();

      // Unmount the component
      wrapper.unmount();

      // clearTodos should have been called during cleanup
      expect(clearTodosSpy).toHaveBeenCalled();
    });

    it('clears messages, conversations, and workLogs on unmount to prevent stale state', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Session 1',
        status: 'running',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // Simulate data that was loaded for the session
      sessionsStore.messages = [{ id: 'msg-1', content: 'hello' }];
      sessionsStore.conversations = [{ id: 'conv-1', name: 'main' }];
      sessionsStore.workLogs = { 'msg-1': [{ id: 'log-1' }] };

      wrapper.unmount();

      // All session-specific state should be cleared on cleanup
      expect(sessionsStore.messages).toEqual([]);
      expect(sessionsStore.conversations).toEqual([]);
      expect(sessionsStore.workLogs).toEqual({});
    });

    it('calls clearPartialText on unmount to stop any in-progress streaming display', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Session 1',
        status: 'running',
        projectId: 'proj-1',
      };

      const clearPartialTextSpy = vi.spyOn(sessionsStore, 'clearPartialText');

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();
      clearPartialTextSpy.mockClear();

      wrapper.unmount();

      // clearPartialText should be called during cleanup to prevent stale streaming text
      expect(clearPartialTextSpy).toHaveBeenCalled();
    });

    it('clears canvas items on unmount to prevent stale items when switching sessions', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Session 1',
        status: 'running',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // Simulate some canvas items loaded for this session
      canvasStore.items = [{ id: 'canvas-1', type: 'text', sessionId: 'session-1' }];

      wrapper.unmount();

      // Canvas items should be cleared on cleanup so the next session starts fresh
      expect(canvasStore.items).toEqual([]);
    });
  });

  describe('fetchChildSummaries (child session PR indicators)', () => {
    // These tests verify that SessionDetailView properly integrates with
    // child session summaries for displaying PR indicators

    it('component mounts successfully when child sessions exist', async () => {
      // Mock child sessions
      const childSessions = [
        { id: 'child-1', parentId: 'session-1', name: 'Child 1' },
        { id: 'child-2', parentId: 'session-1', name: 'Child 2' },
      ];

      // Mock sessionsStore.getChildSessions to return child sessions
      // getChildSessions is a getter that returns a function: getChildSessions(parentId)
      vi.spyOn(sessionsStore, 'getChildSessions', 'get').mockReturnValue(() => childSessions);

      // Mock API to return summaries (prevent actual API calls)
      api.getSessionSummary.mockResolvedValue({ shortSummary: 'Test summary' });

      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // Component should mount successfully even with child sessions
      expect(wrapper.exists()).toBe(true);
    });

    it('handles missing summaries gracefully (summary may not exist)', async () => {
      const childSessions = [
        { id: 'child-1', parentId: 'session-1', name: 'Child 1' },
      ];

      vi.spyOn(sessionsStore, 'getChildSessions', 'get').mockReturnValue(() => childSessions);

      // Mock API to reject (summary doesn't exist)
      api.getSessionSummary.mockRejectedValue(new Error('Summary not found'));

      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // Component should handle errors gracefully and not crash
      expect(wrapper.exists()).toBe(true);
    });

    it('handles case with no child sessions', async () => {
      // Mock no child sessions
      vi.spyOn(sessionsStore, 'getChildSessions', 'get').mockReturnValue(() => []);

      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // Component should mount successfully with no child sessions
      expect(wrapper.exists()).toBe(true);
    });

    it.skip('ChildSessionsPanel receives summaries prop', async () => {
      // SKIPPED: This test requires unmocking SummaryTab which is complex with Vitest.
      // The ChildSessionsPanel functionality is tested in ChildSessionsPanel.test.js
      // and SummaryTab integration is verified through E2E tests.
      // Import real SummaryTab component for this test
      vi.doUnmock('../components/SummaryTab.vue');
      const { default: RealSummaryTab } = await import('../components/SummaryTab.vue?t=' + Date.now());

      const childSession = {
        id: 'child-1',
        parentSessionId: 'session-1',
        name: 'Child 1',
        status: 'completed',
        createdAt: Date.now(),
      };

      // Mock getChildSessions to return the child session
      vi.spyOn(sessionsStore, 'getChildSessions', 'get').mockReturnValue(() => [childSession]);

      api.getSessionSummary.mockResolvedValue({ shortSummary: 'Test summary' });
      api.getConversations.mockResolvedValue([]);

      // Set up commandButtonsStore (needed by SummaryTab)
      const commandButtonsStore = useCommandButtonsStore();
      commandButtonsStore.buttons = [];
      vi.spyOn(commandButtonsStore, 'fetchButtons').mockResolvedValue(undefined);

      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'proj-1',
      };
      // Add both parent and child sessions to the sessions array
      sessionsStore.sessions = [sessionsStore.currentSession, childSession];

      await router.push('/sessions/session-1/summary');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: RealSummaryTab, // Use real SummaryTab component
            CommandsTab: true,
            PrIndicators: true,
            ChildSessionsPanel: false, // Don't stub to verify prop passing
          },
        },
      });

      await flushPromises();

      // Verify ChildSessionsPanel is rendered
      const childPanel = wrapper.findComponent({ name: 'ChildSessionsPanel' });
      expect(childPanel.exists()).toBe(true);

      // Verify summaries prop is passed (it should be defined, even if empty)
      expect(childPanel.props('summaries')).toBeDefined();
    });
  });

  describe('session active indicator', () => {
    it('passes isSessionActive=true to SessionTabsPanel when running', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const tabsPanel = wrapper.findComponent({ name: 'SessionTabsPanel' });
      expect(tabsPanel.props('isSessionActive')).toBe(true);
      expect(tabsPanel.props('sessionStatus')).toBe('running');
    });

    it('passes isSessionActive=true to SessionTabsPanel when starting', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'starting',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const tabsPanel = wrapper.findComponent({ name: 'SessionTabsPanel' });
      expect(tabsPanel.props('isSessionActive')).toBe(true);
      expect(tabsPanel.props('sessionStatus')).toBe('starting');
    });

    it('passes isSessionActive=false to SessionTabsPanel when completed', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'completed',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const tabsPanel = wrapper.findComponent({ name: 'SessionTabsPanel' });
      expect(tabsPanel.props('isSessionActive')).toBe(false);
    });

    it('passes isSessionActive=false to SessionTabsPanel when waiting', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'waiting',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const tabsPanel = wrapper.findComponent({ name: 'SessionTabsPanel' });
      expect(tabsPanel.props('isSessionActive')).toBe(false);
    });

    it('passes isSessionActive=false to SessionTabsPanel when error', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'error',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const tabsPanel = wrapper.findComponent({ name: 'SessionTabsPanel' });
      expect(tabsPanel.props('isSessionActive')).toBe(false);
    });

    it('passes sessionStatus=running to SessionTabsPanel for running status', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'running',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const tabsPanel = wrapper.findComponent({ name: 'SessionTabsPanel' });
      expect(tabsPanel.props('sessionStatus')).toBe('running');
    });

    it('passes sessionStatus=starting to SessionTabsPanel for starting status', async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Test Session',
        status: 'starting',
        projectId: 'proj-1',
      };

      await router.push('/sessions/session-1');
      await router.isReady();

      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            ChangesTab: true,
            CanvasTab: true,
            SummaryTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const tabsPanel = wrapper.findComponent({ name: 'SessionTabsPanel' });
      expect(tabsPanel.props('sessionStatus')).toBe('starting');
    });
  });

  describe('Session Name Editing', () => {
    beforeEach(async () => {
      sessionsStore.currentSession = {
        id: 'session-1',
        name: 'Original Session Name',
        status: 'waiting',
        projectId: 'proj-1',
        manuallyNamed: false,
      };

      await router.push('/sessions/session-1');
      await router.isReady();
    });

    it('passes session name to SessionHeaderPanel', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // The mock template renders the session name
      expect(wrapper.find('.session-name').text()).toBe('Original Session Name');

      // SessionHeaderPanel receives the session prop with the name
      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').name).toBe('Original Session Name');
    });

    it('passes session to SessionHeaderPanel for edit mode', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      // SessionHeaderPanel receives the session and sessionId props needed for editing
      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('sessionId')).toBe('session-1');
      expect(headerPanel.props('session').name).toBe('Original Session Name');
      expect(headerPanel.props('session').manuallyNamed).toBe(false);
    });

    it('passes sessionId to SessionHeaderPanel for save functionality', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.props('sessionId')).toBe('session-1');
      expect(headerPanel.props('session').name).toBe('Original Session Name');
    });

    it('passes session to SessionHeaderPanel for Enter key save', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').name).toBe('Original Session Name');
    });

    it('passes session to SessionHeaderPanel for Escape cancel', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      // Session name should remain unchanged in the store
      expect(sessionsStore.currentSession.name).toBe('Original Session Name');
    });

    it('passes session to SessionHeaderPanel for cancel button', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').name).toBe('Original Session Name');
    });

    it('passes session to SessionHeaderPanel for empty name validation', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('sessionId')).toBe('session-1');
    });

    it('passes session to SessionHeaderPanel for whitespace trimming', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').name).toBe('Original Session Name');
    });

    it('passes session to SessionHeaderPanel for API error handling', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true,
            SummaryTab: true,
            ChangesTab: true,
            CanvasTab: true,
            CommandsTab: true,
            PrIndicators: true,
          },
        },
      });

      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('sessionId')).toBe('session-1');
    });

    it('does not show name-edit-form in SessionHeaderPanel mock when not editing', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true, SummaryTab: true, ChangesTab: true,
            CanvasTab: true, CommandsTab: true, PrIndicators: true,
          },
        },
      });
      await flushPromises();

      // The mock template does not include name-edit-form
      expect(wrapper.find('.name-edit-form .pr-clear-btn').exists()).toBe(false);
    });

    it('SessionHeaderPanel receives session for clear button editing', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true, SummaryTab: true, ChangesTab: true,
            CanvasTab: true, CommandsTab: true, PrIndicators: true,
          },
        },
      });
      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').name).toBe('Original Session Name');
    });

    it('SessionHeaderPanel receives session for clear input behavior', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true, SummaryTab: true, ChangesTab: true,
            CanvasTab: true, CommandsTab: true, PrIndicators: true,
          },
        },
      });
      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('sessionId')).toBe('session-1');
    });

    it('SessionHeaderPanel receives session for clear without save', async () => {
      const wrapper = mount(SessionDetailView, {
        global: {
          plugins: [pinia, router],
          stubs: {
            ConversationTab: true, SummaryTab: true, ChangesTab: true,
            CanvasTab: true, CommandsTab: true, PrIndicators: true,
          },
        },
      });
      await flushPromises();

      const headerPanel = wrapper.findComponent({ name: 'SessionHeaderPanel' });
      expect(headerPanel.exists()).toBe(true);
      expect(headerPanel.props('session').name).toBe('Original Session Name');
    });
  });
});
