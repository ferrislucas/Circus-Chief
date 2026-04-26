import { modelProviders } from '../database.js';
import { createRobustEnv } from './nodeSpawnHelper.js';

/**
 * Resolve the provider for a given model ID
 * Looks up which provider owns the model, or returns null for Anthropic defaults
 * @param {string|null} modelId - The model ID to look up
 * @returns {Object|null} Provider object or null if using Anthropic default
 */
export function resolveProviderFromModel(modelId) {
  return modelProviders.getProviderByModelId(modelId);
}

/**
 * Resolve the agent type (claude-code vs codex) for a given model ID.
 * Uses the owning provider's kind:
 *   - anthropic → claude-code
 *   - openai    → codex
 * Falls back to 'claude-code' for null / unknown / tier-name inputs.
 * @param {string|null} modelId
 * @returns {string} 'claude-code' | 'codex'
 */
export function resolveAgentTypeFromModel(modelId) {
  if (!modelId) return 'claude-code';
  const provider = modelProviders.getProviderByModelId(modelId);
  if (!provider) return 'claude-code';
  if (typeof modelProviders.getAgentTypeForProvider === 'function') {
    const agentType = modelProviders.getAgentTypeForProvider(provider.id);
    return agentType || 'claude-code';
  }
  // Fallback for test doubles that don't implement getAgentTypeForProvider:
  // derive from kind directly.
  if (provider.kind === 'openai') return 'codex';
  return 'claude-code';
}

/**
 * Build environment variables from provider configuration.
 * Branches on provider.kind so Anthropic-kind and OpenAI-kind providers
 * emit only their own wire-protocol env vars (no cross-kind leaks).
 * Providers without a `kind` field default to Anthropic behavior for
 * backward compatibility.
 * @param {Object|null} provider - Provider object
 * @returns {Object} Environment variables to add to session env
 */
export function buildProviderEnv(provider) {
  if (!provider) {
    console.log('[SessionManager] buildProviderEnv: No provider, using SDK defaults');
    return {}; // Use SDK defaults
  }

  const kind = provider.kind || 'anthropic';
  const env = kind === 'openai'
    ? buildOpenAIProviderEnv(provider)
    : buildAnthropicProviderEnv(provider);

  if (provider.apiTimeoutMs) {
    env.API_TIMEOUT_MS = String(provider.apiTimeoutMs);
  }

  // Parse additional env vars (applied last so users can override anything above)
  if (provider.additionalEnvVars) {
    Object.assign(env, provider.additionalEnvVars);
  }

  logProviderEnv(provider, kind, env);

  return env;
}

function buildOpenAIProviderEnv(provider) {
  const env = {};
  if (provider.baseUrl) env.OPENAI_BASE_URL = provider.baseUrl;
  if (provider.authToken) env.OPENAI_API_KEY = provider.authToken;
  return env;
}

function buildAnthropicProviderEnv(provider) {
  const env = {};
  if (provider.baseUrl) env.ANTHROPIC_BASE_URL = provider.baseUrl;
  if (provider.authToken) {
    env.ANTHROPIC_API_KEY = provider.authToken;
    env.ANTHROPIC_AUTH_TOKEN = provider.authToken;
  }
  addAnthropicModelEnv(env, provider.models);
  return env;
}

function addAnthropicModelEnv(env, models) {
  if (!Array.isArray(models)) return;
  const target = env;
  const tiers = {
    opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  };
  for (const [tier, envKey] of Object.entries(tiers)) {
    const model = models.find((entry) => entry.tier === tier);
    if (model) target[envKey] = model.modelId;
  }
}

function logProviderEnv(provider, kind, env) {
  if (kind === 'openai') {
    console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (openai) env vars:`, {
      OPENAI_BASE_URL: env.OPENAI_BASE_URL,
      OPENAI_API_KEY: env.OPENAI_API_KEY ? '[SET]' : '[NOT SET]',
      API_TIMEOUT_MS: env.API_TIMEOUT_MS,
    });
    return;
  }

  console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (anthropic) env vars:`, {
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? '[SET]' : '[NOT SET]',
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? '[SET]' : '[NOT SET]',
    ANTHROPIC_DEFAULT_SONNET_MODEL: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
  });
}

