import { isTierRef } from '@circuschief/shared';

/**
 * Format one end of a tier-failover route for the failover history view.
 *
 * Persisted failover payloads carry provider-row UUIDs (not display names)
 * and stale-fallback entries carry the raw `tier::<id>` sentinel as the
 * from-model — neither is readable, so both are translated here:
 * - a tier ref renders as `Tier: <tierName>` (falling back to `Model tier`
 *   when the entry predates tier names);
 * - otherwise the provider id resolves through `resolveProviderName`, with
 *   the raw id kept when the provider is unknown (deleted provider, or the
 *   store has not loaded yet).
 *
 * @param {{ providerId?: string|null, modelId?: string|null, tierName?: string|null }} endpoint
 * @param {(providerId: string) => string|null|undefined} [resolveProviderName]
 * @returns {string}
 */
export function formatFailoverModelLabel(
  { providerId = null, modelId = null, tierName = null } = {},
  resolveProviderName = null,
) {
  if (isTierRef(modelId)) return `Tier: ${tierName || 'Model tier'}`;
  const providerName = providerId
    ? (resolveProviderName?.(providerId) ?? providerId)
    : null;
  if (providerName && modelId) return `${providerName}/${modelId}`;
  return modelId || providerName || 'Unknown model';
}
