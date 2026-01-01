import { describe, it, expect } from 'vitest';
import { BaseRepository } from './BaseRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('BaseRepository', () => {
  // Uses global setup from test/setup.js

  const mapProject = (row) => ({
    id: row.id,
    name: row.name,
    workingDirectory: row.working_directory,
  });

  describe('constructor', () => {
    it('creates repository with table name and mapper', () => {
      const repo = new BaseRepository('projects', mapProject);
      expect(repo.tableName).toBe('projects');
    });
  });

  describe('db getter', () => {
    it('returns database instance', () => {
      const repo = new BaseRepository('projects', mapProject);
      expect(repo.db).toBeDefined();
      expect(repo.db.prepare).toBeTypeOf('function');
    });
  });

  describe('map', () => {
    it('maps row using provided function', () => {
      const repo = new BaseRepository('projects', mapProject);
      const row = { id: '1', name: 'Test', working_directory: '/tmp' };

      const result = repo.map(row);

      expect(result).toEqual({
        id: '1',
        name: 'Test',
        workingDirectory: '/tmp',
      });
    });

    it('returns null for null row', () => {
      const repo = new BaseRepository('projects', mapProject);
      expect(repo.map(null)).toBeNull();
    });

    it('returns null for undefined row', () => {
      const repo = new BaseRepository('projects', mapProject);
      expect(repo.map(undefined)).toBeNull();
    });
  });

  describe('mapAll', () => {
    it('maps array of rows', () => {
      const repo = new BaseRepository('projects', mapProject);
      const rows = [
        { id: '1', name: 'Test1', working_directory: '/tmp/1' },
        { id: '2', name: 'Test2', working_directory: '/tmp/2' },
      ];

      const result = repo.mapAll(rows);

      expect(result).toHaveLength(2);
      expect(result[0].workingDirectory).toBe('/tmp/1');
      expect(result[1].workingDirectory).toBe('/tmp/2');
    });

    it('returns empty array for empty input', () => {
      const repo = new BaseRepository('projects', mapProject);
      expect(repo.mapAll([])).toEqual([]);
    });
  });

  describe('getById', () => {
    it('retrieves record by id', () => {
      const repo = new BaseRepository('projects', mapProject);
      const id = databaseManager.generateId();
      const now = Date.now();

      repo.db.prepare(
        'INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, 'Test', '/tmp', now, now);

      const result = repo.getById(id);

      expect(result.id).toBe(id);
      expect(result.name).toBe('Test');
    });

    it('returns null for non-existent id', () => {
      const repo = new BaseRepository('projects', mapProject);
      expect(repo.getById('non-existent')).toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes record by id', () => {
      const repo = new BaseRepository('projects', mapProject);
      const id = databaseManager.generateId();
      const now = Date.now();

      repo.db.prepare(
        'INSERT INTO projects (id, name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(id, 'Test', '/tmp', now, now);

      repo.delete(id);

      expect(repo.getById(id)).toBeNull();
    });

    it('does not throw for non-existent id', () => {
      const repo = new BaseRepository('projects', mapProject);
      expect(() => repo.delete('non-existent')).not.toThrow();
    });
  });
});
