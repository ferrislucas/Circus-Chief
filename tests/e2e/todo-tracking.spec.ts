import { test, expect } from '@playwright/test';
import {
  cleanupAll,
  seedProject,
  seedSession,
  seedTodos,
  getTodos,
  seedConversation,
  getConversations,
  navigateAndWait,
  waitForElement,
  openSessionOverlay,
} from './helpers';

test.describe('Todo Tracking — Category 1: API Tests', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    await cleanupAll();
    const project = await seedProject('todo-test', '/tmp/todo-test');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test todos',
      startImmediately: false,
    });
    sessionId = session.id;
  });

  test('GET /todos returns empty array when no todos exist', async () => {
    const todos = await getTodos(sessionId);
    expect(todos).toEqual([]);
  });

  test('GET /todos returns seeded todos with all fields', async () => {
    // Get the active conversation ID
    const conversations = await getConversations(sessionId);
    const activeConvId = conversations[0].id;

    // Seed todos
    const seeded = seedTodos(sessionId, activeConvId, [
      { content: 'Write unit tests', status: 'pending' },
      { content: 'Fix authentication bug', status: 'in_progress' },
      { content: 'Deploy to staging', status: 'completed' },
    ]);

    // Fetch todos via API
    const todos = await getTodos(sessionId, activeConvId);

    expect(todos).toHaveLength(3);
    expect(todos[0]).toMatchObject({
      id: seeded[0].id,
      sessionId: sessionId,
      conversationId: activeConvId,
      content: 'Write unit tests',
      status: 'pending',
      position: 0,
    });
    expect(todos[0]).toHaveProperty('updatedAt');
  });

  test('GET /todos returns todos ordered by position', async () => {
    const conversations = await getConversations(sessionId);
    const activeConvId = conversations[0].id;

    seedTodos(sessionId, activeConvId, [
      { content: 'Third todo', status: 'pending' },
      { content: 'First todo', status: 'pending' },
      { content: 'Second todo', status: 'pending' },
    ]);

    const todos = await getTodos(sessionId, activeConvId);

    expect(todos).toHaveLength(3);
    expect(todos[0].position).toBe(0);
    expect(todos[0].content).toBe('Third todo');
    expect(todos[1].position).toBe(1);
    expect(todos[2].position).toBe(2);
    expect(todos[2].content).toBe('Second todo');
  });

  test('GET /todos with conversation_id filters to specific conversation', async () => {
    // Create two conversations
    const convA = await seedConversation(sessionId, 'Conversation A');
    const convB = await seedConversation(sessionId, 'Conversation B');

    // Seed different todos for each
    seedTodos(sessionId, convA.id, [{ content: 'Todo A1', status: 'pending' }]);
    seedTodos(sessionId, convB.id, [{ content: 'Todo B1', status: 'pending' }]);

    // Fetch todos for convA
    const todosA = await getTodos(sessionId, convA.id);
    expect(todosA).toHaveLength(1);
    expect(todosA[0].content).toBe('Todo A1');

    // Fetch todos for convB
    const todosB = await getTodos(sessionId, convB.id);
    expect(todosB).toHaveLength(1);
    expect(todosB[0].content).toBe('Todo B1');
  });

  test('GET /todos without conversation_id returns active conversation todos', async () => {
    // Session auto-creates active conversation
    const conversations = await getConversations(sessionId);
    const activeConvId = conversations[0].id;

    seedTodos(sessionId, activeConvId, [
      { content: 'Active todo', status: 'pending' },
    ]);

    // Fetch without conversation_id parameter
    const todos = await getTodos(sessionId);
    expect(todos).toHaveLength(1);
    expect(todos[0].content).toBe('Active todo');
  });
});

