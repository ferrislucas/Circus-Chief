import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, kanbanBoards, kanbanCards, kanbanLanes } from '../database.js';
import {
  createLaneRunForEntry,
  attachRootSession,
  beginWorkflowTurn,
  finalizeOwnWorkCompletion,
  getRun,
} from '../services/workflowSessionService.js';

// Mock heavy/unrelated dependencies pulled in transitively by sessions.js and
// its sub-routers, exactly as sessions.test.js does. The workflow/complete
// route itself only touches workflowSessionService.js (real, unmocked) — this
// proves the documented REST contract (FRD "Kanban Lane-Run Structured
// Completion", W3) actually drives the real engine end-to-end.
vi.mock('../websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));
vi.mock('../services/sessionManager.js', () => ({
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn().mockResolvedValue(undefined),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
}));
vi.mock('../services/summaryService.js', () => ({
  propagatePrUrlToParent: vi.fn(),
  cleanupSession: vi.fn(),
  getSummary: vi.fn(),
  regenerateSummary: vi.fn(),
  saveManualSummary: vi.fn(),
}));
vi.mock('../services/gitService.js', () => ({
  getOriginDefaultBranch: vi.fn().mockResolvedValue('main'),
  getModifiedFilesCount: vi.fn().mockResolvedValue(0),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));
vi.mock('../services/slashCommandService.js', () => ({
  resolvePromptSkillOrCommand: vi.fn().mockResolvedValue(null),
}));
vi.mock('../services/draftSessionService.js', () => ({
  validateDraftSession: vi.fn().mockReturnValue({ valid: true }),
  startDraft: vi.fn(),
  DraftSessionError: class extends Error {},
}));
vi.mock('../services/sessionDuplicator.js', () => ({
  duplicateSession: vi.fn(),
}));
vi.mock('../services/commandRunner.js', () => ({
  commandRunner: {
    getRunsBySession: vi.fn().mockReturnValue([]),
  },
}));
vi.mock('../middleware/upload.js', () => ({
  upload: { array: () => (req, res, next) => next() },
  handleUploadError: (err, req, res, next) => next(),
}));

import sessionsRouter from './sessions.js';

describe('POST /api/sessions/:id/workflow/complete (W3: end-to-end)', () => {
  let app;
  let project;
  let board;
  let source;
  let target;
  let root;
  let card;
  let run;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);

    project = projects.create('Workflow project', '/tmp/workflow-e2e');
    board = kanbanBoards.create(project.id);
    [source, target] = kanbanLanes.getByBoardId(board.id);
    // A workspace root that owns the card (mirrors kanbanService.addSessionToBoard).
    const workspace = sessions.create(project.id, 'Workspace root', 'work');
    card = kanbanCards.create(source.id, workspace.id);

    // The lane's on-enter prompt session — this is the run's root, exactly
    // like triggerOnEnterPrompt() creates it (parentSessionId set, then
    // attachRootSession makes it the root of the lane run).
    root = sessions.create(project.id, 'Lane prompt', 'do the work', { parentSessionId: workspace.id });
    run = createLaneRunForEntry({
      projectId: project.id,
      workspaceId: workspace.id,
      cardId: card.id,
      lane: { ...kanbanLanes.getById(source.id), completionMode: 'structured', completionTargetLaneId: target.id },
    });
    attachRootSession(run.id, root.id);
  });

  it('documents an unknowable token today only if the endpoint is undiscoverable — GET session exposes it', async () => {
    // Simulates _executeSession's beginWorkflowTurn() at the start of a real run.
    beginWorkflowTurn(root.id);

    const res = await request(app).get(`/api/sessions/${root.id}`);
    expect(res.status).toBe(200);
    expect(res.body.workflowTurnToken).toBeTruthy();
    expect(res.body.laneRunId).toBe(run.id);
  });

  it('accepts a completion request through the real HTTP route and rolls up to a card move with no descendants (AC-2)', async () => {
    const token = beginWorkflowTurn(root.id);

    const res = await request(app)
      .post(`/api/sessions/${root.id}/workflow/complete`)
      .send({ turnToken: token, idempotencyKey: 'attempt-1' });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, idempotent: false });

    // Simulates _executeSession's finalizeOwnWorkCompletion() once the turn
    // (which included the HTTP call above) finishes.
    const reconciled = finalizeOwnWorkCompletion(root.id, token);
    expect(reconciled.status).toBe('succeeded');
    expect(kanbanCards.getById(card.id).laneId).toBe(target.id);
  });

  it('rejects a stale turnToken with 409 and does not close the obligation', async () => {
    beginWorkflowTurn(root.id);

    const res = await request(app)
      .post(`/api/sessions/${root.id}/workflow/complete`)
      .send({ turnToken: 'not-the-real-token', idempotencyKey: 'attempt-1' });

    expect(res.status).toBe(409);
    expect(getRun(run.id).status).toBe('open');
  });

  it('rejects a request missing turnToken or idempotencyKey with 400', async () => {
    const res = await request(app)
      .post(`/api/sessions/${root.id}/workflow/complete`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('is idempotent for repeated requests with the same idempotencyKey', async () => {
    const token = beginWorkflowTurn(root.id);

    const first = await request(app)
      .post(`/api/sessions/${root.id}/workflow/complete`)
      .send({ turnToken: token, idempotencyKey: 'attempt-1' });
    const second = await request(app)
      .post(`/api/sessions/${root.id}/workflow/complete`)
      .send({ turnToken: token, idempotencyKey: 'attempt-1' });

    expect(first.body).toEqual({ accepted: true, idempotent: false });
    expect(second.body).toEqual({ accepted: true, idempotent: true });
  });
});
