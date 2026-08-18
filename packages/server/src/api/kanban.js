/* eslint-disable max-lines -- route-local idempotency keeps mutation contracts together */
import { Router } from 'express';
import crypto from 'crypto';
import { kanbanBoards, kanbanLanes, kanbanCards, projects, sessions, databaseManager } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@circuschief/shared';
import {
  CreateKanbanLaneRequest,
  UpdateKanbanLaneRequest,
  ReorderKanbanLanesRequest,
  CreateKanbanCardRequest,
  MoveKanbanCardRequest,
  DeclareExitLaneRequest,
  ReorderKanbanCardsRequest,
} from '@circuschief/shared/contracts/kanban';
import {
  addSessionToBoard,
  moveCard as moveCardService,
} from '../services/kanbanService.js';
import { resolveBodyRootSessionForProject } from '../middleware/sessionLookup.js';
import { getRun, declareExitLane, isStructured } from '../services/workflowSessionService.js';
import { buildFullBoardResponse } from '../services/kanbanBoardResponse.js';
import { isApiError } from '../errors/ApiError.js';

const router = Router({ mergeParams: true });
const LANE_NOT_FOUND_ERROR = 'Lane not found';
const CARD_NOT_FOUND_ERROR = 'Card not found';
const TARGET_LANE_NOT_FOUND_ERROR = 'Target lane not found';
const WORKSPACE_CARD_NOT_FOUND_ERROR = 'No card found for this workspace';
const OPERATION_LEASE_MS = 30_000;
const MAX_OPERATION_ATTEMPTS = 5;
const GENERIC_OPERATION_FAILURE = 'The operation could not be completed. Please try again.';
function canonicalPayload(payload) {
  if (Array.isArray(payload)) return payload.map(canonicalPayload);
  if (payload && typeof payload === 'object') {
    return Object.fromEntries(Object.keys(payload).sort().map((key) => [key, canonicalPayload(payload[key])]));
  }
  return payload;
}

/**
 * Validate this once, before any route validation or business mutation.  A
 * supplied key is a request contract, so treating an invalid key as though it
 * were absent would permit an accidental duplicate mutation on retry.
 */
function validateIdempotencyKey(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (key === undefined) return next();
  if (key.length === 0 || key.length > 255 || !/^[\x21-\x7e]+$/.test(key)) {
    return res.status(400).json({ error: 'Idempotency-Key must be 1-255 visible ASCII characters without whitespace' });
  }
  req.kanbanIdempotencyKey = key;
  return next();
}

/** Reserve a durable API operation. Unkeyed calls retain legacy semantics,
 * while keyed calls get database-enforced replay protection. */
function reclaimOperation(db, existing, now) {
  if (existing.attempt_count >= MAX_OPERATION_ATTEMPTS) {
    const terminalError = existing.terminal_error || GENERIC_OPERATION_FAILURE;
    db.prepare(`UPDATE kanban_api_operations SET status='failed', owner_token=NULL,
      lease_expires_at=NULL, terminal_error=?, updated_at=? WHERE id=?`).run(terminalError, now, existing.id);
    return { existing: { ...existing, status: 'failed', terminal_error: terminalError } };
  }
  const token = crypto.randomUUID();
  const taken = db.prepare(`UPDATE kanban_api_operations
    SET status='processing', owner_token=?, lease_expires_at=?, attempt_count=attempt_count+1, updated_at=?
    WHERE id=? AND (status IN ('retryable','failed','abandoned') OR (status='processing' AND lease_expires_at<=?))`)
    .run(token, now + OPERATION_LEASE_MS, now, existing.id, now);
  if (!taken.changes) return null;
  const operation = db.prepare('SELECT * FROM kanban_api_operations WHERE id=?').get(existing.id);
  return { operation: { ...operation, token } };
}

