import { defineStore } from 'pinia';
import { ProviderAllowanceListResponse } from '@circuschief/shared/contracts/providers';
import { api } from '../composables/useApi.js';

function isAttention(snapshot) {
  return ['warning', 'critical', 'exhausted'].includes(snapshot.status);
}

function snapshotPriority(snapshot, activeProviderIds) {
  if (activeProviderIds.has(snapshot.providerId)) return 0;
  return isAttention(snapshot) ? 1 : 2;
}

// JavaScript's stable sort preserves the server/configured order for equal
// priorities, keeping indicators from jittering between equivalent updates.
export function prioritizeSnapshots(snapshots, activeProviderIds = []) {
  if (activeProviderIds === null) return [...snapshots];
  const activeIds = new Set(activeProviderIds);
  return [...snapshots]
    .map((snapshot, index) => ({ snapshot, index }))
    .sort((left, right) => snapshotPriority(left.snapshot, activeIds) - snapshotPriority(right.snapshot, activeIds) || left.index - right.index)
    .map(({ snapshot }) => snapshot);
}

function upsertSnapshot(snapshots, nextSnapshot) {
  const index = snapshots.findIndex((snapshot) => snapshot.providerId === nextSnapshot.providerId);
  if (index === -1) return [...snapshots, nextSnapshot];
  return snapshots.map((snapshot, currentIndex) => currentIndex === index ? nextSnapshot : snapshot);
}

function lowestAllowance(snapshot) {
  return snapshot.allowances
    .filter((allowance) => allowance.remainingPercent !== null)
    .sort((left, right) => left.remainingPercent - right.remainingPercent)[0] || null;
}

export const useProviderAllowancesStore = defineStore('providerAllowances', {
  // Before a session event arrives, REST is the authoritative source for
  // active-provider ordering. An empty array means the active set is known.
  state: () => ({ snapshots: [], activeProviderIds: null, error: null, snapshotVersion: 0, staleTimer: null }),
  getters: {
    attentionCount: (state) => state.snapshots.filter(isAttention).length,
    compactAllowance: () => (snapshot) => lowestAllowance(snapshot),
  },
  actions: {
    async fetch() {
      const snapshotVersion = this.snapshotVersion + 1;
      this.snapshotVersion = snapshotVersion;
      try {
        const response = await api.getProviderAllowances();
        const parsed = ProviderAllowanceListResponse.safeParse(response);
        if (!parsed.success) throw new Error('Invalid provider allowance response');
        if (snapshotVersion !== this.snapshotVersion) return;
        this.snapshots = prioritizeSnapshots(markStaleSnapshots(parsed.data), this.activeProviderIds);
        this.error = null;
        this.scheduleStaleness();
      } catch (error) {
        this.error = error.message;
      }
    },
    replace(snapshot) {
      const freshSnapshot = markStaleSnapshots([snapshot])[0];
      this.snapshots = prioritizeSnapshots(upsertSnapshot(this.snapshots, freshSnapshot), this.activeProviderIds ?? []);
      this.snapshotVersion += 1;
      this.scheduleStaleness();
    },
    setActiveProviderIds(providerIds) {
      this.activeProviderIds = [...new Set(providerIds)];
      this.snapshots = prioritizeSnapshots(this.snapshots, this.activeProviderIds);
      this.snapshotVersion += 1;
    },
    refreshStaleness() {
      const refreshed = markStaleSnapshots(this.snapshots);
      if (refreshed.some((snapshot, index) => snapshot !== this.snapshots[index])) {
        this.snapshots = prioritizeSnapshots(refreshed, this.activeProviderIds);
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
