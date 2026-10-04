import { isTierRef, parseTierRef } from '@circuschief/shared';

function sameSelection(left, right) {
  return (left?.model || null) === (right?.model || null)
    && (left?.providerId ?? null) === (right?.providerId ?? null);
}

/**
 * Reconcile just the atomic provider/model pair. A concurrent local model
 * edit wins and is reported to the caller; unrelated fields are never read or
 * changed, so a server-side tier degradation cannot discard unsaved form work.
 */
export function reconcileModelSelection({ current, previousCanonical, canonical }) {
  const localSelection = { model: current?.model || null, providerId: current?.providerId ?? null };
  const canonicalSelection = { model: canonical?.model || null, providerId: canonical?.providerId ?? null };
  if (!sameSelection(localSelection, previousCanonical)) {
    return { ...localSelection, conflict: !sameSelection(localSelection, canonicalSelection) };
  }
  return { ...canonicalSelection, conflict: false };
}

/**
 * Judge a provider/model selection against the CURRENT catalog. Returns null
 * when the selection is submittable (or cannot be judged yet), otherwise a
 * `{ code, message }` problem describing why submission must be blocked:
 *
 * - `tier-missing` — the tier ref names a tier that no longer exists;
 * - `provider-missing` / `provider-disabled` — the concrete pair's provider
 *   is gone or disabled;
 * - `model-missing` / `model-disabled` — the provider no longer lists the
 *   model, or lists it as disabled.
 *
 * An empty selection (inherit / system default), a concrete model without a
 * provider hint, and any selection judged while its catalog half is still
 * loading are unjudgeable — returning a problem there would block valid
 * submissions on incomplete data.
 */
function describeTierProblem(modelValue, tiers) {
  const tierId = parseTierRef(modelValue);
  if (tiers.some((tier) => tier?.id === tierId)) return null;
  return {
    code: 'tier-missing',
    message: 'The selected tier no longer exists. Choose a current tier or clear the selection.',
  };
}

function describeModelProblem(modelValue, provider) {
  const entry = provider.models?.find((modelEntry) => modelEntry?.modelId === modelValue);
  if (!entry) {
    return {
      code: 'model-missing',
      message: 'The selected model is no longer offered by its provider. Choose a current model.',
    };
  }
  if (entry.enabled === false || entry.unavailable === true) {
    return {
      code: 'model-disabled',
      message: 'The selected model is currently unavailable. Choose a current model.',
    };
  }
  return null;
}

function describeConcreteProblem(modelValue, providerId, providers) {
  const provider = providers.find((entry) => entry?.id === providerId);
  if (!provider) {
    return {
      code: 'provider-missing',
      message: 'The selected provider no longer exists. Choose a current model or clear the selection.',
    };
  }
  if (provider.enabled === false) {
    return {
      code: 'provider-disabled',
      message: 'The selected provider is currently disabled. Re-enable it or choose another model.',
    };
  }
  return describeModelProblem(modelValue, provider);
}

export function describeSelectionProblem(
  { model, providerId },
  { tiers = [], tiersLoaded = false, providers = [], providersLoaded = false } = {}
) {
  const modelValue = model || null;
  if (!modelValue) return null;

  if (isTierRef(modelValue)) {
    if (!tiersLoaded) return null;
    return describeTierProblem(modelValue, tiers);
  }

  if (providerId == null || !providersLoaded) return null;
  return describeConcreteProblem(modelValue, providerId, providers);
}
