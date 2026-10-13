import { describe, it, expect, vi } from 'vitest';
import { createUpgradeGate, isWsUpgradeRequest } from './upgradeGate.js';

function fakeSocket() {
  return { write: vi.fn(), end: vi.fn(), destroy: vi.fn() };
}

describe('createUpgradeGate non-/ws upgrades', () => {
  it('answers non-/ws upgrades with HTTP 400 and closes the socket', async () => {
    const wss = { handleUpgrade: vi.fn(), emit: vi.fn() };
    const gate = createUpgradeGate({ wss, getUsers: () => null });
    const socket = fakeSocket();
    const req = {
      url: '/api/projects',
      headers: { connection: 'Upgrade', upgrade: 'websocket' },
    };
    await gate(req, socket, Buffer.alloc(0));
    expect(wss.handleUpgrade).not.toHaveBeenCalled();
    const written = socket.write.mock.calls.map((args) => args.join('')).join('');
    expect(written).toMatch(/^HTTP\/1\.1 400/);
    const closed =
      socket.end.mock.calls.length + socket.destroy.mock.calls.length;
    expect(closed).toBeGreaterThan(0);
  });

  it('still upgrades /ws requests', async () => {
    const wss = {
      handleUpgrade: vi.fn((_req, _socket, _head, done) => done()),
      emit: vi.fn(),
    };
    const gate = createUpgradeGate({ wss, getUsers: () => null });
    await gate({ url: '/ws', headers: {} }, fakeSocket(), Buffer.alloc(0));
    expect(wss.handleUpgrade).toHaveBeenCalledTimes(1);
  });

  it('classifies upgrade paths', () => {
    expect(isWsUpgradeRequest({ url: '/ws' })).toBe(true);
    expect(isWsUpgradeRequest({ url: '/ws?x=1' })).toBe(true);
    expect(isWsUpgradeRequest({ url: '/api/projects' })).toBe(false);
  });
});
