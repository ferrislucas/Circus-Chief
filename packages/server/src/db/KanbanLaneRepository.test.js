import { describe, it, expect, beforeEach } from 'vitest';
import { KanbanBoardRepository } from './KanbanBoardRepository.js';
import { KanbanLaneRepository } from './KanbanLaneRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { SessionTemplateRepository } from './SessionTemplateRepository.js';

describe('KanbanLaneRepository', () => {
  let boardRepo;
  let laneRepo;
  let projectRepo;
  let templateRepo;
  let projectId;
  let boardId;

  beforeEach(() => {
    boardRepo = new KanbanBoardRepository();
    laneRepo = new KanbanLaneRepository();
    projectRepo = new ProjectRepository();
    templateRepo = new SessionTemplateRepository();

    const project = projectRepo.create('Test Project', '/tmp/test');
    projectId = project.id;

    const board = boardRepo.create(projectId);
    boardId = board.id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(laneRepo).toBeInstanceOf(KanbanLaneRepository);
      expect(laneRepo.tableName).toBe('kanban_lanes');
    });
  });

  describe('getByBoardId', () => {
    it('returns default lanes created with board', () => {
      const lanes = laneRepo.getByBoardId(boardId);

      expect(lanes).toHaveLength(4);
      expect(lanes[0].name).toBe('To Do');
      expect(lanes[3].name).toBe('Done');
    });

    it('returns lanes ordered by sort_order', () => {
      const lanes = laneRepo.getByBoardId(boardId);

      for (let i = 0; i < lanes.length - 1; i++) {
        expect(lanes[i].sortOrder).toBeLessThan(lanes[i + 1].sortOrder);
      }
    });

    it('returns empty array for non-existent board', () => {
      const lanes = laneRepo.getByBoardId('non-existent');
      expect(lanes).toEqual([]);
    });
  });

  describe('create', () => {
    it('creates a lane with name', () => {
      const lane = laneRepo.create(boardId, { name: 'Custom Lane' });

      expect(lane.id).toBeDefined();
      expect(lane.boardId).toBe(boardId);
      expect(lane.name).toBe('Custom Lane');
      expect(lane.createdAt).toBeTypeOf('number');
      expect(lane.updatedAt).toBeTypeOf('number');
    });

    it('auto-assigns sort order at the end when not provided', () => {
      // Default lanes are 0, 1, 2, 3
      const lane = laneRepo.create(boardId, { name: 'New Lane' });

      expect(lane.sortOrder).toBe(4);
    });

    it('uses provided sort order', () => {
      const lane = laneRepo.create(boardId, { name: 'Custom', sortOrder: 10 });

      expect(lane.sortOrder).toBe(10);
    });

    it('creates lane with onEnterTemplateId', () => {
      const template = templateRepo.create({
        projectId,
        name: 'Test Template',
        prompt: 'Do something',
      });

      const lane = laneRepo.create(boardId, {
        name: 'Auto Lane',
        onEnterTemplateId: template.id,
      });

      expect(lane.onEnterTemplateId).toBe(template.id);
    });

    it('creates lane with null onEnterTemplateId by default', () => {
      const lane = laneRepo.create(boardId, { name: 'Plain Lane' });

      expect(lane.onEnterTemplateId).toBeNull();
    });

    it('maps completionTargetLaneId as null by default', () => {
      const lane = laneRepo.create(boardId, { name: 'Plain Lane' });

      expect(lane.completionTargetLaneId).toBeNull();
    });

    it('creates a lane with structured completion mode (W2: activation no longer gated)', () => {
      const lane = laneRepo.create(boardId, { name: 'Structured Lane', completionMode: 'structured' });

      expect(lane.completionMode).toBe('structured');
    });

    it('defaults completionMode to legacy when omitted', () => {
      const lane = laneRepo.create(boardId, { name: 'Plain Lane' });

      expect(lane.completionMode).toBe('legacy');
    });

    it('derives structured completion from a target unless an explicit mode is supplied', () => {
      const target = laneRepo.create(boardId, { name: 'Target' });
      expect(laneRepo.create(boardId, { name: 'Derived', completionTargetLaneId: target.id }))
        .toEqual(expect.objectContaining({ completionTargetLaneId: target.id, completionMode: 'structured' }));
      expect(laneRepo.create(boardId, { name: 'Explicit legacy', completionTargetLaneId: target.id, completionMode: 'legacy' }).completionMode)
        .toBe('legacy');
      expect(laneRepo.create(boardId, { name: 'Explicit structured', completionMode: 'structured' }).completionMode)
        .toBe('structured');
    });
  });

  describe('update', () => {
    it('persists structured completion mode (W2: activation no longer gated)', () => {
      const lane = laneRepo.create(boardId, { name: 'Workflow lane' });
      const updated = laneRepo.update(lane.id, { completionMode: 'structured' });
      expect(updated.completionMode).toBe('structured');
    });

    it('persists shadow completion mode', () => {
      const lane = laneRepo.create(boardId, { name: 'Shadow lane' });
      const updated = laneRepo.update(lane.id, { completionMode: 'shadow' });
      expect(updated.completionMode).toBe('shadow');
    });

    it('updates lane name', () => {
      const lane = laneRepo.create(boardId, { name: 'Original' });
      const updated = laneRepo.update(lane.id, { name: 'Updated' });

      expect(updated.name).toBe('Updated');
    });

    it('updates sort order', () => {
      const lane = laneRepo.create(boardId, { name: 'Test' });
      const updated = laneRepo.update(lane.id, { sortOrder: 99 });

      expect(updated.sortOrder).toBe(99);
    });

    it('updates onEnterTemplateId', () => {
      const template = templateRepo.create({
        projectId,
        name: 'Template',
        prompt: 'Prompt',
      });

      const lane = laneRepo.create(boardId, { name: 'Test' });
      const updated = laneRepo.update(lane.id, { onEnterTemplateId: template.id });

      expect(updated.onEnterTemplateId).toBe(template.id);
    });

    it('clears onEnterTemplateId when set to null', () => {
      const template = templateRepo.create({
        projectId,
        name: 'Template',
        prompt: 'Prompt',
      });

      const lane = laneRepo.create(boardId, { name: 'Test', onEnterTemplateId: template.id });
      expect(lane.onEnterTemplateId).toBe(template.id);

      const updated = laneRepo.update(lane.id, { onEnterTemplateId: null });
      expect(updated.onEnterTemplateId).toBeNull();
    });

    it('updates completionTargetLaneId', () => {
      const source = laneRepo.create(boardId, { name: 'Source' });
      const target = laneRepo.create(boardId, { name: 'Target' });

      const updated = laneRepo.update(source.id, { completionTargetLaneId: target.id });

      expect(updated.completionTargetLaneId).toBe(target.id);
    });

    it('clears completionTargetLaneId when set to null', () => {
      const source = laneRepo.create(boardId, { name: 'Source' });
      const target = laneRepo.create(boardId, { name: 'Target' });
      laneRepo.update(source.id, { completionTargetLaneId: target.id });

      const updated = laneRepo.update(source.id, { completionTargetLaneId: null });

      expect(updated.completionTargetLaneId).toBeNull();
    });

    it('reverts completionMode to legacy when the completion target is cleared without an explicit mode (F3)', () => {
      const source = laneRepo.create(boardId, { name: 'Source' });
      const target = laneRepo.create(boardId, { name: 'Target' });
      const withTarget = laneRepo.update(source.id, { completionTargetLaneId: target.id });
      expect(withTarget.completionMode).toBe('structured');

      const cleared = laneRepo.update(source.id, { completionTargetLaneId: null });

      expect(cleared.completionTargetLaneId).toBeNull();
      expect(cleared.completionMode).toBe('legacy');
    });

    it('honors an explicit completionMode when clearing the completion target (F3 boundary)', () => {
      const source = laneRepo.create(boardId, { name: 'Source' });
      const target = laneRepo.create(boardId, { name: 'Target' });
      laneRepo.update(source.id, { completionTargetLaneId: target.id });

      const cleared = laneRepo.update(source.id, {
        completionTargetLaneId: null,
        completionMode: 'shadow',
      });

      expect(cleared.completionTargetLaneId).toBeNull();
      expect(cleared.completionMode).toBe('shadow');
    });

    it('returns unchanged lane when no updates provided', () => {
      const lane = laneRepo.create(boardId, { name: 'Test' });
      const result = laneRepo.update(lane.id, {});

      expect(result.name).toBe('Test');
    });

    it('updates updatedAt timestamp', () => {
      const lane = laneRepo.create(boardId, { name: 'Test' });
      const updated = laneRepo.update(lane.id, { name: 'Updated' });

      expect(updated.updatedAt).toBeGreaterThanOrEqual(lane.updatedAt);
    });
  });

  describe('reorder', () => {
    it('reorders lanes based on array position', () => {
      const lanes = laneRepo.getByBoardId(boardId);
      const reversed = [...lanes].reverse().map((l) => l.id);

      laneRepo.reorder(boardId, reversed);

      const reordered = laneRepo.getByBoardId(boardId);
      expect(reordered[0].id).toBe(reversed[0]);
      expect(reordered[3].id).toBe(reversed[3]);
    });

    it('assigns consecutive sort order values', () => {
      const lanes = laneRepo.getByBoardId(boardId);
      const ids = lanes.map((l) => l.id);

      laneRepo.reorder(boardId, ids.reverse());

      const reordered = laneRepo.getByBoardId(boardId);
      expect(reordered[0].sortOrder).toBe(0);
      expect(reordered[1].sortOrder).toBe(1);
      expect(reordered[2].sortOrder).toBe(2);
      expect(reordered[3].sortOrder).toBe(3);
    });
  });

  describe('getById', () => {
    it('returns a lane by ID', () => {
      const lane = laneRepo.create(boardId, { name: 'Test Lane' });
      const retrieved = laneRepo.getById(lane.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.id).toBe(lane.id);
      expect(retrieved.name).toBe('Test Lane');
    });

    it('returns null for non-existent ID', () => {
      expect(laneRepo.getById('non-existent')).toBeNull();
    });
  });

  describe('getByIdWithTemplate', () => {
    it('returns lane with template info when template is set', () => {
      const template = templateRepo.create({
        projectId,
        name: 'Auto Template',
        prompt: 'Do the thing',
      });

      const lane = laneRepo.create(boardId, {
        name: 'Auto Lane',
        onEnterTemplateId: template.id,
      });

      const result = laneRepo.getByIdWithTemplate(lane.id);

      expect(result).not.toBeNull();
      expect(result.template).not.toBeNull();
      expect(result.template.id).toBe(template.id);
      expect(result.template.name).toBe('Auto Template');
      expect(result.template.prompt).toBe('Do the thing');
    });

    it('returns lane with null template when no template set', () => {
      const lane = laneRepo.create(boardId, { name: 'Plain Lane' });

      const result = laneRepo.getByIdWithTemplate(lane.id);

      expect(result).not.toBeNull();
      expect(result.template).toBeNull();
    });

    it('returns null for non-existent lane', () => {
      expect(laneRepo.getByIdWithTemplate('non-existent')).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes a lane', () => {
      const lane = laneRepo.create(boardId, { name: 'Delete Me' });
      laneRepo.delete(lane.id);

      expect(laneRepo.getById(lane.id)).toBeNull();
    });

    it('does not throw when deleting non-existent lane', () => {
      expect(() => laneRepo.delete('non-existent')).not.toThrow();
    });
  });
});
