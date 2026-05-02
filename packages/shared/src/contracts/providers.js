import { z } from 'zod';

/**
 * Provider "kind" == wire protocol / env-var convention.
 *   'anthropic' → Claude Code SDK (ANTHROPIC_* env vars)
 *   'openai'    → OpenAI-compatible / Codex (OPENAI_* env vars)
 * Kind is **immutable after create**; switching kind invalidates the provider's
 * registered models.
 */
export const ProviderKind = z.enum(['anthropic', 'openai']);

export const CreateProviderRequest = z.object({
  name: z.string().min(1).max(100),
  kind: ProviderKind,
  baseUrl: z.string().url().nullable().optional(),
  authToken: z.string().nullable().optional(),
  apiTimeoutMs: z.number().int().positive().nullable().optional(),
  additionalEnvVars: z.record(z.string()).nullable().optional(),
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
  })
  .strict();

export const ProviderResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: ProviderKind,
  baseUrl: z.string().nullable(),
  authToken: z.string().nullable(), // Will be redacted in API responses
  apiTimeoutMs: z.number().nullable(),
  additionalEnvVars: z.record(z.string()).nullable(),
  isBuiltIn: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  models: z.array(
    z.object({
      id: z.string().uuid(),
      providerId: z.string().uuid(),
      modelId: z.string(),
      displayName: z.string(),
      description: z.string().nullable(),
      tier: z.enum(['opus', 'sonnet', 'haiku', 'custom']),
      createdAt: z.number(),
    })
  ),
});

export const ProviderListResponse = z.array(ProviderResponse);

export const CreateProviderModelRequest = z.object({
  modelId: z.string().min(1),
  displayName: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  tier: z.enum(['opus', 'sonnet', 'haiku', 'custom']).nullable().optional(),
});

export const ProviderModelResponse = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  modelId: z.string(),
  displayName: z.string(),
  description: z.string().nullable(),
  tier: z.string().nullable(),
  createdAt: z.number(),
});

export const ProviderModelListResponse = z.array(ProviderModelResponse);

export const TestConnectionRequest = z.object({
  kind: ProviderKind,
  baseUrl: z.string().url().nullable().optional(),
  authToken: z.string().nullable().optional(),
  defaultSonnetModel: z.string().nullable().optional(),
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