function beginOperation(req, endpoint) {
  const key = req.kanbanIdempotencyKey;
  if (!key) return { keyed: false };
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(canonicalPayload(req.body))).digest('hex');
  const db = databaseManager.get();
  const existing = db.prepare(`SELECT * FROM kanban_api_operations
    WHERE project_id=? AND endpoint=? AND operation_key=?`).get(req.params.projectId, endpoint, key);
  if (existing) {
    if (existing.payload_hash !== payloadHash) return { conflict: true };
    // Completed operations are immutable and replay their canonical status/body.
    // A failed mutation is different: the mutation and this operation's
    // completion record are committed atomically, so a caught failure means
    // there is no partial board transition to replay. Reclaim it for a safe
    // same-key retry instead of permanently caching a transient 500.
    const now = Date.now();
    const canRetry = existing.status === 'retryable'
      || existing.status === 'failed' // Backward-compatible recovery for rows written before retryable failures.
      || existing.status === 'abandoned'
      || (existing.status === 'processing' && existing.lease_expires_at <= now);
    if (!canRetry) return { keyed: true, existing };
    const reclaimed = reclaimOperation(db, existing, now);
    return reclaimed ? { keyed: true, ...reclaimed } : beginOperation(req, endpoint);
  }
  const now = Date.now(); const token = crypto.randomUUID();
  const operation = { id: crypto.randomUUID(), projectId: req.params.projectId, key, endpoint, payloadHash, token };
  try {
    db.prepare(`INSERT INTO kanban_api_operations
      (id,project_id,operation_key,endpoint,payload_hash,status,owner_token,lease_expires_at,attempt_count,created_at,updated_at)
      VALUES (?,?,?,?,?,'processing',?,?,1,?,?)`).run(operation.id, operation.projectId, key, endpoint, payloadHash, token, now + OPERATION_LEASE_MS, now, now);
    return { keyed: true, operation };
  } catch (error) {
    if (!/UNIQUE constraint failed/.test(error.message)) throw error;
    return beginOperation(req, endpoint);
  }
}

router.use(validateIdempotencyKey);

function replayOrPending(res, operation) {
  if (!operation?.existing) return false;
  if (operation.existing.status === 'completed' && operation.existing.result_json) {
    return res.status(operation.existing.response_status || 200).json(JSON.parse(operation.existing.result_json));
  }
  if (operation.existing.status === 'failed') {
    return res.status(500).json({ error: operation.existing.terminal_error || GENERIC_OPERATION_FAILURE });
  }
  return res.status(202).set('Retry-After', '1').json({ operationId: operation.existing.id, status: operation.existing.status });
}

function completeOperation(operation, response, eventId = null, responseStatus = 200) {
  if (!operation?.keyed || !operation.operation) return response;
  const body = { ...response, operationId: operation.operation.id,
    delivery: eventId ? { eventId, status: 'pending' } : null };
  const updated = databaseManager.get().prepare(`UPDATE kanban_api_operations
    SET status='completed', response_status=?, result_json=?, lane_entry_event_id=?, owner_token=NULL, lease_expires_at=NULL, updated_at=?
    WHERE id=? AND status='processing' AND owner_token=?`)
    .run(responseStatus, JSON.stringify(body), eventId, Date.now(), operation.operation.id, operation.operation.token);
  if (updated.changes !== 1) throw new Error('Kanban operation ownership was lost before result persistence');
  return body;
}

function sendTerminalOperationResponse(res, operation, responseStatus, response) {
  return res.status(responseStatus).json(completeOperation(operation, response, null, responseStatus));
}

