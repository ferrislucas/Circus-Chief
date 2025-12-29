import { describe, it, expect } from 'vitest';
import {
  CreateQuickResponseRequest,
  UpdateQuickResponseRequest,
  QuickResponseResponse,
  QuickResponseListResponse,
  QuickResponsesForProjectResponse,
  ReorderQuickResponsesRequest,
} from './quickResponses.js';

describe('CreateQuickResponseRequest', () => {
  it('should accept valid request with required fields only', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: 'Yes',
      content: 'yes',
    });
    expect(result.success).toBe(true);
    expect(result.data.autoSubmit).toBe(false);
    expect(result.data.sortOrder).toBe(0);
    expect(result.data.isGlobal).toBe(false);
  });

  it('should accept valid request with all fields', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: 'Run tests',
      content: 'Please run the test suite',
      autoSubmit: true,
      category: 'commands',
      sortOrder: 5,
      isGlobal: true,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      label: 'Run tests',
      content: 'Please run the test suite',
      autoSubmit: true,
      category: 'commands',
      sortOrder: 5,
      isGlobal: true,
    });
  });

  it('should reject empty label', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: '',
      content: 'content',
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Label is required');
  });

  it('should reject missing label', () => {
    const result = CreateQuickResponseRequest.safeParse({
      content: 'content',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty content', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: 'Yes',
      content: '',
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Content is required');
  });

  it('should reject missing content', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: 'Yes',
    });
    expect(result.success).toBe(false);
  });

  it('should reject label longer than 50 characters', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: 'a'.repeat(51),
      content: 'content',
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Label must be 50 characters or less');
  });

  it('should accept label exactly 50 characters', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: 'a'.repeat(50),
      content: 'content',
    });
    expect(result.success).toBe(true);
  });

  it('should reject content longer than 10000 characters', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: 'Test',
      content: 'a'.repeat(10001),
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].message).toBe('Content must be 10000 characters or less');
  });

  it('should accept content exactly 10000 characters', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: 'Test',
      content: 'a'.repeat(10000),
    });
    expect(result.success).toBe(true);
  });

  it('should accept null category', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: 'Test',
      content: 'content',
      category: null,
    });
    expect(result.success).toBe(true);
    expect(result.data.category).toBeNull();
  });

  it('should reject negative sortOrder', () => {
    const result = CreateQuickResponseRequest.safeParse({
      label: 'Test',
      content: 'content',
      sortOrder: -1,
    });
    expect(result.success).toBe(false);
  });
});

