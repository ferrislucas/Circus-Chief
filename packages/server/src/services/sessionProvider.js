import { modelProviders } from '../database.js';
import { createRobustEnv } from './nodeSpawnHelper.js';
import { isTierRef } from '@circuschief/shared';
import { resolveActiveModel } from './tierResolutionService.js';

/**
 * Resolve the explicit provider named by `providerId`, but only when it
 * actually owns `modelId`. Used to disambiguate duplicate model ids across
 * providers (e.g. a tier with two members that share the same `modelId` but
 * belong to different providers/agent kinds). Returns null when `providerId`
 * is absent, unknown, or doesn't own the model — callers should fall back to
 * the plain model-id lookup in that case.
 * @param {string} modelId
 * @param {string|null|undefined} providerId
 * @returns {Object|null}
 */
function resolveExplicitOwningProvider(modelId, providerId) {
  if (!providerId) return null;
  const provider = modelProviders.getById(providerId);
  if (!provider) return null;
  const ownsModel = provider.models?.some((model) => model.modelId === modelId);
  return ownsModel ? provider : null;
}

/**
 * Resolve the provider for a given model ID
 * Looks up which provider owns the model, or returns null for Anthropic defaults
 *
 * Provider-aware (Fix 1): when `providerId` is supplied, resolve that provider
 * explicitly and verify it owns `modelId` — this disambiguates the same
 * `modelId` registered under two different providers (e.g. a tier member).
 * When `providerId` is absent, or doesn't own the model, falls back to the
 * existing model-id lookup for backward compatibility.
 * @param {string|null} modelId - The model ID to look up
 * @param {string|null} [providerId] - Optional explicit provider hint
 * @returns {Object|null} Provider object or null if using Anthropic default
 */
export function resolveProviderFromModel(modelId, providerId = null) {
  const explicit = resolveExplicitOwningProvider(modelId, providerId);
  if (explicit) {
    // Preserve the built-in-Anthropic-falls-through-to-SDK-defaults convention.
    if (explicit.isBuiltIn && explicit.kind === 'anthropic') return null;
    return explicit;
  }
  return modelProviders.getProviderByModelId(modelId);
}

export function resolveProviderMetadataFromModel(modelId, providerId = null) {
  const explicit = resolveExplicitOwningProvider(modelId, providerId);
  if (explicit) return explicit;
  if (!modelId) {
    return modelProviders.getById?.('anthropic-default') || null;
  }
  if (typeof modelProviders.getProviderMetadataByModelId === 'function') {
    return modelProviders.getProviderMetadataByModelId(modelId);
  }
  return modelProviders.getProviderByModelId(modelId);
}

/**
 * Resolve the commit-attribution override for a model field that may be a
 * Model Tier reference (Work Item 5). A raw `tier::<id>` sentinel owns no
 * provider itself — passing it straight to {@link resolveProviderMetadataFromModel}
 * would silently fail to find an owning provider and fall through to the
 * Anthropic default's metadata, which is wrong whenever the tier's actual
 * active member belongs to a different provider (e.g. an OpenAI/Google tier
 * member). This helper resolves the tier to its currently active member
 * first — via the same resolver used by start/continue execution — before
 * looking up commit-attribution metadata, so worktree setup for a
 * tier-bound session/template/lane always uses the correct member's
 * provider metadata.
 *
 * @param {string|null|undefined} modelOrRef - A concrete model id or a tier ref.
 * @returns {string|null} The commit-attribution override, or null.
 */
export function resolveCommitAttributionOverrideForModel(modelOrRef) {
  if (!isTierRef(modelOrRef)) {
    return resolveProviderMetadataFromModel(modelOrRef)?.commitAttributionOverride ?? null;
  }
  const resolved = resolveActiveModel(modelOrRef, {});
  if (!resolved) return null;
  return resolveProviderMetadataFromModel(resolved.model, resolved.providerId)?.commitAttributionOverride ?? null;
}

