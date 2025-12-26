import { describe, it, expect } from 'vitest';
import { CreateCanvasItemRequest, CanvasItemResponse } from './canvas.js';

describe('Canvas Contracts', () => {
  describe('CreateCanvasItemRequest', () => {
    it('accepts code type', () => {
      const result = CreateCanvasItemRequest.safeParse({
        type: 'code',
        content: 'const x = 1;',
        filename: 'test.js',
      });
      expect(result.success).toBe(true);
    });

    it('accepts all valid types', () => {
      const types = ['image', 'markdown', 'text', 'json', 'pdf', 'code'];
      for (const type of types) {
        const result = CreateCanvasItemRequest.safeParse({ type });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid type', () => {
      const result = CreateCanvasItemRequest.safeParse({
        type: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('accepts optional fields', () => {
      const result = CreateCanvasItemRequest.safeParse({
        type: 'code',
        content: 'const x = 1;',
        filename: 'test.js',
        mimeType: 'text/javascript',
        label: 'My code file',
      });
      expect(result.success).toBe(true);
    });
  });

  describe('CanvasItemResponse', () => {
    it('accepts code type in response', () => {
      const result = CanvasItemResponse.safeParse({
        id: '123e4567-e89b-12d3-a456-426614174000',
        sessionId: '123e4567-e89b-12d3-a456-426614174001',
        type: 'code',
        content: 'const x = 1;',
        data: null,
        mimeType: 'text/javascript',
        filename: 'test.js',
        label: null,
        width: null,
        height: null,
        createdAt: Date.now(),
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
          label: null,
          width: null,
          height: null,
          createdAt: Date.now(),
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
        label: null,
        width: null,
        height: null,
        createdAt: Date.now(),
      });
      expect(result.success).toBe(false);
    });
  });
});
