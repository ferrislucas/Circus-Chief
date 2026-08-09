import { describe, it, expect, vi } from 'vitest';

// Mock the SDK before importing the adapter
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { ClaudeCodeAdapter } from './ClaudeCodeAdapter.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

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
