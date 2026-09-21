import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the SDK before importing the adapter
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { ClaudeCodeAdapter } from './ClaudeCodeAdapter.js';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ProviderAllowanceService } from '../../services/ProviderAllowanceService.js';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', 'tests', 'fixtures', 'claude', 'rate-limit-event.json',
);

function permissionKey(toolName, input) {
  return `${toolName}:${JSON.stringify(input)}`;
}

/**
 * A deterministic SDK boundary: it consumes callback results exactly as the
 * SDK does for a later operation, retaining session rules in the live query
 * context and project rules across reconstructed adapter instances.
 */
function createPermissionSdkBoundary() {
  const sessionRules = new Map();
  const projectRules = new Map();
  const prompts = [];

  query.mockImplementation(async function* (params) {
    const { sessionId, projectId, toolName, input } = params.options.operation;
    const key = permissionKey(toolName, input);
    const permitted = sessionRules.get(sessionId)?.has(key) || projectRules.get(projectId)?.has(key);
    if (!permitted) {
      prompts.push({ sessionId, projectId, toolName, input });
      const result = await params.options.canUseTool(toolName, input, { suggestions: [{ rule: key }] });
      if (result.behavior !== 'allow') {
        yield { type: 'tool_result', subtype: 'blocked' };
        return;
      }
      for (const update of result.updatedPermissions || []) {
        const rules = update.destination === 'projectSettings'
          ? (projectRules.get(projectId) || new Set())
          : (sessionRules.get(sessionId) || new Set());
        rules.add(update.rule);
        if (update.destination === 'projectSettings') projectRules.set(projectId, rules);
        else sessionRules.set(sessionId, rules);
      }
    }
    yield { type: 'tool_result', subtype: 'completed' };
  });

  return { prompts };
}

async function runPermissionOperation(adapter, boundary, { sessionId, projectId, toolName, input, response }) {
  const canUseTool = vi.fn(async (...args) => response(...args));
  const events = [];
  for await (const event of adapter.execute({
    prompt: 'perform gated operation',
    options: { canUseTool, operation: { sessionId, projectId, toolName, input } },
  })) events.push(event);
  return { events, canUseTool, promptCount: boundary.prompts.length };
}

