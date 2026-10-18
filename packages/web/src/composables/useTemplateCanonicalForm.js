import { ref } from 'vue';
import { reconcileFormFields, reconcileModelSelection } from './modelSelectionReconciliation.js';

/**
 * Canonical template-form sync for TemplateDetailView: snapshot conversion,
 * per-field convergence, and the conflict flag folded into the shared
 * selection-guard contract.
 *
 * Extracted from TemplateDetailView.vue to keep the component under the
 * project's file-size lint budget; behavior is unchanged. Operates on the
 * caller's form ref in place (named `formState` so the param-reassign lint
 * exemption for form mutations applies).
 *
 * @param {import('vue').Ref<Object>} formState - Template form data ref.
 * @returns {{ conflict: import('vue').Ref<boolean>, applyCanonicalTemplate: Function, useCanonicalModelSelection: Function, clearConflict: Function }}
 */
export function useTemplateCanonicalForm(formState) {
  const conflict = ref(false);
  let lastCanonicalSelection = { model: null, providerId: null };
  let lastCanonicalFields = null;

  function toFormData(template) {
    return {
      name: template.name,
      prompt: template.prompt,
      isGlobal: !template.projectId,
      nextTemplateId: template.nextTemplateId ?? null,
      thinkingEnabled: template.thinkingEnabled,
      gitBranch: template.gitBranch || '',
      model: template.model,
      providerId: template.providerId ?? null,
      mode: template.mode,
      effortLevel: template.effortLevel ?? null,
      showInQuickResponses: template.showInQuickResponses,
    };
  }

  function splitCanonicalForm(canonical) {
    const { model, providerId, ...fields } = canonical;
    return { selection: { model, providerId }, fields };
  }

  function applyCanonicalTemplate(template, { preserveEdits = false } = {}) {
    if (!template) return;
    const canonical = toFormData(template);
    const { selection: canonicalSelection, fields: canonicalFields } = splitCanonicalForm(canonical);
    if (!preserveEdits) {
      formState.value = canonical;
      conflict.value = false;
    } else {
      // Per-field convergence (no frozen non-model fields): untouched fields
      // adopt the new canonical values so external changes surface; fields
      // the user edited are kept, flagging a conflict only when upstream
      // moved them too. Snapshots always advance to the latest canonical.
      const { fields: currentFields } = splitCanonicalForm(formState.value);
      const fields = reconcileFormFields({
        current: currentFields,
        previousCanonical: lastCanonicalFields,
        canonical: canonicalFields,
      });
      formState.value = { ...formState.value, ...fields.values };
      const selection = reconcileModelSelection({
        current: formState.value,
        previousCanonical: lastCanonicalSelection,
        canonical: canonicalSelection,
      });
      formState.value = { ...formState.value, model: selection.model, providerId: selection.providerId };
      conflict.value = selection.conflict || fields.conflict;
    }
    lastCanonicalSelection = { model: canonical.model, providerId: canonical.providerId };
    lastCanonicalFields = canonicalFields;
  }

  function useCanonicalModelSelection() {
    formState.value = {
      ...formState.value,
      model: lastCanonicalSelection.model,
      providerId: lastCanonicalSelection.providerId,
      ...(lastCanonicalFields || {}),
    };
    conflict.value = false;
  }

  function clearConflict() {
    conflict.value = false;
  }

  return { conflict, applyCanonicalTemplate, useCanonicalModelSelection, clearConflict };
}
