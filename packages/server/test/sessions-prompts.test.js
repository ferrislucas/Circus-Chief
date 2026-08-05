import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import sessionsRouter from '../src/api/sessions.js';
import { projects, sessions } from '../src/database.js';
import { cancelPrompt, getPrompt, parkPrompt } from '../src/services/promptStore.js';

describe('session prompt responses', () => {
  it('rejects invalid answers without consuming the pending prompt', async () => {
    const project = projects.create('Prompt project', '/tmp/prompts');
    const session = sessions.create(project.id, 'Prompt session', 'Ask a question');
    const promptPromise = parkPrompt({
      sessionId: session.id,
      conversationId: 'conversation-1',
      kind: 'question',
      payload: {
        input: { questions: [{ question: 'Deploy where?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }] },
        questions: [{ question: 'Deploy where?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }],
      },
    });
    const prompt = getPrompt(session.id);
    const app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    const invalid = await request(app)
      .post(`/api/sessions/${session.id}/prompt/${prompt.id}/respond`)
      .send({ action: 'answer', answers: { 'Deploy where?': ['Production'], unexpected: ['value'] } });

    expect(invalid.status).toBe(422);
    expect(getPrompt(session.id)?.id).toBe(prompt.id);

    const valid = await request(app)
      .post(`/api/sessions/${session.id}/prompt/${prompt.id}/respond`)
      .send({ action: 'answer', answers: { 'Deploy where?': ['Production'] } });

    expect(valid.status).toBe(200);
    await expect(promptPromise).resolves.toMatchObject({ behavior: 'allow' });
    cancelPrompt(session.id);
  });
});
