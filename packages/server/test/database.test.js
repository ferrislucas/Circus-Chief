import { describe, it, expect, beforeEach } from 'vitest';
import {
  DatabaseManager,
  ProjectRepository,
  SessionRepository,
  MessageRepository,
  CanvasItemRepository,
  SessionNoteRepository,
  projects,
  sessions,
  messages,
  canvasItems,
  sessionNotes,
  generateId,
  databaseManager,
} from '../src/database.js';

describe('DatabaseManager', () => {
  describe('class instantiation', () => {
    it('is a class that can be instantiated', () => {
      expect(DatabaseManager).toBeTypeOf('function');
      expect(databaseManager).toBeInstanceOf(DatabaseManager);
    });

    it('has init, get, close, generateId, and transaction methods', () => {
      expect(databaseManager.init).toBeTypeOf('function');
      expect(databaseManager.get).toBeTypeOf('function');
      expect(databaseManager.close).toBeTypeOf('function');
      expect(databaseManager.generateId).toBeTypeOf('function');
      expect(databaseManager.transaction).toBeTypeOf('function');
    });
  });

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

    it('works via databaseManager instance', () => {
      const id = databaseManager.generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
  });

  describe('database operations', () => {
    it('returns database instance from get()', () => {
      const db = databaseManager.get();
      expect(db).toBeDefined();
      expect(db.prepare).toBeTypeOf('function');
    });
  });
});

describe('ProjectRepository', () => {
  describe('class instantiation', () => {
    it('is a class that can be instantiated', () => {
      expect(ProjectRepository).toBeTypeOf('function');
      expect(projects).toBeInstanceOf(ProjectRepository);
    });

    it('has CRUD methods', () => {
      expect(projects.create).toBeTypeOf('function');
      expect(projects.getById).toBeTypeOf('function');
      expect(projects.getAll).toBeTypeOf('function');
      expect(projects.update).toBeTypeOf('function');
      expect(projects.delete).toBeTypeOf('function');
    });
  });

  describe('create', () => {
    it('creates a project', () => {
      const project = projects.create('Test Project', '/tmp/test');

      expect(project.id).toBeDefined();
      expect(project.name).toBe('Test Project');
      expect(project.workingDirectory).toBe('/tmp/test');
      expect(project.createdAt).toBeDefined();
      expect(project.updatedAt).toBeDefined();
    });
  });

  describe('getById', () => {
    it('gets a project by ID', () => {
      const created = projects.create('Test', '/tmp/test');
      const retrieved = projects.getById(created.id);

      expect(retrieved).toEqual(created);
    });

    it('returns null for non-existent project', () => {
      const project = projects.getById('non-existent');
      expect(project).toBeNull();
    });
  });

  describe('getAll', () => {
    it('lists all projects', () => {
      projects.create('Project 1', '/tmp/1');
      projects.create('Project 2', '/tmp/2');

      const all = projects.getAll();
      expect(all.length).toBe(2);
    });
  });

  describe('update', () => {
    it('updates a project', () => {
      const project = projects.create('Original', '/tmp/original');
      const updated = projects.update(project.id, { name: 'Updated' });

      expect(updated.name).toBe('Updated');
      expect(updated.workingDirectory).toBe('/tmp/original');
    });

    it('returns unchanged project when no updates provided', () => {
      const project = projects.create('Test', '/tmp/test');
      const result = projects.update(project.id, {});

      expect(result.name).toBe('Test');
    });
  });

  describe('delete', () => {
    it('deletes a project', () => {
      const project = projects.create('To Delete', '/tmp/delete');
      projects.delete(project.id);

      expect(projects.getById(project.id)).toBeNull();
    });
  });
});

describe('SessionRepository', () => {
  describe('class instantiation', () => {
    it('is a class that can be instantiated', () => {
      expect(SessionRepository).toBeTypeOf('function');
      expect(sessions).toBeInstanceOf(SessionRepository);
    });

    it('has CRUD methods', () => {
      expect(sessions.create).toBeTypeOf('function');
      expect(sessions.getById).toBeTypeOf('function');
      expect(sessions.getByProjectId).toBeTypeOf('function');
      expect(sessions.update).toBeTypeOf('function');
      expect(sessions.delete).toBeTypeOf('function');
    });
  });

  describe('create', () => {
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

    it('creates session with git branch', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Prompt', 'standard', 'feature-branch');

      expect(session.gitBranch).toBe('feature-branch');
    });
  });

  describe('getByProjectId', () => {
    it('gets sessions by project ID', () => {
      const project = projects.create('Test', '/tmp/test');
      sessions.create(project.id, 'Session 1', 'Prompt 1');
      sessions.create(project.id, 'Session 2', 'Prompt 2');

      const projectSessions = sessions.getByProjectId(project.id);
      expect(projectSessions.length).toBe(2);
    });
  });

  describe('update', () => {
    it('updates session status', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Prompt');

      const updated = sessions.update(session.id, { status: 'running' });
      expect(updated.status).toBe('running');
    });

    it('updates multiple fields', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Prompt');

      const updated = sessions.update(session.id, {
        status: 'completed',
        prUrl: 'https://github.com/pr/123',
      });

      expect(updated.status).toBe('completed');
      expect(updated.prUrl).toBe('https://github.com/pr/123');
    });
  });

  describe('cascade delete', () => {
    it('cascades delete from project', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Prompt');

      projects.delete(project.id);
      expect(sessions.getById(session.id)).toBeNull();
    });
  });
});

