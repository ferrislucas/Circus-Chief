import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSessionsStore } from '../stores/sessions.js';
import { findNearestScheduledTime } from './scheduleInfo.js';

describe('findNearestScheduledTime', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the root scheduled time even when it is in the past', () => {
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
    const sessionsStore = useSessionsStore();
    const scheduledAt = '2026-01-10T10:00:00Z';

    sessionsStore.sessions = [
      { id: 'root', status: 'scheduled', scheduledAt },
      { id: 'child', parentSessionId: 'root', status: 'scheduled', scheduledAt: '2026-01-10T13:00:00Z' },
    ];

    expect(findNearestScheduledTime('root')).toBe(scheduledAt);
  });

  it('returns the nearest future scheduled descendant when the root is not scheduled', () => {
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
    const sessionsStore = useSessionsStore();

    sessionsStore.sessions = [
      { id: 'root', status: 'waiting', scheduledAt: null },
      { id: 'past-child', parentSessionId: 'root', status: 'scheduled', scheduledAt: '2026-01-10T11:00:00Z' },
      { id: 'later-child', parentSessionId: 'root', status: 'scheduled', scheduledAt: '2026-01-10T15:00:00Z' },
      { id: 'soon-child', parentSessionId: 'root', status: 'scheduled', scheduledAt: '2026-01-10T13:00:00Z' },
    ];

    expect(findNearestScheduledTime('root')).toBe(new Date('2026-01-10T13:00:00Z').getTime());
  });

  it('finds active-session roots through workflow traversal', () => {
    vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
    const sessionsStore = useSessionsStore();
    const scheduledAt = '2026-01-10T14:00:00Z';

    sessionsStore.activeSessions = [
      { id: 'active-root', status: 'scheduled', scheduledAt },
    ];

    expect(findNearestScheduledTime('active-root')).toBe(scheduledAt);
  });
});
