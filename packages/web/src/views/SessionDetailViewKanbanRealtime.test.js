import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import SessionDetailView from './SessionDetailView.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useCanvasStore } from '../stores/canvas.js';
import { useTodosStore } from '../stores/todos.js';
import { useProjectsStore } from '../stores/projects.js';
import { useUiStore } from '../stores/ui.js';
import { useKanbanStore } from '../stores/kanban.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import { projectSubscriptionIds, projectSubscriptionCounts } from '../composables/useProjectSubscription.js';

// Multi-handler registry: every on(type, handler) is recorded so tests can
// simulate server broadcasts; off(type, handler) removes one registration.
const websocketHandlers = vi.hoisted(() => new Map());
const websocketSend = vi.hoisted(() => vi.fn());

function getHandlers(type) {
  return websocketHandlers.get(type) || new Set();
}

function emitWsMessage(type, msg) {
  for (const handler of [...getHandlers(type)]) handler(msg);
}

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
  default: { name: 'DuplicateSessionButton', template: '<button>Duplicate</button>' }
}));
vi.mock('../components/OverflowMenu.vue', () => ({
  default: {
    name: 'OverflowMenu',
    template: '<div class="overflow-menu"></div>',
    emits: ['duplicate', 'archive', 'delete']
  }
}));
vi.mock('../components/SessionChatHandle.vue', () => ({
  default: {
    name: 'SessionChatHandle',
    template: '<div class="session-chat-handle">Chat Handle</div>',
    props: ['isSessionActive', 'sessionStatus'],
    emits: ['open']
  }
}));
vi.mock('../components/SessionChatOverlay.vue', () => ({
  default: {
    name: 'SessionChatOverlay',
    template: '<div class="session-chat-overlay"></div>',
    props: ['sessionId', 'sessionChain', 'summariesMap'],
    emits: ['close', 'session-created', 'session-deleted']
  }
}));
vi.mock('../components/SessionChatContent.vue', () => ({
  default: {
    name: 'SessionChatContent',
    template: '<div class="session-chat-content">Chat Content</div>',
    props: ['sessionId', 'sessionChain', 'summariesMap', 'mode'],
    emits: ['session-created', 'session-deleted', 'prompt-focus', 'prompt-blur', 'picker-open-change', 'active-session-change'],
  }
}));
vi.mock('../components/SessionHeaderPanel.vue', () => ({
  default: {
    name: 'SessionHeaderPanel',
    template: '<div class="session-header">{{ session?.name }}</div>',
    props: ['sessionId', 'session', 'summary', 'isDeleting', 'buttonStatuses'],
    emits: ['duplicate', 'copySessionId', 'archive', 'delete', 'star', 'add-to-board'],
  }
}));
vi.mock('../components/SessionTabsPanel.vue', () => ({
  default: {
    name: 'SessionTabsPanel',
    template: '<div class="tabs"></div>',
    props: ['sessionId', 'projectId', 'activeTab', 'tabs', 'hasChanges', 'canvasCount', 'isSessionActive', 'sessionStatus'],
  }
}));
vi.mock('../components/ArchiveConfirmModal.vue', () => ({
  default: {
    name: 'ArchiveConfirmModal',
    props: ['isOpen', 'sessionName', 'hasCleanupScript', 'isOnKanbanBoard', 'loading'],
    emits: ['confirm', 'cancel'],
    template: '<div v-if="isOpen" class="archive-confirm-modal"></div>',
  }
}));
vi.mock('../components/KanbanLaneSelectorModal.vue', () => ({
  default: {
    name: 'KanbanLaneSelectorModal',
    props: ['isOpen', 'sessionName', 'lanes', 'currentLaneId'],
    emits: ['close', 'select-lane'],
    template: '<div v-if="isOpen" class="kanban-lane-selector-modal"></div>',
  },
}));
vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionSummary: vi.fn().mockResolvedValue(null),
    updateSession: vi.fn(),
    getSession: vi.fn(),
    getConversations: vi.fn(),
    getSessionChanges: vi.fn().mockResolvedValue({ staged: '', unstaged: '', untracked: '' }),
    getKanbanBoard: vi.fn().mockResolvedValue(null),
    getProjectSessions: vi.fn().mockResolvedValue([]),
    getWorkspaceDetail: vi.fn().mockResolvedValue(null),
    getProjectTemplates: vi.fn().mockResolvedValue([]),
    getCommandButtons: vi.fn().mockResolvedValue([]),
  },
}));

