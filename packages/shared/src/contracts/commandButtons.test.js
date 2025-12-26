import { describe, it, expect } from 'vitest';
import {
  CreateCommandButtonRequest,
  UpdateCommandButtonRequest,
  CommandButtonResponse,
  CommandRunResponse,
} from './commandButtons.js';

describe('Command Buttons Contracts', () => {
  describe('CreateCommandButtonRequest', () => {
    it('accepts valid create request with required fields', () => {
      const result = CreateCommandButtonRequest.safeParse({
        label: 'Build',
        command: 'npm run build',
      });
      expect(result.success).toBe(true);
      expect(result.data.sortOrder).toBe(0);
    });

    it('accepts valid create request with all fields', () => {
      const result = CreateCommandButtonRequest.safeParse({
        label: 'Build',
        command: 'npm run build',
        sortOrder: 1,
      });
      expect(result.success).toBe(true);
      expect(result.data.sortOrder).toBe(1);
    });

    it('sets default sortOrder to 0', () => {
      const result = CreateCommandButtonRequest.safeParse({
        label: 'Test',
        command: 'npm test',
      });
      expect(result.success).toBe(true);
      expect(result.data.sortOrder).toBe(0);
    });

    it('rejects empty label', () => {
      const result = CreateCommandButtonRequest.safeParse({
        label: '',
        command: 'npm run build',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing label', () => {
      const result = CreateCommandButtonRequest.safeParse({
        command: 'npm run build',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty command', () => {
      const result = CreateCommandButtonRequest.safeParse({
        label: 'Build',
        command: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing command', () => {
      const result = CreateCommandButtonRequest.safeParse({
        label: 'Build',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer sortOrder', () => {
      const result = CreateCommandButtonRequest.safeParse({
        label: 'Build',
        command: 'npm run build',
        sortOrder: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateCommandButtonRequest', () => {
    it('accepts update with label only', () => {
      const result = UpdateCommandButtonRequest.safeParse({
        label: 'Updated',
      });
      expect(result.success).toBe(true);
    });

    it('accepts update with command only', () => {
      const result = UpdateCommandButtonRequest.safeParse({
        command: 'new command',
      });
      expect(result.success).toBe(true);
    });

    it('accepts update with sortOrder only', () => {
      const result = UpdateCommandButtonRequest.safeParse({
        sortOrder: 5,
      });
      expect(result.success).toBe(true);
    });

    it('accepts update with multiple fields', () => {
      const result = UpdateCommandButtonRequest.safeParse({
        label: 'Updated',
        command: 'new command',
        sortOrder: 5,
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty object', () => {
      const result = UpdateCommandButtonRequest.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects empty label', () => {
      const result = UpdateCommandButtonRequest.safeParse({
        label: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty command', () => {
      const result = UpdateCommandButtonRequest.safeParse({
        command: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer sortOrder', () => {
      const result = UpdateCommandButtonRequest.safeParse({
        sortOrder: 1.5,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CommandButtonResponse', () => {
    it('accepts valid button response', () => {
      const result = CommandButtonResponse.safeParse({
        id: 'btn-123',
        projectId: 'proj-123',
        label: 'Build',
        command: 'npm run build',
        sortOrder: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing fields', () => {
      const result = CommandButtonResponse.safeParse({
        id: 'btn-123',
        label: 'Build',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('CommandRunResponse', () => {
    it('accepts run response with running status', () => {
      const result = CommandRunResponse.safeParse({
        runId: 'run-123',
        buttonId: 'btn-123',
        status: 'running',
        exitCode: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts run response with success status', () => {
      const result = CommandRunResponse.safeParse({
        runId: 'run-123',
        buttonId: 'btn-123',
        status: 'success',
        exitCode: 0,
        output: 'Build successful',
      });
      expect(result.success).toBe(true);
    });

    it('accepts run response with error status', () => {
      const result = CommandRunResponse.safeParse({
        runId: 'run-123',
        buttonId: 'btn-123',
        status: 'error',
        exitCode: 1,
        output: 'Build failed',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid status', () => {
      const result = CommandRunResponse.safeParse({
        runId: 'run-123',
        buttonId: 'btn-123',
        status: 'invalid',
        exitCode: null,
      });
      expect(result.success).toBe(false);
    });
  });
});