describe('ClaudeCodeAdapter', () => {
  it('calls SDK query() and yields all events', async () => {
    const events = [
      { type: 'system', subtype: 'system.init' },
      { type: 'assistant', message: { content: 'Hello' } },
      { type: 'result', subtype: 'result.success' },
    ];

    query.mockImplementation(async function* (_params) {
      for (const event of events) {
        yield event;
      }
    });

    const adapter = new ClaudeCodeAdapter();
    const collected = [];
    for await (const event of adapter.execute({ prompt: 'test' })) {
      collected.push(event);
    }

    expect(collected).toEqual(events);
    expect(query).toHaveBeenCalledWith({ prompt: 'test' });
  });

  it('propagates errors from SDK query()', async () => {
    query.mockImplementation(async function* () {
      yield { type: 'system' };
      throw new Error('SDK error');
    });

    const adapter = new ClaudeCodeAdapter();
    const collected = [];
    await expect(async () => {
      for await (const event of adapter.execute({ prompt: 'test' })) {
        collected.push(event);
      }
    }).rejects.toThrow('SDK error');

    // Should have yielded the first event before error
    expect(collected).toHaveLength(1);
  });

  it('works with abort controller (yields events until aborted)', async () => {
    const controller = new AbortController();
    const events = [
      { type: 'system' },
      { type: 'assistant' },
      { type: 'result' },
    ];

    query.mockImplementation(async function* () {
      for (const event of events) {
        yield event;
      }
    });

    const adapter = new ClaudeCodeAdapter();
    const collected = [];
    for await (const event of adapter.execute({ prompt: 'test', options: { abortController: controller } })) {
      collected.push(event);
      if (collected.length === 2) {
        controller.abort();
        break;
      }
    }

    expect(collected).toHaveLength(2);
  });

  it('returns true for supportsResume()', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.supportsResume()).toBe(true);
  });

  it('returns correct capabilities', () => {
    const adapter = new ClaudeCodeAdapter();
    expect(adapter.getCapabilities()).toEqual({
      streaming: true,
      thinking: true,
      reasoningEffort: true,
      toolUse: true,
      resume: true,
    });
  });

  it('applies always-allow updates to later operations with the requested scope', async () => {
    const boundary = createPermissionSdkBoundary();
    const command = { command: 'git status' };
    const allowOnce = () => ({ behavior: 'allow' });
    const allowSession = () => ({ behavior: 'allow', updatedPermissions: [{ rule: permissionKey('Bash', command), destination: 'session' }] });
    const allowProject = () => ({ behavior: 'allow', updatedPermissions: [{ rule: permissionKey('Bash', command), destination: 'projectSettings' }] });
    const operation = (adapter, sessionId, projectId, input = command, toolName = 'Bash', response = allowOnce) => runPermissionOperation(
      adapter, boundary, { sessionId, projectId, toolName, input, response }
    );

    // Allow-once completes the current operation but does not grant a later one.
    const onceAdapter = new ClaudeCodeAdapter();
    expect((await operation(onceAdapter, 'once', 'project-a')).events).toEqual([{ type: 'tool_result', subtype: 'completed' }]);
    expect((await operation(onceAdapter, 'once', 'project-a')).canUseTool).toHaveBeenCalledOnce();

    // Session rules survive later operations in the session but not another session.
    const sessionAdapter = new ClaudeCodeAdapter();
    await operation(sessionAdapter, 'session-a', 'project-a', command, 'Bash', allowSession);
    expect((await operation(sessionAdapter, 'session-a', 'project-a')).canUseTool).not.toHaveBeenCalled();
    expect((await operation(sessionAdapter, 'session-b', 'project-a')).canUseTool).toHaveBeenCalledOnce();

    // Project rules survive adapter reconstruction, but stay project and rule specific.
    await operation(new ClaudeCodeAdapter(), 'project-a-1', 'project-a', command, 'Bash', allowProject);
    expect((await operation(new ClaudeCodeAdapter(), 'project-a-2', 'project-a')).canUseTool).not.toHaveBeenCalled();
    expect((await operation(new ClaudeCodeAdapter(), 'project-b-1', 'project-b')).canUseTool).toHaveBeenCalledOnce();
    expect((await operation(new ClaudeCodeAdapter(), 'project-a-3', 'project-a', { command: 'git status --short' })).canUseTool).toHaveBeenCalledOnce();
    expect((await operation(new ClaudeCodeAdapter(), 'project-a-4', 'project-a', command, 'Write')).canUseTool).toHaveBeenCalledOnce();
  });
});

