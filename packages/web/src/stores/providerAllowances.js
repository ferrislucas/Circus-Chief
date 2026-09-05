import { defineStore } from 'pinia';
import { ProviderAllowanceListResponse } from '@circuschief/shared/contracts/providers';
import { api } from '../composables/useApi.js';

function isAttention(snapshot) {
  return ['warning', 'critical', 'exhausted'].includes(snapshot.status);
}

function lowestAllowance(snapshot) {
  return snapshot.allowances
    .filter((allowance) => allowance.remainingPercent !== null)
    .sort((left, right) => left.remainingPercent - right.remainingPercent)[0] || null;
}

export const useProviderAllowancesStore = defineStore('providerAllowances', {
  state: () => ({ snapshots: [], loading: false, error: null }),
  getters: {
    attentionCount: (state) => state.snapshots.filter(isAttention).length,
    compactAllowance: () => (snapshot) => lowestAllowance(snapshot),
  },
  actions: {
    async fetch() {
      this.loading = true;
      try {
        const response = await api.getProviderAllowances();
        const parsed = ProviderAllowanceListResponse.safeParse(response);
        if (!parsed.success) throw new Error('Invalid provider allowance response');
        this.snapshots = parsed.data;
        this.error = null;
      } catch (error) {
        this.error = error.message;
      } finally {
        this.loading = false;
      }
    },
    replace(snapshot) {
      const index = this.snapshots.findIndex((item) => item.providerId === snapshot.providerId);
      if (index === -1) this.snapshots.push(snapshot);
      else this.snapshots.splice(index, 1, snapshot);
    },
  },
});

export { isAttention, lowestAllowance };