function failOperation(operation, error) {
  const correlationId = crypto.randomUUID();
  const clientError = `${GENERIC_OPERATION_FAILURE} Reference ID: ${correlationId}`;
  // Keep provider/service details in server logs only; operation rows are
  // inspectable and must not become a durable raw-error replay channel.
  console.error(`[Kanban operation failure] correlationId=${correlationId}`, error);
  const response = { error: clientError };
  if (!operation?.keyed || !operation.operation) return response;
  const body = { ...response, operationId: operation.operation.id, delivery: null };
  const updated = databaseManager.get().prepare(`UPDATE kanban_api_operations
    SET status='retryable', response_status=NULL, result_json=NULL, terminal_error=?, owner_token=NULL, lease_expires_at=NULL, updated_at=?
    WHERE id=? AND status='processing' AND owner_token=?`)
    .run(clientError, Date.now(), operation.operation.id, operation.operation.token);
  if (updated.changes !== 1) throw new Error('Kanban operation ownership was lost before failure persistence');
  return body;
}

// An operation can lose its lease after the mutation service rejects. Do not
// let the best-effort persistence of that error replace the original HTTP
// response with another exception from the route's catch block.
function sendFailureFromCatch(res, operation, error) {
  try {
    return res.status(500).json(failOperation(operation, error));
  } catch (persistenceError) {
    console.error('Failed to persist kanban operation failure:', persistenceError);
    const correlationId = crypto.randomUUID();
    console.error(`[Kanban operation failure persistence] correlationId=${correlationId}`, error);
    return res.status(500).json({ error: `${GENERIC_OPERATION_FAILURE} Reference ID: ${correlationId}` });
  }
}

function sendTerminalResponseFromCatch(res, operation, responseStatus, response) {
  try {
    return sendTerminalOperationResponse(res, operation, responseStatus, response);
  } catch (persistenceError) {
    console.error('Failed to persist terminal kanban operation response:', persistenceError);
    return res.status(responseStatus).json(response);
  }
}

function boardForProject(projectId) {
  return kanbanBoards.getByProjectId(projectId);
}

function cardBelongsToBoard(card, board) {
  if (!card || !board) return false;
  return kanbanLanes.getById(card.laneId)?.boardId === board.id;
}

function laneBelongsToBoard(lane, board) {
  return Boolean(lane && board && lane.boardId === board.id);
}

function targetLaneForBoard(targetLaneId, board) {
  const targetLane = kanbanLanes.getById(targetLaneId);
  return laneBelongsToBoard(targetLane, board) ? targetLane : null;
}

function completionTargetError(boardId, targetLaneId, sourceLaneId = null) {
  if (targetLaneId === undefined || targetLaneId === null) return null;
  if (targetLaneId === sourceLaneId) {
    return { status: 400, error: 'Completion target lane cannot be the same lane' };
  }
  const targetLane = kanbanLanes.getById(targetLaneId);
  if (!targetLane) return { status: 404, error: 'Completion target lane not found' };
  if (targetLane.boardId !== boardId) {
    return { status: 400, error: 'Completion target lane must be on the same board' };
  }
  return null;
}

// ============== Board Endpoints ==============

/**
 * GET /api/projects/:projectId/kanban
 * Get board with all lanes and cards. Auto-creates if missing.
 */
router.get('/', (req, res) => {
  const { projectId } = req.params;

  const project = projects.getById(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Get or create board
  const board = kanbanBoards.getOrCreateForProject(projectId);
  const fullBoard = buildFullBoardResponse(board);

  res.json(fullBoard);
});

router.get('/lane-runs/:runId', (req, res) => {
  const run = getRun(req.params.runId, req.params.projectId);
  if (!run) return res.status(404).json({ error: 'Lane run not found' });
  res.json(run);
});

/** GET /api/projects/:projectId/kanban/operations/:operationId */
router.get('/operations/:operationId', (req, res) => {
  const operation = databaseManager.get().prepare(`SELECT id, status, lane_entry_event_id, created_at, updated_at
    FROM kanban_api_operations WHERE id=? AND project_id=?`).get(req.params.operationId, req.params.projectId);
  if (!operation) return res.status(404).json({ error: 'Kanban operation not found' });
  const event = operation.lane_entry_event_id && databaseManager.get().prepare(`SELECT id, status, delivery_phase,
    attempt_count, last_error, created_at, updated_at FROM kanban_lane_entry_events WHERE id=?`).get(operation.lane_entry_event_id);
  res.json({ operationId: operation.id, status: operation.status, createdAt: operation.created_at,
    updatedAt: operation.updated_at, delivery: event && { eventId: event.id, status: event.status,
      phase: event.delivery_phase, attemptCount: event.attempt_count, lastError: event.last_error,
      createdAt: event.created_at, updatedAt: event.updated_at } });
});

/**
 * DELETE /api/projects/:projectId/kanban
 * Delete board (resets all kanban data)
 */
router.delete('/', (req, res) => {
  const { projectId } = req.params;

  const board = kanbanBoards.getByProjectId(projectId);
  if (!board) {
    return res.status(404).json({ error: 'Board not found' });
  }

  kanbanBoards.delete(board.id);

  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, {
    projectId,
    board: null,
  });

  res.status(204).send();
});

