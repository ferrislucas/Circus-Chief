import { onScopeDispose, ref, watch } from 'vue';
import { isTierRef } from '@circuschief/shared';
import { useTiersStore } from '../stores/tiers.js';
import {
  agentTypeForProviders,
  agentTypeForSelection,
  isKindResolvable,
  persistModelSelectionWithConfirm,
} from '../components/crossKindSwitch.js';

/**
 * Owns picker → session model persistence for the conversation tab,
 * including the cross-provider switch confirm/revert flow (FRD §4/G4).
 * Extracted from ConversationTab.vue, which is at the `max-lines` budget.
 *
 * @param {object} args
 * @param {() => string} args.getSessionId - Session id resolved at persist time.
 * @param {import('vue').Ref<string|null>} args.selectedModel - Picker model ref.
 * @param {import('vue').Ref<string|null>} args.selectedProviderId - Picker provider ref.
 * @param {object} args.sessionsStore - Sessions store (currentSession, isDraftSession, updateSessionModel).
 * @param {object} args.providersStore - Providers store (providers catalog).
 * @param {object} args.uiStore - UI store (error surfacing).
 * @param {(explicit: boolean) => void} [args.onRevert] - Restores accepted selection intent.
 * @returns {{ pauseModelPersist: () => void, resumeModelPersist: () => void }}
 *   Guards for programmatic ref updates that must not trigger a persist
 *   (model initialization, template application).
 */
