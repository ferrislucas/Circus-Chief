import { computed, reactive } from 'vue';
import { useProvidersStore } from '../stores/providers.js';
import { useTiersStore } from '../stores/tiers.js';
import { describeSelectionProblem } from './modelSelectionReconciliation.js';

/**
 * Shared catalog-selection reconciliation for the model/tier editors
 * (project defaults, template detail, summary settings).
 *
 * Judges the editor's current `{ model, providerId }` selection against the
 * CURRENT catalog and owns the conflict contract every editor shares:
 *
 * - `problem` — null while the selection is submittable (or unjudgeable
 *   because its catalog half is still loading); otherwise the reason saving
 *   is blocked.
 * - `invalid` — whether submission must be blocked right now.
 * - `showBanner` — conflict, invalid selection, or both.
 * - `keepMine()` — dismisses a pure conflict, but never an invalid
 *   selection: the banner (and the submit block) stays until the user picks
 *   a current value or clears the selection.
 *
 * @param {() => { model: string|null, providerId: string|null }} readSelection
 * @param {() => boolean} isConflicted - Reads the editor's conflict flag.
 * @param {() => void} clearConflict - Clears the editor's conflict flag.
 */
export function useSelectionGuard(readSelection, isConflicted, clearConflict) {
  const tiersStore = useTiersStore();
  const providersStore = useProvidersStore();

  const problem = computed(() => describeSelectionProblem(readSelection(), {
    tiers: tiersStore.tiers,
    tiersLoaded: tiersStore.loaded,
    providers: providersStore.providers,
    providersLoaded: providersStore.loaded,
  }));
  const invalid = computed(() => problem.value !== null);
  const showBanner = computed(() => isConflicted() || invalid.value);

  function keepMine() {
    if (invalid.value) return;
    clearConflict();
  }

  // Reactive so both template expressions (`selectionGuard.invalid`) and
  // script reads unwrap the underlying computed refs.
  return reactive({ problem, invalid, showBanner, keepMine });
}