// ============== Lane Endpoints ==============

/**
 * POST /api/projects/:projectId/kanban/lanes
 * Create a new lane
 */
router.post('/lanes', (req, res) => {
  const { projectId } = req.params;

  const result = CreateKanbanLaneRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const board = kanbanBoards.getByProjectId(projectId);
  if (!board) {
    return res.status(404).json({ error: 'Board not found' });
  }

  const targetError = completionTargetError(board.id, result.data.completionTargetLaneId);
  if (targetError) return res.status(targetError.status).json({ error: targetError.error });

  let lane;
  try {
    lane = kanbanLanes.create(board.id, result.data);
  } catch (error) {
    if (isApiError(error)) return res.status(error.status).json({ error: error.message, code: error.code, field: error.field });
    throw error;
  }

  // Broadcast updated board
  const fullBoard = buildFullBoardResponse(board);
  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, {
    projectId,
    board: fullBoard,
  });

  res.status(201).json(lane);
});

/**
 * PATCH /api/projects/:projectId/kanban/lanes/:laneId
 * Update a lane
 */
// Validation branches intentionally stay adjacent to the route contract.
// eslint-disable-next-line max-statements
router.patch('/lanes/:laneId', (req, res) => {
  const { projectId, laneId } = req.params;

  const result = UpdateKanbanLaneRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const lane = kanbanLanes.getById(laneId);
  if (!lane) {
    return res.status(404).json({ error: LANE_NOT_FOUND_ERROR });
  }

  const board = kanbanBoards.getByProjectId(projectId);
  if (!board || board.id !== lane.boardId) {
    return res.status(404).json({ error: LANE_NOT_FOUND_ERROR });
  }

  const targetError = completionTargetError(lane.boardId, result.data.completionTargetLaneId, laneId);
  if (targetError) return res.status(targetError.status).json({ error: targetError.error });

  let updated;
  try {
    updated = kanbanLanes.update(laneId, result.data);
  } catch (error) {
    if (isApiError(error)) return res.status(error.status).json({ error: error.message, code: error.code, field: error.field });
    throw error;
  }

  // Broadcast updated board
  const fullBoard = buildFullBoardResponse(board);
  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, {
    projectId,
    board: fullBoard,
  });

  res.json(updated);
});

/**
 * DELETE /api/projects/:projectId/kanban/lanes/:laneId
 * Delete a lane
 */
router.delete('/lanes/:laneId', (req, res) => {
  const { projectId, laneId } = req.params;

  const lane = kanbanLanes.getById(laneId);
  if (!lane) {
    return res.status(404).json({ error: LANE_NOT_FOUND_ERROR });
  }
  const projectBoard = boardForProject(req.params.projectId);
  if (!laneBelongsToBoard(lane, projectBoard)) return res.status(404).json({ error: LANE_NOT_FOUND_ERROR });

  kanbanLanes.delete(laneId);

  // Broadcast updated board
  const board = kanbanBoards.getByProjectId(projectId);
  const fullBoard = buildFullBoardResponse(board);
  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, {
    projectId,
    board: fullBoard,
  });

  res.status(204).send();
});