export function useModelSelectionPersist({
  getSessionId,
  selectedModel: selectedModelRef,
  selectedProviderId: selectedProviderIdRef,
  sessionsStore,
  providersStore,
  uiStore,
  onRevert,
}) {
  const selectedModel = selectedModelRef;
  const selectedProviderId = selectedProviderIdRef;
  const tiersStore = useTiersStore();
  let suppressNextModelPersist = false;
  // Caller-owned persist epoch: each dispatched picker change stamps its
  // sequence; a slow 4xx from an earlier change is stale and must not revert
  // a newer confirmed choice. Owned here (not in crossKindSwitch.js) so the
  // counter never leaks across component instances.
  let modelPersistSeq = 0;
  let disposed = false;
  let acceptedModel = selectedModel.value;
  let acceptedProviderId = selectedProviderId.value;
  let acceptedExplicit = false;
  const pendingWrites = new Map();
  const selectionPending = ref(false);

  // Invalidate synchronously so a submit in the same tick cannot race the
  // batched picker watcher. Picker model and provider updates are batched.
  watch([selectedModel, selectedProviderId], () => {
    modelPersistSeq += 1;
    if (!suppressNextModelPersist && selectedModel.value && acceptedModel !== null) {
      selectionPending.value = true;
    }
  }, { flush: 'sync' });
  watch(getSessionId, () => {
    modelPersistSeq += 1;
    selectionPending.value = false;
    acceptedModel = null;
    acceptedProviderId = null;
    acceptedExplicit = false;
  }, { flush: 'sync' });
  onScopeDispose(() => {
    disposed = true;
    modelPersistSeq += 1;
    selectionPending.value = false;
  });

  function revertModelSelection(model, providerId, explicit = acceptedExplicit) {
    acceptedModel = model;
    acceptedProviderId = providerId;
    acceptedExplicit = explicit;
    suppressNextModelPersist = true;
    selectedModel.value = model;
    selectedProviderId.value = providerId;
    onRevert?.(explicit);
  }

  function shouldPersist(newPair, oldPair) {
    const [newModel, newProviderId] = newPair;
    const [oldModel, oldProviderId] = oldPair;
    if (suppressNextModelPersist || acceptedModel === null || oldModel === null || !newModel) {
      suppressNextModelPersist = false;
      acceptedModel = newModel;
      acceptedProviderId = newProviderId;
      selectionPending.value = false;
      return false;
    }
    if (newModel === oldModel && newProviderId === oldProviderId) {
      selectionPending.value = false;
      return false;
    }
    return true;
  }

  async function resolveTiers(newModel, isCurrent, previousModel, previousProviderId) {
    if (!isTierRef(newModel)) return tiersStore.tiers;
    try {
      return await tiersStore.fetchTiers({ throwOnError: true });
    } catch (err) {
      if (isCurrent()) {
        uiStore.error(err.message);
        revertModelSelection(previousModel, previousProviderId);
        selectionPending.value = false;
      }
      return null;
    }
  }

  function sessionForId(sessionId) {
    if (sessionsStore.currentSession?.id === sessionId) return sessionsStore.currentSession;
    return sessionsStore.sessions?.find((session) => session.id === sessionId);
  }

  function switchKinds({ currentSession, isStarted, tiers, previousModel, previousProviderId, newModel, newProviderId }) {
    const providers = providersStore.providers;
    const fromAgentType = (isStarted && currentSession.agentType)
      ? currentSession.agentType
      : agentTypeForProviders(providers, previousProviderId, previousModel);
    const toAgentType = agentTypeForSelection(providers, tiers, newProviderId, newModel);
    const fromResolvable = Boolean(isStarted && currentSession?.agentType)
      || isKindResolvable(providers, previousProviderId, previousModel);
    const toResolvable = isTierRef(newModel)
      ? toAgentType != null
      : isKindResolvable(providers, newProviderId, newModel);
    return { fromAgentType, toAgentType, kindUnresolvable: !fromResolvable || !toResolvable };
  }

  // Persist model selection to session
  watch([selectedModel, selectedProviderId], async (newPair, oldPair) => {
    if (!shouldPersist(newPair, oldPair)) return;
    const [newModel, newProviderId] = newPair;
    const mySeq = modelPersistSeq;
    const sessionId = getSessionId();
    const isCurrent = () => !disposed && mySeq === modelPersistSeq && sessionId === getSessionId();
    const previousModel = acceptedModel;
    const previousProviderId = acceptedProviderId;
    const previousExplicit = acceptedExplicit;
    const previousWrite = pendingWrites.get(sessionId);

    // In-scope kind changes on started sessions need confirmation. The
    // from-kind is the session's stored agent type (the snapshotted member),
    // not a fresh walk of a bound tier. The destination walks the tier the
    // user just opened. A missing catalog or an empty tier confirms
    // generically instead of persisting with a defaulted Claude Code label.
    const tiers = await resolveTiers(newModel, isCurrent, previousModel, previousProviderId);
    if (!isCurrent() || tiers === null) return;
    if (previousWrite) await previousWrite;
    if (!isCurrent()) return;
    const currentSession = sessionForId(sessionId);
    if (!currentSession) {
      selectionPending.value = false;
      return;
    }
    const isStarted = !sessionsStore.isDraftSession(currentSession);
    const kinds = switchKinds({ currentSession, isStarted, tiers, previousModel, previousProviderId, newModel, newProviderId });
    await persistModelSelectionWithConfirm({
      oldModel: previousModel, oldProviderId: previousProviderId, newModel, newProviderId,
      ...kinds,
      isStarted,
      modelsDiffer: previousModel !== newModel,
      confirmFn: (copy) => window.confirm(copy),
      persistFn: (model, providerId) => {
        acceptedModel = model;
        acceptedProviderId = providerId;
        acceptedExplicit = true;
        const write = Promise.resolve().then(() => sessionsStore.updateSessionModel(sessionId, model, providerId));
        const settled = write.then(() => {}, () => {});
        pendingWrites.set(sessionId, settled);
        settled.then(() => { if (pendingWrites.get(sessionId) === settled) pendingWrites.delete(sessionId); });
        return write;
      },
      onError: (err) => uiStore.error(err.message),
      revertFn: (model, providerId) => revertModelSelection(model, providerId, previousExplicit),
      isCurrent,
    });
    if (isCurrent()) selectionPending.value = false;
  });

  return {
    selectionPending,
    pauseModelPersist() {
      modelPersistSeq += 1;
      selectionPending.value = false;
      suppressNextModelPersist = true;
    },
    resumeModelPersist() { suppressNextModelPersist = false; },
  };
}
