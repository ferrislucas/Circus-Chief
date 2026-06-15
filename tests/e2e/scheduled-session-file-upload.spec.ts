import { test, expect } from '@playwright/test';
import {
  seedProject,
  cleanupAll,
  getSession,
  getSessionAttachments,
  getSessionMessages,
  API_URL,
} from './helpers';

/**
 * Test for bug: File uploads are lost when scheduling a session to start later.
 *
 * When a user uploads files AND schedules a session for the future, the files
 * should be persisted as attachments on the session so they are available when
 * the scheduled session eventually starts.
 *
 * The bug: creating a session via multipart/form-data with both files and a
 * future scheduledAt results in the file attachments not being stored / being
 * lost by the time the session starts.
 */
test.describe('Scheduled Session File Upload', () => {
  test.describe.configure({ timeout: 60000 });

  let project: any;

  test.beforeEach(async () => {
    await cleanupAll();
    project = await seedProject('Scheduled Upload Test', '/tmp/scheduled-upload-test');
  });

  test.afterEach(async () => {
    await cleanupAll();
  });

  /**
   * Core regression test: upload a file while scheduling a session for later,
   * then verify the attachment is persisted.
   */
  test('file attachments are preserved when session is scheduled for later', async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString(); // 1 hour from now
    const testFileContent = 'This file should survive scheduling';

    // Create a scheduled session WITH a file attachment using multipart/form-data
    const formData = new FormData();
    formData.append('prompt', 'Analyze the attached file');
    formData.append('scheduledAt', futureTime);
    formData.append('startImmediately', 'false');

    const blob = new Blob([testFileContent], { type: 'text/plain' });
    formData.append('files', blob, 'scheduled-file.txt');

    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      body: formData,
    });

    expect(response.ok).toBe(true);
    const session = await response.json();
    expect(session.id).toBeTruthy();

    // Verify session is in 'scheduled' status
    const sessionData = await getSession(session.id);
    expect(sessionData.status).toBe('scheduled');
    expect(sessionData.scheduledAt).toBeTruthy();

    // CRITICAL ASSERTION: The file attachment must be stored in the database
    // even though the session hasn't started yet.
    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(1);
    expect(attachments[0].filename).toBe('scheduled-file.txt');
    expect(attachments[0].mimeType).toBe('text/plain');
  });

  /**
   * Verify multiple files are preserved when scheduling.
   */
  test('multiple file attachments are preserved when session is scheduled', async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();

    const formData = new FormData();
    formData.append('prompt', 'Review all attached files');
    formData.append('scheduledAt', futureTime);
    formData.append('startImmediately', 'false');

    formData.append('files', new Blob(['File 1 content'], { type: 'text/plain' }), 'file1.txt');
    formData.append('files', new Blob(['{"key":"value"}'], { type: 'application/json' }), 'data.json');
    formData.append('files', new Blob(['# README'], { type: 'text/markdown' }), 'readme.md');

    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      body: formData,
    });

    expect(response.ok).toBe(true);
    const session = await response.json();

    const sessionData = await getSession(session.id);
    expect(sessionData.status).toBe('scheduled');

    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(3);

    const filenames = attachments.map((a: any) => a.filename);
    expect(filenames).toContain('file1.txt');
    expect(filenames).toContain('data.json');
    expect(filenames).toContain('readme.md');
  });

  /**
   * Verify the pending prompt is stored alongside the attachments.
   */
  test('pending prompt and attachments are both stored for scheduled session', async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    const promptText = 'Analyze these important files when the time comes';

    const formData = new FormData();
    formData.append('prompt', promptText);
    formData.append('scheduledAt', futureTime);
    formData.append('startImmediately', 'false');
    formData.append('files', new Blob(['important data'], { type: 'text/plain' }), 'important.txt');

    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      body: formData,
    });

    expect(response.ok).toBe(true);
    const session = await response.json();

    // Verify session state
    const sessionData = await getSession(session.id);
    expect(sessionData.status).toBe('scheduled');
    expect(sessionData.pendingPrompt).toBe(promptText);

    // Verify attachment survived
    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(1);
    expect(attachments[0].filename).toBe('important.txt');
  });

  /**
   * Contrast test: verify that immediate-start sessions with files still work
   * (to confirm the test infrastructure is correct).
   */
  test('file attachments work for immediate-start sessions (control test)', async () => {
    const formData = new FormData();
    formData.append('prompt', 'Analyze this file right now');
    // No scheduledAt — session starts immediately

    const blob = new Blob(['immediate file content'], { type: 'text/plain' });
    formData.append('files', blob, 'immediate-file.txt');

    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      body: formData,
    });

    expect(response.ok).toBe(true);
    const session = await response.json();
    expect(session.id).toBeTruthy();

    // For immediate sessions, attachments should also be stored
    const attachments = await getSessionAttachments(session.id);
    expect(attachments.length).toBe(1);
    expect(attachments[0].filename).toBe('immediate-file.txt');
  });

  test('started scheduled session links uploaded attachments to the initial user message', async () => {
    const serverInfoResponse = await fetch(`${API_URL}/api/server-info`);
    const serverInfo = await serverInfoResponse.json();
    test.skip(!serverInfo.schedulerRunning, 'Scheduler is disabled for this test server');

    const scheduledTime = new Date(Date.now() + 1000).toISOString();
    const promptText = 'Analyze the scheduled attachment after start';

    const formData = new FormData();
    formData.append('prompt', promptText);
    formData.append('scheduledAt', scheduledTime);
    formData.append('startImmediately', 'false');
    formData.append('files', new Blob(['scheduler file content'], { type: 'text/plain' }), 'scheduler-file.txt');

    const response = await fetch(`${API_URL}/api/projects/${project.id}/sessions`, {
      method: 'POST',
      body: formData,
    });

    expect(response.ok).toBe(true);
    const session = await response.json();
    expect(session.status).toBe('scheduled');

    let userMessage: any = null;
    const start = Date.now();
    while (Date.now() - start < 45000) {
      const messages = await getSessionMessages(session.id);
      userMessage = messages.find((message: any) => message.role === 'user');
      if (userMessage?.attachments?.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    expect(userMessage).toBeTruthy();
    expect(userMessage.content).toBe(promptText);
    expect(userMessage.attachments).toHaveLength(1);
    expect(userMessage.attachments[0].filename).toBe('scheduler-file.txt');
  });
});
