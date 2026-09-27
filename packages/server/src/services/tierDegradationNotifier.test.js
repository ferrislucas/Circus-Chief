import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StaleTierEchoRegistry, publishTierDegradation } from './tierDegradationNotifier.js';
import { modelTiers, projects, sessions } from '../database.js';
import { broadcastToSession } from '../websocket.js';
import { buildTierRef, WS_MESSAGE_TYPES } from '@circuschief/shared';

vi.mock('../websocket.js', () => ({
  broadcast: vi.fn(),
  broadcastToSession: vi.fn(),
  broadcastToProject: vi.fn(),
}));

describe('StaleTierEchoRegistry', () => {
  afterEach(() => vi.useRealTimers());

  it('removes expired entries even when no follow-up request arrives', () => {
    vi.useFakeTimers();
    const registry = new StaleTierEchoRegistry({ ttlMs: 100, maxSize: 3 });

    registry.record('session-a', 'tier::a');
    vi.advanceTimersByTime(100);

    expect(registry.size).toBe(0);
    registry.dispose();
  });

  it('sweeps expired entries before retaining new records and applies deterministic capacity eviction', () => {
    vi.useFakeTimers();
    const registry = new StaleTierEchoRegistry({ ttlMs: 100, maxSize: 2 });

    registry.record('expired', 'tier::expired');
    vi.advanceTimersByTime(100);
    registry.record('first', 'tier::first');
    registry.record('second', 'tier::second');
    registry.record('third', 'tier::third');

    expect(registry.size).toBe(2);
    expect(registry.consume('first', 'tier::first')).toBe(false);
    expect(registry.consume('second', 'tier::second')).toBe(true);
    expect(registry.consume('third', 'tier::third')).toBe(true);
    registry.dispose();
  });

  it('does not consume a valid record for a mismatched tier reference', () => {
    const registry = new StaleTierEchoRegistry();
    registry.record('session-a', 'tier::correct');

    expect(registry.consume('session-a', 'tier::wrong')).toBe(false);
    expect(registry.consume('session-a', 'tier::correct')).toBe(true);
    expect(registry.consume('session-a', 'tier::correct')).toBe(false);
    registry.dispose();
  });

  it('clears its scheduled cleanup timer on disposal', () => {
    vi.useFakeTimers();
    const registry = new StaleTierEchoRegistry({ ttlMs: 100 });
    registry.record('session-a', 'tier::a');

    registry.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('publishTierDegradation session notice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function publishForSession() {
    const tier = modelTiers.create({ name: 'Gold', members: [] });
    const project = projects.create('Degraded notice project', '/tmp/degraded-notice');
    const session = sessions.create(project.id, 'Degraded session', 'Later', {
      status: 'scheduled',
      model: buildTierRef(tier.id),
    });
    publishTierDegradation({
      degradedFrom: buildTierRef(tier.id),
      affectedSessions: [{ id: session.id, projectId: project.id }],
      affectedTemplateIds: [],
      projectDefaultProjectIds: [],
      laneProjectIds: [],
      summarySettingsChanged: false,
    });
    return { tier, session };
  }

  it('broadcasts a tier:degraded notice with the tier name to each affected session', () => {
    const { tier, session } = publishForSession();

    const degradedCalls = broadcastToSession.mock.calls.filter(
      ([, type]) => type === WS_MESSAGE_TYPES.TIER_DEGRADED
    );
    expect(degradedCalls).toHaveLength(1);
    expect(degradedCalls[0][0]).toBe(session.id);
    expect(degradedCalls[0][2]).toMatchObject({
      sessionId: session.id,
      degradedFrom: buildTierRef(tier.id),
      tierName: 'Gold',
    });
  });

  it('sends no notice when the change set is null', () => {
    publishTierDegradation(null);
    expect(broadcastToSession).not.toHaveBeenCalled();
  });
});
