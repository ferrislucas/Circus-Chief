import { describe, it, expect, beforeEach } from 'vitest';
import { AttachmentRepository } from './AttachmentRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { MessageRepository } from './MessageRepository.js';
import { databaseManager } from './DatabaseManager.js';

describe('AttachmentRepository', () => {
  // Uses global setup from test/setup.js
  let repo;
  let projectRepo;
  let messageRepo;
  let sessionId;
  let messageId;

  beforeEach(() => {
    repo = new AttachmentRepository();
    projectRepo = new ProjectRepository();
    messageRepo = new MessageRepository();

    // Create a project and session for testing
    const project = projectRepo.create('Test Project', '/tmp/test');
    const now = Date.now();
    sessionId = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(sessionId, project.id, 'Test Session', 'running', 'standard', now, now);

    // Create a message for testing
    const message = messageRepo.create(sessionId, 'user', 'Test message');
    messageId = message.id;
  });

  describe('constructor', () => {
    it('creates repository instance', () => {
      expect(repo).toBeInstanceOf(AttachmentRepository);
      expect(repo.tableName).toBe('message_attachments');
    });
  });

  describe('create', () => {
    it('creates an attachment with file data', () => {
      const mockFile = {
        buffer: Buffer.from('Hello, World!'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 13,
      };

      const attachment = repo.create(sessionId, messageId, mockFile);

      expect(attachment.id).toBeDefined();
      expect(attachment.sessionId).toBe(sessionId);
      expect(attachment.messageId).toBe(messageId);
      expect(attachment.filename).toBe('test.txt');
      expect(attachment.mimeType).toBe('text/plain');
      expect(attachment.size).toBe(13);
      expect(attachment.storageType).toBe('base64');
      expect(attachment.content).toBe(Buffer.from('Hello, World!').toString('base64'));
      expect(attachment.createdAt).toBeTypeOf('number');
    });

    it('creates attachment without message ID', () => {
      const mockFile = {
        buffer: Buffer.from('test data'),
        originalname: 'image.png',
        mimetype: 'image/png',
        size: 9,
      };

      const attachment = repo.create(sessionId, null, mockFile);

      expect(attachment.messageId).toBeNull();
      expect(attachment.sessionId).toBe(sessionId);
    });
  });

  describe('createBatch', () => {
    it('creates multiple attachments at once', () => {
      const mockFiles = [
        {
          buffer: Buffer.from('file1'),
          originalname: 'file1.txt',
          mimetype: 'text/plain',
          size: 5,
        },
        {
          buffer: Buffer.from('file2'),
          originalname: 'file2.txt',
          mimetype: 'text/plain',
          size: 5,
        },
      ];

      const attachments = repo.createBatch(sessionId, messageId, mockFiles);

      expect(attachments).toHaveLength(2);
      expect(attachments[0].filename).toBe('file1.txt');
      expect(attachments[1].filename).toBe('file2.txt');
    });

    it('returns empty array for empty files list', () => {
      const attachments = repo.createBatch(sessionId, messageId, []);
      expect(attachments).toEqual([]);
    });

    it('returns empty array for null files', () => {
      const attachments = repo.createBatch(sessionId, messageId, null);
      expect(attachments).toEqual([]);
    });
  });

  describe('getByMessageId', () => {
    it('returns attachments for a message', () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 4,
      };

      repo.create(sessionId, messageId, mockFile);
      repo.create(sessionId, messageId, { ...mockFile, originalname: 'test2.txt' });

      const attachments = repo.getByMessageId(messageId);

      expect(attachments).toHaveLength(2);
      expect(attachments[0].messageId).toBe(messageId);
      expect(attachments[1].messageId).toBe(messageId);
    });

    it('returns empty array when no attachments exist', () => {
      const attachments = repo.getByMessageId(messageId);
      expect(attachments).toEqual([]);
    });

    it('returns attachments in chronological order', () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        originalname: 'first.txt',
        mimetype: 'text/plain',
        size: 4,
      };

      repo.create(sessionId, messageId, mockFile);
      repo.create(sessionId, messageId, { ...mockFile, originalname: 'second.txt' });

      const attachments = repo.getByMessageId(messageId);

      expect(attachments[0].filename).toBe('first.txt');
      expect(attachments[1].filename).toBe('second.txt');
    });
  });

  describe('getBySessionId', () => {
    it('returns all attachments for a session', () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 4,
      };

      // Create attachment with message
      repo.create(sessionId, messageId, mockFile);
      // Create attachment without message (pending)
      repo.create(sessionId, null, { ...mockFile, originalname: 'pending.txt' });

      const attachments = repo.getBySessionId(sessionId);

      expect(attachments).toHaveLength(2);
    });
  });

  describe('getByMessageIdWithoutContent', () => {
    it('returns attachments without content field for listing', () => {
      const mockFile = {
        buffer: Buffer.from('large content here'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 18,
      };

      repo.create(sessionId, messageId, mockFile);

      const attachments = repo.getByMessageIdWithoutContent(messageId);

      expect(attachments).toHaveLength(1);
      expect(attachments[0].filename).toBe('test.txt');
      expect(attachments[0].content).toBeUndefined();
    });
  });

  describe('updateMessageIdForSession', () => {
    it('associates pending attachments with a message', () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 4,
      };

      // Create pending attachments (no messageId)
      repo.create(sessionId, null, mockFile);
      repo.create(sessionId, null, { ...mockFile, originalname: 'test2.txt' });

      // Verify they have no messageId
      let pending = repo.getPendingBySessionId(sessionId);
      expect(pending).toHaveLength(2);

      // Associate them with a message
      repo.updateMessageIdForSession(sessionId, messageId);

      // Verify they are now associated
      pending = repo.getPendingBySessionId(sessionId);
      expect(pending).toHaveLength(0);

      const associated = repo.getByMessageId(messageId);
      expect(associated).toHaveLength(2);
    });
  });

  describe('getPendingBySessionId', () => {
    it('returns only attachments without a message ID', () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 4,
      };

      repo.create(sessionId, messageId, mockFile);  // Associated
      repo.create(sessionId, null, { ...mockFile, originalname: 'pending.txt' });  // Pending

      const pending = repo.getPendingBySessionId(sessionId);

      expect(pending).toHaveLength(1);
      expect(pending[0].filename).toBe('pending.txt');
      expect(pending[0].messageId).toBeNull();
    });
  });

  describe('cascade delete', () => {
    it('attachments are deleted when message is deleted', () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 4,
      };

      repo.create(sessionId, messageId, mockFile);
      expect(repo.getByMessageId(messageId)).toHaveLength(1);

      // Delete the message
      databaseManager.get().prepare('DELETE FROM conversation_messages WHERE id = ?').run(messageId);

      // Attachments should be deleted via cascade
      expect(repo.getByMessageId(messageId)).toHaveLength(0);
    });
  });
});
