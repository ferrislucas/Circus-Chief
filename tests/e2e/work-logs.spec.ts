import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedWorkLog,
  cleanupAll,
  getSessionWorkLogs,
  updateSessionStatus,
} from './helpers';

test.describe('Work Logs API', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Test Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('work logs API returns grouped work logs', async () => {
    // Create a session
    const session = await seedSession(project.id, {
      prompt: 'Test prompt',
      name: 'Work Log Test',
    });

    // Create some work logs
    await seedWorkLog(session.id, {
      type: 'thinking',
      content: 'Analyzing the task...',
    });

    await seedWorkLog(session.id, {
      type: 'tool_input',
      content: '{"command": "ls"}',
      toolName: 'Bash',
    });

    // Fetch work logs via API
    const workLogs = await getSessionWorkLogs(session.id);

    // Should have unassociated work logs (since no messageId was provided)
    expect(workLogs._unassociated).toBeDefined();
    expect(workLogs._unassociated.length).toBe(2);
    expect(workLogs._unassociated[0].type).toBe('thinking');
    expect(workLogs._unassociated[1].type).toBe('tool_input');
  });

  test('can update session status via API', async () => {
    const session = await seedSession(project.id, {
      prompt: 'Status test',
      name: 'Status Test',
    });

    // Update status to running
    await updateSessionStatus(session.id, 'running');

    // Verify status was updated (fetch session to check)
    const response = await fetch(`${process.env.API_URL || 'http://localhost:5000'}/api/sessions/${session.id}`);
    const updated = await response.json();
    expect(updated.status).toBe('running');
  });

  test('work logs persist across status changes', async () => {
    const session = await seedSession(project.id, {
      prompt: 'Persistence test',
      name: 'Persistence Test',
    });

    // Add work logs while running
    await updateSessionStatus(session.id, 'running');
    await seedWorkLog(session.id, {
      type: 'thinking',
      content: 'Thinking while running',
    });

    // Change status to waiting
    await updateSessionStatus(session.id, 'waiting');

    // Work logs should still exist
    const workLogs = await getSessionWorkLogs(session.id);
    expect(workLogs._unassociated).toBeDefined();
    expect(workLogs._unassociated.length).toBe(1);
    expect(workLogs._unassociated[0].content).toBe('Thinking while running');
  });
});
