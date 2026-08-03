import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../websocket.js', () => ({ broadcastToSession: vi.fn(), broadcastToProject: vi.fn() }));
vi.mock('../services/sessionManager.js', () => ({ continueSession: vi.fn(), stopSession: vi.fn(), restartSession: vi.fn(), cleanupActiveSession: vi.fn() }));
vi.mock('../services/summaryService.js', () => ({ propagatePrUrlToParent: vi.fn(), cleanupSession: vi.fn(), getSummary: vi.fn(), regenerateSummary: vi.fn(), saveManualSummary: vi.fn() }));
vi.mock('../services/gitService.js', () => ({ getOriginDefaultBranch: vi.fn(), getModifiedFilesCount: vi.fn(), removeWorktree: vi.fn() }));
vi.mock('../services/hookService.js', () => ({ executeHookAsync: vi.fn() }));
vi.mock('../services/slashCommandService.js', () => ({ resolvePromptSkillOrCommand: vi.fn() }));
vi.mock('../services/draftSessionService.js', () => ({ validateDraftSession: vi.fn(), startDraft: vi.fn(), DraftSessionError: class extends Error {} }));
vi.mock('../services/sessionDuplicator.js', () => ({ duplicateSession: vi.fn() }));
vi.mock('../services/commandRunner.js', () => ({ commandRunner: { getRunsBySession: vi.fn() } }));
vi.mock('../middleware/upload.js', () => ({ upload: { array: () => (_req, _res, next) => next() }, handleUploadError: (_err, _req, _res, next) => next() }));

import sessionsRouter from './sessions.js';

describe('retired workflow completion API', () => {
  it('does not expose an agent-invoked completion endpoint', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);
    expect((await request(app).post('/api/sessions/any/workflow/complete').send({})).status).toBe(404);
  });
});
