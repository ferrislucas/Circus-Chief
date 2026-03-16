import { Router } from 'express';
import { kanbanBoards, kanbanLanes, kanbanCards, projects } from '../database.js';
import { broadcastToProject } from '../websocket.js';
import { WS_MESSAGE_TYPES } from '@claudetools/shared';
import {
  CreateKanbanLaneRequest,
  UpdateKanbanLaneRequest,
  ReorderKanbanLanesRequest,
  CreateKanbanCardRequest,
  MoveKanbanCardRequest,
  ReorderKanbanCardsRequest,
} from '@claudetools/shared/contracts/kanban';

const router = Router({ mergeParams: true });

/**
 * Helper to build full board response with lanes and cards
 */
function buildFullBoardResponse(board) {
  if (!board) return null;

  const lanes = kanbanLanes.getByBoardId(board.id);
  const allCards = kanbanCards.getByBoardId(board.id);

  // Group cards by lane
  const cardsByLane = {};
  for (const lane of lanes) {
    cardsByLane[lane.id] = [];
  }
  for (const card of allCards) {
    if (cardsByLane[card.laneId]) {
      cardsByLane[card.laneId].push(card);
    }
  }

  return {
    id: board.id,
    projectId: board.projectId,
    lanes: lanes.map(lane => ({
      ...lane,
      cards: cardsByLane[lane.id] || [],
    })),
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}

// ============== Board Endpoints ==============

/**
 * GET /api/projects/:projectId/kanban
 * Get board with all lanes and cards. Auto-creates if kanban_enabled.
 */
router.get('/', (req, res) => {
  const { projectId } = req.params;

  const project = projects.getById(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // If kanban is disabled, return null
  if (!project.kanbanEnabled) {
    return res.json(null);
  }

  // Get or create board
  const board = kanbanBoards.getOrCreateForProject(projectId);
  const fullBoard = buildFullBoardResponse(board);

  res.json(fullBoard);
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

  const lane = kanbanLanes.create(board.id, result.data);

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
router.patch('/lanes/:laneId', (req, res) => {
  const { projectId, laneId } = req.params;

  const result = UpdateKanbanLaneRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const lane = kanbanLanes.getById(laneId);
  if (!lane) {
    return res.status(404).json({ error: 'Lane not found' });
  }

  const updated = kanbanLanes.update(laneId, result.data);

  // Broadcast updated board
  const board = kanbanBoards.getByProjectId(projectId);
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
 * POST /api/projects/:projectId/kanban/cards
 * Add a session to the board (create card in a lane)
 */
router.post('/cards', (req, res) => {
  const { projectId } = req.params;

  const result = CreateKanbanCardRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const { sessionId, laneId } = result.data;

  // Check if session already has a card
  const existingCard = kanbanCards.getBySessionId(sessionId);
  if (existingCard) {
    return res.status(409).json({ error: 'Session already has a card on the board' });
  }

  // Verify lane exists
  const lane = kanbanLanes.getById(laneId);
  if (!lane) {
    return res.status(404).json({ error: 'Lane not found' });
  }

  const card = kanbanCards.create(laneId, sessionId);

  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_ADDED, {
    projectId,
    card,
    laneId,
  });

  res.status(201).json(card);
});

/**
 * PATCH /api/projects/:projectId/kanban/cards/:cardId/move
 * Move card to a different lane
 */
router.patch('/cards/:cardId/move', (req, res) => {
  const { projectId, cardId } = req.params;

  const result = MoveKanbanCardRequest.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.issues[0].message });
  }

  const card = kanbanCards.getByIdWithLane(cardId);
  if (!card) {
    return res.status(404).json({ error: 'Card not found' });
  }

  const { targetLaneId, sortOrder } = result.data;
  const fromLaneId = card.laneId;

  // Verify target lane exists
  const targetLane = kanbanLanes.getById(targetLaneId);
  if (!targetLane) {
    return res.status(404).json({ error: 'Target lane not found' });
  }

  const movedCard = kanbanCards.moveToLane(cardId, targetLaneId, sortOrder);

  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_MOVED, {
    projectId,
    cardId,
    fromLaneId,
    toLaneId: targetLaneId,
    card: movedCard,
  });

  // Note: runOnEnterTemplate handling is done in kanbanService, not here in basic route
  // This route just handles the move. The service layer handles template triggers.

  res.json(movedCard);
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

  const laneId = card.laneId;
  kanbanCards.delete(cardId);

  broadcastToProject(projectId, WS_MESSAGE_TYPES.KANBAN_CARD_REMOVED, {
    projectId,
    cardId,
    laneId,
  });

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
