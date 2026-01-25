import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupAll,
  getSession,
  seedSession,
  getProjectSessionDefaults,
  setProjectSessionDefaults,
  resetProjectSessionDefaults,
  cleanupCreatedResources,
} from './helpers';

const TEST_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Phase 5: E2E Testing & Final Integration
 *
 * This test suite validates the project session defaults feature end-to-end.
 * It covers:
 * - API contracts (GET/POST/DELETE session defaults endpoints)
 * - Session creation with defaults applied from project settings
 * - Multi-project defaults isolation
 * - System defaults fallback
 * - Error handling
 */
test.describe('Project Session Defaults - Phase 5 E2E Tests', () => {
  test.beforeEach(async () => {
    await cleanupAll();
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  // ============================================================
  // Test Suite 1: API Contract Tests
  // ============================================================

  test.describe('API Contract - GET /api/projects/:id/session-defaults', () => {
    test('returns correct structure with all fields', async () => {
      const project = await seedProject('API Contract Test', '/tmp/api-contract');
      await setProjectSessionDefaults(project.id, {
        mode: 'plan',
        thinkingEnabled: true,
        model: TEST_MODEL,
        gitMode: 'worktree',
        gitBranch: 'feature/test',
      });

      const defaults = await getProjectSessionDefaults(project.id);

      expect(defaults).toHaveProperty('id');
      expect(defaults).toHaveProperty('projectId');
      expect(defaults.projectId).toBe(project.id);
      expect(defaults).toHaveProperty('mode');
      expect(defaults.mode).toBe('plan');
      expect(defaults).toHaveProperty('thinkingEnabled');
      expect(defaults.thinkingEnabled).toBe(true);
      expect(defaults).toHaveProperty('startImmediately');
      expect(defaults).toHaveProperty('gitMode');
      expect(defaults.gitMode).toBe('worktree');
      expect(defaults).toHaveProperty('gitBranch');
      expect(defaults.gitBranch).toBe('feature/test');
      expect(defaults).toHaveProperty('model');
      expect(defaults.model).toBe('claude-opus-4');
      expect(defaults).toHaveProperty('createdAt');
      expect(defaults).toHaveProperty('updatedAt');
    });

    test('returns null fields when defaults not fully set', async () => {
      const project = await seedProject('Partial Defaults Test', '/tmp/partial-api');
      await setProjectSessionDefaults(project.id, {
        mode: 'plan',
      });

      const defaults = await getProjectSessionDefaults(project.id);

      expect(defaults.mode).toBe('plan');
      expect(defaults.thinkingEnabled).toBeNull();
      expect(defaults.model).toBeNull();
      expect(defaults.gitBranch).toBeNull();
    });

    test('returns all nulls for new project without defaults', async () => {
      const project = await seedProject('New Project Test', '/tmp/new-project');
      // Don't set any defaults

      const defaults = await getProjectSessionDefaults(project.id);

      expect(defaults.mode).toBeNull();
      expect(defaults.thinkingEnabled).toBeNull();
      expect(defaults.startImmediately).toBeNull();
      expect(defaults.gitMode).toBeNull();
      expect(defaults.gitBranch).toBeNull();
      expect(defaults.model).toBeNull();
    });
  });

  test.describe('API Contract - POST /api/projects/:id/session-defaults', () => {
    test('creates new defaults for project', async () => {
      const project = await seedProject('Create Defaults Test', '/tmp/create-defaults');

      const result = await setProjectSessionDefaults(project.id, {
        mode: 'plan',
        thinkingEnabled: true,
        model: TEST_MODEL,
      });

      expect(result.mode).toBe('plan');
      expect(result.thinkingEnabled).toBe(true);
      expect(result.model).toBe('claude-opus-4');
      expect(result.projectId).toBe(project.id);
    });

    test('updates existing defaults', async () => {
      const project = await seedProject('Update Defaults Test', '/tmp/update-defaults');

      await setProjectSessionDefaults(project.id, {
        mode: 'plan',
        thinkingEnabled: true,
      });

      // Update with different values
      const updated = await setProjectSessionDefaults(project.id, {
        mode: 'yolo',
        thinkingEnabled: false,
      });

      expect(updated.mode).toBe('yolo');
      expect(updated.thinkingEnabled).toBe(false);

      // Verify via GET
      const defaults = await getProjectSessionDefaults(project.id);
      expect(defaults.mode).toBe('yolo');
      expect(defaults.thinkingEnabled).toBe(false);
    });

    test('allows partial updates preserving existing fields', async () => {
      const project = await seedProject('Partial Update Test', '/tmp/partial-update');

      // Set initial defaults
      await setProjectSessionDefaults(project.id, {
        mode: 'plan',
        thinkingEnabled: true,
        model: TEST_MODEL,
      });

      // Partial update: only change model
      const updated = await setProjectSessionDefaults(project.id, {
        model: TEST_MODEL,
      });

      // Verify mode and thinking unchanged
      expect(updated.mode).toBe('plan');
      expect(updated.thinkingEnabled).toBe(true);
      expect(updated.model).toBe('claude-haiku');
    });

    test('validates mode enum', async () => {
      const project = await seedProject('Mode Validation Test', '/tmp/mode-validation');

      // Valid modes should work
      const validModes = ['plan', 'yolo', 'standard'];
      for (const mode of validModes) {
        const result = await setProjectSessionDefaults(project.id, { mode });
        expect(result.mode).toBe(mode);
      }
    });

    test('validates gitMode enum', async () => {
      const project = await seedProject('GitMode Validation Test', '/tmp/gitmode-validation');

      // Valid git modes should work
      const validModes = ['branch', 'worktree', null];
      for (const gitMode of validModes) {
        const result = await setProjectSessionDefaults(project.id, { gitMode });
        expect(result.gitMode).toBe(gitMode);
      }
    });
  });

  test.describe('API Contract - DELETE /api/projects/:id/session-defaults', () => {
    test('clears all defaults', async () => {
      const project = await seedProject('Delete Defaults Test', '/tmp/delete-defaults');
      await setProjectSessionDefaults(project.id, {
        mode: 'plan',
        thinkingEnabled: true,
        model: TEST_MODEL,
        gitMode: 'worktree',
        gitBranch: 'feature/test',
      });

      // Delete defaults
      const result = await resetProjectSessionDefaults(project.id);

      expect(result.mode).toBeNull();
      expect(result.thinkingEnabled).toBeNull();
      expect(result.model).toBeNull();
      expect(result.gitMode).toBeNull();
      expect(result.gitBranch).toBeNull();

      // Verify via GET
      const defaults = await getProjectSessionDefaults(project.id);
      expect(defaults.mode).toBeNull();
      expect(defaults.thinkingEnabled).toBeNull();
      expect(defaults.model).toBeNull();
      expect(defaults.gitMode).toBeNull();
      expect(defaults.gitBranch).toBeNull();
    });
  });

  // ============================================================
  // Test Suite 2: Session Creation with Defaults
  // ============================================================

  test.describe('Session Creation with Defaults', () => {
    test('applies mode default to session', async () => {
      const project = await seedProject('Mode Default Test', '/tmp/mode-default');
      await setProjectSessionDefaults(project.id, { mode: 'plan' });

      const session = await seedSession(project.id, {
        prompt: 'Test prompt for mode default',
      });

      expect(session.mode).toBe('plan');
    });

    test('applies model default to session', async () => {
      const project = await seedProject('Model Default Test', '/tmp/model-default');
      await setProjectSessionDefaults(project.id, { model: 'claude-opus-4' });

      const session = await seedSession(project.id, {
        prompt: 'Test prompt for model default',
      });

      expect(session.model).toBe('claude-opus-4');
    });

    test('applies thinking default to session', async () => {
      const project = await seedProject('Thinking Default Test', '/tmp/thinking-default');
      await setProjectSessionDefaults(project.id, { thinkingEnabled: true });

      const session = await seedSession(project.id, {
        prompt: 'Test prompt for thinking default',
      });

      expect(session.thinkingEnabled).toBe(true);
    });

    test('applies startImmediately default to session', async () => {
      const project = await seedProject('Start Immediately Test', '/tmp/start-immediately');
      await setProjectSessionDefaults(project.id, { startImmediately: false });

      const session = await seedSession(project.id, {
        prompt: 'Test prompt for start immediately default',
      });

      // When startImmediately is false, initial status should be 'waiting'
      expect(session.status).toBe('waiting');
    });

    test('explicit param overrides project default', async () => {
      const project = await seedProject('Override Test', '/tmp/override');
      await setProjectSessionDefaults(project.id, { mode: 'plan' });

      // Create session with explicit mode override
      const session = await seedSession(project.id, {
        prompt: 'Override test',
        mode: 'yolo',
      });

      expect(session.mode).toBe('yolo');
    });

    test('applies multiple defaults together', async () => {
      const project = await seedProject('Multiple Defaults Test', '/tmp/multiple-defaults');
      await setProjectSessionDefaults(project.id, {
        mode: 'plan',
        thinkingEnabled: true,
        model: TEST_MODEL,
      });

      const session = await seedSession(project.id, {
        prompt: 'Multiple defaults test',
      });

      expect(session.mode).toBe('plan');
      expect(session.thinkingEnabled).toBe(true);
      expect(session.model).toBe('claude-opus-4');
    });

    test('uses system defaults when no project defaults set', async () => {
      const project = await seedProject('System Defaults Test', '/tmp/system-defaults');
      // Don't set any project defaults

      const session = await seedSession(project.id, {
        prompt: 'System defaults test',
      });

      // System defaults: mode='yolo', thinkingEnabled=false
      expect(session.mode).toBe('yolo');
      expect(session.thinkingEnabled).toBe(false);
    });

    test('partial project defaults with system fallback', async () => {
      const project = await seedProject('Partial Defaults Fallback', '/tmp/partial-fallback');
      // Only set mode, not thinking
      await setProjectSessionDefaults(project.id, { mode: 'plan' });

      const session = await seedSession(project.id, {
        prompt: 'Partial defaults test',
      });

      // Mode from project default
      expect(session.mode).toBe('plan');
      // Thinking from system default
      expect(session.thinkingEnabled).toBe(false);
    });
  });

  // ============================================================
  // Test Suite 3: Multi-Project Defaults Isolation
  // ============================================================

  test.describe('Multi-Project Defaults Isolation', () => {
    test('different projects maintain independent defaults', async () => {
      const projectA = await seedProject('Project A', '/tmp/project-a');
      const projectB = await seedProject('Project B', '/tmp/project-b');

      // Set different defaults
      await setProjectSessionDefaults(projectA.id, { mode: 'plan' });
      await setProjectSessionDefaults(projectB.id, { mode: 'yolo' });

      // Create sessions in each
      const sessionA = await seedSession(projectA.id, {
        prompt: 'Project A session',
      });

      const sessionB = await seedSession(projectB.id, {
        prompt: 'Project B session',
      });

      // Verify each uses its own defaults
      expect(sessionA.mode).toBe('plan');
      expect(sessionB.mode).toBe('yolo');
    });

    test('resetting defaults in one project does not affect others', async () => {
      const projectA = await seedProject('Reset A Test', '/tmp/reset-a');
      const projectB = await seedProject('Reset B Test', '/tmp/reset-b');

      // Set defaults for both
      await setProjectSessionDefaults(projectA.id, { mode: 'plan' });
      await setProjectSessionDefaults(projectB.id, { mode: 'plan' });

      // Reset only Project A
      await resetProjectSessionDefaults(projectA.id);

      // Verify A is reset but B is unchanged
      const defaultsA = await getProjectSessionDefaults(projectA.id);
      const defaultsB = await getProjectSessionDefaults(projectB.id);

      expect(defaultsA.mode).toBeNull();
      expect(defaultsB.mode).toBe('plan');

      // Verify sessions reflect this
      const sessionA = await seedSession(projectA.id, { prompt: 'After reset A' });
      const sessionB = await seedSession(projectB.id, { prompt: 'After reset B' });

      expect(sessionA.mode).toBe('yolo'); // system default
      expect(sessionB.mode).toBe('plan'); // project default
    });

    test('creating sessions in multiple projects with own defaults', async () => {
      const projects = [];
      for (let i = 0; i < 3; i++) {
        const project = await seedProject(`Multi Project ${i}`, `/tmp/multi-${i}`);
        const modes = ['plan', 'yolo', 'standard'];
        await setProjectSessionDefaults(project.id, { mode: modes[i] });
        projects.push(project);
      }

      // Create sessions for each
      const sessions = [];
      for (const project of projects) {
        const session = await seedSession(project.id, {
          prompt: 'Multi-project test',
        });
        sessions.push(session);
      }

      // Verify each session has correct mode
      expect(sessions[0].mode).toBe('plan');
      expect(sessions[1].mode).toBe('yolo');
      expect(sessions[2].mode).toBe('standard');
    });
  });

  // ============================================================
  // Test Suite 4: System Defaults Fallback
  // ============================================================

  test.describe('System Defaults Fallback', () => {
    test('system defaults apply when no project defaults set', async () => {
      const project = await seedProject('System Defaults Test', '/tmp/system-defaults');
      // Don't set any project defaults

      const session = await seedSession(project.id, {
        prompt: 'System defaults fallback test',
      });

      // Verify system defaults
      expect(session.mode).toBe('yolo');
      expect(session.thinkingEnabled).toBe(false);
      expect(session.startImmediately).toBe(true);
    });

    test('null project defaults fall back to system defaults', async () => {
      const project = await seedProject('Null Defaults Test', '/tmp/null-defaults');

      // Set some then reset to get a record with all nulls
      await setProjectSessionDefaults(project.id, { mode: 'plan' });
      await resetProjectSessionDefaults(project.id);

      const session = await seedSession(project.id, {
        prompt: 'Null defaults test',
      });

      // Should use system defaults since everything is null
      expect(session.mode).toBe('yolo');
      expect(session.thinkingEnabled).toBe(false);
    });
  });

  // ============================================================
  // Test Suite 5: Error Handling & Edge Cases
  // ============================================================

  test.describe('Error Handling & Edge Cases', () => {
    test('workflow not broken when no defaults exist', async () => {
      const project = await seedProject('No Defaults Workflow', '/tmp/no-defaults-workflow');
      // Don't set any defaults

      // Should still be able to create sessions
      const session = await seedSession(project.id, {
        prompt: 'Session without project defaults',
      });

      expect(session).toBeDefined();
      expect(session.id).toBeTruthy();
      // Uses system defaults
      expect(session.mode).toBe('yolo');
    });

    test('gitBranch without gitMode is preserved', async () => {
      const project = await seedProject('Git Config Test', '/tmp/git-config');

      // Set gitBranch without gitMode
      await setProjectSessionDefaults(project.id, {
        gitBranch: 'feature/test',
      });

      const defaults = await getProjectSessionDefaults(project.id);
      expect(defaults.gitBranch).toBe('feature/test');
      expect(defaults.gitMode).toBeNull();
    });

    test('gitMode without gitBranch works', async () => {
      const project = await seedProject('Git Mode Only Test', '/tmp/git-mode-only');

      await setProjectSessionDefaults(project.id, {
        gitMode: 'worktree',
      });

      const defaults = await getProjectSessionDefaults(project.id);
      expect(defaults.gitMode).toBe('worktree');
      expect(defaults.gitBranch).toBeNull();
    });

    test('clearing individual fields', async () => {
      const project = await seedProject('Clear Fields Test', '/tmp/clear-fields');

      // Set multiple fields
      await setProjectSessionDefaults(project.id, {
        mode: 'plan',
        model: TEST_MODEL,
        thinkingEnabled: true,
      });

      // Clear just the model
      const updated = await setProjectSessionDefaults(project.id, {
        model: null,
      });

      expect(updated.mode).toBe('plan');
      expect(updated.model).toBeNull();
      expect(updated.thinkingEnabled).toBe(true);
    });
  });
});
