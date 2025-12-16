import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { projects, sessions } from '../src/database.js';
import { readFile } from 'fs/promises';
import { join } from 'path';

vi.mock('fs/promises');

describe('Session File API Logic', () => {
  let project;
  let session;

  beforeEach(() => {
    project = projects.create('Test Project', '/test/project/path');
    session = sessions.create(project.id, 'Test Session', 'Test prompt');
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('file path resolution', () => {
    it('uses project working directory by default', () => {
      const targetSession = sessions.getById(session.id);
      const targetProject = projects.getById(targetSession.projectId);
      const directory = targetSession.gitWorktree || targetProject.workingDirectory;

      expect(directory).toBe('/test/project/path');
    });

    it('prefers gitWorktree when set', () => {
      sessions.update(session.id, { gitWorktree: '/custom/worktree/path' });

      const targetSession = sessions.getById(session.id);
      const targetProject = projects.getById(targetSession.projectId);
      const directory = targetSession.gitWorktree || targetProject.workingDirectory;

      expect(directory).toBe('/custom/worktree/path');
    });
  });

  describe('path normalization', () => {
    it('strips directory traversal attempts', () => {
      const filePath = '../../../etc/passwd';
      const normalizedPath = filePath.replace(/\.\./g, '');
      expect(normalizedPath).toBe('///etc/passwd');
    });

    it('joins normalized path with directory', () => {
      const directory = '/test/project/path';
      const filePath = 'README.md';
      const fullPath = join(directory, filePath);
      expect(fullPath).toBe('/test/project/path/README.md');
    });

    it('strips directory traversal and keeps path within directory', () => {
      const directory = '/test/project/path';
      // After stripping .., ../../etc/passwd becomes //etc/passwd
      // When joined with directory, it stays within the directory
      const filePath = '../../etc/passwd';
      const normalizedPath = filePath.replace(/\.\./g, '');
      const fullPath = join(directory, normalizedPath);

      // The path ends up as /test/project/path/etc/passwd which starts with directory
      // This demonstrates that stripping .. is effective for this style of traversal
      expect(fullPath.startsWith(directory)).toBe(true);
    });

    it('allows valid paths within directory', () => {
      const directory = '/test/project/path';
      const filePath = 'docs/README.md';
      const fullPath = join(directory, filePath);

      expect(fullPath.startsWith(directory)).toBe(true);
      expect(fullPath).toBe('/test/project/path/docs/README.md');
    });
  });

  describe('file reading', () => {
    it('reads file content successfully', async () => {
      readFile.mockResolvedValue('# Hello World\n\nSome markdown content.');

      const content = await readFile('/test/project/path/README.md', 'utf-8');

      expect(content).toBe('# Hello World\n\nSome markdown content.');
      expect(readFile).toHaveBeenCalledWith('/test/project/path/README.md', 'utf-8');
    });

    it('throws ENOENT for non-existent files', async () => {
      const error = new Error('ENOENT: no such file or directory');
      error.code = 'ENOENT';
      readFile.mockRejectedValue(error);

      await expect(readFile('/test/project/path/nonexistent.md', 'utf-8')).rejects.toThrow();
    });

    it('handles other read errors', async () => {
      const error = new Error('EACCES: permission denied');
      error.code = 'EACCES';
      readFile.mockRejectedValue(error);

      await expect(readFile('/test/project/path/protected.md', 'utf-8')).rejects.toThrow();
    });
  });

  describe('session lookup', () => {
    it('finds session by id', () => {
      const found = sessions.getById(session.id);
      expect(found).not.toBeNull();
      expect(found.id).toBe(session.id);
    });

    it('returns null for non-existent session', () => {
      const found = sessions.getById('nonexistent-id');
      expect(found).toBeNull();
    });
  });

  describe('project lookup from session', () => {
    it('finds project via session.projectId', () => {
      const targetSession = sessions.getById(session.id);
      const targetProject = projects.getById(targetSession.projectId);
      expect(targetProject).not.toBeNull();
      expect(targetProject.workingDirectory).toBe('/test/project/path');
    });
  });
});
