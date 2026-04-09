import { describe, it, expect, vi } from 'vitest';
import {
  generateInitialName,
  parseBooleanField,
  resolveDefault,
  resolveThinkingEnabled,
  resolveStartImmediately,
  parseSchedulingConfig,
  prepareSessionConfig,
  applyTemplateOverrides,
  resolveNextTemplateId,
  determineInitialStatus,
  buildSchedulingUpdate,
  setupAndStartSession,
} from './projects-session-helpers.js';

// Mock all external dependencies
vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
    update: vi.fn(),
    updateUsage: vi.fn(),
  },
  sessionTemplates: {
    getById: vi.fn(),
  },
  attachments: {
    createBatch: vi.fn(() => []),
  },
  conversations: {
    getById: vi.fn(),
    updateUsage: vi.fn(),
  },
}));

vi.mock('../services/slashCommandService.js', () => ({
  resolvePromptSkillOrCommand: vi.fn(),
}));

vi.mock('../services/gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn(),
}));

vi.mock('../services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

vi.mock('../websocket.js', () => ({
  broadcastToProject: vi.fn(),
}));

vi.mock('@claudetools/shared', () => ({
  WS_MESSAGE_TYPES: {
    SESSION_CREATED: 'session_created',
    SESSION_UPDATED: 'session_updated',
  },
}));

// ── generateInitialName ──────────────────────────────────────────────────

describe('generateInitialName', () => {
  it('returns short prompt as-is', () => {
    expect(generateInitialName('Hello world')).toBe('Hello world');
  });

  it('truncates long prompt at word boundary', () => {
    const longPrompt = 'This is a very long prompt that definitely exceeds the fifty character limit for session names';
    const result = generateInitialName(longPrompt);
    expect(result.length).toBeLessThanOrEqual(53); // 50 chars + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('truncates at 50 chars when no space before position 20', () => {
    const noSpaces = 'a'.repeat(60);
    const result = generateInitialName(noSpaces);
    expect(result).toBe('a'.repeat(50) + '...');
  });

  it('collapses whitespace', () => {
    const result = generateInitialName('hello   world');
    expect(result).toBe('hello world');
  });

  it('trims leading/trailing whitespace', () => {
    const result = generateInitialName('  hello world  ');
    expect(result).toBe('hello world');
  });
});

// ── parseBooleanField ────────────────────────────────────────────────────

describe('parseBooleanField', () => {
  it('parses true value', () => {
    expect(parseBooleanField(true)).toEqual({ explicit: true, provided: true });
  });

  it('parses "true" string', () => {
    expect(parseBooleanField('true')).toEqual({ explicit: true, provided: true });
  });

  it('parses false value', () => {
    expect(parseBooleanField(false)).toEqual({ explicit: false, provided: true });
  });

  it('parses "false" string', () => {
    expect(parseBooleanField('false')).toEqual({ explicit: false, provided: true });
  });

  it('returns undefined for null/undefined', () => {
    expect(parseBooleanField(undefined)).toEqual({ explicit: undefined, provided: false });
    expect(parseBooleanField(null)).toEqual({ explicit: undefined, provided: false });
  });
});

// ── resolveDefault ───────────────────────────────────────────────────────

describe('resolveDefault', () => {
  it('returns explicit value when truthy', () => {
    expect(resolveDefault('explicit', 'project', 'system')).toBe('explicit');
  });

  it('falls through to projectDefault when explicit is falsy', () => {
    expect(resolveDefault(null, 'project', 'system')).toBe('project');
    expect(resolveDefault(undefined, 'project', 'system')).toBe('project');
  });

  it('falls through to systemDefault when all else is falsy', () => {
    expect(resolveDefault(null, null, 'system')).toBe('system');
  });

  it('returns systemDefault when all are null/undefined', () => {
    expect(resolveDefault(null, null, null)).toBeNull();
    expect(resolveDefault(undefined, undefined, undefined)).toBeUndefined();
  });

  it('allows explicit falsy values like 0 and empty string to fall through (truthiness check)', () => {
    expect(resolveDefault(0, 'project', 'system')).toBe('project');
    expect(resolveDefault('', 'project', 'system')).toBe('project');
  });
});

// ── resolveThinkingEnabled ───────────────────────────────────────────────

describe('resolveThinkingEnabled', () => {
  const systemDefaults = { thinkingEnabled: true };

  it('returns explicit true from body', () => {
    expect(resolveThinkingEnabled({ thinkingEnabled: true }, null, systemDefaults)).toBe(true);
  });

  it('returns explicit false from body', () => {
    expect(resolveThinkingEnabled({ thinkingEnabled: false }, null, systemDefaults)).toBe(false);
  });

  it('falls back to project default when body not provided', () => {
    const projectDefs = { thinkingEnabled: false };
    expect(resolveThinkingEnabled({}, projectDefs, systemDefaults)).toBe(false);
  });

  it('falls back to system default when no project defs', () => {
    expect(resolveThinkingEnabled({}, null, systemDefaults)).toBe(true);
  });

  it('uses system default when projectDefs is null', () => {
    expect(resolveThinkingEnabled({}, null, { thinkingEnabled: false })).toBe(false);
  });
});

// ── resolveStartImmediately ──────────────────────────────────────────────

describe('resolveStartImmediately', () => {
  const systemDefaults = { startImmediately: true };

  it('returns false when body explicitly sets false', () => {
    expect(resolveStartImmediately({ startImmediately: false }, null, systemDefaults)).toBe(false);
  });

  it('returns false when body sets "false" string', () => {
    expect(resolveStartImmediately({ startImmediately: 'false' }, null, systemDefaults)).toBe(false);
  });

  it('defaults to true when not specified', () => {
    expect(resolveStartImmediately({}, null, { startImmediately: true })).toBe(true);
  });

  it('uses project default when body not provided', () => {
    const projectDefs = { startImmediately: false };
    expect(resolveStartImmediately({}, projectDefs, systemDefaults)).toBe(false);
  });

  it('uses system default when no project defs', () => {
    expect(resolveStartImmediately({}, null, { startImmediately: false })).toBe(false);
  });
});

// ── parseSchedulingConfig ────────────────────────────────────────────────

describe('parseSchedulingConfig', () => {
  it('parses valid scheduledAt', () => {
    const result = parseSchedulingConfig({ scheduledAt: '1700000000000' });
    expect(result.scheduledAt).toBe(1700000000000);
  });

  it('coerces autoRescheduleEnabled boolean', () => {
    expect(parseSchedulingConfig({ autoRescheduleEnabled: true }).autoRescheduleEnabled).toBe(true);
    expect(parseSchedulingConfig({ autoRescheduleEnabled: 'true' }).autoRescheduleEnabled).toBe(true);
    expect(parseSchedulingConfig({}).autoRescheduleEnabled).toBe(false);
  });

  it('defaults rescheduleDelayMinutes to 15', () => {
    expect(parseSchedulingConfig({}).rescheduleDelayMinutes).toBe(15);
    expect(parseSchedulingConfig({ rescheduleDelayMinutes: '30' }).rescheduleDelayMinutes).toBe(30);
  });

  it('defaults rescheduleOnTokenLimit to true', () => {
    expect(parseSchedulingConfig({}).rescheduleOnTokenLimit).toBe(true);
    expect(parseSchedulingConfig({ rescheduleOnTokenLimit: false }).rescheduleOnTokenLimit).toBe(false);
  });

  it('parses maxRescheduleCount', () => {
    expect(parseSchedulingConfig({ maxRescheduleCount: '5' }).maxRescheduleCount).toBe(5);
    expect(parseSchedulingConfig({}).maxRescheduleCount).toBeNull();
  });

  it('returns defaults for null/empty body', () => {
    const result = parseSchedulingConfig({});
    expect(result.scheduledAt).toBeUndefined();
    expect(result.autoRescheduleEnabled).toBe(false);
    expect(result.rescheduleDelayMinutes).toBe(15);
    expect(result.rescheduleOnTokenLimit).toBe(true);
    expect(result.maxRescheduleCount).toBeNull();
  });
});

// ── prepareSessionConfig ─────────────────────────────────────────────────

describe('prepareSessionConfig', () => {
  const systemDefaults = {
    mode: 'default',
    model: 'sonnet',
    effortLevel: null,
    thinkingEnabled: true,
    startImmediately: true,
  };

  it('builds full config with all fields', () => {
    const body = {
      prompt: 'test prompt',
      name: 'My Session',
      mode: 'yolo',
      model: 'opus',
      thinkingEnabled: true,
      startImmediately: true,
      effortLevel: 'high',
      gitBranch: 'feature/test',
      gitMode: 'worktree',
      templateId: 'tmpl-1',
      parentSessionId: 'parent-1',
    };

    const config = prepareSessionConfig(body, null, systemDefaults);
    expect(config.prompt).toBe('test prompt');
    expect(config.name).toBe('My Session');
    expect(config.mode).toBe('yolo');
    expect(config.model).toBe('opus');
    expect(config.effortLevel).toBe('high');
    expect(config.thinkingEnabled).toBe(true);
    expect(config.startImmediately).toBe(true);
    expect(config.gitBranch).toBe('feature/test');
    expect(config.gitMode).toBe('worktree');
    expect(config.templateId).toBe('tmpl-1');
    expect(config.parentSessionId).toBe('parent-1');
    expect(config.files).toEqual([]);
  });

  it('normalizes effortLevel "auto" to null', () => {
    const config = prepareSessionConfig(
      { prompt: 'test', effortLevel: 'auto' },
      null,
      systemDefaults
    );
    expect(config.effortLevel).toBeNull();
  });

  it('uses project defaults when body fields not provided', () => {
    const projectDefs = { mode: 'plan', model: 'haiku', thinkingEnabled: false };
    const config = prepareSessionConfig({ prompt: 'test' }, projectDefs, systemDefaults);
    expect(config.mode).toBe('plan');
    expect(config.model).toBe('haiku');
    expect(config.thinkingEnabled).toBe(false);
  });

  it('handles null projectDefs', () => {
    const config = prepareSessionConfig({ prompt: 'test' }, null, systemDefaults);
    expect(config.mode).toBe('default');
    expect(config.model).toBe('sonnet');
  });

  it('includes scheduling config', () => {
    const config = prepareSessionConfig(
      { prompt: 'test', scheduledAt: '1700000000000' },
      null,
      systemDefaults
    );
    expect(config.scheduledAt).toBe(1700000000000);
  });
});

// ── applyTemplateOverrides ───────────────────────────────────────────────

describe('applyTemplateOverrides', () => {
  it('applies template overrides for thinkingEnabled', async () => {
    const { sessionTemplates } = await import('../database.js');
    sessionTemplates.getById.mockReturnValue({ thinkingEnabled: false });

    const config = { templateId: 'tmpl-1', thinkingEnabled: true, effortLevel: null };
    applyTemplateOverrides(config);
    expect(config.thinkingEnabled).toBe(false);
  });

  it('applies template overrides for gitBranch', async () => {
    const { sessionTemplates } = await import('../database.js');
    sessionTemplates.getById.mockReturnValue({ gitBranch: 'main' });

    const config = { templateId: 'tmpl-1', gitBranch: null, effortLevel: null };
    applyTemplateOverrides(config);
    expect(config.gitBranch).toBe('main');
  });

  it('applies template overrides for gitMode', async () => {
    const { sessionTemplates } = await import('../database.js');
    sessionTemplates.getById.mockReturnValue({ gitMode: 'branch' });

    const config = { templateId: 'tmpl-1', gitMode: null, effortLevel: null };
    applyTemplateOverrides(config);
    expect(config.gitMode).toBe('branch');
  });

  it('normalizes effortLevel "auto" to null', async () => {
    const { sessionTemplates } = await import('../database.js');
    sessionTemplates.getById.mockReturnValue({ effortLevel: 'auto' });

    const config = { templateId: 'tmpl-1', effortLevel: 'high' };
    applyTemplateOverrides(config);
    expect(config.effortLevel).toBeNull();
  });

  it('is no-op when no templateId', () => {
    const config = { thinkingEnabled: true, effortLevel: 'high' };
    applyTemplateOverrides(config);
    expect(config.thinkingEnabled).toBe(true);
    expect(config.effortLevel).toBe('high');
  });

  it('is no-op when templateId is invalid', async () => {
    const { sessionTemplates } = await import('../database.js');
    sessionTemplates.getById.mockReturnValue(null);

    const config = { templateId: 'nonexistent', thinkingEnabled: true, effortLevel: 'high' };
    applyTemplateOverrides(config);
    expect(config.thinkingEnabled).toBe(true);
  });
});

// ── resolveNextTemplateId ────────────────────────────────────────────────

describe('resolveNextTemplateId', () => {
  it('uses derived nextTemplateId when body is undefined', () => {
    const result = resolveNextTemplateId({}, 'derived-1');
    expect(result).toEqual({ nextTemplateId: 'derived-1', error: null });
  });

  it('returns null when body.nextTemplateId is null', () => {
    const result = resolveNextTemplateId({ nextTemplateId: null }, 'derived-1');
    expect(result).toEqual({ nextTemplateId: null, error: null });
  });

  it('returns valid nextTemplateId from body', async () => {
    const { sessionTemplates } = await import('../database.js');
    sessionTemplates.getById.mockReturnValue({ id: 'tmpl-2' });

    const result = resolveNextTemplateId({ nextTemplateId: 'tmpl-2' }, null);
    expect(result).toEqual({ nextTemplateId: 'tmpl-2', error: null });
  });

  it('returns error for non-existent template', async () => {
    const { sessionTemplates } = await import('../database.js');
    sessionTemplates.getById.mockReturnValue(null);

    const result = resolveNextTemplateId({ nextTemplateId: 'nonexistent' }, null);
    expect(result.error).toBe('nextTemplateId references a non-existent template');
    expect(result.nextTemplateId).toBeNull();
  });
});

// ── determineInitialStatus ───────────────────────────────────────────────

describe('determineInitialStatus', () => {
  it('returns "scheduled" for future scheduledAt', () => {
    const future = Date.now() + 100000;
    expect(determineInitialStatus({ scheduledAt: future, startImmediately: true })).toBe('scheduled');
  });

  it('returns "waiting" when startImmediately is false', () => {
    expect(determineInitialStatus({ startImmediately: false })).toBe('waiting');
  });

  it('returns undefined for immediate start', () => {
    expect(determineInitialStatus({ startImmediately: true })).toBeUndefined();
  });
});

// ── buildSchedulingUpdate ────────────────────────────────────────────────

describe('buildSchedulingUpdate', () => {
  it('includes all scheduling fields when defined', () => {
    const config = {
      scheduledAt: 1700000000000,
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: 15,
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: true,
      maxRescheduleCount: 5,
      maxTotalTokens: 100000,
      rescheduleAtTokenCount: 80000,
      prompt: 'test',
      model: 'sonnet',
    };
    const result = buildSchedulingUpdate(config, undefined);
    expect(result.scheduledAt).toBe(1700000000000);
    expect(result.autoRescheduleEnabled).toBe(true);
    expect(result.maxRescheduleCount).toBe(5);
  });

  it('includes pendingPrompt and pendingModel for waiting status', () => {
    const config = { prompt: 'test prompt', model: 'opus', scheduledAt: undefined };
    const result = buildSchedulingUpdate(config, 'waiting');
    expect(result.pendingPrompt).toBe('test prompt');
    expect(result.pendingModel).toBe('opus');
  });

  it('includes pendingPrompt and pendingModel for scheduled status', () => {
    const config = { prompt: 'test prompt', model: 'opus', scheduledAt: Date.now() + 10000 };
    const result = buildSchedulingUpdate(config, 'scheduled');
    expect(result.pendingPrompt).toBe('test prompt');
    expect(result.pendingModel).toBe('opus');
  });

  it('does not include pending fields for immediate start', () => {
    const config = { prompt: 'test prompt', model: 'opus' };
    const result = buildSchedulingUpdate(config, undefined);
    expect(result.pendingPrompt).toBeUndefined();
    expect(result.pendingModel).toBeUndefined();
  });
});

// ── setupAndStartSession ─────────────────────────────────────────────────

describe('setupAndStartSession', () => {
  it('starts session immediately when config says so', async () => {
    const { sessions } = await import('../database.js');
    const { setupGitForSession } = await import('../services/gitSessionSetup.js');
    const { broadcastToProject } = await import('../websocket.js');
    const { resolvePromptSkillOrCommand } = await import('../services/slashCommandService.js');

    const mockSession = { id: 'sess-1' };
    sessions.getById.mockReturnValue(mockSession);
    sessions.update.mockReturnValue(mockSession);
    setupGitForSession.mockResolvedValue({ workingDirectory: '/tmp/work', gitWorktree: null });
    resolvePromptSkillOrCommand.mockResolvedValue(null);

    vi.doMock('../services/sessionManager.js', () => ({
      runSession: vi.fn().mockResolvedValue(undefined),
    }));

    const result = await setupAndStartSession({
      session: mockSession,
      config: { prompt: 'test', startImmediately: true, scheduledAt: null, parentSessionId: null, gitMode: null, gitBranch: null, model: 'sonnet' },
      project: { workingDirectory: '/tmp/project', systemPrompt: null },
      projectId: 'proj-1',
      files: [],
    });

    expect(result).toHaveProperty('updatedSession');
    expect(broadcastToProject).toHaveBeenCalled();
  });
});
