import { describe, it, expect } from 'vitest';
import {
  generateShortId,
  sanitizeBranchName,
  extractSlugFromPrompt,
  generateWorktreeBranch,
  calculateBillableTokens,
  formatTokenCount,
} from './utils.js';
import { DEFAULT_TOKEN_COST_WEIGHTS } from './constants.js';

describe('generateShortId', () => {
  it('generates a 4-character hex string', () => {
    const id = generateShortId();
    expect(id).toHaveLength(4);
    expect(id).toMatch(/^[0-9a-f]{4}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) {
      ids.add(generateShortId());
    }
    // Should have mostly unique IDs (allowing for rare collisions)
    expect(ids.size).toBeGreaterThan(90);
  });
});

describe('sanitizeBranchName', () => {
  it('converts to lowercase', () => {
    expect(sanitizeBranchName('Hello World')).toBe('hello-world');
  });

  it('replaces spaces with hyphens', () => {
    expect(sanitizeBranchName('my new feature')).toBe('my-new-feature');
  });

  it('removes special characters', () => {
    expect(sanitizeBranchName("fix bug #123!")).toBe('fix-bug-123');
  });

  it('collapses multiple hyphens', () => {
    expect(sanitizeBranchName('hello---world')).toBe('hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    expect(sanitizeBranchName('--hello--')).toBe('hello');
  });

  it('respects maxLength parameter', () => {
    const result = sanitizeBranchName('this is a very long session name that should be truncated', 20);
    expect(result.length).toBeLessThanOrEqual(20);
  });

  it('uses default maxLength of 30', () => {
    const result = sanitizeBranchName('this is a very very very long session name');
    expect(result.length).toBeLessThanOrEqual(30);
  });
});

describe('extractSlugFromPrompt', () => {
  it('extracts meaningful words from prompt', () => {
    expect(extractSlugFromPrompt('Add a dark mode toggle')).toBe('add-dark-mode-toggle');
  });

  it('filters out stop words', () => {
    expect(extractSlugFromPrompt('Please help me to fix the bug')).toBe('fix-bug');
  });

  it('limits to 4 words', () => {
    const result = extractSlugFromPrompt('implement user authentication with oauth and jwt tokens');
    const words = result.split('-');
    expect(words.length).toBeLessThanOrEqual(4);
  });

  it('returns session for empty/meaningless prompts', () => {
    expect(extractSlugFromPrompt('the a an')).toBe('session');
    expect(extractSlugFromPrompt('')).toBe('session');
  });

  it('removes special characters', () => {
    expect(extractSlugFromPrompt("Fix bug #123 in user's profile!")).toBe('fix-bug-123-users');
  });
});

describe('generateWorktreeBranch', () => {
  it('generates branch with format claude-tools/{shortId}-{slug}', () => {
    const branch = generateWorktreeBranch('Implement auth', '');
    expect(branch).toMatch(/^claude-tools\/[0-9a-f]{4}-implement-auth$/);
  });

  it('uses session name when provided', () => {
    const branch = generateWorktreeBranch('Fix login bug', 'Some prompt text');
    expect(branch).toMatch(/^claude-tools\/[0-9a-f]{4}-fix-login-bug$/);
  });

  it('falls back to prompt when no session name', () => {
    const branch = generateWorktreeBranch('', 'Add dark mode toggle to settings');
    expect(branch).toMatch(/^claude-tools\/[0-9a-f]{4}-add-dark-mode-toggle$/);
  });

  it('uses session as default when no name or prompt', () => {
    const branch = generateWorktreeBranch('', '');
    expect(branch).toMatch(/^claude-tools\/[0-9a-f]{4}-session$/);
  });

  it('handles undefined parameters', () => {
    const branch = generateWorktreeBranch(undefined, undefined);
    expect(branch).toMatch(/^claude-tools\/[0-9a-f]{4}-session$/);
  });

  it('handles whitespace-only input', () => {
    const branch = generateWorktreeBranch('   ', '   ');
    expect(branch).toMatch(/^claude-tools\/[0-9a-f]{4}-session$/);
  });

  it('sanitizes special characters in session name', () => {
    const branch = generateWorktreeBranch('Fix bug #123!', '');
    expect(branch).toMatch(/^claude-tools\/[0-9a-f]{4}-fix-bug-123$/);
  });
});

describe('calculateBillableTokens', () => {
  it('calculates BTE with default weights', () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadInputTokens: 2000,
      cacheCreationInputTokens: 100,
    };
    // Expected: 1000*1.0 + 500*5.0 + 2000*0.1 + 100*1.25 = 1000 + 2500 + 200 + 125 = 3825
    expect(calculateBillableTokens(usage)).toBe(3825);
  });

  it('handles missing token fields gracefully', () => {
    expect(calculateBillableTokens({ inputTokens: 100 })).toBe(100);
    expect(calculateBillableTokens({ outputTokens: 100 })).toBe(500);
    expect(calculateBillableTokens({ cacheReadInputTokens: 100 })).toBe(10);
    expect(calculateBillableTokens({ cacheCreationInputTokens: 100 })).toBe(125);
  });

  it('handles null or undefined usage', () => {
    expect(calculateBillableTokens(null)).toBe(0);
    expect(calculateBillableTokens(undefined)).toBe(0);
  });

  it('handles empty usage object', () => {
    expect(calculateBillableTokens({})).toBe(0);
  });

  it('uses custom weights when provided', () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 500,
    };
    const customWeights = {
      input: 2.0,
      output: 10.0,
      cacheRead: 0.5,
      cacheCreation: 2.0,
    };
    // Expected: 1000*2.0 + 500*10.0 = 2000 + 5000 = 7000
    expect(calculateBillableTokens(usage, customWeights)).toBe(7000);
  });

  it('rounds the result to nearest integer', () => {
    const usage = {
      inputTokens: 1,
      cacheReadInputTokens: 1, // 0.1 weight
    };
    // Expected: 1*1.0 + 1*0.1 = 1.1, rounded to 1
    expect(calculateBillableTokens(usage)).toBe(1);
  });

  it('handles large token counts', () => {
    const usage = {
      inputTokens: 1000000,
      outputTokens: 500000,
    };
    // Expected: 1000000*1.0 + 500000*5.0 = 1000000 + 2500000 = 3500000
    expect(calculateBillableTokens(usage)).toBe(3500000);
  });
});

