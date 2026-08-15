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
  ReorderKanbanCardsRequest,
} from '@circuschief/shared/contracts/kanban';
import {
  addSessionToBoard,
  moveCard as moveCardService,
} from '../services/kanbanService.js';
import { verifySessionCallerCapability } from '../services/sessionCallerCapability.js';
import { resolveBodyRootSessionForProject } from '../middleware/sessionLookup.js';
import { getRun } from '../services/workflowSessionService.js';
import { buildFullBoardResponse } from '../services/kanbanBoardResponse.js';
import { isApiError } from '../errors/ApiError.js';

const router = Router({ mergeParams: true });
const LANE_NOT_FOUND_ERROR = 'Lane not found';
const CARD_NOT_FOUND_ERROR = 'Card not found';
const TARGET_LANE_NOT_FOUND_ERROR = 'Target lane not found';
const WORKSPACE_CARD_NOT_FOUND_ERROR = 'No card found for this workspace';
const OPERATION_LEASE_MS = 30_000;

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
function beginOperation(req, endpoint) {
  const key = req.kanbanIdempotencyKey;
  if (!key) return { keyed: false };
  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(canonicalPayload(req.body))).digest('hex');
  const db = databaseManager.get();
  let existing = db.prepare(`SELECT * FROM kanban_api_operations
    WHERE project_id=? AND endpoint=? AND operation_key=?`).get(req.params.projectId, endpoint, key);
  if (existing) {
    if (existing.payload_hash !== payloadHash) return { conflict: true };
    // A completed operation is immutable and always replays its canonical
    // status/body.  A live owner is never allowed to mutate on a duplicate.
    if (existing.status !== 'processing' || existing.lease_expires_at > Date.now()) return { keyed: true, existing };
    const token = crypto.randomUUID(); const now = Date.now();
    const taken = db.prepare(`UPDATE kanban_api_operations
      SET owner_token=?, lease_expires_at=?, attempt_count=attempt_count+1, updated_at=?
      WHERE id=? AND status='processing' AND lease_expires_at<=?`).run(token, now + OPERATION_LEASE_MS, now, existing.id, now);
    if (!taken.changes) return beginOperation(req, endpoint);
    existing = db.prepare('SELECT * FROM kanban_api_operations WHERE id=?').get(existing.id);
    return { keyed: true, operation: { ...existing, token } };
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
  if (operation.existing.status !== 'processing' && operation.existing.result_json) {
    return res.status(operation.existing.response_status || 200).json(JSON.parse(operation.existing.result_json));
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

function failOperation(operation, error, responseStatus = 500) {
  const response = { error: error.message };
  if (!operation?.keyed || !operation.operation) return response;
  const body = { ...response, operationId: operation.operation.id, delivery: null };
  const updated = databaseManager.get().prepare(`UPDATE kanban_api_operations
    SET status='failed', response_status=?, result_json=?, terminal_error=?, owner_token=NULL, lease_expires_at=NULL, updated_at=?
    WHERE id=? AND status='processing' AND owner_token=?`)
    .run(responseStatus, JSON.stringify(body), error.message, Date.now(), operation.operation.id, operation.operation.token);
  if (updated.changes !== 1) throw new Error('Kanban operation ownership was lost before failure persistence');
  return body;
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

function callerSessionId(req) {
  const claimedActorSessionId = req.get('X-Circus-Session-Id') || null;
  const capability = req.get('X-Circus-Session-Capability');
  return verifySessionCallerCapability(claimedActorSessionId, capability) ? claimedActorSessionId : null;
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
      return sendTerminalOperationResponse(res, operation, 409, { error: error.message });
    }
    res.status(500).json(failOperation(operation, error));
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

  // Verify target lane exists
  const targetLane = kanbanLanes.getById(targetLaneId);
  if (!targetLane) {
    return sendTerminalOperationResponse(res, operation, 404, { error: TARGET_LANE_NOT_FOUND_ERROR });
  }
  if (!laneBelongsToBoard(targetLane, board)) {
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
    console.error('Failed to move kanban card:', error);
    res.status(500).json(failOperation(operation, error));
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
    const actorSessionId = callerSessionId(req);
    const response = await moveCardService(card.id, targetLaneId, {
      sortOrder,
      runOnEnterTemplate,
      // Agent prompts attach the executing session id. The workspace in the
      // URL identifies the card; it is not caller identity and must not be
      // used to decide whether the active worker is moving its own card.
      actorSessionId,
      finalizeMutation: ({ card: movedCard, eventId }) => completeOperation(operation, movedCard, eventId),
    });
    res.json(response);
  } catch (error) {
    if (error.message === 'An active lane worker cannot reorder its card within the same lane') {
      return sendTerminalOperationResponse(res, operation, 409, { error: error.message });
    }
    console.error('Failed to move kanban card by workspace:', error);
    res.status(500).json(failOperation(operation, error));
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
