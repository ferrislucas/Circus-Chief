/**
 * Session Lifecycle Integration Tests
 *
 * Tests session lifecycle actions (duplicate, stop, restart) via the API
 * without a browser. Converted from the 5 API-only tests in
 * tests/e2e/session-actions.spec.ts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  seedProject,
  seedSession,
  getSession,
  updateSessionStatus,
  duplicateSession,
  stopSession,
  seedCanvasItem,
  getCanvasItems,
  seedSessionNote,
  getSessionNotes,
  apiFetch,
  getBaseUrl,
} from './setup.js';

// ============================================================
// Helper: fetch canvas file content
// ============================================================

/**
 * Get the content of a canvas file by filename.
 */
async function getCanvasFileContent(sessionId, filename) {
  const encoded = encodeURIComponent(filename);
  const response = await fetch(
    `${getBaseUrl()}/api/sessions/${sessionId}/canvas/file/${encoded}/content`
  );
  if (!response.ok) return null;
  return response.json();
}

// ============================================================
// Duplicate Session
// ============================================================

describe('Duplicate Session (lifecycle)', () => {
  let project;

  beforeEach(async () => {
    project = await seedProject('Lifecycle Test Project', '/tmp/test');
  });

  it('duplicated session preserves canvas items', async () => {
    const session = await seedSession(project.id, {
      prompt: 'Session with canvas',
      name: 'Session with canvas',
    });

    // Add a canvas item (filename is required for inline content mode)
    await seedCanvasItem(session.id, {
      type: 'markdown',
      content: '# Test Canvas Item',
      filename: 'test.md',
    });

    // Duplicate via API
    const duplicated = await duplicateSession(session.id);

    // Verify new session has canvas items
    const canvasItems = await getCanvasItems(duplicated.id);
    expect(canvasItems.length).toBe(1);
    const itemContent = await getCanvasFileContent(duplicated.id, canvasItems[0].filename);
    expect(itemContent.content).toBe('# Test Canvas Item');
  });

  it('duplicated session preserves notes', async () => {
    const session = await seedSession(project.id, {
      prompt: 'Session with notes',
      name: 'Session with notes',
    });

    // Add a note
    await seedSessionNote(session.id, {
      content: 'Test note content',
    });

    // Duplicate via API
    const duplicated = await duplicateSession(session.id);

    // Verify note was copied
    const notes = await getSessionNotes(duplicated.id);
    expect(notes.length).toBe(1);
    expect(notes[0].content).toBe('Test note content');
  });
});

// ============================================================
// Stop / Restart Session
// ============================================================

describe('Stop / Restart Session (lifecycle)', () => {
  let project;

  beforeEach(async () => {
    project = await seedProject('Lifecycle Test Project', '/tmp/test');
  });

  it('stop endpoint changes status to stopped', async () => {
    const session = await seedSession(project.id, {
      prompt: 'Running session',
      name: 'Running Session',
      startImmediately: false,
    });

    // Update status to running (no actual agent process)
    await updateSessionStatus(session.id, 'running');

    // Call stop API
    await stopSession(session.id);

    // Verify status is stopped
    const stoppedSession = await getSession(session.id);
    expect(stoppedSession.status).toBe('stopped');
  });

  it('restart endpoint clears error state back to stopped', async () => {
    const session = await seedSession(project.id, {
      prompt: 'Error session',
      name: 'Error Session',
      startImmediately: false,
    });

    // Set session to error state (the state restart is designed to recover from)
    await updateSessionStatus(session.id, 'error');

    // Call restart API
    const response = await apiFetch(`/api/sessions/${session.id}/restart`, {
      method: 'POST',
    });

    // Verify restart was accepted (200 OK)
    expect(response.ok).toBe(true);

    // restartSession clears the error and sets status to 'stopped',
    // which allows the user to send new messages to the session
    const restartedSession = await getSession(session.id);
    expect(restartedSession).toBeTruthy();
    expect(restartedSession.status).toBe('stopped');
  });

  it('cannot stop already stopped session', async () => {
    const session = await seedSession(project.id, {
      prompt: 'Stopped session',
      name: 'Stopped Session',
      startImmediately: false,
    });

    // Set status to stopped
    await updateSessionStatus(session.id, 'stopped');

    // Try to stop again - expect error
    await expect(stopSession(session.id)).rejects.toThrow();
  });
});
