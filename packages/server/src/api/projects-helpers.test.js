import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock isGitRepo before importing the module under test
vi.mock('../services/gitService.js', () => ({
  isGitRepo: vi.fn(),
}));

import { validateGitSettings } from './projects-helpers.js';
import { isGitRepo } from '../services/gitService.js';

describe('validateGitSettings', () => {
  const project = { workingDirectory: '/some/path' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns original config unchanged for non-git repo with missing fields', async () => {
    isGitRepo.mockResolvedValue(false);

    const config = { prompt: 'test' };
    const result = await validateGitSettings(config, project);

    expect(result).toEqual({ config: { prompt: 'test' }, error: null });
    expect(config.gitMode).toBeUndefined();
    expect(config.gitBranch).toBeUndefined();
  });

  it('returns original config unchanged for git repo with both fields present', async () => {
    isGitRepo.mockResolvedValue(true);

    const config = { gitMode: 'worktree', gitBranch: 'feature-x' };
    const result = await validateGitSettings(config, project);

    expect(result).toEqual({ config: { gitMode: 'worktree', gitBranch: 'feature-x' }, error: null });
    // isGitRepo should not even be called when both fields are present
    expect(isGitRepo).not.toHaveBeenCalled();
  });

  it('defaults gitMode to none for git repo when gitMode is missing', async () => {
    isGitRepo.mockResolvedValue(true);

    const config = { gitBranch: 'feature-x' };
    const result = await validateGitSettings(config, project);

    expect(result).toEqual({ config: { gitBranch: 'feature-x', gitMode: 'none' }, error: null });
    expect(config.gitMode).toBeUndefined();
  });

  it('generates gitBranch for git repo when worktree gitBranch is missing', async () => {
    isGitRepo.mockResolvedValue(true);

    const config = { gitMode: 'worktree', prompt: 'Test prompt' };
    const result = await validateGitSettings(config, project);

    expect(result.error).toBeNull();
    expect(result.config).toMatchObject({ gitMode: 'worktree', prompt: 'Test prompt' });
    expect(result.config.gitBranch).toMatch(/^circus-chief\/[0-9a-f]{4}-test-prompt$/);
    expect(config.gitBranch).toBeUndefined();
  });

  it('defaults both gitMode and gitBranch for git repo when both are missing', async () => {
    isGitRepo.mockResolvedValue(true);

    const config = {};
    const result = await validateGitSettings(config, project);

    expect(result).toEqual({ config: { gitMode: 'none', gitBranch: 'main' }, error: null });
    expect(config.gitMode).toBeUndefined();
    expect(config.gitBranch).toBeUndefined();
  });

  it('treats null values as missing and applies defaults for git repo', async () => {
    isGitRepo.mockResolvedValue(true);

    const config = { gitMode: null, gitBranch: null };
    const result = await validateGitSettings(config, project);

    expect(result).toEqual({ config: { gitMode: 'none', gitBranch: 'main' }, error: null });
  });

  it('does not call isGitRepo when both fields are truthy', async () => {
    const config = { gitMode: 'none', gitBranch: 'main' };
    const result = await validateGitSettings(config, project);

    expect(result).toEqual({ config: { gitMode: 'none', gitBranch: 'main' }, error: null });
    expect(isGitRepo).not.toHaveBeenCalled();
  });

  describe('current mode', () => {
    it('passes through current mode without generating a branch', async () => {
      const config = { gitMode: 'current' };
      const result = await validateGitSettings(config, project);

      expect(result.error).toBeNull();
      expect(result.config.gitMode).toBe('current');
      expect(result.config.gitBranch).toBeNull();
      // Should not call isGitRepo - current mode short-circuits
      expect(isGitRepo).not.toHaveBeenCalled();
    });

    it('sets gitBranch to null even when a branch is provided', async () => {
      const config = { gitMode: 'current', gitBranch: 'some-branch' };
      const result = await validateGitSettings(config, project);

      expect(result.config.gitMode).toBe('current');
      expect(result.config.gitBranch).toBeNull();
    });
  });
});
