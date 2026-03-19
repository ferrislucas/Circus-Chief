import { describe, it, expect } from 'vitest';
import {
  CreateSessionTemplateRequest,
  UpdateSessionTemplateRequest,
  SessionTemplateResponse,
  SessionTemplateListResponse,
  AvailableTemplatesResponse,
} from './templates.js';

describe('CreateSessionTemplateRequest', () => {
  it('validates request with required fields', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Review Template',
      prompt: 'Review the code changes',
    });
    expect(result.success).toBe(true);
  });

  it('validates request with all optional fields', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Full Template',
      prompt: 'Full prompt text',
      nextTemplateId: '550e8400-e29b-41d4-a716-446655440000',
      thinkingEnabled: true,
      gitBranch: 'feature/test',
      gitMode: 'worktree',
      model: 'claude-sonnet-4-20250514',
      mode: 'plan',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: '',
      prompt: 'Some prompt',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty prompt', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Template',
      prompt: '',
    });
    expect(result.success).toBe(false);
  });

  it('validates gitMode enum', () => {
    expect(
      CreateSessionTemplateRequest.safeParse({
        name: 'Test',
        prompt: 'Test',
        gitMode: 'branch',
      }).success
    ).toBe(true);
    expect(
      CreateSessionTemplateRequest.safeParse({
        name: 'Test',
        prompt: 'Test',
        gitMode: 'worktree',
      }).success
    ).toBe(true);
    expect(
      CreateSessionTemplateRequest.safeParse({
        name: 'Test',
        prompt: 'Test',
        gitMode: 'invalid',
      }).success
    ).toBe(false);
  });

  it('allows null values for optional fields', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Template',
      prompt: 'Prompt',
      nextTemplateId: null,
      thinkingEnabled: null,
      gitBranch: null,
      gitMode: null,
    });
    expect(result.success).toBe(true);
  });

  it('validates model field', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Template',
      prompt: 'Prompt',
      model: 'claude-opus-4-20250514',
    });
    expect(result.success).toBe(true);
  });

  it('validates mode enum', () => {
    expect(
      CreateSessionTemplateRequest.safeParse({
        name: 'Test',
        prompt: 'Test',
        mode: 'plan',
      }).success
    ).toBe(true);
    expect(
      CreateSessionTemplateRequest.safeParse({
        name: 'Test',
        prompt: 'Test',
        mode: 'standard',
      }).success
    ).toBe(true);
    expect(
      CreateSessionTemplateRequest.safeParse({
        name: 'Test',
        prompt: 'Test',
        mode: 'yolo',
      }).success
    ).toBe(true);
    expect(
      CreateSessionTemplateRequest.safeParse({
        name: 'Test',
        prompt: 'Test',
        mode: 'invalid',
      }).success
    ).toBe(false);
  });

  it('validates effortLevel enum', () => {
    for (const level of ['low', 'medium', 'high', 'max', 'auto']) {
      expect(
        CreateSessionTemplateRequest.safeParse({
          name: 'Test',
          prompt: 'Test',
          effortLevel: level,
        }).success
      ).toBe(true);
    }
    expect(
      CreateSessionTemplateRequest.safeParse({
        name: 'Test',
        prompt: 'Test',
        effortLevel: 'invalid',
      }).success
    ).toBe(false);
  });

  it('allows null effortLevel', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Test',
      prompt: 'Test',
      effortLevel: null,
    });
    expect(result.success).toBe(true);
  });

  it('validates nextTemplateId as UUID', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Template',
      prompt: 'Prompt',
      nextTemplateId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid UUID for targetLaneId', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Template',
      prompt: 'Prompt',
      targetLaneId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null targetLaneId', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Template',
      prompt: 'Prompt',
      targetLaneId: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID for targetLaneId', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Template',
      prompt: 'Prompt',
      targetLaneId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('allows omitting targetLaneId', () => {
    const result = CreateSessionTemplateRequest.safeParse({
      name: 'Template',
      prompt: 'Prompt',
    });
    expect(result.success).toBe(true);
    expect(result.data.targetLaneId).toBeUndefined();
  });
});

