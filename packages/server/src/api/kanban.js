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
import { resolveBodyRootSessionForProject } from '../middleware/sessionLookup.js';
import { getRun } from '../services/workflowSessionService.js';
import { buildFullBoardResponse } from '../services/kanbanBoardResponse.js';
import { isApiError } from '../errors/ApiError.js';

const router = Router({ mergeParams: true });
const LANE_NOT_FOUND_ERROR = 'Lane not found';

function canonicalPayload(payload) {
  return JSON.stringify(Object.fromEntries(Object.keys(payload || {}).sort().map((key) => [key, payload[key]])));
}

function idempotencyKey(req) {
  const key = req.get('Idempotency-Key');
  return key && key.length <= 255 ? key : null;
}

/** Reserve a durable API operation. Unkeyed calls retain legacy semantics,
 * while keyed calls get database-enforced replay protection. */
function beginOperation(req, endpoint) {
  const key = idempotencyKey(req);
  if (!key) return { keyed: false };
  const payloadHash = crypto.createHash('sha256').update(canonicalPayload(req.body)).digest('hex');
  const db = databaseManager.get();
  const existing = db.prepare(`SELECT * FROM kanban_api_operations
    WHERE project_id=? AND endpoint=? AND operation_key=?`).get(req.params.projectId, endpoint, key);
  if (existing) {
    if (existing.payload_hash !== payloadHash) return { conflict: true };
    return { keyed: true, existing };
  }
  const operation = { id: crypto.randomUUID(), projectId: req.params.projectId, key, endpoint, payloadHash };
  try {
    db.prepare(`INSERT INTO kanban_api_operations
      (id,project_id,operation_key,endpoint,payload_hash,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'processing',?,?)`).run(operation.id, operation.projectId, key, endpoint, payloadHash, Date.now(), Date.now());
    return { keyed: true, operation };
  } catch (error) {
    if (!/UNIQUE constraint failed/.test(error.message)) throw error;
    return beginOperation(req, endpoint);
  }
}

function replayOrPending(res, operation) {
  if (!operation?.existing) return false;
  if (operation.existing.status === 'completed' && operation.existing.result_json) {
    return res.json(JSON.parse(operation.existing.result_json));
  }
  return res.status(202).json({ operationId: operation.existing.id, status: operation.existing.status });
}

function completeOperation(operation, response, eventId = null) {
  if (!operation?.keyed || !operation.operation) return response;
  const body = { ...response, operationId: operation.operation.id,
    delivery: eventId ? { eventId, status: 'pending' } : null };
  databaseManager.get().prepare(`UPDATE kanban_api_operations SET status='completed', result_json=?, lane_entry_event_id=?, updated_at=? WHERE id=?`)
    .run(JSON.stringify(body), eventId, Date.now(), operation.operation.id);
  return body;
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
  const run = getRun(req.params.runId);
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
    return res.status(404).json({ error: 'Lane not found' });
  }

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
    return res.status(409).json({ error: 'Session already has a card on the board' });
  }

  // Verify lane exists
  const lane = kanbanLanes.getById(laneId);
  if (!lane) {
    return res.status(404).json({ error: 'Lane not found' });
  }

  try {
    const card = await addSessionToBoard(workspaceId, laneId);
    const eventId = kanbanCards.getById(card.id)?.laneEntryEventId || null;
    res.status(201).json(completeOperation(operation, card, eventId));
  } catch (error) {
    if (error.message === 'Session already has a card on the board') {
      return res.status(409).json({ error: error.message });
    }
    res.status(500).json({ error: error.message });
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
    return res.status(404).json({ error: 'Card not found' });
  }

  const { targetLaneId, sortOrder, runOnEnterTemplate } = result.data;
  const operation = beginOperation(req, `card_move:${cardId}`);
  if (operation.conflict) return res.status(409).json({ error: 'Idempotency-Key was already used with a different payload' });
  if (replayOrPending(res, operation)) return;

  // Verify target lane exists
  const targetLane = kanbanLanes.getById(targetLaneId);
  if (!targetLane) {
    return res.status(404).json({ error: 'Target lane not found' });
  }

  try {
    const movedCard = await moveCardService(cardId, targetLaneId, {
      sortOrder,
      runOnEnterTemplate,
    });
    const eventId = kanbanCards.getById(cardId)?.laneEntryEventId || null;
    res.json(completeOperation(operation, movedCard, eventId));
  } catch (error) {
    console.error('Failed to move kanban card:', error);
    res.status(500).json({ error: error.message });
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
    return res.status(404).json({ error: 'Card not found' });
  }

  deleteCardById(card, projectId);
  res.status(204).send();
});

// ============== Workspace-addressed Card Routes (agent-friendly) ==============

/**
 * PATCH /api/projects/:projectId/kanban/cards/by-workspace/:workspaceId/move
 * Move the workspace's card to a different lane.
 * No card ID needed — the agent addresses by workspace ID.
 */
router.patch('/cards/by-workspace/:workspaceId/move', async (req, res) => {
  const { workspaceId: rawWorkspaceId } = req.params;

  // Normalize to workspace root (forgiving if a child id is passed)
  const workspaceId = sessions.getRootSessionId(rawWorkspaceId) || rawWorkspaceId;

  const card = kanbanCards.getBySessionId(workspaceId);
  if (!card) {
    return res.status(404).json({ error: 'No card found for this workspace' });
  }

  const result = MoveKanbanCardRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const { targetLaneId, sortOrder, runOnEnterTemplate } = result.data;
  const operation = beginOperation(req, `workspace_move:${workspaceId}`);
  if (operation.conflict) return res.status(409).json({ error: 'Idempotency-Key was already used with a different payload' });
  if (replayOrPending(res, operation)) return;

  const targetLane = kanbanLanes.getById(targetLaneId);
  if (!targetLane) {
    return res.status(404).json({ error: 'Target lane not found' });
  }

  try {
    const movedCard = await moveCardService(card.id, targetLaneId, {
      sortOrder,
      runOnEnterTemplate,
    });
    const eventId = kanbanCards.getById(card.id)?.laneEntryEventId || null;
    res.json(completeOperation(operation, movedCard, eventId));
  } catch (error) {
    console.error('Failed to move kanban card by workspace:', error);
    res.status(500).json({ error: error.message });
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

  const card = kanbanCards.getBySessionId(workspaceId);
  if (!card) {
    return res.status(404).json({ error: 'No card found for this workspace' });
  }

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
    return res.status(404).json({ error: 'Lane not found' });
  }

  kanbanCards.reorder(laneId, result.data);

  // Broadcast updated board
  const board = kanbanBoards.getByProjectId(projectId);
  const fullBoard = buildFullBoardResponse(board);
  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_BOARD_UPDATED, {
    projectId,
    board: fullBoard,
  });

  res.json({ success: true });
});

export default router;
