import { ref, onMounted, onUnmounted } from 'vue';
import { api } from '../api/index.js';
import { useWebSocket } from './useWebSocket.js';
import { createCatalogSync } from './catalogSync.js';
import { useSelectionGuard } from './useSelectionGuard.js';
import { reconcileFormFields, reconcileModelSelection } from './modelSelectionReconciliation.js';
import { normalizeModelProviderPair } from '../components/modelSelectorTiers.js';
import { DEFAULT_RESCHEDULE_DELAY_MINUTES, WS_MESSAGE_TYPES } from '@circuschief/shared';
import { formatDateTimeLocal } from '../utils/formatters.js';

/**
 * Canonical session sync for the scheduling modal: hydration, per-field
 * convergence, the shared selection-guard contract, and the websocket /
 * reconnect intake behind one monotonic revision counter.
 *
 * Extracted from SchedulingEditModal.vue to keep the component under the
 * project's file-size lint budget; behavior is unchanged. Owns no DOM —
 * operates on the caller's reactive `form` object in place.
 *
 * @param {{ formState: Object, getSession: () => Object|null, isOpen: () => boolean }} options
 * @returns {{ selectionGuard: Object, resolveSelectionBanner: Function, hydrateFromSession: Function }}
 */
export function useSchedulingSessionSync({ formState, getSession, isOpen }) {
  // Convergence conflict (model pair or any other field diverged from a newer
  // canonical session row while the user has unsaved edits). Folded into the
  // shared guard's conflict contract so one banner covers both.
  const modelSelectionConflict = ref(false);
  let lastCanonicalSelection = { model: null, providerId: null };
  let lastCanonicalFields = null;

  // Shared save-path contract (see useSelectionGuard): a selection naming a
  // deleted or emptied tier/provider/model keeps the banner up and blocks
  // saving until the user picks a current value or clears the selection.
  const selectionGuard = useSelectionGuard(
    () => ({ model: formState.model, providerId: formState.providerId }),
    () => modelSelectionConflict.value,
    () => { modelSelectionConflict.value = false; }
  );

  function clearStaleSelection() {
    formState.model = null;
    formState.providerId = null;
  }

  // Adopt the latest canonical snapshots (model pair + all other fields).
  // When the stored binding itself is stale (invalid), there is no usable
  // canonical value to adopt, so resolve by clearing to inherit/empty instead.
  function resolveSelectionBanner() {
    if (selectionGuard.invalid) {
      clearStaleSelection();
      return;
    }
    formState.model = lastCanonicalSelection.model;
    formState.providerId = lastCanonicalSelection.providerId;
    if (lastCanonicalFields) Object.assign(formState, lastCanonicalFields);
    modelSelectionConflict.value = false;
  }

  function convertToLocalDatetime(timestamp) {
    if (!timestamp) return '';
    return formatDateTimeLocal(new Date(timestamp));
  }

  // The stored (model, providerId) pair, preferring a pending scheduled-run
  // override when one exists. Normalized through the same predicate
  // useNewSessionForm uses: a tier ref never carries a concrete provider
  // hint, so a stale stored pair (tier model + concrete providerId) cannot
  // enter the form mismatched — and the convergence snapshots baseline from
  // the normalized pair, so later intakes compare apples to apples.
  function canonicalPairFromSession(session) {
    const hasPendingSelection = session.pendingModel !== null
      && session.pendingModel !== undefined;
    return normalizeModelProviderPair(
      hasPendingSelection ? session.pendingModel : (session.model || null),
      hasPendingSelection
        ? (session.pendingProviderId || null)
        : (session.providerId || null),
    );
  }

  // Every other session-backed form field, normalized exactly as hydration
  // applies them — so later intakes compare apples to apples.
  function canonicalFieldsFromSession(session) {
    return {
      mode: session.mode || 'standard',
      thinkingEnabled: session.thinkingEnabled || false,
      scheduledAtLocal: convertToLocalDatetime(session.scheduledAt),
      nextTemplateId: session.nextTemplateId || null,
      autoRescheduleEnabled: session.autoRescheduleEnabled || false,
      rescheduleDelayMinutes: session.rescheduleDelayMinutes || DEFAULT_RESCHEDULE_DELAY_MINUTES,
      rescheduleOnTokenLimit: session.rescheduleOnTokenLimit ?? true,
      rescheduleOnServiceError: session.rescheduleOnServiceError ?? true,
      maxRescheduleCount: session.maxRescheduleCount ?? null,
      maxTotalTokens: session.maxTotalTokens ?? null,
      rescheduleAtTokenCount: session.rescheduleAtTokenCount ?? null,
    };
  }

  function readSchedulingFormFields() {
    return {
      mode: formState.mode,
      thinkingEnabled: formState.thinkingEnabled,
      scheduledAtLocal: formState.scheduledAtLocal,
      nextTemplateId: formState.nextTemplateId,
      autoRescheduleEnabled: formState.autoRescheduleEnabled,
      rescheduleDelayMinutes: formState.rescheduleDelayMinutes,
      rescheduleOnTokenLimit: formState.rescheduleOnTokenLimit,
      rescheduleOnServiceError: formState.rescheduleOnServiceError,
      maxRescheduleCount: formState.maxRescheduleCount,
      maxTotalTokens: formState.maxTotalTokens,
      rescheduleAtTokenCount: formState.rescheduleAtTokenCount,
    };
  }

  function hydrateFromSession(session) {
    const pair = canonicalPairFromSession(session);
    formState.model = pair.model;
    formState.providerId = pair.providerId;
    Object.assign(formState, canonicalFieldsFromSession(session));
    formState.resetRescheduleCount = false;
    // Re-baseline convergence snapshots: opening the modal adopts the latest
    // known server state wholesale and clears any earlier divergence.
    lastCanonicalSelection = { ...pair };
    lastCanonicalFields = canonicalFieldsFromSession(session);
    modelSelectionConflict.value = false;
  }

  // Reconcile one canonical session row into the open form: untouched fields
  // adopt the new values so external changes surface; fields the user edited
  // are kept, flagging a conflict only when upstream moved them too. Never
  // clobbers unsaved edits, never silently ignores the update.
  function applyCanonicalSession(row) {
    const session = getSession();
    if (!row || !isOpen() || row.id !== session?.id) return;
    const pair = canonicalPairFromSession(row);
    const canonicalFields = canonicalFieldsFromSession(row);
    const fields = reconcileFormFields({
      current: readSchedulingFormFields(),
      previousCanonical: lastCanonicalFields,
      canonical: canonicalFields,
    });
    Object.assign(formState, fields.values);
    const selection = reconcileModelSelection({
      current: { model: formState.model, providerId: formState.providerId },
      previousCanonical: lastCanonicalSelection,
      canonical: { model: pair.model || '', providerId: pair.providerId },
    });
    formState.model = selection.model;
    formState.providerId = selection.providerId;
    modelSelectionConflict.value = selection.conflict || fields.conflict;
    lastCanonicalSelection = { ...pair };
    lastCanonicalFields = canonicalFields;
  }

  // One monotonic coordinator for all canonical intake while the modal lives:
  // websocket pushes (inline full row) share a revision counter with the
  // reconnect refetch, so a slow refetch can never overwrite a newer push.
  const { on, off, onReconnect } = useWebSocket();
  const sessionSync = createCatalogSync({
    fetchCanonical: () => api.getSession(getSession().id),
    applyCanonical: (row) => applyCanonicalSession(row),
  });

  function handleSessionMessage(message) {
    if (message?.sessionId !== getSession()?.id || !message.session) return;
    sessionSync.notifyCanonical(message.session);
  }

  let removeReconnectListener;

  onMounted(() => {
    on(WS_MESSAGE_TYPES.SESSION_UPDATED, handleSessionMessage);
    removeReconnectListener = onReconnect(() => {
      if (getSession()?.id) sessionSync.refresh();
    });
  });

  onUnmounted(() => {
    off(WS_MESSAGE_TYPES.SESSION_UPDATED, handleSessionMessage);
    sessionSync.dispose();
    removeReconnectListener?.();
  });

  return { selectionGuard, resolveSelectionBanner, hydrateFromSession };
}
