import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, reactive } from 'vue';

/**
 * Tests for model initialization in ConversationTab
 *
 * BUG: When activeConversation is null/undefined (e.g., on initial load or when
 * switching to a new conversation), the selectedModel ref stays null because
 * the watcher only runs when `conv` is truthy.
 *
 * See ConversationTab.vue lines 863-876:
 *
 *   watch(
 *     () => sessionsStore.activeConversation,
 *     (conv) => {
 *       if (conv) {  // <-- BUG: Does nothing when conv is null/undefined
 *         selectedModel.value = session.model || projectDefault || 'sonnet';
 *       }
 *     },
 *     { immediate: true }
 *   );
 *
 * This causes ModelSelector to show no model selected, even though we have
 * a fallback chain that should always produce a value.
 */

// Mock vue-router
vi.mock('vue-router', () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn().mockResolvedValue(undefined),
  })),
  useRoute: vi.fn(() => ({
    query: {},
    params: {},
  })),
}));

// Mock the sessions store
vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(),
}));

// Mock the ui store
vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(() => ({
    error: vi.fn(),
    success: vi.fn(),
  })),
}));

// Mock the projects store
vi.mock('../stores/projects.js', () => ({
  useProjectsStore: vi.fn(() => ({
    currentProject: null,
    fetchProject: vi.fn().mockResolvedValue(undefined),
    getProjectById: vi.fn().mockReturnValue(null),
  })),
}));

