import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { databaseManager } from '../src/db/DatabaseManager.js';
import { projects, sessions, messages } from '../src/database.js';

describe('Draft Session Prompt Editing', () => {
  let projectId;
  let sessionId;
  let messageId;

  beforeEach(async () => {
    // Initialize in-memory database
    databaseManager.init(':memory:');

    // Create a test project
    const project = projects.create('Test Project', '/tmp/test-project');
    projectId = project.id;

    // Create a draft session (waiting status, no responses)
    const session = sessions.create(projectId, 'Draft Session', 'standard');
    sessionId = session.id;

    // Create initial user message (the prompt)
    const message = messages.create(sessionId, 'user', 'Write a simple function');
    messageId = message.id;
  });

  afterEach(() => {
    databaseManager.close();
  });

  describe('PUT /api/sessions/:id/initial-prompt', () => {
    it('should update the initial prompt for a draft session', async () => {
      const newPrompt = 'Write a more complex function';

      const response = await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({ prompt: newPrompt })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message.content).toBe(newPrompt);

      // Verify the message was updated in the database
      const updatedMessage = messages.getById(messageId);
      expect(updatedMessage.content).toBe(newPrompt);
    });

    it('should reject if session not found', async () => {
      const response = await request(app)
        .put('/api/sessions/nonexistent/initial-prompt')
        .send({ prompt: 'New prompt' })
        .expect(404);

      expect(response.body.error).toBeDefined();
    });

    it('should reject if session is not in waiting status', async () => {
      // Update session to running status
      sessions.update(sessionId, { status: 'running' });

      const response = await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({ prompt: 'New prompt' })
        .expect(400);

      expect(response.body.error).toMatch(/waiting status/i);
    });

    it('should reject if session has assistant messages', async () => {
      // Add an assistant message
      messages.create(sessionId, 'assistant', 'This is a response');

      const response = await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({ prompt: 'New prompt' })
        .expect(400);

      expect(response.body.error).toMatch(/not a draft/i);
    });

    it('should reject if prompt is empty', async () => {
      const response = await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({ prompt: '' })
        .expect(400);

      expect(response.body.error).toMatch(/non-empty/i);
    });

    it('should reject if prompt is missing', async () => {
      const response = await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({})
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    it('should reject if prompt is not a string', async () => {
      const response = await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({ prompt: 12345 })
        .expect(400);

      expect(response.body.error).toMatch(/non-empty string/i);
    });
  });

  describe('POST /api/sessions/:id/start with optional prompt', () => {
    it('should start session with provided prompt', async () => {
      const newPrompt = 'Updated prompt for session start';

      const response = await request(app)
        .post(`/api/sessions/${sessionId}/start`)
        .send({ prompt: newPrompt })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.session.status).toBe('starting');

      // Verify the message was updated
      const updatedMessage = messages.getById(messageId);
      expect(updatedMessage.content).toBe(newPrompt);
    });

    it('should start session with original prompt if not provided', async () => {
      const originalPrompt = 'Write a simple function';

      const response = await request(app)
        .post(`/api/sessions/${sessionId}/start`)
        .send({})
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.session.status).toBe('starting');

      // Verify the original message was not changed
      const message = messages.getById(messageId);
      expect(message.content).toBe(originalPrompt);
    });

    it('should reject if provided prompt is empty', async () => {
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/start`)
        .send({ prompt: '' })
        .expect(400);

      expect(response.body.error).toMatch(/non-empty string/i);
    });

    it('should reject if session is not in waiting status', async () => {
      sessions.update(sessionId, { status: 'running' });

      const response = await request(app)
        .post(`/api/sessions/${sessionId}/start`)
        .send({ prompt: 'New prompt' })
        .expect(400);

      expect(response.body.error).toMatch(/waiting status/i);
    });

    it('should handle multiple prompt updates before starting', async () => {
      const firstUpdate = 'First update';
      const secondUpdate = 'Second update';
      const thirdUpdate = 'Final prompt';

      // Update prompt multiple times
      await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({ prompt: firstUpdate })
        .expect(200);

      await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({ prompt: secondUpdate })
        .expect(200);

      // Start with a different prompt
      const response = await request(app)
        .post(`/api/sessions/${sessionId}/start`)
        .send({ prompt: thirdUpdate })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Final message should have the third update
      const updatedMessage = messages.getById(messageId);
      expect(updatedMessage.content).toBe(thirdUpdate);
    });
  });

  describe('Edge Cases', () => {
    it('should handle prompts with special characters', async () => {
      const specialPrompt = 'Write code with "quotes" and \'apostrophes\' and \n newlines';

      const response = await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({ prompt: specialPrompt })
        .expect(200);

      expect(response.body.message.content).toBe(specialPrompt);

      const updatedMessage = messages.getById(messageId);
      expect(updatedMessage.content).toBe(specialPrompt);
    });

    it('should handle very long prompts', async () => {
      const longPrompt = 'Write code that does this: ' + 'detailed requirement '.repeat(500);

      const response = await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({ prompt: longPrompt })
        .expect(200);

      expect(response.body.message.content).toBe(longPrompt);

      const updatedMessage = messages.getById(messageId);
      expect(updatedMessage.content).toBe(longPrompt);
    });

    it('should handle prompts with only whitespace', async () => {
      const response = await request(app)
        .put(`/api/sessions/${sessionId}/initial-prompt`)
        .send({ prompt: '   \n\t   ' })
        .expect(400);

      expect(response.body.error).toMatch(/non-empty/i);
    });
  });
});
