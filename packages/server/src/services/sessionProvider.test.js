import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../database.js', () => ({
  modelProviders: {
    getProviderByModelId: vi.fn(),
    getAgentTypeForProvider: vi.fn(),
  },
}));

vi.mock('./nodeSpawnHelper.js', () => ({
  createRobustEnv: vi.fn((env) => ({ ...env, PATH: `/mock-node-bin:${env.PATH || ''}` })),
}));

import { modelProviders } from '../database.js';
import {
  resolveProviderFromModel,
  resolveAgentTypeFromModel,
  buildProviderEnv,
  buildSessionEnv,
} from './sessionProvider.js';

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

    it('sets CLAUDE_CODE_EFFORT_LEVEL when effortLevel is provided', () => {
      const env = buildSessionEnv(null, false, 'high');
      expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('high');
    });

    it('sets CLAUDE_CODE_EFFORT_LEVEL for all valid effort levels', () => {
      for (const level of ['low', 'medium', 'high', 'max', 'auto']) {
        const env = buildSessionEnv(null, false, level);
        expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe(level);
      }
    });

    it('does not set CLAUDE_CODE_EFFORT_LEVEL when effortLevel is null', () => {
      const env = buildSessionEnv(null, false, null);
      expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    });

    it('does not set CLAUDE_CODE_EFFORT_LEVEL when effortLevel is not provided', () => {
      const env = buildSessionEnv(null, false);
      expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    });

    it('combines effortLevel with thinkingEnabled and provider env', () => {
      delete process.env.VCR_MODE;
      const provider = { name: 'P', baseUrl: 'https://test.com', authToken: 'sk-123' };
      const env = buildSessionEnv(provider, true, 'max');
      expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('max');
      expect(env.MAX_THINKING_TOKENS).toBe('10240');
      expect(env.ANTHROPIC_BASE_URL).toBe('https://test.com');
    });
  });

  // ── resolveAgentTypeFromModel ─────────────────────────────────────────

  describe('resolveAgentTypeFromModel', () => {
    it("returns 'claude-code' for null modelId", () => {
      expect(resolveAgentTypeFromModel(null)).toBe('claude-code');
    });

    it("returns 'claude-code' for undefined modelId", () => {
      expect(resolveAgentTypeFromModel(undefined)).toBe('claude-code');
    });

    it("returns 'claude-code' for tier name 'sonnet'", () => {
      modelProviders.getProviderByModelId.mockReturnValue(null);
      expect(resolveAgentTypeFromModel('sonnet')).toBe('claude-code');
    });

    it("returns 'claude-code' for tier name 'opus'", () => {
      modelProviders.getProviderByModelId.mockReturnValue(null);
      expect(resolveAgentTypeFromModel('opus')).toBe('claude-code');
    });

    it("returns 'claude-code' for tier name 'haiku'", () => {
      modelProviders.getProviderByModelId.mockReturnValue(null);
      expect(resolveAgentTypeFromModel('haiku')).toBe('claude-code');
    });

    it("returns 'claude-code' for unknown model ID (graceful fallback)", () => {
      modelProviders.getProviderByModelId.mockReturnValue(null);
      expect(resolveAgentTypeFromModel('some-unknown-model')).toBe('claude-code');
    });

    it("returns 'claude-code' for a model owned by an anthropic-kind provider", () => {
      modelProviders.getProviderByModelId.mockReturnValue({ id: 'p1', kind: 'anthropic' });
      modelProviders.getAgentTypeForProvider.mockReturnValue('claude-code');
      expect(resolveAgentTypeFromModel('claude-sonnet-4')).toBe('claude-code');
      expect(modelProviders.getAgentTypeForProvider).toHaveBeenCalledWith('p1');
    });

    it("returns 'codex' for a model owned by an openai-kind provider", () => {
      modelProviders.getProviderByModelId.mockReturnValue({ id: 'p2', kind: 'openai' });
      modelProviders.getAgentTypeForProvider.mockReturnValue('codex');
      expect(resolveAgentTypeFromModel('gpt-4o')).toBe('codex');
    });

    it("falls back to 'claude-code' when getAgentTypeForProvider returns null", () => {
      modelProviders.getProviderByModelId.mockReturnValue({ id: 'p3', kind: 'anthropic' });
      modelProviders.getAgentTypeForProvider.mockReturnValue(null);
      expect(resolveAgentTypeFromModel('weird-model')).toBe('claude-code');
    });
  });

  // ── buildProviderEnv: kind-aware branching ────────────────────────────

  describe('buildProviderEnv (kind-aware)', () => {
    it("anthropic-kind provider emits ANTHROPIC_* keys + tier defaults + API_TIMEOUT_MS + additionalEnvVars", () => {
      const provider = {
        name: 'Anth',
        kind: 'anthropic',
        baseUrl: 'https://anth.example.com',
        authToken: 'sk-a',
        apiTimeoutMs: 30000,
        models: [
          { modelId: 'my-opus', tier: 'opus' },
          { modelId: 'my-sonnet', tier: 'sonnet' },
          { modelId: 'my-haiku', tier: 'haiku' },
        ],
        additionalEnvVars: { EXTRA: 'yes' },
      };
      const env = buildProviderEnv(provider);
      expect(env.ANTHROPIC_BASE_URL).toBe('https://anth.example.com');
      expect(env.ANTHROPIC_API_KEY).toBe('sk-a');
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-a');
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('my-opus');
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('my-sonnet');
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('my-haiku');
      expect(env.API_TIMEOUT_MS).toBe('30000');
      expect(env.EXTRA).toBe('yes');
      // No OPENAI_* leaks
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.OPENAI_BASE_URL).toBeUndefined();
    });

    it("openai-kind provider emits OPENAI_* keys + API_TIMEOUT_MS + additionalEnvVars, no tier env vars", () => {
      const provider = {
        name: 'OAI',
        kind: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        authToken: 'sk-o',
        apiTimeoutMs: 45000,
        // Even if models array is present, no ANTHROPIC_DEFAULT_*_MODEL should be emitted.
        models: [
          { modelId: 'gpt-4o', tier: 'opus' },
          { modelId: 'o1-mini', tier: 'sonnet' },
        ],
        additionalEnvVars: { HTTP_PROXY: 'http://proxy.local:8080' },
      };
      const env = buildProviderEnv(provider);
      expect(env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
      expect(env.OPENAI_API_KEY).toBe('sk-o');
      expect(env.API_TIMEOUT_MS).toBe('45000');
      expect(env.HTTP_PROXY).toBe('http://proxy.local:8080');
      // No tier→model env vars for OpenAI
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
      // No ANTHROPIC_* leaks
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it("openai-kind provider without authToken does not set OPENAI_API_KEY", () => {
      const provider = { name: 'OAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1' };
      const env = buildProviderEnv(provider);
      expect(env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
      expect(env.OPENAI_API_KEY).toBeUndefined();
    });

    it("additionalEnvVars passes through unchanged for both kinds (HTTP_PROXY, SSL_CERT_FILE regression)", () => {
      const extras = { HTTP_PROXY: 'http://x', HTTPS_PROXY: 'http://y', SSL_CERT_FILE: '/etc/ssl/cert.pem' };
      const anth = buildProviderEnv({ name: 'A', kind: 'anthropic', additionalEnvVars: extras });
      const oai = buildProviderEnv({ name: 'O', kind: 'openai', additionalEnvVars: extras });
      for (const [k, v] of Object.entries(extras)) {
        expect(anth[k]).toBe(v);
        expect(oai[k]).toBe(v);
      }
    });

    it("unknown kind falls back to anthropic behavior (defensive)", () => {
      // Not a valid path in practice (Zod + CHECK reject this), but defensive
      // fallback ensures no runtime crash if a bad provider row leaks through.
      const provider = { name: 'Odd', kind: 'martian', baseUrl: 'x', authToken: 't' };
      const env = buildProviderEnv(provider);
      expect(env.ANTHROPIC_BASE_URL).toBe('x');
      expect(env.ANTHROPIC_API_KEY).toBe('t');
    });
  });

  // ── buildSessionEnv: kind-aware stripping + claude-only gating ────────

  describe('buildSessionEnv (kind-aware)', () => {
    const savedAnthApiKey = process.env.ANTHROPIC_API_KEY;
    const savedAnthAuth = process.env.ANTHROPIC_AUTH_TOKEN;
    const savedAnthBase = process.env.ANTHROPIC_BASE_URL;
    const savedOaiKey = process.env.OPENAI_API_KEY;
    const savedOaiBase = process.env.OPENAI_BASE_URL;

    afterEach(() => {
      // Restore any env vars we may have toggled in these tests
      const restore = (k, v) => {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      };
      restore('ANTHROPIC_API_KEY', savedAnthApiKey);
      restore('ANTHROPIC_AUTH_TOKEN', savedAnthAuth);
      restore('ANTHROPIC_BASE_URL', savedAnthBase);
      restore('OPENAI_API_KEY', savedOaiKey);
      restore('OPENAI_BASE_URL', savedOaiBase);
    });

    it('openai provider: does not set MAX_THINKING_TOKENS even when thinkingEnabled=true', () => {
      delete process.env.VCR_MODE;
      const provider = { name: 'O', kind: 'openai', baseUrl: 'https://api.openai.com/v1', authToken: 'sk-o' };
      const env = buildSessionEnv(provider, true, 'high');
      expect(env.MAX_THINKING_TOKENS).toBeUndefined();
      expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBe('sk-o');
      expect(env.OPENAI_BASE_URL).toBe('https://api.openai.com/v1');
    });

    it('openai provider: strips ANTHROPIC_* that leaked from process.env', () => {
      process.env.ANTHROPIC_API_KEY = 'host-key';
      process.env.ANTHROPIC_AUTH_TOKEN = 'host-auth';
      process.env.ANTHROPIC_BASE_URL = 'https://host-base';
      const provider = { name: 'O', kind: 'openai', baseUrl: 'u', authToken: 'k' };
      const env = buildSessionEnv(provider, false, null);
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('anthropic provider: unchanged Claude-only behavior (regression)', () => {
      delete process.env.VCR_MODE;
      const provider = { name: 'A', kind: 'anthropic', baseUrl: 'https://test.com', authToken: 'sk-a' };
      const env = buildSessionEnv(provider, true, 'max');
      expect(env.MAX_THINKING_TOKENS).toBe('10240');
      expect(env.CLAUDE_CODE_EFFORT_LEVEL).toBe('max');
      expect(env.ANTHROPIC_API_KEY).toBe('sk-a');
      expect(env.ANTHROPIC_BASE_URL).toBe('https://test.com');
    });

    it('anthropic provider: strips stray OPENAI_* from host env', () => {
      process.env.OPENAI_API_KEY = 'host-oai';
      process.env.OPENAI_BASE_URL = 'https://host-oai-base';
      const provider = { name: 'A', kind: 'anthropic', authToken: 'sk-a' };
      const env = buildSessionEnv(provider, false, null);
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.OPENAI_BASE_URL).toBeUndefined();
    });

    it('provider=null: strips BOTH ANTHROPIC_* and OPENAI_* from host env', () => {
      process.env.ANTHROPIC_API_KEY = 'host-a';
      process.env.ANTHROPIC_AUTH_TOKEN = 'host-a-auth';
      process.env.ANTHROPIC_BASE_URL = 'https://host-a-base';
      process.env.OPENAI_API_KEY = 'host-o';
      process.env.OPENAI_BASE_URL = 'https://host-o-base';
      const env = buildSessionEnv(null, false, null);
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.OPENAI_BASE_URL).toBeUndefined();
    });
  });
});
