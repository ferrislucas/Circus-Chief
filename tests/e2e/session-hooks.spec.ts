import { test, expect } from '@playwright/test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  seedProject,
  seedSession,
  updateSessionFields,
  waitForFile,
  readMarkerFile,
  cleanupCreatedResources,
  API_URL,
} from './helpers';

test.describe('Session Lifecycle Hooks', () => {
  let markerDir: string;

  test.beforeEach(async () => {
    // Create a temporary directory for marker files
    markerDir = await mkdtemp(join(tmpdir(), 'circuschief-test-hooks-'));
  });

  test.afterEach(async () => {
    // Cleanup created resources (sessions, projects)
    await cleanupCreatedResources();

    // Cleanup temp directory
    if (markerDir) {
      await rm(markerDir, { recursive: true, force: true });
    }
  });

  test('onSessionCreated hook executes on session creation', async () => {
    // Create a project with onSessionCreated hook configured
    const project = await seedProject('hook-test-created', process.cwd(), {
      onSessionCreated: `touch ${markerDir}/session-created-\${CIRCUSCHIEF_SESSION_ID}.txt`,
    });

    // Create a session in the project
    const session = await seedSession(project.id, {
      prompt: 'Test session for onSessionCreated hook',
      name: 'Hook Test Session',
      startImmediately: false,
    });

    // Wait for the marker file to exist (hook executes asynchronously)
    const markerFile = join(markerDir, `session-created-${session.id}.txt`);
    const fileExists = await waitForFile(markerFile, 5000);

    // Assert marker file exists
    expect(fileExists).toBe(true);
  });

  test('onSessionDeleted hook executes on session deletion for worktree sessions', async () => {
    // Create a project with onSessionDeleted hook configured.
    // The hook uses env vars (CIRCUSCHIEF_SESSION_ID) and an absolute marker
    // path, so it doesn't depend on any specific contents or existence of the
    // worktree cwd at execution time.
    const project = await seedProject('hook-test-deleted', process.cwd(), {
      onSessionDeleted: `touch ${markerDir}/session-deleted-\${CIRCUSCHIEF_SESSION_ID}.txt`,
    });

    // Create a session in the project with a gitWorktree (required for hook to fire).
    // The hook's cwd is the worktree path, which must exist on disk for exec()
    // to spawn. We create a real temp directory to stand in for the worktree.
    const fakeWorktree = await mkdtemp(join(tmpdir(), 'circuschief-test-wt-'));
    const session = await seedSession(project.id, {
      prompt: 'Test session for onSessionDeleted hook',
      name: 'Hook Test Session Delete',
      startImmediately: false,
    });
    await updateSessionFields(session.id, { gitWorktree: fakeWorktree });

    try {
      // Delete the session
      const response = await fetch(`${API_URL}/api/sessions/${session.id}`, {
        method: 'DELETE',
      });
      expect(response.ok).toBe(true);

      // Wait for the marker file to exist (hook executes asynchronously)
      const markerFile = join(markerDir, `session-deleted-${session.id}.txt`);
      const fileExists = await waitForFile(markerFile, 5000);

      // Assert marker file exists
      expect(fileExists).toBe(true);
    } finally {
      // Cleanup the stand-in worktree directory (gitService.removeWorktree
      // may have failed silently since this isn't a real git worktree)
      await rm(fakeWorktree, { recursive: true, force: true });
    }
  });

  test('onSessionDeleted hook does not execute for non-worktree sessions', async () => {
    // Create a project with onSessionDeleted hook configured
    const project = await seedProject('hook-test-no-wt', process.cwd(), {
      onSessionDeleted: `touch ${markerDir}/session-deleted-nowt-\${CIRCUSCHIEF_SESSION_ID}.txt`,
    });

    // Create a session WITHOUT a gitWorktree (branch mode)
    const session = await seedSession(project.id, {
      prompt: 'Test session without worktree',
      name: 'No Worktree Session Delete',
      startImmediately: false,
    });
    // No gitWorktree set — hook should NOT fire

    // Delete the session
    const response = await fetch(`${API_URL}/api/sessions/${session.id}`, {
      method: 'DELETE',
    });
    expect(response.ok).toBe(true);

    // Wait a short time to confirm the marker file is NOT created
    const markerFile = join(markerDir, `session-deleted-nowt-${session.id}.txt`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const fileExists = await waitForFile(markerFile, 0).catch(() => false);

    // Assert marker file was NOT created
    expect(fileExists).toBe(false);
  });

  test('hook receives correct environment variables', async () => {
    // Create a project with hook that writes env vars to a file
    const project = await seedProject('hook-test-env-vars', process.cwd(), {
      onSessionCreated: `echo "\${CIRCUSCHIEF_SESSION_ID},\${CIRCUSCHIEF_PROJECT_ID},\${CIRCUSCHIEF_SESSION_NAME}" > ${markerDir}/env-vars.txt`,
    });

    // Create a session with a known name
    const sessionName = 'Hook Env Vars Test Session';
    const session = await seedSession(project.id, {
      prompt: 'Test session for environment variables',
      name: sessionName,
      startImmediately: false,
    });

    // Wait for the marker file to exist
    const markerFile = join(markerDir, 'env-vars.txt');
    const fileExists = await waitForFile(markerFile, 5000);
    expect(fileExists).toBe(true);

    // Read and parse the marker file
    const fileContents = await readMarkerFile(markerFile);
    const [sessionId, projectId, name] = fileContents.trim().split(',');

    // Assert all three env vars are present and correct
    expect(sessionId).toBe(session.id);
    expect(projectId).toBe(project.id);
    expect(name).toBe(sessionName);
  });

  test('hook executes in correct working directory', async () => {
    // Create a temp directory to use as the working directory
    const workingDir = await mkdtemp(join(tmpdir(), 'circuschief-test-workdir-'));

    try {
      // Create a project with specific working directory
      const project = await seedProject('hook-test-workdir', workingDir, {
        onSessionCreated: `pwd > ${markerDir}/working-dir.txt`,
      });

      // Create a session
      const session = await seedSession(project.id, {
        prompt: 'Test session for working directory',
        name: 'Hook Working Dir Test',
        startImmediately: false,
      });

      // Wait for the marker file to exist
      const markerFile = join(markerDir, 'working-dir.txt');
      const fileExists = await waitForFile(markerFile, 5000);
      expect(fileExists).toBe(true);

      // Read the marker file to get the working directory used by the hook
      const executedWorkingDir = (await readMarkerFile(markerFile)).trim();

      // Assert working directory matches project's working directory
      // Note: The hook may execute in the working directory or a git worktree
      // For this test, we check that it starts with the expected working dir
      expect(executedWorkingDir).toContain(workingDir);
    } finally {
      // Cleanup the temp working directory
      await rm(workingDir, { recursive: true, force: true });
    }
  });
});
