// Dedicated integration test for the running-state FRD (FR-1, FR-2, FR-5,
// FR-7): the Conversation tab rendered inside an overlay must transition to
// its active treatment the moment the API accepts a Send — even if the
// `session:status: running` WebSocket frame is never delivered — and must
// keep the composer non-actionable while assistant output streams in. When a
// terminal status arrives, the composer returns and the final refresh runs.
//
// Unlike ConversationTab.test.js (which mocks the sessions store), this file
// mounts the component against the REAL overlay sessions store
// (createOverlaySessionsStore) provided via injection, exactly as
// SessionChatContent provides it — so the optimistic command acknowledgement
// and the socket-frame simulation exercise the same code paths the app runs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn().mockResolvedValue(undefined) })),
  useRoute: vi.fn(() => ({ query: {}, params: {} })),
}));

vi.mock('../composables/useConnectionStatus.js', async () => {
  const { ref } = await import('vue');
  return {
    useConnectionStatus: () => ({
      isStale: ref(false),
      connectionStatus: ref('connected'),
      reconnectAttempt: ref(0),
    }),
  };
});

vi.mock('../composables/useApi.js', () => ({
  api: {
    getSessionPrompt: vi.fn().mockResolvedValue(null),
    getConversations: vi.fn().mockResolvedValue([{ id: 'conv-1', name: 'Main', isActive: true }]),
    getConversationMessages: vi.fn().mockResolvedValue([]),
    getSessionMessages: vi.fn().mockResolvedValue([]),
    getSessionWorkLogs: vi.fn().mockResolvedValue({}),
    updateSessionPendingPrompt: vi.fn().mockResolvedValue(undefined),
    updateSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
    sendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    startSession: vi.fn().mockResolvedValue({ id: 'sess-1' }),
    getProject: vi.fn().mockResolvedValue({ id: 'proj-1', name: 'P', workingDirectory: '/tmp/p' }),
    getProjectTemplates: vi.fn().mockResolvedValue([]),
    getAgents: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./ModelSelector.vue', () => ({
  default: {
    name: 'ModelSelector',
    props: ['modelValue', 'disabled'],
    template: '<div class="model-selector-stub"></div>',
  },
}));

vi.mock('./FileAttachment.vue', () => ({
  default: {
    name: 'FileAttachment',
    emits: ['update:files'],
    template: '<div class="file-attachment-stub"></div>',
    methods: { clear: vi.fn() },
  },
}));

import ConversationTab from './ConversationTab.vue';
import { api } from '../composables/useApi.js';
import { useSessionsStore } from '../stores/sessions.js';
import { createOverlaySessionsStore } from '../stores/createOverlaySessionsStore.js';
import { SESSIONS_STORE_KEY } from '../composables/useOverlayStore.js';

const waitingSession = () => ({
  id: 'sess-1',
  name: 'Test Workspace',
  status: 'waiting',
  projectId: 'proj-1',
  model: 'sonnet',
  pendingPrompt: null,
  // An existing conversation: the FRD scenario is a follow-up send on a
  // session that already has responses (not a draft start).
  hasResponses: true,
});

describe('ConversationTab running state (overlay regression, running-state FRD)', () => {
  let pinia;
  let overlayStore;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    overlayStore = createOverlaySessionsStore();
    overlayStore.currentSession = waitingSession();
    overlayStore.viewedSessionId = 'sess-1';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mountTab() {
    return mount(ConversationTab, {
      props: { sessionId: 'sess-1' },
      global: {
        provide: { [SESSIONS_STORE_KEY]: overlayStore },
        stubs: {
          ConversationPanel: { template: '<div class="conversation-panel-stub"></div>' },
          TodoDrawer: { template: '<div class="todo-drawer-stub"></div>' },
          AgentPromptCard: { template: '<div class="agent-prompt-card-stub"></div>' },
          MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
          LiveWorkLogPanel: { template: '<div class="live-work-log-panel-stub"></div>' },
          QuickResponsesPanel: { template: '<div class="quick-responses-panel-stub"></div>' },
          OrchestrationPanel: { template: '<div class="orchestration-panel-stub"></div>' },
          ModeSelector: { template: '<div class="mode-selector-stub"></div>' },
          EffortLevelSelector: { template: '<div class="effort-level-selector-stub"></div>' },
          SlashCommandButton: { template: '<div class="slash-command-button-stub"></div>' },
          SlashCommandWizard: { template: '<div class="slash-command-wizard-stub"></div>' },
          ScheduleSessionModal: { template: '<div class="schedule-session-modal-stub"></div>' },
          AutoRescheduleModal: { template: '<div class="auto-reschedule-modal-stub"></div>' },
          SchedulingInfo: { template: '<div class="scheduling-info-stub"></div>' },
          TemplateApplySelector: { template: '<div class="template-apply-selector-stub"></div>' },
          StaleBadge: { template: '<div class="stale-badge-stub"></div>' },
        },
      },
    });
  }

  async function flushAll(wrapper) {
    await flushPromises();
    await nextTick();
    await wrapper.vm.$nextTick?.();
  }

  async function submitPrompt(wrapper, text) {
    await wrapper.find('textarea').setValue(text);
    await wrapper.find('form').trigger('submit');
    await flushAll(wrapper);
  }

  it('shows the running treatment immediately after an accepted send, even with the running frame suppressed (FR-1)', async () => {
    const wrapper = mountTab();
    await flushAll(wrapper);

    // Idle state: normal composer with an actionable Send button.
    expect(wrapper.find('.running-state').exists()).toBe(false);
    expect(wrapper.find('.btn-send-full').exists()).toBe(true);

    // Submit "Continue" — the API accepts, but the `session:status: running`
    // WebSocket frame is suppressed (never delivered).
    await submitPrompt(wrapper, 'Continue');

    // FR-1: the tab transitions on the API acknowledgement alone.
    expect(overlayStore.currentSession.status).toBe('running');
    expect(wrapper.find('.running-state').exists()).toBe(true);
    expect(wrapper.find('.running-title').text()).toBe('Agent is working...');
    expect(wrapper.find('.btn-stop').exists()).toBe(true);

    // FR-2: no actionable Send control while running.
    expect(wrapper.find('.btn-send-full').exists()).toBe(false);

    // The acknowledgement is not repeatable: re-submitting the form is a no-op.
    api.sendMessage.mockClear();
    await wrapper.find('form').trigger('submit');
    await flushAll(wrapper);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('keeps the running treatment while assistant output streams with the frame suppressed, then restores the composer on waiting (FR-5, FR-7)', async () => {
    const wrapper = mountTab();
    await flushAll(wrapper);

    await submitPrompt(wrapper, 'Continue');

    // An assistant message arrives while the `running` status frame is still
    // suppressed — this is the store effect of the onMessage handler.
    overlayStore.addMessage({ id: 'msg-a', sessionId: 'sess-1', role: 'assistant', content: 'Working on it' });
    await flushAll(wrapper);

    // Assistant output and active controls agree (FR-5).
    expect(wrapper.text()).toContain('Working on it');
    expect(wrapper.find('.running-state').exists()).toBe(true);
    expect(wrapper.find('.btn-send-full').exists()).toBe(false);

    // The `waiting` terminal frame arrives.
    overlayStore.updateSessionStatus('sess-1', 'waiting');
    await flushAll(wrapper);

    // FR-7: active treatment ends, composer returns.
    expect(wrapper.find('.running-state').exists()).toBe(false);
    expect(wrapper.find('.btn-send-full').exists()).toBe(true);
    expect(wrapper.text()).toContain('Working on it');

    // FR-7: the existing final-message and work-log refresh behavior ran.
    expect(api.getConversationMessages).toHaveBeenCalledWith('sess-1', 'conv-1');
    expect(api.getSessionWorkLogs).toHaveBeenCalledWith('sess-1');
  });

  it('shows the starting transitional treatment for a starting session and never a sendable composer (FR-2)', async () => {
    overlayStore.updateSessionStatus('sess-1', 'starting');
    const wrapper = mountTab();
    await flushAll(wrapper);

    // Explicit transitional panel (not idle, not the working copy).
    expect(wrapper.find('.running-state').exists()).toBe(true);
    expect(wrapper.find('.running-title').text()).toBe('Workspace starting...');
    expect(wrapper.find('.btn-stop').exists()).toBe(true);
    expect(wrapper.find('.btn-send-full').exists()).toBe(false);

    // The treatment is consistent when the session reaches running.
    overlayStore.updateSessionStatus('sess-1', 'running');
    await flushAll(wrapper);
    expect(wrapper.find('.running-title').text()).toBe('Agent is working...');
    expect(wrapper.find('.btn-send-full').exists()).toBe(false);
  });

  it('keeps the prior state, input, and composer when the API rejects the send (FR-1)', async () => {
    api.sendMessage.mockRejectedValue(new Error('Provider unavailable'));
    const wrapper = mountTab();
    await flushAll(wrapper);

    await submitPrompt(wrapper, 'Try this');

    // No false running indicator...
    expect(overlayStore.currentSession.status).toBe('waiting');
    expect(wrapper.find('.running-state').exists()).toBe(false);
    // ...the composer is still available with the unsent text retained.
    expect(wrapper.find('.btn-send-full').exists()).toBe(true);
    expect(wrapper.find('textarea').element.value).toBe('Try this');
  });
});
