import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { projects, sessions, messages, attachments, conversations } from '../src/database.js';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getAttachmentsDir } from '../src/db/AttachmentRepository.js';

// Create a temp directory for testing disk file operations
let testTempDir;

// Mock only external services that have side effects
vi.mock('../src/websocket.js', () => ({
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

// Mock session manager to avoid starting actual Claude processes
vi.mock('../src/services/sessionManager.js', () => ({
  runSession: vi.fn().mockResolvedValue(undefined),
  continueSession: vi.fn().mockResolvedValue(undefined),
  stopSession: vi.fn().mockResolvedValue(undefined),
  restartSession: vi.fn(),
  cleanupActiveSession: vi.fn(),
}));

// Mock git setup - will be updated in beforeEach to use dynamic temp dir
vi.mock('../src/services/gitSessionSetup.js', () => ({
  setupGitForSession: vi.fn(),
}));

// Mock git service
vi.mock('../src/services/gitService.js', () => ({
  removeWorktree: vi.fn().mockResolvedValue(undefined),
}));

// Mock summary service
vi.mock('../src/services/summaryService.js', () => ({
  getSummary: vi.fn().mockResolvedValue(null),
  regenerateSummary: vi.fn().mockResolvedValue(null),
  cleanupSession: vi.fn(),
}));

// Mock hook service
vi.mock('../src/services/hookService.js', () => ({
  executeHookAsync: vi.fn(),
}));

// Import routers after mocking
import sessionsRouter from '../src/api/sessions.js';
import projectsRouter from '../src/api/projects.js';
import { runSession, continueSession } from '../src/services/sessionManager.js';
import { setupGitForSession } from '../src/services/gitSessionSetup.js';

describe('File Attachments API', () => {
  let app;
  let project;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a fresh temp directory for each test
    testTempDir = mkdtempSync(join(tmpdir(), 'file-attachments-test-'));

    // Update setupGitForSession mock to return the temp directory
    setupGitForSession.mockResolvedValue({
      workingDirectory: testTempDir,
      gitWorktree: null,
    });

    // Create test Express app
    app = express();
    app.use(express.json());
    app.use('/api/sessions', sessionsRouter);
    app.use('/api/projects', projectsRouter);

    // Create test project with temp directory
    project = projects.create('Test Project', testTempDir);
  });

  afterEach(() => {
    // Clean up temp directory
    if (testTempDir && existsSync(testTempDir)) {
      rmSync(testTempDir, { recursive: true, force: true });
    }
  });

  describe('POST /api/projects/:id/sessions - Session Creation with Files', () => {
    it('creates session with a text file attachment', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Analyze this file')
        .attach('files', Buffer.from('Hello, World!'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body.status).toBe('starting');

      // Verify attachment was stored in database
      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments).toHaveLength(1);
      expect(sessionAttachments[0].filename).toBe('test.txt');
      expect(sessionAttachments[0].mimeType).toBe('text/plain');
      expect(sessionAttachments[0].size).toBe(13);
    });

    it('creates session with multiple file attachments', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Analyze these files')
        .attach('files', Buffer.from('File 1 content'), {
          filename: 'file1.txt',
          contentType: 'text/plain',
        })
        .attach('files', Buffer.from('{"key": "value"}'), {
          filename: 'data.json',
          contentType: 'application/json',
        })
        .attach('files', Buffer.from('# Heading\n\nContent'), {
          filename: 'readme.md',
          contentType: 'text/markdown',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments).toHaveLength(3);

      const filenames = sessionAttachments.map((a) => a.filename);
      expect(filenames).toContain('file1.txt');
      expect(filenames).toContain('data.json');
      expect(filenames).toContain('readme.md');
    });

    it('creates session without attachments (regular JSON)', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .send({ prompt: 'No files' })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments).toHaveLength(0);
    });

    it('passes attachments to runSession', async () => {
      await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Analyze this')
        .attach('files', Buffer.from('test content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(201);

      // Verify runSession was called with attachments
      expect(runSession).toHaveBeenCalledWith(
        expect.any(String), // sessionId
        'Analyze this', // prompt
        testTempDir, // workingDirectory (dynamic)
        null, // systemPrompt
        expect.arrayContaining([
          expect.objectContaining({
            filename: 'test.txt',
            mimeType: 'text/plain',
          }),
        ]),
        null // model (passed per-message now, not from session)
      );
    });

    it('saves file to disk when creating session', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Analyze this')
        .attach('files', Buffer.from('Hello, World!'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments).toHaveLength(1);

      // Verify file path is set
      const attachment = sessionAttachments[0];
      expect(attachment.filePath).toBeDefined();
      expect(attachment.filePath).toContain('.attachments');
      expect(attachment.filePath).toContain(response.body.id);

      // Verify file actually exists on disk
      expect(existsSync(attachment.filePath)).toBe(true);
    });

    it('stores file content as base64', async () => {
      const content = 'Hello, World!';

      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Test base64')
        .attach('files', Buffer.from(content), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments[0].storageType).toBe('base64');
      expect(sessionAttachments[0].content).toBe(Buffer.from(content).toString('base64'));
    });

    it('handles JSON file correctly', async () => {
      const jsonContent = JSON.stringify({ name: 'test', value: 123 });

      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Parse JSON')
        .attach('files', Buffer.from(jsonContent), {
          filename: 'config.json',
          contentType: 'application/json',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments[0].filename).toBe('config.json');
      expect(sessionAttachments[0].mimeType).toBe('application/json');
    });

    it('handles JavaScript file correctly', async () => {
      const jsContent = 'function hello() { console.log("Hello"); }';

      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Review JS')
        .attach('files', Buffer.from(jsContent), {
          filename: 'script.js',
          contentType: 'application/javascript',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments[0].filename).toBe('script.js');
      expect(sessionAttachments[0].mimeType).toBe('application/javascript');
    });

    it('handles CSS file correctly', async () => {
      const cssContent = 'body { margin: 0; }';

      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Review CSS')
        .attach('files', Buffer.from(cssContent), {
          filename: 'styles.css',
          contentType: 'text/css',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments[0].filename).toBe('styles.css');
      expect(sessionAttachments[0].mimeType).toBe('text/css');
    });

    it('handles empty file', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Empty file')
        .attach('files', Buffer.from(''), {
          filename: 'empty.txt',
          contentType: 'text/plain',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments).toHaveLength(1);
      expect(sessionAttachments[0].filename).toBe('empty.txt');
      expect(sessionAttachments[0].size).toBe(0);
    });

    it('rejects request without prompt', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .attach('files', Buffer.from('content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      expect(response.body.error).toBe('Prompt is required');
    });

    it('returns 404 for non-existent project', async () => {
      const response = await request(app)
        .post('/api/projects/non-existent/sessions')
        .field('prompt', 'Test')
        .attach('files', Buffer.from('content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(404);

      expect(response.body.error).toBe('Project not found');
    });

    it('parses thinkingEnabled as string "true" from form-data', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Test thinking')
        .field('thinkingEnabled', 'true')
        .expect(201);

      expect(response.body.thinkingEnabled).toBe(true);
    });

    it('parses thinkingEnabled as boolean true from form-data', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Test thinking')
        .field('thinkingEnabled', true)
        .expect(201);

      expect(response.body.thinkingEnabled).toBe(true);
    });

    it('thinkingEnabled defaults to false when not provided', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Test default')
        .expect(201);

      expect(response.body.thinkingEnabled).toBe(false);
    });

    it('parses mode from form-data', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Test mode')
        .field('mode', 'yolo')
        .expect(201);

      expect(response.body.mode).toBe('yolo');
    });

    it('parses custom name from form-data', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Test name')
        .field('name', 'My Custom Session')
        .expect(201);

      expect(response.body.name).toBe('My Custom Session');
    });

    it('generates session name from prompt when not provided', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'This is a test prompt for name generation')
        .expect(201);

      expect(response.body.name).toBe('This is a test prompt for name generation');
    });

    it('truncates long prompts for session name', async () => {
      const longPrompt = 'A'.repeat(100);
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', longPrompt)
        .expect(201);

      expect(response.body.name.length).toBeLessThanOrEqual(53); // 50 + '...'
      expect(response.body.name).toContain('...');
    });

    it('parses gitBranch from form-data', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Test git branch')
        .field('gitBranch', 'feature/test-branch')
        .expect(201);

      expect(response.body.gitBranch).toBe('feature/test-branch');
    });

    it('handles form-data without files', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'No files in form-data')
        .field('mode', 'plan')
        .field('thinkingEnabled', 'true')
        .expect(201);

      expect(response.body.mode).toBe('plan');
      expect(response.body.thinkingEnabled).toBe(true);

      // Verify no attachments created
      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments).toHaveLength(0);
    });

    it('combines files with other form-data fields', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Full form-data test')
        .field('name', 'Complete Test')
        .field('mode', 'yolo')
        .field('thinkingEnabled', 'true')
        .attach('files', Buffer.from('config content'), {
          filename: 'config.json',
          contentType: 'application/json',
        })
        .expect(201);

      expect(response.body.name).toBe('Complete Test');
      expect(response.body.mode).toBe('yolo');
      expect(response.body.thinkingEnabled).toBe(true);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments).toHaveLength(1);
      expect(sessionAttachments[0].filename).toBe('config.json');
    });
  });

  describe('POST /api/sessions/:id/message - Follow-up with Files', () => {
    let session;

    beforeEach(() => {
      session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
      // Set session to waiting so it accepts messages
      sessions.update(session.id, { status: 'waiting' });
    });

    it('sends follow-up message with file attachment', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .field('content', 'Now analyze this file')
        .attach('files', Buffer.from('New file content'), {
          filename: 'followup.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify attachment was stored
      const sessionAttachments = attachments.getBySessionId(session.id);
      expect(sessionAttachments).toHaveLength(1);
      expect(sessionAttachments[0].filename).toBe('followup.txt');
    });

    it('passes attachments to continueSession', async () => {
      await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .field('content', 'Analyze this')
        .attach('files', Buffer.from('test content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      // Verify continueSession was called with attachments
      expect(continueSession).toHaveBeenCalledWith(
        session.id,
        'Analyze this',
        testTempDir, // Uses project workingDirectory since no gitWorktree
        null, // systemPrompt
        expect.arrayContaining([
          expect.objectContaining({
            filename: 'test.txt',
            mimeType: 'text/plain',
          }),
        ]),
        null // model (passed per-message now)
      );
    });

    it('saves file to disk when sending follow-up message', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .field('content', 'Analyze this file')
        .attach('files', Buffer.from('Follow-up content'), {
          filename: 'followup.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      const sessionAttachments = attachments.getBySessionId(session.id);
      expect(sessionAttachments).toHaveLength(1);

      // Verify file path is set and file exists
      const attachment = sessionAttachments[0];
      expect(attachment.filePath).toBeDefined();
      expect(existsSync(attachment.filePath)).toBe(true);
    });

    it('sends follow-up message without files', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .send({ content: 'Just text message' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('rejects message when session is running', async () => {
      sessions.update(session.id, { status: 'running' });

      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .field('content', 'Should fail')
        .attach('files', Buffer.from('content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      expect(response.body.error).toBe('Session is not waiting for input');
    });

    it('rejects message without content', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .attach('files', Buffer.from('content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(400);

      expect(response.body.error).toBe('Content is required');
    });

    it('returns 404 for non-existent session', async () => {
      const response = await request(app)
        .post('/api/sessions/non-existent/message')
        .field('content', 'Test')
        .attach('files', Buffer.from('content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(404);

      expect(response.body.error).toBe('Session not found');
    });

    it('accepts message when session is stopped', async () => {
      sessions.update(session.id, { status: 'stopped' });

      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .field('content', 'Message to stopped session')
        .attach('files', Buffer.from('content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('accepts message when session is in error state', async () => {
      sessions.update(session.id, { status: 'error' });

      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .field('content', 'Continuing from error')
        .attach('files', Buffer.from('content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('sends multiple files in a single message', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .field('content', 'Multiple files')
        .attach('files', Buffer.from('file 1'), {
          filename: 'first.txt',
          contentType: 'text/plain',
        })
        .attach('files', Buffer.from('file 2'), {
          filename: 'second.txt',
          contentType: 'text/plain',
        })
        .attach('files', Buffer.from('file 3'), {
          filename: 'third.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      const sessionAttachments = attachments.getBySessionId(session.id);
      expect(sessionAttachments).toHaveLength(3);
    });

    it('uses gitWorktree path when session has one', async () => {
      // Update session to have a gitWorktree
      sessions.update(session.id, { gitWorktree: '/tmp/worktree/session-123' });

      await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .field('content', 'Using worktree')
        .attach('files', Buffer.from('content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      // Verify continueSession was called with the worktree path
      expect(continueSession).toHaveBeenCalledWith(
        session.id,
        'Using worktree',
        '/tmp/worktree/session-123', // Should use gitWorktree, not project.workingDirectory
        null,
        expect.any(Array),
        null // model
      );
    });

    it('handles message with form-data but no files', async () => {
      const response = await request(app)
        .post(`/api/sessions/${session.id}/message`)
        .field('content', 'Form-data without files')
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify continueSession was called with empty attachments array
      expect(continueSession).toHaveBeenCalledWith(
        session.id,
        'Form-data without files',
        expect.any(String),
        null,
        [], // Empty attachments
        null // model
      );
    });
  });

  describe('GET /api/sessions/:id/messages - Messages with Attachments', () => {
    it('returns messages with attachment metadata', async () => {
      // sessions.create creates an initial user message with the prompt
      const session = sessions.create(project.id, 'Test Session', 'Test message with attachment', 'standard');
      const sessionMessages = messages.getBySessionId(session.id);
      const initialMessage = sessionMessages[0];

      attachments.create(session.id, initialMessage.id, {
        buffer: Buffer.from('file content'),
        originalname: 'attached.txt',
        mimetype: 'text/plain',
        size: 12,
      });

      const response = await request(app)
        .get(`/api/sessions/${session.id}/messages`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].attachments).toHaveLength(1);
      expect(response.body[0].attachments[0]).toMatchObject({
        filename: 'attached.txt',
        mimeType: 'text/plain',
        size: 12,
      });
    });

    it('does not include file content in listing (efficiency)', async () => {
      const session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
      const sessionMessages = messages.getBySessionId(session.id);
      const initialMessage = sessionMessages[0];

      attachments.create(session.id, initialMessage.id, {
        buffer: Buffer.from('file content'),
        originalname: 'attached.txt',
        mimetype: 'text/plain',
        size: 12,
      });

      const response = await request(app)
        .get(`/api/sessions/${session.id}/messages`)
        .expect(200);

      // Content should not be included for efficiency
      expect(response.body[0].attachments[0].content).toBeUndefined();
    });

    it('returns multiple attachments per message', async () => {
      const session = sessions.create(project.id, 'Test Session', 'Initial prompt', 'standard');
      const sessionMessages = messages.getBySessionId(session.id);
      const initialMessage = sessionMessages[0];

      // Create all attachments for the initial message
      attachments.create(session.id, initialMessage.id, {
        buffer: Buffer.from('first file'),
        originalname: 'first.txt',
        mimetype: 'text/plain',
        size: 10,
      });
      attachments.create(session.id, initialMessage.id, {
        buffer: Buffer.from('second file'),
        originalname: 'second.txt',
        mimetype: 'text/plain',
        size: 11,
      });
      attachments.create(session.id, initialMessage.id, {
        buffer: Buffer.from('{}'),
        originalname: 'data.json',
        mimetype: 'application/json',
        size: 2,
      });

      const response = await request(app)
        .get(`/api/sessions/${session.id}/messages`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].attachments).toHaveLength(3);
    });

    it('returns empty attachments for messages without files', async () => {
      // Session creation creates one user message in the initial conversation
      const session = sessions.create(project.id, 'Test Session', 'Initial prompt with file', 'standard');
      const activeConv = conversations.getActiveBySessionId(session.id);
      const sessionMessages = messages.getByConversationId(activeConv.id);
      const initialMessage = sessionMessages[0];

      // Add attachment to the initial message
      attachments.create(session.id, initialMessage.id, {
        buffer: Buffer.from('file content'),
        originalname: 'attached.txt',
        mimetype: 'text/plain',
        size: 12,
      });

      // Create an assistant message in the same conversation without attachment
      messages.create(session.id, 'assistant', 'Response without attachments', null, activeConv.id);

      const response = await request(app)
        .get(`/api/sessions/${session.id}/messages`)
        .expect(200);

      expect(response.body).toHaveLength(2);

      // Find each message by role and verify attachments
      const userMessage = response.body.find((m) => m.role === 'user');
      const assistantMessage = response.body.find((m) => m.role === 'assistant');

      expect(userMessage.attachments).toHaveLength(1);
      expect(assistantMessage.attachments).toHaveLength(0);
    });

    it('returns 404 for non-existent session', async () => {
      const response = await request(app).get('/api/sessions/non-existent/messages').expect(404);

      expect(response.body.error).toBe('Session not found');
    });
  });

  describe('File Type Validation', () => {
    it('accepts PNG image files', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Analyze image')
        .attach('files', Buffer.from('fake png data'), {
          filename: 'image.png',
          contentType: 'image/png',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments[0].mimeType).toBe('image/png');
    });

    it('accepts JPEG image files', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Analyze image')
        .attach('files', Buffer.from('fake jpeg data'), {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments[0].mimeType).toBe('image/jpeg');
    });

    it('accepts PDF files', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Analyze PDF')
        .attach('files', Buffer.from('fake pdf data'), {
          filename: 'document.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments[0].mimeType).toBe('application/pdf');
    });

    it('accepts YAML files', async () => {
      const yamlContent = 'name: test\nvalue: 123';

      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Analyze YAML')
        .attach('files', Buffer.from(yamlContent), {
          filename: 'config.yaml',
          contentType: 'application/x-yaml',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments[0].mimeType).toBe('application/x-yaml');
    });

    it('accepts shell script files', async () => {
      const shContent = '#!/bin/bash\necho "Hello"';

      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Review script')
        .attach('files', Buffer.from(shContent), {
          filename: 'script.sh',
          contentType: 'application/x-sh',
        })
        .expect(201);

      const sessionAttachments = attachments.getBySessionId(response.body.id);
      expect(sessionAttachments[0].mimeType).toBe('application/x-sh');
    });

    it('rejects disallowed file types', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Test')
        .attach('files', Buffer.from('fake exe'), {
          filename: 'malware.exe',
          contentType: 'application/x-msdownload',
        })
        .expect(400);

      expect(response.body.error).toContain('not allowed');
    });
  });

  describe('Attachment Cascade Delete', () => {
    it('deletes attachments when session is deleted', async () => {
      const session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      const message = messages.create(session.id, 'user', 'Test');

      attachments.create(session.id, message.id, {
        buffer: Buffer.from('content'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 7,
      });

      // Verify attachment exists
      expect(attachments.getBySessionId(session.id)).toHaveLength(1);

      // Delete session
      await request(app).delete(`/api/sessions/${session.id}`).expect(204);

      // Verify attachments are deleted
      expect(attachments.getBySessionId(session.id)).toHaveLength(0);
    });

    it('deletes attachments when message is deleted', async () => {
      const session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      const message = messages.create(session.id, 'user', 'Test');

      attachments.create(session.id, message.id, {
        buffer: Buffer.from('content'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 7,
      });

      // Verify attachment exists
      expect(attachments.getByMessageId(message.id)).toHaveLength(1);

      // Delete message directly in database (simulating cascade)
      messages.delete(message.id);

      // Verify attachments are deleted via cascade
      expect(attachments.getByMessageId(message.id)).toHaveLength(0);
    });
  });

  describe('Disk File Cleanup', () => {
    it('deletes attachment files from disk when session is deleted', async () => {
      // Create session with file attachment via API
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Test attachment')
        .attach('files', Buffer.from('test content'), {
          filename: 'test.txt',
          contentType: 'text/plain',
        })
        .expect(201);

      const sessionId = response.body.id;
      const sessionAttachments = attachments.getBySessionId(sessionId);
      expect(sessionAttachments).toHaveLength(1);

      const filePath = sessionAttachments[0].filePath;
      expect(filePath).toBeDefined();
      expect(existsSync(filePath)).toBe(true);

      // Get the attachments directory
      const attachmentsDir = getAttachmentsDir(testTempDir, sessionId);
      expect(existsSync(attachmentsDir)).toBe(true);

      // Delete the session
      await request(app).delete(`/api/sessions/${sessionId}`).expect(204);

      // Verify files are deleted from disk
      expect(existsSync(filePath)).toBe(false);
      expect(existsSync(attachmentsDir)).toBe(false);
    });

    it('deletes multiple files from disk when session is deleted', async () => {
      const response = await request(app)
        .post(`/api/projects/${project.id}/sessions`)
        .field('prompt', 'Multiple files')
        .attach('files', Buffer.from('file 1'), {
          filename: 'first.txt',
          contentType: 'text/plain',
        })
        .attach('files', Buffer.from('file 2'), {
          filename: 'second.txt',
          contentType: 'text/plain',
        })
        .expect(201);

      const sessionId = response.body.id;
      const sessionAttachments = attachments.getBySessionId(sessionId);
      expect(sessionAttachments).toHaveLength(2);

      // Verify both files exist
      for (const att of sessionAttachments) {
        expect(existsSync(att.filePath)).toBe(true);
      }

      // Delete the session
      await request(app).delete(`/api/sessions/${sessionId}`).expect(204);

      // Verify all files are deleted
      for (const att of sessionAttachments) {
        expect(existsSync(att.filePath)).toBe(false);
      }
    });

    it('handles session delete gracefully when files already removed', async () => {
      const session = sessions.create(project.id, 'Test Session', 'prompt', 'standard');
      const message = messages.create(session.id, 'user', 'Test');

      // Create attachment without workingDirectory (no disk file)
      attachments.create(session.id, message.id, {
        buffer: Buffer.from('content'),
        originalname: 'test.txt',
        mimetype: 'text/plain',
        size: 7,
      });

      // Delete session should not throw
      await request(app).delete(`/api/sessions/${session.id}`).expect(204);
    });
  });
});
