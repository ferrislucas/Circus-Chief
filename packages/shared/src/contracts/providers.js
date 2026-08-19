import { z } from 'zod';

export const COMMIT_ATTRIBUTION_VALIDATION_MESSAGE =
  'Commit attribution must be in the format "Name <email@example.com>" or "Co-authored-by: Name <email@example.com>".';

const CO_AUTHOR_PREFIX_RE = /^Co-authored-by:\s*/i;
const TRAILER_RE = /^([^\n<>]+?)\s*<([^\s<>\n@]+@[^\s<>\n@]+\.[^\s<>\n@]+)>$/;

export function parseCommitAttributionOverride(value) {
  if (value === undefined || value === null) {
    return { success: true, value: null };
  }
  if (typeof value !== 'string') {
    return { success: false, error: COMMIT_ATTRIBUTION_VALIDATION_MESSAGE };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { success: true, value: null };
  }
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    return { success: false, error: COMMIT_ATTRIBUTION_VALIDATION_MESSAGE };
  }

  const withoutPrefix = trimmed.replace(CO_AUTHOR_PREFIX_RE, '').trim();
  const match = withoutPrefix.match(TRAILER_RE);
  if (!match) {
    return { success: false, error: COMMIT_ATTRIBUTION_VALIDATION_MESSAGE };
  }

  const name = match[1].trim();
  const email = match[2].trim();
  if (!name || !email) {
    return { success: false, error: COMMIT_ATTRIBUTION_VALIDATION_MESSAGE };
  }

  return { success: true, value: `Co-authored-by: ${name} <${email}>` };
}

export function normalizeCommitAttributionOverride(value) {
  const result = parseCommitAttributionOverride(value);
  if (!result.success) {
    throw new Error(result.error);
  }
  return result.value;
}

const CommitAttributionOverride = z
  .any()
  .transform((value, ctx) => {
    const result = parseCommitAttributionOverride(value);
    if (result.success) return result.value;
    ctx.addIssue({
      code: 'custom',
      message: result.error,
    });
    return z.NEVER;
  });

/**
 * Provider "kind" == wire protocol / env-var convention.
 *   'anthropic' → Claude Code SDK (ANTHROPIC_* env vars)
 *   'openai'    → OpenAI-compatible / Codex (OPENAI_* env vars)
 * Kind is **immutable after create**; switching kind invalidates the provider's
 * registered models.
 */
export const ProviderKind = z.enum(['anthropic', 'openai', 'google']);

export const CreateProviderRequest = z.object({
  name: z.string().min(1).max(100),
  kind: ProviderKind,
  baseUrl: z.string().url().nullable().optional(),
  authToken: z.string().nullable().optional(),
  apiTimeoutMs: z.number().int().positive().nullable().optional(),
  additionalEnvVars: z.record(z.string()).nullable().optional(),
  commitAttributionOverride: CommitAttributionOverride.optional(),
});

// `kind` is intentionally omitted. `.strict()` makes any extra key (including
// `kind`) reject the request at the contract boundary; the repository also
// throws at runtime as defense-in-depth.
export const UpdateProviderRequest = z
  .object({
    name: z.string().min(1).max(100).optional(),
    baseUrl: z.string().url().nullable().optional(),
    authToken: z.string().nullable().optional(),
    apiTimeoutMs: z.number().int().positive().nullable().optional(),
    additionalEnvVars: z.record(z.string()).nullable().optional(),
    commitAttributionOverride: CommitAttributionOverride.optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

// Provider and provider-model row ids are NOT always UUIDs: custom rows use
// generated UUIDs, but built-in rows use stable slug ids (e.g. provider
// `anthropic-default`, model `anthropic-opus-4-8` / `openai-gpt-5-6-sol`).
// The slugs are required so seed migrations can `INSERT OR IGNORE` idempotently
// (FRD-built-in-model-choices.md §Phase 2.6). Treat these ids as opaque
// non-empty strings, not UUIDs.
const PROVIDER_ROW_ID = z.string().min(1);

export const ProviderResponse = z.object({
  id: PROVIDER_ROW_ID,
  name: z.string(),
  kind: ProviderKind,
  baseUrl: z.string().nullable(),
  authToken: z.string().nullable(), // Will be redacted in API responses
  apiTimeoutMs: z.number().nullable(),
  additionalEnvVars: z.record(z.string()).nullable(),
  commitAttributionOverride: z.string().nullable(),
  isBuiltIn: z.boolean(),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  models: z.array(
    z.object({
      id: PROVIDER_ROW_ID,
      providerId: PROVIDER_ROW_ID,
      modelId: z.string(),
      displayName: z.string(),
      description: z.string().nullable(),
      enabled: z.boolean(),
      sortOrder: z.number().nullable(),
      lifecycle: z.enum(['current', 'older']),
      catalogManaged: z.boolean(),
      removedAt: z.number().nullable(),
      createdAt: z.number(),
    })
  ),
});

export const ProviderListResponse = z.array(ProviderResponse);

export const CreateProviderModelRequest = z.object({
  modelId: z.string().min(1),
  displayName: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().nullable().optional(),
});

export const ProviderModelResponse = z.object({
  id: PROVIDER_ROW_ID,
  providerId: PROVIDER_ROW_ID,
  modelId: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  enabled: z.boolean(),
  sortOrder: z.number().nullable(),
  lifecycle: z.enum(['current', 'older']),
  catalogManaged: z.boolean(),
  removedAt: z.number().nullable(),
  createdAt: z.number(),
});

export const ReorderProviderModelsRequest = z.object({
  order: z.array(PROVIDER_ROW_ID),
});

export const ProviderModelListResponse = z.array(ProviderModelResponse);

export const TestConnectionRequest = z.object({
  kind: ProviderKind,
  baseUrl: z.string().url().nullable().optional(),
  authToken: z.string().nullable().optional(),
  testModel: z.string().nullable().optional(),
  apiTimeoutMs: z.number().int().positive().nullable().optional(),
});

export const TestConnectionResponse = z.object({
  success: z.boolean(),
  message: z.string(),
  details: z
    .object({
      model: z.string().optional(),
      usage: z.any().optional(),
      code: z.union([z.string(), z.number()]).optional(),
      type: z.string().optional(),
    })
    .optional(),
});
