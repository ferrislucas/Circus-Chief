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
  const env = {};

  if (kind === 'openai') {
    if (provider.baseUrl) {
      env.OPENAI_BASE_URL = provider.baseUrl;
    }
    if (provider.authToken) {
      env.OPENAI_API_KEY = provider.authToken;
    }
    // No tier → model env var convention for OpenAI. Users can express
    // per-role model overrides via additionalEnvVars if needed.
  } else {
    // 'anthropic' (default)
    if (provider.baseUrl) {
      env.ANTHROPIC_BASE_URL = provider.baseUrl;
    }
    if (provider.authToken) {
      // Set BOTH ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN
      // The SDK prioritizes ANTHROPIC_API_KEY, so we must set it to override
      // any user's existing ANTHROPIC_API_KEY in their environment
      env.ANTHROPIC_API_KEY = provider.authToken;
      env.ANTHROPIC_AUTH_TOKEN = provider.authToken;
    }

    // Derive default model env vars from provider_models by tier
    if (Array.isArray(provider.models)) {
      const opusModel = provider.models.find((m) => m.tier === 'opus');
      if (opusModel) env.ANTHROPIC_DEFAULT_OPUS_MODEL = opusModel.modelId;

      const sonnetModel = provider.models.find((m) => m.tier === 'sonnet');
      if (sonnetModel) env.ANTHROPIC_DEFAULT_SONNET_MODEL = sonnetModel.modelId;

      const haikuModel = provider.models.find((m) => m.tier === 'haiku');
      if (haikuModel) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = haikuModel.modelId;
    }
  }

  if (provider.apiTimeoutMs) {
    env.API_TIMEOUT_MS = String(provider.apiTimeoutMs);
  }

  // Parse additional env vars (applied last so users can override anything above)
  if (provider.additionalEnvVars) {
    Object.assign(env, provider.additionalEnvVars);
  }

  if (kind === 'openai') {
    console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (openai) env vars:`, {
      OPENAI_BASE_URL: env.OPENAI_BASE_URL,
      OPENAI_API_KEY: env.OPENAI_API_KEY ? '[SET]' : '[NOT SET]',
      API_TIMEOUT_MS: env.API_TIMEOUT_MS,
    });
  } else {
    console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (anthropic) env vars:`, {
      ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? '[SET]' : '[NOT SET]',
      ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? '[SET]' : '[NOT SET]',
      ANTHROPIC_DEFAULT_SONNET_MODEL: env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    });
  }

  return env;
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
    // No custom provider: strip BOTH kinds' auth/base-url vars from the
    // composed env so host env vars can't bleed into the SDK defaults.
    delete sessionEnv.ANTHROPIC_API_KEY;
    delete sessionEnv.ANTHROPIC_AUTH_TOKEN;
    delete sessionEnv.ANTHROPIC_BASE_URL;
    delete sessionEnv.OPENAI_API_KEY;
    delete sessionEnv.OPENAI_BASE_URL;
  } else if (kind === 'openai') {
    // OpenAI-kind provider: don't let any host ANTHROPIC_* leak through.
    // (providerEnv for openai kind never sets ANTHROPIC_*, so anything
    // present here came from process.env via createRobustEnv.)
    delete sessionEnv.ANTHROPIC_API_KEY;
    delete sessionEnv.ANTHROPIC_AUTH_TOKEN;
    delete sessionEnv.ANTHROPIC_BASE_URL;

    // The provider database is the single source of truth for auth.
    // When the provider doesn't set OPENAI_API_KEY, the Codex CLI should
    // use its own auth (e.g. ChatGPT OAuth from ~/.codex/auth.json).
    // Rather than trying to blacklist individual OPENAI_* vars (which
    // risks missing current or future vars the CLI inspects), we whitelist
    // only the essential vars — mirroring the working `env -i HOME=$HOME
    // PATH=$PATH codex exec ...` invocation.
    if (!providerEnv.OPENAI_API_KEY) {
      const allowed = ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'TMPDIR'];
      const cleaned = {};
      for (const key of allowed) {
        if (sessionEnv[key] !== undefined) cleaned[key] = sessionEnv[key];
      }
      // Carry through anything providerEnv explicitly set (additionalEnvVars, etc.)
      Object.assign(cleaned, providerEnv);
      // Replace sessionEnv with the whitelisted version
      for (const key of Object.keys(sessionEnv)) {
        delete sessionEnv[key];
      }
      Object.assign(sessionEnv, cleaned);
    } else {
      // Provider explicitly set an API key — still strip stray base URL
      // vars from host env if provider didn't set them.
      if (!providerEnv.OPENAI_BASE_URL && !providerEnv.OPENAI_API_BASE) {
        delete sessionEnv.OPENAI_BASE_URL;
        delete sessionEnv.OPENAI_API_BASE;
      }
    }
  } else {
    // Anthropic-kind provider: symmetrically strip any stray OPENAI_* from host
    // env so they can't confuse the Claude SDK or downstream tooling.
    delete sessionEnv.OPENAI_API_KEY;
    delete sessionEnv.OPENAI_BASE_URL;
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
