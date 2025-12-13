import { describe, it, expect } from 'vitest';
import { projects, sessions, messages, canvasItems, sessionNotes, generateId } from '../src/database.js';

describe('Database', () => {
  describe('generateId', () => {
    it('generates valid UUIDs', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('generates unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('projects', () => {
    it('creates a project', () => {
      const project = projects.create('Test Project', '/tmp/test');

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.workingDirectory).toBe('/tmp/test');
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
    });

    it('gets a project by ID', () => {
      const created = projects.create('Test', '/tmp/test');
      const retrieved = projects.getById(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns null for non-existent project', () => {
      const project = projects.getById('non-existent');
      expect(project).toBeNull();
    });

    it('lists all projects', () => {
      projects.create('Project 1', '/tmp/1');
      projects.create('Project 2', '/tmp/2');

      const all = projects.getAll();
      expect(all.length).toBe(2);
    });

    it('updates a project', () => {
      const project = projects.create('Original', '/tmp/original');
      const updated = projects.update(project.id, { name: 'Updated' });

      expect(updated.name).toBe('Updated');
      expect(updated.workingDirectory).toBe('/tmp/original');
    });

    it('deletes a project', () => {
      const project = projects.create('To Delete', '/tmp/delete');
      projects.delete(project.id);

      expect(projects.getById(project.id)).toBeNull();
    });
  });

  describe('sessions', () => {
    it('creates a session', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');

      expect(session.id).toBeDefined();
      expect(session.projectId).toBe(project.id);
      expect(session.name).toBe('Test Session');
      expect(session.status).toBe('starting');
      expect(session.mode).toBe('standard');
    });

    it('creates initial user message on session creation', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Hello Claude');

      const sessionMessages = messages.getBySessionId(session.id);
      expect(sessionMessages.length).toBe(1);
      expect(sessionMessages[0].role).toBe('user');
      expect(sessionMessages[0].content).toBe('Hello Claude');
    });

    it('gets sessions by project ID', () => {
      const project = projects.create('Test', '/tmp/test');
      sessions.create(project.id, 'Session 1', 'Prompt 1');
      sessions.create(project.id, 'Session 2', 'Prompt 2');

      const projectSessions = sessions.getByProjectId(project.id);
      expect(projectSessions.length).toBe(2);
    });

    it('updates session status', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Prompt');

      const updated = sessions.update(session.id, { status: 'running' });
      expect(updated.status).toBe('running');
    });

    it('cascades delete from project', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Prompt');

      projects.delete(project.id);
      expect(sessions.getById(session.id)).toBeNull();
    });
  });

  describe('messages', () => {
    it('creates a message', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const message = messages.create(session.id, 'assistant', 'Hello!');
      expect(message.id).toBeDefined();
      expect(message.sessionId).toBe(session.id);
      expect(message.role).toBe('assistant');
      expect(message.content).toBe('Hello!');
    });

    it('stores tool use as JSON', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const toolUse = [{ name: 'bash', input: { command: 'ls' } }];
      const message = messages.create(session.id, 'assistant', 'Running...', toolUse);

      expect(message.toolUse).toEqual(toolUse);
    });

    it('returns messages in chronological order', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'First');

      messages.create(session.id, 'assistant', 'Second');
      messages.create(session.id, 'user', 'Third');

      const all = messages.getBySessionId(session.id);
      expect(all[0].content).toBe('First');
      expect(all[1].content).toBe('Second');
      expect(all[2].content).toBe('Third');
    });
  });

  describe('canvasItems', () => {
    it('creates a canvas item', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const item = canvasItems.create(session.id, {
        type: 'markdown',
        content: '# Hello',
        label: 'Test',
      });

      expect(item.id).toBeDefined();
      expect(item.sessionId).toBe(session.id);
      expect(item.type).toBe('markdown');
      expect(item.content).toBe('# Hello');
      expect(item.label).toBe('Test');
    });

    it('gets items by session ID', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      canvasItems.create(session.id, { type: 'text', content: 'Item 1' });
      canvasItems.create(session.id, { type: 'text', content: 'Item 2' });

      const items = canvasItems.getBySessionId(session.id);
      expect(items.length).toBe(2);
    });

    it('deletes a canvas item', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const item = canvasItems.create(session.id, { type: 'text', content: 'Delete me' });
      canvasItems.delete(item.id);

      expect(canvasItems.getById(item.id)).toBeNull();
    });
  });

  describe('sessionNotes', () => {
    it('creates a note', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const note = sessionNotes.create(session.id, 'Important note');

      expect(note.id).toBeDefined();
      expect(note.sessionId).toBe(session.id);
      expect(note.content).toBe('Important note');
    });

    it('updates a note', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const note = sessionNotes.create(session.id, 'Original');
      const updated = sessionNotes.update(note.id, 'Updated');

      expect(updated.content).toBe('Updated');
    });

    it('deletes a note', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const note = sessionNotes.create(session.id, 'Delete me');
      sessionNotes.delete(note.id);

      expect(sessionNotes.getById(note.id)).toBeNull();
    });
  });
});
