import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AttachmentRepository, getAttachmentsDir, ATTACHMENTS_DIR } from './AttachmentRepository.js';
import { ProjectRepository } from './ProjectRepository.js';
import { MessageRepository } from './MessageRepository.js';
import { databaseManager } from './DatabaseManager.js';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('AttachmentRepository', () => {
  // Uses global setup from test/setup.js
  let repo;
  let projectRepo;
  let messageRepo;
  let sessionId;
  let messageId;
  let tempDir;

  beforeEach(() => {
    repo = new AttachmentRepository();
    projectRepo = new ProjectRepository();
    messageRepo = new MessageRepository();

    // Create a temp directory for disk file tests
    tempDir = mkdtempSync(join(tmpdir(), 'attachment-test-'));

    // Create a project and session for testing
    const project = projectRepo.create('Test Project', tempDir);
    const now = Date.now();
    sessionId = databaseManager.generateId();
    databaseManager.get().prepare(
      'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(sessionId, project.id, 'Test Session', 'running', 'standard', now, now);

    // Create a message for testing
    const message = messageRepo.create(sessionId, 'user', 'Test message');
    messageId = message.id;
  });

  afterEach(() => {
    // Clean up temp directory
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
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

  describe('getAttachmentsDir', () => {
    it('returns correct path for session attachments', () => {
      const result = getAttachmentsDir('/home/user/project', 'session-123');
      expect(result).toBe('/home/user/project/.attachments/session-123');
    });

    it('uses the ATTACHMENTS_DIR constant', () => {
      expect(ATTACHMENTS_DIR).toBe('.attachments');
    });
  });

  describe('disk file operations', () => {
    describe('create with workingDirectory', () => {
      it('saves file to disk when workingDirectory provided', () => {
        const mockFile = {
          buffer: Buffer.from('Hello, World!'),
          originalname: 'test.txt',
          mimetype: 'text/plain',
          size: 13,
        };

        const attachment = repo.create(sessionId, messageId, mockFile, tempDir);

        // Check filePath is set
        expect(attachment.filePath).toBeDefined();
        expect(attachment.filePath).toContain(tempDir);
        expect(attachment.filePath).toContain('.attachments');
        expect(attachment.filePath).toContain(sessionId);
        expect(attachment.filePath).toContain('test.txt');

        // Check file actually exists on disk
        expect(existsSync(attachment.filePath)).toBe(true);

        // Check file content matches
        const fileContent = readFileSync(attachment.filePath, 'utf-8');
        expect(fileContent).toBe('Hello, World!');
      });

      it('creates attachments directory if it does not exist', () => {
        const mockFile = {
          buffer: Buffer.from('test'),
          originalname: 'test.txt',
          mimetype: 'text/plain',
          size: 4,
        };

        const attachmentsDir = getAttachmentsDir(tempDir, sessionId);
        expect(existsSync(attachmentsDir)).toBe(false);

        repo.create(sessionId, messageId, mockFile, tempDir);

        expect(existsSync(attachmentsDir)).toBe(true);
      });

      it('handles binary files correctly', () => {
        const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
        const mockFile = {
          buffer: binaryData,
          originalname: 'image.png',
          mimetype: 'image/png',
          size: binaryData.length,
        };

        const attachment = repo.create(sessionId, messageId, mockFile, tempDir);

        expect(existsSync(attachment.filePath)).toBe(true);
        const savedContent = readFileSync(attachment.filePath);
        expect(savedContent).toEqual(binaryData);
      });

      it('does not save to disk when workingDirectory is null', () => {
        const mockFile = {
          buffer: Buffer.from('test'),
          originalname: 'test.txt',
          mimetype: 'text/plain',
          size: 4,
        };

        const attachment = repo.create(sessionId, messageId, mockFile, null);

        expect(attachment.filePath).toBeNull();
        // Should still have base64 content
        expect(attachment.content).toBe(Buffer.from('test').toString('base64'));
      });

      it('ensures unique filenames with ID prefix', () => {
        const mockFile = {
          buffer: Buffer.from('test'),
          originalname: 'duplicate.txt',
          mimetype: 'text/plain',
          size: 4,
        };

        const attachment1 = repo.create(sessionId, messageId, mockFile, tempDir);
        const attachment2 = repo.create(sessionId, messageId, mockFile, tempDir);

        // Both files should exist with different names (ID prefixed)
        expect(existsSync(attachment1.filePath)).toBe(true);
        expect(existsSync(attachment2.filePath)).toBe(true);
        expect(attachment1.filePath).not.toBe(attachment2.filePath);
        expect(attachment1.filePath).toContain(attachment1.id);
        expect(attachment2.filePath).toContain(attachment2.id);
      });
    });

    describe('createBatch with workingDirectory', () => {
      it('saves multiple files to disk', () => {
        const mockFiles = [
          {
            buffer: Buffer.from('file1 content'),
            originalname: 'file1.txt',
            mimetype: 'text/plain',
            size: 13,
          },
          {
            buffer: Buffer.from('file2 content'),
            originalname: 'file2.txt',
            mimetype: 'text/plain',
            size: 13,
          },
        ];

        const attachments = repo.createBatch(sessionId, messageId, mockFiles, tempDir);

        expect(attachments).toHaveLength(2);
        expect(existsSync(attachments[0].filePath)).toBe(true);
        expect(existsSync(attachments[1].filePath)).toBe(true);

        expect(readFileSync(attachments[0].filePath, 'utf-8')).toBe('file1 content');
        expect(readFileSync(attachments[1].filePath, 'utf-8')).toBe('file2 content');
      });
    });

    describe('deleteSessionAttachmentsFromDisk', () => {
      it('removes session attachments directory', () => {
        const mockFile = {
          buffer: Buffer.from('test'),
          originalname: 'test.txt',
          mimetype: 'text/plain',
          size: 4,
        };

        const attachment = repo.create(sessionId, messageId, mockFile, tempDir);
        const attachmentsDir = getAttachmentsDir(tempDir, sessionId);

        expect(existsSync(attachmentsDir)).toBe(true);
        expect(existsSync(attachment.filePath)).toBe(true);

        repo.deleteSessionAttachmentsFromDisk(tempDir, sessionId);

        expect(existsSync(attachmentsDir)).toBe(false);
        expect(existsSync(attachment.filePath)).toBe(false);
      });

      it('handles non-existent directory gracefully', () => {
        // Should not throw
        expect(() => {
          repo.deleteSessionAttachmentsFromDisk(tempDir, 'non-existent-session');
        }).not.toThrow();
      });

      it('handles null workingDirectory gracefully', () => {
        expect(() => {
          repo.deleteSessionAttachmentsFromDisk(null, sessionId);
        }).not.toThrow();
      });

      it('removes all files for a session', () => {
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

        const attachments = repo.createBatch(sessionId, messageId, mockFiles, tempDir);
        const attachmentsDir = getAttachmentsDir(tempDir, sessionId);

        expect(existsSync(attachments[0].filePath)).toBe(true);
        expect(existsSync(attachments[1].filePath)).toBe(true);

        repo.deleteSessionAttachmentsFromDisk(tempDir, sessionId);

        expect(existsSync(attachmentsDir)).toBe(false);
      });
    });

    describe('getByMessageIdWithoutContent includes filePath', () => {
      it('includes filePath in returned attachments', () => {
        const mockFile = {
          buffer: Buffer.from('test'),
          originalname: 'test.txt',
          mimetype: 'text/plain',
          size: 4,
        };

        repo.create(sessionId, messageId, mockFile, tempDir);

        const attachments = repo.getByMessageIdWithoutContent(messageId);

        expect(attachments).toHaveLength(1);
        expect(attachments[0].filePath).toBeDefined();
        expect(attachments[0].filePath).toContain('.attachments');
        expect(attachments[0].content).toBeUndefined();
      });
    });
  });
});
