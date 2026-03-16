import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../database.js', () => ({
  sessions: {
    getById: vi.fn(),
  },
  attachments: {
    getBySessionId: vi.fn(),
  },
  projects: {
    getById: vi.fn(),
  },
  kanbanBoards: {
    getByProjectId: vi.fn(),
  },
  kanbanLanes: {
    getByBoardId: vi.fn(),
  },
}));

import { sessions, attachments, projects, kanbanBoards, kanbanLanes } from '../database.js';
import {
  getApiBaseUrl,
  buildPromptWithAttachments,
  getSessionAttachmentsContext,
  getPermissionModeForSession,
  PLAN_MODE_PROMPT,
  buildSystemPromptConfig,
} from './sessionPrompts.js';
import { DEFAULT_SERVER_PORT, DEFAULT_SYSTEM_PROMPT } from '@claudetools/shared';

describe('sessionPrompts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: sessions.getById returns null (no worktree)
    sessions.getById.mockReturnValue(null);
    // Default mock: no attachments
    attachments.getBySessionId.mockReturnValue([]);
    // Default mock: project without kanban enabled
    projects.getById.mockReturnValue(null);
    kanbanBoards.getByProjectId.mockReturnValue(null);
    kanbanLanes.getByBoardId.mockReturnValue([]);
  });

  afterEach(() => {
    // Restore env vars we may have set
    delete process.env.CLAUDETOOLS_API_URL;
    delete process.env.PORT;
  });

  // ── getApiBaseUrl ─────────────────────────────────────────────────────

  describe('getApiBaseUrl', () => {
    it('returns CLAUDETOOLS_API_URL when set', () => {
      process.env.CLAUDETOOLS_API_URL = 'https://custom.example.com';
      expect(getApiBaseUrl()).toBe('https://custom.example.com');
    });

    it('uses PORT env var when CLAUDETOOLS_API_URL is not set', () => {
      delete process.env.CLAUDETOOLS_API_URL;
      process.env.PORT = '3456';
      expect(getApiBaseUrl()).toBe('http://localhost:3456');
    });

    it('falls back to DEFAULT_SERVER_PORT when neither env var is set', () => {
      delete process.env.CLAUDETOOLS_API_URL;
      delete process.env.PORT;
      expect(getApiBaseUrl()).toBe(`http://localhost:${DEFAULT_SERVER_PORT}`);
    });

    it('CLAUDETOOLS_API_URL takes precedence over PORT', () => {
      process.env.CLAUDETOOLS_API_URL = 'https://override.example.com';
      process.env.PORT = '9999';
      expect(getApiBaseUrl()).toBe('https://override.example.com');
    });
  });

  // ── buildPromptWithAttachments ────────────────────────────────────────

  describe('buildPromptWithAttachments', () => {
    it('returns original prompt when no attachments', () => {
      expect(buildPromptWithAttachments('hello', [])).toBe('hello');
      expect(buildPromptWithAttachments('hello', null)).toBe('hello');
      expect(buildPromptWithAttachments('hello', undefined)).toBe('hello');
    });

    it('handles text file with valid base64 content', () => {
      const att = {
        filename: 'readme.md',
        mimeType: 'text/markdown',
        content: Buffer.from('# Hello').toString('base64'),
        size: 7,
      };
      const result = buildPromptWithAttachments('Look at this', [att]);
      expect(result).toContain('## Attached Files');
      expect(result).toContain('--- File: readme.md (text/markdown) ---');
      expect(result).toContain('# Hello');
      expect(result).toContain('--- End of readme.md ---');
    });

    it('describes image files', () => {
      const att = { filename: 'pic.png', mimeType: 'image/png', content: 'abc', size: 1024 };
      const result = buildPromptWithAttachments('check', [att]);
      expect(result).toContain('[Attached image: pic.png (image/png, 1024 bytes)]');
    });

    it('describes PDF files', () => {
      const att = { filename: 'doc.pdf', mimeType: 'application/pdf', content: 'abc', size: 2048 };
      const result = buildPromptWithAttachments('read', [att]);
      expect(result).toContain('[Attached PDF: doc.pdf (2048 bytes)]');
    });

    it('describes unknown binary files', () => {
      const att = { filename: 'data.bin', mimeType: 'application/octet-stream', content: 'abc', size: 512 };
      const result = buildPromptWithAttachments('analyze', [att]);
      expect(result).toContain('[Attached file: data.bin (application/octet-stream, 512 bytes)]');
    });

    it('falls through to generic description when text file has no content', () => {
      const att = { filename: 'empty.txt', mimeType: 'text/plain', content: null, size: 0 };
      const result = buildPromptWithAttachments('check', [att]);
      expect(result).toContain('[Attached file: empty.txt');
    });

    it('handles multiple attachments', () => {
      const atts = [
        { filename: 'a.txt', mimeType: 'text/plain', content: Buffer.from('aaa').toString('base64'), size: 3 },
        { filename: 'b.png', mimeType: 'image/png', content: 'img', size: 100 },
      ];
      const result = buildPromptWithAttachments('multi', atts);
      expect(result).toContain('--- File: a.txt');
      expect(result).toContain('[Attached image: b.png');
    });
  });

  // ── getSessionAttachmentsContext ──────────────────────────────────────

  describe('getSessionAttachmentsContext', () => {
    it('returns empty string when no attachments', () => {
      attachments.getBySessionId.mockReturnValue([]);
      expect(getSessionAttachmentsContext('sess-1')).toBe('');
    });

    it('returns empty string when attachments have no filePath', () => {
      attachments.getBySessionId.mockReturnValue([
        { filename: 'test.txt', mimeType: 'text/plain', size: 5, filePath: null },
      ]);
      expect(getSessionAttachmentsContext('sess-1')).toBe('');
    });

    it('includes attachments with filePath', () => {
      attachments.getBySessionId.mockReturnValue([
        { filename: 'data.json', mimeType: 'application/json', size: 256, filePath: '/tmp/data.json' },
      ]);
      const result = getSessionAttachmentsContext('sess-1');
      expect(result).toContain('Session Attached Files');
      expect(result).toContain('/tmp/data.json');
      expect(result).toContain('data.json');
      expect(result).toContain('application/json');
      expect(result).toContain('256 B');
      expect(result).toContain('Read tool');
    });

    it('formats KB sizes', () => {
      attachments.getBySessionId.mockReturnValue([
        { filename: 'med.txt', mimeType: 'text/plain', size: 2048, filePath: '/tmp/med.txt' },
      ]);
      const result = getSessionAttachmentsContext('sess-1');
      expect(result).toContain('2.0 KB');
    });

    it('formats MB sizes', () => {
      attachments.getBySessionId.mockReturnValue([
        { filename: 'big.bin', mimeType: 'application/octet-stream', size: 2 * 1024 * 1024, filePath: '/tmp/big.bin' },
      ]);
      const result = getSessionAttachmentsContext('sess-1');
      expect(result).toContain('2.0 MB');
    });

    it('includes multiple attachments', () => {
      attachments.getBySessionId.mockReturnValue([
        { filename: 'a.txt', mimeType: 'text/plain', size: 10, filePath: '/tmp/a.txt' },
        { filename: 'b.json', mimeType: 'application/json', size: 20, filePath: '/tmp/b.json' },
      ]);
      const result = getSessionAttachmentsContext('sess-1');
      expect(result).toContain('a.txt');
      expect(result).toContain('b.json');
    });
  });

  // ── getPermissionModeForSession ───────────────────────────────────────

  describe('getPermissionModeForSession', () => {
    it('returns bypassPermissions for yolo', () => {
      expect(getPermissionModeForSession('yolo')).toBe('bypassPermissions');
    });

    it('returns default for plan', () => {
      expect(getPermissionModeForSession('plan')).toBe('default');
    });

    it('returns default for standard', () => {
      expect(getPermissionModeForSession('standard')).toBe('default');
    });

    it('returns default for undefined', () => {
      expect(getPermissionModeForSession(undefined)).toBe('default');
    });

    it('returns default for null', () => {
      expect(getPermissionModeForSession(null)).toBe('default');
    });

    it('returns default for unknown string', () => {
      expect(getPermissionModeForSession('anything-else')).toBe('default');
    });
  });

  // ── PLAN_MODE_PROMPT ──────────────────────────────────────────────────

  describe('PLAN_MODE_PROMPT', () => {
    it('is a non-empty string', () => {
      expect(typeof PLAN_MODE_PROMPT).toBe('string');
      expect(PLAN_MODE_PROMPT.length).toBeGreaterThan(0);
    });

    it('contains key plan-mode instructions', () => {
      expect(PLAN_MODE_PROMPT).toContain('Plan Mode Active');
      expect(PLAN_MODE_PROMPT).toContain('Analyze the Request');
      expect(PLAN_MODE_PROMPT).toContain('Create a Plan');
      expect(PLAN_MODE_PROMPT).toContain('Get Approval');
      expect(PLAN_MODE_PROMPT).toContain('Do NOT start coding');
    });
  });

  // ── buildSystemPromptConfig ───────────────────────────────────────────

  describe('buildSystemPromptConfig', () => {
    const sessionId = 'sess-abc';
    const projectId = 'proj-xyz';

    it('includes plan mode prompt when mode is plan', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'plan');
      expect(result).toContain('Plan Mode Active');
    });

    it('excludes plan mode prompt for standard mode', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');
      expect(result).not.toContain('Plan Mode Active');
    });

    it('excludes plan mode prompt for yolo mode', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'yolo');
      expect(result).not.toContain('Plan Mode Active');
    });

    it('uses DEFAULT_SYSTEM_PROMPT when no custom prompt given', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');
      expect(result).toContain(DEFAULT_SYSTEM_PROMPT);
    });

    it('uses custom system prompt when provided', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, 'My custom prompt', 'standard');
      expect(result).toContain('My custom prompt');
      expect(result).not.toContain(DEFAULT_SYSTEM_PROMPT);
    });

    it('includes canvas write instructions with sessionId', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');
      expect(result).toContain(`/api/sessions/${sessionId}/canvas`);
      expect(result).toContain('POST');
    });

    it('includes canvas read instructions', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');
      expect(result).toContain('Reading from Canvas');
      expect(result).toContain('curl');
    });

    it('includes session API instructions with sessionId and projectId', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');
      expect(result).toContain('Session Management API');
      expect(result).toContain(sessionId);
      expect(result).toContain(projectId);
    });

    it('includes worktree context when session has gitWorktree', () => {
      sessions.getById.mockReturnValue({
        gitWorktree: '/home/user/worktree',
        gitBranch: 'feature/test',
      });
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');
      expect(result).toContain('Git Worktree Session');
      expect(result).toContain('/home/user/worktree');
      expect(result).toContain('feature/test');
    });

    it('excludes worktree context when session has no gitWorktree', () => {
      sessions.getById.mockReturnValue({ gitWorktree: null, gitBranch: null });
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');
      expect(result).not.toContain('Git Worktree Session');
    });

    it('includes attachment context when attachments exist', () => {
      attachments.getBySessionId.mockReturnValue([
        { filename: 'file.txt', mimeType: 'text/plain', size: 10, filePath: '/tmp/file.txt' },
      ]);
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'standard');
      expect(result).toContain('Session Attached Files');
      expect(result).toContain('file.txt');
    });

    it('plan mode prompt appears before canvas instructions', () => {
      const result = buildSystemPromptConfig(sessionId, projectId, null, 'plan');
      const planIdx = result.indexOf('Plan Mode Active');
      const canvasIdx = result.indexOf('canvas');
      expect(planIdx).toBeLessThan(canvasIdx);
    });
  });
});
