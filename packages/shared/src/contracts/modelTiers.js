import { z } from 'zod';

// ── Tier ref helpers ────────────────────────────────────────────────────────

export const TIER_REF_PREFIX = 'tier::';

// A model field stores either a concrete provider model id or a Model Tier
// reference. Concrete ids beginning with this prefix are therefore ambiguous
// and must never be registered in provider_models.
export const RESERVED_TIER_REF_MODEL_ID_MESSAGE =
  `Provider model IDs cannot start with the reserved "${TIER_REF_PREFIX}" prefix`;

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
  position: z.number().int().nonnegative(),
});

// Upper bound on members per tier. Tiers are an ordered failover chain, not
// an inventory: beyond this count the management payload, the tier selectors,
// and per-start resolution cost all grow without a failover-quality gain.
// Enforced at the API contract so oversized writes fail with a 400 instead of
// silently degrading runtime behavior.
export const MAX_TIER_MEMBERS = 50;

// Upper bound on tier description length. Descriptions are one-line labels
// in the management UI; the bound keeps list payloads and stored rows small.
// Enforced at the repository boundary (ModelTierRepository) so every write
// path is covered, not just Zod-validated HTTP requests.
export const MAX_TIER_DESCRIPTION_LENGTH = 2000;

const CanonicalTierMembers = z
  .array(TierMember)
  .max(MAX_TIER_MEMBERS, `A tier can have at most ${MAX_TIER_MEMBERS} members`)
  .superRefine((members, ctx) => {
    const pairs = new Set();
    for (const [index, member] of members.entries()) {
      const pair = `${member.providerId}\u0000${member.modelId}`;
      if (pairs.has(pair)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index], message: 'Duplicate tier member provider/model pair' });
      pairs.add(pair);
      if (member.position !== index) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [index, 'position'], message: 'Tier member positions must be contiguous starting at 0 and match array order' });
    }
  });

export const CreateTierRequest = z.object({
  // Trimmed so padding-only names fail min(1) and stored names never carry
  // surrounding whitespace (repository trims again as the boundary backstop).
  name: z.string().trim().min(1).max(100),
  description: z.string().nullable().optional(),
  members: CanonicalTierMembers,
});

export const UpdateTierRequest = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().nullable().optional(),
    members: CanonicalTierMembers.optional(),
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
      available: z.boolean(),
      providerEnabled: z.boolean(),
      modelEnabled: z.boolean(),
      unavailabilityReason: z.enum([
        'provider_missing',
        'provider_disabled',
        'model_missing',
        'model_disabled',
        'model_unavailable',
      ]).nullable(),
    })
  ),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const TierListResponse = z.array(TierResponse);
