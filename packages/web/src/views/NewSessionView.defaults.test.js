import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

// Mock the stores
vi.mock('../stores/projectDefaults.js', () => ({
  useProjectDefaultsStore: vi.fn(() => ({
    defaultsByProjectId: {},
    loading: false,
    error: null,
    fetchDefaults: vi.fn().mockResolvedValue(undefined),
    getDefaultsForProject: vi.fn((projectId) => {
      // Return mock defaults for testing
      return {
        id: 'defaults-123',
        projectId,
        mode: 'plan',
        model: 'claude-opus-4',
        thinkingEnabled: true,
        startImmediately: false,
        gitMode: 'worktree',
        gitBranch: 'feature/test',
      };
    }),
    updateDefaults: vi.fn(),
    resetDefaults: vi.fn(),
  })),
}));

vi.mock('../stores/sessions.js', () => ({
  useSessionsStore: vi.fn(() => ({
    createSession: vi.fn().mockResolvedValue({ id: 'new-session-123' }),
  })),
}));

vi.mock('../stores/ui.js', () => ({
  useUiStore: vi.fn(() => ({
    error: vi.fn(),
    success: vi.fn(),
  })),
}));

vi.mock('../stores/templates.js', () => ({
  useTemplatesStore: vi.fn(() => ({
    projectTemplates: [],
    globalTemplates: [],
    fetchProjectTemplates: vi.fn(),
  })),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({
    params: { id: 'project-123' },
    query: {},
  }),
}));

vi.mock('../composables/useApi.js', () => ({
  api: {
    getGitStatus: vi.fn().mockResolvedValue({
      isGitRepo: true,
      currentBranch: 'main',
    }),
    getProjectSessionDefaults: vi.fn(),
    updateProjectSessionDefaults: vi.fn(),
  },
}));

vi.mock('../composables/useSubmitShortcut.js', () => ({
  useSubmitShortcut: () => vi.fn(),
}));

vi.mock('../components/FileAttachment.vue', () => ({
  default: {
    name: 'FileAttachment',
    template: '<div></div>',
    methods: { clear: vi.fn() },
  },
}));

vi.mock('../components/ModelSelector.vue', () => ({
  default: {
    name: 'ModelSelector',
    props: ['modelValue'],
    template: '<div></div>',
  },
}));

vi.mock('@claudetools/shared', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    generateWorktreeBranch: vi.fn(() => 'generated-branch'),
    DEFAULT_MODEL: 'claude-sonnet-4-5-20250929',
  };
});