describe('formatTokenCount', () => {
  it('formats zero as "0"', () => {
    expect(formatTokenCount(0)).toBe('0');
  });

  it('handles null and undefined as "0"', () => {
    expect(formatTokenCount(null)).toBe('0');
    expect(formatTokenCount(undefined)).toBe('0');
  });

  it('formats small numbers as-is', () => {
    expect(formatTokenCount(1)).toBe('1');
    expect(formatTokenCount(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokenCount(1000)).toBe('1.0K');
    expect(formatTokenCount(1234)).toBe('1.2K');
    expect(formatTokenCount(12345)).toBe('12.3K');
    expect(formatTokenCount(123456)).toBe('123.5K');
    expect(formatTokenCount(999999)).toBe('1000.0K');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokenCount(1000000)).toBe('1.0M');
    expect(formatTokenCount(1234567)).toBe('1.2M');
    expect(formatTokenCount(12345678)).toBe('12.3M');
  });
});

describe('DEFAULT_TOKEN_COST_WEIGHTS', () => {
  it('has expected default values', () => {
    expect(DEFAULT_TOKEN_COST_WEIGHTS.input).toBe(1.0);
    expect(DEFAULT_TOKEN_COST_WEIGHTS.output).toBe(5.0);
    expect(DEFAULT_TOKEN_COST_WEIGHTS.cacheRead).toBe(0.1);
    expect(DEFAULT_TOKEN_COST_WEIGHTS.cacheCreation).toBe(1.25);
  });
});