/**
 * Build environment variables for the agent runtime based on provider and session settings.
 * Always returns a robust env with Node in PATH to prevent ENOENT errors.
 *
 * Kind-aware behavior:
 *   - provider.kind === 'anthropic' (or legacy/unspecified): keeps today's behavior
 *     (MAX_THINKING_TOKENS + CLAUDE_CODE_EFFORT_LEVEL are applied as before).
 *   - provider.kind === 'openai': Claude-only envs (MAX_THINKING_TOKENS,
 *     CLAUDE_CODE_EFFORT_LEVEL) are NOT set, and any ANTHROPIC_* vars from
 *     process.env are stripped so Claude env doesn't leak into Codex sessions.
 *   - provider === null: strip BOTH kinds' auth/base-url vars so host env
 *     doesn't bleed into the SDK defaults.
 *
 * @param {Object|null} provider - Provider object or null for agent defaults
 * @param {boolean} thinkingEnabled - Whether thinking mode is enabled
 * @param {string|null} effortLevel - Optional effort level
 * @returns {Object}
 */
export function buildSessionEnv(provider, thinkingEnabled = false, effortLevel = null) {
  const baseEnv = createRobustEnv(process.env);
  const providerEnv = buildProviderEnv(provider);

  // Combine all env vars
  const sessionEnv = {
    ...baseEnv,
    ...providerEnv, // Add provider env vars (wins over host env for its own keys)
  };

  const kind = provider?.kind || (provider ? 'anthropic' : null);

  if (!provider) {
    stripProviderRuntimeEnv(sessionEnv);
  } else if (kind === 'openai') {
    applyOpenAISessionEnv(sessionEnv, providerEnv);
  } else {
    stripOpenAIHostEnv(sessionEnv);
  }

  // Claude-only session env vars. Only set for Anthropic-kind providers
  // (or when no provider is configured → Claude-default flow).
  const isClaudeFlow = !provider || kind === 'anthropic';

  if (isClaudeFlow) {
    // Add thinking tokens if enabled (but suppress in VCR mode to minimize cost)
    if (thinkingEnabled && !process.env.VCR_MODE) {
      sessionEnv.MAX_THINKING_TOKENS = '10240';
    }

    // Set effort level if provided
    if (effortLevel) {
      sessionEnv.CLAUDE_CODE_EFFORT_LEVEL = effortLevel;
    }
  }

  return sessionEnv;
}

function stripProviderRuntimeEnv(env) {
  const target = env;
  delete target.ANTHROPIC_API_KEY;
  delete target.ANTHROPIC_AUTH_TOKEN;
  delete target.ANTHROPIC_BASE_URL;
  delete target.OPENAI_API_KEY;
  delete target.OPENAI_BASE_URL;
}

function applyOpenAISessionEnv(sessionEnv, providerEnv) {
  stripAnthropicHostEnv(sessionEnv);
  if (!providerEnv.OPENAI_API_KEY) {
    replaceWithCodexCliEnv(sessionEnv, providerEnv);
    return;
  }
  stripOpenAIBaseUrlUnlessProvided(sessionEnv, providerEnv);
}

function stripAnthropicHostEnv(env) {
  const target = env;
  delete target.ANTHROPIC_API_KEY;
  delete target.ANTHROPIC_AUTH_TOKEN;
  delete target.ANTHROPIC_BASE_URL;
}

function replaceWithCodexCliEnv(sessionEnv, providerEnv) {
  const target = sessionEnv;
  const allowed = ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'TMPDIR'];
  const cleaned = {};
  for (const key of allowed) {
    if (target[key] !== undefined) cleaned[key] = target[key];
  }
  Object.assign(cleaned, providerEnv);
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, cleaned);
}

function stripOpenAIBaseUrlUnlessProvided(sessionEnv, providerEnv) {
  if (providerEnv.OPENAI_BASE_URL || providerEnv.OPENAI_API_BASE) return;
  const target = sessionEnv;
  delete target.OPENAI_BASE_URL;
  delete target.OPENAI_API_BASE;
}

function stripOpenAIHostEnv(env) {
  const target = env;
  delete target.OPENAI_API_KEY;
  delete target.OPENAI_BASE_URL;
}
