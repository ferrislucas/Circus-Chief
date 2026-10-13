import { defineStore } from 'pinia';
import { ProviderAllowanceListResponse } from '@circuschief/shared/contracts/providers';
import { api } from '../composables/useApi.js';

// "Requires attention" includes critical deliberately. FRD §7.3 spells the
// badge out as "warning or exhausted", but AC-3 defines the badge as the
// number requiring attention and the state table renders Critical with the
// same error red as Exhausted — a red provider that the badge ignored would
// undercount exactly the worst cases. (Round-3 review, item 6: intentional.)
function isAttention(snapshot) {
  return ['warning', 'critical', 'exhausted'].includes(snapshot.status);
}

// Dialog order is most-recently-used, mirroring the server comparator:
// highest lastUsedAt first, never-used (null) last.
function compareRecency(left, right) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  return right - left;
}

// The index tiebreaker keeps the sort stable even where the engine would
// not, preserving server order for equal recency so indicators never jitter
// between equivalent updates.
export function prioritizeSnapshots(snapshots) {
  return [...snapshots]
    .map((snapshot, index) => ({ snapshot, index }))
    .sort((left, right) => compareRecency(left.snapshot.lastUsedAt, right.snapshot.lastUsedAt) || left.index - right.index)
    .map(({ snapshot }) => snapshot);
}

// A live update without recency (a stale-cached server) must never reset
// the stored stamp: allowance frames are not a usage signal.
function preserveRecency(snapshots, nextSnapshot) {
  if (nextSnapshot.lastUsedAt === null || nextSnapshot.lastUsedAt === undefined) {
    const existing = snapshots.find((snapshot) => snapshot.providerId === nextSnapshot.providerId);
    if (existing?.lastUsedAt !== null && existing?.lastUsedAt !== undefined) {
      return { ...nextSnapshot, lastUsedAt: existing.lastUsedAt };
    }
  }
  return nextSnapshot;
}

function upsertSnapshot(snapshots, nextSnapshot) {
  const merged = preserveRecency(snapshots, nextSnapshot);
  const index = snapshots.findIndex((snapshot) => snapshot.providerId === merged.providerId);
  if (index === -1) return [...snapshots, merged];
  return snapshots.map((snapshot, currentIndex) => currentIndex === index ? merged : snapshot);
}

function lowestAllowance(snapshot) {
  return snapshot.allowances
    .filter((allowance) => allowance.remainingPercent !== null)
    .sort((left, right) => left.remainingPercent - right.remainingPercent)[0] || null;
}

export const useProviderAllowancesStore = defineStore('providerAllowances', {
  state: () => ({ snapshots: [], activeProviderIds: [], error: null, snapshotVersion: 0, staleTimer: null }),
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
        // Retained as plain state for response-shape fidelity (badge and
        // probe-gating consumers read the server field); it is not an
        // ordering input — dialog order is recency only.
        this.activeProviderIds = [...new Set(parsed.data.activeProviderIds)];
        this.snapshots = prioritizeSnapshots(markStaleSnapshots(parsed.data.snapshots));
        this.error = null;
        this.scheduleStaleness();
      } catch (error) {
        this.error = error.message;
      }
    },
    replace(snapshot) {
      const freshSnapshot = markStaleSnapshots([snapshot])[0];
      this.snapshots = prioritizeSnapshots(upsertSnapshot(this.snapshots, freshSnapshot));
      this.snapshotVersion += 1;
      this.scheduleStaleness();
    },
    refreshStaleness() {
      const refreshed = markStaleSnapshots(this.snapshots);
      if (refreshed.some((snapshot, index) => snapshot !== this.snapshots[index])) {
        this.snapshots = prioritizeSnapshots(refreshed);
        this.snapshotVersion += 1;
      }
      this.scheduleStaleness();
    },
    scheduleStaleness() {
      if (this.staleTimer) clearTimeout(this.staleTimer);
      const nextStaleAt = this.snapshots
        .filter((snapshot) => !snapshot.stale && snapshot.staleAt !== null && snapshot.staleAt > Date.now())
        .map((snapshot) => snapshot.staleAt)
        .sort((left, right) => left - right)[0];
      this.staleTimer = nextStaleAt ? setTimeout(() => this.refreshStaleness(), nextStaleAt - Date.now()) : null;
    },
  },
});

// Staleness is a freshness overlay: the flag marks last-known data as out
// of date while `status` keeps the underlying attention state, so
// `isAttention` and `attentionCount` keep working unchanged for
// stale-critical and stale-exhausted providers.
function markStaleSnapshots(snapshots) {
  const now = Date.now();
  return snapshots.map((snapshot) => (
    snapshot.staleAt !== null && snapshot.staleAt <= now && !snapshot.stale
      ? { ...snapshot, stale: true }
      : snapshot
  ));
}

export { isAttention, lowestAllowance };