describe('UpdateSessionTemplateRequest', () => {
  it('validates empty update (all fields optional)', () => {
    const result = UpdateSessionTemplateRequest.safeParse({});
    expect(result.success).toBe(true);
  });

  it('validates name update', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      name: 'Updated Name',
    });
    expect(result.success).toBe(true);
  });

  it('validates prompt update', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      prompt: 'Updated prompt',
    });
    expect(result.success).toBe(true);
  });

  it('validates nextTemplateId update', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      nextTemplateId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('validates setting nextTemplateId to null', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      nextTemplateId: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name when provided', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      name: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty prompt when provided', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      prompt: '',
    });
    expect(result.success).toBe(false);
  });

  it('validates partial update with multiple fields', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      name: 'New Name',
      thinkingEnabled: true,
      gitBranch: 'develop',
    });
    expect(result.success).toBe(true);
  });

  it('validates model update', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      model: 'claude-sonnet-4-20250514',
    });
    expect(result.success).toBe(true);
  });

  it('validates mode update', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      mode: 'plan',
    });
    expect(result.success).toBe(true);
  });

  it('validates mode enum in update', () => {
    expect(
      UpdateSessionTemplateRequest.safeParse({
        mode: 'plan',
      }).success
    ).toBe(true);
    expect(
      UpdateSessionTemplateRequest.safeParse({
        mode: 'standard',
      }).success
    ).toBe(true);
    expect(
      UpdateSessionTemplateRequest.safeParse({
        mode: 'yolo',
      }).success
    ).toBe(true);
    expect(
      UpdateSessionTemplateRequest.safeParse({
        mode: 'invalid',
      }).success
    ).toBe(false);
  });

  it('validates effortLevel update', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      effortLevel: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('validates effortLevel enum in update', () => {
    for (const level of ['low', 'medium', 'high', 'max', 'auto']) {
      expect(
        UpdateSessionTemplateRequest.safeParse({ effortLevel: level }).success
      ).toBe(true);
    }
    expect(
      UpdateSessionTemplateRequest.safeParse({ effortLevel: 'invalid' }).success
    ).toBe(false);
  });

  it('allows null effortLevel in update', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      effortLevel: null,
    });
    expect(result.success).toBe(true);
  });

  it('accepts valid UUID for targetLaneId', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      targetLaneId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null targetLaneId', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      targetLaneId: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid UUID for targetLaneId', () => {
    const result = UpdateSessionTemplateRequest.safeParse({
      targetLaneId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });
});

