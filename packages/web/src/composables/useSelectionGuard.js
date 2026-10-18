import { computed, reactive } from 'vue';
import { useProvidersStore } from '../stores/providers.js';
import { useTiersStore } from '../stores/tiers.js';
import { describeSelectionProblem, isSelectionSubmittable } from './modelSelectionReconciliation.js';

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
 * Adoption map (Phase C parity — every model/tier-bearing save surface is
 * either guarded here or explicitly exempt):
 * - GUARDED: ProjectSessionDefaults, TemplateDetailView, SummarySettingsView,
 *   SchedulingEditModal, LaneSettingsModal, TemplatesPanel — banner +
 *   submit-block via this composable.
 * - EXEMPT (live/transient pickers, no save of a stored binding): InputForm
 *   (per-message override on a live session), ConversationTab session picker
 *   (live model switch on a running session), SessionFormOptions /
 *   NewSessionView (creation-time pickers — the server validates tier refs
 *   at write time per model-validation.js and rejects unknown/emptied tiers
 *   with a clear error, so creation is never silently misbound).
 *   SessionFormOptions embedded in LaneSettingsModal is covered by the
 *   owner's guard instead of its own.
 * - ModelSelector itself stays a pure picker: it surfaces staleness inline
 *   (disabled stale option + titles) and judges through isTierSelectable,
 *   the same predicate this guard bottoms out in.
 *
 * @param {() => { model: string|null, providerId: string|null }} readSelection
 * @param {() => boolean} isConflicted - Reads the editor's conflict flag.
 * @param {() => void} clearConflict - Clears the editor's conflict flag.
 * @param {{ allowedProviderKinds?: Array<string>|null }} [options] - Must
 *   mirror the owning picker's kind restriction so guard and selector judge
 *   the same selectable set.
 */
export function useSelectionGuard(readSelection, isConflicted, clearConflict, options = {}) {
  const tiersStore = useTiersStore();
  const providersStore = useProvidersStore();

  // One catalog object feeds both the problem description and the shared
  // submittable predicate, so the message and the submit-block cannot drift.
  const catalog = computed(() => ({
    tiers: tiersStore.tiers,
    tiersLoaded: tiersStore.loaded,
    providers: providersStore.providers,
    providersLoaded: providersStore.loaded,
    allowedProviderKinds: options.allowedProviderKinds ?? null,
  }));
  const problem = computed(() => describeSelectionProblem(readSelection(), catalog.value));
  const invalid = computed(() => !isSelectionSubmittable(readSelection(), catalog.value));
  const showBanner = computed(() => isConflicted() || invalid.value);

  function keepMine() {
    if (invalid.value) return;
    clearConflict();
  }

  // Reactive so both template expressions (`selectionGuard.invalid`) and
  // script reads unwrap the underlying computed refs.
  return reactive({ problem, invalid, showBanner, keepMine });
}
