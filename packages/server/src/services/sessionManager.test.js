import { describe, it, expect } from 'vitest';
import {
  getPermissionModeForSession,
  buildSystemPromptConfig,
  PLAN_MODE_PROMPT,
} from './sessionManager.js';

describe('sessionManager', () => {
  describe('getPermissionModeForSession', () => {
    it('returns "bypassPermissions" for yolo mode', () => {
      expect(getPermissionModeForSession('yolo')).toBe('bypassPermissions');
    });

    it('returns "default" for plan mode', () => {
      expect(getPermissionModeForSession('plan')).toBe('default');
    });

    it('returns "default" for standard mode', () => {
      expect(getPermissionModeForSession('standard')).toBe('default');
    });

    it('returns "default" for undefined mode', () => {
      expect(getPermissionModeForSession(undefined)).toBe('default');
    });

    it('returns "default" for null mode', () => {
      expect(getPermissionModeForSession(null)).toBe('default');
    });

    it('returns "default" for unknown mode', () => {
      expect(getPermissionModeForSession('unknown')).toBe('default');
    });
  });

  describe('PLAN_MODE_PROMPT', () => {
    it('contains plan mode instructions', () => {
      expect(PLAN_MODE_PROMPT).toContain('Plan Mode Active');
      expect(PLAN_MODE_PROMPT).toContain('Analyze the Request');
      expect(PLAN_MODE_PROMPT).toContain('Create a Plan');
      expect(PLAN_MODE_PROMPT).toContain('Get Approval');
      expect(PLAN_MODE_PROMPT).toContain('Do NOT start coding');
    });
  });

  describe('buildSystemPromptConfig', () => {
    const sessionId = 'test-session-123';
    const projectId = 'test-project-456';

    it('includes plan mode prompt when mode is plan', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'plan');

      expect(result).toContain('Plan Mode Active');
      expect(result).toContain('Do NOT start coding');
    });

    it('does not include plan mode prompt for standard mode', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');

      expect(result).not.toContain('Plan Mode Active');
      expect(result).not.toContain('Do NOT start coding');
    });

    it('does not include plan mode prompt for yolo mode', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'yolo');

      expect(result).not.toContain('Plan Mode Active');
      expect(result).not.toContain('Do NOT start coding');
    });

    it('includes canvas instructions for all modes', () => {
      const planResult = buildSystemPromptConfig(sessionId, projectId, null, 'plan');
      const standardResult = buildSystemPromptConfig(sessionId, projectId, null, 'standard');
      const yoloResult = buildSystemPromptConfig(sessionId, projectId, null, 'yolo');

      expect(planResult).toContain('/api/sessions/');
      expect(planResult).toContain('/canvas');
      expect(standardResult).toContain('/api/sessions/');
      expect(standardResult).toContain('/canvas');
      expect(yoloResult).toContain('/api/sessions/');
      expect(yoloResult).toContain('/canvas');
    });

    it('includes session API instructions for all modes', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');

      expect(result).toContain('Session Management API');
      expect(result).toContain(sessionId);
      expect(result).toContain(projectId);
    });

    it('uses custom system prompt when provided', () => {
      const customPrompt = 'Custom system prompt for testing';
      const result = buildSystemPromptConfig(sessionId, projectId, customPrompt, 'standard');

      expect(result).toContain(customPrompt);
    });

    it('plan mode prompt is prepended to the system prompt', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'plan');

      // Plan mode prompt should come first
      const planModeIndex = result.indexOf('Plan Mode Active');
      const canvasIndex = result.indexOf('canvas');

      expect(planModeIndex).toBeLessThan(canvasIndex);
    });
  });
});