// Same shape as SessionDetailView.test.js, except this mock also exposes
// useProjectSubscription: a thin fake over the mocked socket that replicates
// the real implementation's contract (projectId filtering + refcounting
// against the REAL projectSubscriptionIds/Counts modules, which stay
// unmocked). Reusing the real implementation via importActual is not possible
// here: re-exporting it through this mocked module resolves its internal
// useWebSocket import to the real socket instead of this mock (mock-cycle
// fallback), so broadcasts would bypass websocketHandlers entirely.
vi.mock('../composables/useWebSocket.js', async () => {
  // Local aliases (NOT the top-level import names: the mock factory runs
  // before module imports resolve, so it cannot reference them — no-shadow).
  // Both resolve to the same module instances as the static imports above.
  const { WS_MESSAGE_TYPES: TYPES } = await vi.importActual('@circuschief/shared');
  const {
    projectSubscriptionIds: liveSubscriptionIds,
    projectSubscriptionCounts: liveSubscriptionCounts,
  } = await vi.importActual('../composables/useProjectSubscription.js');
  const { onUnmounted } = await vi.importActual('vue');
  const h = () => vi.fn(() => () => {});

  const onFn = vi.fn((type, callback) => {
    if (!websocketHandlers.has(type)) websocketHandlers.set(type, new Set());
    websocketHandlers.get(type).add(callback);
  });
  const offFn = vi.fn((type, callback) => {
    if (callback) websocketHandlers.get(type)?.delete(callback);
    else websocketHandlers.delete(type);
  });
  const socketApi = {
    isConnected: { value: true },
    send: websocketSend,
    on: onFn,
    off: offFn,
    disconnect: vi.fn(),
    clearSessionBuffer: vi.fn(),
    onReconnect: vi.fn(() => () => {}),
  };
  const mockUseWebSocket = vi.fn(() => socketApi);

  function fakeUseProjectSubscription(projectId, { autoCleanup = true } = {}) {
    const { send, on, off } = mockUseWebSocket();
    let thisInstanceSubscribed = false;

    const subscribe = () => {
      if (thisInstanceSubscribed) return;
      thisInstanceSubscribed = true;
      const count = liveSubscriptionCounts.get(projectId) || 0;
      liveSubscriptionCounts.set(projectId, count + 1);
      if (count > 0) return;
      liveSubscriptionIds.add(projectId);
      send(TYPES.SUBSCRIBE_PROJECT, { projectId });
    };

    const unsubscribe = () => {
      if (!thisInstanceSubscribed) return;
      thisInstanceSubscribed = false;
      const count = liveSubscriptionCounts.get(projectId) || 0;
      if (count > 1) {
        liveSubscriptionCounts.set(projectId, count - 1);
        return;
      }
      liveSubscriptionCounts.delete(projectId);
      liveSubscriptionIds.delete(projectId);
      send(TYPES.UNSUBSCRIBE_PROJECT, { projectId });
    };

    const createSessionHandler = (messageType) => (callback) => {
      const handler = (msg) => {
        if (msg.projectId === projectId) callback(msg.session);
      };
      on(messageType, handler);
      return () => off(messageType, handler);
    };
    const createProjectMessageHandler = (messageType) => (callback) => {
      const handler = (msg) => {
        if (msg.projectId === projectId) callback(msg);
      };
      on(messageType, handler);
      return () => off(messageType, handler);
    };

    if (autoCleanup) onUnmounted(unsubscribe);

    return {
      subscribe,
      unsubscribe,
      onSessionCreated: createSessionHandler(TYPES.SESSION_CREATED),
      onSessionUpdated: createSessionHandler(TYPES.SESSION_UPDATED),
      onKanbanBoardUpdated: (callback) => {
        const handler = (msg) => {
          if (msg.projectId === projectId) callback(msg.board);
        };
        on(TYPES.KANBAN_BOARD_UPDATED, handler);
        return () => off(TYPES.KANBAN_BOARD_UPDATED, handler);
      },
      onKanbanCardMoved: (callback) => {
        const handler = (msg) => {
          if (msg.projectId === projectId) callback(msg.cardId, msg.fromLaneId, msg.toLaneId, msg.card);
        };
        on(TYPES.KANBAN_CARD_MOVED, handler);
        return () => off(TYPES.KANBAN_CARD_MOVED, handler);
      },
      onKanbanCardAdded: (callback) => {
        const handler = (msg) => {
          if (msg.projectId === projectId) callback(msg.card, msg.laneId);
        };
        on(TYPES.KANBAN_CARD_ADDED, handler);
        return () => off(TYPES.KANBAN_CARD_ADDED, handler);
      },
      onKanbanCardRemoved: (callback) => {
        const handler = (msg) => {
          if (msg.projectId === projectId) callback(msg.cardId, msg.laneId);
        };
        on(TYPES.KANBAN_CARD_REMOVED, handler);
        return () => off(TYPES.KANBAN_CARD_REMOVED, handler);
      },
      onKanbanExitLaneDeclared: (callback) => {
        const handler = (msg) => {
          if (msg.projectId === projectId) callback(msg.cardId, msg.activeLaneRun);
        };
        on(TYPES.KANBAN_EXIT_LANE_DECLARED, handler);
        return () => off(TYPES.KANBAN_EXIT_LANE_DECLARED, handler);
      },
      onCommandRunStarted: (callback) => {
        const handler = (msg) => {
          if (msg.projectId === projectId) callback(msg.runId, msg.sessionId, msg.buttonId);
        };
        on(TYPES.COMMAND_RUN_STARTED, handler);
        return () => off(TYPES.COMMAND_RUN_STARTED, handler);
      },
      onCommandRunComplete: (callback) => {
        const handler = (msg) => {
          if (msg.projectId === projectId) {
            callback({
              runId: msg.runId, sessionId: msg.sessionId, buttonId: msg.buttonId,
              exitCode: msg.exitCode, output: msg.output, status: msg.status,
            });
          }
        };
        on(TYPES.COMMAND_RUN_COMPLETE, handler);
        return () => off(TYPES.COMMAND_RUN_COMPLETE, handler);
      },
      onCommandRunError: (callback) => {
        const handler = (msg) => {
          if (msg.projectId === projectId) callback(msg.runId, msg.sessionId, msg.buttonId, msg.error);
        };
        on(TYPES.COMMAND_RUN_ERROR, handler);
        return () => off(TYPES.COMMAND_RUN_ERROR, handler);
      },
      onCommandRunDeleted: (callback) => {
        const handler = (msg) => {
          if (msg.projectId === projectId) callback(msg.runId, msg.sessionId, msg.buttonId);
        };
        on(TYPES.COMMAND_RUN_DELETED, handler);
        return () => off(TYPES.COMMAND_RUN_DELETED, handler);
      },
      onSessionMessage: createProjectMessageHandler(TYPES.SESSION_MESSAGE),
      onSessionStatus: createProjectMessageHandler(TYPES.SESSION_STATUS),
    };
  }

  return {
    ensureSubscribed: vi.fn(() => Promise.resolve()),
    useWebSocket: mockUseWebSocket,
    useSessionSubscription: vi.fn(() => ({
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      onStatus: h(),
      onMessage: h(),
      onPartial: h(),
      onError: h(),
      onCanvasAdd: h(),
      onCanvasRemove: h(),
      onCanvasUpdate: h(),
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
      onPrompt: h(),
      onPromptResolved: h(),
      onCommandOutput: h(),
      onCommandComplete: h(),
      onCommandError: h(),
      onCommandRunDeleted: h(),
    })),
    useProjectSubscription: fakeUseProjectSubscription,
  };
});

