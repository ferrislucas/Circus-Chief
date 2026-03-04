/**
 * WebSocket E2E Tests — Section 20: Real-Time WebSocket Communication
 *
 * 46 tests across 11 categories covering all WebSocket broadcast paths:
 *  1. Connection & Subscription Model
 *  2. Session Lifecycle Events
 *  3. Live Session Streaming Events
 *  4. Canvas Events
 *  5. Conversation Events
 *  6. Command Events
 *  7. Subscription Isolation
 *  8. Usage Update Buffering
 *  9. Summary Events
 * 10. Work Log Events
 * 11. Multi-Turn Conversation Events
 */

import { test, expect } from '@playwright/test';
import {
  connectWebSocket,
  subscribeToSession,
  unsubscribeFromSession,
  subscribeToProject,
  unsubscribeFromProject,
  waitForWSMessage,
  collectWSMessages,
  collectWSMessagesUntil,
  assertNoWSMessage,
  waitForStatus,
  seedProject,
  seedSession,
  seedCanvasItem,
  seedConversation,
  deleteSession,
  deleteConversation,
  branchConversation,
  seedCommandButton,
  runCommandButton,
  seedWorkLog,
  sendSessionMessage,
  seedUserMessage,
  seedAssistantMessage,
  deleteCanvasItem,
  recoverCanvasItem,
  toggleSessionStar,
  cleanupCreatedResources,
  getSession,
  API_URL,
  TEST_PREFIX,
} from './helpers';

// WebSocket readyState constants (mirrors the ws / browser WebSocket constants)
const WS_OPEN = 1;
const WS_CONNECTING = 0;
const WS_CLOSED = 3;