test.describe('Todo Tracking — Category 2: Drawer Visibility', () => {
  let projectId: string;
  let sessionId: string;
  let conversationId: string;

  test.beforeEach(async () => {
    await cleanupAll();
    const project = await seedProject('todo-test', '/tmp/todo-test');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test todos',
      startImmediately: false,
    });
    sessionId = session.id;

    const conversations = await getConversations(sessionId);
    conversationId = conversations[0].id;
  });

  test('todo drawer is hidden when no todos exist', async ({ page }) => {
    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);
    const drawer = page.locator('.todo-drawer');
    await expect(drawer).not.toBeAttached();
  });

  test('todo drawer appears when todos exist', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Test todo', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);
    const drawer = page.locator('.todo-drawer');
    await expect(drawer).toBeVisible();
  });

  test('todo drawer shows "Todos" label', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Test todo', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);
    const label = page.locator('.todo-label');
    await expect(label).toContainText('Todos');
  });

  test('collapsed drawer shows preview chips for first 4 todos', async ({
    page,
  }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Todo 1', status: 'pending' },
      { content: 'Todo 2', status: 'pending' },
      { content: 'Todo 3', status: 'pending' },
      { content: 'Todo 4', status: 'pending' },
      { content: 'Todo 5', status: 'pending' },
      { content: 'Todo 6', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);
    const summary = page.locator('.todo-summary');
    await expect(summary).toBeVisible();

    const chips = summary.locator('.todo-chip');
    await expect(chips).toHaveCount(4);
  });

  test('collapsed drawer shows "+N more" when more than 4 todos', async ({
    page,
  }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Todo 1', status: 'pending' },
      { content: 'Todo 2', status: 'pending' },
      { content: 'Todo 3', status: 'pending' },
      { content: 'Todo 4', status: 'pending' },
      { content: 'Todo 5', status: 'pending' },
      { content: 'Todo 6', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);
    const moreIndicator = page.locator('.todo-more');
    await expect(moreIndicator).toContainText('(+2 more)');
  });
});

test.describe('Todo Tracking — Category 3: Todo Statuses Display', () => {
  let projectId: string;
  let sessionId: string;
  let conversationId: string;

  test.beforeEach(async () => {
    await cleanupAll();
    const project = await seedProject('todo-test', '/tmp/todo-test');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test todos',
      startImmediately: false,
    });
    sessionId = session.id;

    const conversations = await getConversations(sessionId);
    conversationId = conversations[0].id;
  });

  test('displays pending todo with empty circle icon', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Pending task', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Expand drawer
    await page.locator('.todo-header').click();

    const todoItem = page.locator('.todo-item.todo-pending');
    await expect(todoItem).toBeVisible();

    const icon = page.locator('.status-icon.status-pending');
    await expect(icon).toBeVisible();
  });

  test('displays in_progress todo with half-filled icon', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'In progress task', status: 'in_progress' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Expand drawer
    await page.locator('.todo-header').click();

    const todoItem = page.locator('.todo-item.todo-in_progress');
    await expect(todoItem).toBeVisible();

    const icon = page.locator('.status-icon.status-in_progress');
    await expect(icon).toBeVisible();
  });

  test('displays completed todo with solid icon and strikethrough', async ({
    page,
  }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Completed task', status: 'completed' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Expand drawer
    await page.locator('.todo-header').click();

    const todoItem = page.locator('.todo-item.todo-completed');
    await expect(todoItem).toBeVisible();

    const icon = page.locator('.status-icon.status-completed');
    await expect(icon).toBeVisible();

    const content = todoItem.locator('.todo-content');
    await expect(content).toHaveCSS('text-decoration', 'line-through');
  });

  test('displays completed todo with reduced opacity', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Completed task', status: 'completed' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Expand drawer
    await page.locator('.todo-header').click();

    const todoItem = page.locator('.todo-item.todo-completed');
    const opacity = await todoItem.evaluate((el) => {
      return window.getComputedStyle(el).opacity;
    });
    expect(parseFloat(opacity)).toBe(0.6);
  });

  test('displays mixed statuses correctly', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Pending task', status: 'pending' },
      { content: 'In progress task', status: 'in_progress' },
      { content: 'Completed task', status: 'completed' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Expand drawer
    await page.locator('.todo-header').click();

    const pending = page.locator('.todo-item.todo-pending');
    const inProgress = page.locator('.todo-item.todo-in_progress');
    const completed = page.locator('.todo-item.todo-completed');

    await expect(pending).toBeVisible();
    await expect(inProgress).toBeVisible();
    await expect(completed).toBeVisible();

    await expect(pending.locator('.todo-content')).toContainText('Pending task');
    await expect(inProgress.locator('.todo-content')).toContainText(
      'In progress task'
    );
    await expect(completed.locator('.todo-content')).toContainText(
      'Completed task'
    );
  });
});