describe('UpdateQuickResponseRequest', () => {
  it('should accept updating label only', () => {
    const result = UpdateQuickResponseRequest.safeParse({
      label: 'New Label',
    });
    expect(result.success).toBe(true);
    expect(result.data.label).toBe('New Label');
  });

  it('should accept updating content only', () => {
    const result = UpdateQuickResponseRequest.safeParse({
      content: 'New content',
    });
    expect(result.success).toBe(true);
    expect(result.data.content).toBe('New content');
  });

  it('should accept updating autoSubmit only', () => {
    const result = UpdateQuickResponseRequest.safeParse({
      autoSubmit: true,
    });
    expect(result.success).toBe(true);
    expect(result.data.autoSubmit).toBe(true);
  });

  it('should accept updating sortOrder only', () => {
    const result = UpdateQuickResponseRequest.safeParse({
      sortOrder: 5,
    });
    expect(result.success).toBe(true);
    expect(result.data.sortOrder).toBe(5);
  });

  it('should accept updating category only', () => {
    const result = UpdateQuickResponseRequest.safeParse({
      category: 'feedback',
    });
    expect(result.success).toBe(true);
    expect(result.data.category).toBe('feedback');
  });

  it('should reject empty object', () => {
    const result = UpdateQuickResponseRequest.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should accept multiple fields', () => {
    const result = UpdateQuickResponseRequest.safeParse({
      label: 'New',
      content: 'New content',
      autoSubmit: true,
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty label', () => {
    const result = UpdateQuickResponseRequest.safeParse({
      label: '',
    });
    expect(result.success).toBe(false);
  });

  it('should reject label longer than 50 characters', () => {
    const result = UpdateQuickResponseRequest.safeParse({
      label: 'a'.repeat(51),
    });
    expect(result.success).toBe(false);
  });
});

describe('QuickResponseResponse', () => {
  it('should accept valid response', () => {
    const result = QuickResponseResponse.safeParse({
      id: '123',
      projectId: '456',
      label: 'Yes',
      content: 'yes',
      autoSubmit: true,
      category: 'feedback',
      sortOrder: 0,
      createdAt: 1234567890,
      updatedAt: 1234567890,
    });
    expect(result.success).toBe(true);
  });

  it('should accept null projectId for global responses', () => {
    const result = QuickResponseResponse.safeParse({
      id: '123',
      projectId: null,
      label: 'LGTM',
      content: 'Looks good to me',
      autoSubmit: false,
      category: null,
      sortOrder: 0,
      createdAt: 1234567890,
      updatedAt: 1234567890,
    });
    expect(result.success).toBe(true);
  });
});

describe('QuickResponseListResponse', () => {
  it('should accept array of responses', () => {
    const result = QuickResponseListResponse.safeParse([
      {
        id: '1',
        projectId: '123',
        label: 'Yes',
        content: 'yes',
        autoSubmit: true,
        category: null,
        sortOrder: 0,
        createdAt: 1234567890,
        updatedAt: 1234567890,
      },
      {
        id: '2',
        projectId: '123',
        label: 'No',
        content: 'no',
        autoSubmit: true,
        category: null,
        sortOrder: 1,
        createdAt: 1234567890,
        updatedAt: 1234567890,
      },
    ]);
    expect(result.success).toBe(true);
  });

  it('should accept empty array', () => {
    const result = QuickResponseListResponse.safeParse([]);
    expect(result.success).toBe(true);
  });
});

describe('QuickResponsesForProjectResponse', () => {
  it('should accept valid response with project and global arrays', () => {
    const result = QuickResponsesForProjectResponse.safeParse({
      project: [
        {
          id: '1',
          projectId: '123',
          label: 'Yes',
          content: 'yes',
          autoSubmit: true,
          category: null,
          sortOrder: 0,
          createdAt: 1234567890,
          updatedAt: 1234567890,
        },
      ],
      global: [
        {
          id: '2',
          projectId: null,
          label: 'LGTM',
          content: 'Looks good to me',
          autoSubmit: false,
          category: null,
          sortOrder: 0,
          createdAt: 1234567890,
          updatedAt: 1234567890,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty arrays', () => {
    const result = QuickResponsesForProjectResponse.safeParse({
      project: [],
      global: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('ReorderQuickResponsesRequest', () => {
  it('should accept valid reorder request', () => {
    const result = ReorderQuickResponsesRequest.safeParse([
      { id: '1', sortOrder: 0 },
      { id: '2', sortOrder: 1 },
      { id: '3', sortOrder: 2 },
    ]);
    expect(result.success).toBe(true);
  });

  it('should accept empty array', () => {
    const result = ReorderQuickResponsesRequest.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('should reject negative sortOrder', () => {
    const result = ReorderQuickResponsesRequest.safeParse([
      { id: '1', sortOrder: -1 },
    ]);
    expect(result.success).toBe(false);
  });

  it('should reject missing id', () => {
    const result = ReorderQuickResponsesRequest.safeParse([
      { sortOrder: 0 },
    ]);
    expect(result.success).toBe(false);
  });

  it('should reject missing sortOrder', () => {
    const result = ReorderQuickResponsesRequest.safeParse([
      { id: '1' },
    ]);
    expect(result.success).toBe(false);
  });
});
