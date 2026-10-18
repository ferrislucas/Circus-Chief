import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { setActivePinia, createPinia } from 'pinia';

vi.mock('./useWebSocket.js', () => ({
  useWebSocket: () => ({ on: () => {}, off: () => {}, onReconnect: () => {} }),
}));

import { useSchedulingSessionSync } from './useSchedulingSessionSync.js';

function createForm() {
  return reactive({
    model: null,
    providerId: null,
    mode: 'standard',
    thinkingEnabled: false,
    scheduledAtLocal: '',
    nextTemplateId: null,
    autoRescheduleEnabled: false,
    rescheduleDelayMinutes: 60,
    rescheduleOnTokenLimit: true,
    rescheduleOnServiceError: true,
    maxRescheduleCount: null,
    maxTotalTokens: null,
    rescheduleAtTokenCount: null,
  });
}

describe('useSchedulingSessionSync', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('normalizes a stale tier model + concrete provider pair on hydration', () => {
    const formState = createForm();
    const session = {
      id: 'session-1',
      model: 'tier::tier-1',
      providerId: 'provider-concrete',
      pendingModel: null,
      pendingProviderId: null,
    };
    const { hydrateFromSession } = useSchedulingSessionSync({
      formState,
      getSession: () => session,
      isOpen: () => false,
    });

    hydrateFromSession(session);

    // Same predicate as useNewSessionForm: a tier ref never carries a
    // concrete provider hint, so hydration must clear the stale pair.
    expect(formState.model).toBe('tier::tier-1');
    expect(formState.providerId).toBeNull();
  });

  it('preserves a concrete model + provider pair on hydration', () => {
    const formState = createForm();
    const session = {
      id: 'session-1',
      model: 'gpt-5',
      providerId: 'provider-openai',
      pendingModel: null,
      pendingProviderId: null,
    };
    const { hydrateFromSession } = useSchedulingSessionSync({
      formState,
      getSession: () => session,
      isOpen: () => false,
    });

    hydrateFromSession(session);

    expect(formState.model).toBe('gpt-5');
    expect(formState.providerId).toBe('provider-openai');
  });
});
