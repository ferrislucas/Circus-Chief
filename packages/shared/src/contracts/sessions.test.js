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
    thinkingEnabled: false,
    gitBranch: null,
    gitWorktree: null,
    prUrl: null,
    error: null,
    nextTemplateId: null,
    parentSessionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('validates complete session response', () => {
    const result = SessionResponse.safeParse(validSession);
    expect(result.success).toBe(true);
  });

  it('validates all status enum values', () => {
    const statuses = ['starting', 'running', 'waiting', 'stopped', 'completed', 'error'];
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
        status: 'completed',
        mode: 'standard',
        thinkingEnabled: false,
        gitBranch: null,
        gitWorktree: null,
        prUrl: null,
        error: null,
        nextTemplateId: null,
        parentSessionId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
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
