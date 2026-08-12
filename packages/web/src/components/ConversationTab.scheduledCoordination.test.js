// Dedicated integration test for real cross-component coordination between
// ConversationTab's prompt-submit button and the REAL SchedulingInfo
// component (rendered together, as they are in the actual app).
//
// ConversationTab.test.js mocks SchedulingInfo.vue out entirely (see its
// top-of-file vi.mock), which is appropriate for that file's broad
// rendering/behavior coverage but means it can't exercise a genuine DOM
// click on SchedulingInfo's own "Start Now"/"Cancel" buttons disabling
// ConversationTab's submit button, and vice versa. This file mounts both
// components for real to close that gap — see the remediation plan's Slice 3
// requirement to test "the scheduled conversation's prompt submit action and
// SchedulingInfo actions together."
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';

vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn().mockResolvedValue(undefined) })),
  useRoute: vi.fn(() => ({ query: {}, params: {} })),
}));

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(),
}));

vi.mock('../stores/projects.js', () => ({
  useProjectsStore: vi.fn(() => ({
    currentProject: null,
    fetchProject: vi.fn().mockResolvedValue(undefined),
    getProjectById: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock('../stores/providers.js', () => ({
  useProvidersStore: vi.fn(() => ({ providers: [], fetchProviders: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock('../stores/templates.js', () => ({
  useTemplatesStore: vi.fn(() => ({
    templates: [],
    projectTemplates: [],
    globalTemplates: [],
    fetchTemplates: vi.fn().mockResolvedValue(undefined),
    fetchProjectTemplates: vi.fn().mockResolvedValue(undefined),
    getTemplateById: vi.fn(() => null),
  })),
}));

vi.mock('../composables/useConnectionStatus.js', async () => {
  const { ref } = await import('vue');
  return { useConnectionStatus: () => ({ isStale: ref(false), connectionStatus: ref('connected'), reconnectAttempt: ref(0) }) };
});

vi.mock('../composables/useWebSocket.js', () => ({
  useSessionSubscription: vi.fn(() => ({
    onPartial: vi.fn(() => vi.fn()),
    onMessage: vi.fn(() => vi.fn()),
    onWorkLog: vi.fn(() => vi.fn()),
    onWorkLogsAssociated: vi.fn(() => vi.fn()),
    onThinkingPartial: vi.fn(() => vi.fn()),
    onConversationCreated: vi.fn(() => vi.fn()),
    onConversationUpdated: vi.fn(() => vi.fn()),
    onConversationDeleted: vi.fn(() => vi.fn()),
    onUsageUpdate: vi.fn(() => vi.fn()),
  })),
}));

vi.mock('../composables/useApi.js', () => ({
  api: { updateSessionPendingPrompt: vi.fn().mockResolvedValue() },
}));

vi.mock('../composables/useSubmitShortcut.js', () => ({
  useSubmitShortcut: vi.fn(() => vi.fn()),
}));

vi.mock('./ModelSelector.vue', () => ({
  default: {
    name: 'ModelSelector',
    props: ['modelValue', 'disabled'],
    emits: ['update:modelValue'],
    template: '<div class="model-selector-stub" :data-model="modelValue"></div>',
  },
}));

vi.mock('./FileAttachment.vue', () => ({
  default: { name: 'FileAttachment', emits: ['update:files'], template: '<div class="file-attachment"></div>', methods: { clear: vi.fn() } },
}));

// SchedulingInfo.vue is intentionally NOT mocked here — that's the point of this file.

import ConversationTab from './ConversationTab.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';

describe('ConversationTab + real SchedulingInfo: cross-component schedule coordination', () => {
  let mockSessionsStore;
  let mockUiStore;
  let scheduleMutations;
  let consoleError;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    scheduleMutations = reactive({});

    mockSessionsStore = {
      messages: [],
      currentSession: {
        id: 'sess-123',
        status: 'scheduled',
        thinkingEnabled: false,
        mode: 'standard',
        model: null,
        projectId: 'proj-1',
        scheduledAt: Date.now() + 3600000,
        pendingPrompt: 'Hello from schedule',
        autoRescheduleEnabled: false,
        rescheduleCount: 0,
        maxRescheduleCount: null,
      },
      activeConversation: { id: 'conv-1', name: 'Test Conv' },
      activeConversationId: 'conv-1',
      conversations: [{ id: 'conv-1', name: 'Test Conv', isActive: true }],
      getWorkLogsForMessage: vi.fn().mockReturnValue([]),
      getUnassociatedWorkLogs: [],
      partialThinking: null,
      isDraftSession: vi.fn().mockReturnValue(false),
      isScheduledDraft: vi.fn().mockReturnValue(false),
      hasRecentSend: vi.fn().mockReturnValue(false),
      fetchConversations: vi.fn().mockResolvedValue([]),
      fetchWorkLogs: vi.fn().mockResolvedValue([]),
      fetchMessages: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(),
      stopSession: vi.fn().mockResolvedValue(),
      restartSession: vi.fn().mockResolvedValue(),
      startSession: vi.fn().mockResolvedValue(),
      updateSessionThinking: vi.fn().mockResolvedValue(),
      updateSessionMode: vi.fn().mockResolvedValue(),
      updateSessionModel: vi.fn().mockResolvedValue(),
      updateNextTemplate: vi.fn().mockResolvedValue(),
      updateSessionFields: vi.fn().mockResolvedValue({}),
      addWorkLog: vi.fn(),
      associateWorkLogs: vi.fn(),
      clearWorkLogs: vi.fn(),
      clearConversations: vi.fn(),
      addConversation: vi.fn(),
      updateConversation: vi.fn(),
      removeConversation: vi.fn(),
      setPartialThinking: vi.fn(),
      clearPartialThinking: vi.fn(),
      finalizeUsage: vi.fn(),
      updateRunningUsage: vi.fn(),
      switchConversation: vi.fn().mockResolvedValue(),
      branchConversation: vi.fn().mockResolvedValue({ id: 'conv-2' }),
      runScheduledNow: vi.fn().mockImplementation(async (id) => {
        const result = { id, status: 'starting', scheduledAt: null, pendingPrompt: null };
        if (mockSessionsStore.currentSession?.id === id) Object.assign(mockSessionsStore.currentSession, result);
        return result;
      }),
      scheduleMutationInFlight: (id) => scheduleMutations[id] || null,
      beginScheduleMutation: (id, kind) => {
        if (scheduleMutations[id]) return false;
        scheduleMutations[id] = kind;
        return true;
      },
      endScheduleMutation: (id) => { delete scheduleMutations[id]; },
    };

    mockUiStore = { error: vi.fn(), success: vi.fn() };

    vi.mocked(useSessionsStore).mockReturnValue(mockSessionsStore);
    vi.mocked(useUiStore).mockReturnValue(mockUiStore);

    consoleError = console.error;
    console.error = vi.fn();

    vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn(), removeItem: vi.fn() });
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  });

  afterEach(() => {
    console.error = consoleError;
    vi.unstubAllGlobals();
  });

  function mountComponent(props = { sessionId: 'sess-123' }) {
    return mount(ConversationTab, {
      props,
      global: {
        stubs: {
          ConversationPanel: { template: '<div class="conversation-panel-stub"></div>' },
          TodoDrawer: { template: '<div class="todo-drawer-stub"></div>' },
          WorkLogPanel: { template: '<div class="work-log-panel-stub"></div>' },
          LiveWorkLogPanel: { template: '<div class="live-work-log-panel-stub"></div>' },
          MarkdownViewer: { template: '<div class="markdown-stub"><slot /></div>' },
          QuickResponsesPanel: { template: '<div class="quick-responses-panel-stub"></div>' },
          QuickResponseSettings: { template: '<div class="quick-response-settings-stub"></div>' },
          TokenCostPanel: { template: '<div class="token-cost-panel-stub"></div>' },
          OrchestrationPanel: { template: '<div class="orchestration-panel-stub"></div>' },
          ModeSelector: { template: '<div class="mode-selector-stub"></div>' },
          SlashCommandButton: { template: '<div class="slash-command-button-stub"></div>' },
          SlashCommandWizard: { template: '<div class="slash-command-wizard-stub"></div>' },
          ScheduleSessionModal: { template: '<div class="schedule-session-modal-stub"></div>' },
          AutoRescheduleModal: { template: '<div class="auto-reschedule-modal-stub"></div>' },
          SchedulingEditModal: { template: '<div class="scheduling-edit-modal-stub"></div>' },
        },
      },
    });
  }

  async function flushAll(wrapper) {
    await flushPromises();
    await nextTick();
    await wrapper.vm.$nextTick?.();
  }

  it('renders the real SchedulingInfo alongside the prompt submit button for a scheduled session', async () => {
    const wrapper = mountComponent();
    await flushAll(wrapper);

    expect(wrapper.findComponent({ name: 'SchedulingInfo' }).exists()).toBe(true);
    expect(wrapper.find('[data-testid="scheduled-start-now-btn"]').exists()).toBe(true);
    expect(wrapper.find('.btn-send-full').exists()).toBe(true);
  });

  it('clicking SchedulingInfo\'s Start Now disables the InputForm submit button (shared in-flight state)', async () => {
    let resolveStart;
    mockSessionsStore.runScheduledNow.mockImplementation(() => new Promise((resolve) => { resolveStart = resolve; }));

    const wrapper = mountComponent();
    await flushAll(wrapper);

    const schedulingStartBtn = wrapper.find('[data-testid="scheduled-start-now-btn"]');
    const submitBtn = wrapper.find('.btn-send-full');
    expect(submitBtn.attributes('disabled')).toBeUndefined();

    await schedulingStartBtn.trigger('click');
    await flushAll(wrapper);

    expect(wrapper.find('.btn-send-full').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="scheduled-start-now-btn"]').text()).toBe('Starting...');

    resolveStart({ id: 'sess-123', status: 'starting', scheduledAt: null, pendingPrompt: null });
    await flushAll(wrapper);

    expect(wrapper.find('.btn-send-full').attributes('disabled')).toBeUndefined();
  });

  it('clicking SchedulingInfo\'s Cancel disables the InputForm submit button too', async () => {
    let resolveCancel;
    mockSessionsStore.updateSessionFields.mockImplementation(() => new Promise((resolve) => { resolveCancel = resolve; }));

    const wrapper = mountComponent();
    await flushAll(wrapper);

    const cancelBtn = wrapper.find('[data-testid="scheduled-cancel-btn"]');
    const submitBtn = wrapper.find('.btn-send-full');
    expect(submitBtn.attributes('disabled')).toBeUndefined();

    await cancelBtn.trigger('click');
    await flushAll(wrapper);

    expect(wrapper.find('.btn-send-full').attributes('disabled')).toBeDefined();

    resolveCancel({});
    await flushAll(wrapper);

    expect(wrapper.find('.btn-send-full').attributes('disabled')).toBeUndefined();
  });

  it('submitting the prompt form disables SchedulingInfo\'s Start Now/Edit/Cancel buttons too', async () => {
    let resolveStart;
    mockSessionsStore.runScheduledNow.mockImplementation(() => new Promise((resolve) => { resolveStart = resolve; }));

    const wrapper = mountComponent();
    await flushAll(wrapper);

    await wrapper.find('form').trigger('submit.prevent');
    await flushAll(wrapper);

    expect(wrapper.find('[data-testid="scheduled-start-now-btn"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="scheduled-edit-btn"]').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-testid="scheduled-cancel-btn"]').attributes('disabled')).toBeDefined();

    resolveStart({ id: 'sess-123', status: 'starting', scheduledAt: null, pendingPrompt: null });
    await flushAll(wrapper);

    expect(wrapper.find('[data-testid="scheduled-start-now-btn"]').attributes('disabled')).toBeUndefined();
  });

  it('rapid cross-control clicks (submit form, then SchedulingInfo Start Now) only launch once', async () => {
    let resolveStart;
    mockSessionsStore.runScheduledNow.mockImplementation(() => new Promise((resolve) => { resolveStart = resolve; }));

    const wrapper = mountComponent();
    await flushAll(wrapper);

    const formSubmit = wrapper.find('form').trigger('submit.prevent');
    const schedulingClick = wrapper.find('[data-testid="scheduled-start-now-btn"]').trigger('click');
    await Promise.all([formSubmit, schedulingClick]);
    await flushAll(wrapper);

    expect(mockSessionsStore.runScheduledNow).toHaveBeenCalledTimes(1);
    resolveStart({ id: 'sess-123', status: 'starting' });
  });
});
