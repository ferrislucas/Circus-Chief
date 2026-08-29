function memberSupportsProviderKinds(member, providersStore, allowedProviderKinds) {
  const provider = providersStore.getById(member.providerId);
  return provider && allowedProviderKinds.includes(provider.kind || 'anthropic');
}

export function tierSupportsProviderKinds(tier, providersStore, allowedProviderKinds) {
  if (!tier.members?.length) return false;
  if (!allowedProviderKinds) return true;
  return tier.members.every((member) =>
    memberSupportsProviderKinds(member, providersStore, allowedProviderKinds)
  );
}

export function tierDisplayName(modelValue, tiersStore) {
  const tierId = modelValue.slice('tier::'.length);
  return tiersStore.getById(tierId)?.name || tierId;
}

export function tierIsStale(modelValue, tiersStore, visibleTiers) {
  if (tiersStore.tiers.length === 0) return false;
  const tierId = modelValue.slice('tier::'.length);
  return !visibleTiers.some((tier) => tier.id === tierId);
}

export function tierDisplayTitle(modelValue, tiersStore, stale) {
  const tierId = modelValue.slice('tier::'.length);
  const tier = tiersStore.getById(tierId);
  if (!tier) {
    return stale
      ? `Model tier "${tierId}" is no longer available — choose a replacement to update it.`
      : `Tier: ${tierId}`;
  }
  const memberCount = tier.members?.length ?? 0;
  return `Model tier "${tier.name}" — ${memberCount} member${memberCount !== 1 ? 's' : ''}`;
}