describe('SessionTemplateResponse', () => {
  const validTemplate = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    projectId: null,
    name: 'Test Template',
    prompt: 'Test prompt',
    nextTemplateId: null,
    thinkingEnabled: null,
    gitBranch: null,
    gitMode: null,
    model: null,
    mode: null,
    effortLevel: null,
    targetLaneId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it('validates complete template response', () => {
    const result = SessionTemplateResponse.safeParse(validTemplate);
    expect(result.success).toBe(true);
  });

  it('validates global template (null projectId)', () => {
    const result = SessionTemplateResponse.safeParse({
      ...validTemplate,
      projectId: null,
    });
    expect(result.success).toBe(true);
  });

  it('validates project template (with projectId)', () => {
    const result = SessionTemplateResponse.safeParse({
      ...validTemplate,
      projectId: '550e8400-e29b-41d4-a716-446655440001',
    });
    expect(result.success).toBe(true);
  });

  it('validates template with all fields set', () => {
    const result = SessionTemplateResponse.safeParse({
      ...validTemplate,
      nextTemplateId: '550e8400-e29b-41d4-a716-446655440002',
      thinkingEnabled: true,
      gitBranch: 'feature/test',
      gitMode: 'worktree',
      model: 'claude-sonnet-4-20250514',
      mode: 'plan',
    });
    expect(result.success).toBe(true);
  });

  it('validates template with model set', () => {
    const result = SessionTemplateResponse.safeParse({
      ...validTemplate,
      model: 'claude-opus-4-20250514',
    });
    expect(result.success).toBe(true);
  });

  it('validates template with mode set', () => {
    const result = SessionTemplateResponse.safeParse({
      ...validTemplate,
      mode: 'standard',
    });
    expect(result.success).toBe(true);
  });

  it('validates template with both model and mode set', () => {
    const result = SessionTemplateResponse.safeParse({
      ...validTemplate,
      model: 'claude-sonnet-4-20250514',
      mode: 'yolo',
    });
    expect(result.success).toBe(true);
  });

  it('validates template with effortLevel set', () => {
    const result = SessionTemplateResponse.safeParse({
      ...validTemplate,
      effortLevel: 'high',
    });
    expect(result.success).toBe(true);
  });

  it('validates template with targetLaneId set', () => {
    const result = SessionTemplateResponse.safeParse({
      ...validTemplate,
      targetLaneId: '550e8400-e29b-41d4-a716-446655440005',
    });
    expect(result.success).toBe(true);
  });

  it('validates template with targetLaneId null', () => {
    const result = SessionTemplateResponse.safeParse({
      ...validTemplate,
      targetLaneId: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects template with invalid targetLaneId', () => {
    const result = SessionTemplateResponse.safeParse({
      ...validTemplate,
      targetLaneId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects template missing targetLaneId field', () => {
    const { targetLaneId: _targetLaneId, ...withoutTargetLaneId } = validTemplate;
    const result = SessionTemplateResponse.safeParse(withoutTargetLaneId);
    expect(result.success).toBe(false);
  });
});

describe('SessionTemplateListResponse', () => {
  it('validates empty list', () => {
    const result = SessionTemplateListResponse.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('validates list with templates', () => {
    const result = SessionTemplateListResponse.safeParse([
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        projectId: null,
        name: 'Template 1',
        prompt: 'Prompt 1',
        nextTemplateId: null,
        thinkingEnabled: null,
        gitBranch: null,
        gitMode: null,
        model: null,
        mode: null,
        effortLevel: null,
        targetLaneId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: '550e8400-e29b-41d4-a716-446655440001',
        projectId: null,
        name: 'Template 2',
        prompt: 'Prompt 2',
        nextTemplateId: '550e8400-e29b-41d4-a716-446655440000',
        thinkingEnabled: true,
        gitBranch: 'main',
        gitMode: 'branch',
        model: 'claude-sonnet-4-20250514',
        mode: 'plan',
        effortLevel: 'high',
        targetLaneId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('AvailableTemplatesResponse', () => {
  it('validates response with empty arrays', () => {
    const result = AvailableTemplatesResponse.safeParse({
      project: [],
      global: [],
    });
    expect(result.success).toBe(true);
  });

  it('validates response with project templates', () => {
    const result = AvailableTemplatesResponse.safeParse({
      project: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          projectId: '550e8400-e29b-41d4-a716-446655440001',
          name: 'Project Template',
          prompt: 'Prompt',
          nextTemplateId: null,
          thinkingEnabled: null,
          gitBranch: null,
          gitMode: null,
          model: null,
          mode: null,
          effortLevel: null,
          targetLaneId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      global: [],
    });
    expect(result.success).toBe(true);
  });

  it('validates response with global templates', () => {
    const result = AvailableTemplatesResponse.safeParse({
      project: [],
      global: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          projectId: null,
          name: 'Global Template',
          prompt: 'Prompt',
          nextTemplateId: null,
          thinkingEnabled: null,
          gitBranch: null,
          gitMode: null,
          model: null,
          mode: null,
          effortLevel: null,
          targetLaneId: null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('validates response with both project and global templates', () => {
    const template = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      projectId: null,
      name: 'Template',
      prompt: 'Prompt',
      nextTemplateId: null,
      thinkingEnabled: null,
      gitBranch: null,
      gitMode: null,
      model: null,
      mode: null,
      effortLevel: null,
      targetLaneId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const result = AvailableTemplatesResponse.safeParse({
      project: [{ ...template, projectId: '550e8400-e29b-41d4-a716-446655440001' }],
      global: [template],
    });
    expect(result.success).toBe(true);
  });

  it('rejects response without project array', () => {
    const result = AvailableTemplatesResponse.safeParse({
      global: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects response without global array', () => {
    const result = AvailableTemplatesResponse.safeParse({
      project: [],
    });
    expect(result.success).toBe(false);
  });
});
