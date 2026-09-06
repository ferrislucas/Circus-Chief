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

    const blankCustomAnswer = await request(app)
      .post(`/api/sessions/${session.id}/prompt/${prompt.id}/respond`)
      .send({ action: 'answer', answers: { 'Deploy where?': [] }, customAnswers: { 'Deploy where?': '   ' } });

    expect(blankCustomAnswer.status).toBe(422);
    expect(getPrompt(session.id)?.id).toBe(prompt.id);

    const valid = await request(app)
      .post(`/api/sessions/${session.id}/prompt/${prompt.id}/respond`)
      .send({ action: 'answer', answers: { 'Deploy where?': ['Production'] } });

    expect(valid.status).toBe(200);
    await expect(promptPromise).resolves.toMatchObject({ behavior: 'allow' });
    cancelPrompt(session.id);
  });

  it('preserves meaningful custom-answer whitespace through the response API', async () => {
    const project = projects.create('Whitespace project', '/tmp/prompts');
    const session = sessions.create(project.id, 'Whitespace session', 'Ask a question');
    const promptPromise = parkPrompt({
      sessionId: session.id, conversationId: 'conversation-2', kind: 'question',
      payload: {
        input: { questions: [{ question: 'Deploy where?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }] },
        questions: [{ question: 'Deploy where?', options: [{ label: 'Staging' }, { label: 'Production' }], multiSelect: false }],
      },
    });
    const prompt = getPrompt(session.id);
    const app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    const response = await request(app)
      .post(`/api/sessions/${session.id}/prompt/${prompt.id}/respond`)
      .send({ action: 'answer', answers: { 'Deploy where?': [] }, customAnswers: { 'Deploy where?': '  Preview deployment  ' } });

    expect(response.status).toBe(200);
    await expect(promptPromise).resolves.toMatchObject({
      updatedInput: { answers: { 'Deploy where?': '  Preview deployment  ' } },
    });
  });

  it('keeps an interaction answer scoped to its prompt session and rejects unknown option ids', async () => {
    const project = projects.create('Interaction scope project', '/tmp/prompts');
    const session = sessions.create(project.id, 'Interactive prompt', 'Ask a question');
    const otherSession = sessions.create(project.id, 'Other session', 'Do unrelated work');
    const promptPromise = parkPrompt({
      sessionId: session.id, conversationId: 'conversation-3', provider: 'codex', externalRequestId: 'rpc-1', kind: 'question',
      payload: { questions: [{ id: 'environment', question: 'Deploy where?', mode: 'single', required: true, allowOther: false, options: [{ id: 'staging', label: 'Staging' }] }] },
    });
    const prompt = getPrompt(session.id);
    const app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    const crossSession = await request(app)
      .post(`/api/sessions/${otherSession.id}/prompt/${prompt.id}/respond`)
      .send({ action: 'answer', answers: [{ questionId: 'environment', selectedOptionIds: ['staging'] }] });
    expect(crossSession.status).toBe(409);

    const unknownOption = await request(app)
      .post(`/api/sessions/${session.id}/prompt/${prompt.id}/respond`)
      .send({ action: 'answer', answers: [{ questionId: 'environment', selectedOptionIds: ['production'] }] });
    expect(unknownOption.status).toBe(422);
    expect(getPrompt(session.id)?.id).toBe(prompt.id);

    const missingRequired = await request(app)
      .post(`/api/sessions/${session.id}/prompt/${prompt.id}/respond`)
      .send({ action: 'answer', answers: [] });
    expect(missingRequired.status).toBe(422);

    const incompatibleMode = await request(app)
      .post(`/api/sessions/${session.id}/prompt/${prompt.id}/respond`)
      .send({ action: 'answer', answers: [{ questionId: 'environment', selectedOptionIds: ['staging', 'staging'] }] });
    expect(incompatibleMode.status).toBe(422);
    expect(getPrompt(session.id)?.id).toBe(prompt.id);

    const valid = await request(app)
      .post(`/api/sessions/${session.id}/prompt/${prompt.id}/respond`)
      .send({ action: 'answer', answers: [{ questionId: 'environment', selectedOptionIds: ['staging'] }] });
    expect(valid.status).toBe(200);
    await expect(promptPromise).resolves.toEqual({ action: 'answer', answers: [{ questionId: 'environment', selectedOptionIds: ['staging'] }] });
  });
});
