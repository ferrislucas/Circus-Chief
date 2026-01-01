import { describe, it, expect, beforeEach } from 'vitest';
import { projects, sessions } from '../src/database.js';

describe('API Endpoints', () => {
  describe('Projects API', () => {
    it('GET /api/projects returns empty array initially', () => {
      const all = projects.getAll();
      expect(all).toEqual([]);
    });

    it('POST /api/projects creates a project', () => {
      const project = projects.create('Test Project', '/tmp/test');
      expect(project.name).toBe('Test Project');
      expect(project.workingDirectory).toBe('/tmp/test');
    });

    it('GET /api/projects/:id returns project', () => {
      const created = projects.create('Test', '/tmp/test');
      const retrieved = projects.getById(created.id);
      expect(retrieved).toEqual(created);
    });

    it('PUT /api/projects/:id updates project', () => {
      const created = projects.create('Original', '/tmp/original');
      const updated = projects.update(created.id, { name: 'Updated' });
      expect(updated.name).toBe('Updated');
    });

    it('DELETE /api/projects/:id deletes project', () => {
      const created = projects.create('To Delete', '/tmp/delete');
      projects.delete(created.id);
      expect(projects.getById(created.id)).toBeNull();
    });
  });

  describe('Sessions API', () => {
    let project;

    beforeEach(() => {
      project = projects.create('Test Project', '/tmp/test');
    });

    it('POST /api/projects/:id/sessions creates a session', () => {
      const session = sessions.create(project.id, 'Test Session', 'Hello', 'standard');
      expect(session.name).toBe('Test Session');
      expect(session.status).toBe('starting');
    });

    it('GET /api/projects/:id/sessions returns sessions', () => {
      sessions.create(project.id, 'Session 1', 'Prompt 1');
      sessions.create(project.id, 'Session 2', 'Prompt 2');
      const all = sessions.getByProjectId(project.id);
      expect(all.length).toBe(2);
    });

    it('GET /api/sessions/:id returns session', () => {
      const session = sessions.create(project.id, 'Test', 'Prompt');
      const retrieved = sessions.getById(session.id);
      expect(retrieved).toEqual(session);
    });
  });
});
