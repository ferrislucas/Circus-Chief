import { describe, it, expect } from 'vitest';
import {
  CreateWorkspaceRequest,
  CreateWorkspaceSessionRequest,
  WorkspaceCardListResponse,
} from './workspaces.js';

const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000';
const PROJECT_ID = '550e8400-e29b-41d4-a716-446655440001';

describe('CreateWorkspaceRequest', () => {
  it('validates a minimal request with only the required prompt', () => {
    const result = CreateWorkspaceRequest.safeParse({ prompt: 'Start a new line of work' });
    expect(result.success).toBe(true);
  });

  it('validates a request with all optional fields', () => {
    const result = CreateWorkspaceRequest.safeParse({
      prompt: 'Build a feature',
      name: 'Feature Workspace',
      mode: 'plan',
      thinkingEnabled: true,
      effortLevel: 'high',
      model: 'claude-sonnet-5',
      providerId: null,
      gitBranch: 'feature/new',
      gitMode: 'worktree',
      templateId: '550e8400-e29b-41d4-a716-446655440000',
      nextTemplateId: '550e8400-e29b-41d4-a716-446655440001',
      startImmediately: true,
      autoRescheduleEnabled: true,
      rescheduleDelayMinutes: 30,
      rescheduleOnTokenLimit: true,
      rescheduleOnServiceError: true,
      maxRescheduleCount: 5,
      maxTotalTokens: 200000,
      rescheduleAtTokenCount: 150000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty prompt', () => {
    expect(CreateWorkspaceRequest.safeParse({ prompt: '' }).success).toBe(false);
  });

  it('rejects a missing prompt', () => {
    expect(CreateWorkspaceRequest.safeParse({}).success).toBe(false);
  });

  it('validates mode enum values', () => {
    for (const mode of ['plan', 'standard', 'yolo']) {
      expect(CreateWorkspaceRequest.safeParse({ prompt: 'test', mode }).success).toBe(true);
    }
    expect(CreateWorkspaceRequest.safeParse({ prompt: 'test', mode: 'invalid' }).success).toBe(false);
  });

  it('validates effortLevel enum values and rejects invalid ones', () => {
    for (const effortLevel of ['low', 'medium', 'high', 'max', 'auto']) {
      expect(CreateWorkspaceRequest.safeParse({ prompt: 'test', effortLevel }).success).toBe(true);
    }
    expect(CreateWorkspaceRequest.safeParse({ prompt: 'test', effortLevel: 'turbo' }).success).toBe(false);
  });

  it('validates gitMode enum values including current', () => {
    for (const gitMode of ['branch', 'worktree', 'current']) {
      expect(CreateWorkspaceRequest.safeParse({ prompt: 'test', gitMode }).success).toBe(true);
    }
    expect(CreateWorkspaceRequest.safeParse({ prompt: 'test', gitMode: 'invalid' }).success).toBe(false);
  });

  it('validates templateId and nextTemplateId as UUIDs', () => {
    expect(CreateWorkspaceRequest.safeParse({
      prompt: 'test',
      templateId: 'not-a-uuid',
    }).success).toBe(false);
    expect(CreateWorkspaceRequest.safeParse({
      prompt: 'test',
      nextTemplateId: 'not-a-uuid',
    }).success).toBe(false);
    expect(CreateWorkspaceRequest.safeParse({
      prompt: 'test',
      templateId: '550e8400-e29b-41d4-a716-446655440000',
      nextTemplateId: null,
    }).success).toBe(true);
  });

  it('clamps reschedule numeric bounds', () => {
    expect(CreateWorkspaceRequest.safeParse({
      prompt: 'test', rescheduleDelayMinutes: 1,
    }).success).toBe(false);
    expect(CreateWorkspaceRequest.safeParse({
      prompt: 'test', rescheduleDelayMinutes: 5,
    }).success).toBe(true);
    expect(CreateWorkspaceRequest.safeParse({
      prompt: 'test', maxRescheduleCount: 0,
    }).success).toBe(false);
    expect(CreateWorkspaceRequest.safeParse({
      prompt: 'test', rescheduleAtTokenCount: 1000,
    }).success).toBe(false);
    expect(CreateWorkspaceRequest.safeParse({
      prompt: 'test', rescheduleAtTokenCount: 10000,
    }).success).toBe(true);
  });

  describe('scheduledAt validation', () => {
    it('accepts ISO 8601 date-time strings with a timezone', () => {
      expect(CreateWorkspaceRequest.safeParse({
        prompt: 'test', scheduledAt: '2026-06-12T14:00:00Z',
      }).success).toBe(true);
      expect(CreateWorkspaceRequest.safeParse({
        prompt: 'test', scheduledAt: '2026-06-12T09:00:00-05:00',
      }).success).toBe(true);
      expect(CreateWorkspaceRequest.safeParse({
        prompt: 'test', scheduledAt: '2026-06-12T14:00:00.123456Z',
      }).success).toBe(true);
    });

    it('rejects ISO strings without a timezone', () => {
      expect(CreateWorkspaceRequest.safeParse({
        prompt: 'test', scheduledAt: '2026-06-12T14:00:00',
      }).success).toBe(false);
    });

    it('rejects invalid calendar dates', () => {
      expect(CreateWorkspaceRequest.safeParse({
        prompt: 'test', scheduledAt: '2026-02-30T14:00:00Z',
      }).success).toBe(false);
      expect(CreateWorkspaceRequest.safeParse({
        prompt: 'test', scheduledAt: '2026-13-01T14:00:00Z',
      }).success).toBe(false);
    });

    it('rejects Unix millisecond timestamps', () => {
      expect(CreateWorkspaceRequest.safeParse({
        prompt: 'test', scheduledAt: 1700000000000,
      }).success).toBe(false);
      expect(CreateWorkspaceRequest.safeParse({
        prompt: 'test', scheduledAt: '1700000000000',
      }).success).toBe(false);
    });
  });
});

describe('CreateWorkspaceSessionRequest', () => {
  it('rejects a request missing parentSessionId', () => {
    const result = CreateWorkspaceSessionRequest.safeParse({ prompt: 'Continue the work' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid UUID parentSessionId', () => {
    const result = CreateWorkspaceSessionRequest.safeParse({
      prompt: 'Continue',
      parentSessionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
    expect(result.data.parentSessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects a non-UUID parentSessionId', () => {
    expect(CreateWorkspaceSessionRequest.safeParse({
      prompt: 'Continue', parentSessionId: 'not-a-uuid',
    }).success).toBe(false);
  });

  it('rejects the retired afterSessionId field name even when a valid parentSessionId is also present', () => {
    // A valid parentSessionId is included so this proves afterSessionId itself
    // is rejected, not merely that parentSessionId was missing.
    const result = CreateWorkspaceSessionRequest.safeParse({
      prompt: 'Continue',
      parentSessionId: '550e8400-e29b-41d4-a716-446655440001',
      afterSessionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(false);
  });

  it('rejects the retired afterSessionId field name when parentSessionId is missing', () => {
    const result = CreateWorkspaceSessionRequest.safeParse({
      prompt: 'Continue',
      afterSessionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(false);
  });

  it('inherits scheduledAt validation from the shared workspace fields', () => {
    const parentSessionId = '550e8400-e29b-41d4-a716-446655440001';
    expect(CreateWorkspaceSessionRequest.safeParse({
      prompt: 'Continue', parentSessionId, scheduledAt: '2026-06-12T14:00:00Z',
    }).success).toBe(true);
    expect(CreateWorkspaceSessionRequest.safeParse({
      prompt: 'Continue', parentSessionId, scheduledAt: '2026-02-30T14:00:00Z',
    }).success).toBe(false);
    expect(CreateWorkspaceSessionRequest.safeParse({
      prompt: 'Continue', parentSessionId, scheduledAt: '2026-06-12T14:00:00',
    }).success).toBe(false);
  });

  it('supports the same optional fields as CreateWorkspaceRequest', () => {
    const result = CreateWorkspaceSessionRequest.safeParse({
      prompt: 'Continue',
      mode: 'yolo',
      thinkingEnabled: false,
      gitBranch: 'follow-up',
      parentSessionId: '550e8400-e29b-41d4-a716-446655440002',
    });
    expect(result.success).toBe(true);
  });
});

describe('WorkspaceCardListResponse', () => {
  const response = {
    workspaces: [{
      id: WORKSPACE_ID,
      projectId: PROJECT_ID,
      name: 'Workspace',
      status: 'running',
      starred: false,
      archived: false,
      prUrl: null,
      gitWorktree: null,
      scheduledAt: null,
      createdAt: 1,
      updatedAt: 2,
      lastActivityAt: 3,
      runningCount: 1,
      runningSessionIds: [WORKSPACE_ID],
      scheduledCount: 0,
      waitingCount: 0,
      descendantCount: 0,
      nearestScheduledAt: null,
      summaryPreview: null,
      prState: null,
      hasMergeConflicts: null,
      ciStatus: null,
      kanban: null,
      pendingAgentInput: false,
      latestCommandRuns: [{
        runId: 'run-1', buttonId: 'button-1', status: 'running', exitCode: null, startedAt: 4,
      }],
    }],
    facets: { running: 1, idle: 0 },
    pagination: { total: 1, limit: 50, offset: 0, hasMore: false },
  };

  it('validates the compact server-computed workspace-card read model', () => {
    expect(WorkspaceCardListResponse.safeParse(response).success).toBe(true);
  });

  it('rejects a card missing a public response field', () => {
    const { latestCommandRuns: _latestCommandRuns, ...cardWithoutRuns } = response.workspaces[0];
    expect(WorkspaceCardListResponse.safeParse({
      ...response,
      workspaces: [cardWithoutRuns],
    }).success).toBe(false);
  });
});