/**
 * PUT /api/projects/:projectId/kanban/lanes/reorder
 * Reorder all lanes
 */
router.put('/lanes/reorder', (req, res) => {
  const { projectId } = req.params;

  const result = ReorderKanbanLanesRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const board = kanbanBoards.getByProjectId(projectId);
  if (!board) {
    return res.status(404).json({ error: 'Board not found' });
  }

  kanbanLanes.reorder(board.id, result.data);

  // Broadcast updated board
  const fullBoard = buildFullBoardResponse(board);
  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, {
    projectId,
    board: fullBoard,
  });

  res.json(fullBoard);
});

// ============== Card Endpoints ==============

/**
 * Helper: delete a card and broadcast KANBAN_CARD_REMOVED.
 * Used by both the :cardId and by-workspace delete routes.
 */
function deleteCardById(card, projectId) {
  const laneId = card.laneId;
  kanbanCards.delete(card.id);
  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED, {
    projectId,
    cardId: card.id,
    laneId,
  });
}

/**
 * POST /api/projects/:projectId/kanban/cards
 * Add a workspace to the board (create card in a lane).
 * Body: { workspaceId, laneId }
 */
router.post('/cards', resolveBodyRootSessionForProject('projectId'), async (req, res) => {
  const result = CreateKanbanCardRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const { laneId } = result.data;
  const operation = beginOperation(req, 'card_add');
  if (operation.conflict) return res.status(409).json({ error: 'Idempotency-Key was already used with a different payload' });
  if (replayOrPending(res, operation)) return;
  // req.bodyRootSessionId is the normalized workspace root, already validated.
  const workspaceId = req.bodyRootSessionId;

  // Check if workspace already has a card
  const existingCard = kanbanCards.getBySessionId(workspaceId);
  if (existingCard) {
    return sendTerminalOperationResponse(res, operation, 409, { error: 'Session already has a card on the board' });
  }

  // Verify lane exists
  const lane = kanbanLanes.getById(laneId);
  if (!lane) {
    return sendTerminalOperationResponse(res, operation, 404, { error: LANE_NOT_FOUND_ERROR });
  }
  const board = boardForProject(req.params.projectId);
  if (!laneBelongsToBoard(lane, board)) {
    return sendTerminalOperationResponse(res, operation, 404, { error: LANE_NOT_FOUND_ERROR });
  }

  try {
    const response = await addSessionToBoard(workspaceId, laneId, {
      finalizeMutation: ({ card, eventId }) => completeOperation(operation, card, eventId, 201),
    });
    res.status(201).json(response);
  } catch (error) {
    if (error.message === 'Session already has a card on the board') {
      return sendTerminalResponseFromCatch(res, operation, 409, { error: error.message });
    }
    return sendFailureFromCatch(res, operation, error);
  }
});

/**
 * PATCH /api/projects/:projectId/kanban/cards/:cardId/move
 * Move card to a different lane
 */
router.patch('/cards/:cardId/move', async (req, res) => {
  const { cardId } = req.params;

  const result = MoveKanbanCardRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const card = kanbanCards.getByIdWithLane(cardId);
  if (!card) {
    return res.status(404).json({ error: CARD_NOT_FOUND_ERROR });
  }
  const board = boardForProject(req.params.projectId);
  if (!cardBelongsToBoard(card, board)) return res.status(404).json({ error: CARD_NOT_FOUND_ERROR });

  const { targetLaneId, sortOrder, runOnEnterTemplate } = result.data;
  const operation = beginOperation(req, `card_move:${cardId}`);
  if (operation.conflict) return res.status(409).json({ error: 'Idempotency-Key was already used with a different payload' });
  if (replayOrPending(res, operation)) return;

  const targetLane = targetLaneForBoard(targetLaneId, board);
  if (!targetLane) {
    return sendTerminalOperationResponse(res, operation, 404, { error: TARGET_LANE_NOT_FOUND_ERROR });
  }

  try {
    const response = await moveCardService(cardId, targetLaneId, {
      sortOrder,
      runOnEnterTemplate,
      finalizeMutation: ({ card: movedCard, eventId }) => completeOperation(operation, movedCard, eventId),
    });
    res.json(response);
  } catch (error) {
    if (isApiError(error)) {
      return sendTerminalResponseFromCatch(res, operation, error.status, { error: error.message, code: error.code });
    }
    console.error('Failed to move kanban card:', error);
    return sendFailureFromCatch(res, operation, error);
  }
});

