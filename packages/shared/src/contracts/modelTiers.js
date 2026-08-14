import { z } from 'zod';

// ── Tier ref helpers ────────────────────────────────────────────────────────

export const TIER_REF_PREFIX = 'tier::';

/**
 * Check whether a string is a tier reference sentinel.
 * @param {string|null|undefined} v
 * @returns {boolean}
 */
export function isTierRef(v) {
  return typeof v === 'string' && v.startsWith(TIER_REF_PREFIX);
}

/**
 * Extract the tier ID from a tier ref string.
 * @param {string|null|undefined} v
 * @returns {string|null}
 */
export function parseTierRef(v) {
  if (!isTierRef(v)) return null;
  const id = v.slice(TIER_REF_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * Build a tier ref sentinel from a tier id.
 * @param {string} id
 * @returns {string}
 */
export function buildTierRef(id) {
  return `${TIER_REF_PREFIX}${id}`;
}

// ── Zod schemas ─────────────────────────────────────────────────────────────

export const TierMember = z.object({
  // Provider ids are opaque identifiers, not guaranteed UUIDs — built-in
  // providers are seeded with fixed ids ("anthropic-default", "openai-default",
  // "google-default"; see seedBaselineData.js), while user-added providers get
  // UUIDs. Only non-empty is required here.
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  position: z.number().int(),
});

export const CreateTierRequest = z.object({
  name: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  members: z.array(TierMember),
});

export const UpdateTierRequest = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().nullable().optional(),
    members: z.array(TierMember).optional(),
  })
  .strict();

export const TierResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  members: z.array(
    z.object({
      id: z.string().uuid(),
      tierId: z.string().uuid(),
      // Same relaxation as TierMember.providerId above.
      providerId: z.string().min(1),
      modelId: z.string(),
      position: z.number().int(),
      createdAt: z.number(),
    })
  ),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const TierListResponse = z.array(TierResponse);