// Mock the providers store with models
vi.mock('../stores/providers.js', () => ({
  useProvidersStore: vi.fn(() => ({
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        isBuiltIn: true,
        models: [
          { id: 'haiku', modelId: 'haiku', displayName: 'Haiku', tier: 'haiku' },
          { id: 'sonnet', modelId: 'sonnet', displayName: 'Sonnet', tier: 'sonnet' },
          { id: 'opus', modelId: 'opus', displayName: 'Opus', tier: 'opus' },
        ],
      },
    ],
    fetchProviders: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Mock the quick responses store
vi.mock('../stores/quickResponses.js', () => ({
  useQuickResponsesStore: vi.fn(() => ({
    fetchForProject: vi.fn(),
  })),
}));

// Mock the templates store
vi.mock('../stores/templates.js', () => ({
  useTemplatesStore: vi.fn(() => ({
    templates: [],
    fetchTemplates: vi.fn().mockResolvedValue(undefined),
    getTemplateById: vi.fn(() => null),
  })),
}));

// Mock the project defaults store
vi.mock('../stores/projectDefaults.js', () => ({
  useProjectDefaultsStore: vi.fn(() => ({
    getDefaultsForProject: vi.fn(() => null),
  })),
}));

// Mock WebSocket composable
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

// Mock API composable
vi.mock('../composables/useApi.js', () => ({
  api: {
    updateSessionPendingPrompt: vi.fn().mockResolvedValue(),
  },
}));

// Mock submit shortcut composable
vi.mock('../composables/useSubmitShortcut.js', () => ({
  useSubmitShortcut: vi.fn(() => vi.fn()),
}));

import ConversationTab from './ConversationTab.vue';
import ModelSelector from './ModelSelector.vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useUiStore } from '../stores/ui.js';
import { useProjectDefaultsStore } from '../stores/projectDefaults.js';

describe('ConversationTab - Model Initialization Bug', () => {
  let mockSessionsStore;
  let mockDefaultsStore;
  let consoleError;
  let consoleLog;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Use reactive() so Vue watchers can detect changes
    mockSessionsStore = reactive({
      messages: [],
      currentSession: { id: 'sess-123', status: 'waiting', thinkingEnabled: false, mode: 'standard', projectId: 'proj-1', model: null },
      activeConversation: null, // BUG TRIGGER: null conversation
      activeConversationId: null,
      conversations: [],
      getWorkLogsForMessage: vi.fn().mockReturnValue([]),
      getUnassociatedWorkLogs: [],
      partialThinking: null,
      isDraftSession: vi.fn().mockReturnValue(false),
      isScheduledDraft: vi.fn().mockReturnValue(false),
      fetchConversations: vi.fn().mockResolvedValue([]),
      fetchWorkLogs: vi.fn().mockResolvedValue([]),
      fetchMessages: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn().mockResolvedValue(),
      stopSession: vi.fn().mockResolvedValue(),
      restartSession: vi.fn().mockResolvedValue(),
      startSession: vi.fn().mockResolvedValue(),
      updateSessionThinking: vi.fn().mockResolvedValue(),
      updateSessionMode: vi.fn().mockResolvedValue(),
      updateNextTemplate: vi.fn().mockResolvedValue(),
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
    });

    mockDefaultsStore = {
      getDefaultsForProject: vi.fn(() => null),
    };

    vi.mocked(useSessionsStore).mockReturnValue(mockSessionsStore);
    vi.mocked(useProjectDefaultsStore).mockReturnValue(mockDefaultsStore);

    // Suppress console noise
    consoleError = console.error;
    consoleLog = console.log;
    console.error = vi.fn();
    console.log = vi.fn();

    vi.stubGlobal('localStorage', {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    console.error = consoleError;
    console.log = consoleLog;
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
          FileAttachment: { template: '<div class="file-attachment-stub"></div>', methods: { clear: vi.fn() } },
          TokenCostPanel: { template: '<div class="token-cost-panel-stub"></div>' },
          QuickResponsesPanel: { template: '<div class="quick-responses-panel-stub"></div>' },
          QuickResponseSettings: { template: '<div class="quick-response-settings-stub"></div>' },
          ModeSelector: { template: '<div class="mode-selector-stub"></div>' },
          TemplateSelector: { template: '<div class="template-selector-stub"></div>' },
          OrchestrationPanel: { template: '<div class="orchestration-panel-stub"></div>' },
          ResizableTextarea: {
            template: '<textarea class="resizable-textarea"></textarea>',
            props: ['modelValue', 'minHeight', 'placeholder'],
            mounted() {
              // Expose value getter/setter like the real ResizableTextarea
              // ConversationTab.handleFormSubmit accesses textareaRef.value to read and clear
              const ta = this.$el;
              Object.defineProperty(this, 'value', {
                get() { return ta?.value || ''; },
                set(val) { if (ta) ta.value = val; },
              });
              Object.defineProperty(this, 'focus', { value: () => ta?.focus() });
              Object.defineProperty(this, 'blur', { value: () => ta?.blur() });
              Object.defineProperty(this, 'select', { value: () => ta?.select() });
            },
          },
          BranchEditor: { template: '<div class="branch-editor-stub"></div>' },
          ScheduleSessionModal: { template: '<div class="schedule-session-modal-stub"></div>' },
          AutoRescheduleModal: { template: '<div class="auto-reschedule-modal-stub"></div>' },
          SlashCommandButton: { template: '<div class="slash-command-button-stub"></div>' },
          SlashCommandWizard: { template: '<div class="slash-command-wizard-stub"></div>' },
          // Don't stub ModelSelector - we want to test its props
        },
      },
    });
  }

  async function flushAll(wrapper) {
    await flushPromises();
    await nextTick();
    if (wrapper?.vm?.$nextTick) {
      await wrapper.vm.$nextTick();
    }
  }

  describe('BUG: selectedModel is null when activeConversation is null', () => {
    /**
     * This test surfaces the bug where ModelSelector shows no model selected
     * when there's no active conversation.
     *
     * The component has:
     *   const selectedModel = ref(null);
     *   watch(() => sessionsStore.activeConversation, (conv) => {
     *     if (conv) { selectedModel.value = ... }
     *   }, { immediate: true });
     *
     * When conv is null, the watcher does nothing and selectedModel stays null.
     */
    it('should have a model selected even when activeConversation is null', async () => {
      // Setup: No active conversation (common on initial load)
      mockSessionsStore.activeConversation = null;
      mockSessionsStore.activeConversationId = null;
      mockSessionsStore.conversations = [];
      mockSessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        model: null, // Session also has no model
        projectId: 'proj-1',
        mode: 'standard',
      };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Find ModelSelector and check its modelValue prop
      const modelSelector = wrapper.findComponent(ModelSelector);
      expect(modelSelector.exists()).toBe(true);

      // BUG: This will FAIL because modelValue is null
      // Expected: 'sonnet' (system default)
      // Actual: null
      const modelValue = modelSelector.props('modelValue');
      expect(modelValue).not.toBeNull();
      expect(modelValue).toBe('sonnet');
    });

    it('should use session model as fallback when conversation has no model', async () => {
      // Setup: Conversation exists but has no model, session has a model
      mockSessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        model: 'opus', // Session has opus configured
        projectId: 'proj-1',
        mode: 'standard',
      };
      mockSessionsStore.activeConversation = {
        id: 'conv-1',
        sessionId: 'sess-123',
        model: null, // Conversation has no model
        isActive: true,
      };
      mockSessionsStore.activeConversationId = 'conv-1';

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const modelSelector = wrapper.findComponent(ModelSelector);
      const modelValue = modelSelector.props('modelValue');

      // Should fall back to session model
      expect(modelValue).toBe('opus');
    });

    it('should use project default model when session and conversation have no model', async () => {
      // Setup: Neither conversation nor session has a model, but project has a default
      mockDefaultsStore.getDefaultsForProject.mockReturnValue({
        model: 'haiku',
        mode: 'standard',
      });

      mockSessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        model: null,
        projectId: 'proj-1',
        mode: 'standard',
      };
      mockSessionsStore.activeConversation = {
        id: 'conv-1',
        sessionId: 'sess-123',
        model: null,
        isActive: true,
      };
      mockSessionsStore.activeConversationId = 'conv-1';

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const modelSelector = wrapper.findComponent(ModelSelector);
      const modelValue = modelSelector.props('modelValue');

      // Should fall back to project default
      expect(modelValue).toBe('haiku');
    });

    it('should default to sonnet when no model is set anywhere', async () => {
      // Setup: No model set anywhere - conversation, session, or project defaults
      mockDefaultsStore.getDefaultsForProject.mockReturnValue(null);

      mockSessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        model: null,
        projectId: 'proj-1',
        mode: 'standard',
      };
      mockSessionsStore.activeConversation = {
        id: 'conv-1',
        sessionId: 'sess-123',
        model: null,
        isActive: true,
      };
      mockSessionsStore.activeConversationId = 'conv-1';

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const modelSelector = wrapper.findComponent(ModelSelector);
      const modelValue = modelSelector.props('modelValue');

      // Should fall back to system default (sonnet)
      expect(modelValue).toBe('sonnet');
    });
  });

  describe('Draft handleFormSubmit uses selectedModel.value over pendingModel', () => {
    /**
     * This test surfaces the bug where handleFormSubmit() for draft sessions
     * reads from session.pendingModel instead of selectedModel.value (the UI dropdown).
     *
     * Scenario:
     * 1. Session created with model 'claude-sonnet-4-20250514' (stored as both model and pendingModel)
     * 2. User changes dropdown to 'claude-opus-4-6-20250616'
     * 3. handleFormSubmit() should send 'claude-opus-4-6-20250616', not 'claude-sonnet-4-20250514'
     *
     * BUG (before fix): handleFormSubmit used session.pendingModel || session.model,
     * ignoring the dropdown state entirely.
     */
    it('should use the dropdown model when user changes it, not the stale pendingModel', async () => {
      // Setup: Draft session with sonnet as both model and pendingModel
      mockSessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        model: 'sonnet',
        pendingModel: 'sonnet',
        projectId: 'proj-1',
        mode: 'standard',
      };
      mockSessionsStore.activeConversation = {
        id: 'conv-1',
        sessionId: 'sess-123',
        isActive: true,
      };
      mockSessionsStore.activeConversationId = 'conv-1';
      // Mark session as draft so handleFormSubmit() takes the draft path
      mockSessionsStore.isDraftSession = vi.fn().mockReturnValue(true);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Model selector should be initialized to sonnet
      const modelSelector = wrapper.findComponent(ModelSelector);
      expect(modelSelector.exists()).toBe(true);
      expect(modelSelector.props('modelValue')).toBe('sonnet');

      // Simulate user changing the dropdown to opus
      modelSelector.vm.$emit('update:modelValue', 'opus');
      await flushAll(wrapper);

      // Type a message and submit
      const textarea = wrapper.find('textarea');
      await textarea.setValue('Test prompt');
      await flushAll(wrapper);

      await wrapper.find('form').trigger('submit.prevent');
      await flushAll(wrapper);

      // startSession should receive the dropdown model ('opus'), not the stale pendingModel ('sonnet')
      expect(mockSessionsStore.startSession).toHaveBeenCalledWith(
        'sess-123',
        'Test prompt',
        'opus'
      );
    });
  });

  describe('Model selection when sending messages', () => {
    it('should send message with a valid model even when activeConversation is null', async () => {
      // Setup: No active conversation
      mockSessionsStore.activeConversation = null;
      mockSessionsStore.activeConversationId = null;
      mockSessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        model: null,
        projectId: 'proj-1',
        mode: 'standard',
      };

      const wrapper = mountComponent();
      await flushAll(wrapper);

      // Type a message
      const textarea = wrapper.find('textarea');
      await textarea.setValue('Test message');
      await flushAll(wrapper);

      // Submit the form
      await wrapper.find('form').trigger('submit.prevent');
      await flushAll(wrapper);

      // BUG: sendMessage is called with null model
      // Expected: called with 'sonnet' (system default)
      expect(mockSessionsStore.sendMessage).toHaveBeenCalledWith(
        'sess-123',
        'Test message',
        [], // attachments
        'sonnet' // model - should NOT be null
      );
    });
  });

  describe('Draft session input clearing on start', () => {
    it('should clear textarea when draft session starts successfully', async () => {
      mockSessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        model: 'sonnet',
        pendingModel: 'sonnet',
        projectId: 'proj-1',
        mode: 'standard',
      };
      mockSessionsStore.activeConversation = {
        id: 'conv-1',
        sessionId: 'sess-123',
        isActive: true,
      };
      mockSessionsStore.activeConversationId = 'conv-1';
      mockSessionsStore.isDraftSession = vi.fn().mockReturnValue(true);
      mockSessionsStore.startSession.mockResolvedValue(undefined);

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const textarea = wrapper.find('textarea');
      await textarea.setValue('My initial prompt');
      await flushAll(wrapper);

      await wrapper.find('form').trigger('submit.prevent');
      await flushAll(wrapper);

      // Textarea should be cleared after successful start
      expect(textarea.element.value).toBe('');
    });

    it('should not clear textarea when draft session fails to start', async () => {
      mockSessionsStore.currentSession = {
        id: 'sess-123',
        status: 'waiting',
        model: 'sonnet',
        pendingModel: 'sonnet',
        projectId: 'proj-1',
        mode: 'standard',
      };
      mockSessionsStore.activeConversation = {
        id: 'conv-1',
        sessionId: 'sess-123',
        isActive: true,
      };
      mockSessionsStore.activeConversationId = 'conv-1';
      mockSessionsStore.isDraftSession = vi.fn().mockReturnValue(true);
      mockSessionsStore.startSession.mockRejectedValue(new Error('Start failed'));

      const wrapper = mountComponent();
      await flushAll(wrapper);

      const textarea = wrapper.find('textarea');
      await textarea.setValue('My initial prompt');
      await flushAll(wrapper);

      await wrapper.find('form').trigger('submit.prevent');
      await flushAll(wrapper);

      // Textarea should NOT be cleared when start fails - user's input is preserved
      expect(textarea.element.value).toBe('My initial prompt');
    });
  });
});