/**
 * DELETE /api/projects/:projectId/kanban/cards/:cardId
 * Remove card from board
 */
router.delete('/cards/:cardId', (req, res) => {
  const { projectId, cardId } = req.params;

  const card = kanbanCards.getByIdWithLane(cardId);
  if (!card) {
    return res.status(404).json({ error: CARD_NOT_FOUND_ERROR });
  }
  const board = boardForProject(projectId);
  if (!cardBelongsToBoard(card, board)) return res.status(404).json({ error: CARD_NOT_FOUND_ERROR });

  deleteCardById(card, projectId);
  res.status(204).send();
});

// ============== Workspace-addressed Card Routes (agent-friendly) ==============

/**
 * PATCH /api/projects/:projectId/kanban/cards/by-workspace/:workspaceId/move
 * Move the workspace's card to a different lane.
 * No card ID needed — the agent addresses by workspace ID.
 */
// eslint-disable-next-line max-statements -- ownership and idempotency fences stay adjacent to the mutation
router.patch('/cards/by-workspace/:workspaceId/move', async (req, res) => {
  const { workspaceId: rawWorkspaceId } = req.params;

  // Normalize to workspace root (forgiving if a child id is passed)
  const workspaceId = sessions.getRootSessionId(rawWorkspaceId) || rawWorkspaceId;

  const workspace = sessions.getById(workspaceId);
  if (!workspace || workspace.projectId !== req.params.projectId) {
    return res.status(404).json({ error: WORKSPACE_CARD_NOT_FOUND_ERROR });
  }

  const card = kanbanCards.getBySessionId(workspaceId);
  if (!card) {
    return res.status(404).json({ error: WORKSPACE_CARD_NOT_FOUND_ERROR });
  }
  const board = boardForProject(req.params.projectId);
  if (!cardBelongsToBoard(card, board)) return res.status(404).json({ error: WORKSPACE_CARD_NOT_FOUND_ERROR });

  const result = MoveKanbanCardRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const { targetLaneId, sortOrder, runOnEnterTemplate } = result.data;
  const operation = beginOperation(req, `workspace_move:${workspaceId}`);
  if (operation.conflict) return res.status(409).json({ error: 'Idempotency-Key was already used with a different payload' });
  if (replayOrPending(res, operation)) return;

  const targetLane = targetLaneForBoard(targetLaneId, board);
  if (!targetLane) {
    return sendTerminalOperationResponse(res, operation, 404, { error: TARGET_LANE_NOT_FOUND_ERROR });
  }

  try {
    const response = await moveCardService(card.id, targetLaneId, {
      sortOrder,
      runOnEnterTemplate,
      finalizeMutation: ({ card: movedCard, eventId }) => completeOperation(operation, movedCard, eventId),
    });
    res.json(response);
  } catch (error) {
    if (isApiError(error)) {
      return sendTerminalResponseFromCatch(res, operation, error.status, { error: error.message, code: error.code });
    }
    console.error('Failed to move kanban card by workspace:', error);
    return sendFailureFromCatch(res, operation, error);
  }
});

