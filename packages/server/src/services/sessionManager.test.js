import { describe, it, expect } from 'vitest';
import {
  getPermissionModeForSession,
  buildSystemPromptConfig,
  buildPromptWithAttachments,
  PLAN_MODE_PROMPT,
} from './sessionManager.js';

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
});
