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
  state: () => ({ snapshots: [], error: null, snapshotVersion: 0, staleTimer: null }),
  getters: {
    attentionCount: (state) => state.snapshots.filter(isAttention).length,
    compactAllowance: () => (snapshot) => lowestAllowance(snapshot),
  },
  actions: {
    async fetch() {
      const snapshotVersion = this.snapshotVersion;
      try {
        const response = await api.getProviderAllowances();
        const parsed = ProviderAllowanceListResponse.safeParse(response);
        if (!parsed.success) throw new Error('Invalid provider allowance response');
        if (snapshotVersion !== this.snapshotVersion) return;
        this.snapshots = markStaleSnapshots(parsed.data);
        this.snapshotVersion += 1;
        this.error = null;
        this.scheduleStaleness();
      } catch (error) {
        this.error = error.message;
      }
    },
    replace(snapshot) {
      const index = this.snapshots.findIndex((item) => item.providerId === snapshot.providerId);
      const freshSnapshot = markStaleSnapshots([snapshot])[0];
      if (index === -1) this.snapshots.push(freshSnapshot);
      else this.snapshots.splice(index, 1, freshSnapshot);
      this.snapshotVersion += 1;
      this.scheduleStaleness();
    },
    refreshStaleness() {
      const refreshed = markStaleSnapshots(this.snapshots);
      if (refreshed.some((snapshot, index) => snapshot !== this.snapshots[index])) {
        this.snapshots = refreshed;
        this.snapshotVersion += 1;
      }
      this.scheduleStaleness();
    },
    scheduleStaleness() {
      if (this.staleTimer) clearTimeout(this.staleTimer);
      const nextStaleAt = this.snapshots
        .filter((snapshot) => snapshot.status !== 'stale' && snapshot.staleAt !== null && snapshot.staleAt > Date.now())
        .map((snapshot) => snapshot.staleAt)
        .sort((left, right) => left - right)[0];
      this.staleTimer = nextStaleAt ? setTimeout(() => this.refreshStaleness(), nextStaleAt - Date.now()) : null;
    },
  },
});

function markStaleSnapshots(snapshots) {
  const now = Date.now();
  return snapshots.map((snapshot) => (
    snapshot.staleAt !== null && snapshot.staleAt <= now && snapshot.status !== 'stale'
      ? { ...snapshot, status: 'stale' }
      : snapshot
  ));
}

export { isAttention, lowestAllowance };