describe('MessageRepository', () => {
  describe('class instantiation', () => {
    it('is a class that can be instantiated', () => {
      expect(MessageRepository).toBeTypeOf('function');
      expect(messages).toBeInstanceOf(MessageRepository);
    });

    it('has CRUD methods', () => {
      expect(messages.create).toBeTypeOf('function');
      expect(messages.getById).toBeTypeOf('function');
      expect(messages.getBySessionId).toBeTypeOf('function');
    });
  });

  describe('create', () => {
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
  });

  describe('getBySessionId', () => {
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
});

describe('CanvasItemRepository', () => {
  describe('class instantiation', () => {
    it('is a class that can be instantiated', () => {
      expect(CanvasItemRepository).toBeTypeOf('function');
      expect(canvasItems).toBeInstanceOf(CanvasItemRepository);
    });

    it('has CRUD methods', () => {
      expect(canvasItems.create).toBeTypeOf('function');
      expect(canvasItems.getById).toBeTypeOf('function');
      expect(canvasItems.getBySessionId).toBeTypeOf('function');
      expect(canvasItems.delete).toBeTypeOf('function');
    });
  });

  describe('create', () => {
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

    it('creates canvas item with all optional fields', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const item = canvasItems.create(session.id, {
        type: 'image',
        data: 'base64data',
        mimeType: 'image/png',
        filename: 'test.png',
        width: 100,
        height: 200,
      });

      expect(item.type).toBe('image');
      expect(item.data).toBe('base64data');
      expect(item.mimeType).toBe('image/png');
      expect(item.filename).toBe('test.png');
      expect(item.width).toBe(100);
      expect(item.height).toBe(200);
    });
  });

  describe('getBySessionId', () => {
    it('gets items by session ID', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      canvasItems.create(session.id, { type: 'text', content: 'Item 1' });
      canvasItems.create(session.id, { type: 'text', content: 'Item 2' });

      const items = canvasItems.getBySessionId(session.id);
      expect(items.length).toBe(2);
    });
  });

  describe('delete', () => {
    it('deletes a canvas item', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const item = canvasItems.create(session.id, { type: 'text', content: 'Delete me' });
      canvasItems.delete(item.id);

      expect(canvasItems.getById(item.id)).toBeNull();
    });
  });
});

describe('SessionNoteRepository', () => {
  describe('class instantiation', () => {
    it('is a class that can be instantiated', () => {
      expect(SessionNoteRepository).toBeTypeOf('function');
      expect(sessionNotes).toBeInstanceOf(SessionNoteRepository);
    });

    it('has CRUD methods', () => {
      expect(sessionNotes.create).toBeTypeOf('function');
      expect(sessionNotes.getById).toBeTypeOf('function');
      expect(sessionNotes.getBySessionId).toBeTypeOf('function');
      expect(sessionNotes.update).toBeTypeOf('function');
      expect(sessionNotes.delete).toBeTypeOf('function');
    });
  });

  describe('create', () => {
    it('creates a note', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const note = sessionNotes.create(session.id, 'Important note');

      expect(note.id).toBeDefined();
      expect(note.sessionId).toBe(session.id);
      expect(note.content).toBe('Important note');
    });
  });

  describe('getBySessionId', () => {
    it('gets notes by session ID', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      sessionNotes.create(session.id, 'Note 1');
      sessionNotes.create(session.id, 'Note 2');

      const notes = sessionNotes.getBySessionId(session.id);
      expect(notes.length).toBe(2);
    });
  });

  describe('update', () => {
    it('updates a note', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const note = sessionNotes.create(session.id, 'Original');
      const updated = sessionNotes.update(note.id, 'Updated');

      expect(updated.content).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('deletes a note', () => {
      const project = projects.create('Test', '/tmp/test');
      const session = sessions.create(project.id, 'Test', 'Initial');

      const note = sessionNotes.create(session.id, 'Delete me');
      sessionNotes.delete(note.id);

      expect(sessionNotes.getById(note.id)).toBeNull();
    });
  });
});