describe('ClaudeCodeAdapter rate-limit allowance tap', () => {
  const FIXTURE = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const now = 1_789_895_000_000;
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.PROVIDER_ALLOWANCES_ENABLED = '1';
    process.env.PROVIDER_ALLOWANCES_CLAUDE = '1';
  });

  afterEach(() => {
    process.env.PROVIDER_ALLOWANCES_ENABLED = originalEnv.PROVIDER_ALLOWANCES_ENABLED;
    process.env.PROVIDER_ALLOWANCES_CLAUDE = originalEnv.PROVIDER_ALLOWANCES_CLAUDE;
  });

  function sdkStream(...messages) {
    query.mockImplementation(async function* () {
      for (const message of messages) yield message;
    });
  }

  async function collect(adapter, queryParams = { prompt: 'hello', options: { providerId: 'anthropic-default' } }) {
    const events = [];
    for await (const event of adapter.execute(queryParams)) events.push(event);
    return events;
  }

  it('diverts rate-limit events to the allowance observer and forwards every other message unchanged', async () => {
    const observer = vi.fn();
    const stream = [
      FIXTURE.fiveHourWithUtilization,
      { type: 'system', subtype: 'init', session_id: 'redacted' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
    ];
    sdkStream(...stream);
    const adapter = new ClaudeCodeAdapter({ allowanceObserver: observer, clock: { now: () => now } });

    const events = await collect(adapter);

    expect(events).toEqual(stream.filter((message) => message.type !== 'rate_limit_event'));
    expect(observer).toHaveBeenCalledExactlyOnceWith({
      providerKind: 'anthropic',
      source: 'provider',
      updatedAt: now,
      staleAfterMs: 15 * 60_000,
      status: 'available',
      providerId: 'anthropic-default',
      allowances: [expect.objectContaining({ key: 'five_hour', remainingPercent: 57.5 })],
    });
  });

  it('merges per-model windows across events into full row sets and drops expired windows', async () => {
    const observer = vi.fn();
    const expiredFiveHour = {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 10, resetsAt: 1_789_894_000 },
    };
    sdkStream(
      FIXTURE.fiveHourWithUtilization,
      FIXTURE.weeklyOpusCap,
      expiredFiveHour,
    );
    const adapter = new ClaudeCodeAdapter({ allowanceObserver: observer, clock: { now: () => now } });

    await collect(adapter);

    expect(observer).toHaveBeenCalledTimes(3);
    const observedKeySets = observer.mock.calls.map(([candidate]) => candidate.allowances.map((row) => row.key));
    expect(observedKeySets[0]).toEqual(['five_hour']);
    // The second observation re-emits the merged window set: the still-current
    // five-hour row plus the newly seen per-model weekly cap.
    expect(observedKeySets[1]).toEqual(['five_hour', 'seven_day_opus']);
    // The final event's five-hour window has already passed its reset time, so
    // it is dropped rather than carried forward under a stale value.
    expect(observedKeySets[2]).toEqual(['seven_day_opus']);
  });

  it('swallows observer errors so the conversation stream is unaffected', async () => {
    const stream = [
      FIXTURE.fiveHourWithUtilization,
      { type: 'system', subtype: 'init' },
    ];
    sdkStream(...stream);
    const adapter = new ClaudeCodeAdapter({ allowanceObserver: () => { throw new Error('observer exploded'); }, clock: { now: () => now } });

    const events = await collect(adapter);

    expect(events).toEqual([{ type: 'system', subtype: 'init' }]);
  });

  it('does not observe without a providerId, without an observer, or while the source gate is off', async () => {
    const observer = vi.fn();
    sdkStream(FIXTURE.fiveHourWithUtilization);

    await collect(new ClaudeCodeAdapter({ allowanceObserver: observer, clock: { now: () => now } }), { prompt: 'x', options: {} });
    await collect(new ClaudeCodeAdapter({ clock: { now: () => now } }), { prompt: 'x', options: { providerId: 'anthropic-default' } });
    delete process.env.PROVIDER_ALLOWANCES_CLAUDE;
    await collect(new ClaudeCodeAdapter({ allowanceObserver: observer, clock: { now: () => now } }));

    expect(observer).not.toHaveBeenCalled();
  });

  it('drives the real provider allowance service end to end from the fixture payload', async () => {
    const service = new ProviderAllowanceService({
      providerRepository: { getAll: () => [{ id: 'anthropic-default', name: 'Anthropic', kind: 'anthropic', enabled: true }] },
      clock: { now: () => now },
    });
    sdkStream(FIXTURE.statusOnlyRejected, FIXTURE.weeklyOpusCap);
    const adapter = new ClaudeCodeAdapter({
      allowanceObserver: service.observe.bind(service),
      clock: { now: () => now },
    });

    await collect(adapter);

    // The status-only event has no utilization, so the merged snapshot shows
    // the mapped exhausted hint while the weekly cap keeps its percentage.
    expect(service.getSnapshots().snapshots[0]).toMatchObject({
      providerId: 'anthropic-default',
      source: 'provider',
      allowances: [
        expect.objectContaining({ key: 'five_hour', remainingPercent: null, resetsAt: 1_789_900_000_000 }),
        expect.objectContaining({ key: 'seven_day_opus', remainingPercent: 12 }),
      ],
    });
  });

  it('exposes the tap to VCR replay via handleAllowanceTelemetry', async () => {
    const observer = vi.fn();
    const adapter = new ClaudeCodeAdapter({ allowanceObserver: observer, clock: { now: () => now } });
    const queryParams = { prompt: 'hello', options: { providerId: 'anthropic-default' } };
    const normalFrame = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } };

    expect(adapter.handleAllowanceTelemetry(FIXTURE.fiveHourWithUtilization, queryParams)).toBe(true);
    expect(adapter.handleAllowanceTelemetry(normalFrame, queryParams)).toBe(false);
    expect(observer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      providerId: 'anthropic-default',
      allowances: [expect.objectContaining({ key: 'five_hour', remainingPercent: 57.5 })],
    }));
  });
});
