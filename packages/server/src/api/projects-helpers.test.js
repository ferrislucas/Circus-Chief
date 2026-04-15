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

  it('returns null and does not mutate config for non-git repo with missing fields', async () => {
    isGitRepo.mockResolvedValue(false);

    const config = { prompt: 'test' };
    const result = await validateGitSettings(config, project);

    expect(result).toBeNull();
    expect(config.gitMode).toBeUndefined();
    expect(config.gitBranch).toBeUndefined();
  });

  it('returns null and does not mutate config for git repo with both fields present', async () => {
    isGitRepo.mockResolvedValue(true);

    const config = { gitMode: 'worktree', gitBranch: 'feature-x' };
    const result = await validateGitSettings(config, project);

    expect(result).toBeNull();
    expect(config.gitMode).toBe('worktree');
    expect(config.gitBranch).toBe('feature-x');
    // isGitRepo should not even be called when both fields are present
    expect(isGitRepo).not.toHaveBeenCalled();
  });

  it('defaults gitMode to none for git repo when gitMode is missing', async () => {
    isGitRepo.mockResolvedValue(true);

    const config = { gitBranch: 'feature-x' };
    const result = await validateGitSettings(config, project);

    expect(result).toBeNull();
    expect(config.gitMode).toBe('none');
    expect(config.gitBranch).toBe('feature-x');
  });

  it('defaults gitBranch to main for git repo when gitBranch is missing', async () => {
    isGitRepo.mockResolvedValue(true);

    const config = { gitMode: 'worktree' };
    const result = await validateGitSettings(config, project);

    expect(result).toBeNull();
    expect(config.gitMode).toBe('worktree');
    expect(config.gitBranch).toBe('main');
  });

  it('defaults both gitMode and gitBranch for git repo when both are missing', async () => {
    isGitRepo.mockResolvedValue(true);

    const config = {};
    const result = await validateGitSettings(config, project);

    expect(result).toBeNull();
    expect(config.gitMode).toBe('none');
    expect(config.gitBranch).toBe('main');
  });

  it('treats null values as missing and applies defaults for git repo', async () => {
    isGitRepo.mockResolvedValue(true);

    const config = { gitMode: null, gitBranch: null };
    const result = await validateGitSettings(config, project);

    expect(result).toBeNull();
    expect(config.gitMode).toBe('none');
    expect(config.gitBranch).toBe('main');
  });

  it('does not call isGitRepo when both fields are truthy', async () => {
    const config = { gitMode: 'none', gitBranch: 'main' };
    const result = await validateGitSettings(config, project);

    expect(result).toBeNull();
    expect(isGitRepo).not.toHaveBeenCalled();
  });
});
