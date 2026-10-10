import { isTierRef, parseTierRef } from '@circuschief/shared';
import { isTierSelectable } from '../components/modelSelectorTiers.js';

function sameSelection(left, right) {
  return (left?.model || null) === (right?.model || null)
    && (left?.providerId ?? null) === (right?.providerId ?? null);
}

/**
 * Reconcile just the atomic provider/model pair. A concurrent local model
 * edit wins and is reported to the caller; unrelated fields are never read or
 * changed, so a server-side tier degradation cannot discard unsaved form work.
 */
/**
 * Normalize one form/canonical value for comparison: `undefined` and `''`
 * both mean "unset" across these editors (every save path maps them to
 * null/undefined), while `false` and `0` stay meaningful values.
 */
function normalizeFieldValue(value) {
  return value === undefined || value === '' ? null : value;
}

/**
 * Per-field reconciliation for non-model form fields — the replacement for
 * the old all-or-nothing first-load latches. For every field of `canonical`:
 *
 * - the local value still equals the previously applied canonical value
 *   (or there is no previous snapshot yet): adopt the new canonical value,
 *   so external changes surface without reload;
 * - the local value diverges AND upstream moved since the snapshot: keep
 *   the local edit and report the field in `conflicts`;
 * - the local value diverges but upstream is static: keep the local edit
 *   silently (no false conflict for an edit nobody raced).
 *
 * `previousCanonical` must hold the last APPLIED (form-normalized) values,
 * not the raw server record — capture it right after applying, the way the
 * model pair tracks `lastCanonicalSelection`.
 *
 * @param {{ current: Object, previousCanonical: Object|null, canonical: Object }} args
 * @returns {{ values: Object, conflicts: Array<string>, conflict: boolean }}
 */
export function reconcileFormFields({ current, previousCanonical, canonical }) {
  const values = {};
  const conflicts = [];
  for (const field of Object.keys(canonical || {})) {
    const prev = normalizeFieldValue(previousCanonical?.[field]);
    const next = normalizeFieldValue(canonical?.[field]);
    const cur = normalizeFieldValue(current?.[field]);
    if (previousCanonical == null || Object.is(cur, prev)) {
      values[field] = next;
    } else if (Object.is(prev, next)) {
      values[field] = cur;
    } else {
      values[field] = cur;
      conflicts.push(field);
    }
  }
  return { values, conflicts, conflict: conflicts.length > 0 };
}

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
function describeTierProblem(modelValue, tiers, { providers, providersLoaded, allowedProviderKinds }) {
  const tierId = parseTierRef(modelValue);
  const tier = tiers.find((entry) => entry?.id === tierId);
  if (!tier) {
    return {
      code: 'tier-missing',
      message: 'The selected tier no longer exists. Choose a current tier or clear the selection.',
    };
  }
  // A kind-restricted judgement needs the providers half of the catalog;
  // without it the kind fit is unprovable, so stay permissive (same
  // unjudgeable-while-loading rule as the concrete path below).
  if (allowedProviderKinds && !providersLoaded) return null;
  // Judge against the SAME selectable set the selector shows (see
  // isTierSelectable): a tier the picker hides — zero usable members, or no
  // member fitting the picker's kind restriction — blocks submission too.
  if (!isTierSelectable(tier, { providers, allowedProviderKinds })) {
    return {
      code: 'tier-unusable',
      message: 'The selected tier currently has no usable models. Choose a current tier or clear the selection.',
    };
  }
  return null;
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
  { tiers = [], tiersLoaded = false, providers = [], providersLoaded = false, allowedProviderKinds = null } = {}
) {
  const modelValue = model || null;
  if (!modelValue) return null;

  if (isTierRef(modelValue)) {
    if (!tiersLoaded) return null;
    return describeTierProblem(modelValue, tiers, { providers, providersLoaded, allowedProviderKinds });
  }

  if (providerId == null || !providersLoaded) return null;
  return describeConcreteProblem(modelValue, providerId, providers);
}

/**
 * The single shared "is this selection submittable" predicate. The selector
 * judges through `isTierSelectable` / `isValidModelId` and every guarded
 * save path judges through this function — both bottom out in
 * `isTierSelectable`, so the guard and the selector cannot drift apart again.
 * Returns true while the selection is submittable OR unjudgeable (catalog
 * half still loading / empty concrete hint); false only for a proven problem.
 */
export function isSelectionSubmittable(selection, catalog) {
  return describeSelectionProblem(selection, catalog) === null;
}