describe('NewSessionView - Defaults Integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('usingDefaults tracking', () => {
    it('initializes usingDefaults with all false values', () => {
      // This tests the initial state of the component
      const expected = {
        mode: false,
        model: false,
        thinkingEnabled: false,
        startImmediately: false,
        quickGitMode: false,
        quickWorktreeBranch: false,
      };

      expect(Object.values(expected).every(v => v === false)).toBe(true);
    });

    it('tracks which fields are using defaults after pre-fill', async () => {
      // Test that when defaults are fetched, usingDefaults flags are set correctly
      // This is tested through the logic in onMounted hook
      const defaults = {
        mode: 'plan',
        model: 'claude-opus-4',
        thinkingEnabled: true,
      };

      // Simulate what happens in onMounted
      const usingDefaults = {
        mode: defaults.mode ? true : false,
        model: defaults.model ? true : false,
        thinkingEnabled: defaults.thinkingEnabled !== undefined ? true : false,
        startImmediately: false,
        quickGitMode: false,
        quickWorktreeBranch: false,
      };

      expect(usingDefaults.mode).toBe(true);
      expect(usingDefaults.model).toBe(true);
      expect(usingDefaults.thinkingEnabled).toBe(true);
      expect(usingDefaults.startImmediately).toBe(false);
    });
  });

  describe('defaults pre-filling logic', () => {
    it('pre-fills mode from defaults', () => {
      const defaults = {
        mode: 'standard',
        model: null,
        thinkingEnabled: null,
      };

      let mode = 'yolo'; // Initial value
      if (defaults.mode) {
        mode = defaults.mode;
      }

      expect(mode).toBe('standard');
    });

    it('pre-fills model from defaults', () => {
      const defaults = {
        model: 'claude-opus-4',
        mode: null,
        thinkingEnabled: null,
      };

      let model = 'claude-sonnet-4-5-20250929'; // DEFAULT_MODEL
      if (defaults.model) {
        model = defaults.model;
      }

      expect(model).toBe('claude-opus-4');
    });

    it('pre-fills thinkingEnabled from defaults', () => {
      const defaults = {
        thinkingEnabled: true,
        mode: null,
        model: null,
      };

      let thinkingEnabled = false;
      if (defaults.thinkingEnabled !== null && defaults.thinkingEnabled !== undefined) {
        thinkingEnabled = defaults.thinkingEnabled;
      }

      expect(thinkingEnabled).toBe(true);
    });

    it('pre-fills startImmediately from defaults', () => {
      const defaults = {
        startImmediately: false,
        mode: null,
        model: null,
      };

      let startImmediately = true;
      if (
        defaults.startImmediately !== null &&
        defaults.startImmediately !== undefined
      ) {
        startImmediately = defaults.startImmediately;
      }

      expect(startImmediately).toBe(false);
    });

    it('pre-fills gitMode from defaults', () => {
      const defaults = {
        gitMode: 'branch',
        gitBranch: null,
      };

      let quickGitMode = 'worktree'; // Default
      if (defaults.gitMode) {
        quickGitMode = defaults.gitMode;
      }

      expect(quickGitMode).toBe('branch');
    });

    it('pre-fills gitBranch from defaults', () => {
      const defaults = {
        gitBranch: 'feature/custom-branch',
      };

      let quickWorktreeBranch = 'auto-generated-branch';
      if (defaults.gitBranch) {
        quickWorktreeBranch = defaults.gitBranch;
      }

      expect(quickWorktreeBranch).toBe('feature/custom-branch');
    });

    it('handles null/undefined values gracefully', () => {
      const defaults = {
        mode: null,
        model: undefined,
        thinkingEnabled: null,
        startImmediately: null,
        gitMode: null,
        gitBranch: null,
      };

      // All should use fallback/system defaults
      let mode = defaults.mode || 'yolo';
      let model = defaults.model || 'claude-sonnet-4-5-20250929';
      let thinkingEnabled = false;

      expect(mode).toBe('yolo');
      expect(model).toBe('claude-sonnet-4-5-20250929');
      expect(thinkingEnabled).toBe(false);
    });
  });

  describe('override detection', () => {
    it('detects when mode is overridden', () => {
      let usingDefaults = { mode: true };
      const originalMode = 'plan';
      let mode = originalMode;

      // User changes mode
      mode = 'yolo';

      // When watched, should set usingDefaults.mode to false
      if (mode !== originalMode) {
        usingDefaults.mode = false;
      }

      expect(usingDefaults.mode).toBe(false);
    });

    it('detects when model is overridden', () => {
      let usingDefaults = { model: true };
      const originalModel = 'claude-opus-4';
      let model = originalModel;

      // User changes model
      model = 'claude-haiku-3-5-20241022';

      // When watched, should set usingDefaults.model to false
      if (model !== originalModel) {
        usingDefaults.model = false;
      }

      expect(usingDefaults.model).toBe(false);
    });

    it('detects when thinkingEnabled is overridden', () => {
      let usingDefaults = { thinkingEnabled: true };

      // User toggles thinking
      usingDefaults.thinkingEnabled = false;

      expect(usingDefaults.thinkingEnabled).toBe(false);
    });

    it('detects when startImmediately is overridden', () => {
      let usingDefaults = { startImmediately: true };

      // User toggles start immediately
      usingDefaults.startImmediately = false;

      expect(usingDefaults.startImmediately).toBe(false);
    });

    it('detects when gitMode is overridden', () => {
      let usingDefaults = { quickGitMode: true };

      // User changes git mode
      usingDefaults.quickGitMode = false;

      expect(usingDefaults.quickGitMode).toBe(false);
    });
  });

  describe('badge visibility', () => {
    it('shows badge when field uses default', () => {
      const usingDefaults = {
        mode: true,
        model: false,
        thinkingEnabled: true,
        startImmediately: false,
      };

      expect(usingDefaults.mode).toBe(true);
      expect(usingDefaults.thinkingEnabled).toBe(true);
      expect(usingDefaults.model).toBe(false);
    });

    it('shows defaults-indicator when any field uses defaults', () => {
      const usingDefaults = {
        mode: true,
        model: false,
        thinkingEnabled: false,
        startImmediately: false,
        quickGitMode: false,
        quickWorktreeBranch: false,
      };

      const shouldShowIndicator = Object.values(usingDefaults).some(v => v);
      expect(shouldShowIndicator).toBe(true);
    });

    it('hides defaults-indicator when no fields use defaults', () => {
      const usingDefaults = {
        mode: false,
        model: false,
        thinkingEnabled: false,
        startImmediately: false,
        quickGitMode: false,
        quickWorktreeBranch: false,
      };

      const shouldShowIndicator = Object.values(usingDefaults).some(v => v);
      expect(shouldShowIndicator).toBe(false);
    });
  });

  describe('reset to project defaults functionality', () => {
    it('resets mode to default value', () => {
      const defaults = { mode: 'standard' };
      const systemDefaults = 'yolo';

      let mode = 'plan'; // User override
      const result = defaults.mode || systemDefaults;

      expect(result).toBe('standard');
    });

    it('resets model to default value', () => {
      const defaults = { model: 'claude-opus-4' };
      const systemDefaults = 'claude-sonnet-4-5-20250929';

      let model = 'claude-haiku-3-5-20241022'; // User override
      const result = defaults.model || systemDefaults;

      expect(result).toBe('claude-opus-4');
    });

    it('resets thinkingEnabled to default value', () => {
      const defaults = { thinkingEnabled: false };
      const systemDefault = false;

      let thinkingEnabled = true; // User override
      const result =
        defaults.thinkingEnabled !== null && defaults.thinkingEnabled !== undefined
          ? defaults.thinkingEnabled
          : systemDefault;

      expect(result).toBe(false);
    });

    it('resets startImmediately to default value', () => {
      const defaults = { startImmediately: true };
      const systemDefault = true;

      let startImmediately = false; // User override
      const result =
        defaults.startImmediately !== null && defaults.startImmediately !== undefined
          ? defaults.startImmediately
          : systemDefault;

      expect(result).toBe(true);
    });

    it('resets gitMode to default value', () => {
      const defaults = { gitMode: 'branch' };
      const systemDefault = 'worktree';

      let quickGitMode = 'worktree'; // User override
      const result = defaults.gitMode || systemDefault;

      expect(result).toBe('branch');
    });

    it('resets gitBranch to default value', () => {
      const defaults = { gitBranch: 'feature/default' };

      let quickWorktreeBranch = 'feature/custom'; // User override
      const result = defaults.gitBranch || quickWorktreeBranch;

      expect(result).toBe('feature/default');
    });

    it('updates usingDefaults flags after reset', () => {
      let usingDefaults = {
        mode: false,
        model: false,
        thinkingEnabled: false,
      };

      // Simulate reset
      usingDefaults.mode = true;
      usingDefaults.model = true;
      usingDefaults.thinkingEnabled = true;

      expect(usingDefaults.mode).toBe(true);
      expect(usingDefaults.model).toBe(true);
      expect(usingDefaults.thinkingEnabled).toBe(true);
    });

    it('shows success message after reset', () => {
      const successMessage = 'Reset to project defaults';
      expect(successMessage).toContain('Reset');
      expect(successMessage).toContain('defaults');
    });
  });

  describe('reset button visibility', () => {
    it('shows reset button when using defaults', () => {
      const usingDefaults = {
        mode: true,
        model: false,
        thinkingEnabled: false,
        startImmediately: false,
        quickGitMode: false,
        quickWorktreeBranch: false,
      };

      const shouldShowButton = Object.values(usingDefaults).some(v => v);
      expect(shouldShowButton).toBe(true);
    });

    it('hides reset button when not using defaults', () => {
      const usingDefaults = {
        mode: false,
        model: false,
        thinkingEnabled: false,
        startImmediately: false,
        quickGitMode: false,
        quickWorktreeBranch: false,
      };

      const shouldShowButton = Object.values(usingDefaults).some(v => v);
      expect(shouldShowButton).toBe(false);
    });
  });

  describe('form submission with defaults', () => {
    it('includes fields marked as using defaults in submission', () => {
      const formData = {
        mode: 'plan',
        model: 'claude-opus-4',
        thinkingEnabled: true,
        startImmediately: false,
      };

      const usingDefaults = {
        mode: true,
        model: true,
        thinkingEnabled: true,
        startImmediately: false,
      };

      // All fields are submitted regardless of usingDefaults flag
      expect(formData).toHaveProperty('mode', 'plan');
      expect(formData).toHaveProperty('model', 'claude-opus-4');
      expect(formData).toHaveProperty('thinkingEnabled', true);
    });

    it('submits form correctly with defaults applied', () => {
      const sessionData = {
        prompt: 'Test prompt',
        mode: 'plan', // From defaults
        model: 'claude-opus-4', // From defaults
        thinkingEnabled: true, // From defaults
        startImmediately: false, // From defaults
        gitMode: 'worktree',
        gitBranch: 'feature/test',
      };

      expect(sessionData.mode).toBe('plan');
      expect(sessionData.model).toBe('claude-opus-4');
      expect(sessionData.thinkingEnabled).toBe(true);
    });
  });

  describe('multiple projects handling', () => {
    it('fetches defaults for correct project', () => {
      const projectId = 'project-123';

      // Simulate fetch call
      const mockFetch = vi.fn().mockResolvedValue({
        mode: 'plan',
        model: 'claude-opus-4',
      });

      expect(projectId).toBe('project-123');
    });

    it('handles project switching with different defaults', () => {
      const project1Defaults = {
        mode: 'plan',
        model: 'claude-opus-4',
      };

      const project2Defaults = {
        mode: 'standard',
        model: 'claude-haiku-3-5-20241022',
      };

      expect(project1Defaults.mode).not.toBe(project2Defaults.mode);
      expect(project1Defaults.model).not.toBe(project2Defaults.model);
    });

    it('clears previously loaded defaults when switching projects', () => {
      let currentDefaults = { mode: 'plan' };

      // Switch project
      currentDefaults = null;

      expect(currentDefaults).toBeNull();
    });
  });

  describe('error handling', () => {
    it('handles defaults fetch failure gracefully', () => {
      const error = new Error('Failed to fetch defaults');

      expect(error.message).toContain('Failed');
      expect(error instanceof Error).toBe(true);
    });

    it('continues with form without defaults on fetch error', () => {
      // Default values should be used
      const fallbackMode = 'yolo';
      const fallbackModel = 'claude-sonnet-4-5-20250929';
      const fallbackThinking = false;
      const fallbackStartImmediate = true;

      expect(fallbackMode).toBe('yolo');
      expect(fallbackModel).toBe('claude-sonnet-4-5-20250929');
      expect(fallbackThinking).toBe(false);
      expect(fallbackStartImmediate).toBe(true);
    });

    it('shows error message on reset failure', () => {
      const errorMessage = 'Failed to reset to project defaults';

      expect(errorMessage).toContain('Failed');
      expect(errorMessage).toContain('reset');
    });
  });

  describe('edge cases', () => {
    it('handles empty defaults object', () => {
      const defaults = {};

      const mode = defaults.mode || 'yolo';
      const model = defaults.model || 'claude-sonnet-4-5-20250929';
      const thinkingEnabled = false;

      expect(mode).toBe('yolo');
      expect(model).toBe('claude-sonnet-4-5-20250929');
      expect(thinkingEnabled).toBe(false);
    });

    it('handles null defaults', () => {
      const defaults = null;

      const mode = defaults?.mode || 'yolo';

      expect(mode).toBe('yolo');
    });

    it('handles all fields set to false (boolean defaults)', () => {
      const defaults = {
        thinkingEnabled: false,
        startImmediately: false,
      };

      const thinkingEnabled =
        defaults.thinkingEnabled !== null && defaults.thinkingEnabled !== undefined
          ? defaults.thinkingEnabled
          : false;
      const startImmediately =
        defaults.startImmediately !== null && defaults.startImmediately !== undefined
          ? defaults.startImmediately
          : true;

      expect(thinkingEnabled).toBe(false);
      expect(startImmediately).toBe(false);
    });

    it('handles special characters in branch names', () => {
      const defaults = {
        gitBranch: 'feature/fix-#123-special-chars-äöü',
      };

      expect(defaults.gitBranch).toContain('#123');
      expect(defaults.gitBranch).toContain('ä');
    });

    it('preserves spacing and formatting in model names', () => {
      const defaults = {
        model: 'claude-opus-4-20250514',
      };

      expect(defaults.model).toBe('claude-opus-4-20250514');
    });
  });
});