/** Declare an active lane run's destination without moving or interrupting it. */
router.put('/cards/by-workspace/:workspaceId/exit-lane', (req, res) => {
  const workspaceId = sessions.getRootSessionId(req.params.workspaceId) || req.params.workspaceId;
  const workspace = sessions.getById(workspaceId);
  if (!workspace || workspace.projectId !== req.params.projectId) {
    return res.status(404).json({ error: WORKSPACE_CARD_NOT_FOUND_ERROR });
  }
  const card = kanbanCards.getBySessionId(workspaceId);
  const board = boardForProject(req.params.projectId);
  if (!card || !cardBelongsToBoard(card, board)) {
    return res.status(404).json({ error: WORKSPACE_CARD_NOT_FOUND_ERROR });
  }
  const result = DeclareExitLaneRequest.safeParse(req.body);
  if (!result.success) return res.status(400).json({ error: result.error.issues[0].message });

  // Naturally idempotent: middleware validates a supplied key's format, then this route ignores it.
  try {
    const run = declareExitLane(card.id, result.data.laneId);
    const response = {
      cardId: card.id,
      laneRunId: run.id,
      deferred: true,
      chosenExitLaneId: run.chosenExitLaneId,
      chosenExitLaneName: run.chosenExitLaneName,
      willRunAutomation: isStructured(kanbanLanes.getById(result.data.laneId)),
    };
    broadcastToProject(workspace.projectId, WS_MESSAGE_TYPES.KANBAN_EXIT_LANE_DECLARED, {
      projectId: workspace.projectId,
      cardId: card.id,
      activeLaneRun: run,
    });
    return res.json(response);
  } catch (error) {
    if (isApiError(error)) return res.status(error.status).json({ error: error.message, code: error.code });
    console.error('Failed to declare kanban exit lane:', error);
    return res.status(500).json({ error: GENERIC_OPERATION_FAILURE });
  }
});

/**
 * DELETE /api/projects/:projectId/kanban/cards/by-workspace/:workspaceId
 * Remove the workspace's card from the board.
 * No card ID needed — the agent addresses by workspace ID.
 */
router.delete('/cards/by-workspace/:workspaceId', (req, res) => {
  const { projectId, workspaceId: rawWorkspaceId } = req.params;

  // Normalize to workspace root (forgiving if a child id is passed)
  const workspaceId = sessions.getRootSessionId(rawWorkspaceId) || rawWorkspaceId;

  const workspace = sessions.getById(workspaceId);
  if (!workspace || workspace.projectId !== projectId) {
    return res.status(404).json({ error: WORKSPACE_CARD_NOT_FOUND_ERROR });
  }

  const card = kanbanCards.getBySessionId(workspaceId);
  if (!card) {
    return res.status(404).json({ error: WORKSPACE_CARD_NOT_FOUND_ERROR });
  }
  const board = boardForProject(projectId);
  if (!cardBelongsToBoard(card, board)) return res.status(404).json({ error: WORKSPACE_CARD_NOT_FOUND_ERROR });

  deleteCardById(card, projectId);
  res.status(204).send();
});

/**
 * PUT /api/projects/:projectId/kanban/lanes/:laneId/cards/reorder
 * Reorder cards within a lane
 */
router.put('/lanes/:laneId/cards/reorder', (req, res) => {
  const { projectId, laneId } = req.params;

  const result = ReorderKanbanCardsRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const lane = kanbanLanes.getById(laneId);
  if (!lane) {
    return res.status(404).json({ error: LANE_NOT_FOUND_ERROR });
  }
  const board = boardForProject(projectId);
  if (!laneBelongsToBoard(lane, board)) return res.status(404).json({ error: LANE_NOT_FOUND_ERROR });

  kanbanCards.reorder(laneId, result.data);

  // Broadcast updated board
  const fullBoard = buildFullBoardResponse(board);
  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, {
    projectId,
    board: fullBoard,
  });

  res.json({ success: true });
});

export default router;
