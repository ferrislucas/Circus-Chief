import { Router } from 'express';
import { kanbanBoards, kanbanLanes, kanbanCards, projects, sessions } from '../database.js';
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

const router = Router({ mergeParams: true });
const LANE_NOT_FOUND_ERROR = 'Lane not found';

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
    return res.status(404).json({ error: LANE_NOT_FOUND_ERROR });
  }

  const board = kanbanBoards.getByProjectId(projectId);
  if (!board || board.id !== lane.boardId) {
    return res.status(404).json({ error: LANE_NOT_FOUND_ERROR });
  }

  if (result.data.completionTargetLaneId !== undefined && result.data.completionTargetLaneId !== null) {
    if (result.data.completionTargetLaneId === laneId) {
      return res.status(400).json({ error: 'Completion target lane cannot be the same lane' });
    }

    const targetLane = kanbanLanes.getById(result.data.completionTargetLaneId);
    if (!targetLane) {
      return res.status(404).json({ error: 'Completion target lane not found' });
    }
    if (targetLane.boardId !== lane.boardId) {
      return res.status(400).json({ error: 'Completion target lane must be on the same board' });
    }
  }

  const updated = kanbanLanes.update(laneId, result.data);

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
    res.status(201).json(card);
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
    res.json(movedCard);
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

  const targetLane = kanbanLanes.getById(targetLaneId);
  if (!targetLane) {
    return res.status(404).json({ error: 'Target lane not found' });
  }

  try {
    const movedCard = await moveCardService(card.id, targetLaneId, {
      sortOrder,
      runOnEnterTemplate,
    });
    res.json(movedCard);
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
