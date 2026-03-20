import { describe, it, expect } from 'vitest';
import { CreateCanvasItemRequest, CanvasItemResponse, UpdateCanvasItemRequest } from './canvas.js';

describe('Canvas Contracts', () => {
  describe('CreateCanvasItemRequest', () => {
    it('accepts filePath', () => {
      const result = CreateCanvasItemRequest.safeParse({
        filePath: '/path/to/file.txt',
      });
      expect(result.success).toBe(true);
    });

    it('rejects missing filePath', () => {
      const result = CreateCanvasItemRequest.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts empty filePath (schema allows it)', () => {
      const result = CreateCanvasItemRequest.safeParse({
        filePath: '',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('CanvasItemResponse', () => {
    const now = Date.now();

    it('accepts code type in response', () => {
      const result = CanvasItemResponse.safeParse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        sessionId: '123e4567-e89b-12d3-a456-426614174001',
        type: 'code',
        content: 'const x = 1;',
        data: null,
        mimeType: 'text/javascript',
        filename: 'test.js',
        width: null,
        height: null,
        createdAt: now,
        updatedAt: now,
      });
      expect(result.success).toBe(true);
    });

    it('accepts all valid types in response', () => {
      const types = ['image', 'markdown', 'text', 'json', 'pdf', 'code'];
      for (const type of types) {
        const result = CanvasItemResponse.safeParse({
          id: '123e4567-e89b-12d3-a456-426614174000',
          sessionId: null,
          type,
          content: null,
          data: null,
          mimeType: null,
          filename: null,
          width: null,
          height: null,
          createdAt: now,
          updatedAt: now,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid type in response', () => {
      const result = CanvasItemResponse.safeParse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        sessionId: null,
        type: 'invalid',
        content: null,
        data: null,
        mimeType: null,
        filename: null,
        width: null,
        height: null,
        createdAt: now,
        updatedAt: now,
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing updatedAt', () => {
      const result = CanvasItemResponse.safeParse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        sessionId: null,
        type: 'text',
        content: null,
        data: null,
        mimeType: null,
        filename: null,
        width: null,
        height: null,
        createdAt: now,
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional sessionId as null', () => {
      const result = CanvasItemResponse.safeParse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        sessionId: null,
        type: 'text',
        content: 'some content',
        data: null,
        mimeType: 'text/plain',
        filename: 'test.txt',
        width: null,
        height: null,
        createdAt: now,
        updatedAt: now,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateCanvasItemRequest', () => {
    it('accepts valid content string', () => {
      const result = UpdateCanvasItemRequest.safeParse({ content: 'hello' });
      expect(result.success).toBe(true);
      expect(result.data.content).toBe('hello');
    });

    it('accepts empty string content', () => {
      const result = UpdateCanvasItemRequest.safeParse({ content: '' });
      expect(result.success).toBe(true);
      expect(result.data.content).toBe('');
    });

    it('rejects missing content field', () => {
      const result = UpdateCanvasItemRequest.safeParse({});
      expect(result.success).toBe(false);
    });

    it('rejects non-string content', () => {
      const result = UpdateCanvasItemRequest.safeParse({ content: 123 });
      expect(result.success).toBe(false);
    });

    it('strips extra fields', () => {
      const result = UpdateCanvasItemRequest.safeParse({ content: 'ok', extra: 'bad' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ content: 'ok' });
    });
  });
});