function makeBoard() {
  return {
    lanes: [
      {
        id: 'lane-a', name: 'Lane A',
        cards: [{ id: 'card-w', laneId: 'lane-a', sessions: [{ id: 'sess-1', name: 'W' }] }],
      },
      { id: 'lane-b', name: 'Lane B', cards: [] },
    ],
  };
}

describe('SessionDetailView kanban realtime', () => {
  let pinia;
  let router;
  let sessionsStore;
  let projectsStore;
  let kanbanStore;
  let canvasStore;
  let todosStore;
  let mountedWrappers = [];

  beforeEach(() => {
    vi.useFakeTimers();
    websocketHandlers.clear();
    websocketSend.mockClear();
    projectSubscriptionIds.clear();
    projectSubscriptionCounts.clear();
    pinia = createPinia();
    setActivePinia(pinia);

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/sessions/:id/:tab?', component: SessionDetailView }
      ]
    });

    sessionsStore = useSessionsStore();
    projectsStore = useProjectsStore();
    kanbanStore = useKanbanStore();
    canvasStore = useCanvasStore();
    todosStore = useTodosStore();
    useUiStore();

    vi.spyOn(sessionsStore, 'fetchSession').mockResolvedValue(undefined);
    vi.spyOn(sessionsStore, 'fetchMessages').mockResolvedValue(undefined);
    vi.spyOn(sessionsStore, 'fetchConversations').mockResolvedValue(undefined);
    vi.spyOn(sessionsStore, 'fetchWorkLogs').mockResolvedValue(undefined);
    vi.spyOn(canvasStore, 'fetchItems').mockResolvedValue(undefined);
    vi.spyOn(todosStore, 'fetchTodos').mockResolvedValue(undefined);
    vi.spyOn(projectsStore, 'fetchProject').mockImplementation(async (id) => {
      projectsStore.currentProject = { id, name: 'P' };
      return projectsStore.currentProject;
    });
    // Board snapshots are seeded directly by each test; realtime events patch
    // them thereafter.
    vi.spyOn(kanbanStore, 'fetchBoard').mockResolvedValue(null);

    window.confirm = vi.fn(() => true);

    mountedWrappers = [];
  });

  afterEach(() => {
    for (const w of mountedWrappers) {
      try { w.unmount(); } catch { /* already unmounted */ }
    }
    mountedWrappers = [];
    vi.useRealTimers();
  });

  async function mountDetail(sessionId, session) {
    sessionsStore.currentSession = { ...session };
    kanbanStore.board = makeBoard();
    kanbanStore.currentProjectId = session.projectId;
    await router.push(`/sessions/${sessionId}/summary`);
    await router.isReady();
    const wrapper = mount(SessionDetailView, {
      global: { plugins: [pinia, router] },
    });
    mountedWrappers.push(wrapper);
    await flushPromises();
    return wrapper;
  }

  it('registers a kanban card-moved listener after mount', async () => {
    await mountDetail('sess-1', { id: 'sess-1', name: 'W', status: 'stopped', projectId: 'proj-1' });
    expect(getHandlers(WS_MESSAGE_TYPES.KANBAN_CARD_MOVED).size).toBeGreaterThan(0);
  });

  it('applies a KANBAN_CARD_MOVED broadcast to the store', async () => {
    await mountDetail('sess-1', { id: 'sess-1', name: 'W', status: 'stopped', projectId: 'proj-1' });

    emitWsMessage(WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: 'proj-1',
      cardId: 'card-w',
      fromLaneId: 'lane-a',
      toLaneId: 'lane-b',
      card: { id: 'card-w', laneId: 'lane-b', sessions: [{ id: 'sess-1', name: 'W' }] },
    });

    const card = kanbanStore.getCardBySessionId('sess-1');
    expect(card).not.toBeNull();
    expect(card.laneId).toBe('lane-b');
    expect(kanbanStore.getLaneById(card.laneId)?.name).toBe('Lane B');
    expect(kanbanStore.board.lanes.find((l) => l.id === 'lane-a').cards).toHaveLength(0);
  });

  it('replaces the board on KANBAN_BOARD_UPDATED', async () => {
    await mountDetail('sess-1', { id: 'sess-1', name: 'W', status: 'stopped', projectId: 'proj-1' });

    const freshBoard = {
      lanes: [
        {
          id: 'lane-a', name: 'Lane A',
          cards: [{ id: 'card-w', laneId: 'lane-a', sessions: [{ id: 'sess-1', name: 'W' }] }],
        },
        {
          id: 'lane-b', name: 'Lane B',
          cards: [{ id: 'card-other', laneId: 'lane-b', sessions: [{ id: 'sess-9', name: 'Other' }] }],
        },
      ],
    };
    emitWsMessage(WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, { projectId: 'proj-1', board: freshBoard });
    expect(kanbanStore.board).toEqual(freshBoard);
  });

  it('follows project changes and ignores stale-project events', async () => {
    await mountDetail('sess-1', { id: 'sess-1', name: 'W', status: 'stopped', projectId: 'proj-1' });

    // Navigate sess-1 (proj-1) -> sess-2 (proj-2).
    sessionsStore.currentSession = { id: 'sess-2', name: 'V', status: 'stopped', projectId: 'proj-2' };
    kanbanStore.board = {
      lanes: [
        {
          id: 'lane-c', name: 'Lane C',
          cards: [{ id: 'card-v', laneId: 'lane-c', sessions: [{ id: 'sess-2', name: 'V' }] }],
        },
        { id: 'lane-d', name: 'Lane D', cards: [] },
      ],
    };
    kanbanStore.currentProjectId = 'proj-2';
    await router.push('/sessions/sess-2/summary');
    await flushPromises();

    // A late proj-1 move must not touch the proj-2 board.
    emitWsMessage(WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: 'proj-1',
      cardId: 'card-w',
      fromLaneId: 'lane-a',
      toLaneId: 'lane-b',
      card: { id: 'card-w', laneId: 'lane-b', sessions: [{ id: 'sess-1', name: 'W' }] },
    });
    expect(kanbanStore.getCardBySessionId('sess-2')?.laneId).toBe('lane-c');

    // A proj-2 move applies.
    emitWsMessage(WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
      projectId: 'proj-2',
      cardId: 'card-v',
      fromLaneId: 'lane-c',
      toLaneId: 'lane-d',
      card: { id: 'card-v', laneId: 'lane-d', sessions: [{ id: 'sess-2', name: 'V' }] },
    });
    expect(kanbanStore.getCardBySessionId('sess-2')?.laneId).toBe('lane-d');
  });

  it('clears header state on KANBAN_CARD_REMOVED', async () => {
    await mountDetail('sess-1', { id: 'sess-1', name: 'W', status: 'stopped', projectId: 'proj-1' });

    emitWsMessage(WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED, {
      projectId: 'proj-1', cardId: 'card-w', laneId: 'lane-a',
    });
    expect(kanbanStore.getCardBySessionId('sess-1')).toBeNull();
  });

  it('inserts cards on KANBAN_CARD_ADDED without duplicates', async () => {
    await mountDetail('sess-1', { id: 'sess-1', name: 'W', status: 'stopped', projectId: 'proj-1' });

    const card = { id: 'card-new', laneId: 'lane-b', sessions: [{ id: 'sess-3', name: 'New' }] };
    const msg = { projectId: 'proj-1', card, laneId: 'lane-b' };
    emitWsMessage(WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, msg);
    emitWsMessage(WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, msg);
    const laneB = kanbanStore.board.lanes.find((l) => l.id === 'lane-b');
    expect(laneB.cards.filter((c) => c.id === 'card-new')).toHaveLength(1);
    expect(kanbanStore.getCardBySessionId('sess-3')?.id).toBe('card-new');
  });

  it('removes kanban listeners and the project subscription on unmount', async () => {
    const wrapper = await mountDetail('sess-1', { id: 'sess-1', name: 'W', status: 'stopped', projectId: 'proj-1' });
    expect(getHandlers(WS_MESSAGE_TYPES.KANBAN_CARD_MOVED).size).toBeGreaterThan(0);

    wrapper.unmount();

    for (const type of [
      WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED,
      WS_MESSAGE_TYPES.KANBAN_CARD_MOVED,
      WS_MESSAGE_TYPES.KANBAN_CARD_ADDED,
      WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED,
      WS_MESSAGE_TYPES.KANBAN_EXIT_LANE_DECLARED,
    ]) {
      expect(getHandlers(type).size).toBe(0);
    }
    expect(projectSubscriptionCounts.has('proj-1')).toBe(false);
  });
});
