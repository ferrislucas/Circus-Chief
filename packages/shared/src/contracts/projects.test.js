import { describe, it, expect } from 'vitest';
import {
  CreateProjectRequest,
  UpdateProjectRequest,
  ProjectSessionDefaultsRequest,
  ProjectSessionDefaultsResponse,
} from './projects.js';

describe('Projects Contracts', () => {
  describe('CreateProjectRequest', () => {
    it('validates required fields', () => {
      const valid = CreateProjectRequest.safeParse({
        name: 'Test Project',
        workingDirectory: '/tmp/test',
      });

      expect(valid.success).toBe(true);
    });

    it('requires name', () => {
      const invalid = CreateProjectRequest.safeParse({
        workingDirectory: '/tmp/test',
      });

      expect(invalid.success).toBe(false);
    });

    it('requires workingDirectory', () => {
      const invalid = CreateProjectRequest.safeParse({
        name: 'Test Project',
      });

      expect(invalid.success).toBe(false);
    });

    it('allows optional fields', () => {
      const valid = CreateProjectRequest.safeParse({
        name: 'Test Project',
        workingDirectory: '/tmp/test',
        systemPrompt: 'You are helpful',
        onSessionCreated: 'echo created',
        onSessionDeleted: 'echo deleted',
      });

      expect(valid.success).toBe(true);
      expect(valid.data.systemPrompt).toBe('You are helpful');
    });

    it('allows systemPrompt to be null', () => {
      const valid = CreateProjectRequest.safeParse({
        name: 'Test Project',
        workingDirectory: '/tmp/test',
        systemPrompt: null,
      });

      expect(valid.success).toBe(true);
      expect(valid.data.systemPrompt).toBeNull();
    });
  });

  describe('UpdateProjectRequest', () => {
    it('allows all fields to be optional', () => {
      const valid = UpdateProjectRequest.safeParse({});

      expect(valid.success).toBe(true);
    });

    it('allows partial updates', () => {
      const valid = UpdateProjectRequest.safeParse({
        name: 'Updated Name',
      });

      expect(valid.success).toBe(true);
      expect(valid.data.name).toBe('Updated Name');
    });

    it('validates name when provided', () => {
      const invalid = UpdateProjectRequest.safeParse({
        name: '',
      });

      expect(invalid.success).toBe(false);
    });
  });

  describe('ProjectSessionDefaultsRequest', () => {
    it('allows empty object', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({});

      expect(valid.success).toBe(true);
    });

    it('validates mode enum', () => {
      for (const mode of ['plan', 'standard', 'yolo']) {
        const valid = ProjectSessionDefaultsRequest.safeParse({ mode });
        expect(valid.success).toBe(true);
      }
    });

    it('rejects invalid mode', () => {
      const invalid = ProjectSessionDefaultsRequest.safeParse({
        mode: 'invalid',
      });

      expect(invalid.success).toBe(false);
    });

    it('allows mode as null', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({ mode: null });

      expect(valid.success).toBe(true);
      expect(valid.data.mode).toBeNull();
    });

    it('validates thinkingEnabled boolean', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({
        thinkingEnabled: true,
      });

      expect(valid.success).toBe(true);
    });

    it('rejects non-boolean thinkingEnabled', () => {
      const invalid = ProjectSessionDefaultsRequest.safeParse({
        thinkingEnabled: 'yes',
      });

      expect(invalid.success).toBe(false);
    });

    it('allows thinkingEnabled as null', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({
        thinkingEnabled: null,
      });

      expect(valid.success).toBe(true);
      expect(valid.data.thinkingEnabled).toBeNull();
    });

    it('validates startImmediately boolean', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({
        startImmediately: false,
      });

      expect(valid.success).toBe(true);
    });

    it('validates gitMode enum', () => {
      for (const gitMode of ['branch', 'worktree']) {
        const valid = ProjectSessionDefaultsRequest.safeParse({ gitMode });
        expect(valid.success).toBe(true);
      }
    });

    it('rejects invalid gitMode', () => {
      const invalid = ProjectSessionDefaultsRequest.safeParse({
        gitMode: 'invalid-git-mode',
      });

      expect(invalid.success).toBe(false);
    });

    it('allows gitMode as null', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({
        gitMode: null,
      });

      expect(valid.success).toBe(true);
      expect(valid.data.gitMode).toBeNull();
    });

    it('validates gitBranch string', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({
        gitBranch: 'feature/test',
      });

      expect(valid.success).toBe(true);
    });

    it('allows gitBranch as null', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({
        gitBranch: null,
      });

      expect(valid.success).toBe(true);
      expect(valid.data.gitBranch).toBeNull();
    });

    it('validates model string', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({
        model: 'claude-opus-4',
      });

      expect(valid.success).toBe(true);
    });

    it('allows model as null', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({
        model: null,
      });

      expect(valid.success).toBe(true);
      expect(valid.data.model).toBeNull();
    });

    it('allows multiple fields together', () => {
      const valid = ProjectSessionDefaultsRequest.safeParse({
        mode: 'plan',
        thinkingEnabled: true,
        gitMode: 'worktree',
        gitBranch: 'feature/ai',
        model: 'claude-opus-4',
        startImmediately: false,
      });

      expect(valid.success).toBe(true);
      expect(valid.data.mode).toBe('plan');
      expect(valid.data.thinkingEnabled).toBe(true);
    });
  });

  describe('ProjectSessionDefaultsResponse', () => {
    it('validates complete response', () => {
      const response = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        mode: 'plan',
        thinkingEnabled: true,
        startImmediately: false,
        gitMode: 'worktree',
        gitBranch: 'feature/test',
        model: 'claude-opus-4',
        createdAt: 1234567890,
        updatedAt: 1234567890,
      };

      const valid = ProjectSessionDefaultsResponse.safeParse(response);

      expect(valid.success).toBe(true);
    });

    it('allows null values', () => {
      const response = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        mode: null,
        thinkingEnabled: null,
        startImmediately: null,
        gitMode: null,
        gitBranch: null,
        model: null,
        createdAt: 1234567890,
        updatedAt: 1234567890,
      };

      const valid = ProjectSessionDefaultsResponse.safeParse(response);

      expect(valid.success).toBe(true);
      expect(valid.data.mode).toBeNull();
    });

    it('requires id', () => {
      const invalid = ProjectSessionDefaultsResponse.safeParse({
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });

      expect(invalid.success).toBe(false);
    });

    it('requires projectId', () => {
      const invalid = ProjectSessionDefaultsResponse.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });

      expect(invalid.success).toBe(false);
    });

    it('requires createdAt and updatedAt', () => {
      const invalid = ProjectSessionDefaultsResponse.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
      });

      expect(invalid.success).toBe(false);
    });

    it('rejects invalid UUIDs', () => {
      const invalid = ProjectSessionDefaultsResponse.safeParse({
        id: 'not-a-uuid',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });

      expect(invalid.success).toBe(false);
    });

    it('rejects invalid timestamps', () => {
      const invalid = ProjectSessionDefaultsResponse.safeParse({
        id: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        createdAt: 'not-a-number',
        updatedAt: 1234567890,
      });

      expect(invalid.success).toBe(false);
    });
  });
});
