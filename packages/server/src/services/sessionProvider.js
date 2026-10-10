import { modelProviders } from '../database.js';
import { createRobustEnv } from './nodeSpawnHelper.js';
import { isTierRef } from '@circuschief/shared';
import { resolveActiveModel } from './tierResolutionService.js';
import { validateExactTierMember } from './tierIdentity.js';

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

/**
 * Strict tier-member provider resolution — the single consumer-side identity
 * rule for tier-derived `(model, providerId)` pairs (startup failover
 * members, continuation snapshots/hints, tier-switch selections).
 *
 * Returns the owning provider ONLY on an exact ownership match (validated
 * through the shared {@link validateExactTierMember} rule: provider exists
 * and is enabled, model row present and enabled). Otherwise throws a typed
 * `TierIdentityError` — identity never falls back to a different provider by
 * model id alone, and never degrades to SDK defaults. Non-tier paths keep
 * using {@link resolveProviderFromModel} with its backward-compatible fallback.
 *
 * Identity is exact even when the runtime environment is not: a validated
 * built-in Anthropic member keeps this full provider object for dispatch and
 * metadata, while {@link buildSessionEnv} still sanitizes its environment
 * exactly like the direct SDK-default path.
 *
 * @param {string} modelId - Concrete model id from a tier member identity.
 * @param {string} providerId - The tier member's exact provider id (required).
 * @returns {Object} Provider object (including models array).
 * @throws {TierIdentityError} When the exact pair cannot be honored.
 */
export function resolveTierMemberProvider(modelId, providerId) {
  const pair = validateExactTierMember(providerId, modelId);
  return modelProviders.getById(pair.providerId);
}

/**
 * Single dispatch-site provider rule shared by session startup, continuation,
 * and attachment-bearing turns.
 *
 * Tier-derived bindings (an explicit tier-ref request, or continuing on an
 * existing tier binding) resolve STRICTLY: the hint must name the exact owner
 * or a typed `TierIdentityError` is thrown — never a cross-provider fallback,
 * never SDK defaults. All other (concrete-model) bindings keep the legacy
 * {@link resolveProviderFromModel} fallback for backward compatibility.
 *
 * @param {Object} session - Current session row (for the bound `model`).
 * @param {string|null} requestedModel - Explicit model override, if any.
 * @param {string|null} effectiveModel - Concrete model resolved for dispatch.
 * @param {string|null} providerIdHint - Provider hint from tier resolution.
 * @returns {{ provider: Object|null, providerMetadata: Object|null }}
 * @throws {TierIdentityError} For tier-derived bindings with a stale hint.
 */
