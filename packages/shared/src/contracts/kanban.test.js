import { describe, it, expect } from 'vitest';
import {
  CreateKanbanLaneRequest,
  UpdateKanbanLaneRequest,
  ReorderKanbanLanesRequest,
  CreateKanbanCardRequest,
  MoveKanbanCardRequest,
  ReorderKanbanCardsRequest,
  KanbanLaneResponse,
  KanbanCardResponse,
  KanbanCardSessionResponse,
  KanbanBoardResponse,
  KanbanFullBoardResponse,
} from './kanban.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID2 = '550e8400-e29b-41d4-a716-446655440001';

describe('Kanban Contracts', () => {
  // ── CreateKanbanLaneRequest ──────────────────────────────────────

  describe('CreateKanbanLaneRequest', () => {
    it('validates valid request with name only', () => {
      const result = CreateKanbanLaneRequest.safeParse({ name: 'To Do' });
      expect(result.success).toBe(true);
      expect(result.data.name).toBe('To Do');
    });

    it('validates request with all fields', () => {
      const result = CreateKanbanLaneRequest.safeParse({
        name: 'Review',
        sortOrder: 2,
        onEnterTemplateId: UUID,
      });
      expect(result.success).toBe(true);
      expect(result.data.sortOrder).toBe(2);
      expect(result.data.onEnterTemplateId).toBe(UUID);
    });

    it('requires name', () => {
      const result = CreateKanbanLaneRequest.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects empty name', () => {
      const result = CreateKanbanLaneRequest.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });

    it('allows null onEnterTemplateId', () => {
      const result = CreateKanbanLaneRequest.safeParse({
        name: 'Test',
        onEnterTemplateId: null,
      });
      expect(result.success).toBe(true);
      expect(result.data.onEnterTemplateId).toBeNull();
    });

    it('rejects invalid UUID for onEnterTemplateId', () => {
      const result = CreateKanbanLaneRequest.safeParse({
        name: 'Test',
        onEnterTemplateId: 'not-a-uuid',
      });
      expect(result.success).toBe(false);
    });
  });

  // ── UpdateKanbanLaneRequest ──────────────────────────────────────

  describe('UpdateKanbanLaneRequest', () => {
    it('allows empty object', () => {
      const result = UpdateKanbanLaneRequest.safeParse({});
      expect(result.success).toBe(true);
    });

    it('allows partial update with name', () => {
      const result = UpdateKanbanLaneRequest.safeParse({ name: 'Updated' });
      expect(result.success).toBe(true);
    });

    it('allows partial update with sortOrder', () => {
      const result = UpdateKanbanLaneRequest.safeParse({ sortOrder: 5 });
      expect(result.success).toBe(true);
    });

    it('rejects empty name', () => {
      const result = UpdateKanbanLaneRequest.safeParse({ name: '' });
      expect(result.success).toBe(false);
    });
  });

  // ── ReorderKanbanLanesRequest ────────────────────────────────────

  describe('ReorderKanbanLanesRequest', () => {
    it('validates array of UUIDs', () => {
      const result = ReorderKanbanLanesRequest.safeParse([UUID, UUID2]);
      expect(result.success).toBe(true);
    });

    it('allows empty array', () => {
      const result = ReorderKanbanLanesRequest.safeParse([]);
      expect(result.success).toBe(true);
    });

    it('rejects non-UUID strings', () => {
      const result = ReorderKanbanLanesRequest.safeParse(['not-a-uuid']);
      expect(result.success).toBe(false);
    });

    it('rejects non-array', () => {
      const result = ReorderKanbanLanesRequest.safeParse('not-an-array');
      expect(result.success).toBe(false);
    });
  });

  // ── CreateKanbanCardRequest ──────────────────────────────────────

  describe('CreateKanbanCardRequest', () => {
    it('validates valid request', () => {
      const result = CreateKanbanCardRequest.safeParse({
        sessionId: UUID,
        laneId: UUID2,
      });
      expect(result.success).toBe(true);
    });

    it('requires sessionId', () => {
      const result = CreateKanbanCardRequest.safeParse({ laneId: UUID });
      expect(result.success).toBe(false);
    });

    it('requires laneId', () => {
      const result = CreateKanbanCardRequest.safeParse({ sessionId: UUID });
      expect(result.success).toBe(false);
    });

    it('rejects invalid UUIDs', () => {
      const result = CreateKanbanCardRequest.safeParse({
        sessionId: 'bad',
        laneId: 'bad',
      });
      expect(result.success).toBe(false);
    });
  });

  // ── MoveKanbanCardRequest ────────────────────────────────────────

  describe('MoveKanbanCardRequest', () => {
    it('validates with targetLaneId only', () => {
      const result = MoveKanbanCardRequest.safeParse({
        targetLaneId: UUID,
      });
      expect(result.success).toBe(true);
      expect(result.data.runOnEnterTemplate).toBe(true); // default
    });

    it('validates with all fields', () => {
      const result = MoveKanbanCardRequest.safeParse({
        targetLaneId: UUID,
        sortOrder: 3,
        runOnEnterTemplate: false,
      });
      expect(result.success).toBe(true);
      expect(result.data.sortOrder).toBe(3);
      expect(result.data.runOnEnterTemplate).toBe(false);
    });

    it('requires targetLaneId', () => {
      const result = MoveKanbanCardRequest.safeParse({});
      expect(result.success).toBe(false);
    });

    it('defaults runOnEnterTemplate to true', () => {
      const result = MoveKanbanCardRequest.safeParse({
        targetLaneId: UUID,
      });
      expect(result.success).toBe(true);
      expect(result.data.runOnEnterTemplate).toBe(true);
    });
  });

  // ── ReorderKanbanCardsRequest ────────────────────────────────────

  describe('ReorderKanbanCardsRequest', () => {
    it('validates array of UUIDs', () => {
      const result = ReorderKanbanCardsRequest.safeParse([UUID, UUID2]);
      expect(result.success).toBe(true);
    });

    it('allows empty array', () => {
      const result = ReorderKanbanCardsRequest.safeParse([]);
      expect(result.success).toBe(true);
    });

    it('rejects non-UUID strings', () => {
      const result = ReorderKanbanCardsRequest.safeParse(['bad']);
      expect(result.success).toBe(false);
    });
  });

  // ── KanbanLaneResponse ───────────────────────────────────────────

  describe('KanbanLaneResponse', () => {
    it('validates complete lane response', () => {
      const result = KanbanLaneResponse.safeParse({
        id: UUID,
        boardId: UUID2,
        name: 'To Do',
        sortOrder: 0,
        onEnterTemplateId: null,
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });
      expect(result.success).toBe(true);
    });

    it('allows null onEnterTemplateId', () => {
      const result = KanbanLaneResponse.safeParse({
        id: UUID,
        boardId: UUID2,
        name: 'Test',
        sortOrder: 0,
        onEnterTemplateId: null,
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });
      expect(result.success).toBe(true);
      expect(result.data.onEnterTemplateId).toBeNull();
    });

    it('requires all fields', () => {
      const result = KanbanLaneResponse.safeParse({ id: UUID });
      expect(result.success).toBe(false);
    });
  });

  // ── KanbanCardSessionResponse ────────────────────────────────────

  describe('KanbanCardSessionResponse', () => {
    it('validates complete session response', () => {
      const result = KanbanCardSessionResponse.safeParse({
        id: UUID,
        name: 'Test Session',
        status: 'running',
        mode: 'standard',
        costUsd: 0.05,
        starred: false,
        prUrl: null,
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });
      expect(result.success).toBe(true);
    });

    it('allows optional fields to be missing', () => {
      const result = KanbanCardSessionResponse.safeParse({
        id: UUID,
        name: 'Test',
        status: 'running',
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });
      expect(result.success).toBe(true);
    });
  });

  // ── KanbanCardResponse ───────────────────────────────────────────

  describe('KanbanCardResponse', () => {
    it('validates complete card response', () => {
      const result = KanbanCardResponse.safeParse({
        id: UUID,
        laneId: UUID2,
        sortOrder: 0,
        sessions: [
          {
            id: UUID,
            name: 'Session',
            status: 'running',
            createdAt: 1234567890,
            updatedAt: 1234567890,
          },
        ],
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });
      expect(result.success).toBe(true);
    });

    it('allows empty sessions array', () => {
      const result = KanbanCardResponse.safeParse({
        id: UUID,
        laneId: UUID2,
        sortOrder: 0,
        sessions: [],
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });
      expect(result.success).toBe(true);
    });
  });

  // ── KanbanBoardResponse ──────────────────────────────────────────

  describe('KanbanBoardResponse', () => {
    it('validates complete board response', () => {
      const result = KanbanBoardResponse.safeParse({
        id: UUID,
        projectId: UUID2,
        lanes: [
          {
            id: UUID,
            boardId: UUID2,
            name: 'To Do',
            sortOrder: 0,
            onEnterTemplateId: null,
            createdAt: 1234567890,
            updatedAt: 1234567890,
          },
        ],
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });
      expect(result.success).toBe(true);
    });

    it('allows empty lanes array', () => {
      const result = KanbanBoardResponse.safeParse({
        id: UUID,
        projectId: UUID2,
        lanes: [],
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });
      expect(result.success).toBe(true);
    });
  });

  // ── KanbanFullBoardResponse ──────────────────────────────────────

  describe('KanbanFullBoardResponse', () => {
    it('validates full board with lanes and cards', () => {
      const result = KanbanFullBoardResponse.safeParse({
        id: UUID,
        projectId: UUID2,
        lanes: [
          {
            id: UUID,
            boardId: UUID2,
            name: 'To Do',
            sortOrder: 0,
            onEnterTemplateId: null,
            createdAt: 1234567890,
            updatedAt: 1234567890,
            cards: [
              {
                id: UUID,
                laneId: UUID,
                sortOrder: 0,
                sessions: [],
                createdAt: 1234567890,
                updatedAt: 1234567890,
              },
            ],
          },
        ],
        createdAt: 1234567890,
        updatedAt: 1234567890,
      });
      expect(result.success).toBe(true);
    });
  });
});
