import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../database.js', () => ({
  modelProviders: {
    getProviderByModelId: vi.fn(),
  },
}));

vi.mock('./nodeSpawnHelper.js', () => ({
  createRobustEnv: vi.fn((env) => ({ ...env, PATH: `/mock-node-bin:${env.PATH || ''}` })),
}));

import { modelProviders } from '../database.js';
import { resolveProviderFromModel, buildProviderEnv, buildSessionEnv } from './sessionProvider.js';

describe('sessionProvider', () => {
  const savedMaxThinkingTokens = process.env.MAX_THINKING_TOKENS;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MAX_THINKING_TOKENS;
    delete process.env.VCR_MODE;
  });

  afterEach(() => {
    // Restore original env state
    if (savedMaxThinkingTokens !== undefined) {
      process.env.MAX_THINKING_TOKENS = savedMaxThinkingTokens;
    } else {
      delete process.env.MAX_THINKING_TOKENS;
    }
    delete process.env.VCR_MODE;
  });

  // ── resolveProviderFromModel ──────────────────────────────────────────

  describe('resolveProviderFromModel', () => {
    it('delegates to modelProviders.getProviderByModelId', () => {
      const mockProvider = { id: 'p1', name: 'Custom Provider' };
      modelProviders.getProviderByModelId.mockReturnValue(mockProvider);

      const result = resolveProviderFromModel('my-model');
      expect(modelProviders.getProviderByModelId).toHaveBeenCalledWith('my-model');
      expect(result).toBe(mockProvider);
    });

    it('returns null when no provider found', () => {
      modelProviders.getProviderByModelId.mockReturnValue(null);
      expect(resolveProviderFromModel('unknown-model')).toBeNull();
    });

    it('handles null modelId', () => {
      modelProviders.getProviderByModelId.mockReturnValue(null);
      expect(resolveProviderFromModel(null)).toBeNull();
      expect(modelProviders.getProviderByModelId).toHaveBeenCalledWith(null);
    });
  });

  // ── buildProviderEnv ──────────────────────────────────────────────────

  describe('buildProviderEnv', () => {
    it('returns empty object when provider is null', () => {
      expect(buildProviderEnv(null)).toEqual({});
    });

    it('returns empty object when provider is undefined', () => {
      expect(buildProviderEnv(undefined)).toEqual({});
    });

    it('sets ANTHROPIC_BASE_URL from provider.baseUrl', () => {
      const provider = { name: 'P', baseUrl: 'https://my-proxy.example.com' };
      const env = buildProviderEnv(provider);
      expect(env.ANTHROPIC_BASE_URL).toBe('https://my-proxy.example.com');
    });

    it('sets ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN from provider.authToken', () => {
      const provider = { name: 'P', authToken: 'sk-secret-token' };
      const env = buildProviderEnv(provider);
      expect(env.ANTHROPIC_API_KEY).toBe('sk-secret-token');
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-secret-token');
    });

    it('does not set auth keys when authToken is absent', () => {
      const provider = { name: 'P' };
      const env = buildProviderEnv(provider);
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    });

    it('sets model tier env vars from provider.models array', () => {
      const provider = {
        name: 'P',
        models: [
          { modelId: 'my-opus', tier: 'opus' },
          { modelId: 'my-sonnet', tier: 'sonnet' },
          { modelId: 'my-haiku', tier: 'haiku' },
        ],
      };
      const env = buildProviderEnv(provider);
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('my-opus');
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('my-sonnet');
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('my-haiku');
    });

    it('only sets env vars for tiers present in models array', () => {
      const provider = {
        name: 'P',
        models: [{ modelId: 'only-sonnet', tier: 'sonnet' }],
      };
      const env = buildProviderEnv(provider);
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('only-sonnet');
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    });

    it('handles provider with no models array', () => {
      const provider = { name: 'P' };
      const env = buildProviderEnv(provider);
      // Should not throw, and no model env vars set
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    });

    it('sets API_TIMEOUT_MS from provider.apiTimeoutMs', () => {
      const provider = { name: 'P', apiTimeoutMs: 60000 };
      const env = buildProviderEnv(provider);
      expect(env.API_TIMEOUT_MS).toBe('60000');
    });

    it('merges additionalEnvVars', () => {
      const provider = {
        name: 'P',
        additionalEnvVars: { CUSTOM_VAR: 'custom_value', ANOTHER: '123' },
      };
      const env = buildProviderEnv(provider);
      expect(env.CUSTOM_VAR).toBe('custom_value');
      expect(env.ANOTHER).toBe('123');
    });

    it('combines all fields together', () => {
      const provider = {
        name: 'Full Provider',
        baseUrl: 'https://proxy.example.com',
        authToken: 'sk-token',
        models: [{ modelId: 'test-sonnet', tier: 'sonnet' }],
        apiTimeoutMs: 30000,
        additionalEnvVars: { EXTRA: 'val' },
      };
      const env = buildProviderEnv(provider);
      expect(env.ANTHROPIC_BASE_URL).toBe('https://proxy.example.com');
      expect(env.ANTHROPIC_API_KEY).toBe('sk-token');
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-token');
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('test-sonnet');
      expect(env.API_TIMEOUT_MS).toBe('30000');
      expect(env.EXTRA).toBe('val');
    });
  });

  // ── buildSessionEnv ───────────────────────────────────────────────────

  describe('buildSessionEnv', () => {
    it('returns env from createRobustEnv when no provider', () => {
      const env = buildSessionEnv(null, false);
      // Should have PATH from the mock createRobustEnv
      expect(env.PATH).toContain('/mock-node-bin');
      // Should delete ANTHROPIC_ vars when no provider
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('includes provider env vars when provider is given', () => {
      const provider = { name: 'P', baseUrl: 'https://test.com', authToken: 'sk-123' };
      const env = buildSessionEnv(provider, false);
      expect(env.ANTHROPIC_BASE_URL).toBe('https://test.com');
      expect(env.ANTHROPIC_API_KEY).toBe('sk-123');
    });

    it('sets MAX_THINKING_TOKENS when thinkingEnabled is true', () => {
      // Ensure VCR_MODE is not set
      delete process.env.VCR_MODE;
      const env = buildSessionEnv(null, true);
      expect(env.MAX_THINKING_TOKENS).toBe('10240');
    });

    it('does not set MAX_THINKING_TOKENS when thinkingEnabled is false', () => {
      const env = buildSessionEnv(null, false);
      expect(env.MAX_THINKING_TOKENS).toBeUndefined();
    });

    it('does not set MAX_THINKING_TOKENS when VCR_MODE is set', () => {
      process.env.VCR_MODE = '1';
      const env = buildSessionEnv(null, true);
      expect(env.MAX_THINKING_TOKENS).toBeUndefined();
      delete process.env.VCR_MODE;
    });

    it('defaults thinkingEnabled to false', () => {
      const env = buildSessionEnv(null);
      expect(env.MAX_THINKING_TOKENS).toBeUndefined();
    });
  });
});
