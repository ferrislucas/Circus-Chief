import { z } from 'zod';

// Board contracts
export const KanbanBoardResponse = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  lanes: z.lazy(() => z.array(KanbanLaneResponse)),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Lane contracts
export const CreateKanbanLaneRequest = z.object({
  name: z.string().min(1),
  sortOrder: z.number().optional(),
  onEnterTemplateId: z.string().uuid().nullable().optional(),
});

export const UpdateKanbanLaneRequest = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().optional(),
  onEnterTemplateId: z.string().uuid().nullable().optional(),
});

export const ReorderKanbanLanesRequest = z.array(z.string().uuid());

export const KanbanLaneResponse = z.object({
  id: z.string().uuid(),
  boardId: z.string().uuid(),
  name: z.string(),
  sortOrder: z.number(),
  onEnterTemplateId: z.string().uuid().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Card contracts
export const CreateKanbanCardRequest = z.object({
  sessionId: z.string().uuid(),
  laneId: z.string().uuid(),
});

export const MoveKanbanCardRequest = z.object({
  targetLaneId: z.string().uuid(),
  sortOrder: z.number().optional(),
  runOnEnterTemplate: z.boolean().default(true),
});

export const ReorderKanbanCardsRequest = z.array(z.string().uuid());

// Card session info
export const KanbanCardSessionResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  mode: z.string().optional(),
  costUsd: z.number().optional(),
  starred: z.boolean().optional(),
  prUrl: z.string().nullable().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const KanbanCardResponse = z.object({
  id: z.string().uuid(),
  laneId: z.string().uuid(),
  sortOrder: z.number(),
  sessions: z.array(KanbanCardSessionResponse),
  createdAt: z.number(),
  updatedAt: z.number(),
});

// Full board with lanes and cards
export const KanbanFullBoardResponse = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  lanes: z.array(
    KanbanLaneResponse.extend({
      cards: z.array(KanbanCardResponse),
    })
  ),
  createdAt: z.number(),
  updatedAt: z.number(),
});