test.describe('Todo Tracking — Category 4: Expand/Collapse Behavior', () => {
  let projectId: string;
  let sessionId: string;
  let conversationId: string;

  test.beforeEach(async () => {
    await cleanupAll();
    const project = await seedProject('todo-test', '/tmp/todo-test');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test todos',
      startImmediately: false,
    });
    sessionId = session.id;

    const conversations = await getConversations(sessionId);
    conversationId = conversations[0].id;
  });

  test('drawer starts collapsed with preview chips visible', async ({
    page,
  }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Test todo', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    const summary = page.locator('.todo-summary');
    await expect(summary).toBeVisible();

    const todoList = page.locator('.todo-list');
    await expect(todoList).not.toBeVisible();
  });

  test('clicking header expands drawer to show full list', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Test todo', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Click header to expand
    await page.locator('.todo-header').click();

    const todoList = page.locator('.todo-list');
    await expect(todoList).toBeVisible();

    const summary = page.locator('.todo-summary');
    await expect(summary).not.toBeVisible();
  });

  test('expanded drawer shows status counts in header', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Completed 1', status: 'completed' },
      { content: 'Completed 2', status: 'completed' },
      { content: 'In progress', status: 'in_progress' },
      { content: 'Pending', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Click header to expand
    await page.locator('.todo-header').click();

    const completedCount = page.locator('.count.completed');
    await expect(completedCount).toContainText('2 done');

    const inProgressCount = page.locator('.count.in-progress');
    await expect(inProgressCount).toContainText('1 active');

    const pendingCount = page.locator('.count.pending');
    await expect(pendingCount).toContainText('1 pending');
  });

  test('clicking header again collapses drawer', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Test todo', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Click to expand
    await page.locator('.todo-header').click();
    await expect(page.locator('.todo-list')).toBeVisible();

    // Click to collapse
    await page.locator('.todo-header').click();
    await expect(page.locator('.todo-list')).not.toBeVisible();
    await expect(page.locator('.todo-summary')).toBeVisible();
  });

  test('expanded list shows all todos with full content', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'First todo item', status: 'pending' },
      { content: 'Second todo item', status: 'in_progress' },
      { content: 'Third todo item', status: 'completed' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Expand drawer
    await page.locator('.todo-header').click();

    const todoItems = page.locator('.todo-item');
    await expect(todoItems).toHaveCount(3);

    await expect(todoItems.nth(0).locator('.todo-content')).toContainText(
      'First todo item'
    );
    await expect(todoItems.nth(1).locator('.todo-content')).toContainText(
      'Second todo item'
    );
    await expect(todoItems.nth(2).locator('.todo-content')).toContainText(
      'Third todo item'
    );
  });
});

test.describe('Todo Tracking — Category 5: Per-Conversation Scoping', () => {
  let projectId: string;
  let sessionId: string;

  test.beforeEach(async () => {
    await cleanupAll();
    const project = await seedProject('todo-test', '/tmp/todo-test');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test todos',
      startImmediately: false,
    });
    sessionId = session.id;
  });

  test('todos are scoped to active conversation via API', async () => {
    const convA = await seedConversation(sessionId, 'Conversation A');
    const convB = await seedConversation(sessionId, 'Conversation B');

    seedTodos(sessionId, convA.id, [{ content: 'Todo A', status: 'pending' }]);
    seedTodos(sessionId, convB.id, [{ content: 'Todo B', status: 'pending' }]);

    const todosA = await getTodos(sessionId, convA.id);
    const todosB = await getTodos(sessionId, convB.id);

    expect(todosA).toHaveLength(1);
    expect(todosA[0].content).toBe('Todo A');
    expect(todosB).toHaveLength(1);
    expect(todosB[0].content).toBe('Todo B');
  });

  test('different conversations show different todos in API', async () => {
    const convA = await seedConversation(sessionId, 'Conversation A');
    const convB = await seedConversation(sessionId, 'Conversation B');

    seedTodos(sessionId, convA.id, [
      { content: 'Todo A1', status: 'pending' },
      { content: 'Todo A2', status: 'pending' },
      { content: 'Todo A3', status: 'pending' },
    ]);
    seedTodos(sessionId, convB.id, [
      { content: 'Todo B1', status: 'pending' },
      { content: 'Todo B2', status: 'pending' },
    ]);

    const todosA = await getTodos(sessionId, convA.id);
    const todosB = await getTodos(sessionId, convB.id);

    expect(todosA).toHaveLength(3);
    expect(todosB).toHaveLength(2);
  });

  test('empty conversation returns empty todos', async () => {
    const convA = await seedConversation(sessionId, 'Conversation A');
    const convB = await seedConversation(sessionId, 'Conversation B');

    seedTodos(sessionId, convA.id, [{ content: 'Todo A', status: 'pending' }]);

    const todosB = await getTodos(sessionId, convB.id);
    expect(todosB).toEqual([]);
  });

  test('clearing todos for one conversation does not affect another', async () => {
    const convA = await seedConversation(sessionId, 'Conversation A');
    const convB = await seedConversation(sessionId, 'Conversation B');

    seedTodos(sessionId, convA.id, [{ content: 'Todo A', status: 'pending' }]);
    seedTodos(sessionId, convB.id, [{ content: 'Todo B', status: 'pending' }]);

    // Clear convA todos by seeding empty array
    seedTodos(sessionId, convA.id, []);

    const todosA = await getTodos(sessionId, convA.id);
    const todosB = await getTodos(sessionId, convB.id);

    expect(todosA).toEqual([]);
    expect(todosB).toHaveLength(1);
    expect(todosB[0].content).toBe('Todo B');
  });
});

