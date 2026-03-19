import { describe, it, expect, beforeEach } from 'vitest';
import { KanbanBoardRepository } from './KanbanBoardRepository.js';
import { KanbanLaneRepository } from './KanbanLaneRepository.js';
import { ProjectRepository } from './ProjectRepository.js';

describe('KanbanBoardRepository', () => {
  let boardRepo;
  let laneRepo;
  let projectRepo;
  let projectId;

  beforeEach(() => {
    boardRepo = new KanbanBoardRepository();
    laneRepo = new KanbanLaneRepository();
    projectRepo = new ProjectRepository();

    const project = projectRepo.create('Test Project', '/tmp/test');
    projectId = project.id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(boardRepo).toBeInstanceOf(KanbanBoardRepository);
      expect(boardRepo.tableName).toBe('kanban_boards');
    });
  });

  describe('create', () => {
    it('creates a board for a project', () => {
      const board = boardRepo.create(projectId);

      expect(board.id).toBeDefined();
      expect(board.projectId).toBe(projectId);
      expect(board.createdAt).toBeTypeOf('number');
      expect(board.updatedAt).toBeTypeOf('number');
    });

    it('creates default lanes with the board', () => {
      const board = boardRepo.create(projectId);
      const lanes = laneRepo.getByBoardId(board.id);

      expect(lanes).toHaveLength(4);
      expect(lanes[0].name).toBe('To Do');
      expect(lanes[1].name).toBe('In Progress');
      expect(lanes[2].name).toBe('Review');
      expect(lanes[3].name).toBe('Done');
    });

    it('creates lanes with correct sort order', () => {
      const board = boardRepo.create(projectId);
      const lanes = laneRepo.getByBoardId(board.id);

      expect(lanes[0].sortOrder).toBe(0);
      expect(lanes[1].sortOrder).toBe(1);
      expect(lanes[2].sortOrder).toBe(2);
      expect(lanes[3].sortOrder).toBe(3);
    });

    it('generates unique IDs for each board', () => {
      const project2 = projectRepo.create('Project 2', '/tmp/test2');
      const board1 = boardRepo.create(projectId);
      const board2 = boardRepo.create(project2.id);

      expect(board1.id).not.toBe(board2.id);
    });
  });

  describe('getByProjectId', () => {
    it('returns board for a project', () => {
      const created = boardRepo.create(projectId);
      const retrieved = boardRepo.getByProjectId(projectId);

      expect(retrieved).not.toBeNull();
      expect(retrieved.id).toBe(created.id);
      expect(retrieved.projectId).toBe(projectId);
    });

    it('returns null when no board exists', () => {
      const result = boardRepo.getByProjectId(projectId);
      expect(result).toBeNull();
    });

    it('returns null for non-existent project', () => {
      const result = boardRepo.getByProjectId('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('getOrCreateForProject', () => {
    it('creates a board when none exists', () => {
      const board = boardRepo.getOrCreateForProject(projectId);

      expect(board).not.toBeNull();
      expect(board.projectId).toBe(projectId);
    });

    it('returns existing board when one already exists', () => {
      const first = boardRepo.getOrCreateForProject(projectId);
      const second = boardRepo.getOrCreateForProject(projectId);

      expect(first.id).toBe(second.id);
    });

    it('only creates default lanes once', () => {
      boardRepo.getOrCreateForProject(projectId);
      const board = boardRepo.getOrCreateForProject(projectId);
      const lanes = laneRepo.getByBoardId(board.id);

      expect(lanes).toHaveLength(4);
    });
  });

  describe('delete', () => {
    it('deletes a board', () => {
      const board = boardRepo.create(projectId);
      boardRepo.delete(board.id);

      expect(boardRepo.getById(board.id)).toBeNull();
    });

    it('cascade deletes lanes when board is deleted', () => {
      const board = boardRepo.create(projectId);
      const lanes = laneRepo.getByBoardId(board.id);
      expect(lanes.length).toBeGreaterThan(0);

      boardRepo.delete(board.id);

      const remainingLanes = laneRepo.getByBoardId(board.id);
      expect(remainingLanes).toHaveLength(0);
    });

    it('does not throw when deleting non-existent board', () => {
      expect(() => boardRepo.delete('non-existent')).not.toThrow();
    });
  });

  describe('getById', () => {
    it('retrieves board by ID', () => {
      const created = boardRepo.create(projectId);
      const retrieved = boardRepo.getById(created.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.id).toBe(created.id);
    });

    it('returns null for non-existent ID', () => {
      const result = boardRepo.getById('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('project cascade delete', () => {
    it('deletes board when project is deleted', () => {
      const board = boardRepo.create(projectId);
      projectRepo.delete(projectId);

      expect(boardRepo.getById(board.id)).toBeNull();
    });
  });
});