export function resolveDispatchProvider(session, requestedModel, effectiveModel, providerIdHint) {
  const tierDerived = Boolean(
    (requestedModel && isTierRef(requestedModel))
    || (!requestedModel && session && isTierRef(session.model))
  );
  if (tierDerived && effectiveModel) {
    const provider = resolveTierMemberProvider(effectiveModel, providerIdHint);
    return { provider, providerMetadata: provider };
  }
  return {
    provider: resolveProviderFromModel(effectiveModel, providerIdHint),
    providerMetadata: resolveProviderMetadataFromModel(effectiveModel, providerIdHint),
  };
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
 * Durable provider identity for a dispatched concrete pair — the single rule
 * shared by initial execution and both continuation paths when recording or
 * comparing `lastExecutedProviderId`.
 *
 * Derived from provider METADATA, independently of the runtime resolver's
 * null-provider convention for the official Anthropic SDK environment: the
 * built-in Anthropic provider owns its models for identity purposes even
 * though dispatch runs it with SDK defaults. An unchanged official dispatch
 * therefore compares equal across turns and keeps its resume handle; only a
 * genuine pair change invalidates it.
 *
 * @param {string|null} modelId - Dispatched concrete model id.
 * @param {string|null} [providerIdHint] - Explicit owning provider, if any.
 * @returns {string|null} The owning provider id, or null when unknowable.
 */
export function resolveDurableProviderId(modelId, providerIdHint = null) {
  const metadata = resolveProviderMetadataFromModel(modelId, providerIdHint);
  if (metadata?.id) return metadata.id;
  return resolveProviderFromModel(modelId, providerIdHint)?.id ?? null;
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
 * Resolve the agent type for a given model ID.
 * Uses the owning provider's kind:
 *   - anthropic → claude-code
 *   - openai    → codex
 *   - google    → gemini
 *   - meta      → muse
 * Falls back to 'claude-code' for null / unknown / tier-name inputs.
 *
 * Provider-aware (Fix 1): when `providerId` is supplied and owns `modelId`,
 * the agent type is derived from THAT provider — required whenever tier
 * members can cross Anthropic/OpenAI/Google with a duplicate `modelId`.
 * @param {string|null} modelId
 * @param {string|null} [providerId] - Optional explicit provider hint
 * @returns {string} 'claude-code' | 'codex' | 'gemini' | 'muse'
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
  if (provider.kind === 'meta') return 'muse';
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
      : kind === 'meta'
        ? buildMetaProviderEnv(provider)
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

/**
 * Meta-kind provider env (v1).
 *
 * Deliberately empty: the `muse exec` child authenticates with the host's
 * own `muse auth` credentials — there is no documented `META_*` wire env
 * convention to set, and inventing one would silently do nothing. Provider
 * `additionalEnvVars` (merged by the caller) remain the escape hatch.
 * A configured `authToken`/`baseUrl` is therefore a no-op and warns loudly
 * (finding #5) instead of being silently ignored.
 */
function buildMetaProviderEnv(provider) {
  const ignored = ['authToken', 'baseUrl'].filter((key) => provider?.[key]);
  if (ignored.length > 0) {
    console.warn(
      `[SessionManager] buildProviderEnv: Provider "${provider.name}" (meta) sets ${ignored.join(' and ')} which is ignored — muse exec authenticates with the host's own muse auth credentials.`,
    );
  }
  return {};
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

  if (kind === 'meta') {
    console.log(`[SessionManager] buildProviderEnv: Provider "${provider.name}" (meta) uses host muse auth credentials.`, {
      authToken: provider.authToken ? '[SET, IGNORED]' : '[NOT SET]',
      baseUrl: provider.baseUrl || '[NOT SET]',
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
 * A validated built-in Anthropic tier member (Official Anthropic) runs with
 * SDK-default credentials/endpoints — exactly like the same model selected
 * directly, which resolves to the null provider. Strict tier identity still
 * returns the FULL provider object for dispatch and metadata; only the
 * runtime environment is sanitized, centrally, here.
 * @param {Object|null} provider - Provider object or null for agent defaults
 * @returns {boolean}
 */
function isSdkDefaultBuiltInAnthropic(provider) {
  return Boolean(provider?.isBuiltIn && (provider.kind || 'anthropic') === 'anthropic');
}

/**
 * Classify which environment policy `buildSessionEnv` applies: the
 * SDK-default strip (null provider, or a validated built-in Anthropic tier
 * member), or the per-kind policy for a configured provider.
 * @param {Object|null} provider - Provider object or null for agent defaults
 * @returns {string} 'sdk-default' | 'openai' | 'google' | 'meta' | 'anthropic'
 */
function resolveSessionEnvPolicy(provider) {
  if (!provider || isSdkDefaultBuiltInAnthropic(provider)) return 'sdk-default';
  const kind = provider.kind || 'anthropic';
  if (kind === 'openai') return 'openai';
  if (kind === 'google') return 'google';
  if (kind === 'meta') return 'meta';
  return 'anthropic';
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
 *   - provider.kind === 'google' / 'meta': same cross-kind stripping for
 *     Gemini / Muse sessions.
 *   - provider === null: strip BOTH kinds' auth/base-url vars so host env
 *     doesn't bleed into the SDK defaults.
 *   - built-in Anthropic provider (Official Anthropic tier member): same
 *     sanitization as the null-provider path, so a tier cannot route prompts
 *     to a host proxy/account while metadata claims Official Anthropic.
 *
 * @param {Object|null} provider - Provider object or null for agent defaults
 * @param {boolean} thinkingEnabled - Whether thinking mode is enabled
 * @param {string|null} effortLevel - Optional effort level
 * @param {Object} [opts] - Optional `{ shellEnv }` forwarded to createRobustEnv
 *   (fixture injection for tests; undefined runs the cached live probe).
 * @returns {Object}
 */
function shellProbeOpts(opts) {
  return opts.shellEnv !== undefined ? { shellEnv: opts.shellEnv } : {};
}

export function buildSessionEnv(provider, thinkingEnabled = false, effortLevel = null, opts = {}) {
  const baseEnv = createRobustEnv(process.env, shellProbeOpts(opts));
  const providerEnv = buildProviderEnv(provider);

  // Combine all env vars
  const sessionEnv = {
    ...baseEnv,
    ...providerEnv, // Add provider env vars (wins over host env for its own keys)
  };

  const policy = resolveSessionEnvPolicy(provider);

  if (policy === 'sdk-default') {
    stripProviderRuntimeEnv(sessionEnv);
  } else if (policy === 'openai') {
    applyOpenAISessionEnv(sessionEnv, providerEnv);
  } else if (policy === 'google') {
    applyGoogleSessionEnv(sessionEnv, providerEnv);
  } else if (policy === 'meta') {
    applyMetaSessionEnv(sessionEnv, providerEnv);
  } else {
    stripOpenAIHostEnv(sessionEnv);
    stripGoogleHostEnv(sessionEnv);
  }

  // Claude-only session env vars. Only set for Anthropic-kind providers
  // (or when no provider is configured → Claude-default flow).
  const isClaudeFlow = policy === 'sdk-default' || policy === 'anthropic';

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

function applyMetaSessionEnv(sessionEnv, providerEnv) {
  stripAnthropicHostEnv(sessionEnv);
  stripOpenAIHostEnv(sessionEnv);
  stripGoogleHostEnv(sessionEnv);
  // Apply provider-specific env vars (additionalEnvVars escape hatch)
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