test.describe('Todo Tracking — Category 6: Text Handling', () => {
  let projectId: string;
  let sessionId: string;
  let conversationId: string;

  test.beforeEach(async () => {
    await cleanupAll();
    const project = await seedProject('todo-test', '/tmp/todo-test');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test todos',
      startImmediately: false,
    });
    sessionId = session.id;

    const conversations = await getConversations(sessionId);
    conversationId = conversations[0].id;
  });

  test('collapsed preview truncates long text to 20 chars', async ({ page }) => {
    const longText = 'Implement user authentication flow';
    seedTodos(sessionId, conversationId, [
      { content: longText, status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    const chipText = page.locator('.todo-chip .todo-text');
    await expect(chipText).toContainText('Implement user authe...');
  });

  test('short text is not truncated in preview', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Fix bug', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    const chipText = page.locator('.todo-chip .todo-text');
    await expect(chipText).toContainText('Fix bug');
    await expect(chipText).not.toContainText('...');
  });

  test('expanded list shows full untruncated content', async ({ page }) => {
    const longText = 'Implement user authentication flow';
    seedTodos(sessionId, conversationId, [
      { content: longText, status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Expand drawer
    await page.locator('.todo-header').click();

    const todoContent = page.locator('.todo-item .todo-content');
    await expect(todoContent).toContainText(longText);
    await expect(todoContent).not.toContainText('...');
  });
});

test.describe('Todo Tracking — Category 7: Edge Cases & Empty States', () => {
  let projectId: string;
  let sessionId: string;
  let conversationId: string;

  test.beforeEach(async () => {
    await cleanupAll();
    const project = await seedProject('todo-test', '/tmp/todo-test');
    projectId = project.id;
    const session = await seedSession(projectId, {
      prompt: 'Test todos',
      startImmediately: false,
    });
    sessionId = session.id;

    const conversations = await getConversations(sessionId);
    conversationId = conversations[0].id;
  });

  test('drawer hidden when all todos are cleared', async ({ page }) => {
    // Seed todos first
    seedTodos(sessionId, conversationId, [
      { content: 'Test todo', status: 'pending' },
    ]);

    // Verify they exist in DB
    let todos = await getTodos(sessionId, conversationId);
    expect(todos).toHaveLength(1);

    // Clear by seeding empty array
    seedTodos(sessionId, conversationId, []);

    // Verify cleared
    todos = await getTodos(sessionId, conversationId);
    expect(todos).toEqual([]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);
    const drawer = page.locator('.todo-drawer');
    await expect(drawer).not.toBeAttached();
  });

  test('single todo shows 1 chip and no "+N more"', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Only todo', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    const chips = page.locator('.todo-chip');
    await expect(chips).toHaveCount(1);

    const moreIndicator = page.locator('.todo-more');
    await expect(moreIndicator).not.toBeVisible();
  });

  test('exactly 4 todos shows 4 chips and no "+N more"', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Todo 1', status: 'pending' },
      { content: 'Todo 2', status: 'pending' },
      { content: 'Todo 3', status: 'pending' },
      { content: 'Todo 4', status: 'pending' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    const chips = page.locator('.todo-chip');
    await expect(chips).toHaveCount(4);

    const moreIndicator = page.locator('.todo-more');
    await expect(moreIndicator).not.toBeVisible();
  });

  test('status counts hide zero-count categories', async ({ page }) => {
    seedTodos(sessionId, conversationId, [
      { content: 'Completed 1', status: 'completed' },
      { content: 'Completed 2', status: 'completed' },
    ]);

    await navigateAndWait(page, `/sessions/${sessionId}/summary`);
    await openSessionOverlay(page);

    // Expand drawer
    await page.locator('.todo-header').click();

    const completedCount = page.locator('.count.completed');
    await expect(completedCount).toBeVisible();

    const inProgressCount = page.locator('.count.in-progress');
    await expect(inProgressCount).not.toBeVisible();

    const pendingCount = page.locator('.count.pending');
    await expect(pendingCount).not.toBeVisible();
  });
});
