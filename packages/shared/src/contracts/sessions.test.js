import { describe, it, expect } from 'vitest';
import {
  CreateSessionRequest,
  UpdateSessionRequest,
  SendMessageRequest,
  SessionResponse,
  SessionListResponse,
  ConversationMessageResponse,
  ConversationListResponse,
} from './sessions.js';

describe('CreateSessionRequest', () => {
  it('validates valid request with required fields', () => {
    const result = CreateSessionRequest.safeParse({
      prompt: 'Build a new feature',
    });
    expect(result.success).toBe(true);
  });

  it('validates request with all optional fields', () => {
    const result = CreateSessionRequest.safeParse({
      prompt: 'Build a feature',
      name: 'Feature Session',
      mode: 'plan',
      thinkingEnabled: true,
      gitBranch: 'feature/new',
      nextTemplateId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty prompt', () => {
    const result = CreateSessionRequest.safeParse({
      prompt: '',
    });
    expect(result.success).toBe(false);
  });

  it('validates mode enum values', () => {
    expect(CreateSessionRequest.safeParse({ prompt: 'test', mode: 'plan' }).success).toBe(true);
    expect(CreateSessionRequest.safeParse({ prompt: 'test', mode: 'standard' }).success).toBe(true);
    expect(CreateSessionRequest.safeParse({ prompt: 'test', mode: 'yolo' }).success).toBe(true);
    expect(CreateSessionRequest.safeParse({ prompt: 'test', mode: 'invalid' }).success).toBe(false);
  });

  it('validates effortLevel enum values', () => {
    for (const effortLevel of ['low', 'medium', 'high', 'max', 'auto']) {
      expect(CreateSessionRequest.safeParse({ prompt: 'test', effortLevel }).success).toBe(true);
    }
  });

  it('rejects invalid effortLevel', () => {
    expect(CreateSessionRequest.safeParse({ prompt: 'test', effortLevel: 'turbo' }).success).toBe(false);
  });

  it('allows omitting effortLevel', () => {
    const result = CreateSessionRequest.safeParse({ prompt: 'test' });
    expect(result.success).toBe(true);
    expect(result.data.effortLevel).toBeUndefined();
  });

  it('allows null nextTemplateId', () => {
    const result = CreateSessionRequest.safeParse({
      prompt: 'test',
      nextTemplateId: null,
    });
    expect(result.success).toBe(true);
  });

  it('validates nextTemplateId as UUID', () => {
    const result = CreateSessionRequest.safeParse({
      prompt: 'test',
      nextTemplateId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateSessionRequest', () => {
  it('validates empty update', () => {
    const result = UpdateSessionRequest.safeParse({});
    expect(result.success).toBe(true);
  });

  it('validates thinkingEnabled update', () => {
    const result = UpdateSessionRequest.safeParse({
      thinkingEnabled: true,
    });
    expect(result.success).toBe(true);
  });

  it('validates nextTemplateId update', () => {
    const result = UpdateSessionRequest.safeParse({
      nextTemplateId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('allows null nextTemplateId to clear it', () => {
    const result = UpdateSessionRequest.safeParse({
      nextTemplateId: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid nextTemplateId', () => {
    const result = UpdateSessionRequest.safeParse({
      nextTemplateId: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  describe('effortLevel validation', () => {
    it('accepts valid effortLevel values', () => {
      for (const effortLevel of ['low', 'medium', 'high', 'max', 'auto']) {
        const result = UpdateSessionRequest.safeParse({ effortLevel });
        expect(result.success).toBe(true);
      }
    });

    it('accepts null effortLevel to clear it', () => {
      const result = UpdateSessionRequest.safeParse({ effortLevel: null });
      expect(result.success).toBe(true);
      expect(result.data.effortLevel).toBeNull();
    });

    it('rejects invalid effortLevel', () => {
      const result = UpdateSessionRequest.safeParse({ effortLevel: 'turbo' });
      expect(result.success).toBe(false);
    });

    it('allows omitting effortLevel', () => {
      const result = UpdateSessionRequest.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data.effortLevel).toBeUndefined();
    });
  });

  describe('prUrl validation', () => {
    it('accepts valid GitHub PR URL', () => {
      const result = UpdateSessionRequest.safeParse({
        prUrl: 'https://github.com/owner/repo/pull/123',
      });
      expect(result.success).toBe(true);
    });

    it('accepts null prUrl to clear it', () => {
      const result = UpdateSessionRequest.safeParse({
        prUrl: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts PR URL with complex owner/repo names', () => {
      const result = UpdateSessionRequest.safeParse({
        prUrl: 'https://github.com/my-org-name/my-repo-123/pull/9999',
      });
      expect(result.success).toBe(true);
    });

    it('rejects non-GitHub URLs', () => {
      const result = UpdateSessionRequest.safeParse({
        prUrl: 'https://gitlab.com/owner/repo/pull/123',
      });
      expect(result.success).toBe(false);
    });

    it('rejects GitHub URLs that are not PR URLs', () => {
      const result = UpdateSessionRequest.safeParse({
        prUrl: 'https://github.com/owner/repo/issues/123',
      });
      expect(result.success).toBe(false);
    });

    it('rejects malformed PR URLs (missing pull number)', () => {
      const result = UpdateSessionRequest.safeParse({
        prUrl: 'https://github.com/owner/repo/pull/',
      });
      expect(result.success).toBe(false);
    });

    it('rejects PR URLs with extra path segments', () => {
      const result = UpdateSessionRequest.safeParse({
        prUrl: 'https://github.com/owner/repo/pull/123/files',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty string prUrl', () => {
      const result = UpdateSessionRequest.safeParse({
        prUrl: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-string prUrl values', () => {
      const result = UpdateSessionRequest.safeParse({
        prUrl: 123,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('targetLaneId validation', () => {
    it('accepts valid UUID for targetLaneId', () => {
      const result = UpdateSessionRequest.safeParse({
        targetLaneId: '550e8400-e29b-41d4-a716-446655440000',
      });
      expect(result.success).toBe(true);
    });

    it('accepts null targetLaneId to clear it', () => {
      const result = UpdateSessionRequest.safeParse({
        targetLaneId: null,
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid UUID for targetLaneId', () => {
      const result = UpdateSessionRequest.safeParse({
        targetLaneId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });

    it('allows omitting targetLaneId', () => {
      const result = UpdateSessionRequest.safeParse({});
      expect(result.success).toBe(true);
      expect(result.data.targetLaneId).toBeUndefined();
    });
  });

  describe('name validation', () => {
    it('accepts valid name', () => {
      const result = UpdateSessionRequest.safeParse({
        name: 'Updated Session Name',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty name', () => {
      const result = UpdateSessionRequest.safeParse({
        name: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('manuallyNamed validation', () => {
    it('accepts manuallyNamed: true', () => {
      const result = UpdateSessionRequest.safeParse({
        manuallyNamed: true,
      });
      expect(result.success).toBe(true);
    });

    it('accepts manuallyNamed: false', () => {
      const result = UpdateSessionRequest.safeParse({
        manuallyNamed: false,
      });
      expect(result.success).toBe(true);
    });

    it('accepts name and manuallyNamed together', () => {
      const result = UpdateSessionRequest.safeParse({
        name: 'Custom Name',
        manuallyNamed: true,
      });
      expect(result.success).toBe(true);
    });
  });
});

describe('SendMessageRequest', () => {
  it('validates message content', () => {
    const result = SendMessageRequest.safeParse({
      content: 'Hello',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty content', () => {
    const result = SendMessageRequest.safeParse({
      content: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing content', () => {
    const result = SendMessageRequest.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('SessionResponse', () => {
  const validSession = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    projectId: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Test Session',
    status: 'running',
    mode: 'standard',
    model: null,
    thinkingEnabled: false,
    effortLevel: null,
    gitBranch: null,
    gitWorktree: null,
    prUrl: null,
    manuallyNamed: false,
    error: null,
    nextTemplateId: null,
    parentSessionId: null,
    scheduledAt: null,
    rescheduleDelayMinutes: 15,
    autoRescheduleEnabled: false,
    rescheduleOnTokenLimit: false,
    rescheduleOnServiceError: false,
    maxRescheduleCount: 5,
    maxTotalTokens: 200000,
    rescheduleCount: 0,
    rescheduleAtTokenCount: 150000,
    targetLaneId: null,
    laneTriggerDepth: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  it('validates complete session response', () => {
    const result = SessionResponse.safeParse(validSession);
    expect(result.success).toBe(true);
  });

  it('validates all status enum values', () => {
    const statuses = ['starting', 'running', 'waiting', 'stopped', 'error'];
    for (const status of statuses) {
      const result = SessionResponse.safeParse({ ...validSession, status });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid status', () => {
    const result = SessionResponse.safeParse({ ...validSession, status: 'paused' });
    expect(result.success).toBe(false);
  });

  it('validates session with nextTemplateId', () => {
    const result = SessionResponse.safeParse({
      ...validSession,
      nextTemplateId: '550e8400-e29b-41d4-a716-446655440002',
    });
    expect(result.success).toBe(true);
  });

  it('validates session with parentSessionId', () => {
    const result = SessionResponse.safeParse({
      ...validSession,
      parentSessionId: '550e8400-e29b-41d4-a716-446655440003',
    });
    expect(result.success).toBe(true);
  });

  it('validates session with manuallyNamed: true', () => {
    const result = SessionResponse.safeParse({
      ...validSession,
      manuallyNamed: true,
    });
    expect(result.success).toBe(true);
  });

  it('validates session with manuallyNamed: false', () => {
    const result = SessionResponse.safeParse({
      ...validSession,
      manuallyNamed: false,
    });
    expect(result.success).toBe(true);
  });

  it('validates session with effortLevel set', () => {
    for (const effortLevel of ['low', 'medium', 'high', 'max', 'auto']) {
      const result = SessionResponse.safeParse({
        ...validSession,
        effortLevel,
      });
      expect(result.success).toBe(true);
    }
  });

  it('validates session with effortLevel null', () => {
    const result = SessionResponse.safeParse({
      ...validSession,
      effortLevel: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects session with invalid effortLevel', () => {
    const result = SessionResponse.safeParse({
      ...validSession,
      effortLevel: 'turbo',
    });
    expect(result.success).toBe(false);
  });

  it('validates session with targetLaneId set', () => {
    const result = SessionResponse.safeParse({
      ...validSession,
      targetLaneId: '550e8400-e29b-41d4-a716-446655440005',
    });
    expect(result.success).toBe(true);
  });

  it('validates session with targetLaneId null', () => {
    const result = SessionResponse.safeParse({
      ...validSession,
      targetLaneId: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects session with invalid targetLaneId', () => {
    const result = SessionResponse.safeParse({
      ...validSession,
      targetLaneId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('validates session with laneTriggerDepth', () => {
    const result = SessionResponse.safeParse({
      ...validSession,
      laneTriggerDepth: 3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects session missing targetLaneId field', () => {
    const { targetLaneId, ...withoutTargetLaneId } = validSession;
    const result = SessionResponse.safeParse(withoutTargetLaneId);
    expect(result.success).toBe(false);
  });

  it('rejects session missing laneTriggerDepth field', () => {
    const { laneTriggerDepth, ...withoutLaneTriggerDepth } = validSession;
    const result = SessionResponse.safeParse(withoutLaneTriggerDepth);
    expect(result.success).toBe(false);
  });
});

describe('SessionListResponse', () => {
  it('validates empty list', () => {
    const result = SessionListResponse.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('validates list with sessions', () => {
    const result = SessionListResponse.safeParse([
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Session 1',
        status: 'waiting',
        mode: 'standard',
        model: null,
        thinkingEnabled: false,
        effortLevel: null,
        gitBranch: null,
        gitWorktree: null,
        prUrl: null,
        manuallyNamed: false,
        error: null,
        nextTemplateId: null,
        parentSessionId: null,
        scheduledAt: null,
        rescheduleDelayMinutes: 15,
        autoRescheduleEnabled: false,
        rescheduleOnTokenLimit: false,
        rescheduleOnServiceError: false,
        maxRescheduleCount: 5,
        maxTotalTokens: 200000,
        rescheduleCount: 0,
        rescheduleAtTokenCount: 150000,
        targetLaneId: null,
        laneTriggerDepth: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastActivityAt: Date.now(),
      },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('ConversationMessageResponse', () => {
  const validMessage = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    sessionId: '550e8400-e29b-41d4-a716-446655440001',
    role: 'user',
    content: 'Hello',
    toolUse: null,
    timestamp: Date.now(),
  };

  it('validates message response', () => {
    const result = ConversationMessageResponse.safeParse(validMessage);
    expect(result.success).toBe(true);
  });

  it('validates all role types', () => {
    const roles = ['user', 'assistant', 'system'];
    for (const role of roles) {
      const result = ConversationMessageResponse.safeParse({ ...validMessage, role });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid role', () => {
    const result = ConversationMessageResponse.safeParse({ ...validMessage, role: 'admin' });
    expect(result.success).toBe(false);
  });

  it('validates message with toolUse', () => {
    const result = ConversationMessageResponse.safeParse({
      ...validMessage,
      toolUse: [{ name: 'read_file', parameters: {} }],
    });
    expect(result.success).toBe(true);
  });
});

describe('ConversationListResponse', () => {
  it('validates empty list', () => {
    const result = ConversationListResponse.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('validates list with messages', () => {
    const result = ConversationListResponse.safeParse([
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        role: 'user',
        content: 'First message',
        toolUse: null,
        timestamp: Date.now(),
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440002',
        sessionId: '550e8400-e29b-41d4-a716-446655440001',
        role: 'assistant',
        content: 'Response',
        toolUse: null,
        timestamp: Date.now(),
      },
    ]);
    expect(result.success).toBe(true);
  });
});