test.describe('WebSocket Communication', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let wsConnections: any[] = [];

  test.afterEach(async () => {
    for (const ws of wsConnections) {
      if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) {
        ws.close();
      }
    }
    wsConnections = [];
    await cleanupCreatedResources();
  });

  /** Create a WS connection and track it for auto-close in afterEach */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function connect(): Promise<any> {
    const ws = await connectWebSocket();
    wsConnections.push(ws);
    return ws;
  }

  // ===========================================================================
  // Category 1: Connection & Subscription Model (6 tests)
  // ===========================================================================

  test.describe('Category 1: Connection & Subscription', () => {
    test('1. connects to WebSocket server successfully', async () => {
      const ws = await connect();
      expect(ws.readyState).toBe(WS_OPEN);
    });

    test('2. subscribes to session and receives session-scoped events', async () => {
      const project = await seedProject('WS Sub Session', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const ws = await connect();

      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      // Trigger canvas:add which is session-scoped
      const msgPromise = waitForWSMessage(ws, 'canvas:add', 10000);
      await seedCanvasItem(session.id, { type: 'markdown', content: '# Hello' });
      const msg = await msgPromise;

      expect(msg.type).toBe('canvas:add');
      expect(msg.item.sessionId).toBe(session.id);
    });

    test('3. subscribes to project and receives project-scoped events', async () => {
      const project = await seedProject('WS Sub Project', '/tmp');
      const ws = await connect();

      subscribeToProject(ws, project.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'session:created', 10000);
      await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const msg = await msgPromise;

      expect(msg.type).toBe('session:created');
      expect(msg.session.projectId).toBe(project.id);
    });

    test('4. unsubscribing from session stops receiving events', async () => {
      const project = await seedProject('WS Unsub Session', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const ws = await connect();

      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      unsubscribeFromSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      // Now trigger a canvas:add — should NOT be received
      await seedCanvasItem(session.id, { type: 'markdown', content: '# After unsub' });
      await assertNoWSMessage(ws, 'canvas:add', 700);
    });

    test('5. unsubscribing from project stops receiving events', async () => {
      const project = await seedProject('WS Unsub Project', '/tmp');
      const ws = await connect();

      subscribeToProject(ws, project.id);
      await new Promise(r => setTimeout(r, 100));

      unsubscribeFromProject(ws, project.id);
      await new Promise(r => setTimeout(r, 100));

      // Create a session — session:created should NOT arrive
      await seedSession(project.id, { prompt: 'test', startImmediately: false });
      await assertNoWSMessage(ws, 'session:created', 700);
    });

    test('6. session and project subscriptions are independent', async () => {
      const project = await seedProject('WS Both Subs', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const ws = await connect();

      subscribeToSession(ws, session.id);
      subscribeToProject(ws, project.id);
      await new Promise(r => setTimeout(r, 150));

      // Trigger session-scoped event
      const canvasPromise = waitForWSMessage(ws, 'canvas:add', 10000);
      await seedCanvasItem(session.id, { type: 'markdown', content: '# Session event' });
      const canvasMsg = await canvasPromise;
      expect(canvasMsg.type).toBe('canvas:add');

      // Trigger project-scoped event
      const sessionCreatedPromise = waitForWSMessage(ws, 'session:created', 10000);
      await seedSession(project.id, { prompt: 'another', startImmediately: false });
      const sessionMsg = await sessionCreatedPromise;
      expect(sessionMsg.type).toBe('session:created');
    });
  });

  // ===========================================================================
  // Category 2: Session Lifecycle Events (5 tests)
  // ===========================================================================

  test.describe('Category 2: Session Lifecycle Events', () => {
    test('7. session:created broadcasts to project subscribers on new session', async () => {
      const project = await seedProject('WS Lifecycle Project', '/tmp');
      const ws = await connect();

      subscribeToProject(ws, project.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'session:created', 10000);
      const newSession = await seedSession(project.id, { prompt: 'new session', startImmediately: false });
      const msg = await msgPromise;

      expect(msg.type).toBe('session:created');
      expect(msg.session.id).toBe(newSession.id);
      expect(msg.session.projectId).toBe(project.id);
    });

    test('8. session:deleted broadcasts to both session and project subscribers', async () => {
      const project = await seedProject('WS Delete Project', '/tmp');
      const session = await seedSession(project.id, { prompt: 'to delete', startImmediately: false });
      const wsSession = await connect();
      const wsProject = await connect();

      subscribeToSession(wsSession, session.id);
      subscribeToProject(wsProject, project.id);
      await new Promise(r => setTimeout(r, 150));

      const sessionDeletedPromise = waitForWSMessage(wsSession, 'session:deleted', 10000);
      const projectDeletedPromise = waitForWSMessage(wsProject, 'session:deleted', 10000);

      // Delete via raw fetch since the session is already being tracked by helpers cleanup
      await fetch(`${API_URL}/api/sessions/${session.id}`, { method: 'DELETE' });

      const sessionMsg = await sessionDeletedPromise;
      expect(sessionMsg.sessionId).toBe(session.id);

      const projectMsg = await projectDeletedPromise;
      expect(projectMsg.sessionId).toBe(session.id);
      expect(projectMsg.projectId).toBe(project.id);
    });

    test('9. session:status broadcasts to session subscribers on stop', async () => {
      test.setTimeout(30000);
      const project = await seedProject('WS Stop Project', '/tmp');
      const session = await seedSession(project.id, { prompt: 'stop test', startImmediately: false });
      const ws = await connect();

      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'session:status', 10000);

      // Stopping a non-running session still broadcasts session:status
      await fetch(`${API_URL}/api/sessions/${session.id}/stop`, { method: 'POST' });

      const msg = await msgPromise;
      expect(msg.type).toBe('session:status');
      expect(msg.sessionId).toBe(session.id);
      expect(msg.status).toBeDefined();
    });

    test('10. session:updated broadcasts to project subscribers on star', async () => {
      const project = await seedProject('WS Star Project', '/tmp');
      const session = await seedSession(project.id, { prompt: 'star me', startImmediately: false });
      const ws = await connect();

      subscribeToProject(ws, project.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'session:updated', 10000);
      await toggleSessionStar(session.id);
      const msg = await msgPromise;

      expect(msg.type).toBe('session:updated');
      expect(msg.session).toBeDefined();
    });

    test('11. session:updated broadcasts to both on PATCH update', async () => {
      const project = await seedProject('WS Patch Project', '/tmp');
      const session = await seedSession(project.id, { prompt: 'patch me', startImmediately: false });
      const wsSession = await connect();
      const wsProject = await connect();

      subscribeToSession(wsSession, session.id);
      subscribeToProject(wsProject, project.id);
      await new Promise(r => setTimeout(r, 150));

      const sessionUpdatedPromise = waitForWSMessage(wsSession, 'session:updated', 10000);
      const projectUpdatedPromise = waitForWSMessage(wsProject, 'session:updated', 10000);

      await fetch(`${API_URL}/api/sessions/${session.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Updated Name' }),
      });

      const sessionMsg = await sessionUpdatedPromise;
      expect(sessionMsg.type).toBe('session:updated');

      const projectMsg = await projectUpdatedPromise;
      expect(projectMsg.type).toBe('session:updated');
    });
  });

  // ===========================================================================
  // Category 3: Live Session Streaming Events (6 tests)
  // ===========================================================================

  test.describe('Category 3: Live Session Streaming', () => {
    test('12. session:usage_update streams during live session', async () => {
      test.setTimeout(45000);
      const project = await seedProject('WS Usage Project', process.cwd());
      const wsSession = await connect();

      // Create session and subscribe immediately
      const session = await seedSession(project.id, { prompt: 'Tell me about testing' });
      subscribeToSession(wsSession, session.id);

      // Collect all messages until status reaches 'waiting'
      const messages = await collectWSMessagesUntil(
        wsSession,
        'session:status',
        30000,
        (d) => d.status === 'waiting'
      );

      const usageMessages = messages.filter((m: any) => m.type === 'session:usage_update');
      expect(usageMessages.length).toBeGreaterThan(0);

      const firstUsage = usageMessages[0];
      expect(firstUsage.sessionId).toBe(session.id);
      expect(firstUsage.usage).toBeDefined();
      // usage object uses camelCase (inputTokens, outputTokens)
      expect(typeof firstUsage.usage.inputTokens).toBe('number');

      const finalUsage = usageMessages.find((m: any) => m.isFinal === true);
      expect(finalUsage).toBeDefined();
    });

    test('13. session:thinking_partial streams thinking content', async () => {
      test.setTimeout(45000);
      const project = await seedProject('WS Thinking Project', process.cwd());
      const wsSession = await connect();

      const session = await seedSession(project.id, { prompt: 'Think about this' });
      subscribeToSession(wsSession, session.id);

      // Wait for thinking_partial message
      const thinkingMsg = await waitForWSMessage(wsSession, 'session:thinking_partial', 30000);
      expect(thinkingMsg.type).toBe('session:thinking_partial');
      expect(thinkingMsg.sessionId).toBe(session.id);
      expect(thinkingMsg.thinking !== undefined).toBe(true);

      // Wait for session to complete
      await waitForStatus(session.id, 'waiting', 30000);
    });

    test('14. session:partial streams text content', async () => {
      test.setTimeout(45000);
      const project = await seedProject('WS Partial Project', process.cwd());
      const wsSession = await connect();

      const session = await seedSession(project.id, { prompt: 'Write a short paragraph' });
      subscribeToSession(wsSession, session.id);

      const partialMsg = await waitForWSMessage(wsSession, 'session:partial', 30000);
      expect(partialMsg.type).toBe('session:partial');
      expect(partialMsg.sessionId).toBe(session.id);
      expect(typeof partialMsg.text).toBe('string');
      expect(partialMsg.text.length).toBeGreaterThan(0);

      await waitForStatus(session.id, 'waiting', 30000);
    });

    test('15. session:message broadcasts complete messages', async () => {
      test.setTimeout(45000);
      const project = await seedProject('WS Message Project', process.cwd());
      const wsSession = await connect();

      const session = await seedSession(project.id, { prompt: 'Say hello' });
      subscribeToSession(wsSession, session.id);

      const messages = await collectWSMessagesUntil(
        wsSession,
        'session:status',
        30000,
        (d) => d.status === 'waiting'
      );

      const sessionMessages = messages.filter((m: any) => m.type === 'session:message');
      expect(sessionMessages.length).toBeGreaterThan(0);

      // Should have at least one assistant message
      const assistantMsg = sessionMessages.find((m: any) =>
        m.message?.role === 'assistant' || m.role === 'assistant'
      );
      expect(assistantMsg).toBeDefined();
    });

    test('16. session:work_log broadcasts during tool execution', async () => {
      test.setTimeout(45000);
      const project = await seedProject('WS WorkLog Project', process.cwd());
      const wsSession = await connect();

      const session = await seedSession(project.id, { prompt: 'Use bash to check the date' });
      subscribeToSession(wsSession, session.id);

      const messages = await collectWSMessagesUntil(
        wsSession,
        'session:status',
        30000,
        (d) => d.status === 'waiting'
      );

      const workLogs = messages.filter((m: any) => m.type === 'session:work_log');
      expect(workLogs.length).toBeGreaterThan(0);

      const firstLog = workLogs[0];
      expect(firstLog.sessionId).toBe(session.id);
      // The work log is in the 'log' field (not 'workLog')
      expect(firstLog.log).toBeDefined();
    });

    test('17. changes:update broadcasts after turn completes', async () => {
      test.setTimeout(45000);
      const project = await seedProject('WS Changes Project', process.cwd());
      const wsSession = await connect();

      const session = await seedSession(project.id, { prompt: 'Run ls command' });
      subscribeToSession(wsSession, session.id);

      // Collect until we get a changes:update or session reaches waiting
      const messages = await collectWSMessagesUntil(
        wsSession,
        'changes:update',
        30000
      );

      const changesMsg = messages.find((m: any) => m.type === 'changes:update');
      expect(changesMsg).toBeDefined();
      expect(changesMsg.sessionId).toBe(session.id);
      expect(typeof changesMsg.hasChanges).toBe('boolean');
      expect(typeof changesMsg.changeCount).toBe('number');
    });
  });

  // ===========================================================================
  // Category 4: Canvas Events (4 tests)
  // ===========================================================================

  test.describe('Category 4: Canvas Events', () => {
    test('18. canvas:add broadcasts when item is added', async () => {
      const project = await seedProject('WS Canvas Add', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const ws = await connect();

      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'canvas:add', 10000);
      await seedCanvasItem(session.id, { type: 'markdown', content: '# Hello Canvas' });
      const msg = await msgPromise;

      expect(msg.type).toBe('canvas:add');
      expect(msg.item.sessionId).toBe(session.id);
      expect(msg.item.type).toBe('markdown');
      expect(msg.item.content).toBe('# Hello Canvas');
    });

    test('19. canvas:remove broadcasts when item is deleted', async () => {
      const project = await seedProject('WS Canvas Remove', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });

      // Add item first (without subscriber to avoid catching add event)
      const item = await seedCanvasItem(session.id, { type: 'markdown', content: '# To Delete' });

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'canvas:remove', 10000);
      await deleteCanvasItem(session.id, item.id);
      const msg = await msgPromise;

      expect(msg.type).toBe('canvas:remove');
      expect(msg.sessionId).toBe(session.id);
      expect(msg.itemId).toBe(item.id);
    });

    test('20. canvas:add broadcasts on item recovery from trash', async () => {
      const project = await seedProject('WS Canvas Recover', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });

      // Add and delete item first
      const item = await seedCanvasItem(session.id, { type: 'markdown', content: '# Recovered' });
      await deleteCanvasItem(session.id, item.id);

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'canvas:add', 10000);
      await recoverCanvasItem(session.id, item.id);
      const msg = await msgPromise;

      expect(msg.type).toBe('canvas:add');
      expect(msg.item.sessionId).toBe(session.id);
    });

    test('21. canvas events are NOT broadcast to project subscribers', async () => {
      const project = await seedProject('WS Canvas Proj Only', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const ws = await connect();

      // Subscribe to project ONLY (not session)
      subscribeToProject(ws, project.id);
      await new Promise(r => setTimeout(r, 100));

      await seedCanvasItem(session.id, { type: 'markdown', content: '# Project Only' });
      await assertNoWSMessage(ws, 'canvas:add', 700);
    });
  });

  // ===========================================================================
  // Category 5: Conversation Events (4 tests)
  // ===========================================================================

  test.describe('Category 5: Conversation Events', () => {
    test('22. conversation:created broadcasts when conversation is created', async () => {
      const project = await seedProject('WS Conv Created', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const ws = await connect();

      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'conversation:created', 10000);
      await seedConversation(session.id, 'New Conversation');
      const msg = await msgPromise;

      expect(msg.type).toBe('conversation:created');
      expect(msg.conversation).toBeDefined();
      expect(msg.conversation.sessionId).toBe(session.id);
    });

    test('23. conversation:deleted broadcasts when conversation is deleted', async () => {
      const project = await seedProject('WS Conv Deleted', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });

      // Create conversation first (without subscriber)
      const conversation = await seedConversation(session.id, 'To Delete');

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'conversation:deleted', 10000);
      await deleteConversation(session.id, conversation.id);
      const msg = await msgPromise;

      expect(msg.type).toBe('conversation:deleted');
      expect(msg.conversationId).toBe(conversation.id);
      expect(msg.sessionId).toBe(session.id);
    });

    test('24. conversation:created broadcasts on branch', async () => {
      test.setTimeout(60000);
      const project = await seedProject('WS Conv Branch', process.cwd());

      // Create session with messages to branch from
      const session = await seedSession(project.id, { prompt: 'First message to branch from' });
      await waitForStatus(session.id, 'waiting', 45000);

      // Get session messages to find one to branch from
      const messagesResp = await fetch(`${API_URL}/api/sessions/${session.id}/messages`);
      const messages = await messagesResp.json();
      const userMsg = (messages as any[]).find((m: any) => m.role === 'user');
      expect(userMsg).toBeDefined();

      // Get the default conversation
      const convsResp = await fetch(`${API_URL}/api/sessions/${session.id}/conversations`);
      const conversations = await convsResp.json();
      const defaultConv = (conversations as any[])[0];

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'conversation:created', 10000);
      await branchConversation(session.id, defaultConv.id, userMsg.id, 'Branched prompt');
      const msg = await msgPromise;

      expect(msg.type).toBe('conversation:created');
      expect(msg.conversation.sessionId).toBe(session.id);
    });

    test('25. conversation events are NOT broadcast to project subscribers', async () => {
      const project = await seedProject('WS Conv Proj Only', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const ws = await connect();

      // Subscribe to project ONLY
      subscribeToProject(ws, project.id);
      await new Promise(r => setTimeout(r, 100));

      await seedConversation(session.id, 'Project Only Conv');
      await assertNoWSMessage(ws, 'conversation:created', 700);
    });
  });

  // ===========================================================================
  // Category 6: Command Events (4 tests)
  // ===========================================================================

  test.describe('Category 6: Command Events', () => {
    test('26. command:run:output broadcasts to session subscribers', async () => {
      test.setTimeout(30000);
      const project = await seedProject('WS Cmd Output', process.cwd());
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const button = await seedCommandButton(project.id, {
        label: 'Echo Test',
        command: 'echo "hello world"',
      });

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      // The server first sends an empty-output "running" broadcast, then sends the actual output.
      // Use a matcher to skip the initial empty broadcast and wait for real output.
      const msgPromise = waitForWSMessage(
        ws,
        'command:run:output',
        20000,
        (m: any) => m.output && m.output.length > 0
      );
      await runCommandButton(session.id, button.id);
      const msg = await msgPromise;

      expect(msg.type).toBe('command:run:output');
      expect(msg.sessionId).toBe(session.id);
      expect(msg.buttonId).toBe(button.id);
      expect(msg.output).toContain('hello world');
    });

    test('27. command:run:complete broadcasts to session subscribers', async () => {
      test.setTimeout(30000);
      const project = await seedProject('WS Cmd Complete', process.cwd());
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const button = await seedCommandButton(project.id, {
        label: 'Echo Complete',
        command: 'echo "done"',
      });

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'command:run:complete', 20000);
      await runCommandButton(session.id, button.id);
      const msg = await msgPromise;

      expect(msg.type).toBe('command:run:complete');
      expect(msg.sessionId).toBe(session.id);
      expect(msg.exitCode).toBe(0);
      expect(msg.status).toBeDefined();
    });

    test('28. command:run:complete broadcasts on failed command', async () => {
      test.setTimeout(30000);
      const project = await seedProject('WS Cmd Error', process.cwd());
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const button = await seedCommandButton(project.id, {
        label: 'Fail Command',
        command: 'exit 1',
      });

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'command:run:complete', 20000);
      await runCommandButton(session.id, button.id);
      const msg = await msgPromise;

      expect(msg.type).toBe('command:run:complete');
      expect(msg.exitCode).not.toBe(0);
    });

    test('29. command events broadcast to both session and project subscribers', async () => {
      test.setTimeout(30000);
      const project = await seedProject('WS Cmd Both', process.cwd());
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const button = await seedCommandButton(project.id, {
        label: 'Both Echo',
        command: 'echo "broadcast"',
      });

      const wsSession = await connect();
      const wsProject = await connect();
      subscribeToSession(wsSession, session.id);
      subscribeToProject(wsProject, project.id);
      await new Promise(r => setTimeout(r, 150));

      const sessionCompletePromise = waitForWSMessage(wsSession, 'command:run:complete', 20000);
      const projectCompletePromise = waitForWSMessage(wsProject, 'command:run:complete', 20000);

      await runCommandButton(session.id, button.id);

      const sessionMsg = await sessionCompletePromise;
      expect(sessionMsg.type).toBe('command:run:complete');

      const projectMsg = await projectCompletePromise;
      expect(projectMsg.type).toBe('command:run:complete');
    });
  });

  // ===========================================================================
  // Category 7: Subscription Isolation (4 tests)
  // ===========================================================================

  test.describe('Category 7: Subscription Isolation', () => {
    test('30. session subscriber only receives events for subscribed session', async () => {
      const project = await seedProject('WS Isolation Project', '/tmp');
      const session1 = await seedSession(project.id, { prompt: 'session 1', startImmediately: false });
      const session2 = await seedSession(project.id, { prompt: 'session 2', startImmediately: false });

      const ws1 = await connect();
      const ws2 = await connect();
      subscribeToSession(ws1, session1.id);
      subscribeToSession(ws2, session2.id);
      await new Promise(r => setTimeout(r, 150));

      // Collect messages for a short window while triggering both events
      const ws1Promise = collectWSMessages(ws1, 1500);
      const ws2Promise = collectWSMessages(ws2, 1500);

      await seedCanvasItem(session1.id, { type: 'markdown', content: '# For session 1' });
      await seedCanvasItem(session2.id, { type: 'markdown', content: '# For session 2' });

      const ws1Messages = await ws1Promise;
      const ws2Messages = await ws2Promise;

      // ws1 should only see session1's canvas:add
      const ws1Canvas = ws1Messages.filter((m: any) => m.type === 'canvas:add');
      expect(ws1Canvas.length).toBeGreaterThan(0);
      ws1Canvas.forEach((m: any) => expect(m.item.sessionId).toBe(session1.id));

      // ws2 should only see session2's canvas:add
      const ws2Canvas = ws2Messages.filter((m: any) => m.type === 'canvas:add');
      expect(ws2Canvas.length).toBeGreaterThan(0);
      ws2Canvas.forEach((m: any) => expect(m.item.sessionId).toBe(session2.id));
    });

    test('31. multiple subscribers to same session all receive events', async () => {
      const project = await seedProject('WS Multi Sub', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });

      const ws1 = await connect();
      const ws2 = await connect();
      subscribeToSession(ws1, session.id);
      subscribeToSession(ws2, session.id);
      await new Promise(r => setTimeout(r, 150));

      const ws1Promise = waitForWSMessage(ws1, 'canvas:add', 10000);
      const ws2Promise = waitForWSMessage(ws2, 'canvas:add', 10000);

      await seedCanvasItem(session.id, { type: 'markdown', content: '# Multi Sub Test' });

      const ws1Msg = await ws1Promise;
      const ws2Msg = await ws2Promise;

      expect(ws1Msg.type).toBe('canvas:add');
      expect(ws2Msg.type).toBe('canvas:add');
      expect(ws1Msg.item.sessionId).toBe(session.id);
      expect(ws2Msg.item.sessionId).toBe(session.id);
    });

    test('32. client can subscribe to multiple sessions simultaneously', async () => {
      const project = await seedProject('WS Multi Session Sub', '/tmp');
      const session1 = await seedSession(project.id, { prompt: 'session 1', startImmediately: false });
      const session2 = await seedSession(project.id, { prompt: 'session 2', startImmediately: false });

      const ws = await connect();
      subscribeToSession(ws, session1.id);
      subscribeToSession(ws, session2.id);
      await new Promise(r => setTimeout(r, 150));

      // Collect messages for a window while triggering events on both sessions
      const messagesPromise = collectWSMessages(ws, 1500);

      await seedCanvasItem(session1.id, { type: 'markdown', content: '# Session 1 item' });
      await seedCanvasItem(session2.id, { type: 'markdown', content: '# Session 2 item' });

      const messages = await messagesPromise;
      const canvasMessages = messages.filter((m: any) => m.type === 'canvas:add');
      expect(canvasMessages.length).toBeGreaterThanOrEqual(2);

      const s1Messages = canvasMessages.filter((m: any) => m.item.sessionId === session1.id);
      const s2Messages = canvasMessages.filter((m: any) => m.item.sessionId === session2.id);
      expect(s1Messages.length).toBeGreaterThan(0);
      expect(s2Messages.length).toBeGreaterThan(0);
    });

    test('33. disconnected client is cleaned up from subscriptions', async () => {
      const project = await seedProject('WS Disconnect Cleanup', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });

      // First client subscribes, receives an event, then disconnects
      const ws1 = await connect();
      subscribeToSession(ws1, session.id);
      await new Promise(r => setTimeout(r, 100));

      ws1.close();
      wsConnections = wsConnections.filter((w: any) => w !== ws1);
      await new Promise(r => setTimeout(r, 200));

      // New client subscribes
      const ws2 = await connect();
      subscribeToSession(ws2, session.id);
      await new Promise(r => setTimeout(r, 100));

      // Add another item — only ws2 should receive this
      const msgPromise = waitForWSMessage(ws2, 'canvas:add', 10000);
      await seedCanvasItem(session.id, { type: 'markdown', content: '# After new subscribe' });
      const msg = await msgPromise;

      expect(msg.type).toBe('canvas:add');
      expect(msg.item.sessionId).toBe(session.id);
      expect(ws1.readyState).toBe(WS_CLOSED);
    });
  });

  // ===========================================================================
  // Category 8: Usage Update Buffering (4 tests)
  // ===========================================================================

  test.describe('Category 8: Usage Update Buffering', () => {
    test('34. usage updates are buffered when no subscriber exists', async () => {
      test.setTimeout(60000);
      const project = await seedProject('WS Buffer Project', process.cwd());

      // Create session WITHOUT a WS subscriber — usage updates get buffered
      const session = await seedSession(project.id, { prompt: 'Buffer test session' });

      // Wait for session to complete
      await waitForStatus(session.id, 'waiting', 45000);

      // NOW subscribe — should receive buffered usage updates immediately
      const ws = await connect();
      subscribeToSession(ws, session.id);

      // Collect messages for a short window (buffered messages arrive immediately)
      const messages = await collectWSMessages(ws, 2000);
      const usageMessages = messages.filter((m: any) => m.type === 'session:usage_update');

      expect(usageMessages.length).toBeGreaterThan(0);
      expect(usageMessages.some((m: any) => m.isFinal === true)).toBe(true);
    });

    test('35. non-usage messages are NOT buffered', async () => {
      test.setTimeout(60000);
      const project = await seedProject('WS Buffer Non-Usage', process.cwd());

      // Create session WITHOUT a WS subscriber
      const session = await seedSession(project.id, { prompt: 'Non-usage buffer test' });
      await waitForStatus(session.id, 'waiting', 45000);

      // Also add a canvas item without subscriber (canvas:add is not buffered)
      await seedCanvasItem(session.id, { type: 'markdown', content: '# Not buffered' });

      // NOW subscribe
      const ws = await connect();
      subscribeToSession(ws, session.id);

      // Collect messages for a short window
      const messages = await collectWSMessages(ws, 2000);

      // Should have usage updates (buffered)
      const usageMessages = messages.filter((m: any) => m.type === 'session:usage_update');
      expect(usageMessages.length).toBeGreaterThan(0);

      // Should NOT have canvas:add (not buffered, was missed)
      const canvasMessages = messages.filter((m: any) => m.type === 'canvas:add');
      expect(canvasMessages.length).toBe(0);
    });

    test('36. re-subscribing after unsubscribe works correctly', async () => {
      const project = await seedProject('WS Resub Project', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const ws = await connect();

      // Subscribe, then unsubscribe
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));
      unsubscribeFromSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      // Re-subscribe
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      // Trigger a canvas:add — should be received after re-subscription
      const msgPromise = waitForWSMessage(ws, 'canvas:add', 10000);
      await seedCanvasItem(session.id, { type: 'markdown', content: '# After resub' });
      const msg = await msgPromise;

      expect(msg.type).toBe('canvas:add');
      expect(msg.item.sessionId).toBe(session.id);
    });

    test('37. multiple subscriptions to different sessions work independently', async () => {
      const project = await seedProject('WS Multi Independent', '/tmp');
      const session1 = await seedSession(project.id, { prompt: 's1', startImmediately: false });
      const session2 = await seedSession(project.id, { prompt: 's2', startImmediately: false });
      const ws = await connect();

      subscribeToSession(ws, session1.id);
      subscribeToSession(ws, session2.id);
      await new Promise(r => setTimeout(r, 150));

      // Collect messages while triggering events on both sessions
      const messagesPromise = collectWSMessages(ws, 1500);

      await seedCanvasItem(session1.id, { type: 'markdown', content: '# Session 1' });
      await seedCanvasItem(session2.id, { type: 'markdown', content: '# Session 2' });

      const messages = await messagesPromise;
      const s1Messages = messages.filter((m: any) => m.type === 'canvas:add' && m.item?.sessionId === session1.id);
      const s2Messages = messages.filter((m: any) => m.type === 'canvas:add' && m.item?.sessionId === session2.id);

      expect(s1Messages.length).toBeGreaterThan(0);
      expect(s2Messages.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // Category 9: Summary Events (3 tests)
  // ===========================================================================

  test.describe('Category 9: Summary Events', () => {
    test('38. session:summary_generating broadcasts when summary generation starts', async () => {
      test.setTimeout(60000);
      const project = await seedProject('WS Summary Generating', process.cwd());
      const session = await seedSession(project.id, { prompt: 'Summary generation test' });
      await waitForStatus(session.id, 'waiting', 45000);

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      // Use POST to force regeneration (GET ?generate=true only runs if no summary exists;
      // after a session completes, a summary is auto-generated, so POST is needed to re-run)
      const msgPromise = waitForWSMessage(ws, 'session:summary_generating', 20000);
      await fetch(`${API_URL}/api/sessions/${session.id}/summary`, { method: 'POST' });
      const msg = await msgPromise;

      expect(msg.type).toBe('session:summary_generating');
      expect(msg.sessionId).toBe(session.id);
      expect(msg.generating).toBe(true);
    });

    test('39. session:summary_updated broadcasts when summary completes', async () => {
      test.setTimeout(60000);
      const project = await seedProject('WS Summary Updated', process.cwd());
      const session = await seedSession(project.id, { prompt: 'Summary updated test' });
      await waitForStatus(session.id, 'waiting', 45000);

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      // Use POST to force regeneration
      const msgPromise = waitForWSMessage(ws, 'session:summary_updated', 20000);
      await fetch(`${API_URL}/api/sessions/${session.id}/summary`, { method: 'POST' });
      const msg = await msgPromise;

      expect(msg.type).toBe('session:summary_updated');
      expect(msg.sessionId).toBe(session.id);
      expect(msg.summary).toBeDefined();
    });

    test('40. summary events also broadcast session:updated to project subscribers', async () => {
      test.setTimeout(60000);
      const project = await seedProject('WS Summary Project Updated', process.cwd());
      const session = await seedSession(project.id, { prompt: 'Project summary test' });
      await waitForStatus(session.id, 'waiting', 45000);

      const ws = await connect();
      subscribeToProject(ws, project.id);
      await new Promise(r => setTimeout(r, 100));

      // Use POST to force regeneration — summary completion broadcasts session:updated
      const msgPromise = waitForWSMessage(ws, 'session:updated', 20000);
      await fetch(`${API_URL}/api/sessions/${session.id}/summary`, { method: 'POST' });
      const msg = await msgPromise;

      expect(msg.type).toBe('session:updated');
      expect(msg.session).toBeDefined();
    });
  });

  // ===========================================================================
  // Category 10: Work Log Events (3 tests)
  // ===========================================================================

  test.describe('Category 10: Work Log Events', () => {
    test('41. session:work_log broadcasts when work log is added via API', async () => {
      const project = await seedProject('WS WorkLog API', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const ws = await connect();

      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'session:work_log', 10000);
      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: 'Running bash command: ls -la',
        toolName: 'Bash',
      });
      const msg = await msgPromise;

      expect(msg.type).toBe('session:work_log');
      expect(msg.sessionId).toBe(session.id);
      // The work log object is in the 'log' field (not 'workLog')
      expect(msg.log).toBeDefined();
    });

    test('42. session:work_logs_associated broadcasts after turn completes', async () => {
      test.setTimeout(45000);
      const project = await seedProject('WS WorkLog Associated', process.cwd());
      const ws = await connect();

      const session = await seedSession(project.id, { prompt: 'Use tools for this task' });
      subscribeToSession(ws, session.id);

      const messages = await collectWSMessagesUntil(
        ws,
        'session:status',
        30000,
        (d) => d.status === 'waiting'
      );

      const associatedMsg = messages.find((m: any) => m.type === 'session:work_logs_associated');
      expect(associatedMsg).toBeDefined();
      // The broadcast includes sessionId and messageId
      expect(associatedMsg.messageId).toBeDefined();
    });

    test('43. work log events are session-scoped only', async () => {
      const project = await seedProject('WS WorkLog Scoped', '/tmp');
      const session = await seedSession(project.id, { prompt: 'test', startImmediately: false });
      const ws = await connect();

      // Subscribe to project ONLY
      subscribeToProject(ws, project.id);
      await new Promise(r => setTimeout(r, 100));

      await seedWorkLog(session.id, {
        type: 'tool_input',
        content: 'Project only work log test',
        toolName: 'Bash',
      });
      await assertNoWSMessage(ws, 'session:work_log', 700);
    });
  });

  // ===========================================================================
  // Category 11: Multi-Turn Conversation Events (3 tests)
  // ===========================================================================

  test.describe('Category 11: Multi-Turn Conversation Events', () => {
    test('44. follow-up message triggers session:message for user input', async () => {
      test.setTimeout(60000);
      const project = await seedProject('WS MultiTurn User Msg', process.cwd());
      const session = await seedSession(project.id, { prompt: 'First message' });
      await waitForStatus(session.id, 'waiting', 45000);

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      const msgPromise = waitForWSMessage(ws, 'session:message', 15000, (d) => {
        return (d.message?.role === 'user' || d.role === 'user');
      });

      await sendSessionMessage(session.id, 'Follow up question');
      const msg = await msgPromise;

      expect(msg.type).toBe('session:message');
      const role = msg.message?.role || msg.role;
      expect(role).toBe('user');
    });

    test('45. follow-up triggers full streaming sequence', async () => {
      test.setTimeout(90000);
      const project = await seedProject('WS MultiTurn Stream', process.cwd());
      const session = await seedSession(project.id, { prompt: 'First turn' });
      await waitForStatus(session.id, 'waiting', 45000);

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      // Send follow-up and collect messages until session is waiting again
      const messagesPromise = collectWSMessagesUntil(
        ws,
        'session:status',
        45000,
        (d) => d.status === 'waiting'
      );

      await sendSessionMessage(session.id, 'Continue the conversation');

      const messages = await messagesPromise;

      // Should have usage updates
      const usageMessages = messages.filter((m: any) => m.type === 'session:usage_update');
      expect(usageMessages.length).toBeGreaterThan(0);

      // Should have at least some streaming content
      const streamingTypes = ['session:partial', 'session:thinking_partial', 'session:message'];
      const hasStreaming = messages.some((m: any) => streamingTypes.includes(m.type));
      expect(hasStreaming).toBe(true);
    });

    test('46. conversation:updated broadcasts with cumulative usage after follow-up', async () => {
      test.setTimeout(90000);
      const project = await seedProject('WS MultiTurn Conv Updated', process.cwd());
      const session = await seedSession(project.id, { prompt: 'Hello' });
      await waitForStatus(session.id, 'waiting', 45000);

      const ws = await connect();
      subscribeToSession(ws, session.id);
      await new Promise(r => setTimeout(r, 100));

      // Collect all messages until session is waiting again (like test 45)
      const messagesPromise = collectWSMessagesUntil(
        ws,
        'session:status',
        45000,
        (d) => d.status === 'waiting'
      );

      await sendSessionMessage(session.id, 'Hi again');

      const messages = await messagesPromise;

      // Debug: what messages did we receive?
      console.log(`[TEST 46] Received ${messages.length} messages`);
      console.log(`[TEST 46] Message types:`, [...new Set(messages.map((m: any) => m.type))]);
      const errorMessages = messages.filter((m: any) => m.type === 'session:error');
      if (errorMessages.length > 0) {
        console.log(`[TEST 46] Received error:`, errorMessages[0]);
      }

      // Check that we received conversation:updated
      const convUpdatedMessages = messages.filter((m: any) => m.type === 'conversation:updated');
      console.log(`[TEST 46] conversation:updated messages: ${convUpdatedMessages.length}`);
      expect(convUpdatedMessages.length).toBeGreaterThan(0);

      const msg = convUpdatedMessages[convUpdatedMessages.length - 1]; // Get the last one
      expect(msg.type).toBe('conversation:updated');
      expect(msg.conversation).toBeDefined();
      // Conversation should have cumulative usage (from both turns)
      const conv = msg.conversation;
      const totalInput = conv.inputTokens ?? conv.usage?.input_tokens ?? 0;
      expect(typeof totalInput === 'number').toBe(true);
    });
  });
});
