import { test, expect } from '@playwright/test';
import {
  seedProject,
  seedSession,
  seedChildSession,
  seedCanvasItem,
  seedSessionNote,
  cleanupCreatedResources,
  getSession,
  getProjectSessions,
  deleteSession,
  getAPIURL,
} from './helpers';

test.describe('Child Session Cascade Delete', () => {
  let project: any;

  test.beforeEach(async () => {
    project = await seedProject('Cascade Delete Project', '/tmp/test');
  });

  test.afterEach(async () => {
    await cleanupCreatedResources();
  });

  test('deleting a parent session also deletes its direct children', async () => {
    // Create parent session
    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: 'Parent',
      startImmediately: false,
    });

    // Create two child sessions
    const child1 = await seedChildSession(project.id, parent.id, {
      prompt: 'Child session 1',
      name: 'Child 1',
    });
    const child2 = await seedChildSession(project.id, parent.id, {
      prompt: 'Child session 2',
      name: 'Child 2',
    });

    // Verify all sessions exist
    expect(await getSession(parent.id)).toBeTruthy();
    expect(await getSession(child1.id)).toBeTruthy();
    expect(await getSession(child2.id)).toBeTruthy();

    // Delete the parent
    await deleteSession(parent.id);

    // Verify parent is gone
    expect(await getSession(parent.id)).toBeNull();

    // Verify children are also deleted
    expect(await getSession(child1.id)).toBeNull();
    expect(await getSession(child2.id)).toBeNull();
  });

  test('deleting a parent session cascades to grandchildren', async () => {
    // Create a 3-level hierarchy: grandparent → parent → child
    const grandparent = await seedSession(project.id, {
      prompt: 'Grandparent session',
      name: 'Grandparent',
      startImmediately: false,
    });

    const parent = await seedChildSession(project.id, grandparent.id, {
      prompt: 'Parent session',
      name: 'Parent',
    });

    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Grandchild session',
      name: 'Grandchild',
    });

    // Verify all exist
    expect(await getSession(grandparent.id)).toBeTruthy();
    expect(await getSession(parent.id)).toBeTruthy();
    expect(await getSession(child.id)).toBeTruthy();

    // Delete the grandparent
    await deleteSession(grandparent.id);

    // All should be deleted
    expect(await getSession(grandparent.id)).toBeNull();
    expect(await getSession(parent.id)).toBeNull();
    expect(await getSession(child.id)).toBeNull();
  });

  test('deleting a parent cascades child session data (canvas, notes)', async () => {
    const parent = await seedSession(project.id, {
      prompt: 'Parent with data',
      name: 'Parent',
      startImmediately: false,
    });

    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child with data',
      name: 'Child',
    });

    // Add data to the child session
    await seedCanvasItem(child.id, {
      type: 'markdown',
      content: '# Child canvas item',
      filename: 'child.md',
    });
    await seedSessionNote(child.id, { content: 'Child note' });

    // Delete parent
    await deleteSession(parent.id);

    // Child should be gone (404 from session lookup)
    const childResponse = await fetch(`${getAPIURL()}/api/sessions/${child.id}`);
    expect(childResponse.status).toBe(404);

    // Canvas items for the child should also be gone
    const canvasResponse = await fetch(`${getAPIURL()}/api/sessions/${child.id}/canvas`);
    expect(canvasResponse.status).toBe(404);

    // Notes for the child should also be gone
    const notesResponse = await fetch(`${getAPIURL()}/api/sessions/${child.id}/notes`);
    expect(notesResponse.status).toBe(404);
  });

  test('deleting a child session does not delete the parent', async () => {
    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: 'Parent',
      startImmediately: false,
    });

    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child session',
      name: 'Child',
    });

    // Delete only the child
    await deleteSession(child.id);

    // Child should be gone
    expect(await getSession(child.id)).toBeNull();

    // Parent should still exist
    const parentData = await getSession(parent.id);
    expect(parentData).toBeTruthy();
    expect(parentData.id).toBe(parent.id);
  });

  test('deleting a parent only deletes its own children, not siblings', async () => {
    // Create two independent parent sessions
    const parent1 = await seedSession(project.id, {
      prompt: 'Parent 1',
      name: 'Parent 1',
      startImmediately: false,
    });
    const parent2 = await seedSession(project.id, {
      prompt: 'Parent 2',
      name: 'Parent 2',
      startImmediately: false,
    });

    // Each parent has a child
    const child1 = await seedChildSession(project.id, parent1.id, {
      prompt: 'Child of Parent 1',
      name: 'Child 1',
    });
    const child2 = await seedChildSession(project.id, parent2.id, {
      prompt: 'Child of Parent 2',
      name: 'Child 2',
    });

    // Delete parent1
    await deleteSession(parent1.id);

    // Parent1 and its child should be gone
    expect(await getSession(parent1.id)).toBeNull();
    expect(await getSession(child1.id)).toBeNull();

    // Parent2 and its child should still exist
    expect(await getSession(parent2.id)).toBeTruthy();
    expect(await getSession(child2.id)).toBeTruthy();
  });

  test('deleting a parent removes children from project session list', async () => {
    const parent = await seedSession(project.id, {
      prompt: 'Parent session',
      name: 'Parent Session',
      startImmediately: false,
    });

    const child = await seedChildSession(project.id, parent.id, {
      prompt: 'Child session',
      name: 'Child Session',
    });

    // Verify both appear in project session list
    const sessionsBefore = await getProjectSessions(project.id);
    const idsBefore = sessionsBefore.map((s: any) => s.id);
    expect(idsBefore).toContain(parent.id);
    expect(idsBefore).toContain(child.id);

    // Delete parent
    await deleteSession(parent.id);

    // Verify neither appears in project session list
    const sessionsAfter = await getProjectSessions(project.id);
    const idsAfter = sessionsAfter.map((s: any) => s.id);
    expect(idsAfter).not.toContain(parent.id);
    expect(idsAfter).not.toContain(child.id);
  });
});
