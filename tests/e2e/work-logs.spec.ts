import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedWorkLog,
  cleanupAll,
  getSessionWorkLogs,
  updateSessionStatus,
  getSessionMessages,
  getSession,
} from './helpers';

const API_URL = process.env.API_URL || 'http://localhost:5000';

// Helper to wait for session to reach a specific status
async function waitForSessionStatus(sessionId: string, targetStatus: string, timeoutMs = 10000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const session = await getSession(sessionId);
    if (session?.status === targetStatus) {
      return session;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Session did not reach status '${targetStatus}' within ${timeoutMs}ms`);
}

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
    const response = await fetch(`${API_URL}/api/sessions/${session.id}`);
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

test.describe('Work Log Association', () => {
  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Work Log Association Test', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  test('work logs are associated with messages after session turn completes', async () => {
    // Create a session - this triggers the mock query which creates work logs
    const session = await seedSession(project.id, {
      prompt: 'Test work log association',
      name: 'Association Test',
    });

    // Wait for session to complete its first turn (status becomes 'waiting')
    await waitForSessionStatus(session.id, 'waiting', 15000);

    // Get messages - should have the assistant response
    const messages = await getSessionMessages(session.id);
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);

    // Get work logs
    const workLogs = await getSessionWorkLogs(session.id);

    // Work logs should be associated with the assistant message, not unassociated
    // The mock query creates: 1 thinking, 1 tool_input, 1 tool_output = 3 work logs
    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
    const associatedLogs = workLogs[lastAssistantMessage.id] || [];
    const unassociatedLogs = workLogs._unassociated || [];

    // All work logs should be associated (not in _unassociated)
    expect(unassociatedLogs.length).toBe(0);
    expect(associatedLogs.length).toBeGreaterThan(0);

    // Verify the types of work logs created by the mock
    const types = associatedLogs.map((log: any) => log.type);
    expect(types).toContain('thinking');
    expect(types).toContain('tool_input');
    expect(types).toContain('tool_output');
  });

  test('work logs from multiple turns are each associated with their respective messages', async () => {
    // Create initial session
    const session = await seedSession(project.id, {
      prompt: 'First message',
      name: 'Multi-turn Test',
    });

    // Wait for first turn to complete
    await waitForSessionStatus(session.id, 'waiting', 15000);

    // Send follow-up message
    const response = await fetch(`${API_URL}/api/sessions/${session.id}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Second message' }),
    });
    expect(response.ok).toBe(true);

    // Wait for second turn to complete
    await waitForSessionStatus(session.id, 'waiting', 15000);

    // Get all messages and work logs
    const messages = await getSessionMessages(session.id);
    const workLogs = await getSessionWorkLogs(session.id);

    // Should have multiple assistant messages (one per turn)
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThanOrEqual(2);

    // Each assistant message should have associated work logs
    for (const msg of assistantMessages) {
      const msgWorkLogs = workLogs[msg.id] || [];
      expect(msgWorkLogs.length).toBeGreaterThan(0);
    }

    // No work logs should be left unassociated
    expect(workLogs._unassociated?.length || 0).toBe(0);
  });
});