/**
 * Resolve the agent type (claude-code vs codex vs gemini) for a given model ID.
 * Uses the owning provider's kind:
 *   - anthropic → claude-code
 *   - openai    → codex
 *   - google    → gemini
 * Falls back to 'claude-code' for null / unknown / tier-name inputs.
 *
 * Provider-aware (Fix 1): when `providerId` is supplied and owns `modelId`,
 * the agent type is derived from THAT provider — required whenever tier
 * members can cross Anthropic/OpenAI/Google with a duplicate `modelId`.
 * @param {string|null} modelId
 * @param {string|null} [providerId] - Optional explicit provider hint
 * @returns {string} 'claude-code' | 'codex' | 'gemini'
 */
export function resolveAgentTypeFromModel(modelId, providerId = null) {
  if (!modelId) return 'claude-code';
  const provider = resolveExplicitOwningProvider(modelId, providerId) || modelProviders.getProviderByModelId(modelId);
  if (!provider) return 'claude-code';
  if (typeof modelProviders.getAgentTypeForProvider === 'function') {
    const agentType = modelProviders.getAgentTypeForProvider(provider.id);
    return agentType || 'claude-code';
  }
  // Fallback for test doubles that don't implement getAgentTypeForProvider:
  // derive from kind directly.
  if (provider.kind === 'openai') return 'codex';
  if (provider.kind === 'google') return 'gemini';
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
    : kind === 'google'
      ? buildGoogleProviderEnv(provider)
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

function buildGoogleProviderEnv(provider) {
  const env = {};
  if (provider.authToken) env.GEMINI_API_KEY = provider.authToken;
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
    fable: 'ANTHROPIC_DEFAULT_FABLE_MODEL',
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

  if (kind === 'google') {
    console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (google) env vars:`, {
      GEMINI_API_KEY: env.GEMINI_API_KEY ? '[SET]' : '[NOT SET]',
      API_TIMEOUT_MS: env.API_TIMEOUT_MS,
    });
    return;
  }

  console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (anthropic) env vars:`, {
    ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY ? '[SET]' : '[NOT SET]',
    ANTHROPIC_AUTH_TOKEN: env.ANTHROPIC_AUTH_TOKEN ? '[SET]' : '[NOT SET]',
    ANTHROPIC_DEFAULT_FABLE_MODEL: env.ANTHROPIC_DEFAULT_FABLE_MODEL,
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
  } else if (kind === 'google') {
    applyGoogleSessionEnv(sessionEnv, providerEnv);
  } else {
    stripOpenAIHostEnv(sessionEnv);
    stripGoogleHostEnv(sessionEnv);
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
  delete target.GEMINI_API_KEY;
  delete target.GOOGLE_CLOUD_PROJECT;
  delete target.GOOGLE_CLOUD_LOCATION;
  delete target.GOOGLE_GENAI_USE_VERTEXAI;
}

function applyGoogleSessionEnv(sessionEnv, providerEnv) {
  stripAnthropicHostEnv(sessionEnv);
  stripOpenAIHostEnv(sessionEnv);
  // Apply provider-specific env vars
  Object.assign(sessionEnv, providerEnv);
}

function applyOpenAISessionEnv(sessionEnv, providerEnv) {
  stripAnthropicHostEnv(sessionEnv);
  stripGoogleHostEnv(sessionEnv);
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
  delete target.OPENAI_API_KEY;
  delete target.OPENAI_BASE_URL;
  delete target.OPENAI_API_BASE;
  delete target.OPENAI_ORG_ID;
  delete target.OPENAI_PROJECT;
  Object.assign(target, providerEnv);
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

function stripGoogleHostEnv(env) {
  const target = env;
  delete target.GEMINI_API_KEY;
  delete target.GOOGLE_CLOUD_PROJECT;
  delete target.GOOGLE_CLOUD_LOCATION;
  delete target.GOOGLE_GENAI_USE_VERTEXAI;
}
