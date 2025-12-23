import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPermissionModeForSession,
  buildSystemPromptConfig,
  buildPromptWithAttachments,
  getSessionAttachmentsContext,
  PLAN_MODE_PROMPT,
  continueSession,
} from './sessionManager.js';
import { databaseManager } from '../db/DatabaseManager.js';
import { AttachmentRepository } from '../db/AttachmentRepository.js';
import { ProjectRepository } from '../db/ProjectRepository.js';
import { SessionRepository } from '../db/SessionRepository.js';
import { MessageRepository } from '../db/MessageRepository.js';
import { ConversationRepository } from '../db/ConversationRepository.js';
import { mkdtempSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('sessionManager', () => {
  describe('buildPromptWithAttachments', () => {
    it('returns original prompt when no attachments', () => {
      const prompt = 'Hello world';
      expect(buildPromptWithAttachments(prompt, [])).toBe(prompt);
      expect(buildPromptWithAttachments(prompt, null)).toBe(prompt);
      expect(buildPromptWithAttachments(prompt, undefined)).toBe(prompt);
    });

    it('includes text file content inline', () => {
      const prompt = 'Analyze this file';
      const attachments = [
        {
          filename: 'test.txt',
          mimeType: 'text/plain',
          content: Buffer.from('Hello, World!').toString('base64'),
          size: 13,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      expect(result).toContain('Analyze this file');
      expect(result).toContain('## Attached Files');
      expect(result).toContain('--- File: test.txt (text/plain) ---');
      expect(result).toContain('Hello, World!');
      expect(result).toContain('--- End of test.txt ---');
    });

    it('includes JSON file content inline', () => {
      const prompt = 'Parse this JSON';
      const jsonContent = JSON.stringify({ key: 'value' });
      const attachments = [
        {
          filename: 'config.json',
          mimeType: 'application/json',
          content: Buffer.from(jsonContent).toString('base64'),
          size: jsonContent.length,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      expect(result).toContain('--- File: config.json (application/json) ---');
      expect(result).toContain('{"key":"value"}');
    });

    it('includes JavaScript file content inline', () => {
      const prompt = 'Review this code';
      const jsContent = 'function hello() { return "world"; }';
      const attachments = [
        {
          filename: 'script.js',
          mimeType: 'application/javascript',
          content: Buffer.from(jsContent).toString('base64'),
          size: jsContent.length,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      expect(result).toContain('--- File: script.js (application/javascript) ---');
      expect(result).toContain('function hello()');
    });

    it('includes YAML file content inline', () => {
      const prompt = 'Check this config';
      const yamlContent = 'name: test\nvalue: 123';
      const attachments = [
        {
          filename: 'config.yaml',
          mimeType: 'application/x-yaml',
          content: Buffer.from(yamlContent).toString('base64'),
          size: yamlContent.length,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      expect(result).toContain('--- File: config.yaml (application/x-yaml) ---');
      expect(result).toContain('name: test');
    });

    it('includes shell script content inline', () => {
      const prompt = 'Review this script';
      const shContent = '#!/bin/bash\necho "Hello"';
      const attachments = [
        {
          filename: 'script.sh',
          mimeType: 'application/x-sh',
          content: Buffer.from(shContent).toString('base64'),
          size: shContent.length,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      expect(result).toContain('--- File: script.sh (application/x-sh) ---');
      expect(result).toContain('#!/bin/bash');
    });

    it('describes image files without content', () => {
      const prompt = 'Analyze this image';
      const attachments = [
        {
          filename: 'photo.png',
          mimeType: 'image/png',
          content: 'base64imagedata',
          size: 1024,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      expect(result).toContain('[Attached image: photo.png (image/png, 1024 bytes)]');
      expect(result).not.toContain('base64imagedata');
    });

    it('describes PDF files without content', () => {
      const prompt = 'Read this PDF';
      const attachments = [
        {
          filename: 'document.pdf',
          mimeType: 'application/pdf',
          content: 'base64pdfdata',
          size: 2048,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      expect(result).toContain('[Attached PDF: document.pdf (2048 bytes)]');
      expect(result).not.toContain('base64pdfdata');
    });

    it('describes unknown file types without content', () => {
      const prompt = 'Process this file';
      const attachments = [
        {
          filename: 'data.bin',
          mimeType: 'application/octet-stream',
          content: 'base64binarydata',
          size: 512,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      expect(result).toContain('[Attached file: data.bin (application/octet-stream, 512 bytes)]');
      expect(result).not.toContain('base64binarydata');
    });

    it('handles multiple attachments', () => {
      const prompt = 'Analyze all files';
      const attachments = [
        {
          filename: 'readme.txt',
          mimeType: 'text/plain',
          content: Buffer.from('README content').toString('base64'),
          size: 14,
        },
        {
          filename: 'photo.jpg',
          mimeType: 'image/jpeg',
          content: 'imagedata',
          size: 500,
        },
        {
          filename: 'config.json',
          mimeType: 'application/json',
          content: Buffer.from('{"a":1}').toString('base64'),
          size: 7,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      expect(result).toContain('--- File: readme.txt');
      expect(result).toContain('README content');
      expect(result).toContain('[Attached image: photo.jpg');
      expect(result).toContain('--- File: config.json');
      expect(result).toContain('{"a":1}');
    });

    it('handles text file with missing content', () => {
      const prompt = 'Analyze';
      const attachments = [
        {
          filename: 'empty.txt',
          mimeType: 'text/plain',
          content: null,
          size: 0,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      // Without content, it falls through to the generic attachment description
      expect(result).toContain('[Attached file: empty.txt');
    });

    it('handles invalid base64 content gracefully', () => {
      const prompt = 'Analyze';
      const attachments = [
        {
          filename: 'corrupt.txt',
          mimeType: 'text/plain',
          content: '!!!invalid-base64!!!',
          size: 100,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      // Should decode whatever it can (invalid base64 will decode to something)
      expect(result).toContain('Analyze');
      expect(result).toContain('## Attached Files');
    });

    it('includes XML file content inline', () => {
      const prompt = 'Parse this XML';
      const xmlContent = '<root><item>test</item></root>';
      const attachments = [
        {
          filename: 'data.xml',
          mimeType: 'application/xml',
          content: Buffer.from(xmlContent).toString('base64'),
          size: xmlContent.length,
        },
      ];

      const result = buildPromptWithAttachments(prompt, attachments);

      expect(result).toContain('--- File: data.xml (application/xml) ---');
      expect(result).toContain('<root><item>test</item></root>');
    });
  });

  describe('getPermissionModeForSession', () => {
    it('returns "bypassPermissions" for yolo mode', () => {
      expect(getPermissionModeForSession('yolo')).toBe('bypassPermissions');
    });

    it('returns "default" for plan mode', () => {
      expect(getPermissionModeForSession('plan')).toBe('default');
    });

    it('returns "default" for standard mode', () => {
      expect(getPermissionModeForSession('standard')).toBe('default');
    });

    it('returns "default" for undefined mode', () => {
      expect(getPermissionModeForSession(undefined)).toBe('default');
    });

    it('returns "default" for null mode', () => {
      expect(getPermissionModeForSession(null)).toBe('default');
    });

    it('returns "default" for unknown mode', () => {
      expect(getPermissionModeForSession('unknown')).toBe('default');
    });
  });

  describe('PLAN_MODE_PROMPT', () => {
    it('contains plan mode instructions', () => {
      expect(PLAN_MODE_PROMPT).toContain('Plan Mode Active');
      expect(PLAN_MODE_PROMPT).toContain('Analyze the Request');
      expect(PLAN_MODE_PROMPT).toContain('Create a Plan');
      expect(PLAN_MODE_PROMPT).toContain('Get Approval');
      expect(PLAN_MODE_PROMPT).toContain('Do NOT start coding');
    });
  });

  describe('buildSystemPromptConfig', () => {
    const sessionId = 'test-session-123';
    const projectId = 'test-project-456';

    it('includes plan mode prompt when mode is plan', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'plan');

      expect(result).toContain('Plan Mode Active');
      expect(result).toContain('Do NOT start coding');
    });

    it('does not include plan mode prompt for standard mode', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');

      expect(result).not.toContain('Plan Mode Active');
      expect(result).not.toContain('Do NOT start coding');
    });

    it('does not include plan mode prompt for yolo mode', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'yolo');

      expect(result).not.toContain('Plan Mode Active');
      expect(result).not.toContain('Do NOT start coding');
    });

    it('includes canvas instructions for all modes', () => {
      const planResult = buildSystemPromptConfig(sessionId, projectId, null, 'plan');
      const standardResult = buildSystemPromptConfig(sessionId, projectId, null, 'standard');
      const yoloResult = buildSystemPromptConfig(sessionId, projectId, null, 'yolo');

      expect(planResult).toContain('/api/sessions/');
      expect(planResult).toContain('/canvas');
      expect(standardResult).toContain('/api/sessions/');
      expect(standardResult).toContain('/canvas');
      expect(yoloResult).toContain('/api/sessions/');
      expect(yoloResult).toContain('/canvas');
    });

    it('includes session API instructions for all modes', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');

      expect(result).toContain('Session Management API');
      expect(result).toContain(sessionId);
      expect(result).toContain(projectId);
    });

    it('uses custom system prompt when provided', () => {
      const customPrompt = 'Custom system prompt for testing';
      const result = buildSystemPromptConfig(sessionId, projectId, customPrompt, 'standard');

      expect(result).toContain(customPrompt);
    });

    it('plan mode prompt is prepended to the system prompt', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'plan');

      // Plan mode prompt should come first
      const planModeIndex = result.indexOf('Plan Mode Active');
      const canvasIndex = result.indexOf('canvas');

      expect(planModeIndex).toBeLessThan(canvasIndex);
    });
  });

  describe('getSessionAttachmentsContext', () => {
    // Uses global setup from test/setup.js for database
    let attachmentRepo;
    let projectRepo;
    let sessionId;
    let tempDir;

    beforeEach(() => {
      attachmentRepo = new AttachmentRepository();
      projectRepo = new ProjectRepository();

      // Create temp directory for disk files
      tempDir = mkdtempSync(join(tmpdir(), 'session-manager-test-'));

      // Create a project and session for testing
      const project = projectRepo.create('Test Project', tempDir);
      const now = Date.now();
      sessionId = databaseManager.generateId();
      databaseManager
        .get()
        .prepare(
          'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(sessionId, project.id, 'Test Session', 'running', 'standard', now, now);
    });

    afterEach(() => {
      // Clean up temp directory
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('returns empty string when no attachments', () => {
      const result = getSessionAttachmentsContext(sessionId);
      expect(result).toBe('');
    });

    it('returns empty string when attachments have no file paths', () => {
      // Create attachment without workingDirectory (no file path)
      const mockFile = {
        buffer: Buffer.from('test content'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 12,
      };
      attachmentRepo.create(sessionId, null, mockFile); // No working directory

      const result = getSessionAttachmentsContext(sessionId);
      expect(result).toBe('');
    });

    it('includes attachments with file paths in context', () => {
      const mockFile = {
        buffer: Buffer.from('test content'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 12,
      };
      attachmentRepo.create(sessionId, null, mockFile, tempDir);

      const result = getSessionAttachmentsContext(sessionId);

      expect(result).toContain('Session Attached Files');
      expect(result).toContain('test.txt');
      expect(result).toContain('text/plain');
      expect(result).toContain('.attachments');
      expect(result).toContain('Read tool');
    });

    it('formats file size correctly', () => {
      // Test various file sizes
      const smallFile = {
        buffer: Buffer.from('a'),
        originalname: 'small.txt',
        mimetype: 'text/plain',
        size: 500,
      };
      attachmentRepo.create(sessionId, null, smallFile, tempDir);

      const result = getSessionAttachmentsContext(sessionId);
      expect(result).toContain('500 B');
    });

    it('formats KB size correctly', () => {
      const kbFile = {
        buffer: Buffer.from('test'),
        originalname: 'medium.txt',
        mimetype: 'text/plain',
        size: 2048,
      };
      attachmentRepo.create(sessionId, null, kbFile, tempDir);

      const result = getSessionAttachmentsContext(sessionId);
      expect(result).toContain('2.0 KB');
    });

    it('includes multiple attachments in context', () => {
      const mockFiles = [
        {
          buffer: Buffer.from('file1'),
          originalname: 'file1.txt',
          mimetype: 'text/plain',
          size: 5,
        },
        {
          buffer: Buffer.from('file2'),
          originalname: 'file2.json',
          mimetype: 'application/json',
          size: 5,
        },
      ];
      attachmentRepo.createBatch(sessionId, null, mockFiles, tempDir);

      const result = getSessionAttachmentsContext(sessionId);

      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.json');
      expect(result).toContain('text/plain');
      expect(result).toContain('application/json');
    });

    it('includes instructions for using Read tool', () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 4,
      };
      attachmentRepo.create(sessionId, null, mockFile, tempDir);

      const result = getSessionAttachmentsContext(sessionId);

      expect(result).toContain('Read tool');
      expect(result).toContain('persist throughout the conversation');
    });
  });

  describe('buildSystemPromptConfig with attachments', () => {
    let attachmentRepo;
    let projectRepo;
    let sessionId;
    let projectId;
    let tempDir;

    beforeEach(() => {
      attachmentRepo = new AttachmentRepository();
      projectRepo = new ProjectRepository();

      tempDir = mkdtempSync(join(tmpdir(), 'session-manager-test-'));
      const project = projectRepo.create('Test Project', tempDir);
      projectId = project.id;

      const now = Date.now();
      sessionId = databaseManager.generateId();
      databaseManager
        .get()
        .prepare(
          'INSERT INTO sessions (id, project_id, name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
        .run(sessionId, project.id, 'Test Session', 'running', 'standard', now, now);
    });

    afterEach(() => {
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('includes attachment context when session has attachments', () => {
      const mockFile = {
        buffer: Buffer.from('config content'),
        originalname: 'config.json',
        mimetype: 'application/json',
        size: 14,
      };
      attachmentRepo.create(sessionId, null, mockFile, tempDir);

      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');

      expect(result).toContain('Session Attached Files');
      expect(result).toContain('config.json');
      expect(result).toContain('application/json');
    });

    it('does not include attachment section when no attachments', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');

      expect(result).not.toContain('Session Attached Files');
    });

    it('includes attachments in plan mode', () => {
      const mockFile = {
        buffer: Buffer.from('test'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 4,
      };
      attachmentRepo.create(sessionId, null, mockFile, tempDir);

      const result = buildSystemPromptConfig(sessionId, projectId, null, 'plan');

      expect(result).toContain('Plan Mode Active');
      expect(result).toContain('Session Attached Files');
      expect(result).toContain('test.txt');
    });
  });

  describe('continueSession conversation ID handling', () => {
    let sessionRepo;
    let messageRepo;
    let conversationRepo;
    let projectRepo;
    let session;
    let tempDir;

    beforeEach(() => {
      // Enable mock mode to avoid calling the real Claude API
      process.env.MOCK_CLAUDE = 'true';

      sessionRepo = new SessionRepository();
      messageRepo = new MessageRepository();
      conversationRepo = new ConversationRepository();
      projectRepo = new ProjectRepository();

      tempDir = mkdtempSync(join(tmpdir(), 'session-manager-conv-test-'));
      const project = projectRepo.create('Test Project', tempDir);

      // Create a session with a Claude session ID (required for continueSession)
      session = sessionRepo.create(project.id, 'Test Session', 'Test prompt', 'standard');
      sessionRepo.update(session.id, { claudeSessionId: 'mock-claude-session-id' });
    });

    afterEach(() => {
      delete process.env.MOCK_CLAUDE;
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('creates user message with conversation ID when sending follow-up message', async () => {
      // Create an active conversation for the session
      const conversation = conversationRepo.create(session.id, 'Test Conversation');

      // Send a follow-up message
      await continueSession(session.id, 'Follow-up message', tempDir);

      // Get messages for this conversation
      const conversationMessages = messageRepo.getByConversationId(conversation.id);

      // Should have the user message with correct conversation ID
      const userMessages = conversationMessages.filter((m) => m.role === 'user');
      expect(userMessages.length).toBeGreaterThanOrEqual(1);
      expect(userMessages.some((m) => m.content === 'Follow-up message')).toBe(true);
    });

    it('creates assistant message with conversation ID', async () => {
      // Create an active conversation for the session
      const conversation = conversationRepo.create(session.id, 'Test Conversation');

      // Send a message which will trigger mock assistant response
      await continueSession(session.id, 'Hello', tempDir);

      // Get messages for this conversation
      const conversationMessages = messageRepo.getByConversationId(conversation.id);

      // Should have the assistant message with correct conversation ID
      const assistantMessages = conversationMessages.filter((m) => m.role === 'assistant');
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
    });

    it('ensures active conversation exists when none is present', async () => {
      // Don't create a conversation - ensureActiveConversation should create one

      // Send a follow-up message
      await continueSession(session.id, 'Message without conversation', tempDir);

      // Should have created a conversation
      const activeConversation = conversationRepo.getActiveBySessionId(session.id);
      expect(activeConversation).not.toBeNull();

      // Message should be associated with the created conversation
      const conversationMessages = messageRepo.getByConversationId(activeConversation.id);
      const userMessages = conversationMessages.filter((m) => m.role === 'user');
      expect(userMessages.some((m) => m.content === 'Message without conversation')).toBe(true);
    });

    it('uses the active conversation when multiple conversations exist', async () => {
      // Create two conversations, the second one will be active
      const conv1 = conversationRepo.create(session.id, 'Conversation 1');
      const conv2 = conversationRepo.create(session.id, 'Conversation 2');

      // Verify conv2 is active (the most recently created one)
      const activeConv = conversationRepo.getActiveBySessionId(session.id);
      expect(activeConv.id).toBe(conv2.id);

      // Send a message
      await continueSession(session.id, 'Message to active conversation', tempDir);

      // Message should be in conv2, not conv1
      const conv1Messages = messageRepo.getByConversationId(conv1.id);
      const conv2Messages = messageRepo.getByConversationId(conv2.id);

      expect(conv1Messages.filter((m) => m.content === 'Message to active conversation').length).toBe(0);
      expect(conv2Messages.filter((m) => m.content === 'Message to active conversation').length).toBe(1);
    });

    it('messages are retrievable by conversation ID after session continues', async () => {
      // Create a conversation
      const conversation = conversationRepo.create(session.id, 'Test Conversation');

      // Send multiple messages
      await continueSession(session.id, 'First message', tempDir);

      // Refresh session to get new claudeSessionId from mock
      const updatedSession = sessionRepo.getById(session.id);
      sessionRepo.update(session.id, { claudeSessionId: updatedSession.claudeSessionId || 'mock-session-2' });

      await continueSession(session.id, 'Second message', tempDir);

      // All messages should be retrievable by conversation ID
      const messages = messageRepo.getByConversationId(conversation.id);

      expect(messages.filter((m) => m.content === 'First message').length).toBe(1);
      expect(messages.filter((m) => m.content === 'Second message').length).toBe(1);

      // Both user and assistant messages should be present
      expect(messages.filter((m) => m.role === 'user').length).toBeGreaterThanOrEqual(2);
      expect(messages.filter((m) => m.role === 'assistant').length).toBeGreaterThanOrEqual(2);
    });
  });
});
